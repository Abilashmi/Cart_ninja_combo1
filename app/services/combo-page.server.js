// Shared data-loading for a published combo template — used by both the
// Node-rendered preview (app/routes/preview.$templateId.jsx) and the public
// JSON endpoint the storefront combo-page script fetches
// (app/routes/api.combo-page-data.jsx). Kept as one function so the two
// surfaces can never drift on which collection/product/discount fields they
// resolve.
import { unauthenticated } from '../shopify.server';
import prisma from '../db.server';
import { comboCollectionHandles, createComboWeightCore, isWeightCombo, normalizeWeightPricing, usesQuickShop } from '../utils/combo-weight.shared.js';
import { createQuickShopKit } from '../utils/combo-quickshop.shared.js';
import { storefrontWeightPricing } from './combo-weight-shopify.server';
import { loadVariantStock, pageVariantIds } from './combo-stock.server';
import { loadCollectionMembers } from './collection-members.server';
import { loadActiveDiscounts, loadBoxCollection, loadClassicCollection, loadCollections, loadExtraProducts } from './combo-page-products.server';
import { createSwrCache } from './swr-cache.server';

const quickShopKit = createQuickShopKit(createComboWeightCore());

// Combo pages are drawn by the app embed's combo-page.js on the page's own
// body ([data-brix-combo-root], or auto-detected by page handle). The app
// never writes theme files (Built for Shopify 3.2.2: no Asset API writes); it
// used to try provisioning a page.combo-forge template with themeFilesUpsert,
// which never had the exemption it needs. Pages that already have that
// template (templateSuffix 'combo-forge') keep working.

const MIN = 60_000;
// Shopify data behind combo pages, kept in memory so a shopper doesn't wait
// on a 1000+ product load: fresh for the first span, then answered at once
// while one background load refreshes it (template saves don't empty it:
// products are kept per collection, not per template).
const productCache = createSwrCache({ freshMs: 10 * MIN, staleMs: 6 * 60 * MIN, max: 300, label: 'combo-products' });
const stockCache = createSwrCache({ freshMs: 90_000, staleMs: 30 * MIN, max: 300, label: 'combo-stock' });
const membersCache = createSwrCache({ freshMs: 10 * MIN, staleMs: 6 * 60 * MIN, max: 300, label: 'combo-members' });
const shopCache = createSwrCache({ freshMs: 10 * MIN, staleMs: 6 * 60 * MIN, max: 500, label: 'combo-shop' });

// A cached load, or `fallback` when it fails with nothing cached.
async function cached(cache, key, loader, fallback, what) {
  try {
    return await cache.get(key, loader);
  } catch (e) {
    console.error(`[ComboPage] ${what}:`, String(e?.message || e).slice(0, 300));
    return fallback;
  }
}

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

export async function loadComboPageDataForRow(shop, row) {
  if (!row) throw new Response('Template not found', { status: 404 });

  const config = (() => { try { return JSON.parse(row.customization_data || '{}'); } catch { return {}; } })();
  const templateName = row.name || 'Untitled';

  const { admin } = await unauthenticated.admin(shop);
  const startedAt = Date.now();

  // Includes layout3's col_1..col_4 nav pills — without them every pill, and
  // the "all" view built from them, renders "No products in this category".
  // Shared with weight pricing, whose "layout collections" are these same ones.
  const allHandles = comboCollectionHandles(config);
  const box = usesQuickShop(config.layout);
  // Box templates: products added beyond the page's collections (they also
  // count toward the box, weight_pricing.qualify.extra_product_ids).
  const extraIds = box ? (normalizeWeightPricing(config.weight_pricing).value.qualify.extra_product_ids || []) : [];

  const [collections, lists, extras, activeDiscounts] = await Promise.all([
    cached(shopCache, `collections:${shop}`, () => loadCollections(admin), [], 'Collection fetch error'),
    Promise.all(allHandles.map((handle) => cached(
      productCache, `${box ? 'box' : 'classic'}:${shop}:${handle}`,
      () => (box ? loadBoxCollection(admin, handle) : loadClassicCollection(admin, handle)),
      [], `Products fetch error for "${handle}"`,
    ))),
    extraIds.length
      ? cached(productCache, `extra:${shop}:${extraIds.join(',')}`, () => loadExtraProducts(admin, extraIds), null, 'Extra products fetch error')
      : null,
    cached(shopCache, `discounts:${shop}`, () => loadActiveDiscounts(admin), [], 'Discount fetch error'),
  ]);

  const productsByHandle = {};
  allHandles.forEach((handle, i) => { productsByHandle[handle] = lists[i]; });
  if (extras) productsByHandle[quickShopKit.EXTRA_HANDLE] = extras;

  // Stock limits and the box templates' collection filter groups (which page
  // products are in each filter collection; kept apart from allHandles, which
  // also decides what the box price counts). Keyed by the page's collections,
  // not its product ids, so a collection refresh never makes a shopper wait.
  const pageKey = `${shop}:${allHandles.join(',')}:${extraIds.join(',')}`;
  const filterHandles = box ? quickShopKit.memberHandles(config) : [];
  const [stock, collectionMembers, weightPricing] = await Promise.all([
    cached(stockCache, pageKey, () => loadVariantStock(admin, pageVariantIds(productsByHandle)), null, 'stock limits skipped'),
    filterHandles.length
      ? cached(membersCache, `${pageKey}:${filterHandles.join(',')}`, async () => {
        const productIds = [...new Set(Object.values(productsByHandle).flat().map((p) => p.id))];
        const members = await loadCollectionMembers(admin, { handles: filterHandles, productIds });
        // It never throws: a handle left out = its lookup failed; don't keep that.
        if (!Object.keys(members).length) throw new Error('collection membership unknown');
        return members;
      }, {}, 'collection membership skipped')
      : {},
    // Weight-priced combos: tiers, max weight and which shown products count.
    // `enabled` only when checkout will really give the box price.
    isWeightCombo(config)
      ? storefrontWeightPricing({ shop, admin, templateId: row.id, active: Number(row.is_active) === 1 || row.is_active === true, config, productsByHandle })
      : null,
  ]);
  // On copies: the cached products are shared by every request.
  if (stock) {
    for (const handle of Object.keys(productsByHandle)) {
      productsByHandle[handle] = productsByHandle[handle].map((p) => ({
        ...p,
        variants: (p.variants || []).map((v) => ({ ...v, stock: typeof stock[v.id] === 'number' ? stock[v.id] : null })),
      }));
    }
  }

  const collectionNameMap = {};
  collections.forEach((c) => { collectionNameMap[c.handle] = c.title; });
  // Quick Shop's picture collection bar (qs_chip_style: images), only for this page's collections.
  const collectionImageMap = {};
  collections.forEach((c) => { if (c.image && allHandles.includes(c.handle)) collectionImageMap[c.handle] = c.image; });

  const ms = Date.now() - startedAt;
  if (ms > 3000) {
    const count = Object.values(productsByHandle).reduce((n, list) => n + list.length, 0);
    console.warn(`[ComboPage] ${shop} template ${row.id}: ${ms} ms for ${count} products`);
  }

  return { templateId: row.id, templateName, config, collections, productsByHandle, collectionNameMap, collectionImageMap, collectionMembers, shop, activeDiscounts, weightPricing };
}
