/**
 * GET  /api/cart-drawer-config  — load all cart drawer settings from all normalized tables
 * POST /api/cart-drawer-config  — save cart drawer general settings (calls individual saves too)
 */
import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const db = getDb();

  const [[config], [pbSettings], [pbTiers], [csSettings], [uwSettings], [fbtSettings], [fbtRules], [upsellRules]] = await Promise.all([
    db.execute('SELECT * FROM cart_drawer_config WHERE shop_domain = ? LIMIT 1', [shop]),
    db.execute('SELECT * FROM progress_bar_settings WHERE shop_domain = ? LIMIT 1', [shop]),
    db.execute('SELECT p.id as settings_id FROM progress_bar_settings p WHERE p.shop_domain = ? LIMIT 1', [shop]).then(([r]) => r[0]?.id
      ? db.execute('SELECT * FROM progress_bar_tiers WHERE settings_id = ? AND is_active = 1 ORDER BY sort_order ASC', [r[0].id])
      : [[]]),
    db.execute('SELECT * FROM coupon_slider_settings WHERE shop_domain = ? LIMIT 1', [shop]),
    db.execute('SELECT * FROM upsell_widget_settings WHERE shop_domain = ? LIMIT 1', [shop]),
    db.execute('SELECT * FROM fbt_widget_settings WHERE shop_domain = ? LIMIT 1', [shop]),
    db.execute('SELECT * FROM fbt_rules WHERE shop_domain = ? AND is_active = 1 ORDER BY sort_order ASC', [shop]),
    db.execute('SELECT * FROM upsell_rules WHERE shop = ? ORDER BY priority ASC', [shop]),
  ]);

  return Response.json({
    success: true,
    data: {
      cart_drawer: config[0] || null,
      progress_bar: pbSettings[0] ? { ...pbSettings[0], tiers: pbTiers } : null,
      coupon_slider: csSettings[0] || null,
      upsell: uwSettings[0] ? { ...uwSettings[0], rules: upsellRules } : null,
      fbt: fbtSettings[0] ? { ...fbtSettings[0], rules: fbtRules } : null,
    },
  });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();
  const db = getDb();

  // Save cart drawer general config
  const { checkout_button_text, checkout_footer_text, checkout_button_bg_color,
    checkout_button_text_color, checkout_button_border_radius, custom_css,
    is_enabled, announcement_enabled, announcement_text, announcement_bg_color,
    announcement_text_color, announcement_font_size } = body;

  await db.execute(`
    INSERT INTO cart_drawer_config
      (shop_domain, is_enabled, checkout_button_text, checkout_footer_text,
       checkout_button_bg_color, checkout_button_text_color, checkout_button_border_radius,
       custom_css, announcement_enabled, announcement_text, announcement_bg_color,
       announcement_text_color, announcement_font_size)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE
      is_enabled                 = VALUES(is_enabled),
      checkout_button_text       = VALUES(checkout_button_text),
      checkout_footer_text       = VALUES(checkout_footer_text),
      checkout_button_bg_color   = VALUES(checkout_button_bg_color),
      checkout_button_text_color = VALUES(checkout_button_text_color),
      checkout_button_border_radius = VALUES(checkout_button_border_radius),
      custom_css                 = VALUES(custom_css),
      announcement_enabled       = VALUES(announcement_enabled),
      announcement_text          = VALUES(announcement_text),
      announcement_bg_color      = VALUES(announcement_bg_color),
      announcement_text_color    = VALUES(announcement_text_color),
      announcement_font_size     = VALUES(announcement_font_size),
      updated_at                 = CURRENT_TIMESTAMP(3)
  `, [
    shop,
    is_enabled !== false ? 1 : 0,
    checkout_button_text || 'Checkout Now',
    checkout_footer_text || 'Shipping and taxes calculated at checkout',
    checkout_button_bg_color || '#111827',
    checkout_button_text_color || '#ffffff',
    checkout_button_border_radius ?? 4,
    custom_css || null,
    announcement_enabled ? 1 : 0,
    announcement_text || null,
    announcement_bg_color || '#111827',
    announcement_text_color || '#ffffff',
    announcement_font_size || 13,
  ]);

  const [rows] = await db.execute('SELECT * FROM cart_drawer_config WHERE shop_domain = ?', [shop]);
  return Response.json({ success: true, data: rows[0] });
}
