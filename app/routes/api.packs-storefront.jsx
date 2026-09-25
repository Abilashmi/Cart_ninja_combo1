import { unauthenticated } from '../shopify.server';
import { getFeatureState } from '../config/plans';
import { getShopPlan } from '../services/plan-permissions.server';
import { getShopCurrency } from '../utils/currency.server';
import { PackError, packErrorResponse, listActivePacksForProduct, listActivePacks } from '../services/packs.server';
import { fetchProduct, hydratePacks, getCheckoutDiscountStatus } from '../services/packs-shopify.server';
import { toNumericId } from '../utils/packs.shared.js';

/**
 * Public storefront endpoint for the BRIX Packs widget.
 *
 * GET /api/packs-storefront?shop=<shop>.myshopify.com&productId=<numeric id or GID>[&preview=1]
 *
 * Response contract (one shape, always):
 *   200 { success: true,
 *         packs: Pack[],            // active Packs for the product, [] when none
 *         reason: null | 'plan_restricted' | 'no_active_pack' | 'discount_unverified' | 'price_unverified',
 *         currency: { code, locale },
 *         checkoutDiscount: { verified, state, message },
 *         preview: boolean }
 *   4xx/5xx { success: false, error, code }
 *
 * Shoppers only ever receive Packs whose checkout discount is VERIFIED to be
 * installed and in sync — otherwise the widget would advertise savings that
 * checkout doesn't apply. `preview=1` (merchant testing) returns the Packs
 * anyway, flagged with checkoutDiscount.verified=false so the widget can say so.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, max-age=15',
};
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;
const CACHE_TTL_MS = 30_000;
const cache = new Map(); // `${shop}:${productId}` -> { expiresAt, body }

function ok(body) {
  return Response.json({ success: true, ...body }, { headers: CORS_HEADERS });
}

// Only what the widget needs — no shop, timestamps, internal status, etc.
function publicPack(pack, productVariants) {
  return {
    id: pack.id,
    version: pack.version,
    variantId: pack.variantId,
    template: pack.template,
    productTitle: pack.productTitle,
    variantTitle: pack.variantTitle,
    productImage: pack.productImage,
    basePrice: pack.basePrice,
    available: pack.available,
    maxQuantity: pack.maxQuantity,
    tiers: pack.tiers.map((tier) => ({
      quantity: tier.quantity, name: tier.name, badge: tier.badge, discountType: tier.discountType, discountValue: tier.discountValue,
      subtotal: tier.subtotal, discountAmount: tier.discountAmount, price: tier.price, savings: tier.savings, effectiveUnitPrice: tier.effectiveUnitPrice,
    })),
    customization: pack.customization,
    variants: pack.template === 'choose_each_item' ? productVariants : undefined,
  };
}

export async function loader({ request }) {
  try {
    const url = new URL(request.url);
    const shop = (url.searchParams.get('shop') || '').trim().toLowerCase();
    const productId = toNumericId(url.searchParams.get('productId'));
    const preview = url.searchParams.get('preview') === '1';
    if (!SHOP_RE.test(shop)) throw new PackError('invalid_shop', 'A valid shop is required.');
    if (!productId) throw new PackError('invalid_product', 'A valid productId is required.');

    const key = `${shop}:${productId}`;
    const cached = !preview && cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return ok(cached.body);

    let admin;
    try {
      ({ admin } = await unauthenticated.admin(shop));
    } catch {
      throw new PackError('shop_not_installed', 'This store is not connected to BRIX.', { status: 404 });
    }

    const planState = getFeatureState(await getShopPlan(shop), 'packs');
    const empty = { packs: [], preview, currency: null, checkoutDiscount: null };
    if (planState !== 'enabled') return ok({ ...empty, reason: 'plan_restricted' });

    const stored = await listActivePacksForProduct(shop, productId);
    if (!stored.length) return ok({ ...empty, reason: 'no_active_pack' });

    const currency = await getShopCurrency(admin, shop);
    const hydrated = await hydratePacks(admin, stored, currency);
    const priced = hydrated.filter((pack) => pack.priceVerified);
    if (!priced.length) return ok({ ...empty, currency, reason: 'price_unverified' });

    // Verify against ALL of the shop's active Packs so config drift is caught.
    const checkoutDiscount = await getCheckoutDiscountStatus(admin, await listActivePacks(shop));
    if (!checkoutDiscount.verified && !preview) return ok({ ...empty, currency, checkoutDiscount, reason: 'discount_unverified' });

    const needsVariants = priced.some((pack) => pack.template === 'choose_each_item');
    const productVariants = needsVariants ? (await fetchProduct(admin, productId)).variants : undefined;
    const body = { packs: priced.map((pack) => publicPack(pack, productVariants)), reason: null, currency: { code: currency.code, locale: currency.locale }, checkoutDiscount, preview };
    if (!preview) cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, body });
    return ok(body);
  } catch (error) {
    return packErrorResponse(error, CORS_HEADERS);
  }
}

export async function action({ request }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  return Response.json({ success: false, error: 'Method not allowed', code: 'method_not_allowed' }, { status: 405, headers: CORS_HEADERS });
}
