import { getDb } from '../services/db.server';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const PHP_BASE = process.env.PHP_BASE_URL || 'https://int.thecartninja.com';

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

    // If not in local MySQL, try PHP backend (data may have been saved there)
    if (!result) {
      result = await fetchFromPhpBackend(shopDomain);
    }

    if (!result) {
      return new Response(
        JSON.stringify({ status: 'error', message: 'No data found for this shop' }),
        { status: 404, headers: CORS }
      );
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
