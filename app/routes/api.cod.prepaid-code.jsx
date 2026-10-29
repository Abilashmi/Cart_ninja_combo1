import { CodError, codErrorResponse, getCodSettingsWithRuntime } from '../services/cod.server';
import { COD_CORS_HEADERS, corsPreflight, limitByIp, loadCodContext, ok, parseShop, readJson } from '../services/cod-storefront.server';
import { isShiprocketEnabled } from '../services/shop-integrations.server';
import { cleanupExpiredCodes } from '../services/combo-box-code.server';
import { PREPAID_CODE_TITLE_PREFIX, createPrepaidCode, prepaidOffer } from '../services/prepaid-code.server';
import { normalizeLines } from '../utils/cod.shared.js';
import { buildRewardConfig } from '../services/reward-gift-shopify.server';
import { fetchProgressBar } from '../services/cart-config-writes.server';
import { getDb } from '../services/db.server';

/**
 * POST /api/cod/prepaid-code (through php_backend/cod_checkout.php)
 *   { shop, items: [{ variantId, quantity }], gifts?: [{ variantId, quantity }], prepaid?: boolean }
 * → { code, gifts } — a one-time Shopify code worth the verified prepaid saving
 * plus the free reward gifts the cart really earned (gifts = how many it
 * covers; Shiprocket can't run either Function), for
 * the product page's Pay Online and the cart drawers' Checkout (the cart's
 * paid lines) on a shop that checks out through Shiprocket
 * (prepaid-code.server.js). code: null = no live prepaid offer.
 */
export async function action({ request }) {
  if (request.method === 'OPTIONS') return corsPreflight();
  try {
    const body = await readJson(request);
    const shop = parseShop(body.shop);
    // 30: the cart drawer also asks ahead, once per cart it shows (brix_cod.js prepareCartCode).
    limitByIp(request, 'prepaid-code', 30, 10 * 60_000);
    const { lines, error } = normalizeLines(body.items);
    if (error) throw new CodError('invalid_items', error);
    if (!(await isShiprocketEnabled(shop))) {
      throw new CodError('not_shiprocket', 'This store does not check out through Shiprocket.', { status: 403 });
    }

    // The cart's free reward lines (optional): checked against the saved
    // Progress Bar's free milestones, never trusted from the browser.
    const giftLines = Array.isArray(body.gifts) && body.gifts.length ? normalizeLines(body.gifts) : { lines: [] };
    if (giftLines.error) throw new CodError('invalid_items', giftLines.error);

    const [ctx, stored, progressBar] = await Promise.all([
      loadCodContext(shop),
      getCodSettingsWithRuntime(shop),
      giftLines.lines.length ? fetchProgressBar(getDb(), shop).catch(() => null) : null,
    ]);
    const offer = prepaidOffer(stored.settings, stored.runtime, ctx.planState === 'enabled' && !ctx.paused);
    const rewardTiers = progressBar ? buildRewardConfig(progressBar).tiers : null;
    const result = await createPrepaidCode(ctx.admin, { offer, items: lines, gifts: giftLines.lines, rewardTiers, prepaid: body.prepaid !== false });
    if (result.code) cleanupExpiredCodes(ctx.admin, shop, PREPAID_CODE_TITLE_PREFIX).catch(() => {});
    return ok({ code: result.code, percent: result.percent ?? null, gifts: result.gifts || 0 });
  } catch (error) {
    return codErrorResponse(error, COD_CORS_HEADERS);
  }
}

export function loader() {
  return Response.json({ success: false, error: 'POST only.' }, { status: 405, headers: COD_CORS_HEADERS });
}
