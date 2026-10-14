import { CodError, codErrorResponse, getCodSettingsWithRuntime } from '../services/cod.server';
import { COD_CORS_HEADERS, corsPreflight, limitByIp, loadCodContext, ok, parseShop, readJson } from '../services/cod-storefront.server';
import { isShiprocketEnabled } from '../services/shop-integrations.server';
import { cleanupExpiredCodes } from '../services/combo-box-code.server';
import { PREPAID_CODE_TITLE_PREFIX, createPrepaidCode, prepaidOffer } from '../services/prepaid-code.server';
import { normalizeLines } from '../utils/cod.shared.js';

/**
 * POST /api/cod/prepaid-code (through php_backend/cod_checkout.php)
 *   { shop, items: [{ variantId, quantity }] }
 * → { code } — a one-time Shopify code worth the verified prepaid saving, for
 * the product page's Pay Online and the cart drawers' Checkout (the cart's
 * paid lines) on a shop that checks out through Shiprocket
 * (prepaid-code.server.js). code: null = no live prepaid offer.
 */
export async function action({ request }) {
  if (request.method === 'OPTIONS') return corsPreflight();
  try {
    const body = await readJson(request);
    const shop = parseShop(body.shop);
    limitByIp(request, 'prepaid-code', 10, 10 * 60_000);
    const { lines, error } = normalizeLines(body.items);
    if (error) throw new CodError('invalid_items', error);
    if (!(await isShiprocketEnabled(shop))) {
      throw new CodError('not_shiprocket', 'This store does not check out through Shiprocket.', { status: 403 });
    }

    const [ctx, stored] = await Promise.all([loadCodContext(shop), getCodSettingsWithRuntime(shop)]);
    const offer = prepaidOffer(stored.settings, stored.runtime, ctx.planState === 'enabled');
    const result = await createPrepaidCode(ctx.admin, { offer, items: lines });
    if (result.code) cleanupExpiredCodes(ctx.admin, shop, PREPAID_CODE_TITLE_PREFIX).catch(() => {});
    return ok({ code: result.code, percent: result.percent ?? null });
  } catch (error) {
    return codErrorResponse(error, COD_CORS_HEADERS);
  }
}

export function loader() {
  return Response.json({ success: false, error: 'POST only.' }, { status: 405, headers: COD_CORS_HEADERS });
}
