import { unauthenticated } from '../shopify.server';
import { getFeatureState } from '../config/plans';
import { getShopPlan } from '../services/plan-permissions.server';
import { getShopCurrency } from '../utils/currency.server';
import { loadComboTemplateRow } from '../services/combo-page.server';
import { isShiprocketEnabled } from '../services/shop-integrations.server';
import { rateLimit, clientIp } from '../services/cod.server';
import { boxCheckoutOf, cleanupExpiredBoxCodes, createBoxCode } from '../services/combo-box-code.server';

// POST /api/combo-box-code { shop, templateId, items: [{ variantId, quantity }] }
// → { success, code } — a one-time Shopify code worth the box's discount, for
// a box combo the merchant sends to Shiprocket (combo-box-code.server.js).
// Public and cross-origin like api.combo-page-data: the amount is worked out
// here from Shopify's data, never from the request. code: null = no discount
// on this box (no tier reached, or the box discount isn't live).
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

function reply(body, status = 200) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

function parseItems(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) return null;
  const items = [];
  for (const item of raw) {
    const variantId = String(item?.variantId ?? '').split('/').pop();
    const quantity = Number(item?.quantity);
    if (!/^\d{1,20}$/.test(variantId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) return null;
    items.push({ variantId, quantity });
  }
  return items;
}

export async function action({ request }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'POST') return reply({ success: false, error: 'POST only.' }, 405);

  let body;
  try {
    const text = await request.text();
    if (text.length > 16 * 1024) return reply({ success: false, error: 'Request is too large.' }, 413);
    body = JSON.parse(text || '{}') || {};
  } catch {
    return reply({ success: false, error: 'Invalid request.' }, 400);
  }

  const shop = String(body.shop || '').trim().toLowerCase();
  const templateId = String(body.templateId || '');
  const items = parseItems(body.items);
  if (!SHOP_RE.test(shop) || !/^\d{1,12}$/.test(templateId) || !items) {
    return reply({ success: false, error: 'Invalid request.' }, 400);
  }
  if (!rateLimit(`box-code:${clientIp(request)}`, 10, 10 * 60_000)) {
    return reply({ success: false, error: 'Too many requests.' }, 429);
  }

  try {
    const row = await loadComboTemplateRow(shop, templateId);
    const config = (() => { try { return JSON.parse(row?.customization_data || '{}'); } catch { return {}; } })();
    if (!row || !(Number(row.is_active) === 1 || row.is_active === true)) return reply({ success: false, error: 'Combo not found.' }, 404);
    if (boxCheckoutOf(config) !== 'shiprocket' || !(await isShiprocketEnabled(shop))) {
      return reply({ success: false, error: 'This combo does not check out through Shiprocket.' }, 403);
    }

    let admin;
    try {
      ({ admin } = await unauthenticated.admin(shop));
    } catch {
      return reply({ success: false, error: 'This store is not connected to BRIX.' }, 404);
    }
    const [planKey, currency] = await Promise.all([getShopPlan(shop), getShopCurrency(admin, shop)]);
    const result = await createBoxCode(admin, {
      templateId,
      items,
      comboWeightLive: getFeatureState(planKey, 'combo_weight_pricing') === 'enabled',
      currencyCode: currency?.code || 'INR',
    });
    cleanupExpiredBoxCodes(admin, shop).catch(() => {});
    return reply({ success: true, code: result.code, amount: result.amount || null });
  } catch (error) {
    console.error('[api.combo-box-code] failed:', error.message);
    return reply({ success: false, error: 'Could not prepare the box discount.' }, 502);
  }
}

export function loader() {
  return reply({ success: false, error: 'POST only.' }, 405);
}
