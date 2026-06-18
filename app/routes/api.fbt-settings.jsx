/**
 * GET  /api/fbt-settings               — load FBT widget settings + rules
 * POST /api/fbt-settings               — save FBT widget settings
 * POST /api/fbt-settings  (body.action='saveRule')   — upsert a rule
 * DELETE /api/fbt-settings (body.ruleId)             — delete a rule
 */
import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';

function parseJson(v, fb = null) {
  if (!v) return fb;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fb; }
}

const WIDGET_DEFAULTS = {
  is_enabled: 0,
  selected_template: 'fbt1',
  mode: 'manual',
  ai_product_count: 3,
  bg_color: '#ffffff',
  text_color: '#111827',
  price_color: '#059669',
  button_color: '#111827',
  button_text_color: '#ffffff',
  button_text: 'Add All to Cart',
  border_color: '#e5e7eb',
  border_radius: 8,
  layout: 'horizontal',
  interaction_type: 'classic',
  show_prices: 1,
  show_add_all_button: 1,
};

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const db = getDb();

  const [settings] = await db.execute(
    'SELECT * FROM fbt_widget_settings WHERE shop_domain = ? LIMIT 1', [shop]
  );
  const [rules] = await db.execute(
    'SELECT * FROM fbt_rules WHERE shop_domain = ? AND is_active = 1 ORDER BY sort_order ASC',
    [shop]
  );

  const data = settings.length
    ? { ...settings[0], rules: rules.map(r => ({ ...r, trigger_products: parseJson(r.trigger_products, []), trigger_collections: parseJson(r.trigger_collections, []), fbt_products: parseJson(r.fbt_products, []) })) }
    : { ...WIDGET_DEFAULTS, shop_domain: shop, rules: [] };

  return Response.json({ success: true, data });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();
  const db = getDb();

  // DELETE rule
  if (request.method === 'DELETE' && body.ruleId) {
    await db.execute('DELETE FROM fbt_rules WHERE id = ? AND shop_domain = ?', [body.ruleId, shop]);
    return Response.json({ success: true });
  }

  // Upsert individual rule
  if (body.action === 'saveRule') {
    const r = body.rule || {};
    if (r.id) {
      await db.execute(`
        UPDATE fbt_rules SET
          name = ?, trigger_scope = ?, trigger_products = ?, trigger_collections = ?,
          fbt_products = ?, discount_type = ?, discount_value = ?,
          is_active = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ? AND shop_domain = ?
      `, [
        r.name || 'Rule', r.trigger_scope || 'all',
        r.trigger_products?.length ? JSON.stringify(r.trigger_products) : null,
        r.trigger_collections?.length ? JSON.stringify(r.trigger_collections) : null,
        r.fbt_products?.length ? JSON.stringify(r.fbt_products) : null,
        r.discount_type || 'none', r.discount_value ?? 0,
        r.is_active !== false ? 1 : 0, r.sort_order ?? 0,
        r.id, shop,
      ]);
    } else {
      const [ins] = await db.execute(`
        INSERT INTO fbt_rules (shop_domain, name, trigger_scope, trigger_products, trigger_collections, fbt_products, discount_type, discount_value, is_active, sort_order)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `, [
        shop, r.name || 'Rule', r.trigger_scope || 'all',
        r.trigger_products?.length ? JSON.stringify(r.trigger_products) : null,
        r.trigger_collections?.length ? JSON.stringify(r.trigger_collections) : null,
        r.fbt_products?.length ? JSON.stringify(r.fbt_products) : null,
        r.discount_type || 'none', r.discount_value ?? 0,
        r.is_active !== false ? 1 : 0, r.sort_order ?? 0,
      ]);
      r.id = ins.insertId;
    }
    return Response.json({ success: true, data: r });
  }

  // Save widget settings
  await db.execute(`
    INSERT INTO fbt_widget_settings
      (shop_domain, is_enabled, selected_template, mode, ai_product_count,
       bg_color, text_color, price_color, button_color, button_text_color, button_text,
       border_color, border_radius, layout, interaction_type, show_prices, show_add_all_button)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE
      is_enabled           = VALUES(is_enabled),
      selected_template    = VALUES(selected_template),
      mode                 = VALUES(mode),
      ai_product_count     = VALUES(ai_product_count),
      bg_color             = VALUES(bg_color),
      text_color           = VALUES(text_color),
      price_color          = VALUES(price_color),
      button_color         = VALUES(button_color),
      button_text_color    = VALUES(button_text_color),
      button_text          = VALUES(button_text),
      border_color         = VALUES(border_color),
      border_radius        = VALUES(border_radius),
      layout               = VALUES(layout),
      interaction_type     = VALUES(interaction_type),
      show_prices          = VALUES(show_prices),
      show_add_all_button  = VALUES(show_add_all_button),
      updated_at           = CURRENT_TIMESTAMP(3)
  `, [
    shop,
    body.is_enabled ?? body.enabled ? 1 : 0,
    body.selected_template || body.selectedTemplate || body.activeTemplate || 'fbt1',
    body.mode || 'manual',
    body.ai_product_count || body.aiProductCount || 3,
    body.bg_color || body.bgColor || '#ffffff',
    body.text_color || body.textColor || '#111827',
    body.price_color || body.priceColor || '#059669',
    body.button_color || body.buttonColor || '#111827',
    body.button_text_color || body.buttonTextColor || '#ffffff',
    body.button_text || body.buttonText || 'Add All to Cart',
    body.border_color || body.borderColor || '#e5e7eb',
    body.border_radius ?? body.borderRadius ?? 8,
    body.layout || 'horizontal',
    body.interaction_type || body.interactionType || 'classic',
    body.show_prices !== false ? 1 : 0,
    body.show_add_all_button !== false ? 1 : 0,
  ]);

  // Bulk-replace manual rules if provided
  if (Array.isArray(body.rules)) {
    await db.execute('DELETE FROM fbt_rules WHERE shop_domain = ?', [shop]);
    for (let i = 0; i < body.rules.length; i++) {
      const r = body.rules[i];
      await db.execute(`
        INSERT INTO fbt_rules (shop_domain, name, trigger_scope, trigger_products, trigger_collections, fbt_products, discount_type, discount_value, is_active, sort_order)
        VALUES (?,?,?,?,?,?,?,?,1,?)
      `, [
        shop, r.name || `Rule ${i+1}`, r.trigger_scope || r.displayScope || 'all',
        r.trigger_products?.length ? JSON.stringify(r.trigger_products) : null,
        r.trigger_collections?.length ? JSON.stringify(r.trigger_collections) : null,
        r.fbt_products?.length ? JSON.stringify(r.fbt_products) : (r.fbtProducts?.length ? JSON.stringify(r.fbtProducts) : null),
        r.discount_type || 'none', r.discount_value ?? 0, i,
      ]);
    }
  }

  const [settings] = await db.execute('SELECT * FROM fbt_widget_settings WHERE shop_domain = ?', [shop]);
  const [rules] = await db.execute('SELECT * FROM fbt_rules WHERE shop_domain = ? AND is_active = 1 ORDER BY sort_order ASC', [shop]);
  return Response.json({ success: true, data: { ...settings[0], rules } });
}
