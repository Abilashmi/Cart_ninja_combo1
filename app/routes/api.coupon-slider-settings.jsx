/**
 * GET  /api/coupon-slider-settings  — load widget settings
 * POST /api/coupon-slider-settings  — save widget settings
 */
import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';

const DEFAULTS = {
  is_enabled: 0,
  selected_template: 'template1',
  title_text: 'Apply Coupon',
  title_color: '#1e293b',
  title_font_size: 14,
  title_font_weight: 700,
  title_alignment: 'left',
  section_bg_color: '#ffffff',
  card_bg_color: '#ffffff',
  card_border_color: '#e5e7eb',
  card_border_width: 1,
  card_border_radius: 8,
  card_shadow: 0,
  auto_slide: 0,
  slide_interval: 5,
  position: 'top',
  layout: 'grid',
};

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const db = getDb();

  const [rows] = await db.execute(
    'SELECT * FROM coupon_slider_settings WHERE shop_domain = ? LIMIT 1', [shop]
  );

  if (!rows.length) return Response.json({ success: true, data: { ...DEFAULTS, shop_domain: shop } });
  return Response.json({ success: true, data: rows[0] });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();
  const db = getDb();

  await db.execute(`
    INSERT INTO coupon_slider_settings
      (shop_domain, is_enabled, selected_template, title_text, title_color,
       title_font_size, title_font_weight, title_alignment, section_bg_color,
       card_bg_color, card_border_color, card_border_width, card_border_radius,
       card_shadow, auto_slide, slide_interval, position, layout)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE
      is_enabled       = VALUES(is_enabled),
      selected_template= VALUES(selected_template),
      title_text       = VALUES(title_text),
      title_color      = VALUES(title_color),
      title_font_size  = VALUES(title_font_size),
      title_font_weight= VALUES(title_font_weight),
      title_alignment  = VALUES(title_alignment),
      section_bg_color = VALUES(section_bg_color),
      card_bg_color    = VALUES(card_bg_color),
      card_border_color= VALUES(card_border_color),
      card_border_width= VALUES(card_border_width),
      card_border_radius=VALUES(card_border_radius),
      card_shadow      = VALUES(card_shadow),
      auto_slide       = VALUES(auto_slide),
      slide_interval   = VALUES(slide_interval),
      position         = VALUES(position),
      layout           = VALUES(layout),
      updated_at       = CURRENT_TIMESTAMP(3)
  `, [
    shop,
    body.is_enabled ? 1 : 0,
    body.selected_template || body.activeTemplate || 'template1',
    body.title_text || body.titleText || 'Apply Coupon',
    body.title_color || body.titleColor || '#1e293b',
    body.title_font_size || body.titleFontSize || 14,
    body.title_font_weight || body.titleFontWeight || 700,
    body.title_alignment || body.titleAlignment || 'left',
    body.section_bg_color || body.sectionBgColor || '#ffffff',
    body.card_bg_color || body.cardBgColor || '#ffffff',
    body.card_border_color || body.cardBorderColor || '#e5e7eb',
    body.card_border_width || body.cardBorderWidth || 1,
    body.card_border_radius ?? body.cardBorderRadius ?? 8,
    body.card_shadow ? 1 : 0,
    body.auto_slide ? 1 : 0,
    body.slide_interval || 5,
    body.position || 'top',
    body.layout || 'grid',
  ]);

  const [rows] = await db.execute(
    'SELECT * FROM coupon_slider_settings WHERE shop_domain = ?', [shop]
  );
  return Response.json({ success: true, data: rows[0] });
}
