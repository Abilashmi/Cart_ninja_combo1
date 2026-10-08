/**
 * Prepaid discount — everything that makes "pay online and save X%" real at
 * Shopify checkout, via the BRIX prepaid discount Function
 * (extensions/brix-prepaid-discount):
 *   - build the trusted config the Function reads (from the merchant's saved
 *     COD settings, never from the browser)
 *   - write it to the shop's app-owned metafield
 *   - make sure the automatic app discount that runs the Function exists
 *   - report honestly whether it is really going to apply
 *
 * Same trust model and shape as reward-gift-shopify.server.js. BRIX Cash on
 * Delivery orders never get the discount: they carry `_brixCod`, which the
 * Function refuses (see cod.server.js draftLineItems / placeCodOrder).
 *
 * The storefront shows the offer only when the result here was `verified`
 * (stored as `_runtime.prepaid` in the COD settings and passed on by
 * php_backend/cod_storefront.php), so shoppers are never promised a discount
 * Shopify won't give.
 */
import { prepaidDiscountLive } from '../utils/product-payment.shared.js';

export const PREPAID_FUNCTION_HANDLE = 'brix-prepaid-discount';
export const PREPAID_DISCOUNT_TITLE = 'BRIX Prepaid Discount';
export const PREPAID_CONFIG_KEY = 'prepaid_discount_config';

async function gql(admin, query, variables) {
  const response = await admin.graphql(query, { variables });
  const payload = await response.json();
  if (payload?.errors?.length) throw new Error(`Shopify rejected the request: ${JSON.stringify(payload.errors).slice(0, 200)}`);
  return payload.data;
}

/** The Function's config, from sanitized COD settings. `enabled: false` = the Function gives nothing. */
export function buildPrepaidConfig(settings, { currencyCode = null, planLive = false } = {}) {
  const pp = settings?.productPayment;
  const live = prepaidDiscountLive(pp, planLive);
  return {
    version: 1,
    enabled: live,
    percent: live ? Number(pp.prepaid.percent) : 0,
    minSubtotal: live ? Number(pp.prepaid.minSubtotal) || 0 : 0,
    currency: currencyCode,
    title: live ? pp.prepaid.title : '',
  };
}

async function writePrepaidConfig(admin, config) {
  const shopData = await gql(admin, '#graphql\nquery PrepaidShopId { shop { id } }');
  const data = await gql(admin, `#graphql
    mutation PrepaidConfig($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message code } }
    }`, { metafields: [{ ownerId: shopData.shop.id, namespace: '$app', key: PREPAID_CONFIG_KEY, type: 'json', value: JSON.stringify(config) }] });
  const errors = data?.metafieldsSet?.userErrors || [];
  if (errors.length) throw new Error(`Could not sync the prepaid discount configuration: ${errors[0].message}`);
}

// `automaticDiscountNodes` is deprecated and never returns app (Function)
// discounts, so this must go through `discountNodes`.
async function findInstalledDiscount(admin) {
  const data = await gql(admin, `#graphql
    query PrepaidDiscounts {
      discountNodes(first: 100, query: "type:app") {
        nodes { id discount { __typename ... on DiscountAutomaticApp { title status } } }
      }
    }`);
  const nodes = data?.discountNodes?.nodes || [];
  const node = nodes.find((item) => item.discount?.__typename === 'DiscountAutomaticApp' && item.discount.title === PREPAID_DISCOUNT_TITLE);
  return node ? { id: node.id, automaticDiscount: node.discount } : null;
}

/** Create the automatic app discount that runs the Function, if it isn't there yet. */
async function ensurePrepaidDiscount(admin) {
  const existing = await findInstalledDiscount(admin);
  if (existing) return { created: false, status: existing.automaticDiscount.status };
  const data = await gql(admin, `#graphql
    mutation PrepaidDiscountCreate($discount: DiscountAutomaticAppInput!) {
      discountAutomaticAppCreate(automaticAppDiscount: $discount) {
        automaticAppDiscount { discountId status }
        userErrors { field message code }
      }
    }`, {
    discount: {
      title: PREPAID_DISCOUNT_TITLE,
      functionHandle: PREPAID_FUNCTION_HANDLE,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      discountClasses: ['ORDER'],
      // Stacks with product discounts (Packs, free gifts) and free shipping;
      // against another order discount (e.g. a 15% code) Shopify keeps the better one.
      combinesWith: { productDiscounts: true, orderDiscounts: false, shippingDiscounts: true },
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

/** What the storefront may show: only a verified discount, with the numbers Shopify really has. */
export function prepaidRuntime(result, config) {
  return result.verified
    ? { verified: true, percent: config.percent, minSubtotal: config.minSubtotal, currency: config.currency, state: result.state, at: new Date().toISOString() }
    : { verified: false, state: result.state, at: new Date().toISOString() };
}

/**
 * Bring Shopify in line with the merchant's saved prepaid discount: rewrite
 * the Function config and make sure the discount exists. Never throws —
 * returns { ok, verified, state, message, config } so callers can say exactly
 * what is (and isn't) live. `verified` is true only when the discount exists,
 * is ACTIVE, and the config was written.
 *
 * states: not_needed | plan_locked | active | not_deployed | inactive | failed
 */
export async function syncPrepaidDiscount(admin, settings, { currencyCode = null, planLive = false } = {}) {
  const config = buildPrepaidConfig(settings, { currencyCode, planLive });
  const wanted = Boolean(settings?.productPayment?.enabled && settings.productPayment.prepaid?.enabled);
  try {
    await writePrepaidConfig(admin, config);
    if (!config.enabled) {
      if (wanted && !planLive) {
        return { ok: true, verified: false, state: 'plan_locked', message: 'The prepaid discount goes live for shoppers on the Starter or Pro plan.', config };
      }
      return { ok: true, verified: false, state: 'not_needed', message: 'The prepaid discount is off.', config };
    }
    const discount = await ensurePrepaidDiscount(admin);
    if (discount.status && discount.status !== 'ACTIVE') {
      return { ok: false, verified: false, state: 'inactive', message: `The prepaid discount is ${String(discount.status).toLowerCase()} in Shopify (Discounts → ${PREPAID_DISCOUNT_TITLE}).`, config };
    }
    return { ok: true, verified: true, state: 'active', message: `The ${config.percent}% prepaid discount is active in Shopify checkout.`, config };
  } catch (error) {
    if (error?.code === 'not_deployed') {
      return {
        ok: false, verified: false, state: 'not_deployed',
        message: 'The prepaid discount is not installed on this store yet (the app needs to be deployed once with its latest extension). Shoppers won\'t see the offer until then.',
        config,
      };
    }
    console.error('[prepaid-discount] sync failed:', String(error?.message || error).slice(0, 300));
    return { ok: false, verified: false, state: 'failed', message: 'Could not set up the prepaid discount in Shopify. Shoppers won\'t see the offer until it works.', config };
  }
}
