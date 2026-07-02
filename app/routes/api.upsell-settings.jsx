import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';
import { getShopPlan, canPublishFeature } from '../services/plan-permissions.server';

function flag(v, d = 1) {
  if (v == null) return d;
  return (v === true || v === 1 || v === '1') ? 1 : 0;
}

function parseManualRules(row) {
  if (!row) return row;
  try {
    row.manual_rules = row.manual_rules ? JSON.parse(row.manual_rules) : [];
  } catch {
    row.manual_rules = [];
  }
  return row;
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const db = getDb();
  const [rows] = await db.execute(
    'SELECT * FROM upsell_widget_settings WHERE shop_domain = ? LIMIT 1',
    [session.shop]
  );
  const data = parseManualRules(rows[0] || null);

  // Defense-in-depth: the PHP GET handler (hit via the App Proxy) is the real
  // storefront choke point, but also force is_enabled false here in case this
  // Node route is ever consumed directly. Stored row is left untouched.
  if (data) {
    const planKey = await getShopPlan(session.shop);
    if (!canPublishFeature(planKey, 'ai_cart_upsell')) {
      data.is_enabled = 0;
    }
  }

  return Response.json({ success: !!data, data });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();
  const db = getDb();

  const manualRules = Array.isArray(body.manualRules) ? JSON.stringify(body.manualRules) : null;

  await db.execute(`
    INSERT INTO upsell_widget_settings
      (shop_domain, is_enabled, title, title_color, title_font_weight,
       show_on_empty_cart, layout, button_text, button_bg_color, button_text_color,
       button_border_radius, show_price, position, display_limit, active_template, manual_rules)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE
      is_enabled          = VALUES(is_enabled),
      title               = VALUES(title),
      title_color         = VALUES(title_color),
      title_font_weight   = VALUES(title_font_weight),
      show_on_empty_cart  = VALUES(show_on_empty_cart),
      layout              = VALUES(layout),
      button_text         = VALUES(button_text),
      button_bg_color     = VALUES(button_bg_color),
      button_text_color   = VALUES(button_text_color),
      button_border_radius= VALUES(button_border_radius),
      show_price          = VALUES(show_price),
      position            = VALUES(position),
      display_limit       = VALUES(display_limit),
      active_template     = VALUES(active_template),
      manual_rules        = VALUES(manual_rules),
      updated_at          = CURRENT_TIMESTAMP(3)
  `, [
    shop,
    flag(body.is_enabled         ?? 0, 0),
    body.title                   ?? 'Recommended for you',
    body.title_color             ?? '#111827',
    body.title_font_weight       ?? 700,
    flag(body.show_on_empty_cart ?? 0, 0),
    body.layout                  ?? 'grid',
    body.button_text             ?? 'Add to Cart',
    body.button_bg_color         ?? '#111827',
    body.button_text_color       ?? '#ffffff',
    body.button_border_radius    ?? 6,
    flag(body.show_price         ?? 1),
    body.position                ?? 'bottom',
    body.display_limit           ?? 3,
    body.active_template ?? body.layout ?? 'grid',
    manualRules,
  ]);

  const [rows] = await db.execute(
    'SELECT * FROM upsell_widget_settings WHERE shop_domain = ? LIMIT 1', [shop]
  );
  return Response.json({ success: true, data: parseManualRules(rows[0] || null) });
}
