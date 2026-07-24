import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';
import { getShopPlan } from '../services/plan-permissions.server';
import { canPublishFeature } from '../config/plans';

function flag(v, d = 1) {
  if (v == null) return d;
  return (v === true || v === 1 || v === '1') ? 1 : 0;
}

// Mirrors ensureAnnouncementStyleColumns() in php_backend/save_cart_drawer.php —
// self-heals the schema on first write so this save path doesn't depend on
// someone having run migrations/add_announcement_font_style_fields.sql by hand.
let announcementStyleColumnsEnsured = false;
async function ensureAnnouncementStyleColumns(db) {
  if (announcementStyleColumnsEnsured) return;
  await db.execute(`
    ALTER TABLE cart_drawer_config
      ADD COLUMN IF NOT EXISTS announcement_bold       TINYINT(1)  NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS announcement_italic     TINYINT(1)  NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS announcement_text_align VARCHAR(10) NOT NULL DEFAULT 'center'
  `);
  announcementStyleColumnsEnsured = true;
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const db = getDb();
  try {
    const [rows] = await db.execute(
      'SELECT * FROM cart_drawer_config WHERE shop_domain = ? LIMIT 1',
      [session.shop]
    );
    const data = rows[0] || null;
    return Response.json({ success: !!data, data });
  } catch (error) {
    console.error('[cart-drawer-config] loader DB error:', error.message);
    return Response.json({ success: false, error: 'Failed to load cart drawer config' }, { status: 502 });
  }
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();
  const db = getDb();

  console.log('[cart-drawer-config] POST shop:', shop, '| is_enabled:', body.is_enabled);

  try {
  // Backend enforcement (defense-in-depth): Custom CSS is 'locked' on Free.
  // The admin UI lets a Free shop fully edit/save it (CustomizableLockedSection
  // — no blur), but a Free shop could also POST directly to this endpoint.
  // Strip custom_css in that case — all other cart_drawer_config fields
  // save normally.
  const planKey = await getShopPlan(shop);
  const customCssAllowed = canPublishFeature(planKey, 'custom_css');

  await ensureAnnouncementStyleColumns(db);

  await db.execute(`
    INSERT INTO cart_drawer_config (
      shop_domain, is_enabled,
      checkout_button_text, checkout_footer_text,
      checkout_button_bg_color, checkout_button_text_color, checkout_button_border_radius,
      custom_css,
      announcement_enabled, announcement_text, announcement_bg_color,
      announcement_text_color, announcement_font_size, announcement_bold, announcement_italic, announcement_text_align,
      open_on_add, open_on_icon_click, position,
      header_title, header_close_style, header_bg_color, header_text_color, header_border_bottom,
      design_width, design_border_radius, design_shadow, design_animation,
      empty_cart_message, empty_cart_show_continue_shopping, empty_cart_show_recommendations
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
      announcement_bold                 = VALUES(announcement_bold),
      announcement_italic               = VALUES(announcement_italic),
      announcement_text_align           = VALUES(announcement_text_align),
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
    flag(body.announcement_bold            ?? 0, 0),
    flag(body.announcement_italic          ?? 0, 0),
    body.announcement_text_align           ?? 'center',
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
  } catch (error) {
    console.error('[cart-drawer-config] action DB error:', error.message);
    return Response.json({ success: false, error: 'Failed to save cart drawer config' }, { status: 502 });
  }
}
