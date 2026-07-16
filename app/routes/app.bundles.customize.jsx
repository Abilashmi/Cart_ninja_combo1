import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  useLoaderData,
  useFetcher,
  useSearchParams,
  useNavigate,
} from 'react-router';
import {
  Page,
  Card,
  FormLayout,
  Popover,
  Spinner,
  TextField,
  Select,
  Checkbox,
  Button,
  ButtonGroup,
  Modal,
  ColorPicker,
  Icon,
  Text,
  Tooltip,
} from '@shopify/polaris';
import {
  EditIcon,
  DesktopIcon,
  MobileIcon,
  LayoutColumns3Icon,
  PaintBrushFlatIcon,
  SettingsIcon,
  MagicIcon,
} from '@shopify/polaris-icons';
import { useAppBridge } from '@shopify/app-bridge-react';
import { authenticate } from '../shopify.server';
import { CdoPreviewBar } from '../components/CdoPreviewBar';
import { BuilderSidebar } from '../components/customization/BuilderSidebar';
import { BuilderActionBar } from '../components/customization/BuilderActionBar';
import { ValidationPanel } from '../components/customization/ValidationPanel';
import BrixBar from '../components/ai-agent/BrixBar';
import { getDb, sendToPhp } from '../utils/api-helpers';
import prisma from '../db.server';

export const action = async ({ request }) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    const formData = await request.formData();
    const discountData = Object.fromEntries(formData);
    const db = await getDb(shop);
    const discounts = db.discounts || [];

    const type = String(discountData.type || 'amount_off_products');
    const title = String(discountData.title || '').trim();
    const valueType = String(discountData.valueType || 'percentage');
    const startsAt = discountData.startsAt
      ? new Date(discountData.startsAt).toISOString()
      : new Date().toISOString();
    const endsAt = discountData.endsAt
      ? new Date(discountData.endsAt).toISOString()
      : null;
    const parseBool = (v) => v === true || v === 'true' || v === 'on';
    const parseNum = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : NaN;
    };

    if (!title) {
      return Response.json({ error: 'Title is required' }, { status: 400 });
    }

    if (
      [
        'amount_off_products',
        'amount_off_order',
        'percentage',
        'fixed',
        'amount',
      ].includes(type)
    ) {
      const baseValue = parseNum(discountData.value);
      if (!Number.isFinite(baseValue) || baseValue <= 0) {
        return Response.json({ error: 'Value must be greater than 0' }, { status: 400 });
      }
    }

    if (type === 'buy_x_get_y') {
      const buyQty = parseNum(discountData.buyQuantity);
      const getQty = parseNum(discountData.getQuantity);
      const getVal = parseNum(discountData.getValue);
      if (!Number.isFinite(buyQty) || buyQty <= 0) {
        return Response.json({ error: 'Buy quantity is required' }, { status: 400 });
      }
      if (!Number.isFinite(getQty) || getQty <= 0) {
        return Response.json({ error: 'Get quantity is required' }, { status: 400 });
      }
      if (!Number.isFinite(getVal) || getVal <= 0) {
        return Response.json({ error: 'Get value is required' }, { status: 400 });
      }
    }

    const minimumRequirement =
      discountData.minRequirementType === 'amount' &&
        discountData.minRequirementValue
        ? {
          subtotal: {
            greaterThanOrEqualToSubtotal: parseFloat(
              discountData.minRequirementValue
            ),
          },
        }
        : discountData.minRequirementType === 'quantity' &&
          discountData.minRequirementValue
          ? {
            quantity: {
              greaterThanOrEqualToQuantity: String(
                discountData.minRequirementValue
              ),
            },
          }
          : null;

    let combinations = { product: false, order: false, shipping: false };
    try {
      if (discountData.combinations) {
        combinations = JSON.parse(discountData.combinations);
      }
    } catch (err) {
      console.warn(
        '[Customize] Failed parsing combinations JSON:',
        err.message
      );
    }

    const usageLimit = discountData.maxUsage
      ? parseInt(discountData.maxUsage, 10)
      : null;
    const appliesOncePerCustomer = parseBool(discountData.oncePerCustomer);
    const code = discountData.code
      ? String(discountData.code).toUpperCase()
      : title.toUpperCase().replace(/\s+/g, '');

    let shopifyDiscountId = null;

    if (
      [
        'amount_off_products',
        'amount_off_order',
        'percentage',
        'fixed',
        'amount',
      ].includes(type)
    ) {
      const mutation = `#graphql
        mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
          discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
            codeDiscountNode { id }
            userErrors { field message }
          }
        }
      `;

      const discountValue = parseFloat(discountData.value || 0) || 0;
      const isPercentage = valueType === 'percentage';
      const customerGetsValue = isPercentage
        ? { percentage: discountValue / 100 }
        : {
          discountAmount: {
            amount: String(discountValue),
            appliesOnEachItem: type !== 'amount_off_order',
          },
        };

      // Applies-to for amount_off_products
      let appliesToItems = { all: true };
      if (type === 'amount_off_products') {
        const appliesTo = String(discountData.appliesTo || 'all');
        let appliesToIds = [];
        try { appliesToIds = discountData.appliesToIds ? JSON.parse(discountData.appliesToIds) : []; } catch {}
        if (appliesTo === 'products' && appliesToIds.length) {
          appliesToItems = { products: { productsToAdd: appliesToIds } };
        } else if (appliesTo === 'collections' && appliesToIds.length) {
          appliesToItems = { collections: { add: appliesToIds } };
        }
      }

      const variables = {
        basicCodeDiscount: {
          title,
          code,
          startsAt,
          ...(endsAt ? { endsAt } : {}),
          customerSelection: { all: true },
          customerGets: {
            value: customerGetsValue,
            items: type === 'amount_off_order' ? { all: true } : appliesToItems,
          },
          appliesOncePerCustomer,
          combinesWith: {
            orderDiscounts: !!combinations.order,
            productDiscounts: !!combinations.product,
            shippingDiscounts: !!combinations.shipping,
          },
          ...(minimumRequirement ? { minimumRequirement } : {}),
          ...(usageLimit ? { usageLimit } : {}),
        },
      };

      const response = await admin.graphql(mutation, { variables });
      const responseJson = await response.json();
      const userErrors =
        responseJson.data?.discountCodeBasicCreate?.userErrors || [];

      if (userErrors.length > 0) {
        return Response.json(
          {
            error: `Shopify Error: ${userErrors.map((e) => e.message).join(', ')}`,
          },
          { status: 400 }
        );
      }

      shopifyDiscountId =
        responseJson.data?.discountCodeBasicCreate?.codeDiscountNode?.id ||
        null;
    } else if (type === 'free_shipping') {
      const mutation = `#graphql
        mutation discountCodeFreeShippingCreate($freeShippingCodeDiscount: DiscountCodeFreeShippingInput!) {
          discountCodeFreeShippingCreate(freeShippingCodeDiscount: $freeShippingCodeDiscount) {
            codeDiscountNode { id }
            userErrors { field message }
          }
        }
      `;

      const freeShipAllCountries = discountData.freeShipAllCountries !== 'false';
      const freeShipCountryCodes = String(discountData.freeShipCountryCodes || '');
      const parsedCountryCodes = freeShipCountryCodes
        .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      const destination = (!freeShipAllCountries && parsedCountryCodes.length)
        ? { countries: { add: parsedCountryCodes } }
        : { all: true };

      const variables = {
        freeShippingCodeDiscount: {
          title,
          code,
          startsAt,
          ...(endsAt ? { endsAt } : {}),
          customerSelection: { all: true },
          destination,
          appliesOncePerCustomer,
          combinesWith: {
            orderDiscounts: !!combinations.order,
            productDiscounts: !!combinations.product,
            shippingDiscounts: !!combinations.shipping,
          },
          ...(minimumRequirement ? { minimumRequirement } : {}),
          ...(usageLimit ? { usageLimit } : {}),
        },
      };

      const response = await admin.graphql(mutation, { variables });
      const responseJson = await response.json();
      const userErrors =
        responseJson.data?.discountCodeFreeShippingCreate?.userErrors || [];

      if (userErrors.length > 0) {
        return Response.json(
          {
            error: `Shopify Error: ${userErrors.map((e) => e.message).join(', ')}`,
          },
          { status: 400 }
        );
      }

      shopifyDiscountId =
        responseJson.data?.discountCodeFreeShippingCreate?.codeDiscountNode
          ?.id || null;
    } else if (type === 'buy_x_get_y') {
      const mutation = `#graphql
        mutation discountCodeBxgyCreate($bxgyCodeDiscount: DiscountCodeBxgyInput!) {
          discountCodeBxgyCreate(bxgyCodeDiscount: $bxgyCodeDiscount) {
            codeDiscountNode { id }
            userErrors { field message }
          }
        }
      `;

      const getValueType = String(discountData.getValueType || 'percentage');
      const getValue = parseFloat(discountData.getValue || 0) || 0;
      const buyQuantity = String(parseInt(discountData.buyQuantity, 10));
      const getQuantity = String(parseInt(discountData.getQuantity, 10));
      const buyTargetType = String(discountData.buyTargetType || 'products');
      const getTargetType = String(discountData.getTargetType || 'all');

      let buyTargetIds = [];
      let getTargetIds = [];
      try {
        buyTargetIds = discountData.buyTargetIds
          ? JSON.parse(discountData.buyTargetIds)
          : [];
        getTargetIds = discountData.getTargetIds
          ? JSON.parse(discountData.getTargetIds)
          : [];
      } catch (err) {
        return Response.json(
          { error: 'Invalid buy/get target data provided' },
          { status: 400 }
        );
      }

      const customerBuysItems =
        buyTargetType === 'collections'
          ? {
            collections: {
              add: buyTargetIds,
            },
          }
          : {
            products: {
              productsToAdd: buyTargetIds,
            },
          };

      const customerGetsItems =
        getTargetType === 'all'
          ? { all: true }
          : getTargetType === 'collections'
            ? {
              collections: {
                add: getTargetIds,
              },
            }
            : {
              products: {
                productsToAdd: getTargetIds,
              },
            };

      if (!buyTargetIds.length) {
        return Response.json(
          {
            error:
              buyTargetType === 'collections'
                ? 'Select at least one collection for customer buys'
                : 'Select at least one product for customer buys',
          },
          { status: 400 }
        );
      }
      if (getTargetType !== 'all' && !getTargetIds.length) {
        return Response.json(
          {
            error:
              getTargetType === 'collections'
                ? 'Select at least one collection for customer gets'
                : 'Select at least one product for customer gets',
          },
          { status: 400 }
        );
      }

      const effect =
        getValueType === 'fixed_amount'
          ? { amount: String(getValue) }
          : getValueType === 'free'
            ? { percentage: 1.0 }
            : { percentage: getValue / 100 };

      const variables = {
        bxgyCodeDiscount: {
          title,
          code,
          startsAt,
          ...(endsAt ? { endsAt } : {}),
          customerSelection: { all: true },
          appliesOncePerCustomer,
          combinesWith: {
            orderDiscounts: !!combinations.order,
            productDiscounts: !!combinations.product,
            shippingDiscounts: !!combinations.shipping,
          },
          ...(minimumRequirement ? { minimumRequirement } : {}),
          ...(usageLimit ? { usageLimit } : {}),
          customerBuys: {
            value: { quantity: buyQuantity },
            items: customerBuysItems,
          },
          customerGets: {
            value: {
              discountOnQuantity: {
                quantity: getQuantity,
                effect,
              },
            },
            items: customerGetsItems,
          },
        },
      };

      const response = await admin.graphql(mutation, { variables });
      const responseJson = await response.json();
      const userErrors =
        responseJson.data?.discountCodeBxgyCreate?.userErrors || [];

      if (userErrors.length > 0) {
        return Response.json(
          {
            error: `Shopify Error: ${userErrors.map((e) => e.message).join(', ')}`,
          },
          { status: 400 }
        );
      }

      shopifyDiscountId =
        responseJson.data?.discountCodeBxgyCreate?.codeDiscountNode?.id || null;
    } else {
      return Response.json({ error: 'Unsupported discount type' }, { status: 400 });
    }

    const nextId = Math.max(...discounts.map((d) => Number(d.id) || 0), 0) + 1;
    const newDiscount = {
      id: nextId,
      shopifyId: shopifyDiscountId,
      title,
      code,
      type,
      value:
        type === 'free_shipping'
          ? '0'
          : type === 'buy_x_get_y'
            ? String(discountData.getValue || '')
            : String(discountData.value || ''),
      valueType:
        type === 'buy_x_get_y'
          ? String(discountData.getValueType || 'percentage')
          : valueType,
      status: 'active',
      created: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
      usage: usageLimit ? `0 / ${usageLimit}` : '0 / Unlimited',
      startsAt: discountData.startsAt || startsAt,
      endsAt: discountData.endsAt || null,
      oncePerCustomer: appliesOncePerCustomer,
    };

    discounts.push(newDiscount);

    // Sync to PHP
    try {
      await sendToPhp(
        {
          event: 'create',
          resource: 'discount',
          shop,
          data: newDiscount,
        },
        'discount.php'
      );
    } catch (err) {
      console.error('[Customize] PHP Sync Error:', err.message);
    }

    console.log(`[Combo App Customize] Discount created: ${newDiscount.title}`);

    return Response.json({
      success: true,
      message: 'Discount code created on Shopify',
      discount: newDiscount,
    });
  } catch (error) {
    console.error('Discount creation error:', error);
    return Response.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
};

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const templateId = url.searchParams.get('templateId');
  const mode = url.searchParams.get('mode'); // 'resources' or 'full'

  // RESOURCE FETCHING MODE (Background)
  if (mode === 'resources') {
    console.log('[Customize Loader] Entering resources mode for shop:', shop);
    let collections = [];
    try {
      let hasNextPage = true,
        endCursor = null,
        pageCount = 0;
      while (hasNextPage && pageCount < 10) {
        console.log(
          `[Customize Loader] Fetching collections page ${pageCount + 1}, cursor: ${endCursor}`
        );
        const res = await admin.graphql(
          `#graphql
          query getCollections($cursor: String) {
            collections(first: 250, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              nodes { id title handle }
            }
          }`,
          { variables: { cursor: endCursor } }
        );

        const json = await res.json();

        if (json.errors) {
          console.error(
            '[Customize Loader] GraphQL Errors:',
            JSON.stringify(json.errors)
          );
        }

        const data = json.data?.collections;
        if (data && data.nodes) {
          console.log(
            `[Customize Loader] Found ${data.nodes.length} collections on this page`
          );
          collections.push(
            ...data.nodes.map((n) => ({
              id: n.id,
              title: n.title,
              handle: n.handle,
            }))
          );
          hasNextPage = data.pageInfo.hasNextPage;
          endCursor = data.pageInfo.endCursor;
        } else {
          console.log(
            '[Customize Loader] No more collections data in response'
          );
          break;
        }
        pageCount++;
      }
      console.log(
        `[Customize Loader] Total collections fetched: ${collections.length}`
      );
    } catch (e) {
      console.error('[Customize Loader] Collection fetch CRITICAL error:', e);
    }

    console.log('[Customize Loader] Fetching products and pages...');
    const productsRes = await admin
      .graphql(
        `#graphql
      query getProducts {
        products(first: 60) {
          nodes { id title handle vendor totalInventory descriptionHtml images(first: 8) { nodes { url } } featuredMedia { preview { image { url } } } collections(first: 5) { nodes { handle } } variants(first: 10) { nodes { id title price compareAtPrice availableForSale inventoryQuantity image { url } } } }
        }
      }`
      )
      .then((r) => r.json())
      .catch((err) => {
        console.error('[Customize Loader] Product fetch error:', err);
        return { data: { products: { nodes: [] } } };
      });

    const products = (productsRes.data?.products?.nodes || []).map((p) => {
      const variants = p.variants?.nodes || [];
      const hasSellableVariant = variants.some(
        (v) =>
          v.availableForSale === true || Number(v.inventoryQuantity || 0) > 0
      );

      return {
        ...p,
        available:
          p.availableForSale === true ||
          Number(p.totalInventory || 0) > 0 ||
          hasSellableVariant,
        collections: p.collections?.nodes || [],
        variants: variants.map((v) => ({
          ...v,
          available:
            v.availableForSale === true || Number(v.inventoryQuantity || 0) > 0,
        })),
        secondImageSrc:
          p.images?.nodes?.length > 1 ? p.images.nodes[1].url : null,
      };
    });

    const pagesRes = await admin
      .graphql(
        `#graphql
      query getPages { pages(first: 50) { nodes { id handle title } } }`
      )
      .then((r) => r.json())
      .catch((err) => {
        console.error('[Customize Loader] Pages fetch error:', err);
        return { data: { pages: { nodes: [] } } };
      });
    const shopPages = pagesRes.data?.pages?.nodes || [];

    console.log(
      `[Customize Loader] Returning ${collections.length} collections, ${products.length} products, ${shopPages.length} pages`
    );
    return Response.json({ collections, products, shopPages });
  }

  // INITIAL LOAD MODE (Fast) — the PHP templates/discounts fetch, the SQLite
  // combo_templates read, and the three Admin GraphQL calls (collections,
  // products, discounts) are all independent of each other, so they run
  // concurrently instead of one after another. Each keeps its own try/catch
  // so a failure in one doesn't wipe out data already fetched by the others.
  const [db, localData, initialCollections, initialProducts, activeDiscounts] = await Promise.all([
    getDb(shop).catch(() => ({ templates: [], discounts: [] })),
    (async () => {
      let localTemplate = null;
      let localTemplates = [];
      try {
        const rows = await prisma.$queryRawUnsafe(
          `SELECT * FROM combo_templates WHERE shop_domain = ? ORDER BY updated_at DESC`,
          shop
        );
        localTemplates = Array.isArray(rows) ? rows : [];
        if (templateId) {
          const found = localTemplates.find((t) => String(t.id) === String(templateId));
          if (found) {
            localTemplate = {
              id: Number(found.id),
              title: found.name || 'Untitled',
              active: Boolean(found.is_active),
              config: (() => { try { return JSON.parse(found.customization_data || '{}'); } catch { return {}; } })(),
              template_type: found.template_type || 'grid',
              shop,
            };
          }
        }
      } catch (e) {
        console.error('[Customize] SQLite read error:', e);
      }
      return { localTemplate, localTemplates };
    })(),
    (async () => {
      try {
        const colRes = await admin.graphql(
          `#graphql
          query InitialCollections {
            collections(first: 250) {
              nodes {
                id
                title
                handle
                productsCount { count }
              }
            }
          }`
        );

        const colJson = await colRes.json();
        if (colJson.errors) {
          console.error(
            '[Customize Loader] InitialCollections GraphQL errors (check app scopes — needs write_products):',
            JSON.stringify(colJson.errors)
          );
        }
        const collections = (colJson.data?.collections?.nodes || []).map((n) => ({
          id: n.id,
          title: n.title,
          handle: n.handle,
          productsCount: n.productsCount?.count ?? 0,
        }));
        console.log(`[Customize Loader] Initial collections loaded: ${collections.length}`);
        return collections;
      } catch (error) {
        console.error('[Customize Loader] Initial collection fetch error:', error);
        return [];
      }
    })(),
    // Fetch initial products server-side so the preview is never empty on first render
    (async () => {
      try {
        const prodRes = await admin.graphql(
          `#graphql
          query InitialProducts {
            products(first: 60) {
              nodes {
                id
                title
                handle
                vendor
                totalInventory
                descriptionHtml
                images(first: 2) { nodes { url } }
                featuredMedia { preview { image { url } } }
                collections(first: 5) { nodes { handle title } }
                variants(first: 10) {
                  nodes {
                    id
                    title
                    price
                    availableForSale
                    inventoryQuantity
                    image { url }
                  }
                }
              }
            }
          }`
        );
        const prodJson = await prodRes.json();
        if (prodJson.errors) {
          console.error('[Customize Loader] InitialProducts GraphQL errors:', JSON.stringify(prodJson.errors));
        }
        const products = (prodJson.data?.products?.nodes || []).map((p) => {
          const variants = p.variants?.nodes || [];
          return {
            id: p.id,
            title: p.title,
            handle: p.handle,
            vendor: p.vendor,
            descriptionHtml: p.descriptionHtml,
            totalInventory: p.totalInventory,
            available:
              p.availableForSale === true ||
              Number(p.totalInventory || 0) > 0 ||
              variants.some(
                (v) => v.availableForSale === true || Number(v.inventoryQuantity || 0) > 0
              ),
            image: p.featuredMedia?.preview?.image
              ? { src: p.featuredMedia.preview.image.url }
              : null,
            secondImageSrc: p.images?.nodes?.length > 1 ? p.images.nodes[1].url : null,
            collections: (p.collections?.nodes || []).map((c) => ({
              handle: c.handle,
              title: c.title,
            })),
            variants: variants.map((v) => ({
              id: v.id,
              title: v.title,
              price: v.price,
              inventoryQuantity: v.inventoryQuantity,
              available:
                v.availableForSale === true || Number(v.inventoryQuantity || 0) > 0,
              image: v.image ? { src: v.image.url } : null,
            })),
          };
        });
        console.log(`[Customize Loader] Initial products loaded: ${products.length}`);
        return products;
      } catch (error) {
        console.error('[Customize Loader] Initial product fetch error:', error);
        return [];
      }
    })(),
    (async () => {
      try {
        const discRes = await admin.graphql(`#graphql
          query BundleDiscounts {
            discountNodes(first: 50, reverse: true) {
              edges {
                node {
                  id
                  discount {
                    ... on DiscountCodeBasic {
                      title
                      codes(first: 1) { edges { node { code } } }
                      status
                    }
                    ... on DiscountCodeBxgy {
                      title
                      codes(first: 1) { edges { node { code } } }
                      status
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
          }`);
        const discJson = await discRes.json();
        if (discJson.errors) return [];
        return (discJson.data?.discountNodes?.edges || [])
          .map(({ node }) => {
            const d = node.discount;
            if (!d) return null;
            const code = d.codes?.edges?.[0]?.node?.code || '';
            return {
              id: node.id,
              title: d.title || code,
              code,
              type: d.__typename || '',
              status: d.status || 'ACTIVE',
            };
          })
          .filter(Boolean)
          .filter((d) => d.status === 'ACTIVE');
      } catch (error) {
        console.error('[Customize Loader] Discount fetch error:', error);
        return [];
      }
    })(),
  ]);

  const { localTemplate } = localData;
  const shopTemplates = (db.templates || []).filter((t) => t.shop === shop);
  const initialTemplate = localTemplate || (templateId
    ? shopTemplates.find((t) => String(t.id) === String(templateId)) || null
    : null);

  const layoutFiles = [];

  return Response.json({
    initialTemplate,
    shop,
    collections: initialCollections,
    initialProducts,
    existingTemplates: shopTemplates.map((t) => ({ id: t.id, title: t.title })),
    layoutFiles,
    activeDiscounts,
  });
};

// Helper for simple PxField component

// Simple PxField component
function PxField({
  label,
  value,
  onChange,
  min = 0,
  max = 2000,
  step = 1,
  suffix = 'px',
}) {
  const handle = (v) => {
    const num = Number(v);
    if (Number.isNaN(num)) {
      onChange(0);
      return;
    }
    const clamped = Math.max(min, Math.min(max, num));
    onChange(clamped);
  };
  return (
    <div className="compact-field">
      <div
        style={{
          marginBottom: 4,
          fontSize: '12px',
          fontWeight: 500,
          color: '#444',
        }}
      >
        {label}
      </div>
      <TextField
        type="number"
        value={String(value ?? 0)}
        onChange={handle}
        suffix={suffix}
        autoComplete="off"
        inputMode="numeric"
        step={step}
        min={min}
        max={max}
      />
    </div>
  );
}

// Helper to convert HSB to HEX
const hsbToHex = ({ hue, saturation, brightness }) => {
  const h = hue;
  const s = saturation;
  const b = brightness;
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return b - b * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const toHex = (x) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(f(5))}${toHex(f(3))}${toHex(f(1))}`;
};

// Helper to convert HEX to HSB
const hexToHsb = (hex) => {
  let r = 0,
    g = 0,
    b = 0;
  if (hex.length === 4) {
    r = parseInt('0x' + hex[1] + hex[1]);
    g = parseInt('0x' + hex[2] + hex[2]);
    b = parseInt('0x' + hex[3] + hex[3]);
  } else if (hex.length === 7) {
    r = parseInt('0x' + hex[1] + hex[2]);
    g = parseInt('0x' + hex[3] + hex[4]);
    b = parseInt('0x' + hex[5] + hex[6]);
  }
  r /= 255;
  g /= 255;
  b /= 255;
  const cmin = Math.min(r, g, b),
    cmax = Math.max(r, g, b),
    delta = cmax - cmin,
    brightness = cmax;
  let hue = 0,
    saturation = 0;

  if (delta === 0) hue = 0;
  else if (cmax === r) hue = ((g - b) / delta) % 6;
  else if (cmax === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;

  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;
  saturation = cmax === 0 ? 0 : delta / cmax;

  return { hue, saturation, brightness };
};

const isPreviewProductInStock = (product) => {
  if (!product) return false;
  // Trust the pre-computed available flag as the primary signal
  if (product.available === true) return true;
  if (product.available === false) return false;

  // Fallback: check raw inventory when available flag is absent
  const productInventory = parseInt(product.totalInventory, 10);
  if (Number.isFinite(productInventory) && productInventory > 0) return true;

  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (!variants.length) return true;

  return variants.some(
    (v) => v.available === true || Number(v.inventoryQuantity || 0) > 0
  );
};

const filterPreviewProductsByStock = (list, config) => {
  const items = Array.isArray(list) ? list : [];
  if (config?.show_sold_out_products) return items;
  return items.filter(isPreviewProductInStock);
};

// CollapsibleCard helper component
const CollapsibleCard = ({ title, expanded, onToggle, children }) => {
  return (
    <div
      style={{
        border: '1px solid #e1e3e5',
        borderRadius: '8px',
        marginBottom: '12px',
        overflow: 'hidden',
        background: '#fff',
      }}
    >
      <div
        onClick={onToggle}
        style={{
          padding: '12px 16px',
          background: expanded ? '#f9fafb' : '#fff',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: expanded ? '1px solid #e1e3e5' : 'none',
          transition: 'background 0.2s ease',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
        onMouseLeave={(e) =>
          (e.currentTarget.style.background = expanded ? '#f9fafb' : '#fff')
        }
      >
        <span style={{ fontWeight: '600', fontSize: '14px', color: '#202223' }}>
          {title}
        </span>
        <span
          style={{
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
            display: 'inline-block',
            fontSize: '10px',
          }}
        >
          ▼
        </span>
      </div>
      {expanded && <div style={{ padding: '16px' }}>{children}</div>}
    </div>
  );
};

// Simple ColorPickerField component
function ColorPickerField({ label, value, onChange }) {
  const [visible, setVisible] = useState(false);
  const [color, setColor] = useState(hexToHsb(value || '#000000'));

  useEffect(() => {
    setColor(hexToHsb(value || '#000000'));
  }, [value]);

  const handleColorChange = (newColor) => {
    setColor(newColor);
    onChange(hsbToHex(newColor));
  };

  const togglePopover = () => setVisible(!visible);

  const activator = (
    <div onClick={(e) => e.stopPropagation()} className="compact-field">
      <div
        style={{
          marginBottom: 4,
          fontSize: '12px',
          fontWeight: 500,
          color: '#444',
        }}
      >
        {label}
      </div>
      <TextField
        value={value}
        onChange={(v) => {
          // allow manual hex entry
          onChange(v);
        }}
        autoComplete="off"
        prefix={
          <div
            role="button"
            onClick={togglePopover}
            style={{
              width: 24,
              height: 24,
              borderRadius: 4,
              backgroundColor: value,
              border: '1px solid #d3d4d5',
              cursor: 'pointer',
            }}
          />
        }
      />
    </div>
  );

  return (
    <Popover
      active={visible}
      activator={activator}
      onClose={togglePopover}
      preferredAlignment="left"
    >
      <div style={{ padding: '16px' }}>
        <ColorPicker onChange={handleColorChange} color={color} />
      </div>
    </Popover>
  );
}

// Demo products shown in the preview when real Shopify products haven't loaded yet.
// Uses reliable placehold.co URLs so images always render.
const DEMO_PRODUCTS = [
  {
    id: 'demo-1',
    title: 'Classic White Tee',
    handle: 'classic-white-tee',
    available: true,
    totalInventory: 50,
    descriptionHtml: '<p>A timeless everyday essential in premium cotton.</p>',
    image: { src: 'https://placehold.co/400x400/f5f5f5/333333?text=Product+1' },
    secondImageSrc: 'https://placehold.co/400x400/eeeeee/555555?text=Back+View',
    collections: [],
    variants: [
      { id: 'demo-v1', title: 'S', price: '29.99', available: true, inventoryQuantity: 10, image: null },
      { id: 'demo-v2', title: 'M', price: '29.99', available: true, inventoryQuantity: 15, image: null },
      { id: 'demo-v3', title: 'L', price: '29.99', available: true, inventoryQuantity: 25, image: null },
    ],
  },
  {
    id: 'demo-2',
    title: 'Navy Hoodie',
    handle: 'navy-hoodie',
    available: true,
    totalInventory: 30,
    descriptionHtml: '<p>Cozy fleece hoodie for cooler days.</p>',
    image: { src: 'https://placehold.co/400x400/1a237e/ffffff?text=Product+2' },
    secondImageSrc: 'https://placehold.co/400x400/283593/ffffff?text=Back+View',
    collections: [],
    variants: [
      { id: 'demo-v4', title: 'M', price: '59.99', available: true, inventoryQuantity: 10, image: null },
      { id: 'demo-v5', title: 'L', price: '59.99', available: true, inventoryQuantity: 20, image: null },
    ],
  },
  {
    id: 'demo-3',
    title: 'Canvas Sneakers',
    handle: 'canvas-sneakers',
    available: true,
    totalInventory: 20,
    descriptionHtml: '<p>Lightweight canvas shoes perfect for any occasion.</p>',
    image: { src: 'https://placehold.co/400x400/e8f5e9/2e7d32?text=Product+3' },
    secondImageSrc: 'https://placehold.co/400x400/c8e6c9/1b5e20?text=Side+View',
    collections: [],
    variants: [
      { id: 'demo-v6', title: '8', price: '79.99', available: true, inventoryQuantity: 5, image: null },
      { id: 'demo-v7', title: '9', price: '79.99', available: true, inventoryQuantity: 8, image: null },
      { id: 'demo-v8', title: '10', price: '79.99', available: true, inventoryQuantity: 7, image: null },
    ],
  },
  {
    id: 'demo-4',
    title: 'Leather Belt',
    handle: 'leather-belt',
    available: true,
    totalInventory: 40,
    descriptionHtml: '<p>Full-grain leather belt with classic buckle.</p>',
    image: { src: 'https://placehold.co/400x400/3e2723/ffd54f?text=Product+4' },
    secondImageSrc: null,
    collections: [],
    variants: [
      { id: 'demo-v9', title: 'S/M', price: '39.99', available: true, inventoryQuantity: 20, image: null },
      { id: 'demo-v10', title: 'L/XL', price: '39.99', available: true, inventoryQuantity: 20, image: null },
    ],
  },
  {
    id: 'demo-5',
    title: 'Wool Scarf',
    handle: 'wool-scarf',
    available: true,
    totalInventory: 25,
    descriptionHtml: '<p>Soft merino wool scarf in a classic plaid pattern.</p>',
    image: { src: 'https://placehold.co/400x400/880e4f/fce4ec?text=Product+5' },
    secondImageSrc: null,
    collections: [],
    variants: [
      { id: 'demo-v11', title: 'One Size', price: '49.99', available: true, inventoryQuantity: 25, image: null },
    ],
  },
  {
    id: 'demo-6',
    title: 'Sunglasses',
    handle: 'sunglasses',
    available: true,
    totalInventory: 15,
    descriptionHtml: '<p>UV400 polarised lenses with lightweight frame.</p>',
    image: { src: 'https://placehold.co/400x400/37474f/eceff1?text=Product+6' },
    secondImageSrc: null,
    collections: [],
    variants: [
      { id: 'demo-v12', title: 'Default', price: '89.99', available: true, inventoryQuantity: 15, image: null },
    ],
  },
];

// Self-contained sample banner (gradient + product-card shapes) shown
// wherever no merchant-supplied banner image is set yet. An inline SVG data
// URI rather than a hosted image URL — a previous hosted sample banner
// (a Shopify CDN file link) went dead (404), so this can never break again.
const SAMPLE_BANNER_IMAGE = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwMCIgaGVpZ2h0PSI0MDAiIHZpZXdCb3g9IjAgMCAxMjAwIDQwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8ZGVmcz4KICAgIDxsaW5lYXJHcmFkaWVudCBpZD0iYmciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iI2Y2ZjdmOSIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiNlOGVhZWUiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8cmFkaWFsR3JhZGllbnQgaWQ9Imdsb3cxIiBjeD0iNTAlIiBjeT0iNTAlIiByPSI1MCUiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAlIiBzdG9wLWNvbG9yPSIjZmZmZmZmIiBzdG9wLW9wYWNpdHk9IjAuOTUiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSIjZmZmZmZmIiBzdG9wLW9wYWNpdHk9IjAiLz4KICAgIDwvcmFkaWFsR3JhZGllbnQ+CiAgICA8cmFkaWFsR3JhZGllbnQgaWQ9Imdsb3cyIiBjeD0iNTAlIiBjeT0iNTAlIiByPSI1MCUiPgogICAgICA8c3RvcCBvZmZzZXQ9IjAlIiBzdG9wLWNvbG9yPSIjZmZmZmZmIiBzdG9wLW9wYWNpdHk9IjAuNyIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiNmZmZmZmYiIHN0b3Atb3BhY2l0eT0iMCIvPgogICAgPC9yYWRpYWxHcmFkaWVudD4KICA8L2RlZnM+CiAgPHJlY3Qgd2lkdGg9IjEyMDAiIGhlaWdodD0iNDAwIiBmaWxsPSJ1cmwoI2JnKSIvPgogIDxjaXJjbGUgY3g9IjE2MCIgY3k9IjMyMCIgcj0iMTkwIiBmaWxsPSJ1cmwoI2dsb3cxKSIvPgogIDxjaXJjbGUgY3g9IjEwNDAiIGN5PSI3MCIgcj0iMjEwIiBmaWxsPSJ1cmwoI2dsb3cyKSIvPgogIDxlbGxpcHNlIGN4PSI2MDAiIGN5PSIyMDUiIHJ4PSIyODAiIHJ5PSI5NSIgZmlsbD0iI2RkZTFlNiIgb3BhY2l0eT0iMC40NSIvPgogIDxjaXJjbGUgY3g9IjQxMCIgY3k9IjE1MCIgcj0iNjYiIGZpbGw9IiNkM2Q4ZGUiIG9wYWNpdHk9IjAuNCIvPgogIDxjaXJjbGUgY3g9Ijc5MCIgY3k9IjI1NSIgcj0iODYiIGZpbGw9IiNkM2Q4ZGUiIG9wYWNpdHk9IjAuMzIiLz4KICA8cmVjdCB4PSI0OTUiIHk9IjE2OCIgd2lkdGg9IjIxMCIgaGVpZ2h0PSI3NCIgcng9IjM3IiBmaWxsPSIjZmZmZmZmIiBvcGFjaXR5PSIwLjU1Ii8+CiAgPGNpcmNsZSBjeD0iMjMwIiBjeT0iMTMwIiByPSI4IiBmaWxsPSIjYzdjZGQ1IiBvcGFjaXR5PSIwLjUiLz4KICA8Y2lyY2xlIGN4PSI5NjAiIGN5PSIzMDAiIHI9IjEwIiBmaWxsPSIjYzdjZGQ1IiBvcGFjaXR5PSIwLjUiLz4KICA8Y2lyY2xlIGN4PSI4ODAiIGN5PSIxMjAiIHI9IjUiIGZpbGw9IiNjN2NkZDUiIG9wYWNpdHk9IjAuNCIvPgo8L3N2Zz4K';

const DEFAULT_COMBO_CONFIG = {
  show_tab_all: true,
  show_nav_arrows: true,
  enable_touch_swipe: true,
  swipe_sensitivity: 5,
  show_scrollbar: false,
  arrow_color: '#ffffff',
  arrow_bg_color: '#000000',
  arrow_size: 40,
  arrow_border_radius: 50,
  arrow_opacity: 0.9,
  arrow_position: 'inside',
  scrollbar_color: '#dddddd',
  scrollbar_thickness: 4,
  layout: 'layout1', // default layout
  product_add_btn_text: 'Add',
  product_add_btn_color: '#000',
  product_add_btn_text_color: '#fff',
  product_add_btn_font_size: 14,
  product_add_btn_font_weight: 600,
  has_discount_offer: false,
  selected_discount_id: null,
  buy_btn_text: 'Buy Now',
  buy_btn_color: '#000',
  buy_btn_text_color: '#fff',
  buy_btn_font_size: 14,
  buy_btn_font_weight: 600,
  add_to_cart_btn_text: 'Add to Cart',
  add_to_cart_btn_color: '#fff',
  add_to_cart_btn_text_color: '#000',
  add_to_cart_btn_font_size: 14,
  add_to_cart_btn_font_weight: 600,
  show_add_to_cart_btn: true,
  show_buy_btn: true,
  // New UI Settings
  show_progress_bar: true,
  enable_product_hover: false,
  product_hover_mode: 'second_image',
  progress_bar_color: '#000000',
  selection_highlight_color: '#000000',
  show_selection_tick: true,
  preview_icon_visibility: 'static', // hover, static
  preview_modal_content_gap: 10,
  preview_modal_gallery_ratio: 1.45,
  preview_modal_info_ratio: 0.85,
  preview_modal_gallery_columns: 2,
  preview_modal_show_arrows: true,
  product_card_variants_display: 'static', // hover, static, popup
  // Variant select dropdown styling defaults
  variant_select_bg: '#f9f9f9',
  variant_select_border_color: '#e0e0e0',
  variant_select_text_color: '#333333',
  variant_select_border_radius: 8,
  variant_select_font_size: 13,
  variant_select_padding_vertical: 9,
  variant_select_padding_horizontal: 12,
  variant_select_margin_top: 10,
  variant_select_margin_bottom: 12,
  variant_select_placeholder: '— Select a variant —',
  show_quantity_selector: true,
  show_sold_out_products: false,
  show_sticky_preview_bar: false,
  grid_layout_type: 'grid', // grid, slider
  // Progress bar defaults
  desktop_columns: '3', // 3 columns by default for desktop
  mobile_columns: '2', // 2 columns by default for mobile
  // Container Spacing
  container_padding_top_desktop: 24,
  container_padding_top_mobile: 16,
  container_padding_right_desktop: 24,
  container_padding_right_mobile: 12,
  container_padding_bottom_desktop: 80,
  container_padding_bottom_mobile: 80,
  container_padding_left_desktop: 24,
  container_padding_left_mobile: 12,

  // Grid/Layout Spacing
  products_gap: 16,
  products_gap_mobile: 10,

  // Title Container Spacing
  title_container_padding_top: 0,
  title_container_padding_top_mobile: 0,
  title_container_padding_bottom: 0,
  title_container_padding_bottom_mobile: 0,
  title_container_margin_top: 0,
  title_container_margin_top_mobile: 0,
  title_container_margin_bottom: 12,
  title_container_margin_bottom_mobile: 8,

  // Description Container Spacing
  description_container_padding_top: 0,
  description_container_padding_top_mobile: 0,
  description_container_padding_bottom: 0,
  description_container_padding_bottom_mobile: 0,
  description_container_margin_top: 0,
  description_container_margin_top_mobile: 0,
  description_container_margin_bottom: 20,
  description_container_margin_bottom_mobile: 16,
  show_banner: true, // show banner by default
  banner_image_url: '',
  banner_image_mobile_url: '',
  banner_width_desktop: 100,
  banner_width_mobile: 100,
  banner_height_desktop: 180, // default desktop banner height for preview
  banner_height_mobile: 120, // default mobile banner height for preview
  preview_bg_color: '#ffffff', // white default
  preview_text_color: '#222', // dark text default
  preview_item_border_color: '#e1e3e5',
  preview_height: 70,
  bg_color: '#ffffff',
  text_color: '#1a1a1a',
  discount_percentage: 10,
  ai_mode: false,
  preview_font_size: 16,
  preview_font_weight: 600,
  preview_align_items: 'center',
  preview_alignment: 'center',
  preview_alignment_mobile: 'center',
  preview_item_shape: 'rectangle',
  preview_item_size: 56,
  preview_item_padding: 12,
  preview_item_padding_top: 10,
  preview_bar_full_width: true,
  preview_bar_padding_top: 16,
  preview_item_color: '#000',
  max_selections: 1,
  max_products: 5,
  preview_bar_padding_bottom: 16,
  show_preview_bar: true,
  // New Button Customization Defaults
  add_btn_text: 'Add',
  add_btn_bg: '#000000',
  add_btn_text_color: '#ffffff',
  add_btn_font_size: 14,
  add_btn_font_weight: 600,
  add_btn_border_radius: 8,
  checkout_btn_text: 'Proceed to Checkout',
  checkout_btn_bg: '#000000', // for layout/main
  checkout_btn_text_color: '#ffffff', // for layout/main
  preview_bar_button_bg: '#ffffff', // for design 4 preview
  preview_bar_button_text: '#000000', // for design 4 preview
  // New Price Styling Defaults
  original_price_size: 14,
  discounted_price_size: 18,
  // New Layout Width Defaults
  container_width: 1200,
  title_width: 100,
  banner_width: 100,
  grid_width: 100,
  tabs_width: 100,
  progress_bar_width: 100,

  // Inline (default) preview bar settings
  preview_bar_width: 100,
  preview_bar_bg: '#fff',
  preview_bar_text_color: '#222',
  preview_bar_height: 70,
  preview_bar_text: 'Checkout',
  preview_bar_padding: 16,
  preview_checkout_btn_text: 'Proceed to Checkout',
  preview_checkout_btn_bg: '#000000',
  preview_checkout_btn_text_color: '#ffffff',
  preview_reset_btn_text: 'Reset Combo',
  preview_reset_btn_bg: '#ff4d4d',
  preview_reset_btn_text_color: '#ffffff',
  preview_original_price_color: '#999',
  preview_discount_price_color: '#000',
  // Sticky preview bar settings
  sticky_preview_bar_full_width: true,
  sticky_preview_bar_width: '100%',
  sticky_preview_bar_bg: '#fff',
  sticky_preview_bar_text_color: '#222',
  sticky_preview_bar_height: 70,
  sticky_preview_bar_text: 'Checkout',
  sticky_preview_bar_padding: 16,
  sticky_checkout_btn_text: 'Checkout',
  sticky_checkout_btn_bg: '#000000',
  sticky_checkout_btn_text_color: '#ffffff',
  show_products_grid: true, // show product grid by default
  product_image_ratio: 'square',
  product_image_height_desktop: 250, // revert to 250 as per liquid default
  product_image_height_mobile: 200, // revert to 200
  // Title & Description defaults
  show_title_description: true,
  collection_title: 'Create Your Combo',
  collection_description: 'Select items to build your perfect combo.',
  heading_align: 'left',
  heading_size: 32,
  heading_color: '#333333',
  heading_font_weight: '700',
  description_align: 'left',
  description_size: 16,
  description_color: '#666666',
  description_font_weight: '400', // Normal by default for descriptions
  title_container_padding_top: 0,
  title_container_padding_right: 0,
  title_container_padding_bottom: 0,
  title_container_padding_left: 0,
  title_container_margin_top: 0,
  title_container_margin_right: 0,
  title_container_margin_bottom: 0,
  title_container_margin_left: 0,
  description_container_padding_top: 0,
  description_container_padding_right: 0,
  description_container_padding_bottom: 0,
  description_container_padding_left: 0,
  description_container_margin_top: 0,
  description_container_margin_right: 0,
  description_container_margin_bottom: 0,
  description_container_margin_left: 0,
  limit_reached_message: 'Limit reached! You can only select {{limit}} items.',
  tab_all_label: 'Collections',
  // Show the "All/Collections" tab by default so Combo Design Two
  // has a visible and working collections tab in the preview layout.
  show_tab_all: true,
  tab_count: 1,
  progress_text: '',
  discount_threshold: 5,
  // Product Card Typography
  product_title_size_desktop: 16,
  product_title_size_mobile: 14,
  product_price_size_desktop: 16,
  product_price_size_mobile: 14,
  product_card_padding: 10,
  products_gap: 12,
  // Layout 3 defaults
  primary_color: '#000000',
  hero_image_url: '',
  hero_title: 'Mega Breakfast Bundle',
  hero_subtitle: 'Milk, Bread, Eggs, Cereal & Juice',
  hero_price: '$14.99',
  hero_compare_price: '$24.50',
  hero_btn_text: 'Add to Cart - Save 38%',
  show_hero: true,
  timer_hours: 2,
  timer_minutes: 45,
  timer_seconds: 12,
  banner_fit_mode: 'cover', // cover, contain, adapt
  // Responsive Typography Overrides
  heading_size_mobile: 22,
  description_size_mobile: 13,
  heading_align_mobile: 'left',
  description_align_mobile: 'left',
  product_title_size_desktop: 16,
  product_title_size_mobile: 14,
  product_price_size_desktop: 16,
  product_price_size_mobile: 14,
  // Responsive Spacing Overrides
  products_gap_desktop: 16,
  products_gap_mobile: 10,
  tab_font_size_mobile: 12,
  tab_padding_vertical_mobile: 8,
  tab_padding_horizontal_mobile: 14,
  tab_margin_top_mobile: 0,
  tab_margin_bottom_mobile: 16,
  add_btn_font_size_mobile: 12,
  checkout_btn_font_size_mobile: 13,
  banner_full_width: false,
  // Banner Slider Settings
  enable_banner_slider: true,
  slider_speed: 5,
  banner_1_image: SAMPLE_BANNER_IMAGE,
  banner_1_title: 'Fresh Farm Produce',
  banner_1_subtitle: 'Get 20% off on all organic items',
  banner_2_image: SAMPLE_BANNER_IMAGE,
  banner_2_title: 'Seasonal Fruits',
  banner_2_subtitle: 'Picked fresh from the orchard',
  banner_3_image: SAMPLE_BANNER_IMAGE,
  banner_3_title: 'Green Wellness',
  banner_3_subtitle: 'Healthy greens for a healthy life',
  // Advanced Timer & Bundle Settings
  auto_reset_timer: true,
  change_bundle_on_timer_end: true,
  bundle_titles: 'Mega Breakfast,Healthy Lunch,Organic Dinner',
  bundle_subtitles:
    'Start your day right,Stay energized all day,Clean eating for tonight',
  discount_motivation_text:
    'Add {{remaining}} more items to unlock the discount!',
  discount_unlocked_text: 'Discount Unlocked!',
  // Collection Tabs Premium Styling
  tab_alignment: 'left',
  tab_navigation_mode: 'scroll',
  tab_font_size: 14,
  tab_padding_vertical: 12,
  tab_padding_horizontal: 28,
  tab_margin_top: 0,
  tab_margin_bottom: 24,
  tab_bg_color: '#f5f5ee',
  tab_text_color: '#555555',
  tab_active_bg_color: '#000000',
  tab_active_text_color: '#ffffff',
  tab_border_radius: 30,
  enable_product_hover: false,
  product_hover_mode: 'second_image', // description, second_image
};

const DESKTOP_PREVIEW_BASE_WIDTH = 1280;
const DESKTOP_PREVIEW_BASE_HEIGHT = 864;
const MOBILE_PREVIEW_BASE_WIDTH = 390;
const MOBILE_PREVIEW_BASE_HEIGHT = 844;

// Maps Shopify block names → internal layout keys
const LAYOUT_MAP = {
  combo_design_one: 'layout1',
  combo_design_two: 'layout2',
  combo_design_three: 'layout3',
  combo_design_four: 'layout4',
  combo_main: 'layout1',
  custom_bundle_layout: 'layout1',
};

// Template catalogue shown in the picker screen
const TEMPLATE_CATALOGUE = [
  {
    id: 'combo_main',
    title: 'The Guided Architect',
    description:
      'Customers build their combo step by step — each step locked to one collection.',
    img: '/FMCG.png',
    fallbackImg: '/FMCG.png',
    badge: 'Step-by-Step',
    badgeTone: 'success',
    blockName: 'combo_main',
    howItWorks:
      'Step 1 → Step 2 → Step 3. Each step shows one collection. A progress bar tracks picks and auto-unlocks your discount at the set threshold.',
    features: [
      'Locked steps — one collection per step',
      'Live progress bar with discount trigger',
      'Tiered discount auto-unlocks as cart fills',
      'Sticky checkout summary at the bottom',
    ],
    bestFor: 'FMCG kits, meal combos, multi-category sets',
    differentiators: [
      'Only layout with enforced step order',
      'Built-in progress-bar discount engine',
    ],
  },
  {
    id: 'combo_design_two',
    title: 'The Velocity Stream',
    description:
      'Products from multiple collections under switchable tabs — no fixed step order.',
    img: '/velocity.png',
    fallbackImg: '/velocity.png',
    badge: 'Tab Switcher',
    badgeTone: 'success',
    blockName: 'combo_design_two',
    howItWorks:
      'Collections appear as tabs at the top. Click a tab to load its products below. Customers browse freely across tabs in any order.',
    features: [
      'Up to 8 switchable collection tabs',
      'No enforced order — free selection',
      'Swipeable tab strip on mobile',
      'Shared cart counter across all tabs',
    ],
    bestFor: 'Fashion, accessories, multi-category catalogues',
    differentiators: [
      'Tab-based — no locked sequence',
      'No progress bar — full browsing freedom',
    ],
  },
  {
    id: 'combo_design_four',
    title: 'The Editorial Split',
    description:
      'One collection, one hero banner, one grid — no tabs, no steps.',
    img: '/Editorial.png',
    fallbackImg: '/Editorial.png',
    badge: 'Simple Grid',
    badgeTone: 'success',
    blockName: 'combo_design_four',
    howItWorks:
      'Assign one collection. All products appear in a grid below a hero banner. Customers add directly — nothing else to configure.',
    features: [
      'Hero banner with image & text overlay',
      'Full collection in one clean grid',
      'Simplest flow — no steps or tabs',
      'Dark-mode ready colour scheme',
    ],
    bestFor: 'Gift sets, capsule collections, single-category combos',
    differentiators: [
      'No steps or tabs — one collection only',
      'Hero image is the centrepiece',
    ],
  },
];

export default function Customize() {
  const shopify = useAppBridge();
  const {
    activeDiscounts = [],
    initialTemplate = null,
    existingTemplates = [],
    layoutFiles = [],
    collections: initialCollections = [],
    initialProducts: loaderProducts = [],
    shop,
  } = useLoaderData();

  // Background resource fetching for speed
  const resourceFetcher = useFetcher();
  const [collections, setCollections] = useState(initialCollections);
  // Seed products immediately from the server-side loader response
  const [products, setProducts] = useState(loaderProducts);
  const [shopPages, setShopPages] = useState([]);
  const [resourcesLoading, setResourcesLoading] = useState(
    !(initialCollections && initialCollections.length > 0)
  );

  useEffect(() => {
    // Use the Remix authenticated fetcher — raw fetch() bypasses session auth
    resourceFetcher.load('?mode=resources');
  }, []);

  useEffect(() => {
    if (resourceFetcher.data) {
      const fetchedCollections = resourceFetcher.data.collections || [];
      const fetchedProducts = resourceFetcher.data.products || [];
      const fetchedPages = resourceFetcher.data.shopPages || [];
      console.log('[Customize] resourceFetcher data received:', {
        collectionsCount: fetchedCollections.length,
        productsCount: fetchedProducts.length,
        pagesCount: fetchedPages.length,
      });
      // Only overwrite state when the background fetch returns data.
      if (fetchedCollections.length > 0) setCollections(fetchedCollections);
      if (fetchedProducts.length > 0) {
        setProducts(fetchedProducts);
        setShopifyProducts(fetchedProducts);
      }
      if (fetchedPages.length > 0) setShopPages(fetchedPages);
      setResourcesLoading(false);
    }
  }, [resourceFetcher.data, resourceFetcher.state]);
  const discountFetcher = useFetcher();
  const saveFetcher = useFetcher();
  const lastSaveActionRef = useRef('save');
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (saveFetcher.data !== undefined) {
      console.log(
        '[Customize] Server response from /api/bundle-templates:',
        JSON.stringify(saveFetcher.data)
      );
    }
    if (saveFetcher.data?.success) {
      setSaveStatus('saved');
      shopify.toast.show(
        saveFetcher.data.message || 'Template saved successfully!'
      );

      // Don't navigate when just toggling active status
      if (lastSaveActionRef.current === 'toggle') {
        return;
      }

      navigate('/app/bundles/templates');
    } else if (saveFetcher.data?.error) {
      setSaveStatus('error');
      if (saveFetcher.data?.pageHandleConflict) {
        // Re-open the save modal, switch to existing page tab, show the error
        setPublishType('existing');
        setPageError(saveFetcher.data.error);
        setSaveModalOpen(true);
      } else {
        shopify.toast.show(`Failed to save: ${saveFetcher.data.error}`, {
          isError: true,
        });
      }
    }
  }, [saveFetcher.data, shopify, navigate]);

  const [config, setConfig] = useState(() => ({
    ...DEFAULT_COMBO_CONFIG,
    ...(initialTemplate?.config || {}),
  }));

  const [previewDevice, setPreviewDevice] = useState('desktop');
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState(
    initialTemplate?.title || 'Untitled Template'
  );
  const [saveStatus, setSaveStatus] = useState(initialTemplate?.id ? 'saved' : null);

  // Re-enable the "Save Template" button once the merchant changes anything
  // after a successful save — otherwise it stays disabled forever even
  // though there's new, unsaved work. Skips the very first mount so loading
  // an existing template doesn't immediately flip it to "unsaved".
  const skipDirtyEffectRef = useRef(true);
  useEffect(() => {
    if (skipDirtyEffectRef.current) { skipDirtyEffectRef.current = false; return; }
    setSaveStatus((prev) => (prev === 'saved' ? 'unsaved' : prev));
  }, [config, saveTitle]);
  const [publishToPage, setPublishToPage] = useState(true);
  const [targetPageTitle, setTargetPageTitle] = useState(
    initialTemplate?.page_url || 'About Us'
  );
  const [targetPageHandle, setTargetPageHandle] = useState(
    initialTemplate?.page_url || 'about-us'
  );
  const [publishType, setPublishType] = useState(
    initialTemplate?.page_id ? 'existing' : 'new'
  );
  const [selectedPageId, setSelectedPageId] = useState(
    initialTemplate?.page_id || ''
  );
  const [titleError, setTitleError] = useState('');
  const [pageError, setPageError] = useState('');
  const [isActive, setIsActive] = useState(initialTemplate?.active || false);
  const [initTemplateId, setInitTemplateId] = useState(initialTemplate?.id);

  useEffect(() => {
    if (initialTemplate) {
      if (initialTemplate.id !== initTemplateId) {
        setInitTemplateId(initialTemplate.id);
        setConfig((prev) => ({
          ...DEFAULT_COMBO_CONFIG,
          ...(initialTemplate.config || {}),
        }));
        setSaveTitle(initialTemplate.title || 'Untitled Template');
        setIsActive(initialTemplate.active || false);
        setPickedLayout(initialTemplate.config?.layout || 'layout1');
        // Reset any context-specific state if needed
        fetchedHandlesRef.current.clear();
      }
    } else {
      // Reset if we go back to "new" mode
      if (initTemplateId) {
        setInitTemplateId(undefined);
        setConfig(DEFAULT_COMBO_CONFIG);
        setSaveTitle('Untitled Template');
        setIsActive(false);
        setPickedLayout(null);
      }
    }
  }, [initialTemplate, initTemplateId]);

  useEffect(() => {
    // Auto-generate handle from template title only for NEW templates
    if (
      !initialTemplate &&
      saveTitle &&
      saveTitle !== 'Untitled Template' &&
      targetPageTitle === 'About Us'
    ) {
      const slug = saveTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      setTargetPageTitle(saveTitle);
      setTargetPageHandle(slug);
    }
  }, [initialTemplate, saveTitle, targetPageTitle]);

  const handleTitleChange = (value) => {
    setSaveTitle(value);
    if (titleError) setTitleError('');
  };
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [aiBundleOpen, setAiBundleOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBundleLoading, setAiBundleLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [formKey, setFormKey] = useState(0);
  const [activeCategory, setActiveCategory] = useState('layout'); // layout, style, advanced

  const handleBackNavigation = useCallback(() => {
    navigate('/app/bundles/templates', { replace: true });
  }, [navigate]);

  const handlePreview = useCallback(() => {
    if (initialTemplate?.id) {
      window.open(
        `/preview/${initialTemplate.id}?shop=${encodeURIComponent(shop)}`,
        '_blank'
      );
    }
  }, [initialTemplate?.id, shop]);

  const handleDuplicate = useCallback(() => {
    shopify.toast.show('Duplicate template is available after the first save.');
  }, [shopify]);

  const handleAiGenerate = useCallback(async () => {
    const prompt = aiPrompt.trim();
    if (!prompt) {
      setAiError('Please describe the bundle you want first.');
      return;
    }

    setAiError('');
    setAiBundleLoading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 600));
      shopify.toast.show('AI generation is available in the reference experience.');
      setAiBundleOpen(false);
      setAiPrompt('');
    } finally {
      setAiBundleLoading(false);
    }
  }, [aiPrompt, shopify]);

  const validationIssues = useMemo(() => {
    const issues = [];

    if (!String(saveTitle || '').trim()) {
      issues.push({
        title: 'Template needs a name',
        message: 'Add a clear template title before publishing.',
        section: 'general',
      });
    }

    if (config.layout === 'layout1') {
      const numSteps = Number(config.max_selections || 3);
      for (let i = 1; i <= numSteps; i++) {
        if (!config[`step_${i}_collection`]) {
          issues.push({
            title: `Step ${i} needs a collection`,
            message: 'Choose a collection for this step before saving.',
            section: 'general',
          });
        }
      }
    }

    if (config.layout === 'layout2') {
      const tabs = Number(config.tab_count || 4);
      const hasAnyTab = Array.from({ length: tabs }, (_, i) => config[`col_${i + 1}`]).some(Boolean);
      if (!hasAnyTab) {
        issues.push({
          title: 'Add at least one tab collection',
          message: 'The tab switcher needs a collection to render products.',
          section: 'general',
        });
      }
    }

    if (config.layout === 'layout3' && !config.collection_handle) {
      const cols = Number(config.col_count || 4);
      const hasAnyCol = Array.from({ length: cols }, (_, i) => config[`col_${i + 1}`]).some(Boolean);
      if (!hasAnyCol) {
        issues.push({
          title: 'Choose a collection for the editorial layout',
          message: 'This layout needs a base collection to display the grid.',
          section: 'general',
        });
      }
    }

    return issues;
  }, [config, saveTitle]);
  const canUndo = false;
  const canRedo = false;
  const [styleDevice, setStyleDevice] = useState('desktop'); // desktop, mobile, linked
  const [activeTab, setActiveTab] = useState('all');
  const [allStepProducts, setAllStepProducts] = useState({});
  const fetchedHandlesRef = useRef(new Set());
  const productFetcher = useFetcher();
  const previewProductFetcher = useFetcher();
  const previewFetchHandleRef = useRef('');
  const [productsLoading, setProductsLoading] = useState(false);
  const [stepProductsLoading, setStepProductsLoading] = useState(false);
  const [generatingTitle, setGeneratingTitle] = useState(false);
  const [generatingDescription, setGeneratingDescription] = useState(false);
  const [stepFieldAiLoading, setStepFieldAiLoading] = useState({});
  const [collectionAiLoading, setCollectionAiLoading] = useState({});
  const [aiSuggestionNonce, setAiSuggestionNonce] = useState(0);

  // Collapsible sections state
  const [expandedSections, setExpandedSections] = useState({
    general: true,
    banner: false,
    content: false,
    products: false,
    productCard: false,
    variants: false,
    previewBar: false,
    discount: false,
    progressBar: false,
    aiSettings: false,
    customCss: false,
    stickyCheckoutBtn: false,
    buttons: false,
  });

  const toggleSection = (sectionKey) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
  };

  // Sync state if initialTemplate changes (e.g. when navigating between templates)
  useEffect(() => {
    if (initialTemplate) {
      console.log('Loading template:', initialTemplate.title);
      setConfig({
        ...DEFAULT_COMBO_CONFIG,
        ...(initialTemplate.config || {}),
      });
      setSaveTitle(initialTemplate.title || 'Untitled Template');
      setIsActive(initialTemplate.active || false);
      setFormKey((prev) => prev + 1);
      // Restore page link settings so re-saving doesn't overwrite with wrong handle
      if (initialTemplate.page_url) {
        setTargetPageHandle(initialTemplate.page_url);
        setTargetPageTitle(initialTemplate.page_url);
        setPublishType('existing');
        setSelectedPageId(initialTemplate.page_id || '');
      } else {
        setTargetPageHandle('about-us');
        setTargetPageTitle('About Us');
        setPublishType('new');
        setSelectedPageId('');
      }
    } else {
      const templateId = searchParams.get('templateId');
      if (!templateId) {
        // Only reset to defaults if we aren't trying to load a template
        setConfig({ ...DEFAULT_COMBO_CONFIG });
        setSaveTitle('Untitled Template');
        setFormKey((prev) => prev + 1);
        setTargetPageHandle('about-us');
        setTargetPageTitle('About Us');
        setPublishType('new');
        setSelectedPageId('');
      }
    }
  }, [initialTemplate, searchParams]);

  const [selectedVariants, setSelectedVariants] = useState({});

  // Debug: Log collections data
  useEffect(() => {
    console.log('[Customize Frontend] Collections received:', collections);
    console.log(
      '[Customize Frontend] Collections count:',
      collections?.length || 0
    );
  }, [collections]);

  // shopifyProducts: seeded from server loader so preview is never blank.
  // Client-side fetch refreshes with collection-specific products when a handle is active.
  const [shopifyProducts, setShopifyProducts] = useState(loaderProducts);

  useEffect(() => {
    let handle = config.collection_handle || config.step_1_collection || '';

    if (config.layout === 'layout2') {
      if (activeTab !== 'all') {
        handle = activeTab;
      } else {
        handle =
          config.col_1 ||
          config.col_2 ||
          config.col_3 ||
          config.col_4 ||
          config.col_5 ||
          config.col_6 ||
          config.col_7 ||
          config.col_8 ||
          '';
      }
    }

    if (!handle) return;

    const url = `/api/products?handle=${encodeURIComponent(handle)}`;

    previewFetchHandleRef.current = handle;
    setProductsLoading(true);
    previewProductFetcher.load(url);
  }, [
    config.collection_handle,
    config.step_1_collection,
    config.layout,
    activeTab,
    config.col_1,
    config.col_2,
    config.col_3,
    config.col_4,
    config.col_5,
    config.col_6,
    config.col_7,
    config.col_8,
  ]);

  useEffect(() => {
    if (previewProductFetcher.state !== 'idle') return;
    if (previewProductFetcher.data === undefined) return;
    setProductsLoading(false);
    const data = previewProductFetcher.data;
    if (Array.isArray(data) && data.length > 0) {
      const handle = previewFetchHandleRef.current;
      const stamped = handle
        ? data.map((p) => ({
          ...p,
          collections: [{ handle, title: handle }],
        }))
        : data;
      setShopifyProducts(stamped);
      // Also update products so renderProductsGrid picks up the collection-specific products
      setProducts((prev) => {
        // Merge: keep any products not in this collection, add the newly fetched ones
        const existingIds = new Set(stamped.map((p) => p.id));
        const others = prev.filter((p) => !existingIds.has(p.id));
        return [...others, ...stamped];
      });
    }
  }, [previewProductFetcher.state, previewProductFetcher.data]);

  // Preview scaling logic with debouncing
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(600);

  useEffect(() => {
    let resizeTimeout = null;
    const updateWidth = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (containerRef.current) {
          setContainerWidth(containerRef.current.offsetWidth);
        }
      }, 150); // Debounce resize events
    };
    // Initial and listener
    window.addEventListener('resize', updateWidth);
    // Timeout to ensure layout is painted
    const timer = setTimeout(updateWidth, 100);
    return () => {
      window.removeEventListener('resize', updateWidth);
      clearTimeout(timer);
    };
  }, [previewDevice]);

  const previewBaseWidth =
    previewDevice === 'mobile'
      ? MOBILE_PREVIEW_BASE_WIDTH
      : DESKTOP_PREVIEW_BASE_WIDTH;
  const previewBaseHeight =
    previewDevice === 'mobile'
      ? MOBILE_PREVIEW_BASE_HEIGHT
      : DESKTOP_PREVIEW_BASE_HEIGHT;
  // Use zoom (not transform:scale) so layout dimensions follow the visual size —
  // this means the panel auto-sizes to content height with nothing clipped.
  const previewScale = Math.max(containerWidth, 1) / previewBaseWidth;
  const clampedScale = Math.min(Math.max(previewScale, 0.1), 1);
  const scaledCanvasStyle = {
    width: `${previewBaseWidth}px`,
    zoom: clampedScale,
    transformOrigin: 'top left',
  };
  // No fixed height — let the zoomed content determine panel height naturally.
  const scaledPanelStyle = {
    width: '100%',
    overflow: 'visible',
  };

  // Discount modal state
  const [createDiscountModalOpen, setCreateDiscountModalOpen] = useState(false);
  const [configureDiscountModalOpen, setConfigureDiscountModalOpen] =
    useState(false);
  const [selectedDiscountType, setSelectedDiscountType] = useState(
    'amount_off_products'
  );
  const [dTitle, setDTitle] = useState('');
  const [dCode, setDCode] = useState('');
  const [dType, setDType] = useState('amount_off_products');
  const [dValue, setDValue] = useState('');
  const [dStartsAt, setDStartsAt] = useState('');
  const [dEndsAt, setDEndsAt] = useState('');
  const [dOncePerCustomer, setDOncePerCustomer] = useState(false);
  // Discount Engine parity states
  const [dValueType, setDValueType] = useState('percentage');
  const [dHasEndDate, setDHasEndDate] = useState(false);
  const [dMinRequirementType, setDMinRequirementType] = useState('none');
  const [dMinRequirementValue, setDMinRequirementValue] = useState('');
  const [dLimitUsage, setDLimitUsage] = useState(false);
  const [dMaxUsageLimit, setDMaxUsageLimit] = useState('');
  const [dCombinations, setDCombinations] = useState({
    product: false,
    order: false,
    shipping: false,
  });
  const [dBuyQuantity, setDBuyQuantity] = useState('1');
  const [dGetQuantity, setDGetQuantity] = useState('1');
  const [dGetValueType, setDGetValueType] = useState('percentage');
  const [dGetValue, setDGetValue] = useState('100');
  const [dBuyTargetType, setDBuyTargetType] = useState('products');
  const [dBuyTargetIds, setDBuyTargetIds] = useState([]);
  const [dGetTargetType, setDGetTargetType] = useState('all');
  const [dGetTargetIds, setDGetTargetIds] = useState([]);
  // Amount off products: applies-to
  const [dAppliesTo, setDAppliesTo] = useState('all');
  const [dAppliesToIds, setDAppliesToIds] = useState([]);
  // Free shipping: countries
  const [dFreeShipAllCountries, setDFreeShipAllCountries] = useState(true);
  const [dFreeShipCountryCodes, setDFreeShipCountryCodes] = useState('');
  const [dErrors, setDErrors] = useState({});
  const [stepErrors, setStepErrors] = useState({});
  const [maxProductsError, setMaxProductsError] = useState('');
  const [localActiveDiscounts, setLocalActiveDiscounts] =
    useState(activeDiscounts);

  // Sync local discounts with loader data (fetched from API)
  useEffect(() => {
    setLocalActiveDiscounts(activeDiscounts);
  }, [activeDiscounts]);

  // Determine initial pickedLayout:
  //  - If editing an existing template, skip picker entirely
  //  - If a ?layout= param is present (legacy direct link), pre-pick it
  //  - Otherwise null → show picker
  const initPickedLayout = (() => {
    if (initialTemplate) return initialTemplate.config?.layout || 'layout1';
    const lp = searchParams.get('layout');
    if (lp) return LAYOUT_MAP[lp] || 'layout1';
    return null;
  })();

  const [pickedLayout, setPickedLayout] = useState(initPickedLayout);

  // Keep pickedLayout in sync when URL search params change
  useEffect(() => {
    const lp = searchParams.get('layout');
    if (lp) {
      const mapped = LAYOUT_MAP[lp] || 'layout1';
      setPickedLayout((prev) => (prev === mapped ? prev : mapped));
      setConfig((prev) => (prev.layout === mapped ? prev : { ...prev, layout: mapped }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Called when user explicitly selects a template from the picker
  const handlePickLayout = useCallback(
    (blockName) => {
      const mapped = LAYOUT_MAP[blockName] || 'layout1';
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set('layout', blockName);
      navigate(`/app/bundles/customize?${nextParams.toString()}`, { replace: true });
      setPickedLayout(mapped);
      setConfig((prev) => ({ ...prev, layout: mapped }));
    },
    [navigate, searchParams]
  );

  // Real-time product fetching for multi-step bundles (all step-based layouts)
  useEffect(() => {
    const numSteps = Number(config.max_selections || 3);
    const handles = [];
    for (let i = 1; i <= numSteps; i++) {
      const h = config[`step_${i}_collection`];
      if (h && h !== '' && !fetchedHandlesRef.current.has(h)) handles.push(h);
    }

    if (handles.length > 0 && productFetcher.state === 'idle') {
      handles.forEach((h) => fetchedHandlesRef.current.add(h));
      setStepProductsLoading(true);
      productFetcher.load(
        `/api/products?handles=${encodeURIComponent(handles.join(','))}`
      );
    }
  }, [config, productFetcher]);

  useEffect(() => {
    if (productFetcher.data) {
      setStepProductsLoading(false);
      if (!productFetcher.data.error && !Array.isArray(productFetcher.data)) {
        setAllStepProducts((prev) => ({ ...prev, ...productFetcher.data }));
      }
    }
  }, [productFetcher.data]);

  // Ensure activeTab is valid for Layout 2 if "All" is hidden
  useEffect(() => {
    if (
      config.layout === 'layout2' &&
      !config.show_tab_all &&
      activeTab === 'all'
    ) {
      const firstCol =
        config.col_1 ||
        config.col_2 ||
        config.col_3 ||
        config.col_4 ||
        config.col_5 ||
        config.col_6 ||
        config.col_7 ||
        config.col_8;
      if (firstCol) {
        setActiveTab(firstCol);
      }
    }
  }, [
    config.layout,
    config.show_tab_all,
    activeTab,
    config.col_1,
    config.col_2,
    config.col_3,
    config.col_4,
    config.col_5,
    config.col_6,
    config.col_7,
    config.col_8,
  ]);

  // Handle discount creation response
  useEffect(() => {
    if (discountFetcher.data) {
      if (discountFetcher.data.success) {
        shopify.toast.show('Discount created successfully on Shopify!');

        setLocalActiveDiscounts((prev) => {
          const fromServer = discountFetcher.data.discount;
          const shopifyId = fromServer?.shopifyId || '';
          const newDiscount = fromServer
            ? { id: shopifyId, title: fromServer.title, code: fromServer.code, type: fromServer.type, status: 'ACTIVE' }
            : { id: '', title: dTitle, code: dCode, type: dType, status: 'ACTIVE' };
          updateConfig('selected_discount_id', shopifyId);
          updateConfig('has_discount_offer', true);
          return [...prev, newDiscount];
        });

        // Reset form and close both modals
        setDTitle('');
        setDCode('');
        setDType('amount_off_products');
        setSelectedDiscountType('amount_off_products');
        setDValue('');
        setDStartsAt('');
        setDEndsAt('');
        setDOncePerCustomer(false);
        setDValueType('percentage');
        setDHasEndDate(false);
        setDMinRequirementType('none');
        setDMinRequirementValue('');
        setDLimitUsage(false);
        setDMaxUsageLimit('');
        setDCombinations({ product: false, order: false, shipping: false });
        setDBuyQuantity('1');
        setDGetQuantity('1');
        setDGetValueType('percentage');
        setDGetValue('100');
        setDBuyTargetType('products');
        setDBuyTargetIds([]);
        setDGetTargetType('all');
        setDGetTargetIds([]);
        setCreateDiscountModalOpen(false);
        setConfigureDiscountModalOpen(false);
      } else if (discountFetcher.data.error) {
        shopify.toast.show(discountFetcher.data.error, { isError: true });
      }
    }
    // Dependency MUST NOT include form fields, otherwise typing triggers this effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discountFetcher.data, shopify]);

  const updateConfig = useCallback((key, value) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }, []);

  const applyConfigPatch = useCallback((patch) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  }, []);

  const onlyOpen = useCallback((prev, key) => {
    return Object.keys(prev).reduce((acc, k) => { acc[k] = k === key; return acc; }, {});
  }, []);

  const SECTION_CATEGORY = {
    general: 'layout', banner: 'layout', products: 'layout',
    content: 'style', productCard: 'style', previewBar: 'style',
    buttons: 'style', variants: 'style', collectionTabsStyles: 'style',
    progressBar: 'advanced', discount: 'advanced', aiSettings: 'advanced', customCss: 'advanced',
  };

  const handleOpenSection = useCallback((sectionKey = 'general') => {
    const category = SECTION_CATEGORY[sectionKey] || 'layout';
    setActiveCategory(category);
    setExpandedSections((prev) => onlyOpen(prev, sectionKey));
    setTimeout(() => {
      const content = document.querySelector('.cst-sidebar-content');
      if (content) content.scrollTop = 0;
      const cards = document.querySelectorAll('.cst-section-card');
      const orderMap = { layout: ['general','banner','products','content'], style: ['content','productCard','collectionTabsStyles','previewBar','variants','buttons'], advanced: ['progressBar','discount','aiSettings','customCss'] };
      const idx = (orderMap[category] || []).indexOf(sectionKey);
      const target = cards[Math.max(0, idx)];
      if (target) {
        target.classList.remove('cst-flash');
        void target.offsetWidth;
        target.classList.add('cst-flash');
        target.addEventListener('animationend', () => target.classList.remove('cst-flash'), { once: true });
      }
    }, 60);
  }, [setActiveCategory, onlyOpen]);

  const generateAiSuggestion = useCallback(
    async (requestedTarget) => {
      const currentTitle = String(config.collection_title || '').trim();
      const currentDescription = String(
        config.collection_description || ''
      ).trim();
      const bothEmpty = !currentTitle && !currentDescription;
      const effectiveTarget = bothEmpty ? 'both' : requestedTarget;
      const nonce = `${Date.now()}-${aiSuggestionNonce}`;

      setAiSuggestionNonce((prev) => prev + 1);

      if (effectiveTarget === 'both') {
        setGeneratingTitle(true);
        setGeneratingDescription(true);
      } else if (requestedTarget === 'title') {
        setGeneratingTitle(true);
      } else {
        setGeneratingDescription(true);
      }

      try {
        const res = await fetch('/api/suggestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target: effectiveTarget,
            currentTitle,
            currentDescription,
            nonce,
            context: {
              layout: config.layout,
              templateTitle: saveTitle,
              collectionHandle:
                config.collection_handle || config.step_1_collection,
              selectedCollections: [
                config.collection_handle,
                config.step_1_collection,
                config.step_2_collection,
                config.step_3_collection,
                config.step_4_collection,
                config.col_1,
                config.col_2,
                config.col_3,
                config.col_4,
                config.col_5,
                config.col_6,
                config.col_7,
                config.col_8,
              ].filter(Boolean),
            },
          }),
        });

        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload?.success) {
          throw new Error(
            payload?.error || 'Unable to generate AI suggestion right now.'
          );
        }

        if (payload?.data?.title) {
          updateConfig('collection_title', payload.data.title);
        }
        if (payload?.data?.description) {
          updateConfig('collection_description', payload.data.description);
        }

        const message =
          effectiveTarget === 'both'
            ? 'AI Sparkle updated title and description.'
            : requestedTarget === 'title'
              ? 'AI Sparkle updated collection title.'
              : 'AI Sparkle updated collection description.';
        shopify.toast.show(message);
      } catch (error) {
        shopify.toast.show(
          error.message || 'AI suggestion failed. Please try again.',
          {
            isError: true,
          }
        );
      } finally {
        setGeneratingTitle(false);
        setGeneratingDescription(false);
      }
    },
    [aiSuggestionNonce, config, saveTitle, shopify, updateConfig]
  );

  const generateStepFieldSuggestion = useCallback(
    async (step, field) => {
      const loadingKey = `${step}_${field}`;
      const collectionHandle = config[`step_${step}_collection`] || '';
      const collectionTitle =
        collections.find((col) => col.handle === collectionHandle)?.title || '';
      const nonce = `${Date.now()}-${aiSuggestionNonce}`;

      setAiSuggestionNonce((prev) => prev + 1);
      setStepFieldAiLoading((prev) => ({ ...prev, [loadingKey]: true }));

      try {
        const res = await fetch('/api/suggestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target: 'steps',
            requestedField: field,
            steps: [
              {
                step,
                collectionHandle,
                collectionTitle,
                currentTitle: config[`step_${step}_title`] || '',
                currentSubtitle: config[`step_${step}_subtitle`] || '',
              },
            ],
            nonce,
            context: {
              layout: config.layout,
              templateTitle: saveTitle,
              selectedCollections: [collectionHandle].filter(Boolean),
            },
          }),
        });

        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload?.success) {
          throw new Error(
            payload?.providerMessage ||
            payload?.error ||
            'Unable to generate AI suggestion right now.'
          );
        }

        const stepData = Array.isArray(payload?.data?.steps)
          ? payload.data.steps.find((item) => Number(item?.step) === step)
          : null;

        if (!stepData) {
          throw new Error('No AI suggestion returned for this step.');
        }

        if (field === 'title' && stepData.title) {
          updateConfig(`step_${step}_title`, stepData.title);
          shopify.toast.show(
            `AI Sparkle updated title for Collection ${step}.`
          );
          return;
        }

        if (field === 'subtitle' && stepData.subtitle) {
          updateConfig(`step_${step}_subtitle`, stepData.subtitle);
          shopify.toast.show(
            `AI Sparkle updated subtitle for Collection ${step}.`
          );
          return;
        }

        throw new Error('AI response did not include the requested field.');
      } catch (error) {
        shopify.toast.show(error.message || 'AI suggestion failed.', {
          isError: true,
        });
      } finally {
        setStepFieldAiLoading((prev) => ({ ...prev, [loadingKey]: false }));
      }
    },
    [aiSuggestionNonce, collections, config, saveTitle, shopify, updateConfig]
  );

  const suggestNextCollection = useCallback(
    async (step) => {
      setCollectionAiLoading((prev) => ({ ...prev, [step]: true }));
      try {
        const numSteps = Number(config.num_steps) || 3;
        const selectedHandles = Array.from(
          { length: numSteps },
          (_, i) => i + 1
        )
          .filter((s) => s !== step)
          .map((s) => config[`step_${s}_collection`])
          .filter(Boolean);

        const res = await fetch('/api/suggestions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target: 'collection_suggest',
            availableCollections: (collections || []).map((c) => ({
              handle: c.handle,
              title: c.title,
            })),
            selectedHandles,
            templateTitle: saveTitle,
            layout: config.layout,
          }),
        });

        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload?.success) {
          throw new Error(
            payload?.error || 'Unable to suggest a collection right now.'
          );
        }

        const suggestedHandle = payload?.data?.handle;
        const suggestedTitle = payload?.data?.title;
        if (!suggestedHandle) {
          throw new Error('AI did not return a collection suggestion.');
        }

        updateConfig(`step_${step}_collection`, suggestedHandle);
        shopify.toast.show(
          `AI suggested "${suggestedTitle || suggestedHandle}" for step ${step}.`
        );
      } catch (error) {
        shopify.toast.show(error.message || 'AI suggestion failed.', {
          isError: true,
        });
      } finally {
        setCollectionAiLoading((prev) => ({ ...prev, [step]: false }));
      }
    },
    [collections, config, saveTitle, shopify, updateConfig]
  );

  const getStyleKey = useCallback(
    (baseKey) => {
      if (styleDevice === 'mobile') {
        const mobileKey = `${baseKey}_mobile`;
        // We check if the mobile version is specifically defined in our config,
        // though typically we'll just bind to it directly.
        return mobileKey;
      }
      return baseKey;
    },
    [styleDevice]
  );

  const updateBoth = useCallback((keyA, keyB, value) => {
    setConfig((prev) => ({ ...prev, [keyA]: value, [keyB]: value }));
  }, []);

  const confirmSaveTemplate = async () => {
    const templateTitle = (saveTitle || '').trim();

    if (!templateTitle) {
      setTitleError('Please enter a template title');
      return;
    }

    // Check for duplicate title
    const isDuplicate = existingTemplates.some((t) => {
      if (initialTemplate && String(t.id) === String(initialTemplate.id))
        return false;
      return t.title.toLowerCase() === templateTitle.toLowerCase();
    });

    if (isDuplicate) {
      setTitleError('This name is already used. Please choose a new name.');
      return;
    }

    if (publishToPage) {
      if (publishType === 'new' && !targetPageTitle.trim()) {
        setPageError('Page title is required');
        return;
      }
      if (publishType === 'existing' && !selectedPageId) {
        setPageError('Please select a page');
        return;
      }
    }
    setPageError('');

    if (config.layout === 'layout1') {
      const numSteps = Number(config.max_selections || 3);
      const newStepErrors = {};
      for (let i = 1; i <= numSteps; i++) {
        if (!config[`step_${i}_collection`]) {
          newStepErrors[`step_${i}_collection`] = 'Please select a collection';
        }
      }
      if (Object.keys(newStepErrors).length > 0) {
        setStepErrors(newStepErrors);
        setExpandedSections((prev) => ({ ...prev, general: true }));
        setSaveModalOpen(false);
        shopify.toast.show('Please select a collection for each step', {
          isError: true,
        });
        return;
      }
    }
    setStepErrors({});

    // Close modal immediately
    setSaveModalOpen(false);
    shopify.toast.show(`Saving "${saveTitle}"...`);

    const isEditing = !!initialTemplate;
    const sanitizedHandle = targetPageHandle
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const normalizedConfig = {
      ...config,
      preview_modal_content_gap:
        Number(config.preview_modal_content_gap ?? 10) || 10,
      preview_modal_gallery_ratio:
        Number(config.preview_modal_gallery_ratio ?? 1.45) || 1.45,
      preview_modal_info_ratio:
        Number(config.preview_modal_info_ratio ?? 0.85) || 0.85,
      preview_modal_gallery_columns:
        Math.max(1, Number(config.preview_modal_gallery_columns ?? 2)) || 2,
      preview_modal_show_arrows: config.preview_modal_show_arrows !== false,
    };

    const body = {
      shop_domain: shop,
      id: isEditing ? initialTemplate.id : undefined,
      name: saveTitle,
      template_type: config.layout || 'grid',
      status: 'active',
      is_active: isActive ? 1 : 0,
      customization_data: JSON.stringify(normalizedConfig),
      publishParams: publishToPage
        ? {
          pageInfo: {
            title: targetPageTitle.trim(),
            handle: sanitizedHandle,
            publishType: publishType,
            selectedPageId: selectedPageId,
          },
        }
        : null,
    };

    console.log(
      '[Customize] Submitting to /api/bundle-templates:',
      JSON.stringify({
        id: body.id,
        name: body.name,
        hasPublish: !!body.publishParams,
      })
    );

    const formData = new FormData();
    formData.append('body', JSON.stringify(body));

    lastSaveActionRef.current = 'save';
    saveFetcher.submit(formData, {
      method: 'POST',
      action: '/api/bundle-templates',
    });
  };

  const handleToggleActive = () => {
    if (!initialTemplate) {
      shopify.toast.show('Please save your template first before activating.', {
        isError: true,
      });
      return;
    }

    const newActiveState = !isActive;
    setIsActive(newActiveState);

    const body = {
      shop_domain: shop,
      id: initialTemplate.id,
      name: saveTitle,
      template_type: config.layout || 'grid',
      status: 'active',
      is_active: newActiveState ? 1 : 0,
      customization_data: JSON.stringify(config),
    };

    const formData = new FormData();
    formData.append('body', JSON.stringify(body));

    lastSaveActionRef.current = 'toggle';
    saveFetcher.submit(formData, {
      method: 'POST',
      action: '/api/bundle-templates',
    });
  };

  const layoutLabel = useMemo(() => {
    switch (config.layout) {
      case 'layout2':
        return 'Velocity Stream';
      case 'layout3':
      case 'layout4':
        return 'Editorial Split';
      case 'layout1':
      default:
        return 'Guided Architect';
    }
  }, [config.layout]);

  const discountTypeOptions = [
    {
      value: 'amount_off_products',
      title: 'Amount off products',
      description: 'Discount specific products or collections of products',
    },
    {
      value: 'amount_off_order',
      title: 'Amount off order',
      description: 'Discount the total order amount',
    },
    {
      value: 'free_shipping',
      title: 'Free shipping',
      description: 'Offer free shipping on qualifying orders',
    },
    {
      value: 'buy_x_get_y',
      title: 'Buy X get Y',
      description: 'Customers get a discount after buying a quantity',
    },
  ];

  const bxgyProductOptions = useMemo(
    () =>
      products.map((p) => ({
        label: p.title,
        value: p.id,
      })),
    [products]
  );

  const bxgyCollectionOptions = useMemo(
    () =>
      collections.map((c) => ({
        label: c.title,
        value: c.id,
      })),
    [collections]
  );

  const resetDiscountForm = useCallback(() => {
    setDTitle('');
    setDCode('');
    setDType('amount_off_products');
    setSelectedDiscountType('amount_off_products');
    setDValue('');
    setDValueType('percentage');
    setDStartsAt('');
    setDEndsAt('');
    setDHasEndDate(false);
    setDOncePerCustomer(false);
    setDMinRequirementType('none');
    setDMinRequirementValue('');
    setDLimitUsage(false);
    setDMaxUsageLimit('');
    setDCombinations({ product: false, order: false, shipping: false });
    setDBuyQuantity('1');
    setDGetQuantity('1');
    setDGetValueType('percentage');
    setDGetValue('100');
    setDBuyTargetType('products');
    setDBuyTargetIds([]);
    setDGetTargetType('all');
    setDGetTargetIds([]);
    setDAppliesTo('all');
    setDAppliesToIds([]);
    setDFreeShipAllCountries(true);
    setDFreeShipCountryCodes('');
    setDErrors({});
  }, []);

  const openDiscountConfiguration = (type) => {
    setSelectedDiscountType(type);
    setDType(type);
    setCreateDiscountModalOpen(false);
    setTimeout(() => setConfigureDiscountModalOpen(true), 0);
  };

  const handleCreateDiscount = () => {
    const errors = {};

    if (!dTitle.trim()) errors.title = 'Title is required';

    if (selectedDiscountType !== 'free_shipping') {
      if (!dValue && selectedDiscountType !== 'buy_x_get_y') {
        errors.value = 'Value is required';
      } else if (selectedDiscountType !== 'buy_x_get_y') {
        const num = Number(dValue);
        if (isNaN(num) || num <= 0) {
          errors.value = 'Value must be greater than 0';
        } else if (dValueType === 'percentage' && num > 100) {
          errors.value = 'Percentage cannot exceed 100';
        }
      }
    }

    if (selectedDiscountType === 'buy_x_get_y') {
      const buyQty = parseInt(dBuyQuantity, 10);
      const getQty = parseInt(dGetQuantity, 10);
      const getVal = Number(dGetValue);

      if (isNaN(buyQty) || buyQty <= 0) {
        errors.buyQuantity = 'Buy quantity must be greater than 0';
      }
      if (isNaN(getQty) || getQty <= 0) {
        errors.getQuantity = 'Get quantity must be greater than 0';
      }
      if (isNaN(getVal) || getVal <= 0) {
        errors.getValue = 'Get value must be greater than 0';
      } else if (dGetValueType === 'percentage' && getVal > 100) {
        errors.getValue = 'Percentage cannot exceed 100';
      }

      if (!dBuyTargetIds.length) {
        errors.buyTargets =
          dBuyTargetType === 'products'
            ? 'Select at least one buy product'
            : 'Select at least one buy collection';
      }
      if (dGetTargetType !== 'all' && !dGetTargetIds.length) {
        errors.getTargets =
          dGetTargetType === 'products'
            ? 'Select at least one get product'
            : 'Select at least one get collection';
      }
    }

    if (!dStartsAt) errors.startsAt = 'Start date is required';

    if (
      dHasEndDate &&
      dEndsAt &&
      dStartsAt &&
      new Date(dEndsAt) <= new Date(dStartsAt)
    ) {
      errors.endsAt = 'End date must be after start date';
    }

    if (
      dMinRequirementType === 'amount' &&
      (!dMinRequirementValue || parseFloat(dMinRequirementValue) <= 0)
    ) {
      errors.minRequirementValue = 'Please enter a minimum purchase amount';
    }
    if (
      dMinRequirementType === 'quantity' &&
      (!dMinRequirementValue || parseInt(dMinRequirementValue, 10) <= 0)
    ) {
      errors.minRequirementValue = 'Please enter a minimum quantity';
    }
    if (dLimitUsage && (!dMaxUsageLimit || parseInt(dMaxUsageLimit, 10) <= 0)) {
      errors.maxUsage = 'Please enter a valid usage limit';
    }

    if (Object.keys(errors).length > 0) {
      setDErrors(errors);
      return;
    }

    setDErrors({});
    const formData = new FormData();
    formData.append('title', dTitle.trim());
    formData.append('code', dCode || dTitle.toUpperCase().replace(/\s+/g, ''));
    formData.append('type', selectedDiscountType);
    formData.append(
      'value',
      selectedDiscountType === 'free_shipping'
        ? '0'
        : selectedDiscountType === 'buy_x_get_y'
          ? dGetValue
          : dValue
    );
    formData.append('valueType', dValueType);
    formData.append('startsAt', dStartsAt);
    formData.append('endsAt', dHasEndDate && dEndsAt ? dEndsAt : '');
    formData.append('oncePerCustomer', dOncePerCustomer ? 'on' : 'off');
    formData.append('minRequirementType', dMinRequirementType);
    formData.append('minRequirementValue', dMinRequirementValue || '');
    formData.append('maxUsage', dLimitUsage ? dMaxUsageLimit : '');
    formData.append('combinations', JSON.stringify(dCombinations));
    if (selectedDiscountType === 'buy_x_get_y') {
      formData.append('buyQuantity', dBuyQuantity);
      formData.append('getQuantity', dGetQuantity);
      formData.append('getValueType', dGetValueType);
      formData.append('getValue', dGetValue);
      formData.append('buyTargetType', dBuyTargetType);
      formData.append('buyTargetIds', JSON.stringify(dBuyTargetIds));
      formData.append('getTargetType', dGetTargetType);
      formData.append('getTargetIds', JSON.stringify(dGetTargetIds));
    }
    if (selectedDiscountType === 'amount_off_products') {
      formData.append('appliesTo', dAppliesTo);
      formData.append('appliesToIds', JSON.stringify(dAppliesToIds));
    }
    if (selectedDiscountType === 'free_shipping') {
      formData.append('freeShipAllCountries', dFreeShipAllCountries ? 'true' : 'false');
      formData.append('freeShipCountryCodes', dFreeShipCountryCodes);
    }

    discountFetcher.submit(formData, { method: 'post' });
  };

  const selectedDiscountTypeMeta =
    discountTypeOptions.find((opt) => opt.value === selectedDiscountType) ||
    discountTypeOptions[0];

  // ── Template picker gate ──────────────────────────────────────────────────
  if (!pickedLayout && !initialTemplate) {
    return (
      <Page
        fullWidth
        title="Customize Template"
        backAction={{
          content: 'Template Modules',
          onAction: () => navigate('/app/bundles', { replace: true }),
        }}
      >
        <BrixBar size="md" floating />
        <style>{`
.template-picker-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:24px;margin-bottom:120px;align-items:stretch}
.tpl-pick-card{border:1px solid #ebeef0;border-radius:16px;overflow:hidden;background:#fff;display:flex;flex-direction:column;transition:all .3s cubic-bezier(.25,.8,.25,1);box-shadow:0 4px 12px rgba(0,0,0,.03)}
.tpl-pick-card:hover{transform:translateY(-6px);box-shadow:0 12px 28px rgba(0,0,0,.08);border-color:#d2d5d8}
.tpl-pick-media{position:relative;border-bottom:1px solid #f0f2f4}
.tpl-pick-img{width:100%;height:320px;object-fit:contain;object-position:center;display:block;background:#f4f6fa}
.tpl-pick-badge{position:absolute;top:12px;right:12px;background:#e3f1df;color:#1a7f45;padding:4px 12px;border-radius:24px;font-size:12px;font-weight:600;letter-spacing:.3px;box-shadow:0 2px 8px rgba(0,0,0,.05)}
.tpl-pick-body{padding:16px;display:flex;flex-direction:column;gap:8px;flex-grow:1}
.tpl-pick-how{background:#f6f8fa;border:1px solid #e8eaed;border-radius:10px;padding:10px 12px}
.tpl-pick-how-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#6c737a;margin-bottom:6px}
.tpl-pick-how-text{font-size:13px;color:#374151;line-height:1.55}
.tpl-pick-features{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;flex-grow:1}
.tpl-pick-feature{display:flex;align-items:flex-start;gap:8px;font-size:13px;color:#374151}
.tpl-pick-check{color:#008060;font-weight:700;margin-top:1px}
.tpl-pick-bestfor{font-size:12.5px;color:#6b7280;line-height:1.4}
.tpl-pick-bestfor b{color:#111827;font-weight:700}
@media(max-width:1024px){.template-picker-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:768px){.template-picker-grid{grid-template-columns:1fr;gap:14px}}
        `}</style>
        <div style={{ padding: '12px 0 8px' }}>
          <Text variant="headingLg" as="h2">Choose a Template to Get Started</Text>
          <div style={{ marginTop: 8 }}>
            <Text variant="bodyMd" tone="subdued">
              Each layout is a completely different shopping experience. Read the descriptions carefully — they behave differently, not just look different.
            </Text>
          </div>
        </div>

        <div className="template-picker-grid">
          {TEMPLATE_CATALOGUE.map((tpl) => (
            <div key={tpl.id} className="tpl-pick-card">
              <div className="tpl-pick-media">
                <img
                  src={tpl.img}
                  alt={tpl.title}
                  className="tpl-pick-img"
                  onError={(e) => {
                    if (tpl.fallbackImg && e.currentTarget.src.indexOf(tpl.fallbackImg) === -1) {
                      e.currentTarget.src = tpl.fallbackImg;
                    }
                  }}
                />
                <div className="tpl-pick-badge">{tpl.badge}</div>
              </div>
              <div className="tpl-pick-body">
                <Text variant="headingMd" as="h3" fontWeight="bold">{tpl.title}</Text>
                <Text variant="bodySm" tone="subdued">{tpl.description}</Text>
                {tpl.howItWorks && (
                  <div className="tpl-pick-how">
                    <div className="tpl-pick-how-label">How it works</div>
                    <div className="tpl-pick-how-text">{tpl.howItWorks}</div>
                  </div>
                )}
                {tpl.features?.length > 0 && (
                  <ul className="tpl-pick-features">
                    {tpl.features.map((feature, i) => (
                      <li key={i} className="tpl-pick-feature">
                        <span className="tpl-pick-check">✓</span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {tpl.bestFor && (
                  <div className="tpl-pick-bestfor">Best for: <b>{tpl.bestFor}</b></div>
                )}
                <div style={{ marginTop: 6 }}>
                  <Button variant="primary" fullWidth onClick={() => handlePickLayout(tpl.blockName)}>
                    Use This Template
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Page>
    );
  }

  // ── Full customisation editor ────────────────────────────────────────────
  const handleSaveClick = () => {
    if (config.layout === 'layout1') {
      const numSteps = Number(config.max_selections || 3);
      const newStepErrors = {};
      for (let i = 1; i <= numSteps; i++) {
        if (!config[`step_${i}_collection`]) {
          newStepErrors[`step_${i}_collection`] = 'Please select a collection';
        }
      }
      if (Object.keys(newStepErrors).length > 0) {
        setStepErrors(newStepErrors);
        setExpandedSections((prev) => ({ ...prev, general: true }));
        shopify.toast.show('Please select a collection for each step', { isError: true });
        return;
      }
      const maxProducts = Number(config.max_products || 5);
      let stepLimitSum = 0;
      let allStepsHaveLimits = true;
      for (let i = 1; i <= numSteps; i++) {
        const lim = config[`step_${i}_limit`];
        if (lim === '' || lim == null) { allStepsHaveLimits = false; break; }
        stepLimitSum += Number(lim);
      }
      if (allStepsHaveLimits && maxProducts > stepLimitSum) {
        const errMsg = `Max products (${maxProducts}) exceeds total possible from step limits (${stepLimitSum}). Please adjust.`;
        setMaxProductsError(errMsg);
        setExpandedSections((prev) => ({ ...prev, general: true }));
        shopify.toast.show(errMsg, { isError: true });
        return;
      }
      setMaxProductsError('');
    }
    if (config.layout === 'layout3') {
      const maxProducts = Number(config.max_products || 5);
      let colLimitSum = 0;
      let allColsHaveLimits = true;
      for (let i = 1; i <= 4; i++) {
        if (!config[`col_${i}`]) continue;
        const lim = config[`col_${i}_limit`];
        if (lim == null || lim === '') { allColsHaveLimits = false; break; }
        colLimitSum += Number(lim);
      }
      if (allColsHaveLimits && colLimitSum > 0 && maxProducts > colLimitSum) {
        const errMsg = `Max products (${maxProducts}) exceeds total possible from category limits (${colLimitSum}). Please adjust.`;
        setMaxProductsError(errMsg);
        setExpandedSections((prev) => ({ ...prev, general: true }));
        shopify.toast.show(errMsg, { isError: true });
        return;
      }
      setMaxProductsError('');
    }
    setSaveModalOpen(true);
  };

  return (
    <div style={{ background: '#F4F6FA', minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif', paddingBottom: '120px' }}>

      <Page
        fullWidth
        backAction={{
          content: 'Template Modules',
          onAction: handleBackNavigation,
        }}
        title={saveTitle || 'Untitled Template'}
        titleMetadata={
          <div className="template-status-meta">
            <Tooltip
              content={
                isActive
                  ? 'Live — this template is published to your store.'
                  : 'Saved but not live yet. Click Activate to publish it to your store.'
              }
            >
              <div
                className="template-status-badge"
                style={{
                  background: isActive ? '#eafff2' : '#f4f6f8',
                  color: isActive ? '#008060' : '#5c6ac4',
                  border: isActive ? '1px solid #008060' : '1px solid #5c6ac4',
                  cursor: 'help',
                }}
              >
                {isActive ? 'Active' : 'Draft'}
              </div>
            </Tooltip>
            <Popover
              active={renameOpen}
              onClose={() => setRenameOpen(false)}
              preferredAlignment="left"
              activator={
                <Tooltip content="Rename template">
                  <Button
                    variant="tertiary"
                    size="slim"
                    icon={EditIcon}
                    accessibilityLabel="Rename template"
                    onClick={() => setRenameOpen((o) => !o)}
                  />
                </Tooltip>
              }
            >
              <div style={{ padding: 12, width: 280 }}>
                <TextField
                  label="Template title"
                  value={saveTitle}
                  onChange={handleTitleChange}
                  autoComplete="off"
                  error={titleError}
                  helpText="The name of your saved template."
                />
              </div>
            </Popover>
          </div>
        }
      >
        <div className="customize-top-gap"></div>
        <BuilderActionBar
          saveStatus={saveStatus}
          isActive={isActive}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={() => {}}
          onRedo={() => {}}
          onSave={handleSaveClick}
          saveDisabled={saveStatus === 'saved'}
          onPreview={handlePreview}
          onDuplicate={handleDuplicate}
          onToggleActive={handleToggleActive}
          onReset={() => setResetModalOpen(true)}
          onAiGenerate={() => setAiBundleOpen(true)}
          canPreview={!!initialTemplate?.id}
          issueCount={0}
        />
        <BrixBar size="md" floating zIndex={400} placeholder="Ask Brix to help with your bundle — layout, copy, colours, products…" />
        <Modal
          open={aiBundleOpen}
          onClose={() => { if (!aiBundleLoading) { setAiBundleOpen(false); setAiError(''); } }}
          title="✨ Generate a bundle with AI"
          primaryAction={{
            content: aiBundleLoading ? 'Generating…' : 'Generate',
            onAction: handleAiGenerate,
            loading: aiBundleLoading,
          }}
          secondaryActions={[{ content: 'Cancel', onAction: () => setAiBundleOpen(false), disabled: aiBundleLoading }]}
        >
          <Modal.Section>
            <FormLayout>
              <Text as="p" tone="subdued" variant="bodySm">
                Describe the bundle you want. AI will pick a layout, choose matching collections, write the copy, and set a colour theme — you can fine-tune everything afterwards.
              </Text>
              <TextField
                label="What's this bundle for?"
                value={aiPrompt}
                onChange={(v) => { setAiPrompt(v); if (aiError) setAiError(''); }}
                multiline={3}
                autoComplete="off"
                disabled={aiBundleLoading}
                placeholder="e.g. A skincare routine kit — cleanser, toner, moisturizer, with a fresh minimal look"
              />
              {aiBundleLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Spinner size="small" />
                  <Text as="span" tone="subdued" variant="bodySm">Designing your bundle… this can take a few seconds.</Text>
                </div>
              )}
              {aiError && (
                <div style={{ background: '#fff1f0', border: '1px solid #ffd2cd', borderRadius: 8, padding: '10px 12px' }}>
                  <Text as="span" tone="critical" variant="bodySm">{aiError}</Text>
                </div>
              )}
            </FormLayout>
          </Modal.Section>
        </Modal>
      <Modal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        title="Save Template"
        primaryAction={{ content: 'Save', onAction: confirmSaveTemplate }}
        secondaryActions={[
          { content: 'Cancel', onAction: () => setSaveModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Template Title"
              value={saveTitle}
              onChange={handleTitleChange}
              autoComplete="off"
              error={titleError}
            />
            <Checkbox
              label="Automatically create/update a Shopify Page for this combo"
              checked={publishToPage}
              onChange={setPublishToPage}
              helpText="This will link your combo design to a specific page on your store."
            />
            {publishToPage && (
              <div
                style={{
                  marginTop: 8,
                  padding: 12,
                  background: '#f6f6f7',
                  borderRadius: 8,
                }}
              >
                <FormLayout>
                  <ButtonGroup segmented fullWidth>
                    <Button
                      pressed={publishType === 'new'}
                      onClick={() => setPublishType('new')}
                    >
                      Create New Page
                    </Button>
                    <Button
                      pressed={publishType === 'existing'}
                      onClick={() => setPublishType('existing')}
                    >
                      Use Existing Page
                    </Button>
                  </ButtonGroup>

                  {publishType === 'new' ? (
                    <>
                      <TextField
                        label="Target Page Title"
                        value={targetPageTitle}
                        onChange={(v) => {
                          setTargetPageTitle(v);
                          setTargetPageHandle(
                            v
                              .toLowerCase()
                              .replace(/[^a-z0-9]+/g, '-')
                              .replace(/^-+|-+$/g, '')
                          );
                          if (pageError) setPageError('');
                        }}
                        autoComplete="off"
                        error={pageError}
                      />
                      <TextField
                        label="Target Page Handle (URL slug)"
                        value={targetPageHandle}
                        onChange={(v) =>
                          setTargetPageHandle(
                            v.toLowerCase().replace(/[^a-z0-9-]+/g, '')
                          )
                        }
                        autoComplete="off"
                        prefix="/pages/"
                      />
                    </>
                  ) : (
                    <Select
                      label="Select an existing page"
                      options={[
                        { label: 'Select a page...', value: '' },
                        ...shopPages.map((p) => ({
                          label: p.title,
                          value: p.id,
                        })),
                      ]}
                      value={selectedPageId}
                      onChange={(id) => {
                        setSelectedPageId(id);
                        if (pageError) setPageError('');
                        const page = shopPages.find((p) => p.id === id);
                        if (page) {
                          setTargetPageTitle(page.title);
                          setTargetPageHandle(page.handle);
                        }
                      }}
                      error={pageError}
                    />
                  )}
                </FormLayout>
              </div>
            )}
            <p style={{ color: '#666', marginTop: 4 }}>
              Confirm to save the current customization as a template.
            </p>
          </FormLayout>
        </Modal.Section>
      </Modal>

      <Modal
        open={resetModalOpen}
        onClose={() => setResetModalOpen(false)}
        title="Reset Template"
        primaryAction={{
          content: 'Reset',
          destructive: true,
          onAction: () => {
            console.log('Resetting to factory defaults');
            setConfig({ ...DEFAULT_COMBO_CONFIG });
            setSaveTitle(
              DEFAULT_COMBO_CONFIG.collection_title || 'Untitled Template'
            );
            setFormKey((prev) => prev + 1);
            setResetModalOpen(false);
          },
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setResetModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <p>
            Are you sure you want to reset all settings to default? This action
            cannot be undone.
          </p>
        </Modal.Section>
      </Modal>

      <style>{`
.customize-layout-grid{display:grid;grid-template-columns:370px minmax(0,1fr);gap:14px;align-items:start;padding-bottom:32px}
.cz-panel-col{zoom:0.9}
.customize-left-sticky{position:sticky;top:16px;z-index:10}
.cz-panel-col{order:1}
.cz-preview-col{order:2}
@media(max-width:1280px){.customize-layout-grid{grid-template-columns:380px minmax(0,1fr);gap:12px}}
@media(max-width:768px){.customize-layout-grid{grid-template-columns:1fr;gap:12px}.customize-left-sticky{position:static;top:auto}.cz-panel-col,.cz-preview-col{order:0}}

.template-status-meta{display:flex;align-items:center;gap:8px}
.template-status-badge{display:inline-flex;align-items:center;justify-content:center;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.2px}

.preview-stage{background:linear-gradient(180deg,#f8f9fb 0%,#f2f4f7 100%);border:1px solid #e3e6eb;border-radius:12px;padding:12px}
.preview-scale-panel{width:100%;overflow:visible}
.preview-scale-canvas{will-change:zoom}
.preview-stage--desktop{display:flex;flex-direction:column;gap:10px}
.preview-browser-chrome{width:100%;height:34px;border-radius:10px;border:1px solid #d7dce4;background:linear-gradient(180deg,#fff 0%,#f4f6fa 100%);display:flex;align-items:center;gap:6px;padding:0 10px}
.preview-browser-chrome span{width:10px;height:10px;border-radius:50%;background:#d5dae3}
.preview-browser-chrome span:first-child{background:#ff6f61}
.preview-browser-chrome span:nth-child(2){background:#ffca55}
.preview-browser-chrome span:nth-child(3){background:#3ddc84}
.preview-viewport{width:100%;overflow-y:auto;overflow-x:hidden;background:#fff;margin:0 auto;transition:all .25s ease;position:relative}
.preview-viewport>*{max-width:100%}
.preview-stage--desktop .preview-viewport{width:1200px;min-height:400px;border:1px solid #d7dce4;border-radius:12px;box-shadow:0 8px 20px rgba(16,24,40,.07)}
.preview-stage--mobile{display:flex;justify-content:center;padding:4px;background:linear-gradient(180deg,#f6f7f9 0%,#eef1f5 100%)}
.preview-viewport--mobile-classic{width:375px;height:667px;border:1px solid #d7dce4;border-radius:12px;box-shadow:0 8px 18px rgba(16,24,40,.1)}
      `}</style>

      <div key={formKey} className="customize-layout-grid">
        <div className="cz-preview-col">
          <div className="customize-left-sticky">
            <Card sectioned>
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', paddingBottom: '12px' }}>
                <ButtonGroup segmented>
                  <Button
                    pressed={previewDevice === 'desktop'}
                    onClick={() => setPreviewDevice('desktop')}
                    icon={DesktopIcon}
                    size="micro"
                  >
                    <span style={{ fontSize: '12px', padding: '0 4px' }}>Desktop</span>
                  </Button>
                  <Button
                    pressed={previewDevice === 'mobile'}
                    onClick={() => setPreviewDevice('mobile')}
                    icon={MobileIcon}
                    size="micro"
                  >
                    <span style={{ fontSize: '12px', padding: '0 4px' }}>Mobile</span>
                  </Button>
                </ButtonGroup>
              </div>
              <div className={`preview-stage preview-stage--${previewDevice}`}>
                {previewDevice === 'desktop' ? (
                  <div ref={containerRef} className="preview-scale-panel" style={scaledPanelStyle}>
                    <div className="preview-scale-canvas" style={scaledCanvasStyle}>
                      <div className="preview-browser-chrome" aria-hidden="true">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                      <div className="preview-device-container preview-viewport preview-viewport--desktop">
                        <ComboPreview
                          config={config}
                          device={previewDevice}
                          products={shopifyProducts.length > 0 ? shopifyProducts : products}
                          collections={collections}
                          activeTab={activeTab}
                          setActiveTab={setActiveTab}
                          isLoading={productsLoading && shopifyProducts.length === 0}
                          stepProductsLoading={stepProductsLoading}
                          activeDiscounts={localActiveDiscounts}
                          selectedVariants={selectedVariants}
                          setSelectedVariants={setSelectedVariants}
                          allStepProducts={allStepProducts}
                          setAllStepProducts={setAllStepProducts}
                          onUpdateConfig={updateConfig}
                          onRequestSection={handleOpenSection}
                        />
                        {config.custom_css && (
                          <style dangerouslySetInnerHTML={{ __html: `.preview-viewport { ${config.custom_css} }` }} />
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="preview-device-container preview-viewport preview-viewport--mobile-classic">
                    <ComboPreview
                      config={config}
                      device={previewDevice}
                      products={shopifyProducts.length > 0 ? shopifyProducts : products}
                      collections={collections}
                      activeTab={activeTab}
                      setActiveTab={setActiveTab}
                      isLoading={productsLoading && products.length === 0}
                      stepProductsLoading={stepProductsLoading}
                      activeDiscounts={localActiveDiscounts}
                      selectedVariants={selectedVariants}
                      setSelectedVariants={setSelectedVariants}
                      allStepProducts={allStepProducts}
                      setAllStepProducts={setAllStepProducts}
                      onUpdateConfig={updateConfig}
                    />
                    {config.custom_css && (
                      <style dangerouslySetInnerHTML={{ __html: `.preview-viewport { ${config.custom_css} }` }} />
                    )}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>

        <div className="cz-panel-col customize-left-sticky">
          <BuilderSidebar
            config={config}
            activeCategory={activeCategory}
            setActiveCategory={setActiveCategory}
            styleDevice={styleDevice}
            setStyleDevice={setStyleDevice}
            expandedSections={expandedSections}
            toggleSection={toggleSection}
            collections={collections}
            updateConfig={updateConfig}
            getStyleKey={getStyleKey}
            stepErrors={stepErrors}
            maxProductsError={maxProductsError}
            stepFieldAiLoading={stepFieldAiLoading}
            generateStepFieldSuggestion={generateStepFieldSuggestion}
            generatingTitle={generatingTitle}
            generatingDescription={generatingDescription}
            generateAiSuggestion={generateAiSuggestion}
            PxField={PxField}
            ColorPickerField={ColorPickerField}
            setPreviewDevice={setPreviewDevice}
            localActiveDiscounts={localActiveDiscounts}
            applyConfigPatch={applyConfigPatch}
            openSection={(key) => setExpandedSections((prev) => onlyOpen(prev, key))}
            setAllSections={(val) =>
              setExpandedSections((prev) =>
                Object.keys(prev).reduce((acc, k) => ((acc[k] = val), acc), {})
              )
            }
            onCreateCoupon={() => setCreateDiscountModalOpen(true)}
          />
        </div>
      </div>

      {/* Discount Type Modal (Level 1) */}
      <Modal
        open={createDiscountModalOpen}
        onClose={() => setCreateDiscountModalOpen(false)}
        title="Select discount type"
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setCreateDiscountModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {discountTypeOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => openDiscountConfiguration(opt.value)}
                style={{
                  border: '1px solid #D2D5D9',
                  borderRadius: 10,
                  padding: '10px 12px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  background: '#fff',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 600,
                        color: '#202223',
                        lineHeight: 1.3,
                      }}
                    >
                      {opt.title}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: '#6D7175',
                        marginTop: 2,
                        lineHeight: 1.35,
                      }}
                    >
                      {opt.description}
                    </div>
                  </div>
                  <div
                    style={{ fontSize: 16, color: '#8C9196', marginLeft: 8 }}
                    aria-hidden="true"
                  >
                    ›
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Modal.Section>
      </Modal>

      {/* Discount Configuration Modal (Level 2) */}
      <Modal
        open={configureDiscountModalOpen}
        onClose={() => {
          setConfigureDiscountModalOpen(false);
          resetDiscountForm();
        }}
        title={selectedDiscountTypeMeta?.title || 'Create Discount'}
        primaryAction={{
          content: 'Create discount',
          onAction: handleCreateDiscount,
          loading: discountFetcher.state === 'submitting',
        }}
        secondaryActions={[
          {
            content: 'Back',
            onAction: () => {
              setConfigureDiscountModalOpen(false);
              setCreateDiscountModalOpen(true);
            },
          },
          {
            content: 'Cancel',
            onAction: () => {
              setConfigureDiscountModalOpen(false);
              resetDiscountForm();
            },
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            {/* ── Title ── */}
            <TextField
              label="Title"
              value={dTitle}
              onChange={(v) => { setDTitle(v); if (dErrors.title) setDErrors((p) => ({ ...p, title: undefined })); }}
              autoComplete="off"
              helpText="Internal name — customers may see this in cart or checkout."
              error={dErrors.title}
              placeholder="Summer Sale 20% Off"
            />

            {/* ── Discount code ── */}
            <TextField
              label="Discount code"
              value={dCode}
              onChange={(v) => setDCode(v.toUpperCase())}
              autoComplete="off"
              helpText="Customers enter this at checkout."
              placeholder="SUMMER20"
              suffix={
                <Button variant="plain" onClick={() => setDCode(Math.random().toString(36).substring(2, 10).toUpperCase())}>
                  Generate
                </Button>
              }
            />

            {/* ── Amount off products / order: value ── */}
            {(selectedDiscountType === 'amount_off_products' || selectedDiscountType === 'amount_off_order') && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Select
                  label="Discount type"
                  options={[
                    { label: 'Percentage off (%)', value: 'percentage' },
                    { label: 'Fixed amount off (₹)', value: 'fixed_amount' },
                  ]}
                  value={dValueType}
                  onChange={setDValueType}
                />
                <TextField
                  label="Discount value"
                  type="number" min="0.01" step="0.01"
                  value={dValue}
                  onChange={(v) => { setDValue(v); if (dErrors.value) setDErrors((p) => ({ ...p, value: undefined })); }}
                  suffix={dValueType === 'percentage' ? '%' : '₹'}
                  autoComplete="off"
                  error={dErrors.value}
                  placeholder={dValueType === 'percentage' ? '10' : '100'}
                />
              </div>
            )}

            {/* ── Amount off products: Applies to ── */}
            {selectedDiscountType === 'amount_off_products' && (
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#202223', marginBottom: 6 }}>Applies to</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                  {[
                    { value: 'all', label: 'All products' },
                    { value: 'products', label: 'Specific products' },
                    { value: 'collections', label: 'Specific collections' },
                  ].map((opt) => (
                    <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                      <input type="radio" checked={dAppliesTo === opt.value} onChange={() => { setDAppliesTo(opt.value); setDAppliesToIds([]); }} />
                      {opt.label}
                    </label>
                  ))}
                </div>
                {dAppliesTo !== 'all' && (
                  <div>
                    <p style={{ fontSize: 12, color: '#6D7175', marginBottom: 4 }}>
                      Select {dAppliesTo === 'products' ? 'products' : 'collections'} (hold Ctrl/Cmd for multiple)
                    </p>
                    <select
                      multiple
                      value={dAppliesToIds}
                      onChange={(e) => setDAppliesToIds(Array.from(e.target.selectedOptions).map((o) => o.value))}
                      style={{ width: '100%', minHeight: 100, border: '1px solid #c9cccf', borderRadius: 8, padding: 6, background: '#fff', fontSize: 13 }}
                    >
                      {(dAppliesTo === 'products' ? bxgyProductOptions : bxgyCollectionOptions).map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* ── Free shipping: Countries ── */}
            {selectedDiscountType === 'free_shipping' && (
              <div>
                <div style={{ padding: '10px 12px', background: '#F6F6F7', borderRadius: 8, fontSize: 13, color: '#202223', marginBottom: 12 }}>
                  <strong>Shipping rate:</strong> All shipping rates
                </div>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#202223', marginBottom: 6 }}>Countries</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                    <input type="radio" checked={dFreeShipAllCountries} onChange={() => setDFreeShipAllCountries(true)} />
                    All countries
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                    <input type="radio" checked={!dFreeShipAllCountries} onChange={() => setDFreeShipAllCountries(false)} />
                    Selected countries
                  </label>
                </div>
                {!dFreeShipAllCountries && (
                  <TextField
                    label="Country codes"
                    value={dFreeShipCountryCodes}
                    onChange={setDFreeShipCountryCodes}
                    autoComplete="off"
                    placeholder="IN, US, GB, AU"
                    helpText="Comma-separated ISO 2-letter country codes"
                  />
                )}
              </div>
            )}

            {/* ── Buy X Get Y ── */}
            {selectedDiscountType === 'buy_x_get_y' && (
              <>
                {/* Customer BUYS */}
                <div style={{ border: '1px solid #E1E3E5', borderRadius: 8, padding: 14 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#202223', marginBottom: 10 }}>Customer buys</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, alignItems: 'start' }}>
                    <TextField
                      label="Minimum quantity"
                      type="number" min="1"
                      value={dBuyQuantity}
                      onChange={(v) => { setDBuyQuantity(v); if (dErrors.buyQuantity) setDErrors((p) => ({ ...p, buyQuantity: undefined })); }}
                      autoComplete="off"
                      error={dErrors.buyQuantity}
                    />
                    <Select
                      label="Any items from"
                      options={[
                        { label: 'Specific products', value: 'products' },
                        { label: 'Specific collections', value: 'collections' },
                      ]}
                      value={dBuyTargetType}
                      onChange={(v) => { setDBuyTargetType(v); setDBuyTargetIds([]); if (dErrors.buyTargets) setDErrors((p) => ({ ...p, buyTargets: undefined })); }}
                    />
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <p style={{ fontSize: 12, color: '#6D7175', marginBottom: 4 }}>
                      Select {dBuyTargetType === 'products' ? 'products' : 'collections'} (hold Ctrl/Cmd for multiple)
                    </p>
                    <select
                      multiple value={dBuyTargetIds}
                      onChange={(e) => { const v = Array.from(e.target.selectedOptions).map((o) => o.value); setDBuyTargetIds(v); if (dErrors.buyTargets) setDErrors((p) => ({ ...p, buyTargets: undefined })); }}
                      style={{ width: '100%', minHeight: 90, border: `1px solid ${dErrors.buyTargets ? '#d72c0d' : '#c9cccf'}`, borderRadius: 8, padding: 6, background: '#fff', fontSize: 13 }}
                    >
                      {(dBuyTargetType === 'products' ? bxgyProductOptions : bxgyCollectionOptions).map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    {dErrors.buyTargets && <p style={{ color: '#d72c0d', fontSize: 12, marginTop: 4 }}>{dErrors.buyTargets}</p>}
                  </div>
                </div>

                {/* Customer GETS */}
                <div style={{ border: '1px solid #E1E3E5', borderRadius: 8, padding: 14 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#202223', marginBottom: 10 }}>Customer gets</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, alignItems: 'start' }}>
                    <TextField
                      label="Quantity"
                      type="number" min="1"
                      value={dGetQuantity}
                      onChange={(v) => { setDGetQuantity(v); if (dErrors.getQuantity) setDErrors((p) => ({ ...p, getQuantity: undefined })); }}
                      autoComplete="off"
                      error={dErrors.getQuantity}
                    />
                    <Select
                      label="Any items from"
                      options={[
                        { label: 'All products', value: 'all' },
                        { label: 'Specific products', value: 'products' },
                        { label: 'Specific collections', value: 'collections' },
                      ]}
                      value={dGetTargetType}
                      onChange={(v) => { setDGetTargetType(v); setDGetTargetIds([]); if (dErrors.getTargets) setDErrors((p) => ({ ...p, getTargets: undefined })); }}
                    />
                  </div>
                  {dGetTargetType !== 'all' && (
                    <div style={{ marginTop: 8 }}>
                      <p style={{ fontSize: 12, color: '#6D7175', marginBottom: 4 }}>
                        Select {dGetTargetType === 'products' ? 'products' : 'collections'} (hold Ctrl/Cmd for multiple)
                      </p>
                      <select
                        multiple value={dGetTargetIds}
                        onChange={(e) => { const v = Array.from(e.target.selectedOptions).map((o) => o.value); setDGetTargetIds(v); if (dErrors.getTargets) setDErrors((p) => ({ ...p, getTargets: undefined })); }}
                        style={{ width: '100%', minHeight: 90, border: `1px solid ${dErrors.getTargets ? '#d72c0d' : '#c9cccf'}`, borderRadius: 8, padding: 6, background: '#fff', fontSize: 13 }}
                      >
                        {(dGetTargetType === 'products' ? bxgyProductOptions : bxgyCollectionOptions).map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      {dErrors.getTargets && <p style={{ color: '#d72c0d', fontSize: 12, marginTop: 4 }}>{dErrors.getTargets}</p>}
                    </div>
                  )}
                  {/* At a discounted value */}
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #E1E3E5' }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#6D7175', marginBottom: 8 }}>AT A DISCOUNTED VALUE</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <Select
                        label="Discount type"
                        options={[
                          { label: 'Percentage off', value: 'percentage' },
                          { label: 'Fixed amount off (₹)', value: 'fixed_amount' },
                          { label: 'Free (100% off)', value: 'free' },
                        ]}
                        value={dGetValueType}
                        onChange={(v) => { setDGetValueType(v); if (v === 'free') setDGetValue('100'); }}
                      />
                      <TextField
                        label="Value"
                        type="number" min="0.01" step="0.01"
                        value={dGetValue}
                        disabled={dGetValueType === 'free'}
                        onChange={(v) => { setDGetValue(v); if (dErrors.getValue) setDErrors((p) => ({ ...p, getValue: undefined })); }}
                        suffix={dGetValueType === 'percentage' ? '%' : dGetValueType === 'free' ? '' : '₹'}
                        autoComplete="off"
                        error={dErrors.getValue}
                        helpText={dGetValueType === 'free' ? 'Customers get the item for free' : undefined}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            <div>
              <p
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#111',
                  marginBottom: 8,
                }}
              >
                Minimum purchase requirements
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { value: 'none', label: 'No minimum requirements' },
                  { value: 'amount', label: 'Minimum purchase amount (₹)' },
                  { value: 'quantity', label: 'Minimum quantity of items' },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      checked={dMinRequirementType === opt.value}
                      onChange={() => setDMinRequirementType(opt.value)}
                    />
                    <span style={{ fontSize: 13 }}>{opt.label}</span>
                  </label>
                ))}
              </div>
              {(dMinRequirementType === 'amount' ||
                dMinRequirementType === 'quantity') && (
                  <div style={{ marginTop: 8, maxWidth: 200 }}>
                    <TextField
                      type="number"
                      value={dMinRequirementValue}
                      onChange={(v) => {
                        setDMinRequirementValue(v);
                        if (dErrors.minRequirementValue)
                          setDErrors((p) => ({
                            ...p,
                            minRequirementValue: undefined,
                          }));
                      }}
                      placeholder={
                        dMinRequirementType === 'amount' ? '0.00' : '0'
                      }
                      autoComplete="off"
                      error={dErrors.minRequirementValue}
                    />
                  </div>
                )}
            </div>

            <div>
              <p
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#111',
                  marginBottom: 8,
                }}
              >
                Maximum discount uses
              </p>
              <Checkbox
                label="Limit number of times this discount can be used in total"
                checked={dLimitUsage}
                onChange={setDLimitUsage}
              />
              {dLimitUsage && (
                <div style={{ marginTop: 8, maxWidth: 200 }}>
                  <TextField
                    type="number"
                    value={dMaxUsageLimit}
                    onChange={(v) => {
                      setDMaxUsageLimit(v);
                      if (dErrors.maxUsage)
                        setDErrors((p) => ({ ...p, maxUsage: undefined }));
                    }}
                    autoComplete="off"
                    error={dErrors.maxUsage}
                  />
                </div>
              )}
              <div style={{ marginTop: 8 }}>
                <Checkbox
                  label="Limit to one use per customer"
                  checked={dOncePerCustomer}
                  onChange={setDOncePerCustomer}
                />
              </div>
            </div>

            <div>
              <p
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#111',
                  marginBottom: 4,
                }}
              >
                Combinations
              </p>
              <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 8 }}>
                This discount can be combined with:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Checkbox
                  label="Product discounts"
                  checked={dCombinations.product}
                  onChange={(v) =>
                    setDCombinations((p) => ({ ...p, product: v }))
                  }
                />
                <Checkbox
                  label="Order discounts"
                  checked={dCombinations.order}
                  onChange={(v) =>
                    setDCombinations((p) => ({ ...p, order: v }))
                  }
                />
                <Checkbox
                  label="Shipping discounts"
                  checked={dCombinations.shipping}
                  onChange={(v) =>
                    setDCombinations((p) => ({ ...p, shipping: v }))
                  }
                />
              </div>
            </div>

            <div>
              <p
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#111',
                  marginBottom: 8,
                }}
              >
                Active dates
              </p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                  marginBottom: 8,
                }}
              >
                <TextField
                  label="Start date"
                  type="date"
                  value={dStartsAt?.split('T')[0] || ''}
                  onChange={(v) => {
                    setDStartsAt(
                      v + 'T' + (dStartsAt?.split('T')[1] || '00:00')
                    );
                    if (dErrors.startsAt)
                      setDErrors((p) => ({ ...p, startsAt: undefined }));
                  }}
                  autoComplete="off"
                  error={dErrors.startsAt}
                />
                <TextField
                  label="Start time"
                  type="time"
                  value={dStartsAt?.split('T')[1] || ''}
                  onChange={(v) =>
                    setDStartsAt((dStartsAt?.split('T')[0] || '') + 'T' + v)
                  }
                  autoComplete="off"
                />
              </div>
              <Checkbox
                label="Set end date"
                checked={dHasEndDate}
                onChange={setDHasEndDate}
              />
              {dHasEndDate && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 12,
                    marginTop: 8,
                  }}
                >
                  <TextField
                    label="End date"
                    type="date"
                    value={dEndsAt?.split('T')[0] || ''}
                    onChange={(v) => {
                      setDEndsAt(v + 'T' + (dEndsAt?.split('T')[1] || '23:59'));
                      if (dErrors.endsAt)
                        setDErrors((p) => ({ ...p, endsAt: undefined }));
                    }}
                    autoComplete="off"
                    error={dErrors.endsAt}
                  />
                  <TextField
                    label="End time"
                    type="time"
                    value={dEndsAt?.split('T')[1] || ''}
                    onChange={(v) =>
                      setDEndsAt((dEndsAt?.split('T')[0] || '') + 'T' + v)
                    }
                    autoComplete="off"
                  />
                </div>
              )}
            </div>
          </FormLayout>
        </Modal.Section>
      </Modal>
      </Page>
    </div>
  );
}

function InlineEdit({ value, configKey, onUpdate, style }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [editing]);

  const handleBlur = () => {
    const trimmed = draft.trim();
    if (trimmed !== value) {
      onUpdate(configKey, trimmed);
    }
    setEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      ref.current?.blur();
    }
    if (e.key === 'Escape') {
      setDraft(value);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        ref={ref}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        dir="ltr"
        size={Math.max(draft.length || 1, 12)}
        style={{
          fontSize: style?.fontSize,
          fontWeight: style?.fontWeight,
          color: style?.color,
          outline: '2px solid #1a9de0',
          outlineOffset: '2px',
          borderRadius: '2px',
          border: 'none',
          background: 'transparent',
          padding: '2px 0',
          margin: 0,
          minWidth: 60,
          maxWidth: '100%',
          fontFamily: 'inherit',
          lineHeight: 'inherit',
          textAlign: 'left',
          direction: 'ltr',
        }}
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      style={{
        ...style,
        cursor: 'pointer',
        borderRadius: '2px',
        transition: 'box-shadow 0.15s',
      }}
      onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 0 0 1.5px #1a9de0'}
      onMouseLeave={(e) => e.currentTarget.style.boxShadow = 'none'}
      title="Click to edit"
    >
      {value}
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#9ca3af"
        strokeWidth="2"
        strokeLinecap="round"
        style={{ marginLeft: 4, display: 'inline', verticalAlign: 'middle', opacity: 0.5 }}
      >
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
    </span>
  );
}

function ComboPreview({
  config,
  device,
  products,
  collections = [],
  activeTab,
  setActiveTab,
  isLoading,
  activeDiscounts = [],
  selectedVariants = {},
  setSelectedVariants = () => { },
  allStepProducts = {},
  setAllStepProducts = () => { },
  stepProductsLoading = false,
  onUpdateConfig = () => { },
  onRequestSection = () => { },
}) {
  const isMobile = device === 'mobile';
  const sliderRef = useRef(null);
  const tabScrollRef = useRef(null);

  // ── Section inspect state (Shopify HighlightZone pattern) ──────────────
  const [inspectActive, setInspectActive] = useState(null);
  const [inspectHover, setInspectHover]   = useState(null);

  const SECTION_LABELS = {
    progressBar: 'Progress Bar', banner: 'Banner', content: 'Title & Description',
    general: 'Steps & Collections', products: 'Products Grid', previewBar: 'Preview Bar',
  };

  // Wraps any preview section with hover/click inspection border

  // Custom Styles for the Preview
  const previewStyles = `
    .cdo-slider-horizontal::-webkit-scrollbar {
      display: none !important;
    }
    .cdo-slider-horizontal::-webkit-scrollbar-track {
      background: #f1f1f1;
      border-radius: 10px;
    }
    .cdo-slider-horizontal::-webkit-scrollbar-thumb {
      background: ${config.selection_highlight_color || '#ca275c'};
      border-radius: 10px;
    }
    .cdo-slider-horizontal {
      scrollbar-width: none;
      -ms-overflow-style: none;
      scroll-behavior: smooth;
    }
    .cdo-slider-horizontal.cdo-tabs-scroll-visible {
      scrollbar-width: thin;
      -ms-overflow-style: auto;
    }
    .cdo-slider-horizontal.cdo-tabs-scroll-visible::-webkit-scrollbar {
      display: block !important;
      height: 6px;
    }
    .cdo-arrow-btn {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: #fff;
      border: 1px solid #ddd;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 10;
      box-shadow: 0 4px 10px rgba(0,0,0,0.1);
      transition: all 0.2s;
    }
    .cdo-arrow-btn:hover {
      background: ${config.selection_highlight_color || '#ca275c'};
      color: #fff;
      border-color: ${config.selection_highlight_color || '#ca275c'};
    }
    @keyframes combo-spin {
      to { transform: rotate(360deg); }
    }
    .combo-spinner-new {
      width: 44px;
      height: 44px;
      border: 4px solid rgba(0,0,0,0.05);
      border-top: 4px solid ${config.selection_highlight_color || '#008060'};
      border-radius: 50%;
      animation: combo-spin 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }
    @keyframes combo-shimmer {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(300%); }
    }
  `;
  const paddingTop = isMobile
    ? config.container_padding_top_mobile
    : config.container_padding_top_desktop;
  const paddingRight = isMobile
    ? config.container_padding_right_mobile
    : config.container_padding_right_desktop;
  const paddingBottom = isMobile
    ? config.container_padding_bottom_mobile
    : config.container_padding_bottom_desktop;
  const paddingLeft = isMobile
    ? config.container_padding_left_mobile
    : config.container_padding_left_desktop;
  const bannerWidth = isMobile
    ? config.banner_width_mobile || config.banner_width_desktop || 100
    : config.banner_width_desktop || 100;
  const bannerHeight = isMobile
    ? config.banner_height_mobile || config.banner_height_desktop || 120
    : config.banner_height_desktop || 180;

  const finalBannerHeight =
    config.banner_fit_mode === 'adapt' ? 'auto' : `${bannerHeight}px`;
  const bannerObjectFit =
    config.banner_fit_mode === 'cover' || config.banner_fit_mode === 'contain'
      ? config.banner_fit_mode
      : 'initial';

  // With CSS zoom (not transform:scale), font sizes render at correct visual size — no compensation needed.
  const productTitleSize = isMobile
    ? config.product_title_size_mobile || 14
    : config.product_title_size_desktop || 16;
  const productPriceSize = isMobile
    ? config.product_price_size_mobile || 14
    : config.product_price_size_desktop || 15;

  const headingSize = isMobile
    ? (config.heading_size_mobile ?? config.heading_size ?? 22)
    : (config.heading_size ?? 32);
  const descriptionSize = isMobile
    ? (config.description_size_mobile ?? config.description_size ?? 13)
    : (config.description_size ?? 16);

  const headingColor = isMobile
    ? config.heading_color_mobile || config.heading_color
    : config.heading_color;
  const descriptionColor = isMobile
    ? config.description_color_mobile || config.description_color
    : config.description_color;

  const headingFontWeight = isMobile
    ? config.heading_font_weight_mobile || config.heading_font_weight || 700
    : config.heading_font_weight || 700;
  const descriptionFontWeight = isMobile
    ? config.description_font_weight_mobile ||
    config.description_font_weight ||
    400
    : config.description_font_weight || 400;

  const headingAlign = isMobile
    ? config.heading_align_mobile || config.heading_align || 'left'
    : config.heading_align || 'left';
  const descriptionAlign = isMobile
    ? config.description_align_mobile || config.description_align || 'left'
    : config.description_align || 'left';

  // Padding & Margins
  const titlePadding = {
    top: isMobile
      ? (config.title_container_padding_top_mobile ??
        config.title_container_padding_top)
      : config.title_container_padding_top,
    right: isMobile
      ? (config.title_container_padding_right_mobile ??
        config.title_container_padding_right)
      : config.title_container_padding_right,
    bottom: isMobile
      ? (config.title_container_padding_bottom_mobile ??
        config.title_container_padding_bottom)
      : config.title_container_padding_bottom,
    left: isMobile
      ? (config.title_container_padding_left_mobile ??
        config.title_container_padding_left)
      : config.title_container_padding_left,
    marginTop: isMobile
      ? (config.title_container_margin_top_mobile ??
        config.title_container_margin_top)
      : config.title_container_margin_top,
    marginRight: isMobile
      ? (config.title_container_margin_right_mobile ??
        config.title_container_margin_right)
      : config.title_container_margin_right,
    marginBottom: isMobile
      ? (config.title_container_margin_bottom_mobile ??
        config.title_container_margin_bottom)
      : config.title_container_margin_bottom,
    marginLeft: isMobile
      ? (config.title_container_margin_left_mobile ??
        config.title_container_margin_left)
      : config.title_container_margin_left,
  };

  const descriptionPadding = {
    top: isMobile
      ? (config.description_container_padding_top_mobile ??
        config.description_container_padding_top)
      : config.description_container_padding_top,
    right: isMobile
      ? (config.description_container_padding_right_mobile ??
        config.description_container_padding_right)
      : config.description_container_padding_right,
    bottom: isMobile
      ? (config.description_container_padding_bottom_mobile ??
        config.description_container_padding_bottom)
      : config.description_container_padding_bottom,
    left: isMobile
      ? (config.description_container_padding_left_mobile ??
        config.description_container_padding_left)
      : config.description_container_padding_left,
    marginTop: isMobile
      ? (config.description_container_margin_top_mobile ??
        config.description_container_margin_top)
      : config.description_container_margin_top,
    marginRight: isMobile
      ? (config.description_container_margin_right_mobile ??
        config.description_container_margin_right)
      : config.description_container_margin_right,
    marginBottom: isMobile
      ? (config.description_container_margin_bottom_mobile ??
        config.description_container_margin_bottom)
      : config.description_container_margin_bottom,
    marginLeft: isMobile
      ? (config.description_container_margin_left_mobile ??
        config.description_container_margin_left)
      : config.description_container_margin_left,
  };

  const productCardPadding = config.product_card_padding ?? 10;
  const viewportWidth = '100%';
  const columns = isMobile ? config.mobile_columns : config.desktop_columns;
  const numericColumns = Math.max(1, Number(columns) || 1);
  const gridGap = Number(config.products_gap ?? 12);
  const effectiveColumns = numericColumns;
  // const cardHeight = isMobile
  //   ? config.card_height_mobile
  //   : config.card_height_desktop; // unused
  const productImageHeight = isMobile
    ? config.product_image_height_mobile
    : config.product_image_height_desktop;
  const productImageRatio = config.product_image_ratio || 'square';
  const productImageAspectRatio =
    productImageRatio === 'portrait'
      ? '3 / 4'
      : productImageRatio === 'rectangle'
        ? '4 / 3'
        : '1 / 1';
  const supportsAspectRatio =
    typeof window !== 'undefined' &&
    window.CSS &&
    typeof window.CSS.supports === 'function' &&
    window.CSS.supports('aspect-ratio: 1 / 1');
  // const cardHeight = isMobile
  //   ? config.card_height_mobile
  //   : config.card_height_desktop; // unused

  // Title & Description renderer
  const renderTitleDescription = () => (
    <div style={{ width: `${config.title_width || 100}%`, margin: '0 auto' }}>
      <div
        style={{
          paddingTop: titlePadding.top,
          paddingRight: titlePadding.right,
          paddingBottom: titlePadding.bottom,
          paddingLeft: titlePadding.left,
          marginTop: titlePadding.marginTop,
          marginRight: titlePadding.marginRight,
          marginBottom: titlePadding.marginBottom,
          marginLeft: titlePadding.marginLeft,
          textAlign: headingAlign,
        }}
      >
        <h1
          style={{
            fontSize: `${headingSize}px`,
            marginBottom: 4,
            color: headingColor,
            fontWeight: headingFontWeight,
            textAlign: headingAlign,
          }}
        >
          <InlineEdit value={config.collection_title || ''} configKey="collection_title" onUpdate={onUpdateConfig} style={{ fontSize: `${headingSize}px`, color: headingColor, fontWeight: headingFontWeight }} />
        </h1>
      </div>
      {config.collection_description && (
        <div
          style={{
            paddingTop: descriptionPadding.top,
            paddingRight: descriptionPadding.right,
            paddingBottom: descriptionPadding.bottom,
            paddingLeft: descriptionPadding.left,
            marginTop: descriptionPadding.marginTop,
            marginRight: descriptionPadding.marginRight,
            marginBottom: descriptionPadding.marginBottom,
            marginLeft: descriptionPadding.marginLeft,
            textAlign: descriptionAlign,
          }}
        >
          <p
            style={{
              fontSize: `${descriptionSize}px`,
              color: descriptionColor,
              fontWeight: descriptionFontWeight,
              textAlign: descriptionAlign,
            }}
          >
            <InlineEdit value={config.collection_description || ''} configKey="collection_description" onUpdate={onUpdateConfig} style={{ fontSize: `${descriptionSize}px`, color: descriptionColor, fontWeight: descriptionFontWeight }} />
          </p>
        </div>
      )}
    </div>
  );

  // Section rendering functions
  const renderBanner = () => {
    if (config.show_banner === false) return null;
    const bannerUrl =
      isMobile && config.banner_image_mobile_url
        ? config.banner_image_mobile_url
        : config.banner_image_url;

    const bannerImage =
      bannerUrl ||
      SAMPLE_BANNER_IMAGE;

    if (config.layout === 'layout2') {
      return (
        <div
          style={{
            position: 'relative',
            width: `${bannerWidth}%`,
            margin: '0 auto',
            height: finalBannerHeight,
            overflow: 'hidden',
            outline: inspectActive === 'banner' ? '2px solid #1a9de0' : inspectHover === 'banner' ? '2px dashed #1a9de0' : undefined,
            cursor: 'pointer',
          }}
          onMouseEnter={() => setInspectHover('banner')}
          onMouseLeave={() => setInspectHover(null)}
          onClick={(e) => { e.stopPropagation(); setInspectActive('banner'); onRequestSection('banner'); }}
        >
          <img
            src={bannerImage}
            alt="Banner"
            style={{
              width: '100%',
              height: config.banner_fit_mode === 'adapt' ? 'auto' : '100%',
              objectFit: bannerObjectFit,
            }}
          />
        </div>
      );
    }

    return (
      <div
        style={{
          width: config.banner_full_width
            ? `calc(100% + ${paddingLeft + paddingRight}px)`
            : `${bannerWidth}%`,
          height: finalBannerHeight,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: config.banner_padding_top,
          paddingBottom: config.banner_padding_bottom,
          margin: config.banner_full_width ? `0 -${paddingLeft}px` : '0 auto',
          overflow: 'hidden',
          outline: inspectActive === 'banner' ? '2px solid #1a9de0' : inspectHover === 'banner' ? '2px dashed #1a9de0' : undefined,
          cursor: 'pointer',
        }}
        onMouseEnter={() => setInspectHover('banner')}
        onMouseLeave={() => setInspectHover(null)}
        onClick={(e) => { e.stopPropagation(); setInspectActive('banner'); onRequestSection('banner'); }}
      >
        <img
          src={bannerImage}
          alt="Banner"
          style={{
            width: '100%',
            height: config.banner_fit_mode === 'adapt' ? 'auto' : '100%',
            objectFit: bannerObjectFit,
            display: 'block',
          }}
        />
      </div>
    );
  };

  // Interactive Preview State
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [cardQtys, setCardQtys] = useState({}); // {productId: qty}

  // --- Banner Slider Logic ---
  const [currentSlide, setCurrentSlide] = useState(0);
  const banners = useMemo(
    () =>
      [
        {
          image: config.banner_1_image,
          title: config.banner_1_title,
          subtitle: config.banner_1_subtitle,
        },
        {
          image: config.banner_2_image,
          title: config.banner_2_title,
          subtitle: config.banner_2_subtitle,
        },
        {
          image: config.banner_3_image,
          title: config.banner_3_title,
          subtitle: config.banner_3_subtitle,
        },
      ].filter((b) => b.image),
    [
      config.banner_1_image,
      config.banner_1_title,
      config.banner_1_subtitle,
      config.banner_2_image,
      config.banner_2_title,
      config.banner_2_subtitle,
      config.banner_3_image,
      config.banner_3_title,
      config.banner_3_subtitle,
    ]
  );

  useEffect(() => {
    if (!config.enable_banner_slider || banners.length <= 1) return;
    const interval = setInterval(
      () => {
        setCurrentSlide((prev) => (prev + 1) % banners.length);
      },
      (config.slider_speed || 5) * 1000
    );
    return () => clearInterval(interval);
  }, [config.enable_banner_slider, config.slider_speed, banners.length]);

  // --- Advanced Timer Logic ---
  const [bundleIndex, setBundleIndex] = useState(0);
  const titles = useMemo(
    () => (config.bundle_titles || '').split(',').filter((t) => t.trim()),
    [config.bundle_titles]
  );
  const subtitles = useMemo(
    () => (config.bundle_subtitles || '').split(',').filter((t) => t.trim()),
    [config.bundle_subtitles]
  );

  const [timeLeft, setTimeLeft] = useState(() => {
    return (
      Number(config.timer_hours || 0) * 3600 +
      Number(config.timer_minutes || 0) * 60 +
      Number(config.timer_seconds || 0)
    );
  });

  useEffect(() => {
    const totalSeconds =
      Number(config.timer_hours || 0) * 3600 +
      Number(config.timer_minutes || 0) * 60 +
      Number(config.timer_seconds || 0);
    setTimeLeft(totalSeconds);
  }, [config.timer_hours, config.timer_minutes, config.timer_seconds]);

  useEffect(() => {
    if (timeLeft <= 0) {
      if (config.auto_reset_timer) {
        const totalSeconds =
          Number(config.timer_hours || 0) * 3600 +
          Number(config.timer_minutes || 0) * 60 +
          Number(config.timer_seconds || 0);
        setTimeLeft(totalSeconds);
        if (config.change_bundle_on_timer_end && titles.length > 0) {
          setBundleIndex((prev) => (prev + 1) % titles.length);
        }
      }
      return;
    }
    const timer = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [
    timeLeft,
    config.auto_reset_timer,
    config.change_bundle_on_timer_end,
    titles.length,
    config.timer_hours,
    config.timer_minutes,
    config.timer_seconds,
  ]);

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return {
      h: String(h).padStart(2, '0'),
      m: String(m).padStart(2, '0'),
      s: String(s).padStart(2, '0'),
    };
  };
  const time = formatTime(timeLeft);
  const totalItems = selectedProducts.reduce(
    (sum, p) => sum + (Number(p.quantity) || 0),
    0
  );
  const discountThreshold = parseInt(config.max_products) || 5;

  // Shared design tokens (moved here so totalItems is in scope)
  const primaryColor = (
    config.primary_color ||
    config.selection_highlight_color ||
    '#008060'
  ).trim();
  const successColor = (config.progress_success_color || '#28a745').trim();
  const barBgColor =
    totalItems >= discountThreshold
      ? successColor
      : (config.progress_bar_color || primaryColor).trim();

  const handleQtyChange = (pid, val, source = 'all') => {
    const qty = Math.max(0, parseInt(val) || 0);
    const maxSel = parseInt(config.max_products) || 5;

    if (qty === 0) {
      handleRemoveProduct(pid, source);
      return;
    }

    setSelectedProducts((selected) => {
      const item = selected.find(
        (p) => String(p.id) === String(pid) && p.source === source
      );
      if (!item) return selected;

      const otherQtySum = selected
        .filter((p) => !(String(p.id) === String(pid) && p.source === source))
        .reduce((sum, p) => sum + (Number(p.quantity) || 0), 0);

      const currentQtyInSource = selected
        .filter((p) => p.source === source && !(String(p.id) === String(pid)))
        .reduce((sum, p) => sum + (Number(p.quantity) || 0), 0);

      let sourceLimit = 999;
      if (source.startsWith('step_')) {
        const stepIdx = source.replace('step_', '');
        sourceLimit = parseInt(config[`step_${stepIdx}_limit`]) || 999;
      } else if (source !== 'all') {
        for (let i = 1; i <= 4; i++) {
          if (config[`col_${i}`] === source) {
            sourceLimit = parseInt(config[`col_${i}_limit`]) || 999;
            break;
          }
        }
      }

      const allowedByGlobal = maxSel - otherQtySum;
      const allowedBySource = sourceLimit - currentQtyInSource;
      const finalAllowed = Math.max(
        1,
        Math.min(qty, allowedByGlobal, allowedBySource)
      );

      if (finalAllowed < qty) {
        shopify.toast.show(
          `Limit reached! Max allowed here is ${finalAllowed}`,
          { isError: true }
        );
      }

      setCardQtys((prev) => ({ ...prev, [pid]: finalAllowed }));
      return selected.map((p) =>
        String(p.id) === String(pid) && p.source === source
          ? { ...p, quantity: finalAllowed }
          : p
      );
    });
  };

  const handleInc = (pid, variant = null, source = 'all') => {
    const isSelected = selectedProducts.some(
      (p) => String(p.id) === String(pid) && p.source === source
    );
    const product = products.find((p) => String(p.id) === String(pid));
    if (!product) return;

    const currentQtyInSource = selectedProducts
      .filter((p) => p.source === source)
      .reduce((sum, p) => sum + (Number(p.quantity) || 0), 0);

    let sourceLimit = 999;
    if (source.startsWith('step_')) {
      const stepIdx = source.replace('step_', '');
      sourceLimit = parseInt(config[`step_${stepIdx}_limit`]) || 999;
    } else if (source !== 'all') {
      // For layout 2/3 category handles
      for (let i = 1; i <= 4; i++) {
        if (config[`col_${i}`] === source) {
          sourceLimit = parseInt(config[`col_${i}_limit`]) || 999;
          break;
        }
      }
    }

    if (currentQtyInSource >= sourceLimit) {
      shopify.toast.show(
        `Limit reached for this category! (Max ${sourceLimit} items)`,
        { isError: true }
      );
      return;
    }

    const currentTotalQty = selectedProducts.reduce(
      (sum, p) => sum + (Number(p.quantity) || 0),
      0
    );
    const maxThreshold = parseInt(config.max_products) || 5;

    if (!isSelected) {
      if (currentTotalQty >= maxThreshold) {
        shopify.toast.show(
          `Global limit reached! You can only add up to ${maxThreshold} items.`,
          { isError: true }
        );
        return;
      }
      handleAddProduct(product, 1, variant, source);
    } else {
      handleQtyChange(pid, (cardQtys[pid] || 0) + 1, source);

      // Motivation/Unlocked Toast Notification
      const nextTotal = currentTotalQty + 1;
      if (nextTotal >= discountThreshold) {
        shopify.toast.show(
          config.discount_unlocked_text || 'Discount Unlocked! 🎉'
        );
      } else {
        const remaining = discountThreshold - nextTotal;
        const motivation = (
          config.discount_motivation_text ||
          'Add {{remaining}} more items to unlock the discount!'
        ).replace('{{remaining}}', remaining);
        shopify.toast.show(motivation);
      }
    }
  };

  const handleDec = (pid, source = 'all') => {
    const isSelected = selectedProducts.some(
      (p) => String(p.id) === String(pid) && p.source === source
    );
    if (!isSelected) return;
    const item = selectedProducts.find(
      (p) => String(p.id) === String(pid) && p.source === source
    );
    const currentQty =
      cardQtys[pid] !== undefined ? cardQtys[pid] : item?.quantity;
    handleQtyChange(pid, currentQty - 1, source);
  };

  const handleAddProduct = (
    product,
    initialQty,
    variant = null,
    source = 'all'
  ) => {
    const qty = initialQty || cardQtys[product.id] || 1;
    const selectedVariant =
      variant ||
      (product.variants || []).find(
        (v) => String(v.id) === String(selectedVariants[product.id])
      ) ||
      (product.variants && product.variants[0]);
    if (!selectedVariant) return;

    const currentTotalQty = selectedProducts.reduce(
      (sum, p) => sum + (Number(p.quantity) || 0),
      0
    );
    const maxThreshold = parseInt(config.max_products) || 5;

    if (currentTotalQty + Number(qty) > maxThreshold) {
      shopify.toast.show(
        `Global limit reached! You can only add up to ${maxThreshold} items.`,
        { isError: true }
      );
      return;
    }

    // Check source-specific limit
    const currentQtyInSource = selectedProducts
      .filter((p) => p.source === source)
      .reduce((sum, p) => sum + (Number(p.quantity) || 0), 0);

    let sourceLimit = 999;
    if (source.startsWith('step_')) {
      const stepIdx = source.replace('step_', '');
      sourceLimit = parseInt(config[`step_${stepIdx}_limit`]) || 999;
    } else if (source !== 'all') {
      for (let i = 1; i <= (config.tab_count || 4); i++) {
        if (config[`col_${i}`] === source) {
          sourceLimit = parseInt(config[`col_${i}_limit`]) || 999;
          break;
        }
      }
    }

    if (currentQtyInSource + Number(qty) > sourceLimit) {
      shopify.toast.show(
        `Limit reached for this category! (Max ${sourceLimit} items)`,
        { isError: true }
      );
      return;
    }

    const newItem = {
      id: product.id,
      variantId: selectedVariant.id,
      image:
        selectedVariant.image?.src ||
        selectedVariant.image?.url ||
        product.image?.src ||
        product.image?.url ||
        product.featuredMedia?.preview?.image?.url ||
        product.images?.nodes?.[0]?.url ||
        'https://placehold.co/100x100',
      price: parseFloat(selectedVariant.price || 0),
      quantity: Number(qty),
      source: source,
    };

    setSelectedProducts([...selectedProducts, newItem]);
    setCardQtys((prev) => ({ ...prev, [product.id]: Number(qty) }));

    // Motivation/Unlocked Toast Notification (only for initial adds, handleInc handles others)
    const nextTotal = currentTotalQty + Number(qty);
    if (nextTotal >= discountThreshold) {
      shopify.toast.show(
        config.discount_unlocked_text || 'Discount Unlocked! 🎉'
      );
    } else {
      const remaining = discountThreshold - nextTotal;
      const motivation = (
        config.discount_motivation_text ||
        'Add {{remaining}} more items to unlock the discount!'
      ).replace('{{remaining}}', remaining);
      shopify.toast.show(motivation);
    }
  };

  const handleRemoveProduct = (productId, source = 'all') => {
    setSelectedProducts(
      selectedProducts.filter(
        (p) => !(String(p.id) === String(productId) && p.source === source)
      )
    );
    setCardQtys((prev) => ({ ...prev, [productId]: 0 }));
  };

  const totalPrice = selectedProducts.reduce(
    (sum, p) => sum + p.price * (p.quantity || 0),
    0
  );

  const selectedDiscount =
    config.has_discount_offer && config.selected_discount_id
      ? activeDiscounts.find(
        (d) => String(d.id) === String(config.selected_discount_id)
      )
      : null;

  const discountType = selectedDiscount?.valueType
    || (selectedDiscount?.type === 'DiscountCodeBasic' ? 'percentage' : null)
    || config.discount_selection;
  const discountVal = selectedDiscount?.value
    ? parseFloat(selectedDiscount.value)
    : parseFloat(config.discount_amount) || 0;
  const hasDiscount =
    !!discountType && !Number.isNaN(discountVal) && discountVal > 0;
  const discountedPrice =
    String(discountType).toLowerCase() === 'percentage'
      ? totalPrice * (1 - discountVal / 100)
      : Math.max(0, totalPrice - discountVal);
  const finalPrice = hasDiscount ? discountedPrice : totalPrice;

  const renderTabs = () => {
    if (config.layout !== 'layout2') return null;
    const tabNavigationMode = config.tab_navigation_mode || 'scroll';
    const showTabArrows = tabNavigationMode === 'arrows';

    const scrollTabsBy = (delta) => {
      const el = tabScrollRef.current;
      if (!el) return;
      el.scrollBy({ left: delta, behavior: 'smooth' });
    };

    const tabContainerStyles = {
      padding: '12px 20px',
      display: 'flex',
      justifyContent: config.tab_alignment || 'left',
      gap: '10px',
      overflowX: showTabArrows ? 'hidden' : 'auto',
      borderBottom: '1px solid #eee',
      background: '#fff',
      WebkitOverflowScrolling: 'touch',
      scrollBehavior: 'smooth',
      touchAction: tabNavigationMode === 'slide_touch' ? 'pan-x' : 'auto',
      scrollbarWidth: tabNavigationMode === 'scroll' ? 'thin' : 'none',
      msOverflowStyle: tabNavigationMode === 'scroll' ? 'auto' : 'none',
    };

    const tabs = [];
    if (config.show_tab_all !== false) {
      tabs.push({ label: config.tab_all_label || 'Collections', value: 'all' });
    }
    for (let i = 1; i <= (config.tab_count || 8); i++) {
      const handle = config[`col_${i}`];
      if (handle) {
        const col = (collections || []).find((c) => c.handle === handle);
        tabs.push({
          label: col ? col.title : config[`step_${i}_title`] || handle,
          value: handle,
        });
      }
    }
    if (tabs.length === 0) return null;

    return (
      <div
        style={{
          width: `${config.tabs_width || 100}%`,
          margin: '0 auto',
          marginTop: `${config.tab_margin_top ?? 0}px`,
          marginBottom: `${config.tab_margin_bottom ?? 24}px`,
          position: 'relative',
        }}
      >
        {showTabArrows && (
          <button
            type="button"
            className="cdo-arrow-btn"
            aria-label="Scroll tabs left"
            onClick={() => scrollTabsBy(-220)}
            style={{ left: 6 }}
          >
            ←
          </button>
        )}
        <div
          ref={tabScrollRef}
          style={tabContainerStyles}
          className={`cdo-slider-horizontal ${tabNavigationMode === 'scroll' ? 'cdo-tabs-scroll-visible' : ''}`}
        >
          {tabs.map((tab, idx) => {
            const isActive = activeTab === tab.value;
            const activeBg =
              config.tab_active_bg_color ||
              config.selection_highlight_color ||
              '#5e1c5f';
            return (
              <button
                key={idx}
                onClick={() => setActiveTab(tab.value)}
                style={{
                  padding: `${config.tab_padding_vertical || 8}px ${config.tab_padding_horizontal || 18}px`,
                  borderRadius: `${config.tab_border_radius ?? 25}px`,
                  border: `1px solid ${isActive ? activeBg : config.tab_border_color || '#eee'}`,
                  background: isActive
                    ? activeBg
                    : config.tab_bg_color || '#fff',
                  color: isActive
                    ? config.tab_active_text_color || '#fff'
                    : config.tab_text_color || '#444',
                  fontSize: `${config.tab_font_size || 13}px`,
                  fontWeight: '600',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.3s ease',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        {showTabArrows && (
          <button
            type="button"
            className="cdo-arrow-btn"
            aria-label="Scroll tabs right"
            onClick={() => scrollTabsBy(220)}
            style={{ right: 6 }}
          >
            →
          </button>
        )}
      </div>
    );
  };

  const renderProgressBar = () => {
    if (!config.show_progress_bar) return null;
    const percent =
      discountThreshold > 0
        ? Math.min(100, Math.floor((totalItems / discountThreshold) * 100))
        : 0;
    const isDiscountUnlocked = totalItems >= discountThreshold;
    const remaining = Math.max(0, discountThreshold - totalItems);
    const rawColor = (config.progress_bar_color || '#1a6644').trim();
    const successColor = (config.progress_success_color || '#28a745').trim();
    const textColor = (config.progress_text_color || '#000').trim();
    const barColor = isDiscountUnlocked ? successColor : rawColor;

    return (
      <div
        style={{
          width: `${config.progress_bar_width || 100}%`,
          margin: '15px auto 25px',
          background: 'transparent',
          padding: '0 5px',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            fontSize: '13px',
            fontWeight: '700',
            marginBottom: '12px',
          }}
        >
          <div>
            {isDiscountUnlocked ? (
              <span
                style={{
                  fontWeight: 700,
                  color: textColor,
                  textTransform: 'uppercase',
                }}
              >
                {config.discount_unlocked_text || 'DISCOUNT UNLOCKED!'}
              </span>
            ) : (
              <span
                style={{
                  textTransform: 'uppercase',
                  fontWeight: 700,
                  color: textColor,
                  letterSpacing: '0.5px',
                }}
              >
                ADD {remaining} MORE FOR {config.discount_text || 'DISCOUNT'}
              </span>
            )}
          </div>
          <div style={{ color: textColor, fontWeight: 800 }}>{percent}%</div>
        </div>
        <div
          style={{
            height: '12px',
            borderRadius: '12px',
            width: '100%',
            boxSizing: 'border-box',
            background: '#e0e0e0',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${percent}%`,
              background: barColor,
              borderRadius: '12px',
              transition:
                'width 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.4s',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: '0 0 10px rgba(0,0,0,0.05)',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background:
                  'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)',
                transform: 'translateX(-100%)',
                animation: 'combo-shimmer 2s infinite',
              }}
            />
          </div>
        </div>
      </div>
    );
  };

  const renderPreviewBar = () => (
    <div
      style={{ outline: inspectActive === 'previewBar' ? '2px solid #1a9de0' : inspectHover === 'previewBar' ? '2px dashed #1a9de0' : undefined, cursor: 'pointer' }}
      onMouseEnter={() => setInspectHover('previewBar')}
      onMouseLeave={() => setInspectHover(null)}
      onClick={(e) => { e.stopPropagation(); setInspectActive('previewBar'); onRequestSection('previewBar'); }}
    >
      <CdoPreviewBar
        config={config}
        selectedProducts={selectedProducts}
        totalPrice={totalPrice}
        finalPrice={finalPrice}
        isMobile={isMobile}
      />
    </div>
  );

  const handleVariantChange = (productId, variantId) => {
    setSelectedVariants((prev) => ({ ...prev, [productId]: variantId }));
    setSelectedProducts((prev) =>
      prev.map((item) => {
        if (String(item.id) === String(productId)) {
          const prod = products.find((p) => String(p.id) === String(productId));
          const variant = prod?.variants?.find(
            (v) => String(v.id) === String(variantId)
          );
          if (variant) {
            return {
              ...item,
              variantId: variant.id,
              price: parseFloat(variant.price || 0),
              image: variant.image?.src || prod.image?.src,
            };
          }
        }
        return item;
      })
    );
  };

  const ProductCardItem = ({ product, source = 'all' }) => {
    const [isHovered, setIsHovered] = useState(false);
    const [showPopup, setShowPopup] = useState(false);
    const [showPreviewModal, setShowPreviewModal] = useState(false);

    const hasVariants = product.variants && product.variants.length > 1;
    const selectedVariantId =
      selectedVariants[product.id] ||
      (product.variants && product.variants[0]?.id);
    const selectedVariant =
      (product.variants || []).find((v) => v.id === selectedVariantId) ||
      (product.variants && product.variants[0]);

    const isSelected = selectedProducts.some(
      (p) => String(p.id) === String(product.id) && p.source === source
    );
    const previewVisibility = config.preview_icon_visibility || 'static';
    const showPreviewIcon =
      previewVisibility === 'static' || isHovered || isMobile;
    const previewImages = (product.images?.nodes || [])
      .slice(1, 4)
      .map((img) => img?.url)
      .filter(Boolean);

    const onAddClick = () => {
      if (isSelected) {
        if (!config.show_quantity_selector) {
          handleRemoveProduct(product.id, source);
        } else {
          handleInc(product.id, selectedVariant, source);
        }
      } else {
        if (hasVariants && config.product_card_variants_display === 'popup') {
          setShowPopup(true);
        } else {
          handleAddProduct(product, 1, selectedVariant, source);
        }
      }
    };

    return (
      <div
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={onAddClick}
        style={{
          cursor: 'pointer',
          border: isSelected
            ? `2px solid ${config.selection_highlight_color || '#5e1c5f'}`
            : isHovered && !isMobile
              ? '2px solid #ccc'
              : '2px solid #eee',
          borderRadius: config.card_border_radius || 12,
          overflow: 'hidden',
          background: 'white',
          width: '100%',
          margin: 0,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          justifyContent: 'space-between',
          transition: 'transform 0.3s ease, box-shadow 0.3s ease',
          transform:
            isHovered && !isMobile ? 'translateY(-6px)' : 'translateY(0)',
          boxShadow:
            isHovered && !isMobile
              ? '0 10px 20px rgba(0,0,0,0.1)'
              : '0 2px 4px rgba(0,0,0,0.05)',
        }}
      >
        {/* Variant Selection Popup Overlay */}
        {showPopup && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(255,255,255,0.98)',
              zIndex: 200,
              display: 'flex',
              flexDirection: 'column',
              padding: isMobile ? '8px' : '12px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: isMobile ? '8px' : '12px',
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  fontWeight: '700',
                  fontSize: isMobile ? '10px' : '12px',
                  textTransform: 'uppercase',
                  color: '#666',
                }}
              >
                Pick Options
              </span>
              <button
                onClick={() => setShowPopup(false)}
                style={{
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: isMobile ? '18px' : '20px',
                  lineHeight: 1,
                }}
              >
                &times;
              </button>
            </div>
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: isMobile ? '6px' : '8px',
              }}
            >
              {product.variants.map((v) => (
                <div
                  key={v.id}
                  onClick={() => {
                    handleVariantChange(product.id, v.id);
                    handleAddProduct(product, 1, v, source);
                    setShowPopup(false);
                  }}
                  style={{
                    padding: isMobile ? '8px' : '10px',
                    border: '1px solid #eee',
                    borderRadius: '8px',
                    textAlign: 'center',
                    fontSize: isMobile ? '11px' : '13px',
                    fontWeight: '600',
                    background:
                      selectedVariantId === v.id
                        ? config.selection_highlight_color
                        : '#f9f9f9',
                    color: selectedVariantId === v.id ? '#fff' : '#333',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {v.title}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Selection Tick */}
        {isSelected && config.show_selection_tick && (
          <div
            style={{
              position: 'absolute',
              top: isMobile ? 4 : 8,
              right: isMobile ? 4 : 8,
              background: config.selection_highlight_color,
              color: 'white',
              width: isMobile ? 18 : 22,
              height: isMobile ? 18 : 22,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: isMobile ? 10 : 12,
              zIndex: 2,
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
            }}
          >
            ✓
          </div>
        )}

        <div
          style={{
            width: '100%',
            aspectRatio: productImageAspectRatio,
            height: supportsAspectRatio ? 'auto' : productImageHeight,
            background: '#f5f5f5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <img
            src={
              selectedVariant?.image?.src ||
              selectedVariant?.image?.url ||
              product.image?.src ||
              product.image?.url ||
              product.featuredMedia?.preview?.image?.url ||
              product.images?.nodes?.[0]?.url ||
              'https://placehold.co/300x300?text=Product'
            }
            alt={product.title}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transition: 'transform 0.3s ease, opacity 0.3s ease',
              transform:
                isHovered && config.enable_product_hover
                  ? 'scale(1.05)'
                  : 'scale(1)',
              opacity: isHovered && config.enable_product_hover ? 0 : 1,
            }}
          />

          {showPreviewIcon && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowPreviewModal(true);
              }}
              title="Preview Product"
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                width: 34,
                height: 34,
                border: 'none',
                borderRadius: '999px',
                background: 'rgba(17,17,17,0.82)',
                color: '#fff',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                zIndex: 0,
              }}
            >
              <svg
                viewBox="0 0 24 24"
                style={{ width: 18, height: 18, fill: 'currentColor' }}
              >
                <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
              </svg>
            </button>
          )}

          {/* Product Hover Overlay Elements */}
          {config.enable_product_hover && isHovered && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                background: 'rgba(255, 255, 255, 0.95)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '12px',
                boxSizing: 'border-box',
                textAlign: 'center',
                zIndex: 0,
              }}
            >
              {config.product_hover_mode === 'second_image' &&
                product.secondImageSrc ? (
                <img
                  src={product.secondImageSrc}
                  alt="Hover view"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : config.product_hover_mode === 'description' &&
                product.descriptionHtml ? (
                <div
                  style={{
                    fontSize: '13px',
                    color: '#333',
                    lineHeight: 1.5,
                    fontWeight: 500,
                    display: '-webkit-box',
                    WebkitLineClamp: 6,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                  dangerouslySetInnerHTML={{ __html: product.descriptionHtml }}
                />
              ) : null}
            </div>
          )}

          {/* Hover Variants Popup */}
          {hasVariants &&
            config.product_card_variants_display === 'hover' &&
            isHovered && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  background: 'rgba(255,255,255,0.95)',
                  padding: '10px',
                  borderTop: '1px solid #eee',
                  zIndex: 3,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '4px',
                  maxHeight: '80px',
                  overflowY: 'auto',
                }}
              >
                {product.variants.map((v) => (
                  <div
                    key={v.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleVariantChange(product.id, v.id);
                    }}
                    style={{
                      fontSize: '10px',
                      padding: '2px 6px',
                      border:
                        selectedVariantId === v.id
                          ? `1px solid ${config.selection_highlight_color}`
                          : '1px solid #ddd',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      background:
                        selectedVariantId === v.id
                          ? config.selection_highlight_color
                          : 'white',
                      color: selectedVariantId === v.id ? 'white' : 'black',
                    }}
                  >
                    {v.title}
                  </div>
                ))}
              </div>
            )}
        </div>

        <Modal
          open={showPreviewModal}
          onClose={() => setShowPreviewModal(false)}
          title={product.title || 'Product Preview'}
          large
        >
          <Modal.Section>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : '1.2fr 1fr',
                gap: 16,
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: isMobile
                    ? 'repeat(2, minmax(0, 1fr))'
                    : 'repeat(3, minmax(0, 1fr))',
                  gap: 8,
                }}
              >
                {previewImages.length ? (
                  previewImages.map((src, idx) => (
                    <div
                      key={`${product.id}-preview-${idx}`}
                      style={{
                        borderRadius: 8,
                        overflow: 'hidden',
                        background: '#f6f6f7',
                        minHeight: 100,
                      }}
                    >
                      <img
                        src={src}
                        alt={`${product.title} preview ${idx + 2}`}
                        loading="lazy"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: 'block',
                        }}
                      />
                    </div>
                  ))
                ) : (
                  <div
                    style={{
                      gridColumn: '1 / -1',
                      border: '1px dashed #c9cccf',
                      borderRadius: 8,
                      padding: 16,
                      textAlign: 'center',
                      color: '#6d7175',
                    }}
                  >
                    Additional product images are not available.
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
                  {product.title}
                </div>
                <div
                  style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}
                >
                  Rs.{selectedVariant?.price || 0}
                </div>
                <div
                  style={{ fontSize: 13, lineHeight: 1.6, color: '#3d3d3d' }}
                  dangerouslySetInnerHTML={{
                    __html:
                      product.descriptionHtml || 'No description available.',
                  }}
                />
              </div>
            </div>
          </Modal.Section>
        </Modal>

        <div style={{ padding: productCardPadding }}>
          {/* Variants Display - Below Image (always shown when product has multiple variants) */}
          {hasVariants && (
            <div
              style={{ marginBottom: 10 }}
              onClick={(e) => e.stopPropagation()}
            >
              <Select
                label="Variant"
                options={product.variants.map((v) => ({
                  label: v.title,
                  value: String(v.id),
                }))}
                value={selectedVariantId ? String(selectedVariantId) : ''}
                onChange={(v) => handleVariantChange(product.id, v)}
              />
            </div>
          )}

          <div
            style={{
              fontWeight: 500,
              marginBottom: 4,
              fontSize: `${productTitleSize}px`,
            }}
          >
            {product.title}
          </div>

          <div
            style={{
              fontWeight: 600,
              marginBottom: 8,
              fontSize: `${productPriceSize}px`,
            }}
          >
            Rs.{selectedVariant?.price || 0}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: 6,
              borderTop: '1px solid #eee',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
            }}
          >
            {(config.show_quantity_selector !== false) && (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDec(product.id, source);
                  }}
                  style={{
                    width: 32,
                    height: 32,
                    border: '1px solid #ddd',
                    background: '#f9f9f9',
                    borderRadius: '4px 0 0 4px',
                    cursor: 'pointer',
                    fontSize: 18,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1,
                  }}
                >
                  −
                </button>
                <input
                  type="number"
                  min="1"
                  value={cardQtys[product.id] || 0}
                  onChange={(e) =>
                    handleQtyChange(product.id, e.target.value, source)
                  }
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: 35,
                    height: 32,
                    border: '1px solid #ddd',
                    borderLeft: 'none',
                    borderRight: 'none',
                    textAlign: 'center',
                    fontWeight: 600,
                    fontSize: 14,
                    WebkitAppearance: 'none',
                    margin: 0,
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleInc(product.id, selectedVariant, source);
                  }}
                  style={{
                    width: 32,
                    height: 32,
                    border: '1px solid #ddd',
                    background: '#f9f9f9',
                    borderRadius: '0 4px 4px 0',
                    cursor: 'pointer',
                    fontSize: 18,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1,
                  }}
                >
                  +
                </button>
              </div>
            )}
            {config.show_add_to_cart_btn && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddClick();
                }}
                style={{
                  background: isSelected
                    ? '#ff4d4d'
                    : config.add_btn_bg ||
                    config.product_add_btn_color ||
                    '#000',
                  color: isSelected
                    ? '#fff'
                    : config.add_btn_text_color ||
                    config.product_add_btn_text_color ||
                    '#fff',
                  border: 'none',
                  padding: '8px 12px',
                  borderRadius: config.add_btn_border_radius ?? 8,
                  cursor: 'pointer',
                  fontWeight:
                    config.add_btn_font_weight ||
                    config.product_add_btn_font_weight ||
                    600,
                  fontSize: isMobile
                    ? (config.add_btn_font_size_mobile ??
                      config.add_btn_font_size ??
                      config.product_add_btn_font_size ??
                      14)
                    : (config.add_btn_font_size ??
                      config.product_add_btn_font_size ??
                      14),
                  marginLeft: 4,
                  transition: 'all 0.2s',
                }}
              >
                {config.add_btn_text || config.product_add_btn_text || 'Add'}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderProductsGrid = () => {
    if (isLoading) {
      return (
        <div
          style={{
            padding: '80px 20px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div className="combo-spinner-new"></div>
          <p style={{ marginTop: '20px', color: '#6d7175', fontWeight: '500' }}>
            {config.loading_text || 'Loading products...'}
          </p>
        </div>
      );
    }

    const isSlider = config.grid_layout_type === 'slider';
    let filteredProducts = filterPreviewProductsByStock(products || [], config);

    // Resolve which collection handle should filter the preview grid.
    // layout2 "All" tab → use first configured collection (fetch already used it).
    // layout2 specific tab → use that tab's handle.
    // Other layouts → use config.collection_handle / step_1_collection.
    let currentHandle = '';
    if (config.layout === 'layout2') {
      currentHandle =
        activeTab !== 'all'
          ? activeTab
          : config.col_1 ||
          config.col_2 ||
          config.col_3 ||
          config.col_4 ||
          config.col_5 ||
          config.col_6 ||
          config.col_7 ||
          config.col_8 ||
          '';
    } else {
      currentHandle = config.collection_handle || config.step_1_collection || '';
    }

    if (currentHandle) {
      const collectionFiltered = filteredProducts.filter((p) =>
        (p.collections || []).some((c) => c.handle === currentHandle)
      );
      // If products carry the collections field (from the server-side loader),
      // use the filtered list; otherwise the server already filtered by handle,
      // so all fetched products belong to the right collection.
      if (collectionFiltered.length > 0) {
        filteredProducts = collectionFiltered;
      }
    }

    // Fall back to unfiltered real products, then demo products only when no real products exist at all.
    const hasRealProducts = (products || []).length > 0;
    let usingDemo = false;
    if (filteredProducts.length === 0) {
      if (hasRealProducts) {
        // Show all real products ignoring stock/collection filter so preview is never blank
        filteredProducts = products;
      } else {
        usingDemo = true;
        filteredProducts = DEMO_PRODUCTS;
      }
    }

    return (
      <div style={{ width: `${config.grid_width || 100}%`, margin: '0 auto' }}>
        {usingDemo && (
          <div
            style={{
              background: '#fff8e1',
              border: '1px solid #ffe082',
              borderRadius: 6,
              padding: '6px 12px',
              marginBottom: 12,
              fontSize: 12,
              color: '#795548',
              textAlign: 'center',
            }}
          >
            No products found. Select a collection above to display your real Shopify products here.
          </div>
        )}
        <div style={{ position: 'relative', width: '100%' }}>
          {isSlider && (
            <>
              <button
                className="cdo-arrow-btn"
                onClick={() =>
                  sliderRef.current?.scrollBy({
                    left: -300,
                    behavior: 'smooth',
                  })
                }
                style={{ left: '10px' }}
              >
                ←
              </button>
              <button
                className="cdo-arrow-btn"
                onClick={() =>
                  sliderRef.current?.scrollBy({ left: 300, behavior: 'smooth' })
                }
                style={{ right: '10px' }}
              >
                →
              </button>
            </>
          )}
          <div
            ref={sliderRef}
            className={isSlider ? 'cdo-slider-horizontal' : 'cdo-grid-vertical'}
            style={{
              display: isSlider ? 'flex' : 'grid',
              gridTemplateColumns: isSlider
                ? 'none'
                : `repeat(${effectiveColumns}, minmax(0, 1fr))`,
              flexDirection: isSlider ? 'row' : 'column',
              flexWrap: 'nowrap',
              gap: gridGap,
              paddingTop: config.products_padding_top,
              paddingBottom: config.products_padding_bottom,
              width: '100%',
              boxSizing: 'border-box',
              alignItems: 'stretch',
              marginTop: config.products_margin_top,
              marginBottom: config.products_margin_bottom,
              overflowX: isSlider ? 'auto' : 'visible',
              overflowY: 'hidden',
              WebkitOverflowScrolling: 'touch',
              scrollSnapType: isSlider ? 'x mandatory' : 'none',
              paddingLeft: isSlider ? '20px' : '0',
              paddingRight: isSlider ? '20px' : '0',
              scrollbarWidth: 'none',
            }}
          >
            {filteredProducts.map((product) => (
              <div
                key={product.id}
                style={{
                  minWidth: isSlider ? (isMobile ? '220px' : '280px') : 'auto',
                  width: isSlider ? (isMobile ? '220px' : '280px') : 'auto',
                  flexShrink: 0,
                  scrollSnapAlign: 'start',
                }}
              >
                <ProductCardItem product={product} source={activeTab} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  let sectionOrder;
  const progressSec = config.show_progress_bar ? [renderProgressBar] : [];

  if (config.layout === 'layout2') {
    // For Combo Design Two: Banner → Progress → Title → Tabs → Preview → Products
    sectionOrder = [
      renderBanner,
      ...progressSec,
      renderTitleDescription,
      renderTabs,
      renderProductsGrid,
    ];
  } else if (config.new_option_dropdown === 'option2') {
    sectionOrder = [
      ...progressSec,
      renderTitleDescription,
      renderBanner,
      renderTabs,
      renderProductsGrid,
    ];
  } else if (config.new_option_dropdown === 'option3') {
    sectionOrder = [
      ...progressSec,
      renderProductsGrid,
      renderBanner,
      renderTabs,
      renderTitleDescription,
    ];
  } else if (config.new_option_dropdown === 'option4') {
    sectionOrder = [
      ...progressSec,
      renderTitleDescription,
      renderBanner,
      renderTabs,
      renderProductsGrid,
    ];
  } else if (config.new_option_dropdown === 'option5') {
    sectionOrder = [
      ...progressSec,
      renderBanner,
      renderTitleDescription,
      renderProductsGrid,
    ];
  } else if (
    config.new_option_dropdown === 'option6' ||
    config.new_option_dropdown === 'option7' ||
    config.layout === 'layout3'
  ) {
    sectionOrder = [
      ...progressSec,
      renderBanner,
      renderTitleDescription,
      renderProductsGrid,
    ];
  } else if (
    config.new_option_dropdown === 'option8' ||
    config.layout === 'layout4'
  ) {
    sectionOrder = [
      renderBanner,
      ...progressSec,
      renderTitleDescription,
      renderProductsGrid,
    ];
  } else if (config.new_option_dropdown === 'option9') {
    sectionOrder = [
      ...progressSec,
      renderBanner,
      renderTitleDescription,
      renderProductsGrid,
    ];
  } else {
    sectionOrder = [
      ...progressSec,
      renderBanner,
      renderTabs,
      renderTitleDescription,
      renderProductsGrid,
    ];
  }

  const renderGlobalStickyBar = () => {
    // Sticky Preview Bar has been removed per user request
    return null;
  };

  // === Layout 3 (FMCG / App Style) Specific Rendering ===
  if (config.layout === 'layout3') {
    const primaryColor = config.primary_color || '#20D060';
    const bgColor = '#eef2f7';
    const textColor = config.text_color || '#111';
    const progressTextColor = config.progress_text_color || textColor;
    const topProgressFillColor =
      totalItems >= discountThreshold
        ? config.progress_success_color || '#28a745'
        : config.progress_bar_color || '#1a6644';

    return (
      <div
        style={{
          background: bgColor,
          fontFamily: 'inherit',
          color: textColor,
          minHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          borderRadius: '12px',
          overflow: 'hidden',
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
          maxWidth: '480px', // App-like width constraint for preview
          margin: '0 auto',
        }}
      >
        {/* App Header */}

        <div style={{ paddingBottom: '100px' }}>
          {' '}
          {/* Scroll Content */}
          {/* Hero Section */}
          {config.show_hero !== false && (
            <div style={{ padding: '16px 20px' }}>
              <div
                style={{
                  background: '#fff',
                  borderRadius: '20px',
                  padding: '16px',
                  boxShadow: '0 4px 15px rgba(0,0,0,0.03)',
                }}
              >
                <div
                  style={{
                    background: primaryColor,
                    color: '#000',
                    fontSize: '10px',
                    fontWeight: '800',
                    padding: '4px 10px',
                    borderRadius: '20px',
                    display: 'inline-block',
                    marginBottom: '12px',
                    textTransform: 'uppercase',
                  }}
                >
                  DEAL OF THE DAY
                </div>
                <div
                  style={{
                    width: '100%',
                    height:
                      config.banner_fit_mode === 'adapt' ? 'auto' : '160px',
                    background: '#f9f9f9',
                    borderRadius: '12px',
                    marginBottom: '16px',
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  {config.enable_banner_slider && banners.length > 1 ? (
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        position: 'relative',
                      }}
                    >
                      {banners.map((banner, idx) => (
                        <div
                          key={idx}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            opacity: currentSlide === idx ? 1 : 0,
                            transition: 'opacity 0.8s ease-in-out',
                            zIndex: currentSlide === idx ? 1 : 0,
                          }}
                        >
                          <img
                            src={banner.image}
                            alt={banner.title}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: bannerObjectFit,
                              display: 'block',
                            }}
                          />
                          <div
                            style={{
                              position: 'absolute',
                              bottom: 0,
                              left: 0,
                              right: 0,
                              background:
                                'linear-gradient(transparent, rgba(0,0,0,0.7))',
                              padding: '10px 15px',
                              color: 'white',
                            }}
                          >
                            <div
                              style={{ fontWeight: 'bold', fontSize: '14px' }}
                            >
                              {banner.title}
                            </div>
                            <div style={{ fontSize: '12px', opacity: 0.9 }}>
                              {banner.subtitle}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <img
                      src={
                        config.hero_image_url ||
                        SAMPLE_BANNER_IMAGE
                      }
                      alt="Hero"
                      style={{
                        width: '100%',
                        height:
                          config.banner_fit_mode === 'adapt' ? 'auto' : '100%',
                        objectFit:
                          config.banner_fit_mode === 'cover' ||
                            config.banner_fit_mode === 'contain'
                            ? config.banner_fit_mode
                            : 'cover',
                        display: 'block',
                      }}
                    />
                  )}
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '4px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '18px',
                      fontWeight: '800',
                      lineHeight: 1.2,
                      flex: 1,
                    }}
                  >
                    {titles[bundleIndex] ||
                      config.hero_title ||
                      'Mega Breakfast Bundle'}
                  </div>
                  <div
                    style={{
                      fontSize: '18px',
                      fontWeight: '800',
                      color: primaryColor,
                      marginLeft: '12px',
                    }}
                  >
                    {config.hero_price || '$14.99'}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    textDecoration: 'line-through',
                    color: '#bbb',
                    textAlign: 'right',
                    marginTop: '-4px',
                    marginBottom: '8px',
                  }}
                >
                  {config.hero_compare_price || '$24.50'}
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: '#888',
                    marginBottom: '16px',
                  }}
                >
                  {subtitles[bundleIndex] ||
                    config.hero_subtitle ||
                    'Milk, Bread, Eggs, Cereal & Juice'}
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '16px',
                    fontSize: '11px',
                    color: '#888',
                    fontWeight: '600',
                  }}
                >
                  ENDS IN:
                  <span
                    style={{
                      background: '#eafff2',
                      color: primaryColor,
                      padding: '4px 8px',
                      borderRadius: '6px',
                      fontWeight: '700',
                      fontSize: '13px',
                    }}
                  >
                    {time.h}
                  </span>{' '}
                  :
                  <span
                    style={{
                      background: '#eafff2',
                      color: primaryColor,
                      padding: '4px 8px',
                      borderRadius: '6px',
                      fontWeight: '700',
                      fontSize: '13px',
                    }}
                  >
                    {time.m}
                  </span>{' '}
                  :
                  <span
                    style={{
                      background: '#eafff2',
                      color: primaryColor,
                      padding: '4px 8px',
                      borderRadius: '6px',
                      fontWeight: '700',
                      fontSize: '13px',
                    }}
                  >
                    {time.s}
                  </span>
                </div>

                <button
                  style={{
                    width: '100%',
                    background: primaryColor,
                    color: '#000',
                    border: 'none',
                    padding: '14px',
                    borderRadius: '12px',
                    fontSize: '14px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                  }}
                >
                  {config.hero_btn_text || 'Add to Cart - Save 38%'}
                </button>
              </div>
            </div>
          )}
          {/* Progress Bar */}
          {config.show_progress_bar &&
            (() => {
              return (
                <div
                  style={{
                    padding: '0 20px 15px',
                    background: 'transparent',
                    boxSizing: 'border-box',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-end',
                      fontSize: '13px',
                      fontWeight: '700',
                      marginBottom: '12px',
                    }}
                  >
                    <div>
                      {totalItems >= discountThreshold ? (
                        <span
                          style={{
                            fontWeight: 700,
                            color: progressTextColor,
                            textTransform: 'uppercase',
                          }}
                        >
                          {config.discount_unlocked_text ||
                            'DISCOUNT UNLOCKED!'}
                        </span>
                      ) : (
                        <span
                          style={{
                            textTransform: 'uppercase',
                            fontWeight: 700,
                            color: textColor,
                            letterSpacing: '0.5px',
                          }}
                        >
                          ADD {Math.max(0, discountThreshold - totalItems)} MORE
                          FOR {config.discount_text || 'DISCOUNT'}
                        </span>
                      )}
                    </div>
                    <div style={{ color: progressTextColor, fontWeight: 800 }}>
                      {totalItems} / {discountThreshold} (
                      {Math.min(
                        100,
                        Math.floor((totalItems / discountThreshold) * 100)
                      )}
                      %)
                    </div>
                  </div>
                  <div
                    style={{
                      height: '12px',
                      borderRadius: '12px',
                      width: '100%',
                      boxSizing: 'border-box',
                      background: 'rgba(0,0,0,0.05)',
                      overflow: 'hidden',
                      position: 'relative',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(100, (totalItems / discountThreshold) * 100)}%`,
                        background: barBgColor || primaryColor || '#008060',
                        borderRadius: '12px',
                        transition:
                          'width 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)',
                        position: 'relative',
                        overflow: 'hidden',
                        boxShadow: '0 0 10px rgba(0,0,0,0.05)',
                      }}
                    >
                      {/* Shimmer effect in preview */}
                      <div
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          background:
                            'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)',
                          transform: 'translateX(-100%)',
                          animation: 'combo-shimmer 2s infinite',
                        }}
                      />
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: '10px',
                      fontSize: '12px',
                      fontWeight: '600',
                      color: textColor,
                      opacity: 0.7,
                      textAlign: 'center',
                      fontStyle: 'italic',
                      letterSpacing: '0.2px',
                    }}
                  >
                    {totalItems >= discountThreshold
                      ? '🎉 Fantastic! You have unlocked the best discount!'
                      : (
                        config.discount_motivation_text ||
                        'Keep going! Add {{remaining}} more for a special deal!'
                      ).replace(
                        '{{remaining}}',
                        Math.max(0, discountThreshold - totalItems)
                      )}
                  </div>
                </div>
              );
            })()}
          {/* Nav Pills */}
          <div
            style={{
              display: 'flex',
              gap: '10px',
              overflowX: 'auto',
              padding: '8px 20px 20px',
              scrollbarWidth: 'none',
            }}
          >
            {[1, 2, 3, 4]
              .map((i) => ({
                handle: config[`col_${i}`],
                title:
                  config[`title_${i}`] ||
                  (i === 1 ? 'All Packs' : `Category ${i}`),
              }))
              .filter((t) => t.handle || t.title)
              .map((tab, idx) => {
                const isActive =
                  activeTab ===
                  (idx === 0 && config.show_tab_all !== false
                    ? 'all'
                    : tab.handle);
                return (
                  <div
                    key={idx}
                    onClick={() =>
                      setActiveTab(
                        idx === 0 && config.show_tab_all !== false
                          ? 'all'
                          : tab.handle
                      )
                    }
                    style={{
                      whiteSpace: 'nowrap',
                      padding: '8px 20px',
                      borderRadius: '20px',
                      backgroundColor: isActive
                        ? config.selection_highlight_color || primaryColor
                        : '#fff',
                      border: `1px solid ${isActive ? config.selection_highlight_color || primaryColor : '#eee'}`,
                      fontSize: '12px',
                      fontWeight: '600',
                      color: isActive ? '#fff' : '#333',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      boxShadow: isActive
                        ? '0 4px 10px rgba(0,0,0,0.1)'
                        : 'none',
                    }}
                  >
                    {tab.title}
                  </div>
                );
              })}
          </div>
          {/* Grid Section */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0 20px 12px',
            }}
          >
            <div style={{ fontSize: '16px', fontWeight: '700' }}>
              Curated For You
            </div>
            <div
              style={{
                fontSize: '12px',
                color: primaryColor,
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              View All
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '12px',
              padding: '0 20px 40px',
            }}
          >
            {isLoading ? (
              <div
                style={{
                  gridColumn: '1 / -1',
                  padding: '20px',
                  textAlign: 'center',
                }}
              >
                Loading products...
              </div>
            ) : (
              products.slice(0, 6).map((product) => {
                if (!product) return null;
                const isSelected = selectedProducts.some(
                  (p) => String(p.id) === String(product.id)
                );
                const qty = cardQtys[product.id] || 0;

                // Safe variant access
                let price = '10.00';
                if (product.variants) {
                  if (Array.isArray(product.variants)) {
                    price = product.variants[0]?.price || '10.00';
                  } else if (product.variants.nodes) {
                    price = product.variants.nodes[0]?.price || '10.00';
                  }
                }

                return (
                  <div
                    key={product.id}
                    style={{
                      background: '#fff',
                      borderRadius: '12px',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.03)',
                      padding: '10px',
                      position: 'relative',
                      border: '1px solid #f0f0f0',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        background: primaryColor,
                        color: '#000',
                        fontSize: '9px',
                        fontWeight: '700',
                        padding: '2px 6px',
                        borderRadius: '10px',
                        zIndex: 2,
                      }}
                    >
                      -20%
                    </div>
                    <div
                      style={{
                        width: '100%',
                        aspectRatio: '1',
                        borderRadius: '8px',
                        background: '#f9f9f9',
                        marginBottom: '10px',
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <img
                        src={
                          product.image?.src ||
                          product.image?.url ||
                          product.featuredMedia?.preview?.image?.url ||
                          product.images?.nodes?.[0]?.url ||
                          'https://placehold.co/300x300'
                        }
                        alt={product.title}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'contain',
                        }}
                      />
                    </div>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: '700',
                        lineHeight: 1.3,
                        marginBottom: '4px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {product.title}
                    </div>
                    <div
                      style={{
                        fontSize: '10px',
                        color: '#888',
                        marginBottom: '8px',
                      }}
                    >
                      {config.vendor || 'Brand'}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '10px',
                      }}
                    >
                      <div>
                        <span style={{ fontSize: '14px', fontWeight: '800' }}>
                          Rs.{price}
                        </span>
                      </div>
                    </div>

                    {!isSelected ? (
                      <button
                        onClick={() => handleAddProduct(product)}
                        style={{
                          width: '100%',
                          background: '#eafff2',
                          color: '#1a1a1a',
                          border: 'none',
                          padding: '8px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: '700',
                          cursor: 'pointer',
                        }}
                      >
                        Add to Cart
                      </button>
                    ) : (
                      <div
                        style={{
                          display: 'flex',
                          gap: 4,
                          alignItems: 'center',
                          width: '100%',
                        }}
                      >
                        <button
                          onClick={() => handleDec(product.id)}
                          style={{
                            flex: 1,
                            background: primaryColor,
                            border: 'none',
                            borderRadius: '4px',
                            color: '#fff',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                          }}
                        >
                          -
                        </button>
                        <span
                          style={{
                            fontSize: '12px',
                            fontWeight: 'bold',
                            padding: '0 4px',
                          }}
                        >
                          {qty}
                        </span>
                        <button
                          onClick={() => handleInc(product.id)}
                          style={{
                            flex: 1,
                            background: primaryColor,
                            border: 'none',
                            borderRadius: '4px',
                            color: '#fff',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                          }}
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {renderPreviewBar()}
      </div>
    );
  }

  // === Layout 1 (Multi-Step / Build Your Box) Specific Rendering ===
  if (config.layout === 'layout1') {
    const allSteps = [1, 2, 3, 4, 5];

    // Determine which steps are "active" (configured)
    const activeSteps = allSteps.filter((step) => {
      if (step === 1) return true; // Step 1 always active
      return config[`step_${step}_collection`] || config[`step_${step}_title`];
    });

    const totalItems = selectedProducts.reduce(
      (sum, p) => sum + (p.quantity || 0),
      0
    );
    const discountThreshold = parseInt(config.max_products) || 5;
    const percent =
      discountThreshold > 0
        ? Math.min(100, Math.floor((totalItems / discountThreshold) * 100))
        : 0;
    const progressTextColor = (config.progress_text_color || '#5c5f62').trim();
    const topProgressFillColor = (
      totalItems >= discountThreshold
        ? config.progress_success_color || '#28a745'
        : config.progress_bar_color || '#1a6644'
    ).trim();

    return (
      <div
        style={{
          background: '#fff',
          fontFamily: 'inherit',
          color: '#333',
          minHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          borderRadius: '12px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
        }}
      >
        {/* Top Progress Bar */}
        {config.show_progress_bar && (
          <div
            style={{
              background: '#fff',
              padding: '20px',
              position: 'sticky',
              top: 0,
              zIndex: 100,
              borderBottom: '1px solid #eee',
              boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
              outline: inspectActive === 'progressBar' ? '2px solid #1a9de0' : inspectHover === 'progressBar' ? '2px dashed #1a9de0' : undefined,
              cursor: 'pointer',
            }}
            onMouseEnter={() => setInspectHover('progressBar')}
            onMouseLeave={() => setInspectHover(null)}
            onClick={(e) => { e.stopPropagation(); setInspectActive('progressBar'); onRequestSection('progressBar'); }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '17px',
                fontWeight: '800',
                marginBottom: '12px',
              }}
            >
              <span
                style={{
                  color: progressTextColor,
                  letterSpacing: '0.5px',
                  textTransform: 'uppercase',
                  fontSize: '15px',
                }}
              >
                {config.progress_text || 'Bundle Progress'}
              </span>
              <span style={{ color: progressTextColor }}>{percent}%</span>
            </div>
            <div
              style={{
                background: '#e0e0e0',
                height: '8px',
                borderRadius: '10px',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <div
                style={{
                  backgroundColor: topProgressFillColor,
                  height: '100%',
                  width: `${percent}%`,
                  transition: 'width 1.2s cubic-bezier(0.16, 1, 0.3, 1)',
                  position: 'relative',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  minWidth: percent > 0 ? '4px' : '0',
                }}
              >
                {/* Animated Shine Effect */}
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background:
                      'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)',
                    transform: 'translateX(-100%)',
                    animation: 'combo-shimmer 2s infinite',
                  }}
                />
              </div>
            </div>
            <div
              style={{
                marginTop: '12px',
                fontSize: '16px',
                color: '#6d7175',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {totalItems < discountThreshold ? (
                <>
                  <span
                    style={{
                      display: 'inline-block',
                      width: '18px',
                      height: '18px',
                      background: `${config.progress_bar_color || '#1a6644'}15`,
                      borderRadius: '50%',
                      textAlign: 'center',
                      lineHeight: '18px',
                      fontSize: '12px',
                      color: progressTextColor,
                    }}
                  >
                    !
                  </span>
                  <span>
                    Add{' '}
                    <strong>
                      {Math.max(0, discountThreshold - totalItems)}
                    </strong>{' '}
                    more for{' '}
                    <strong>
                      {config.discount_text ||
                        config.progress_text ||
                        'Bundle Discount'}
                    </strong>
                  </span>
                </>
              ) : (
                <span
                  style={{
                    color: progressTextColor,
                    fontWeight: '700',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <span style={{ fontSize: '14px' }}>🎉</span> Discount
                  Unlocked!
                </span>
              )}
            </div>
          </div>
        )}

        {/* Banner Image */}
        {config.show_banner !== false && (
          <div
            style={{
              width: config.banner_full_width
                ? 'calc(100% + 40px)'
                : `${bannerWidth}%`,
              height: finalBannerHeight,
              margin: config.banner_full_width ? '0 -20px' : '0 auto',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              outline: inspectActive === 'banner' ? '2px solid #1a9de0' : inspectHover === 'banner' ? '2px dashed #1a9de0' : undefined,
              cursor: 'pointer',
            }}
            onMouseEnter={() => setInspectHover('banner')}
            onMouseLeave={() => setInspectHover(null)}
            onClick={(e) => { e.stopPropagation(); setInspectActive('banner'); onRequestSection('banner'); }}
          >
            <img
              src={
                (isMobile && config.banner_image_mobile_url
                  ? config.banner_image_mobile_url
                  : config.banner_image_url) ||
                SAMPLE_BANNER_IMAGE
              }
              alt="Banner"
              style={{
                width: '100%',
                height: config.banner_fit_mode === 'adapt' ? 'auto' : '100%',
                objectFit: bannerObjectFit,
                display: 'block',
              }}
            />
          </div>
        )}

        {/* Title & Description */}
        {config.show_title_description !== false && (
          <div
            style={{ padding: '24px 20px', outline: inspectActive === 'content' ? '2px solid #1a9de0' : inspectHover === 'content' ? '2px dashed #1a9de0' : undefined, cursor: 'pointer' }}
            onMouseEnter={() => setInspectHover('content')}
            onMouseLeave={() => setInspectHover(null)}
            onClick={(e) => { e.stopPropagation(); setInspectActive('content'); onRequestSection('content'); }}
          >
            <div
              style={{
                width: isMobile ? '100%' : `${config.title_width || 100}%`,
                textAlign: headingAlign,
                paddingTop: config.title_container_padding_top || 0,
                paddingRight: config.title_container_padding_right || 0,
                paddingBottom: config.title_container_padding_bottom || 0,
                paddingLeft: config.title_container_padding_left || 0,
                marginTop: config.title_container_margin_top || 0,
                marginRight: config.title_container_margin_right || 0,
                marginBottom: config.title_container_margin_bottom || 0,
                marginLeft: config.title_container_margin_left || 0,
              }}
            >
              <h1
                style={{
                  margin: 0,
                  fontSize: `${headingSize}px`,
                  color: headingColor || '#333',
                  fontWeight: headingFontWeight || '700',
                  lineHeight: 1.2,
                }}
              >
                <InlineEdit value={config.collection_title || 'Create Your Combo'} configKey="collection_title" onUpdate={onUpdateConfig} style={{ fontSize: `${headingSize}px`, color: headingColor || '#333', fontWeight: headingFontWeight || '700' }} />
              </h1>
            </div>
            <div
              style={{
                width: isMobile ? '100%' : `${config.title_width || 100}%`,
                textAlign: descriptionAlign,
                paddingTop: config.description_container_padding_top || 0,
                paddingRight: config.description_container_padding_right || 0,
                paddingBottom: config.description_container_padding_bottom || 0,
                paddingLeft: config.description_container_padding_left || 0,
                marginTop: config.description_container_margin_top || 0,
                marginRight: config.description_container_margin_right || 0,
                marginBottom: config.description_container_margin_bottom || 0,
                marginLeft: config.description_container_margin_left || 0,
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: `${descriptionSize}px`,
                  color: descriptionColor || '#666',
                  fontWeight: descriptionFontWeight || '400',
                  lineHeight: 1.5,
                }}
              >
                <InlineEdit value={config.collection_description || 'Select items to build your perfect combo.'} configKey="collection_description" onUpdate={onUpdateConfig} style={{ fontSize: `${descriptionSize}px`, color: descriptionColor || '#666', fontWeight: descriptionFontWeight || '400' }} />
              </p>
            </div>
          </div>
        )}

        {/* Collections / Steps */}
        <div
          style={{ padding: '20px', flex: 1, outline: inspectActive === 'general' ? '2px solid #1a9de0' : inspectHover === 'general' ? '2px dashed #1a9de0' : undefined, cursor: 'pointer' }}
          onMouseEnter={() => setInspectHover('general')}
          onMouseLeave={() => setInspectHover(null)}
          onClick={(e) => { e.stopPropagation(); setInspectActive('general'); onRequestSection('general'); }}
        >
          {activeSteps.map((step, index) => {
            const stepTitle =
              config[`step_${step}_title`] || `Category ${step}`;
            const stepSubtitle =
              config[`step_${step}_subtitle`] || 'Select your items';
            const isCompleted = selectedProducts.length > index;

            const stepColl = config[`step_${step}_collection`];
            let stepViewProducts = allStepProducts[stepColl] || [];

            // If we don't have dynamic products for this step yet, try to find them in the loader data
            if (stepViewProducts.length === 0 && stepColl) {
              stepViewProducts = products.filter((p) =>
                (p.collections || []).some((c) => c.handle === stepColl)
              );
            }

            if (stepViewProducts.length > 0) {
              const stockFiltered = filterPreviewProductsByStock(stepViewProducts, config);
              stepViewProducts = (stockFiltered.length > 0 ? stockFiltered : stepViewProducts).slice(0, 12);
            } else if (!stepColl) {
              // no collection configured — keep empty
            } else if ((products || []).length > 0) {
              // collection configured but no matching products yet — show all store products as fallback
              stepViewProducts = products.slice(0, 12);
            }

            if (!stepColl) return null;

            return (
              <div key={step} style={{ marginBottom: '40px' }}>
                <div style={{ marginBottom: '16px' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <h3 style={{ fontSize: '18px', fontWeight: '700' }}>
                      <InlineEdit value={stepTitle} configKey={`step_${step}_title`} onUpdate={onUpdateConfig} style={{ fontSize: '18px', fontWeight: '700' }} />
                    </h3>
                    {isCompleted && (
                      <span style={{ color: '#28a745', fontWeight: 'bold' }}>
                        ✓
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: '13px', color: '#888' }}>
                    <InlineEdit value={stepSubtitle} configKey={`step_${step}_subtitle`} onUpdate={onUpdateConfig} style={{ fontSize: '13px', color: '#888' }} />
                  </p>
                </div>

                {!stepColl ? (
                  <div
                    style={{
                      padding: '32px 16px',
                      textAlign: 'center',
                      background: '#f9fafb',
                      borderRadius: '8px',
                      border: '2px dashed #e1e3e5',
                      color: '#8c9196',
                      fontSize: '13px',
                    }}
                  >
                    <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'center' }}>
                      <svg width="24" height="24" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                        <rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" />
                        <path d="M7 8h6M7 11h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                      No collection selected
                    </div>
                    <div>
                      Choose a collection for Collection {step} to preview
                      products here.
                    </div>
                  </div>
                ) : stepViewProducts.length === 0 ? (
                  <div
                    style={{
                      padding: '32px 16px',
                      textAlign: 'center',
                      background: '#f9fafb',
                      borderRadius: '8px',
                      border: '2px dashed #e1e3e5',
                      color: '#8c9196',
                      fontSize: '13px',
                    }}
                  >
                    {stepProductsLoading ? (
                      <>
                        <div
                          className="combo-spinner-new"
                          style={{ margin: '0 auto 8px' }}
                        />
                        <div style={{ fontWeight: '600' }}>
                          Loading products...
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'center' }}>
                          <svg width="24" height="24" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                            <path d="M9 16A7 7 0 1 0 9 2a7 7 0 0 0 0 14ZM14 14l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                          </svg>
                        </div>
                        <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                          No products found
                        </div>
                        <div>The selected collection has no products.</div>
                      </>
                    )}
                  </div>
                ) : config.grid_layout_type === 'slider' ? (
                  /* Slider Preview */
                  <div style={{ position: 'relative' }}>
                    <div
                      style={{
                        display: 'flex',
                        gap: '12px',
                        overflowX: 'auto',
                        paddingBottom: config.show_scrollbar ? '10px' : '0',
                        scrollbarWidth: config.show_scrollbar ? 'auto' : 'none',
                        msOverflowStyle: config.show_scrollbar
                          ? 'auto'
                          : 'none',
                        scrollBehavior: 'smooth',
                      }}
                      className="preview-slider-track"
                    >
                      <style>{`
                        .preview-slider-track::-webkit-scrollbar {
                          display: ${config.show_scrollbar ? 'block' : 'none'};
                          height: ${config.scrollbar_thickness || 4}px;
                        }
                        .preview-slider-track::-webkit-scrollbar-thumb {
                          background: ${config.scrollbar_color || '#dddddd'};
                          border-radius: 10px;
                        }
                      `}</style>
                      {stepViewProducts.map((p) => (
                        <div
                          key={p.id}
                          style={{ minWidth: '160px', width: '160px' }}
                        >
                          <ProductCardItem
                            product={p}
                            source={`step_${step}`}
                          />
                        </div>
                      ))}
                    </div>
                    {config.show_nav_arrows && (
                      <>
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            const track =
                              e.currentTarget.parentElement.querySelector(
                                '.preview-slider-track'
                              );
                            if (track)
                              track.scrollBy({
                                left: -250,
                                behavior: 'smooth',
                              });
                          }}
                          style={{
                            position: 'absolute',
                            left:
                              config.arrow_position === 'outside'
                                ? '-22px'
                                : '8px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            width: `${config.arrow_size || 36}px`,
                            height: `${config.arrow_size || 36}px`,
                            background: config.arrow_bg_color || '#000',
                            color: config.arrow_color || '#fff',
                            borderRadius: `${config.arrow_border_radius || 50}${config.arrow_border_radius === 50 ? '%' : 'px'}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 4px 10px rgba(0,0,0,0.2)',
                            zIndex: 10,
                            cursor: 'pointer',
                            opacity: config.arrow_opacity ?? 0.9,
                            transition: 'all 0.2s ease',
                          }}
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M15 18l-6-6 6-6" />
                          </svg>
                        </div>
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            const track =
                              e.currentTarget.parentElement.querySelector(
                                '.preview-slider-track'
                              );
                            if (track)
                              track.scrollBy({ left: 250, behavior: 'smooth' });
                          }}
                          style={{
                            position: 'absolute',
                            right:
                              config.arrow_position === 'outside'
                                ? '-22px'
                                : '8px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            width: `${config.arrow_size || 36}px`,
                            height: `${config.arrow_size || 36}px`,
                            background: config.arrow_bg_color || '#000',
                            color: config.arrow_color || '#fff',
                            borderRadius: `${config.arrow_border_radius || 50}${config.arrow_border_radius === 50 ? '%' : 'px'}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 4px 10px rgba(0,0,0,0.2)',
                            zIndex: 10,
                            cursor: 'pointer',
                            opacity: config.arrow_opacity ?? 0.9,
                            transition: 'all 0.2s ease',
                          }}
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M9 18l6-6-6-6" />
                          </svg>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  /* Grid Layout */
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${device === 'desktop' ? config.desktop_columns || 3 : config.mobile_columns || 2}, minmax(0, 1fr))`,
                      gap: '16px',
                    }}
                  >
                    {stepViewProducts.map((p) => (
                      <ProductCardItem
                        key={p.id}
                        product={p}
                        source={`step_${step}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {renderGlobalStickyBar()}
        {renderPreviewBar()}
      </div>
    );
  }

  return (
    <div style={{ background: '#eef1f5', padding: 16 }}>
      <div
        style={{
          fontFamily: 'inherit',
          paddingTop: paddingTop,
          paddingRight: paddingRight,
          paddingBottom: paddingBottom,
          paddingLeft: paddingLeft,
          background: '#f9f9f9',
          maxWidth: viewportWidth,
          margin: '0 auto',
          border: '1px solid #e5e5e5',
          borderRadius: 12,
          boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
          minHeight: '100%',
          position: 'relative',
        }}
      >
        <style>{previewStyles}</style>
        {sectionOrder.map((Section, idx) => Section())}
        {renderGlobalStickyBar()}
        {renderPreviewBar()}
      </div>
    </div>
  );
}
