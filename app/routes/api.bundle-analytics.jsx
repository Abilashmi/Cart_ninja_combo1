import prisma from '../db.server';

const TABLE = 'combo_analytics';

async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_domain TEXT NOT NULL,
      template_id INTEGER,
      event_type TEXT NOT NULL,
      revenue REAL DEFAULT 0,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).catch(() => {});
}

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

  await ensureTable();

  try {
    const [views, clicks, conversions] = await Promise.all([
      prisma.$queryRawUnsafe(`SELECT COUNT(*) as n FROM ${TABLE} WHERE shop_domain = ? AND event_type = 'view'`, shop).catch(() => [{ n: 0 }]),
      prisma.$queryRawUnsafe(`SELECT COUNT(*) as n FROM ${TABLE} WHERE shop_domain = ? AND event_type = 'click'`, shop).catch(() => [{ n: 0 }]),
      prisma.$queryRawUnsafe(`SELECT COUNT(*) as n FROM ${TABLE} WHERE shop_domain = ? AND event_type = 'order'`, shop).catch(() => [{ n: 0 }]),
    ]);
    const revenue = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(revenue), 0) as total FROM ${TABLE} WHERE shop_domain = ? AND event_type = 'order'`, shop
    ).catch(() => [{ total: 0 }]);

    const data = {
      total_views: Number(views[0]?.n ?? 0),
      total_clicks: Number(clicks[0]?.n ?? 0),
      total_conversions: Number(conversions[0]?.n ?? 0),
      total_revenue: parseFloat(revenue[0]?.total ?? 0),
      total_orders: Number(conversions[0]?.n ?? 0),
      daily: [], top_templates: [], discount_usage: [],
    };

    return Response.json({ success: true, data });
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

  await ensureTable();

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${TABLE} (shop_domain, template_id, event_type, revenue, recorded_at) VALUES (?, ?, ?, ?, datetime('now'))`,
      shop_domain, template_id ? Number(template_id) : null, event_type, revenue ? parseFloat(revenue) : 0
    );
    return Response.json({ success: true, message: 'Event recorded' });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
