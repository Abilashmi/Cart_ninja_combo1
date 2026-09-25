/**
 * Free reward products — everything that makes a Progress Bar reward product
 * actually FREE at checkout, via the BRIX free gift discount Function
 * (extensions/brix-reward-discount):
 *   - build the trusted config the Function reads (from the merchant's saved
 *     Progress Bar, never from the browser)
 *   - write it to the shop's app-owned metafield
 *   - make sure the automatic app discount that runs the Function exists
 *   - report honestly whether it is really going to apply
 *
 * Same trust model and shape as packs-shopify.server.js.
 */
import { getDb } from './db.server';
import { fetchProgressBar } from './cart-config-writes.server';

export const REWARD_FUNCTION_HANDLE = 'brix-reward-discount';
export const REWARD_DISCOUNT_TITLE = 'BRIX Free Gift';
export const REWARD_CONFIG_KEY = 'reward_gift_config';

const numericId = (value) => {
  const match = /(\d+)$/.exec(String(value ?? ''));
  return match ? match[1] : null;
};

async function gql(admin, query, variables) {
  const response = await admin.graphql(query, { variables });
  const payload = await response.json();
  if (payload?.errors?.length) throw new Error(`Shopify rejected the request: ${JSON.stringify(payload.errors).slice(0, 200)}`);
  return payload.data;
}

/**
 * The Function's config: one entry per Progress Bar milestone whose reward is a
 * product the merchant chose to give away free. Empty when the bar is off.
 */
export function buildRewardConfig(progressBar, currencyCode = null) {
  const tiers = [];
  if (progressBar && Number(progressBar.is_enabled) === 1) {
    const mode = progressBar.mode === 'count' || progressBar.mode === 'quantity' ? 'count' : 'amount';
    for (const tier of progressBar.tiers || []) {
      // Any tier holding reward products counts, whatever its reward_type: the
      // drawer adds every tier's products (the editor keeps reward_type as-is).
      if ((tier.reward_pricing ?? 'regular') !== 'free') continue;
      const productIds = (Array.isArray(tier.reward_products) ? tier.reward_products : []).map(numericId).filter(Boolean);
      const min = mode === 'count' ? Number(tier.min_quantity) || Number(tier.min_value) : Number(tier.min_value);
      if (!productIds.length || !(min > 0)) continue;
      tiers.push({ id: String(tier.id), mode, min, productIds });
    }
  }
  return { version: 1, currency: currencyCode, tiers };
}

async function writeRewardConfig(admin, config) {
  const shopData = await gql(admin, '#graphql\nquery RewardShopId { shop { id } }');
  const data = await gql(admin, `#graphql
    mutation RewardConfig($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message code } }
    }`, { metafields: [{ ownerId: shopData.shop.id, namespace: '$app', key: REWARD_CONFIG_KEY, type: 'json', value: JSON.stringify(config) }] });
  const errors = data?.metafieldsSet?.userErrors || [];
  if (errors.length) throw new Error(`Could not sync the free gift configuration: ${errors[0].message}`);
}

async function findInstalledDiscount(admin) {
  const data = await gql(admin, `#graphql
    query RewardDiscounts {
      automaticDiscountNodes(first: 100) {
        nodes { id automaticDiscount { __typename ... on DiscountAutomaticApp { title status } } }
      }
    }`);
  const nodes = data?.automaticDiscountNodes?.nodes || [];
  return nodes.find((node) => node.automaticDiscount?.__typename === 'DiscountAutomaticApp' && node.automaticDiscount.title === REWARD_DISCOUNT_TITLE) || null;
}

/** Create the automatic app discount that runs the Function, if it isn't there yet. */
async function ensureRewardDiscount(admin) {
  const existing = await findInstalledDiscount(admin);
  if (existing) return { created: false, status: existing.automaticDiscount.status };
  const data = await gql(admin, `#graphql
    mutation RewardDiscountCreate($discount: DiscountAutomaticAppInput!) {
      discountAutomaticAppCreate(automaticAppDiscount: $discount) {
        automaticAppDiscount { discountId status }
        userErrors { field message code }
      }
    }`, {
    discount: {
      title: REWARD_DISCOUNT_TITLE,
      functionHandle: REWARD_FUNCTION_HANDLE,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      discountClasses: ['PRODUCT'],
      combinesWith: { productDiscounts: true, orderDiscounts: true, shippingDiscounts: true },
    },
  });
  const errors = data?.discountAutomaticAppCreate?.userErrors || [];
  if (errors.length) {
    const notDeployed = errors.some((e) => /function/i.test(`${e.message} ${e.code}`));
    const err = new Error(notDeployed ? 'not_deployed' : errors[0].message);
    err.code = notDeployed ? 'not_deployed' : 'create_failed';
    throw err;
  }
  return { created: true, status: data.discountAutomaticAppCreate.automaticAppDiscount.status };
}

/**
 * Bring Shopify in line with the merchant's saved Progress Bar: rewrite the
 * Function config and make sure the discount exists. Never throws — returns
 *   { ok, verified, state, message, giftCount }
 * so callers can say exactly what is (and isn't) live. `verified` is true only
 * when the discount exists and is ACTIVE and the config was written.
 *
 * states: not_needed | active | not_deployed | inactive | failed
 */
export async function syncRewardGiftDiscount(admin, shop, { currencyCode = null } = {}) {
  try {
    const progressBar = await fetchProgressBar(getDb(), shop);
    const config = buildRewardConfig(progressBar, currencyCode);
    await writeRewardConfig(admin, config);
    if (config.tiers.length === 0) {
      return { ok: true, verified: false, state: 'not_needed', message: 'No free reward products are configured.', giftCount: 0 };
    }
    const discount = await ensureRewardDiscount(admin);
    if (discount.status && discount.status !== 'ACTIVE') {
      return { ok: false, verified: false, state: 'inactive', message: `The free gift discount is ${String(discount.status).toLowerCase()} in Shopify.`, giftCount: config.tiers.length };
    }
    return { ok: true, verified: true, state: 'active', message: 'The free gift discount is active.', giftCount: config.tiers.length };
  } catch (error) {
    if (error?.code === 'not_deployed') {
      return {
        ok: false, verified: false, state: 'not_deployed',
        message: 'The free gift discount is not installed on this store yet (the app needs to be deployed once with its latest extension).',
        giftCount: 0,
      };
    }
    console.error('[reward-gift] sync failed:', String(error?.message || error).slice(0, 300));
    return { ok: false, verified: false, state: 'failed', message: 'Could not set up the free gift discount in Shopify.', giftCount: 0 };
  }
}
