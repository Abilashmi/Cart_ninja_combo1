/**
 * GET  /api/upsell-settings  — load global upsell widget settings
 * POST /api/upsell-settings  — save global upsell widget settings
 *
 * Individual upsell rules (trigger→product mapping) stay in /api/upsell (upsell_rules table).
 */
import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';

const DEFAULTS = {
  is_enabled: 0,
  title: 'Recommended for you',
  title_color: '#111827',
  title_font_weight: '700',
  show_on_empty_cart: 0,
  layout: 'grid',
  button_text: 'Add to Cart',
  button_bg_color: '#111827',
  button_text_color: '#ffffff',
  button_border_radius: 6,
  show_price: 1,
  position: 'bottom',
  display_limit: 3,
  active_template: 'grid',
};

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const db = getDb();

  const [rows] = await db.execute(
    'SELECT * FROM upsell_widget_settings WHERE shop_domain = ? LIMIT 1', [shop]
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
    INSERT INTO upsell_widget_settings
      (shop_domain, is_enabled, title, title_color, title_font_weight,
       show_on_empty_cart, layout, button_text, button_bg_color, button_text_color,
       button_border_radius, show_price, position, display_limit, active_template)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE
      is_enabled         = VALUES(is_enabled),
      title              = VALUES(title),
      title_color        = VALUES(title_color),
      title_font_weight  = VALUES(title_font_weight),
      show_on_empty_cart = VALUES(show_on_empty_cart),
      layout             = VALUES(layout),
      button_text        = VALUES(button_text),
      button_bg_color    = VALUES(button_bg_color),
      button_text_color  = VALUES(button_text_color),
      button_border_radius=VALUES(button_border_radius),
      show_price         = VALUES(show_price),
      position           = VALUES(position),
      display_limit      = VALUES(display_limit),
      active_template    = VALUES(active_template),
      updated_at         = CURRENT_TIMESTAMP(3)
  `, [
    shop,
    body.is_enabled ?? body.enabled ? 1 : 0,
    body.title || body.upsellTitle?.text || 'Recommended for you',
    body.title_color || body.upsellTitle?.color || '#111827',
    body.title_font_weight || '700',
    body.show_on_empty_cart ?? body.showOnEmptyCart ?? body.showWhenEmpty ? 1 : 0,
    body.layout || body.activeTemplate || 'grid',
    body.button_text || body.buttonText || 'Add to Cart',
    body.button_bg_color || body.buttonColor || '#111827',
    body.button_text_color || body.buttonTextColor || '#ffffff',
    body.button_border_radius ?? body.buttonBorderRadius ?? 6,
    body.show_price !== false ? 1 : 0,
    body.position || 'bottom',
    body.display_limit || body.displayLimit || body.limit || 3,
    body.active_template || body.activeTemplate || body.layout || 'grid',
  ]);

  const [rows] = await db.execute('SELECT * FROM upsell_widget_settings WHERE shop_domain = ?', [shop]);
  return Response.json({ success: true, data: rows[0] });
}
