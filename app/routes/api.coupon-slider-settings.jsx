import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';

function flag(v, d = 0) {
  if (v == null) return d;
  return (v === true || v === 1 || v === '1') ? 1 : 0;
}

function parseSelectedCoupons(row) {
  if (!row) return row;
  try {
    row.selected_coupons = row.selected_coupons
      ? JSON.parse(row.selected_coupons)
      : [];
  } catch {
    row.selected_coupons = [];
  }
  return row;
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const db = getDb();
  const [rows] = await db.execute(
    'SELECT * FROM coupon_slider_settings WHERE shop_domain = ? LIMIT 1',
    [session.shop]
  );
  const data = parseSelectedCoupons(rows[0] || null);
  return Response.json({ success: !!data, data });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();
  const db = getDb();

  const [exRows] = await db.execute(
    'SELECT * FROM coupon_slider_settings WHERE shop_domain = ? LIMIT 1', [shop]
  );
  const ex = exRows[0] || {};

  const pick = (v, exVal, def) =>
    (v !== undefined && v !== null) ? v
      : (exVal !== undefined && exVal !== null ? exVal : def);

  const selectedCoupons = Array.isArray(body.selectedCoupons)
    ? JSON.stringify(body.selectedCoupons)
    : (ex.selected_coupons ?? null);

  await db.execute(`
    INSERT INTO coupon_slider_settings
      (shop_domain, is_enabled, selected_template, title_text, title_color,
       title_font_size, title_font_weight, title_alignment, section_bg_color,
       card_bg_color, card_border_color, card_border_width, card_border_radius,
       card_shadow, auto_slide, slide_interval, position, layout, selected_coupons)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE
      is_enabled        = VALUES(is_enabled),
      selected_template = VALUES(selected_template),
      title_text        = VALUES(title_text),
      title_color       = VALUES(title_color),
      title_font_size   = VALUES(title_font_size),
      title_font_weight = VALUES(title_font_weight),
      title_alignment   = VALUES(title_alignment),
      section_bg_color  = VALUES(section_bg_color),
      card_bg_color     = VALUES(card_bg_color),
      card_border_color = VALUES(card_border_color),
      card_border_width = VALUES(card_border_width),
      card_border_radius= VALUES(card_border_radius),
      card_shadow       = VALUES(card_shadow),
      auto_slide        = VALUES(auto_slide),
      slide_interval    = VALUES(slide_interval),
      position          = VALUES(position),
      layout            = VALUES(layout),
      selected_coupons  = VALUES(selected_coupons),
      updated_at        = CURRENT_TIMESTAMP(3)
  `, [
    shop,
    body.is_enabled !== undefined ? flag(body.is_enabled, 0) : (ex.is_enabled ?? 0),
    pick(body.selected_template ?? body.template, ex.selected_template, 'template1'),
    pick(body.title_text ?? body.sectionTitle,    ex.title_text,        'Apply Coupon'),
    pick(body.title_color ?? body.titleColor,     ex.title_color,       '#1e293b'),
    pick(body.title_font_size ?? body.titleFontSize, ex.title_font_size, 14),
    pick(body.title_font_weight, ex.title_font_weight, 700),
    pick(body.title_alignment ?? body.titleTextAlign, ex.title_alignment, 'left'),
    pick(body.section_bg_color,  ex.section_bg_color,  '#ffffff'),
    pick(body.card_bg_color,     ex.card_bg_color,     '#ffffff'),
    pick(body.card_border_color, ex.card_border_color, '#e5e7eb'),
    pick(body.card_border_width, ex.card_border_width, 1),
    pick(body.card_border_radius,ex.card_border_radius,8),
    body.card_shadow  !== undefined ? flag(body.card_shadow,  0) : (ex.card_shadow  ?? 0),
    body.auto_slide   !== undefined ? flag(body.auto_slide,   0) : (ex.auto_slide   ?? 0),
    pick(body.slide_interval, ex.slide_interval, 5),
    pick(body.position,       ex.position,       'above_cart'),
    pick(body.layout,         ex.layout,         'grid'),
    selectedCoupons,
  ]);

  const [rows] = await db.execute(
    'SELECT * FROM coupon_slider_settings WHERE shop_domain = ? LIMIT 1', [shop]
  );
  return Response.json({ success: true, data: parseSelectedCoupons(rows[0] || null) });
}
