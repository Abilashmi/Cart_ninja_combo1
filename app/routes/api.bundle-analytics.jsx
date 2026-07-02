import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';
import { ensureAnalyticsTables } from '../services/analytics-schema.server';

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
  const startDateParam = url.searchParams.get('startDate');
  const endDateParam = url.searchParams.get('endDate');
  const days = Math.min(parseInt(url.searchParams.get('days') || '14', 10), 90);

  // Accept an explicit range (used by app.analytics.jsx's Build A Combo tab
  // so bundle revenue and store revenue are compared over the same window)
  // or fall back to a trailing N-day window (used by app.bundles.analytics.jsx).
  const rangeStart = startDateParam
    ? `${startDateParam} 00:00:00`
    : null;
  const rangeEnd = endDateParam ? `${endDateParam} 23:59:59` : null;
  const useExplicitRange = Boolean(rangeStart && rangeEnd);

  try {
    const db = getDb();
    await ensureAnalyticsTables(db);

    const rangeCondition = useExplicitRange
      ? `AND recorded_at BETWEEN ? AND ?`
      : `AND recorded_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`;
    const rangeParams = useExplicitRange ? [rangeStart, rangeEnd] : [days];

    const [[views], [clicks], [conversions], [revenue], [daily], [topTemplates], [discountUsage]] = await Promise.all([
      db.execute(`SELECT COUNT(*) AS n FROM \`${TABLE}\` WHERE shop_domain = ? AND event_type = 'view' ${rangeCondition}`, [shop, ...rangeParams]),
      db.execute(`SELECT COUNT(*) AS n FROM \`${TABLE}\` WHERE shop_domain = ? AND event_type = 'click' ${rangeCondition}`, [shop, ...rangeParams]),
      db.execute(`SELECT COUNT(*) AS n FROM \`${TABLE}\` WHERE shop_domain = ? AND event_type = 'order' ${rangeCondition}`, [shop, ...rangeParams]),
      db.execute(`SELECT COALESCE(SUM(revenue), 0) AS total FROM \`${TABLE}\` WHERE shop_domain = ? AND event_type = 'order' ${rangeCondition}`, [shop, ...rangeParams]),

      // Daily breakdown for the selected range
      db.execute(`
        SELECT
          DATE(recorded_at) AS date,
          SUM(event_type = 'view')  AS views,
          SUM(event_type = 'click') AS clicks,
          SUM(event_type = 'order') AS conversions,
          COALESCE(SUM(CASE WHEN event_type='order' THEN revenue ELSE 0 END), 0) AS revenue
        FROM \`${TABLE}\`
        WHERE shop_domain = ? ${rangeCondition}
        GROUP BY DATE(recorded_at)
        ORDER BY date ASC
      `, [shop, ...rangeParams]),

      // Top templates by conversions, scoped to the same range
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
        WHERE ca.shop_domain = ? ${rangeCondition.replace('recorded_at', 'ca.recorded_at')}
        GROUP BY ca.template_id, ct.name
        ORDER BY conversions DESC
        LIMIT 10
      `, [shop, ...rangeParams]),

      // Real discount usage (populated when a Combo Forge discount is
      // applied at checkout, event_type='discount_applied').
      db.execute(`
        SELECT
          discount_code,
          COUNT(*) AS uses,
          COALESCE(SUM(revenue), 0) AS revenue
        FROM \`${TABLE}\`
        WHERE shop_domain = ? AND event_type = 'discount_applied' AND discount_code IS NOT NULL ${rangeCondition}
        GROUP BY discount_code
        ORDER BY uses DESC
        LIMIT 10
      `, [shop, ...rangeParams]),
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
        discount_usage: (discountUsage || []).map(r => ({
          code:    r.discount_code,
          uses:    Number(r.uses),
          revenue: parseFloat(r.revenue),
        })),
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
  const { shop_domain, template_id, event_type, revenue, discount_code } = body;

  if (!shop_domain || !event_type) {
    return Response.json({ success: false, error: 'shop_domain and event_type required' }, { status: 400 });
  }

  const validEvents = ['view', 'click', 'add_to_cart', 'checkout', 'order', 'discount_applied'];
  if (!validEvents.includes(event_type)) {
    return Response.json({ success: false, error: `event_type must be one of: ${validEvents.join(', ')}` }, { status: 400 });
  }

  try {
    const db = getDb();
    await ensureAnalyticsTables(db);
    await db.execute(
      `INSERT INTO \`${TABLE}\` (shop_domain, template_id, event_type, revenue, discount_code) VALUES (?, ?, ?, ?, ?)`,
      [shop_domain, template_id ? Number(template_id) : null, event_type, revenue ? parseFloat(revenue) : 0, discount_code || null]
    );
    return Response.json({ success: true, message: 'Event recorded' });
  } catch (err) {
    console.error('[bundle-analytics action]', err.message);
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
