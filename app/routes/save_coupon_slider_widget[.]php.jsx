/**
 * Storefront coupon-slider config endpoint (hit via the Shopify app proxy).
 *
 * The product-widget editor saves styles + selected coupon to the `coupon_slider_widget`
 * table and placement to `coupon_slider_settings`. The PHP backend's
 * save_coupon_slider_widget.php GET already combines both into the exact shape
 * coupon_slider.js expects — so we proxy to it (server-to-server, no CORS) instead
 * of re-implementing the read. PHP_BASE_URL points at the local php_backend in dev.
 */
const PHP_BASE = process.env.PHP_BASE_URL || 'http://localhost/cartdrawerv2_ui/php_backend';

export async function loader({ request }) {
  const url = new URL(request.url);
  const shopDomain = url.searchParams.get('shopdomain') || url.searchParams.get('shopDomain') || '';

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (!shopDomain) {
    return new Response(JSON.stringify({ status: 'error', message: 'shopdomain required' }), { status: 400, headers });
  }

  try {
    const res = await fetch(
      `${PHP_BASE}/save_coupon_slider_widget.php?shopdomain=${encodeURIComponent(shopDomain)}`,
      { headers: { 'X-Forge-Secret': process.env.SHOPIFY_API_KEY || '' } }
    );
    let text = await res.text();
    // Strip a leading UTF-8 BOM if present, so the storefront JSON.parse works.
    text = text.replace(/^﻿/, '').trim();
    return new Response(text, { headers });
  } catch (e) {
    console.error('[save_coupon_slider_widget] proxy error:', e.message);
    return new Response(JSON.stringify({ status: 'error', message: e.message }), { status: 500, headers });
  }
}
