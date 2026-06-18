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

  // Column definitions: key in request body → { column, coerce }
  // coerce(value) converts the JS value to the SQL value.
  const COLUMN_MAP = {
    is_enabled:                        { col: 'is_enabled',                        coerce: (v) => v !== false ? 1 : 0 },
    checkout_button_text:              { col: 'checkout_button_text',              coerce: (v) => v || 'Checkout Now' },
    checkout_footer_text:              { col: 'checkout_footer_text',              coerce: (v) => v || 'Shipping and taxes calculated at checkout' },
    checkout_button_bg_color:          { col: 'checkout_button_bg_color',          coerce: (v) => v || '#111827' },
    checkout_button_text_color:        { col: 'checkout_button_text_color',        coerce: (v) => v || '#ffffff' },
    checkout_button_border_radius:     { col: 'checkout_button_border_radius',     coerce: (v) => v ?? 4 },
    custom_css:                        { col: 'custom_css',                        coerce: (v) => v || null },
    announcement_enabled:              { col: 'announcement_enabled',              coerce: (v) => v ? 1 : 0 },
    announcement_text:                 { col: 'announcement_text',                 coerce: (v) => v || null },
    announcement_bg_color:             { col: 'announcement_bg_color',             coerce: (v) => v || '#111827' },
    announcement_text_color:           { col: 'announcement_text_color',           coerce: (v) => v || '#ffffff' },
    announcement_font_size:            { col: 'announcement_font_size',            coerce: (v) => v || 13 },
    open_on_add:                       { col: 'open_on_add',                       coerce: (v) => v !== false ? 1 : 0 },
    open_on_icon_click:                { col: 'open_on_icon_click',                coerce: (v) => v !== false ? 1 : 0 },
    position:                          { col: 'position',                          coerce: (v) => v || 'right' },
    header_title:                      { col: 'header_title',                      coerce: (v) => v || 'Your Cart' },
    header_close_style:                { col: 'header_close_style',                coerce: (v) => v || 'icon' },
    header_bg_color:                   { col: 'header_bg_color',                   coerce: (v) => v || '#ffffff' },
    header_text_color:                 { col: 'header_text_color',                 coerce: (v) => v || '#1a1a1a' },
    header_border_bottom:              { col: 'header_border_bottom',              coerce: (v) => v !== false ? 1 : 0 },
    design_width:                      { col: 'design_width',                      coerce: (v) => v || 'normal' },
    design_border_radius:              { col: 'design_border_radius',              coerce: (v) => v ?? 8 },
    design_shadow:                     { col: 'design_shadow',                     coerce: (v) => v !== false ? 1 : 0 },
    design_animation:                  { col: 'design_animation',                  coerce: (v) => v || 'slide' },
    empty_cart_message:                { col: 'empty_cart_message',                coerce: (v) => v || 'Your cart is empty' },
    empty_cart_show_continue_shopping: { col: 'empty_cart_show_continue_shopping', coerce: (v) => v !== false ? 1 : 0 },
    empty_cart_show_recommendations:   { col: 'empty_cart_show_recommendations',   coerce: (v) => v !== false ? 1 : 0 },
  };

  // Only update the columns that are explicitly present in the request body.
  const presentKeys = Object.keys(body).filter((k) => k in COLUMN_MAP);

  if (presentKeys.length === 0) {
    return Response.json({ success: false, error: 'No valid fields provided' }, { status: 400 });
  }

  const setClauses = presentKeys.map((k) => `${COLUMN_MAP[k].col} = ?`).join(', ');
  const values = presentKeys.map((k) => COLUMN_MAP[k].coerce(body[k]));

  // INSERT with whatever was sent (missing fields get DB column defaults) then
  // UPDATE only those columns on conflict — never touches columns we didn't send.
  const colList = presentKeys.map((k) => COLUMN_MAP[k].col).join(', ');
  const placeholders = presentKeys.map(() => '?').join(', ');

  await db.execute(
    `INSERT INTO cart_drawer_config (shop_domain, ${colList})
     VALUES (?, ${placeholders})
     ON DUPLICATE KEY UPDATE ${setClauses}, updated_at = CURRENT_TIMESTAMP(3)`,
    [shop, ...values, ...values]
  );

  const [rows] = await db.execute('SELECT * FROM cart_drawer_config WHERE shop_domain = ? LIMIT 1', [shop]);
  return Response.json({ success: true, data: rows[0] });
}
