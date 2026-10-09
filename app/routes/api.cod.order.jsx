import { CodError, clientIp, clientUa, codErrorResponse, placeCodOrder, rateLimit, readPhoneToken } from '../services/cod.server';
import {
  COD_CORS_HEADERS, assertLive, corsPreflight, limitByIp, loadCodContext, ok, parseShop, parseSurface, readJson,
} from '../services/cod-storefront.server';
import { normalizeIndianPhone, normalizeLines, sanitizeCodTrack, validateAddress } from '../utils/cod.shared.js';

/**
 * POST /api/cod/order
 *   { shop, surface, items, coupon?, attributes?, idemKey,
 *     phone, token?,            // token from /api/cod/otp when the store requires OTP
 *     address: { name, address1, address2, city, state, pincode, email },
 *     track?: { gaClientId, gaSessionId, fbp, fbc, consent: { analytics, marketing }, pageUrl } }
 * → { order: { orderName, orderId, statusPageUrl, total, currency, repeated? } }
 *
 * Creates a real Shopify order with payment pending, tagged COD + BRIX-COD.
 */
export async function action({ request }) {
  if (request.method === 'OPTIONS') return corsPreflight();
  try {
    const body = await readJson(request);
    const shop = parseShop(body.shop);
    const surface = parseSurface(body.surface);
    limitByIp(request, 'cod-order', 8, 10 * 60_000);

    const { lines, error: linesError } = normalizeLines(body.items);
    if (linesError) throw new CodError('invalid_items', linesError);
    const { address, error: addressError } = validateAddress(body.address);
    if (addressError) throw new CodError('invalid_address', addressError);

    const ctx = await loadCodContext(shop);
    assertLive(ctx, surface);

    let phone = normalizeIndianPhone(body.phone);
    let phoneVerified = false;
    if (ctx.otpRequired) {
      phone = readPhoneToken(shop, body.token);
      if (!phone) throw new CodError('otp_required', 'Please verify your phone number again.', { status: 401 });
      phoneVerified = true;
    }
    if (!phone) throw new CodError('invalid_phone', 'Enter a valid 10-digit mobile number.');
    if (!rateLimit(`cod-order-phone:${shop}:${phone}`, 5, 10 * 60_000)) {
      throw new CodError('rate_limited', 'Too many attempts. Please wait a few minutes and try again.', { status: 429 });
    }

    const order = await placeCodOrder(ctx.admin, {
      shop,
      settings: ctx.settings,
      lines,
      coupon: body.coupon,
      address,
      phone,
      phoneVerified,
      surface,
      attributes: body.attributes,
      idemKey: body.idemKey,
      currencyCode: ctx.currencyCode,
      comboWeightLive: ctx.comboWeightLive,
      // The cart's discount codes and attributes (used only as the merchant's cart-discount setting allows).
      cartCodes: body.cartCodes,
      cartAttributes: body.cartAttributes,
      // Server-side GA4 / Meta Purchase (cod-tracking.server.js); consent comes from the browser.
      track: sanitizeCodTrack(body.track),
      clientIp: clientIp(request),
      userAgent: clientUa(request),
    });
    return ok({ order });
  } catch (error) {
    return codErrorResponse(error, COD_CORS_HEADERS);
  }
}

export function loader() {
  return Response.json({ success: false, error: 'POST only.' }, { status: 405, headers: COD_CORS_HEADERS });
}
