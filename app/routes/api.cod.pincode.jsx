import { CodError, codErrorResponse, lookupPincode } from '../services/cod.server';
import { COD_CORS_HEADERS, limitByIp, loadCodContext, ok, parseShop } from '../services/cod-storefront.server';
import { isValidPincode } from '../utils/cod.shared.js';

/**
 * GET /api/cod/pincode?shop=<shop>&pin=560001
 * → { pincode, city, state, found, blocked }
 * City/state come from India Post; when that lookup fails the shopper simply
 * types them in, so `found: false` is not an error.
 */
export async function loader({ request }) {
  try {
    const url = new URL(request.url);
    const shop = parseShop(url.searchParams.get('shop'));
    const pin = String(url.searchParams.get('pin') || '').trim();
    if (!isValidPincode(pin)) throw new CodError('invalid_pincode', 'Enter a valid 6-digit PIN code.');
    limitByIp(request, 'cod-pin', 60, 60_000);

    const [ctx, place] = await Promise.all([loadCodContext(shop, { needAdmin: false }), lookupPincode(pin)]);
    return ok({
      pincode: pin,
      found: Boolean(place),
      city: place?.city || '',
      state: place?.state || '',
      blocked: ctx.settings.blockedPincodes.includes(pin),
    });
  } catch (error) {
    return codErrorResponse(error, COD_CORS_HEADERS);
  }
}
