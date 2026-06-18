/**
 * GET    /api/coupon-display-rules?shop=…        — list all rules
 * GET    /api/coupon-display-rules?shop=…&id=123 — get one
 * POST   /api/coupon-display-rules               — create
 * PUT    /api/coupon-display-rules               — update (body.id required)
 * DELETE /api/coupon-display-rules               — delete (body.id required)
 */
import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const db = getDb();

  if (id) {
    const [rows] = await db.execute(
      'SELECT * FROM coupon_display_rules WHERE id = ? AND shop_domain = ? LIMIT 1',
      [Number(id), shop]
    );
    if (!rows.length) return Response.json({ success: false, error: 'Not found' }, { status: 404 });
    return Response.json({ success: true, data: rows[0] });
  }

  const [rows] = await db.execute(
    'SELECT * FROM coupon_display_rules WHERE shop_domain = ? ORDER BY sort_order ASC, id ASC',
    [shop]
  );
  return Response.json({ success: true, data: rows });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();
  const db = getDb();

  // DELETE
  if (request.method === 'DELETE') {
    if (!body.id) return Response.json({ success: false, error: 'id required' }, { status: 400 });
    await db.execute('DELETE FROM coupon_display_rules WHERE id = ? AND shop_domain = ?', [body.id, shop]);
    return Response.json({ success: true });
  }

  // PUT — update existing
  if (request.method === 'PUT') {
    if (!body.id) return Response.json({ success: false, error: 'id required' }, { status: 400 });
    await db.execute(`
      UPDATE coupon_display_rules SET
        coupon_code = ?, name = ?, heading_text = ?, subtext_text = ?,
        bg_color = ?, text_color = ?, button_text = ?, button_bg_color = ?,
        button_text_color = ?, button_border_radius = ?, show_button = ?,
        icon_url = ?, icon_bg_color = ?, icon_size = ?, icon_border_radius = ?,
        icon_alignment = ?, condition_type = ?, selected_products = ?,
        selected_collections = ?, display_tags = ?, is_active = ?,
        sort_order = ?, updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ? AND shop_domain = ?
    `, [
      body.coupon_code || body.code || '',
      body.name || null,
      body.heading_text || null,
      body.subtext_text || null,
      body.bg_color || '#ffffff',
      body.text_color || '#111827',
      body.button_text || 'Apply',
      body.button_bg_color || '#111827',
      body.button_text_color || '#ffffff',
      body.button_border_radius ?? 6,
      body.show_button !== false ? 1 : 0,
      body.icon_url || null,
      body.icon_bg_color || null,
      body.icon_size ?? 32,
      body.icon_border_radius ?? 8,
      body.icon_alignment || 'left',
      body.condition_type || 'all',
      body.selected_products?.length ? JSON.stringify(body.selected_products) : null,
      body.selected_collections?.length ? JSON.stringify(body.selected_collections) : null,
      body.display_tags?.length ? JSON.stringify(body.display_tags) : null,
      body.is_active !== false ? 1 : 0,
      body.sort_order ?? 0,
      body.id, shop,
    ]);
    const [rows] = await db.execute('SELECT * FROM coupon_display_rules WHERE id = ?', [body.id]);
    return Response.json({ success: true, data: rows[0] });
  }

  // POST — create
  const [ins] = await db.execute(`
    INSERT INTO coupon_display_rules
      (shop_domain, coupon_code, name, heading_text, subtext_text,
       bg_color, text_color, button_text, button_bg_color, button_text_color,
       button_border_radius, show_button, icon_url, icon_bg_color, icon_size,
       icon_border_radius, icon_alignment, condition_type, selected_products,
       selected_collections, display_tags, is_active, sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `, [
    shop,
    body.coupon_code || body.code || '',
    body.name || null,
    body.heading_text || null,
    body.subtext_text || null,
    body.bg_color || '#ffffff',
    body.text_color || '#111827',
    body.button_text || 'Apply',
    body.button_bg_color || '#111827',
    body.button_text_color || '#ffffff',
    body.button_border_radius ?? 6,
    body.show_button !== false ? 1 : 0,
    body.icon_url || null,
    body.icon_bg_color || null,
    body.icon_size ?? 32,
    body.icon_border_radius ?? 8,
    body.icon_alignment || 'left',
    body.condition_type || 'all',
    body.selected_products?.length ? JSON.stringify(body.selected_products) : null,
    body.selected_collections?.length ? JSON.stringify(body.selected_collections) : null,
    body.display_tags?.length ? JSON.stringify(body.display_tags) : null,
    body.is_active !== false ? 1 : 0,
    body.sort_order ?? 0,
  ]);
  const [rows] = await db.execute('SELECT * FROM coupon_display_rules WHERE id = ?', [ins.insertId]);
  return Response.json({ success: true, data: rows[0] }, { status: 201 });
}
