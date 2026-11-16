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
import { excludedCollectionIds, excludedProductIds, prepaidDiscountLive, prepaidShowOnly, prepaidUsable } from '../utils/product-payment.shared.js';

export const PREPAID_FUNCTION_HANDLE = 'brix-prepaid-discount';
export const PREPAID_DISCOUNT_TITLE = 'BRIX Prepaid Discount';
export const PREPAID_CONFIG_KEY = 'prepaid_discount_config';
// $collectionIds for the Function's input query (the collections the merchant
// left out), a metafield on the discount itself like combo weight's.
export const PREPAID_VARS_KEY = 'prepaid_discount_vars';

/** The Function's input variables: { collectionIds: [gid] } of the excluded collections. */
export function buildPrepaidVariables(settings) {
  const ids = excludedCollectionIds(settings?.productPayment?.prepaid);
  return { collectionIds: ids.map((id) => `gid://shopify/Collection/${id}`) };
}

const varsMetafield = (variables) => ({ namespace: '$app', key: PREPAID_VARS_KEY, type: 'json', value: JSON.stringify(variables) });

async function writePrepaidVariables(admin, discountId, variables) {
  const data = await gql(admin, `#graphql
    mutation PrepaidDiscountVars($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message code } }
    }`, { metafields: [{ ownerId: discountId, ...varsMetafield(variables) }] });
  const errors = data?.metafieldsSet?.userErrors || [];
  if (errors.length) throw new Error(`Could not save the prepaid discount's excluded collections: ${errors[0].message}`);
}

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
    // Only when set, so a config without a cap is exactly what it was.
    ...(live && Number(pp.prepaid.maxDiscount) > 0 ? { maxDiscount: Number(pp.prepaid.maxDiscount) } : {}),
    // Products left out one by one (numeric ids); only when set, like the cap.
    ...(live && excludedProductIds(pp.prepaid).length ? { excludedProducts: excludedProductIds(pp.prepaid) } : {}),
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

/**
 * Prepaid off (or show only, or locked by the plan): delete BRIX's automatic
 * discount, so it is gone from the store's Discounts list too and can't give
 * anything even if a config write failed. It is created again when switched
 * back on. Never throws: { removed, failed }.
 */
async function removePrepaidDiscount(admin) {
  try {
    const existing = await findInstalledDiscount(admin);
    if (!existing) return { removed: false, failed: false };
    const data = await gql(admin, `#graphql
      mutation PrepaidDiscountDelete($id: ID!) {
        discountAutomaticDelete(id: $id) {
          deletedAutomaticDiscountId
          userErrors { field message }
        }
      }`, { id: existing.id });
    const errors = data?.discountAutomaticDelete?.userErrors || [];
    if (errors.length) throw new Error(errors[0].message);
    return { removed: true, failed: false };
  } catch (error) {
    console.error('[prepaid-discount] could not delete the discount:', String(error?.message || error).slice(0, 300));
    return { removed: false, failed: true };
  }
}

/** Reactivate BRIX's discount. Returns its status afterwards (the old one if Shopify refused). */
async function activatePrepaidDiscount(admin, id, oldStatus) {
  try {
    const data = await gql(admin, `#graphql
      mutation PrepaidDiscountActivate($id: ID!) {
        discountAutomaticActivate(id: $id) {
          automaticDiscountNode { id automaticDiscount { ... on DiscountAutomaticApp { status } } }
          userErrors { field message }
        }
      }`, { id });
    const errors = data?.discountAutomaticActivate?.userErrors || [];
    if (errors.length) throw new Error(errors[0].message);
    return data?.discountAutomaticActivate?.automaticDiscountNode?.automaticDiscount?.status || oldStatus;
  } catch (error) {
    console.error('[prepaid-discount] could not reactivate the discount:', String(error?.message || error).slice(0, 300));
    return oldStatus;
  }
}

/** Create the automatic app discount that runs the Function, if it isn't there yet, and (re)write its input variables. */
async function ensurePrepaidDiscount(admin, variables) {
  const existing = await findInstalledDiscount(admin);
  if (existing) {
    await writePrepaidVariables(admin, existing.id, variables);
    const status = existing.automaticDiscount.status;
    // Deactivated in Shopify → Discounts (e.g. to switch it off there): the
    // BRIX switch is the one that counts, so switching prepaid on here makes
    // BRIX's own discount active again.
    if (status && status !== 'ACTIVE') return { created: false, status: await activatePrepaidDiscount(admin, existing.id, status) };
    return { created: false, status };
  }
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
      metafields: [varsMetafield(variables)],
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
  // Show only: the numbers the storefront shows; no discount of BRIX's.
  if (result.showOnly) return { verified: false, showOnly: true, percent: config.percent, minSubtotal: config.minSubtotal, maxDiscount: config.maxDiscount || 0, currency: config.currency, excludedCollections: result.excludedCollections || [], excludedProducts: result.excludedProducts || [], state: result.state, at: new Date().toISOString() };
  return result.verified
    ? { verified: true, percent: config.percent, minSubtotal: config.minSubtotal, maxDiscount: config.maxDiscount || 0, currency: config.currency, excludedCollections: result.excludedCollections || [], excludedProducts: result.excludedProducts || [], state: result.state, at: new Date().toISOString() }
    : { verified: false, state: result.state, at: new Date().toISOString() };
}

/**
 * Bring Shopify in line with the merchant's saved prepaid discount: rewrite
 * the Function config and make sure the discount exists. Never throws —
 * returns { ok, verified, state, message, config } so callers can say exactly
 * what is (and isn't) live. `verified` is true only when the discount exists,
 * is ACTIVE, and the config was written.
 *
 * states: not_needed | show_only | plan_locked | active | not_deployed | inactive | failed
 */
export async function syncPrepaidDiscount(admin, settings, { currencyCode = null, planLive = false } = {}) {
  const config = buildPrepaidConfig(settings, { currencyCode, planLive });
  const wanted = Boolean(settings?.productPayment?.prepaid?.enabled && prepaidUsable(settings.productPayment));
  try {
    // Off: the discount itself goes first, so a failed config write below
    // can't leave the old one giving money off.
    const removal = config.enabled ? null : await removePrepaidDiscount(admin);
    const stillThere = removal?.failed
      ? ` ${PREPAID_DISCOUNT_TITLE} could not be deleted from Shopify; it gives nothing now, and you can delete it in Shopify → Discounts.`
      : '';
    await writePrepaidConfig(admin, config);
    if (!config.enabled) {
      // "Create the discount" off: BRIX's discount gives nothing (config
      // enabled: false); the storefront only shows the prepaid price.
      if (prepaidShowOnly(settings.productPayment, planLive)) {
        const p = settings.productPayment.prepaid;
        const shown = { percent: Number(p.percent), minSubtotal: Number(p.minSubtotal) || 0, maxDiscount: Number(p.maxDiscount) || 0, currency: currencyCode, title: p.title };
        return {
          ok: true, verified: false, showOnly: true, state: 'show_only',
          message: `Shoppers see the ${shown.percent}% prepaid price, but BRIX creates no discount: your checkout (e.g. Shiprocket) has to give it.${stillThere}`,
          config: shown, excludedCollections: excludedCollectionIds(p), excludedProducts: excludedProductIds(p),
        };
      }
      if (wanted && !planLive) {
        return { ok: true, verified: false, state: 'plan_locked', message: `The prepaid discount goes live for shoppers on the Starter or Pro plan.${stillThere}`, config };
      }
      return { ok: true, verified: false, state: 'not_needed', message: `The prepaid discount is off${removal?.removed ? ` and ${PREPAID_DISCOUNT_TITLE} was removed from Shopify` : ''}.${stillThere}`, config };
    }
    const variables = buildPrepaidVariables(settings);
    const discount = await ensurePrepaidDiscount(admin, variables);
    if (discount.status && discount.status !== 'ACTIVE') {
      return { ok: false, verified: false, state: 'inactive', message: `The prepaid discount is ${String(discount.status).toLowerCase()} in Shopify (Discounts → ${PREPAID_DISCOUNT_TITLE}).`, config };
    }
    // Numeric ids, for the storefront (cod_storefront.php) and the Shiprocket code.
    const excludedCollections = excludedCollectionIds(settings.productPayment.prepaid);
    const excludedProducts = excludedProductIds(settings.productPayment.prepaid);
    const plural = (n, word) => `${n} excluded ${word}${n === 1 ? '' : 's'}`;
    const leftOut = [excludedProducts.length && plural(excludedProducts.length, 'product'), excludedCollections.length && plural(excludedCollections.length, 'collection')].filter(Boolean);
    const left = leftOut.length ? ` Not on ${leftOut.join(' or ')}.` : '';
    return { ok: true, verified: true, state: 'active', message: `The ${config.percent}% prepaid discount is active in Shopify checkout.${left}`, config, excludedCollections, excludedProducts };
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
