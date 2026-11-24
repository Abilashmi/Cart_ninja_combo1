/**
 * GET  /api/fbt-settings               — load FBT widget settings + rules
 * POST /api/fbt-settings               — save FBT widget settings
 * POST /api/fbt-settings  (body.action='saveRule')   — upsert a rule
 * DELETE /api/fbt-settings (body.ruleId)             — delete a rule
 */
import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';
import { getShopPlan } from '../services/plan-permissions.server';
import { saveFbtWidgetSettings } from '../services/cart-config-writes.server';

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

  try {
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
  } catch (error) {
    console.error('[fbt-settings] loader DB error:', error.message);
    return Response.json({ success: false, error: 'Failed to load FBT settings' }, { status: 502 });
  }
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();
  const db = getDb();

  try {

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

  // Save widget settings (+ bulk-replace manual rules if the caller sent a
  // `rules` array — omitted means "leave my existing rules alone").
  const planKey = await getShopPlan(shop);
  const data = await saveFbtWidgetSettings(shop, planKey, body);
  return Response.json({ success: true, data });
  } catch (error) {
    console.error('[fbt-settings] action DB error:', error.message);
    return Response.json({ success: false, error: 'Failed to save FBT settings' }, { status: 502 });
  }
}
