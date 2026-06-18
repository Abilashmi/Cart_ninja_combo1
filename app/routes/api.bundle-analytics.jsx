import { authenticate } from '../shopify.server';
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
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const days = Math.min(parseInt(url.searchParams.get('days') || '14', 10), 90);

  try {
    const db = getDb();

    const [[views], [clicks], [conversions], [revenue], [daily], [topTemplates]] = await Promise.all([
      db.execute(`SELECT COUNT(*) AS n FROM \`${TABLE}\` WHERE shop_domain = ? AND event_type = 'view'`, [shop]),
      db.execute(`SELECT COUNT(*) AS n FROM \`${TABLE}\` WHERE shop_domain = ? AND event_type = 'click'`, [shop]),
      db.execute(`SELECT COUNT(*) AS n FROM \`${TABLE}\` WHERE shop_domain = ? AND event_type = 'order'`, [shop]),
      db.execute(`SELECT COALESCE(SUM(revenue), 0) AS total FROM \`${TABLE}\` WHERE shop_domain = ? AND event_type = 'order'`, [shop]),

      // Daily breakdown for last N days
      db.execute(`
        SELECT
          DATE(recorded_at) AS date,
          SUM(event_type = 'view')  AS views,
          SUM(event_type = 'click') AS clicks,
          SUM(event_type = 'order') AS conversions,
          COALESCE(SUM(CASE WHEN event_type='order' THEN revenue ELSE 0 END), 0) AS revenue
        FROM \`${TABLE}\`
        WHERE shop_domain = ?
          AND recorded_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        GROUP BY DATE(recorded_at)
        ORDER BY date ASC
      `, [shop, days]),

      // Top templates by conversions
      db.execute(`
        SELECT
          ct.name,
          ct.id AS template_id,
          SUM(ca.event_type = 'view')  AS views,
          SUM(ca.event_type = 'click') AS clicks,
          SUM(ca.event_type = 'order') AS conversions,
          COALESCE(SUM(CASE WHEN ca.event_type='order' THEN ca.revenue ELSE 0 END), 0) AS revenue
        FROM \`${TABLE}\` ca
        LEFT JOIN combo_templates ct ON ct.id = ca.template_id
        WHERE ca.shop_domain = ?
        GROUP BY ca.template_id, ct.name
        ORDER BY conversions DESC
        LIMIT 10
      `, [shop]),
    ]);

    const dailyFormatted = (daily || []).map(r => ({
      date: new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      views: Number(r.views),
      clicks: Number(r.clicks),
      conversions: Number(r.conversions),
      revenue: parseFloat(r.revenue),
    }));

    return Response.json({
      success: true,
      data: {
        total_views:       Number(views[0]?.n ?? 0),
        total_clicks:      Number(clicks[0]?.n ?? 0),
        total_conversions: Number(conversions[0]?.n ?? 0),
        total_revenue:     parseFloat(revenue[0]?.total ?? 0),
        total_orders:      Number(conversions[0]?.n ?? 0),
        daily:             dailyFormatted,
        top_templates:     (topTemplates || []).map(r => ({
          name:        r.name || `Template #${r.template_id}`,
          template_id: r.template_id,
          views:       Number(r.views),
          clicks:      Number(r.clicks),
          conversions: Number(r.conversions),
          revenue:     parseFloat(r.revenue),
        })),
        discount_usage: [],
      },
    });
  } catch (err) {
    console.error('[bundle-analytics loader]', err.message);
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
    console.error('[bundle-analytics action]', err.message);
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
