/**
 * BRIX Packs — everything that talks to Shopify's Admin API:
 *   - live product / variant / price lookups (never trust browser data)
 *   - hydrating stored Packs with recalculated tier prices
 *   - keeping the checkout discount function's config in sync
 *   - verifying that the checkout discount is really installed and active
 */
import { PackError, saveStorefrontDiscountState } from './packs.server';
import { calculateTier, currencyDecimals, normalizeTiers, toGid, toNumericId, validateVariantCoverage } from '../utils/packs.shared.js';

export const PACKS_FUNCTION_HANDLE = 'brix-packs-discount';
export const PACKS_DISCOUNT_TITLE = 'BRIX Packs';
export const PACKS_CONFIG_KEY = 'packs_config';

const VARIANT_FIELDS = `id title price availableForSale inventoryQuantity inventoryPolicy image { url } product { id title handle status featuredImage { url } }`;

async function gql(admin, query, variables) {
  let payload;
  try {
    const response = await admin.graphql(query, { variables });
    payload = await response.json();
  } catch (error) {
    console.error('[packs-shopify] request failed:', String(error?.message || '').slice(0, 200));
    throw new PackError('shopify_error', 'Could not reach Shopify. Please try again.', { status: 502 });
  }
  if (payload?.errors?.length) {
    console.error('[packs-shopify] GraphQL errors:', JSON.stringify(payload.errors).slice(0, 400));
    throw new PackError('shopify_error', 'Shopify rejected the request. Please try again.', { status: 502 });
  }
  return payload.data;
}

function shapeVariant(node) {
  const price = Number(node.price);
  return {
    id: toNumericId(node.id),
    title: node.title,
    price: Number.isFinite(price) ? price : null,
    availableForSale: Boolean(node.availableForSale),
    // Only a hard cap when Shopify refuses overselling; 0/untracked = no cap.
    maxQuantity: node.inventoryPolicy === 'DENY' && Number(node.inventoryQuantity) > 0 ? Number(node.inventoryQuantity) : null,
    inventoryQuantity: Number.isFinite(Number(node.inventoryQuantity)) ? Number(node.inventoryQuantity) : null,
    inventoryPolicy: node.inventoryPolicy || null,
    image: node.image?.url || '',
  };
}

/** A product and all (up to 100) of its variants, straight from Shopify. */
export async function fetchProduct(admin, productId) {
  const gid = toGid('Product', productId);
  if (!gid) throw new PackError('invalid_product', 'Invalid product id.');
  const data = await gql(admin, `#graphql
    query PackProduct($id: ID!) {
      product(id: $id) {
        id title handle status featuredImage { url }
        variants(first: 100) { nodes { id title price availableForSale inventoryQuantity inventoryPolicy image { url } } }
      }
    }`, { id: gid });
  const product = data?.product;
  if (!product) throw new PackError('product_not_found', 'That product no longer exists in Shopify.', { status: 404 });
  return {
    id: toNumericId(product.id),
    title: product.title,
    handle: product.handle,
    status: product.status,
    image: product.featuredImage?.url || '',
    variants: product.variants.nodes.map(shapeVariant),
  };
}

/** Live data for a set of variants, keyed by numeric variant id. Missing ids are simply absent. */
export async function fetchVariants(admin, variantIds) {
  const ids = [...new Set(variantIds.map((id) => toGid('ProductVariant', id)).filter(Boolean))];
  const result = new Map();
  for (let start = 0; start < ids.length; start += 100) {
    const data = await gql(admin, `#graphql
      query PackVariants($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { ${VARIANT_FIELDS} } } }`, { ids: ids.slice(start, start + 100) });
    for (const node of data?.nodes || []) {
      if (!node?.id) continue;
      result.set(toNumericId(node.id), { ...shapeVariant(node), productId: toNumericId(node.product?.id), productTitle: node.product?.title || '', productHandle: node.product?.handle || '', productStatus: node.product?.status || null, productImage: node.product?.featuredImage?.url || '' });
    }
  }
  return result;
}

/**
 * Verify a product + variant pair against Shopify and return what may be
 * trusted. Throws a PackError describing exactly what is wrong.
 */
export async function verifyProductVariant(admin, productId, variantId, { requireAvailable = false } = {}) {
  const product = await fetchProduct(admin, productId);
  const variant = product.variants.find((item) => item.id === toNumericId(variantId));
  if (!variant) throw new PackError('variant_not_found', 'The selected variant no longer exists on this product.', { status: 404 });
  if (variant.price === null || variant.price < 0) throw new PackError('price_unverified', 'Could not verify the current variant price with Shopify.', { status: 502 });
  if (requireAvailable && !variant.availableForSale) throw new PackError('variant_unavailable', 'The selected variant is out of stock, so this Pack cannot be activated.', { status: 409 });
  if (requireAvailable && product.status !== 'ACTIVE') throw new PackError('product_inactive', 'The selected product is not active in Shopify, so this Pack cannot be activated.', { status: 409 });
  return { product, variant };
}

/**
 * Verify a Pack's product-level variant coverage (pack_type / variant_scope /
 * allowed_variant_ids) against Shopify. Never trusts browser-supplied variant
 * ids — they are checked against the product's REAL variants and anything
 * that doesn't belong is dropped (validateVariantCoverage). Returns the
 * verified product, the resolved list of applicable variants (all of the
 * product's variants for scope='all', or just the owned subset for
 * scope='selected'), and an anchor variant (the first applicable one) used
 * for base pricing / display / the row's legacy variant_id column.
 */
export async function verifyPackCoverage(admin, productId, { packType, variantScope, allowedVariantIds }, { requireAvailable = false } = {}) {
  const product = await fetchProduct(admin, productId);
  const check = validateVariantCoverage({ packType, variantScope, allowedVariantIds }, product.variants.map((variant) => variant.id));
  if (!check.valid) throw new PackError('invalid_variant', check.errors[0].message, { status: 422, details: { errors: check.errors } });

  const applicableVariants = variantScope === 'all' ? product.variants : product.variants.filter((variant) => check.allowedVariantIds.includes(variant.id));
  if (applicableVariants.some((variant) => variant.price === null || variant.price < 0)) {
    throw new PackError('price_unverified', 'Could not verify the current price of one of this Pack’s variants.', { status: 502 });
  }
  if (requireAvailable) {
    if (product.status !== 'ACTIVE') throw new PackError('product_inactive', 'The selected product is not active in Shopify, so this Pack cannot be activated.', { status: 409 });
    if (!applicableVariants.some((variant) => variant.availableForSale)) throw new PackError('variant_unavailable', 'None of this Pack’s variants are in stock, so it cannot be activated.', { status: 409 });
  }

  const anchorVariant = applicableVariants[0];
  return { product, applicableVariants, allowedVariantIds: check.allowedVariantIds, anchorVariant };
}

/**
 * Attach live data + freshly calculated tier prices to stored Packs.
 * `pack.tiers[*].price/savings/...` are always derived here, never stored.
 * A Pack whose variant is gone / unpriced is flagged (`issue`) rather than
 * throwing so one broken Pack can't break a whole list or the storefront.
 */
export async function hydratePacks(admin, packs, currency, { includeVariants = false } = {}) {
  if (!packs.length) return [];
  let live = new Map();
  let lookupFailed = null;
  try {
    live = await fetchVariants(admin, packs.map((pack) => pack.variantId));
  } catch (error) {
    lookupFailed = error instanceof PackError ? error.message : 'Could not verify prices with Shopify.';
  }

  // Packs whose coverage spans more than one variant (mix_match, or
  // same_variant with scope='all'/multiple selected variants) need the full,
  // live-priced variant list — not just the anchor — so the storefront/admin
  // preview can price and offer every applicable variant. Fetched once per
  // distinct product, only when the caller actually needs it.
  const variantsByProduct = new Map();
  if (includeVariants) {
    const needsExpansion = packs.filter((pack) => pack.packType === 'mix_match' || pack.variantScope === 'all' || (pack.allowedVariantIds || []).length > 1);
    const productIds = [...new Set(needsExpansion.map((pack) => pack.productId))];
    await Promise.all(productIds.map(async (productId) => {
      try {
        const product = await fetchProduct(admin, productId);
        variantsByProduct.set(productId, product.variants);
      } catch {
        // Leave unset — the pack simply won't get an expanded variant list;
        // its own issue/priceVerified flag (from the anchor lookup) still applies.
      }
    }));
  }

  return packs.map((pack) => {
    const variant = live.get(pack.variantId);
    let issue = lookupFailed;
    if (!issue && !variant) issue = 'The Shopify variant for this Pack no longer exists.';
    else if (!issue && variant.productId && variant.productId !== pack.productId) issue = 'The Shopify variant no longer belongs to this product.';
    else if (!issue && variant.price === null) issue = 'The current variant price could not be verified.';
    const priceVerified = !issue;
    const basePrice = priceVerified ? variant.price : pack.basePrice;
    const tiers = normalizeTiers(pack.tiers).map((tier) => ({ ...tier, ...calculateTier(basePrice, tier, { currencyCode: currency?.code, locale: currency?.locale }) }));

    let variants;
    const productVariants = variantsByProduct.get(pack.productId);
    if (productVariants) {
      const applicable = pack.variantScope === 'all' ? productVariants : productVariants.filter((item) => (pack.allowedVariantIds || []).includes(item.id));
      variants = applicable.filter((item) => item.price !== null);
    }

    return {
      ...pack,
      basePrice,
      tiers,
      priceVerified,
      issue: issue || null,
      available: Boolean(variant?.availableForSale) || Boolean(variants?.some((item) => item.availableForSale)),
      maxQuantity: variant?.maxQuantity ?? null,
      productTitle: variant?.productTitle || pack.productTitle,
      variantTitle: variant?.title || pack.variantTitle,
      productImage: variant?.productImage || pack.productImage,
      productHandle: variant?.productHandle || '',
      variants,
      displayStatus: issue && pack.status === 'active' ? 'configuration_error' : pack.status,
      currency: currency ? { code: currency.code, locale: currency.locale } : null,
    };
  });
}

export function currencyDecimalsFor(currency) {
  return currency?.code ? currencyDecimals(currency.code) : 2;
}

// ─── Checkout discount (Shopify Function) ────────────────────────────────────

/** The trusted config the discount function reads. Keyed by Pack id. */
export function buildFunctionConfig(activePacks, currencyCode = null) {
  const packs = {};
  for (const pack of activePacks) {
    packs[String(pack.id)] = {
      id: pack.id,
      version: pack.version,
      productId: pack.productId,
      variantId: pack.variantId,
      template: pack.template,
      // The Function trusts these (never the storefront's own claim) to decide
      // which variant(s) a cart line marked with this Pack's id is allowed to be.
      // A pack with no (or empty) allowedVariantIds falls back to its anchor
      // variantId alone, so a scope='selected' pack never ends up trusting
      // every variant of the product just because the list came in empty.
      variantScope: pack.variantScope,
      allowedVariantIds: pack.variantScope === 'all' ? [] : (Array.isArray(pack.allowedVariantIds) && pack.allowedVariantIds.length ? pack.allowedVariantIds : [pack.variantId]),
      tiers: normalizeTiers(pack.tiers).map((tier) => ({ quantity: tier.quantity, discountType: tier.discountType, discountValue: tier.discountValue })),
    };
  }
  return { version: 1, currency: currencyCode, packs };
}

async function getShopGid(admin) {
  const data = await gql(admin, '#graphql\nquery PackShopId { shop { id } }');
  return data.shop.id;
}

/** Write the shop-level app-owned metafield the discount function reads. */
export async function writeFunctionConfig(admin, activePacks, currencyCode) {
  const config = buildFunctionConfig(activePacks, currencyCode);
  const ownerId = await getShopGid(admin);
  const data = await gql(admin, `#graphql
    mutation PackConfig($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message code } }
    }`, { metafields: [{ ownerId, namespace: '$app', key: PACKS_CONFIG_KEY, type: 'json', value: JSON.stringify(config) }] });
  const errors = data?.metafieldsSet?.userErrors || [];
  if (errors.length) {
    console.error('[packs-shopify] metafieldsSet userErrors:', JSON.stringify(errors).slice(0, 300));
    throw new PackError('config_sync_failed', 'Could not sync Pack configuration to Shopify.', { status: 502 });
  }
  return config;
}

async function readFunctionConfig(admin) {
  const data = await gql(admin, `#graphql
    query PackConfigRead { shop { metafield(namespace: "$app", key: "${PACKS_CONFIG_KEY}") { jsonValue } } }`);
  return data?.shop?.metafield?.jsonValue || null;
}

// `automaticDiscountNodes` is deprecated and never returns app (Function)
// discounts, so this must go through `discountNodes`.
async function findInstalledDiscount(admin) {
  const data = await gql(admin, `#graphql
    query PackDiscounts {
      discountNodes(first: 100, query: "type:app") {
        nodes { id discount { __typename ... on DiscountAutomaticApp { title status appDiscountType { functionId } } } }
      }
    }`);
  const nodes = data?.discountNodes?.nodes || [];
  const node = nodes.find((item) => item.discount?.__typename === 'DiscountAutomaticApp' && item.discount.title === PACKS_DISCOUNT_TITLE);
  return node ? { id: node.id, automaticDiscount: node.discount } : null;
}

/**
 * Create the automatic app discount that runs the Packs function, if it
 * doesn't exist yet. Requires the function to be deployed to the shop
 * (`shopify app dev` for a dev store, `shopify app deploy` for production).
 */
export async function ensurePacksDiscount(admin) {
  const existing = await findInstalledDiscount(admin);
  if (existing) return { created: false, discountId: existing.id, status: existing.automaticDiscount.status };
  const data = await gql(admin, `#graphql
    mutation PackDiscountCreate($discount: DiscountAutomaticAppInput!) {
      discountAutomaticAppCreate(automaticAppDiscount: $discount) {
        automaticAppDiscount { discountId status }
        userErrors { field message code }
      }
    }`, {
    discount: {
      title: PACKS_DISCOUNT_TITLE,
      functionHandle: PACKS_FUNCTION_HANDLE,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      discountClasses: ['PRODUCT'],
      combinesWith: { productDiscounts: true, orderDiscounts: true, shippingDiscounts: true },
    },
  });
  const errors = data?.discountAutomaticAppCreate?.userErrors || [];
  if (errors.length) {
    console.error('[packs-shopify] discountAutomaticAppCreate userErrors:', JSON.stringify(errors).slice(0, 400));
    const notDeployed = errors.some((error) => /function/i.test(`${error.message} ${error.code}`));
    throw new PackError(notDeployed ? 'function_not_deployed' : 'discount_create_failed',
      notDeployed ? 'The BRIX Packs checkout discount function is not deployed to this store yet.' : 'Shopify could not create the Packs checkout discount.', { status: 502 });
  }
  const created = data.discountAutomaticAppCreate.automaticAppDiscount;
  return { created: true, discountId: created.discountId, status: created.status };
}

/**
 * Is the checkout discount REALLY going to apply? `verified` is true only when
 * (1) the automatic app discount exists and is ACTIVE, and (2) the shop config
 * metafield the function reads contains every given active Pack at its current
 * version. Anything else -> verified:false with a specific state.
 *
 * States: active | discount_missing | discount_inactive | config_out_of_date | unknown
 */
export async function getCheckoutDiscountStatus(admin, activePacks = [], { shop = null } = {}) {
  const status = await readCheckoutDiscountStatus(admin, activePacks);
  // Pass `shop` to also record the result for the PHP storefront endpoint.
  // An 'unknown' result (Shopify unreachable) keeps the last recorded state.
  if (shop && status.state !== 'unknown') await saveStorefrontDiscountState(shop, status, activePacks);
  return status;
}

async function readCheckoutDiscountStatus(admin, activePacks) {
  try {
    const discount = await findInstalledDiscount(admin);
    if (!discount) return { verified: false, state: 'discount_missing', message: 'The Packs checkout discount is not installed on this store.' };
    if (discount.automaticDiscount.status !== 'ACTIVE') return { verified: false, state: 'discount_inactive', message: `The Packs checkout discount is ${String(discount.automaticDiscount.status).toLowerCase()}.` };
    const config = await readFunctionConfig(admin);
    const missing = activePacks.filter((pack) => {
      const entry = config?.packs?.[String(pack.id)];
      return !entry || entry.id !== pack.id || entry.version !== pack.version;
    });
    if (missing.length) return { verified: false, state: 'config_out_of_date', message: 'Pack configuration has not synced to Shopify yet. Re-save the Pack to retry.' };
    return { verified: true, state: 'active', discountId: discount.id, message: 'Checkout discount is active.' };
  } catch (error) {
    return { verified: false, state: 'unknown', message: error instanceof PackError ? error.message : 'Could not verify the checkout discount.' };
  }
}

/**
 * After any change to a shop's active Packs: rewrite the function config and
 * make sure the discount exists. Never throws — returns { ok, warning } so a
 * save still succeeds and the UI can show exactly what still needs attention.
 */
export async function syncCheckoutDiscount(admin, activePacks, { install = true, currencyCode = null } = {}) {
  try {
    await writeFunctionConfig(admin, activePacks, currencyCode);
    if (install && activePacks.length) await ensurePacksDiscount(admin);
    return { ok: true, warning: null };
  } catch (error) {
    const warning = error instanceof PackError ? { code: error.code, message: error.message } : { code: 'sync_failed', message: 'Could not sync the checkout discount.' };
    console.error('[packs-shopify] checkout discount sync incomplete:', warning.code);
    return { ok: false, warning };
  }
}
