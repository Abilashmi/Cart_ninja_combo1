import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';
import { getShopPlan } from '../services/plan-permissions.server';
import { canPublishFeature } from '../config/plans';

function flag(v, d = 1) {
  if (v == null) return d;
  return (v === true || v === 1 || v === '1') ? 1 : 0;
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const db = getDb();
  const [rows] = await db.execute(
    'SELECT * FROM cart_drawer_config WHERE shop_domain = ? LIMIT 1',
    [session.shop]
  );
  const data = rows[0] || null;
  return Response.json({ success: !!data, data });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();
  const db = getDb();

  console.log('[cart-drawer-config] POST shop:', shop, '| is_enabled:', body.is_enabled);

  // Backend enforcement (defense-in-depth): Custom CSS is 'locked' on Free.
  // The admin UI lets a Free shop fully edit/save it (CustomizableLockedSection
  // — no blur), but a Free shop could also POST directly to this endpoint.
  // Strip custom_css in that case — all other cart_drawer_config fields
  // save normally.
  const planKey = await getShopPlan(shop);
  const customCssAllowed = canPublishFeature(planKey, 'custom_css');

  await db.execute(`
    INSERT INTO cart_drawer_config (
      shop_domain, is_enabled,
      checkout_button_text, checkout_footer_text,
      checkout_button_bg_color, checkout_button_text_color, checkout_button_border_radius,
      custom_css,
      announcement_enabled, announcement_text, announcement_bg_color,
      announcement_text_color, announcement_font_size,
      open_on_add, open_on_icon_click, position,
      header_title, header_close_style, header_bg_color, header_text_color, header_border_bottom,
      design_width, design_border_radius, design_shadow, design_animation,
      empty_cart_message, empty_cart_show_continue_shopping, empty_cart_show_recommendations
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE
      is_enabled                        = VALUES(is_enabled),
      checkout_button_text              = VALUES(checkout_button_text),
      checkout_footer_text              = VALUES(checkout_footer_text),
      checkout_button_bg_color          = VALUES(checkout_button_bg_color),
      checkout_button_text_color        = VALUES(checkout_button_text_color),
      checkout_button_border_radius     = VALUES(checkout_button_border_radius),
      custom_css                        = VALUES(custom_css),
      announcement_enabled              = VALUES(announcement_enabled),
      announcement_text                 = VALUES(announcement_text),
      announcement_bg_color             = VALUES(announcement_bg_color),
      announcement_text_color           = VALUES(announcement_text_color),
      announcement_font_size            = VALUES(announcement_font_size),
      open_on_add                       = VALUES(open_on_add),
      open_on_icon_click                = VALUES(open_on_icon_click),
      position                          = VALUES(position),
      header_title                      = VALUES(header_title),
      header_close_style                = VALUES(header_close_style),
      header_bg_color                   = VALUES(header_bg_color),
      header_text_color                 = VALUES(header_text_color),
      header_border_bottom              = VALUES(header_border_bottom),
      design_width                      = VALUES(design_width),
      design_border_radius              = VALUES(design_border_radius),
      design_shadow                     = VALUES(design_shadow),
      design_animation                  = VALUES(design_animation),
      empty_cart_message                = VALUES(empty_cart_message),
      empty_cart_show_continue_shopping = VALUES(empty_cart_show_continue_shopping),
      empty_cart_show_recommendations   = VALUES(empty_cart_show_recommendations),
      updated_at                        = CURRENT_TIMESTAMP(3)
  `, [
    shop,
    flag(body.is_enabled ?? null),
    body.checkout_button_text              ?? 'Checkout Now',
    body.checkout_footer_text              ?? 'Shipping and taxes calculated at checkout',
    body.checkout_button_bg_color          ?? '#111827',
    body.checkout_button_text_color        ?? '#ffffff',
    body.checkout_button_border_radius     ?? 4,
    customCssAllowed ? (body.custom_css ?? null) : null,
    flag(body.announcement_enabled         ?? 0, 0),
    body.announcement_text                 ?? null,
    body.announcement_bg_color             ?? '#111827',
    body.announcement_text_color           ?? '#ffffff',
    body.announcement_font_size            ?? 13,
    flag(body.open_on_add                  ?? 1),
    flag(body.open_on_icon_click           ?? 1),
    body.position                          ?? 'right',
    body.header_title                      ?? 'Your Cart',
    body.header_close_style                ?? 'icon',
    body.header_bg_color                   ?? '#ffffff',
    body.header_text_color                 ?? '#1a1a1a',
    flag(body.header_border_bottom         ?? 1),
    body.design_width                      ?? 'normal',
    body.design_border_radius              ?? 8,
    flag(body.design_shadow                ?? 1),
    body.design_animation                  ?? 'slide',
    body.empty_cart_message                ?? 'Your cart is empty',
    flag(body.empty_cart_show_continue_shopping ?? 1),
    flag(body.empty_cart_show_recommendations   ?? 1),
  ]);

  const [rows] = await db.execute(
    'SELECT * FROM cart_drawer_config WHERE shop_domain = ? LIMIT 1', [shop]
  );
  return Response.json({ success: true, data: rows[0] || null });
}
