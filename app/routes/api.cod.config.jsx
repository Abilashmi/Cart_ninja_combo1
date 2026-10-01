import { codErrorResponse } from '../services/cod.server';
import { COD_CORS_HEADERS, loadCodContext, ok, parseShop } from '../services/cod-storefront.server';

/**
 * GET /api/cod/config?shop=<shop>.myshopify.com
 *
 * What the storefront COD sheet (brix_cod.js) needs to decide whether to show
 * the Cash on Delivery buttons. Only display hints: every rule is enforced
 * again server-side by /api/cod/quote and /api/cod/order.
 */
const CACHE_TTL_MS = 30_000;
const cache = new Map();

export async function loader({ request }) {
  try {
    const shop = parseShop(new URL(request.url).searchParams.get('shop'));
    const cached = cache.get(shop);
    if (cached && cached.expiresAt > Date.now()) return ok(cached.body, { 'Cache-Control': 'public, max-age=30' });

    const ctx = await loadCodContext(shop);
    const s = ctx.settings;
    const body = ctx.live
      ? {
          enabled: true,
          surfaces: s.surfaces,
          otpRequired: ctx.otpRequired,
          minOrder: s.minOrder,
          maxOrder: s.maxOrder,
          codFee: s.codFee,
          shippingFee: s.shippingFee,
          freeShippingAbove: s.freeShippingAbove,
          blockedPincodes: s.blockedPincodes,
          excludedProductTags: s.excludedProductTags,
          allowCoupons: s.allowCoupons,
          prepaidNudgeText: s.prepaidNudgeText,
          buttons: s.buttons,
          currency: ctx.currencyCode,
        }
      : { enabled: false };
    cache.set(shop, { body, expiresAt: Date.now() + CACHE_TTL_MS });
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return ok(body, { 'Cache-Control': 'public, max-age=30' });
  } catch (error) {
    return codErrorResponse(error, COD_CORS_HEADERS);
  }
}
