/**
 * Combo pages: weight-based box pricing — everything that makes it real in
 * Shopify checkout, via the BRIX combo weight Function
 * (extensions/brix-combo-weight-discount):
 *   - build the trusted config the Function reads, from the saved combo
 *     templates (never from the browser): only active weight templates, only
 *     on a plan with combo_weight_pricing
 *   - write it to the shop's app-owned metafield, and the collection ids the
 *     Function's input query needs to the discount's input-variables metafield
 *   - make sure the automatic app discount that runs the Function exists
 *   - report honestly whether it is really going to apply
 *
 * Same trust model and shape as packs-shopify.server.js /
 * prepaid-discount-shopify.server.js. The storefront offers weight pricing
 * only when getStorefrontWeightStatus() says the discount is ACTIVE and holds
 * that template's current pricing (its hash), so shoppers are never promised
 * a price Shopify won't give.
 */
import { getDb } from './db.server';
import { getShopPlan, canPublishFeature } from './plan-permissions.server';
import { comboCollectionHandles, isWeightCombo, normalizeWeightPricing, tierLabel } from '../utils/combo-weight.shared.js';

export const COMBO_WEIGHT_FUNCTION_HANDLE = 'brix-combo-weight-discount';
export const COMBO_WEIGHT_DISCOUNT_TITLE = 'BRIX Combo Weight';
export const COMBO_WEIGHT_CONFIG_KEY = 'combo_weight_config';
export const COMBO_WEIGHT_VARS_KEY = 'combo_weight_vars';
export const COMBO_WEIGHT_FEATURE = 'combo_weight_pricing';
// Shopify drops metafields over 10 KB; stay clear of it.
export const CONFIG_BYTE_LIMIT = 9000;

class SyncError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function gql(admin, query, variables) {
  let payload;
  try {
    const response = await admin.graphql(query, { variables });
    payload = await response.json();
  } catch (error) {
    throw new SyncError('shopify_error', `Could not reach Shopify: ${String(error?.message || error).slice(0, 200)}`);
  }
  if (payload?.errors?.length) throw new SyncError('shopify_error', `Shopify rejected the request: ${JSON.stringify(payload.errors).slice(0, 300)}`);
  return payload.data;
}

const numericId = (gid) => {
  const match = /(\d+)$/.exec(String(gid ?? ''));
  return match ? match[1] : null;
};

function parseConfig(raw) {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}') || {}; } catch { return {}; }
}

/** Weight-mode templates of a shop, with their pricing normalized: [{ id, active, config, pricing, errors }]. */
export async function loadWeightTemplates(shop) {
  const db = getDb();
  const [rows] = await db.execute('SELECT id, is_active, customization_data FROM combo_templates WHERE shop_domain = ?', [shop]);
  return (Array.isArray(rows) ? rows : []).map((row) => ({ row, config: parseConfig(row.customization_data) }))
    .filter(({ config }) => isWeightCombo(config))
    .map(({ row, config }) => {
      const { value, errors } = normalizeWeightPricing(config.weight_pricing);
      return { id: Number(row.id), active: Number(row.is_active) === 1 || row.is_active === true, config, pricing: value, errors };
    });
}

/**
 * The Function's config + input variables. Pure.
 *   templates             from loadWeightTemplates
 *   planLive              the shop's plan publishes combo_weight_pricing
 *   collectionIdsByHandle { handle: 'gid://shopify/Collection/1' } for layout-collection templates
 * Returns { config, variables, bytes, included: [id], skipped: [{ id, reason }] }.
 */
export function buildComboWeightFunctionConfig({ templates, planLive, currencyCode = null, collectionIdsByHandle = {} }) {
  const entries = {};
  const included = [];
  const skipped = [];
  const variableIds = new Set();
  for (const template of templates || []) {
    if (!planLive) { skipped.push({ id: template.id, reason: 'plan_locked' }); continue; }
    if (!template.active) { skipped.push({ id: template.id, reason: 'inactive' }); continue; }
    if (template.errors?.length) { skipped.push({ id: template.id, reason: 'invalid' }); continue; }
    const { pricing } = template;
    let collectionGids;
    let productIds = [];
    if (pricing.qualify.mode === 'selected') {
      collectionGids = pricing.qualify.collection_ids;
      productIds = pricing.qualify.product_ids.map(numericId).filter(Boolean);
    } else {
      collectionGids = comboCollectionHandles(template.config).map((handle) => collectionIdsByHandle[handle]).filter(Boolean);
    }
    if (!collectionGids.length && !productIds.length) { skipped.push({ id: template.id, reason: 'no_products' }); continue; }
    collectionGids.forEach((gid) => variableIds.add(gid));
    entries[String(template.id)] = {
      id: template.id,
      hash: pricing.hash,
      unit: pricing.unit,
      max_grams: pricing.max_grams,
      product_ids: productIds,
      collection_ids: collectionGids.map(numericId).filter(Boolean),
      tiers: pricing.tiers.map((tier) => ({ min_grams: tier.min_grams, type: tier.type, value: tier.value, label: tierLabel(tier, pricing.unit) })),
    };
    included.push(template.id);
  }
  const config = { version: 1, currency: currencyCode, templates: entries };
  return {
    config,
    variables: { collectionIds: [...variableIds] },
    bytes: Buffer.byteLength(JSON.stringify(config), 'utf8'),
    included,
    skipped,
  };
}

/** { handle: collection gid } for the given handles; unknown handles are left out. */
export async function resolveCollectionIds(admin, handles) {
  const unique = [...new Set((handles || []).filter(Boolean))];
  const result = {};
  for (let start = 0; start < unique.length; start += 25) {
    const batch = unique.slice(start, start + 25);
    const declarations = batch.map((_, i) => `$h${i}: String!`).join(', ');
    const fields = batch.map((_, i) => `c${i}: collectionByHandle(handle: $h${i}) { id }`).join('\n');
    const variables = Object.fromEntries(batch.map((handle, i) => [`h${i}`, handle]));
    const data = await gql(admin, `#graphql
      query ComboWeightCollections(${declarations}) {
        ${fields}
      }`, variables);
    batch.forEach((handle, i) => { if (data?.[`c${i}`]?.id) result[handle] = data[`c${i}`].id; });
  }
  return result;
}

async function readShop(admin) {
  const data = await gql(admin, '#graphql\nquery ComboWeightShop { shop { id currencyCode metafield(namespace: "$app", key: "combo_weight_config") { jsonValue } } }');
  return { id: data.shop.id, currencyCode: data.shop.currencyCode || null, config: data.shop.metafield?.jsonValue || null };
}

async function setMetafields(admin, metafields) {
  const data = await gql(admin, `#graphql
    mutation ComboWeightMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message code } }
    }`, { metafields });
  const errors = data?.metafieldsSet?.userErrors || [];
  if (errors.length) throw new SyncError('config_sync_failed', `Could not save the combo weight configuration in Shopify: ${errors[0].message}`);
}

// `automaticDiscountNodes` is deprecated and never returns app (Function)
// discounts, so this must go through `discountNodes`.
async function findInstalledDiscount(admin) {
  const data = await gql(admin, `#graphql
    query ComboWeightDiscounts {
      discountNodes(first: 100, query: "type:app") {
        nodes { id discount { __typename ... on DiscountAutomaticApp { title status } } }
      }
    }`);
  const nodes = data?.discountNodes?.nodes || [];
  const node = nodes.find((item) => item.discount?.__typename === 'DiscountAutomaticApp' && item.discount.title === COMBO_WEIGHT_DISCOUNT_TITLE);
  return node ? { id: node.id, status: node.discount.status } : null;
}

const varsMetafield = (variables) => ({ namespace: '$app', key: COMBO_WEIGHT_VARS_KEY, type: 'json', value: JSON.stringify(variables) });

/**
 * Create the automatic app discount that runs the Function, if it doesn't
 * exist yet, and (re)write its input variables. Requires the Function to be
 * deployed (`shopify app deploy`).
 */
export async function ensureComboWeightDiscount(admin, variables) {
  const existing = await findInstalledDiscount(admin);
  if (existing) {
    await setMetafields(admin, [{ ownerId: existing.id, ...varsMetafield(variables) }]);
    return { created: false, discountId: existing.id, status: existing.status };
  }
  const data = await gql(admin, `#graphql
    mutation ComboWeightDiscountCreate($discount: DiscountAutomaticAppInput!) {
      discountAutomaticAppCreate(automaticAppDiscount: $discount) {
        automaticAppDiscount { discountId status }
        userErrors { field message code }
      }
    }`, {
    discount: {
      title: COMBO_WEIGHT_DISCOUNT_TITLE,
      functionHandle: COMBO_WEIGHT_FUNCTION_HANDLE,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      discountClasses: ['PRODUCT'],
      // A box price is the whole deal: it doesn't stack with other product
      // discounts (Shopify keeps the better one), but order discounts and
      // free shipping still apply. BRIX COD mirrors this (cod.server.js).
      combinesWith: { productDiscounts: false, orderDiscounts: true, shippingDiscounts: true },
      metafields: [varsMetafield(variables)],
    },
  });
  const errors = data?.discountAutomaticAppCreate?.userErrors || [];
  if (errors.length) {
    const notDeployed = errors.some((e) => /function/i.test(`${e.message} ${e.code}`));
    throw new SyncError(notDeployed ? 'not_deployed' : 'create_failed', errors[0].message);
  }
  const created = data.discountAutomaticAppCreate.automaticAppDiscount;
  return { created: true, discountId: created.discountId, status: created.status };
}

/**
 * Is the checkout discount really going to apply to these templates?
 * `expected` = [{ id, hash }]. verified only when the discount is ACTIVE and
 * every expected template is in the Function's config at that hash.
 * states: active | discount_missing | discount_inactive | config_out_of_date | unknown
 */
export async function getComboWeightDiscountStatus(admin, expected = []) {
  try {
    const discount = await findInstalledDiscount(admin);
    if (!discount) return { verified: false, state: 'discount_missing', message: 'The combo weight checkout discount is not installed on this store yet.' };
    if (discount.status !== 'ACTIVE') return { verified: false, state: 'discount_inactive', message: `The combo weight checkout discount is ${String(discount.status).toLowerCase()} in Shopify (Discounts → ${COMBO_WEIGHT_DISCOUNT_TITLE}).` };
    const { config } = await readShop(admin);
    const stale = expected.filter(({ id, hash }) => config?.templates?.[String(id)]?.hash !== hash);
    if (stale.length) return { verified: false, state: 'config_out_of_date', message: 'This combo\'s pricing has not reached Shopify yet. Save it again to retry.' };
    return { verified: true, state: 'active', discountId: discount.id, message: 'The box discount is active in Shopify checkout.' };
  } catch (error) {
    return { verified: false, state: 'unknown', message: error?.message || 'Could not check the checkout discount.' };
  }
}

/* ── storefront: is a template's weight pricing live right now? ─────────────── */

const STOREFRONT_TTL_MS = 60_000;
const storefrontCache = new Map(); // shop -> { at, value }

export function invalidateStorefrontWeightStatus(shop) {
  storefrontCache.delete(shop);
}

/**
 * { discountActive, hashes: { [templateId]: hash } } — what Shopify checkout
 * will really do, cached for 60 s per shop. Never throws (nothing is live on error).
 */
export async function getStorefrontWeightStatus(shop, admin, now = Date.now()) {
  const cached = storefrontCache.get(shop);
  if (cached && now - cached.at < STOREFRONT_TTL_MS) return cached.value;
  let value = { discountActive: false, hashes: {} };
  try {
    const [discount, shopData] = await Promise.all([findInstalledDiscount(admin), readShop(admin)]);
    const hashes = {};
    for (const [id, entry] of Object.entries(shopData.config?.templates || {})) hashes[id] = entry?.hash || null;
    value = { discountActive: discount?.status === 'ACTIVE', hashes };
  } catch (error) {
    console.warn('[combo-weight] storefront status check failed:', String(error?.message || error).slice(0, 200));
  }
  storefrontCache.set(shop, { at: now, value });
  return value;
}

/**
 * Is weight pricing live for this template on the storefront? Pure.
 * True only on a plan that publishes it, for an active template whose current
 * pricing (hash) is the one the ACTIVE checkout discount holds.
 */
export function weightPricingLive({ planLive, active, hash, templateId, status }) {
  return Boolean(planLive && active && status?.discountActive && hash && status.hashes?.[String(templateId)] === hash);
}

// "Selected" collections: their product ids, cached per pricing version
// (one query per collection otherwise runs on every combo page view).
const MEMBERS_TTL_MS = 5 * 60_000;
const MEMBER_PAGES = 20;
const membersCache = new Map(); // `${shop}:${hash}` -> { at, ids: Set }

async function selectedCollectionProductIds(admin, shop, pricing, now = Date.now()) {
  const key = `${shop}:${pricing.hash}`;
  const cached = membersCache.get(key);
  if (cached && now - cached.at < MEMBERS_TTL_MS) return cached.ids;
  const ids = new Set();
  for (const collectionId of pricing.qualify.collection_ids) {
    try {
      // Every product, 250 a page (up to 5000 per collection).
      let after = null;
      for (let page = 0; page < MEMBER_PAGES; page++) {
        const data = await gql(admin, `#graphql
          query ComboWeightMembers($id: ID!, $after: String) {
            collection(id: $id) { products(first: 250, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } } }
          }`, { id: collectionId, after });
        const products = data?.collection?.products;
        for (const node of products?.nodes || []) ids.add(node.id);
        if (!products?.pageInfo?.hasNextPage || !products.pageInfo.endCursor) break;
        after = products.pageInfo.endCursor;
      }
    } catch (error) {
      console.warn('[combo-weight] collection lookup failed:', String(error?.message || error).slice(0, 200));
    }
  }
  if (membersCache.size > 500) membersCache.clear();
  membersCache.set(key, { at: now, ids });
  return ids;
}

/**
 * What a weight combo page needs: tiers, max weight, messages and which of
 * the shown products count toward the box. `enabled` is true only on a plan
 * that publishes it, for an active template whose current pricing the ACTIVE
 * checkout discount holds; otherwise the page shows no box discount.
 */
export async function storefrontWeightPricing({ shop, admin, templateId, active, config, productsByHandle }) {
  const { value: pricing, errors } = normalizeWeightPricing(config?.weight_pricing);
  const planLive = canPublishFeature(await getShopPlan(shop), COMBO_WEIGHT_FEATURE);
  const status = planLive && !errors.length ? await getStorefrontWeightStatus(shop, admin) : null;
  const enabled = !errors.length && weightPricingLive({ planLive, active, hash: pricing.hash, templateId, status });

  const shown = [];
  for (const products of Object.values(productsByHandle || {})) for (const p of products || []) if (!shown.includes(p.id)) shown.push(p.id);
  let qualifyingProductIds = shown;
  if (pricing.qualify.mode === 'selected') {
    const members = await selectedCollectionProductIds(admin, shop, pricing);
    qualifyingProductIds = shown.filter((id) => pricing.qualify.product_ids.includes(id) || members.has(id));
  }

  return {
    enabled,
    reason: enabled ? null : (!planLive ? 'plan_locked' : 'not_live'),
    hash: pricing.hash,
    unit: pricing.unit,
    maxGrams: pricing.max_grams,
    tiers: pricing.tiers.map((tier) => ({ ...tier, label: tierLabel(tier, pricing.unit) })),
    messages: pricing.messages,
    qualifyingProductIds,
  };
}

/* ── sync ──────────────────────────────────────────────────────────────────── */

const TEMPLATE_REASONS = {
  plan_locked: 'Weight-based pricing goes live on the Pro plan.',
  inactive: 'This combo is turned off, so its box discount is not active.',
  invalid: 'This combo\'s weight pricing has errors. Fix them and save again.',
  no_products: 'None of this combo\'s collections could be found in Shopify, so no product would count toward the box.',
};

/**
 * Bring Shopify in line with the shop's saved weight combos: rewrite the
 * Function config and variables and make sure the discount exists. Never
 * throws — returns { ok, verified, state, message, included, skipped, templates }
 * where templates[id] = { verified, message } for every weight template.
 *
 * states: not_needed | plan_locked | active | not_deployed | inactive | too_large | failed
 */
export async function syncComboWeightDiscount(admin, shop) {
  let templates = [];
  try {
    const planKey = await getShopPlan(shop);
    const planLive = canPublishFeature(planKey, COMBO_WEIGHT_FEATURE);
    templates = await loadWeightTemplates(shop);
    const layoutHandles = planLive
      ? templates.filter((t) => t.active && t.pricing.qualify.mode !== 'selected').flatMap((t) => comboCollectionHandles(t.config))
      : [];
    const [shopData, collectionIdsByHandle] = await Promise.all([readShop(admin), resolveCollectionIds(admin, layoutHandles)]);
    const built = buildComboWeightFunctionConfig({ templates, planLive, currencyCode: shopData.currencyCode, collectionIdsByHandle });
    const perTemplate = (verified, message) => Object.fromEntries(templates.map((t) => {
      const skip = built.skipped.find((s) => s.id === t.id);
      return [t.id, skip ? { verified: false, message: TEMPLATE_REASONS[skip.reason] } : { verified, message }];
    }));
    const done = (result) => {
      invalidateStorefrontWeightStatus(shop);
      return { included: built.included, skipped: built.skipped, templates: perTemplate(result.verified, result.message), ...result };
    };

    if (built.bytes > CONFIG_BYTE_LIMIT) {
      // The new config can't be stored, but a combo that was deleted, turned
      // off or changed must not keep its old box discount: keep only the
      // stored entries that are still exactly right. (The storefront reads its
      // hashes from this config, so a dropped combo stops promising a discount.)
      const stored = shopData.config?.templates || {};
      const kept = Object.fromEntries(Object.entries(stored)
        .filter(([id, entry]) => JSON.stringify(built.config.templates[id] ?? null) === JSON.stringify(entry)));
      if (Object.keys(kept).length !== Object.keys(stored).length) {
        await setMetafields(admin, [{ ownerId: shopData.id, namespace: '$app', key: COMBO_WEIGHT_CONFIG_KEY, type: 'json', value: JSON.stringify({ ...built.config, templates: kept }) }]);
      }
      return done({
        ok: false, verified: false, state: 'too_large',
        message: 'Your weight combos have too many products, collections or tiers for Shopify to hold. Remove some products or collections and save again.',
      });
    }

    if (!built.included.length) {
      // Clear what the Function holds, so nothing stays discounted.
      if (shopData.config && Object.keys(shopData.config.templates || {}).length) {
        await setMetafields(admin, [{ ownerId: shopData.id, namespace: '$app', key: COMBO_WEIGHT_CONFIG_KEY, type: 'json', value: JSON.stringify(built.config) }]);
      }
      const locked = !planLive && templates.some((t) => t.active);
      return done({
        ok: true, verified: false, state: locked ? 'plan_locked' : 'not_needed',
        message: locked ? TEMPLATE_REASONS.plan_locked : 'No active weight combos.',
      });
    }

    await setMetafields(admin, [{ ownerId: shopData.id, namespace: '$app', key: COMBO_WEIGHT_CONFIG_KEY, type: 'json', value: JSON.stringify(built.config) }]);
    const discount = await ensureComboWeightDiscount(admin, built.variables);
    if (discount.status && discount.status !== 'ACTIVE') {
      return done({
        ok: false, verified: false, state: 'inactive',
        message: `The box discount is ${String(discount.status).toLowerCase()} in Shopify (Discounts → ${COMBO_WEIGHT_DISCOUNT_TITLE}). Shoppers won't see weight pricing until it's active.`,
      });
    }
    return done({ ok: true, verified: true, state: 'active', message: 'The box discount is active in Shopify checkout.' });
  } catch (error) {
    invalidateStorefrontWeightStatus(shop);
    const notDeployed = error?.code === 'not_deployed';
    if (!notDeployed) console.error('[combo-weight] sync failed:', String(error?.message || error).slice(0, 300));
    const message = notDeployed
      ? 'The box discount is not installed on this store yet (the app needs to be deployed once with its latest extension). Shoppers won\'t see weight pricing until then.'
      : 'Could not set up the box discount in Shopify. Shoppers won\'t see weight pricing until it works. Save again to retry.';
    return {
      ok: false, verified: false, state: notDeployed ? 'not_deployed' : 'failed', message,
      included: [], skipped: [],
      templates: Object.fromEntries(templates.map((t) => [t.id, { verified: false, message }])),
    };
  }
}

/**
 * Sync only when one of the given template configs (objects or JSON strings,
 * before and/or after a change) is a weight combo. Returns null otherwise, so
 * shops that never use weight pricing make no extra Shopify calls.
 */
export async function syncComboWeightIfNeeded(admin, shop, ...configs) {
  if (!admin || !configs.some((c) => isWeightCombo(parseConfig(c)))) return null;
  return syncComboWeightDiscount(admin, shop);
}
