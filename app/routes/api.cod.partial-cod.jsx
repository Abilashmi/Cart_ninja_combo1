import { CodError, cleanDeliveryChoice, codErrorResponse } from '../services/cod.server';
import {
  COD_CORS_HEADERS, assertLive, corsPreflight, limitByIp, loadCodContext, ok, parseShop, parseSurface, readJson,
} from '../services/cod-storefront.server';
import { createPartialCod } from '../services/partial-cod.server';
import { normalizeLines, validateAddress } from '../utils/cod.shared.js';

/**
 * POST /api/cod/partial-cod (through php_backend/cod_checkout.php)
 *   { shop, surface, items, coupon?, address, delivery?, cartCodes?, cartAttributes? }
 * → { code, advance, balance, total, currency, endsAt }
 *
 * Partial COD from the COD popup's review step: the same order the popup
 * priced, as a one-time code that leaves only the advance to pay in Shopify
 * checkout (services/partial-cod.server.js). The browser then opens Shopify
 * checkout with the code; the balance is added to the order when it comes in.
 * No OTP: the advance is paid online in Shopify checkout.
 */
export async function action({ request }) {
  if (request.method === 'OPTIONS') return corsPreflight();
  try {
    const body = await readJson(request);
    const shop = parseShop(body.shop);
    const surface = parseSurface(body.surface);
    limitByIp(request, 'partial-cod', 10, 10 * 60_000);

    const { lines, error: linesError } = normalizeLines(body.items);
    if (linesError) throw new CodError('invalid_items', linesError);
    const { address, error: addressError } = validateAddress(body.address);
    if (addressError) throw new CodError('invalid_address', addressError);

    // With the shipping rules, as the popup's quote is (api.cod.quote.jsx).
    const ctx = await loadCodContext(shop, { withShipping: true });
    assertLive(ctx, surface);
    if (!ctx.settings.partialCod?.enabled) {
      throw new CodError('partial_unavailable', 'Part payment is not available right now. Please choose Cash on Delivery or pay online.', { status: 403 });
    }

    const result = await createPartialCod(ctx.admin, {
      shop,
      settings: ctx.settings,
      lines,
      coupon: body.coupon,
      address,
      surface,
      currencyCode: ctx.currencyCode,
      comboWeightLive: ctx.comboWeightLive,
      cartCodes: body.cartCodes,
      cartAttributes: body.cartAttributes,
      shipping: ctx.shipping,
      delivery: cleanDeliveryChoice(body.delivery),
    });
    return ok(result);
  } catch (error) {
    return codErrorResponse(error, COD_CORS_HEADERS);
  }
}

export function loader() {
  return Response.json({ success: false, error: 'POST only.' }, { status: 405, headers: COD_CORS_HEADERS });
}
