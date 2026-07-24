// Shared data-loading for a published combo template — used by both the
// Node-rendered preview (app/routes/preview.$templateId.jsx) and the public
// JSON endpoint the storefront combo-page script fetches
// (app/routes/api.combo-page-data.jsx). Kept as one function so the two
// surfaces can never drift on which collection/product/discount fields they
// resolve.
import { unauthenticated } from '../shopify.server';
import prisma from '../db.server';

// ── Guaranteed combo-page theme template ────────────────────────────────────
// Shopify Pages render page.body through whatever section layout the
// merchant's Default Page template happens to have — and merchants can (and
// do) remove the "page content" section from that template entirely via the
// Theme Editor, which silently breaks the raw-body approach (confirmed live
// on two test stores: templateSuffix was null, i.e. Default Page template,
// and neither's default template included a content section at all — both
// had been customized down to just banners/featured-collection sections).
// This provisions a dedicated template+section this app fully controls, so a
// combo page's layout never depends on what the merchant did to their
// Default Page template.
//
// themeFilesUpsert requires both the write_themes scope AND a manual
// exemption Shopify grants per-app on request — until that's approved for
// this app, every call below fails with ACCESS_DENIED and
// ensureComboForgeTemplate returns false, so callers transparently fall back
// to the plain page.body approach. Nothing here needs to change once the
// exemption lands; it just starts succeeding.
const TEMPLATE_FILENAME = 'templates/page.combo-forge.json';
const SECTION_FILENAME = 'sections/combo-forge-page.liquid';

function comboForgeSectionLiquid() {
  const scriptOrigin = process.env.SHOPIFY_APP_URL || 'https://cartdrawer.fly.dev';
  return `<div data-brix-combo-root
  data-shop="{{ shop.permanent_domain }}"
  data-template-id="{{ page.metafields.combo_forge.template_id }}"
></div>
<script src="${scriptOrigin}/combo-page.js" defer></script>

{% schema %}
{
  "name": "Combo page",
  "settings": []
}
{% endschema %}
`;
}

const TEMPLATE_JSON = JSON.stringify({
  sections: { main: { type: 'combo-forge-page' } },
  order: ['main'],
});

// Idempotent — checks for both files before writing, so this is cheap to
// call on every combo-page creation/publish rather than needing a separate
// one-time install step. Returns true if the template is available to use
// (templateSuffix: 'combo-forge' is then safe to set on the page), false if
// provisioning failed for any reason (caller falls back to the plain
// page.body approach, which still works on stock/unmodified themes).
export async function ensureComboForgeTemplate(admin) {
  try {
    const themeRes = await admin.graphql(`#graphql
      query { themes(first: 1, roles: [MAIN]) { nodes { id } } }
    `);
    const themeJson = await themeRes.json();
    const themeId = themeJson.data?.themes?.nodes?.[0]?.id;
    if (!themeId) return false;

    const filesRes = await admin.graphql(`#graphql
      query CheckComboForgeFiles($themeId: ID!, $filenames: [String!]!) {
        theme(id: $themeId) {
          files(filenames: $filenames) { nodes { filename } }
        }
      }
    `, { variables: { themeId, filenames: [TEMPLATE_FILENAME, SECTION_FILENAME] } });
    const filesJson = await filesRes.json();
    const existing = new Set((filesJson.data?.theme?.files?.nodes || []).map((n) => n.filename));
    if (existing.has(TEMPLATE_FILENAME) && existing.has(SECTION_FILENAME)) return true;

    const upsertRes = await admin.graphql(`#graphql
      mutation ComboForgeThemeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
        themeFilesUpsert(themeId: $themeId, files: $files) {
          upsertedThemeFiles { filename }
          userErrors { field message }
        }
      }
    `, {
      variables: {
        themeId,
        files: [
          { filename: TEMPLATE_FILENAME, body: { type: 'TEXT', value: TEMPLATE_JSON } },
          { filename: SECTION_FILENAME, body: { type: 'TEXT', value: comboForgeSectionLiquid() } },
        ],
      },
    });
    const upsertJson = await upsertRes.json();
    const errors = upsertJson.data?.themeFilesUpsert?.userErrors;
    if (errors?.length > 0) {
      console.error('[ComboPage] themeFilesUpsert errors:', errors);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[ComboPage] ensureComboForgeTemplate failed:', e.message);
    return false;
  }
}

const PRODUCT_FRAGMENT = `
  fragment ProductInfo on Product {
    id
    title
    handle
    featuredImage { url altText width height }
    images(first: 10) { nodes { url altText width height } }
    variants(first: 25) { nodes { id title price image { url altText } } }
    priceRangeV2 { minVariantPrice { amount currencyCode } }
  }
`;

async function ensureComboTemplatesTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS combo_templates (
      id INT NOT NULL AUTO_INCREMENT,
      shop_domain VARCHAR(255) NOT NULL,
      name VARCHAR(500) NOT NULL DEFAULT '',
      slug VARCHAR(255) DEFAULT NULL,
      template_type VARCHAR(100) NOT NULL DEFAULT 'grid',
      status VARCHAR(50) NOT NULL DEFAULT 'draft',
      is_active TINYINT NOT NULL DEFAULT 1,
      version INT NOT NULL DEFAULT 1,
      description TEXT DEFAULT NULL,
      features TEXT DEFAULT NULL,
      customization_data LONGTEXT DEFAULT NULL,
      page_handle VARCHAR(255) DEFAULT NULL,
      page_id VARCHAR(255) DEFAULT NULL,
      page_url VARCHAR(500) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    )
  `).catch(() => {});
}

export async function loadComboTemplateRow(shop, templateId) {
  await ensureComboTemplatesTable();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM combo_templates WHERE id = ? AND shop_domain = ?`,
    Number(templateId), shop
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

// Used by the storefront combo-page script's auto-detect mode (running
// globally via the cart-drawer app embed, which has no way to know a
// template's numeric id — only the current page's URL/handle) to find which
// combo template, if any, a given page handle belongs to.
export async function loadComboTemplateRowByHandle(shop, handle) {
  await ensureComboTemplatesTable();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM combo_templates WHERE page_handle = ? AND shop_domain = ? AND is_active = 1`,
    handle, shop
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

// Resolves the config, live product/collection data, and active discounts
// for one combo template. Throws a Response (404) if the template doesn't
// exist for this shop, same contract preview.$templateId.jsx already relied on.
export async function loadComboPageData(shop, templateId) {
  const row = await loadComboTemplateRow(shop, templateId);
  return loadComboPageDataForRow(shop, row);
}

export async function loadComboPageDataByHandle(shop, handle) {
  const row = await loadComboTemplateRowByHandle(shop, handle);
  return loadComboPageDataForRow(shop, row);
}

async function loadComboPageDataForRow(shop, row) {
  if (!row) throw new Response('Template not found', { status: 404 });

  const config = (() => { try { return JSON.parse(row.customization_data || '{}'); } catch { return {}; } })();
  const templateName = row.name || 'Untitled';

  const { admin } = await unauthenticated.admin(shop);

  let collections = [];
  try {
    const colRes = await admin.graphql(`#graphql
      query { collections(first: 250) {
        nodes { id title handle productsCount { count } }
      } }
    `);
    const colJson = await colRes.json();
    collections = (colJson.data?.collections?.nodes || []).map((n) => ({
      id: n.id, title: n.title, handle: n.handle,
    }));
  } catch (e) {
    console.error('[ComboPage] Collection fetch error:', e);
  }

  const allHandles = new Set();
  if (config.layout === 'layout1' || !config.layout) {
    const allSteps = [1, 2, 3, 4, 5];
    const activeSteps = allSteps.filter((step) => {
      if (step === 1) return true;
      return config[`step_${step}_collection`] || config[`step_${step}_title`];
    });
    activeSteps.forEach((step) => {
      const h = config[`step_${step}_collection`];
      if (h) allHandles.add(h);
    });
  }
  if (config.layout === 'layout2') {
    for (let i = 1; i <= (config.tab_count || 8); i++) {
      const h = config[`col_${i}`];
      if (h) allHandles.add(h);
    }
  }
  if (!config.layout || config.layout === 'layout3' || config.layout === 'layout4') {
    const h = config.collection_handle || config.step_1_collection;
    if (h) allHandles.add(h);
  }

  const productsByHandle = {};
  for (const handle of allHandles) {
    try {
      const res = await admin.graphql(`
        query GetCollectionByHandle($handle: String!) {
          collectionByHandle(handle: $handle) {
            products(first: 50) {
              edges { node { ...ProductInfo } }
            }
          }
        }
        ${PRODUCT_FRAGMENT}
      `, { variables: { handle } });
      const json = await res.json();
      const edges = json.data?.collectionByHandle?.products?.edges || [];
      productsByHandle[handle] = edges.map((e) => ({
        id: e.node.id, title: e.node.title, handle: e.node.handle,
        image: e.node.featuredImage ? { url: e.node.featuredImage.url, altText: e.node.featuredImage.altText } : null,
        images: (e.node.images?.nodes || []).map((img) => ({
          url: img.url, altText: img.altText,
        })),
        variants: (e.node.variants?.nodes || []).map((v) => ({
          id: v.id,
          title: v.title,
          price: v.price,
          image: v.image ? { url: v.image.url, altText: v.image.altText } : null,
        })),
        variantId: e.node.variants?.nodes?.[0]?.id || null,
        price: e.node.priceRangeV2?.minVariantPrice?.amount || '0.00',
        currency: e.node.priceRangeV2?.minVariantPrice?.currencyCode || 'USD',
      }));
    } catch (e) {
      console.error(`[ComboPage] Products fetch error for "${handle}":`, e);
      productsByHandle[handle] = [];
    }
  }

  const collectionNameMap = {};
  collections.forEach((c) => { collectionNameMap[c.handle] = c.title; });

  let activeDiscounts = [];
  try {
    const discRes = await admin.graphql(`#graphql
      query PreviewDiscounts {
        discountNodes(first: 50, reverse: true) {
          edges {
            node {
              id
              discount {
                ... on DiscountCodeBasic {
                  title
                  codes(first: 1) { edges { node { code } } }
                  status
                  customerGets { value { ... on DiscountPercentage { percentage } ... on DiscountAmount { amount { amount currencyCode } } } }
                }
                ... on DiscountCodeBxgy {
                  title
                  codes(first: 1) { edges { node { code } } }
                  status
                  customerGets { value { ... on DiscountPercentage { percentage } ... on DiscountAmount { amount { amount currencyCode } } } }
                }
                ... on DiscountCodeFreeShipping {
                  title
                  codes(first: 1) { edges { node { code } } }
                  status
                }
              }
            }
          }
        }
      }
    `);
    const discJson = await discRes.json();
    if (discJson.errors) console.error('[ComboPage] Discount query errors:', discJson.errors);
    if (!discJson.errors) {
      activeDiscounts = (discJson.data?.discountNodes?.edges || [])
        .map(({ node }) => {
          const d = node.discount;
          if (!d) return null;
          const code = d.codes?.edges?.[0]?.node?.code || '';
          const gets = d.customerGets?.value;
          let valueType = '';
          let value = 0;
          if (gets) {
            if ('percentage' in gets) { valueType = 'percentage'; value = parseFloat(gets.percentage || 0) * 100; }
            else if ('amount' in gets) { valueType = 'fixed_amount'; value = parseFloat(gets.amount?.amount || 0); }
          }
          return { id: node.id, title: d.title || code, code, type: d.__typename || '', status: d.status || 'ACTIVE', valueType, value };
        })
        .filter(Boolean)
        .filter((d) => d.status === 'ACTIVE');
    }
  } catch (e) {
    console.error('[ComboPage] Discount fetch error:', e);
  }

  return { templateId: row.id, templateName, config, collections, productsByHandle, collectionNameMap, shop, activeDiscounts };
}
