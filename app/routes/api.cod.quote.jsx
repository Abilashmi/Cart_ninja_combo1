import { CodError, cleanDeliveryChoice, codErrorResponse, quoteCod } from '../services/cod.server';
import {
  COD_CORS_HEADERS, assertLive, corsPreflight, limitByIp, loadCodContext, ok, parseShop, parseSurface, readJson,
} from '../services/cod-storefront.server';
import { isValidPincode, normalizeLines } from '../utils/cod.shared.js';

/**
 * POST /api/cod/quote
 *   { shop, surface: 'drawer'|'product'|'combo', items: [{ variantId, quantity, properties }], coupon?, pincode?,
 *     city?, state? (the address, for advanced shipping's zones), delivery?: { option, date, slot },
 *     cartCodes?: [code] (the cart's discount codes), cartAttributes?: {} (the cart's attributes) }
 * → { quote } priced by Shopify (draftOrderCalculate), with the COD rules applied;
 *   quote.delivery = the delivery options under advanced shipping.
 */
export async function action({ request }) {
  if (request.method === 'OPTIONS') return corsPreflight();
  try {
    const body = await readJson(request);
    const shop = parseShop(body.shop);
    const surface = parseSurface(body.surface);
    limitByIp(request, 'cod-quote', 40, 60_000);
    const { lines, error } = normalizeLines(body.items);
    if (error) throw new CodError('invalid_items', error);
    const pincode = body.pincode ? String(body.pincode).trim() : null;
    if (pincode && !isValidPincode(pincode)) throw new CodError('invalid_pincode', 'Enter a valid 6-digit PIN code.');

    const place = (v) => (typeof v === 'string' ? v.trim().slice(0, 80) : '');
    const destination = pincode ? { pincode, city: place(body.city), state: place(body.state) } : null;

    const ctx = await loadCodContext(shop, { withShipping: true });
    assertLive(ctx, surface);
    const { quote } = await quoteCod(ctx.admin, {
      settings: ctx.settings, lines, coupon: body.coupon, pincode, surface, currencyCode: ctx.currencyCode,
      comboWeightLive: ctx.comboWeightLive, cartCodes: body.cartCodes, cartAttributes: body.cartAttributes,
      shipping: ctx.shipping, destination, delivery: cleanDeliveryChoice(body.delivery),
    });
    return ok({ quote });
  } catch (error) {
    return codErrorResponse(error, COD_CORS_HEADERS);
  }
}

export function loader() {
  return Response.json({ success: false, error: 'POST only.' }, { status: 405, headers: COD_CORS_HEADERS });
}
