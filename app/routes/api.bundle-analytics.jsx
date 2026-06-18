import { getDb } from '../services/db.server';

const TABLE = 'combo_analytics';

function buildDefaultAnalytics() {
  return {
    total_views: 0, total_clicks: 0, total_conversions: 0,
    total_revenue: 0, total_orders: 0,
    daily: [], top_templates: [], discount_usage: [],
  };
}

export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');

  if (!shop) {
    return Response.json({ success: false, error: 'shop parameter required' }, { status: 400 });
  }

  try {
    const db = getDb();
    const [[views], [clicks], [conversions], [revenue]] = await Promise.all([
      db.execute(`SELECT COUNT(*) AS n FROM \`${TABLE}\` WHERE shop_domain = ? AND event_type = 'view'`, [shop]),
      db.execute(`SELECT COUNT(*) AS n FROM \`${TABLE}\` WHERE shop_domain = ? AND event_type = 'click'`, [shop]),
      db.execute(`SELECT COUNT(*) AS n FROM \`${TABLE}\` WHERE shop_domain = ? AND event_type = 'order'`, [shop]),
      db.execute(`SELECT COALESCE(SUM(revenue), 0) AS total FROM \`${TABLE}\` WHERE shop_domain = ? AND event_type = 'order'`, [shop]),
    ]);

    return Response.json({
      success: true,
      data: {
        total_views:       Number(views[0]?.n ?? 0),
        total_clicks:      Number(clicks[0]?.n ?? 0),
        total_conversions: Number(conversions[0]?.n ?? 0),
        total_revenue:     parseFloat(revenue[0]?.total ?? 0),
        total_orders:      Number(conversions[0]?.n ?? 0),
        daily: [], top_templates: [], discount_usage: [],
      },
    });
  } catch (err) {
    return Response.json({ success: true, data: buildDefaultAnalytics(), _note: 'fallback' });
  }
}

export async function action({ request }) {
  if (request.method !== 'POST') {
    return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
  }

  const body = await request.json().catch(() => ({}));
  const { shop_domain, template_id, event_type, revenue } = body;

  if (!shop_domain || !event_type) {
    return Response.json({ success: false, error: 'shop_domain and event_type required' }, { status: 400 });
  }

  const validEvents = ['view', 'click', 'add_to_cart', 'checkout', 'order'];
  if (!validEvents.includes(event_type)) {
    return Response.json({ success: false, error: `event_type must be one of: ${validEvents.join(', ')}` }, { status: 400 });
  }

  try {
    const db = getDb();
    await db.execute(
      `INSERT INTO \`${TABLE}\` (shop_domain, template_id, event_type, revenue) VALUES (?, ?, ?, ?)`,
      [shop_domain, template_id ? Number(template_id) : null, event_type, revenue ? parseFloat(revenue) : 0]
    );
    return Response.json({ success: true, message: 'Event recorded' });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
