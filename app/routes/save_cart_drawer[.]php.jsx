import { getDb } from '../services/db.server';
import { getShopPlan, canPublishFeature } from '../services/plan-permissions.server';
import { PLANS } from '../config/plans';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const PHP_BASE = process.env.PHP_BASE_URL || 'https://int.thebrix.io';

async function fetchFromPhpBackend(shopDomain) {
  try {
    const res = await fetch(
      `${PHP_BASE}/save_cart_drawer.php?shopdomain=${encodeURIComponent(shopDomain)}`,
      { headers: { 'X-Forge-Secret': process.env.SHOPIFY_API_KEY || '' } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    return (json?.status === 'success' && json?.data) ? json.data : null;
  } catch {
    return null;
  }
}

function resolveShowWatermark(planKey, watermarkEnabledRaw) {
  const plan = PLANS[planKey] || PLANS.free;
  if (!plan.watermarkRemovable) return true;
  if (watermarkEnabledRaw === null || watermarkEnabledRaw === undefined || watermarkEnabledRaw === '') return true;
  return Boolean(Number(watermarkEnabledRaw));
}

function parseJsonField(value) {
  if (value === null || value === undefined || value === '') return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return (parsed && typeof parsed === 'object') ? parsed : null;
  } catch {
    return null;
  }
}

// Mirrors php_backend/save_cart_drawer.php's applyPlanGatingToCartDrawerResult
// — this Node route serves the same app-proxy path in local/dev environments
// and reads MySQL directly, so it must never leak locked/preview-only fields
// to the storefront on its own (never trust the client, never trust the
// other implementation either).
function applyPlanGatingToCartDrawerResult(result, planKey) {
  const gated = { ...result };
  gated.showWatermark = resolveShowWatermark(planKey, gated.watermark_enabled);

  if (!canPublishFeature(planKey, 'progress_bar')) {
    gated.progress_status = 0;
    gated.progressStatus = 0;
    // The storefront widget also falls back to an `enabled` flag baked into
    // progress_data itself (admin always saves pb.enabled there regardless
    // of plan) — strip it too or the top-level flags above do nothing.
    const progressData = parseJsonField(gated.progress_data);
    if (progressData) {
      progressData.enabled = false;
      gated.progress_data = JSON.stringify(progressData);
    }
  } else if (!canPublishFeature(planKey, 'confetti')) {
    const progressData = parseJsonField(gated.progress_data);
    if (progressData) {
      progressData.confetti = false;
      progressData.enableConfetti = false;
      gated.progress_data = JSON.stringify(progressData);
    }
  }

  if (!canPublishFeature(planKey, 'ai_cart_upsell')) {
    gated.upsell_status = 0;
    gated.upsellStatus = 0;
    // Same embedded-flag leak as progress bar above.
    const upsellData = parseJsonField(gated.upsell_data);
    if (upsellData) {
      upsellData.enabled = false;
      gated.upsell_data = JSON.stringify(upsellData);
    }
  }

  if (!canPublishFeature(planKey, 'custom_css')) {
    gated.customCSS = null;
  }

  if (!canPublishFeature(planKey, 'mobile_swipe_checkout')) {
    const checkoutStyle = parseJsonField(gated.checkout_button_style);
    if (checkoutStyle && checkoutStyle.mobileButtonType === 'swipe') {
      checkoutStyle.mobileButtonType = 'standard';
      gated.checkout_button_style = JSON.stringify(checkoutStyle);
    }
  }

  if (!canPublishFeature(planKey, 'open_countdown')) {
    const couponData = parseJsonField(gated.coupon_data);
    if (couponData && Array.isArray(couponData.selectedCoupons)) {
      couponData.selectedCoupons = couponData.selectedCoupons.map((c) =>
        (c && typeof c === 'object') ? { ...c, timerEnabled: false } : c
      );
      gated.coupon_data = JSON.stringify(couponData);
    }
  }

  return gated;
}

export async function loader({ request }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(request.url);
  const shopDomain = (url.searchParams.get('shopdomain') || url.searchParams.get('shop') || '').toLowerCase().trim();

  if (!shopDomain) {
    return new Response(
      JSON.stringify({ status: 'error', message: 'shopdomain parameter required' }),
      { status: 400, headers: CORS }
    );
  }

  try {
    const db = getDb();
    const [rows] = await db.execute(`
      SELECT cd.*,
        cdc.announcement_enabled, cdc.announcement_text, cdc.announcement_bg_color,
        cdc.announcement_text_color, cdc.announcement_font_size,
        cdc.header_title, cdc.header_bg_color, cdc.header_text_color, cdc.header_border_bottom,
        cdc.design_animation, cdc.design_border_radius, cdc.design_shadow, cdc.design_width,
        cdc.empty_cart_message, cdc.empty_cart_show_continue_shopping, cdc.empty_cart_show_recommendations
      FROM cart_drawer cd
      LEFT JOIN cart_drawer_config cdc ON cdc.shop_domain = cd.shop
      WHERE cd.shop = ?
      LIMIT 1
    `, [shopDomain]);

    let result = rows[0] || null;
    let fromPhpBackend = false;

    // If not in local MySQL, try PHP backend (data may have been saved there)
    if (!result) {
      result = await fetchFromPhpBackend(shopDomain);
      fromPhpBackend = true;
    }

    if (!result) {
      return new Response(
        JSON.stringify({ status: 'error', message: 'No data found for this shop' }),
        { status: 404, headers: CORS }
      );
    }

    // The PHP backend already applies its own plan gating before responding;
    // only the direct-DB row (read straight off MySQL) still needs it here.
    if (!fromPhpBackend) {
      const planKey = await getShopPlan(shopDomain);
      result = applyPlanGatingToCartDrawerResult(result, planKey);
    }

    return new Response(JSON.stringify({ status: 'success', data: result }), { headers: CORS });
  } catch (e) {
    console.error('[save_cart_drawer] DB error:', e);
    // Last resort: try PHP backend
    const phpResult = await fetchFromPhpBackend(shopDomain);
    if (phpResult) {
      return new Response(JSON.stringify({ status: 'success', data: phpResult }), { headers: CORS });
    }
    return new Response(
      JSON.stringify({ status: 'error', message: 'Database error' }),
      { status: 500, headers: CORS }
    );
  }
}
