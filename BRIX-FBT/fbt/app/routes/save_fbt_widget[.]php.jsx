import { getDb } from '../services/db.server';
import { getShopPlan, canPublishFeature } from '../services/plan-permissions.server';

function parseJson(val, fallback) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

/**
 * Storefront FBT config endpoint (hit via the Shopify app proxy, same as the coupon slider).
 * Reads local MySQL. Source-of-truth order, robust to partial data:
 *   - templates + rules: legacy `fbt_widget` blob (what the admin always writes)
 *   - rules fallback: `fbt_rules` table (if the legacy condition is empty)
 *   - placement: `fbt_widget_settings.widget_placement` overlaid onto the template
 */
export async function loader({ request }) {
  const url = new URL(request.url);
  const shopDomain = url.searchParams.get('shopdomain') || url.searchParams.get('shopDomain');

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (!shopDomain) {
    return new Response(JSON.stringify({ status: 'error', message: 'shopdomain required' }), { status: 400, headers });
  }

  try {
    const db = getDb();
    const [[legacy]] = await db.execute('SELECT * FROM fbt_widget WHERE shopDomain = ? LIMIT 1', [shopDomain]);
    const [[settings]] = await db.execute('SELECT * FROM fbt_widget_settings WHERE shop_domain = ? LIMIT 1', [shopDomain]);
    const [rules] = await db.execute(
      'SELECT * FROM fbt_rules WHERE shop_domain = ? AND is_active = 1 ORDER BY sort_order ASC', [shopDomain]
    );

    if (!legacy && !settings) {
      return new Response(JSON.stringify({ status: 'error', message: 'No data found' }), { headers });
    }

    // ── Templates ──
    let selectedTemp = 'fbt1';
    let temp1 = {}, temp2 = {}, temp3 = {};
    if (legacy) {
      selectedTemp = legacy.selectedTemp || 'fbt1';
      temp1 = parseJson(legacy.temp1, {});
      temp2 = parseJson(legacy.temp2, {});
      temp3 = parseJson(legacy.temp3, {});
    }
    // If legacy template blobs are missing, build the active one from settings
    if (settings && !Object.keys(parseJson(legacy?.[`temp${(settings.selected_template || 'fbt1').slice(-1)}`], {})).length) {
      const tpl = {
        layout: settings.layout || 'horizontal',
        interactionType: settings.interaction_type || 'classic',
        bgColor: settings.bg_color || '#ffffff',
        textColor: settings.text_color || '#111827',
        priceColor: settings.price_color || '#059669',
        buttonColor: settings.button_color || '#111827',
        buttonTextColor: settings.button_text_color || '#ffffff',
        borderColor: settings.border_color || '#e5e7eb',
        borderRadius: settings.border_radius ?? 8,
        showPrices: settings.show_prices !== 0,
        showAddAllButton: settings.show_add_all_button !== 0,
      };
      selectedTemp = settings.selected_template || selectedTemp;
      if (selectedTemp === 'fbt1') temp1 = { ...tpl, ...temp1 };
      else if (selectedTemp === 'fbt2') temp2 = { ...tpl, ...temp2 };
      else temp3 = { ...tpl, ...temp3 };
    }

    // ── Rules ── prefer legacy condition; fall back to fbt_rules
    let condition = legacy ? parseJson(legacy.condition, []) : [];
    if ((!Array.isArray(condition) || condition.length === 0) && rules.length) {
      condition = rules.map(r => ({
        id: r.id,
        displayScope: r.trigger_scope || 'all',
        triggerProducts: parseJson(r.trigger_products, []),
        fbtProducts: parseJson(r.fbt_products, []),
      }));
    }

    // ── Placement ── overlay from settings onto the active template
    const widgetPlacement = (settings && settings.widget_placement) || 'below_cart';
    const sel = selectedTemp;
    const activeTpl = sel === 'fbt1' ? temp1 : sel === 'fbt2' ? temp2 : temp3;
    if (activeTpl && !activeTpl.widgetPlacement) activeTpl.widgetPlacement = widgetPlacement;

    // Merchant's on/off toggle lives on fbt_widget_settings.is_enabled — the
    // legacy `fbt_widget` table (the primary source above) has no such column,
    // so without this the storefront never learns the widget was turned off.
    const widgetEnabled = settings ? Boolean(Number(settings.is_enabled ?? 1)) : true;

    // Plan gating: FBT is preview-only on Free — merchant can design/save it,
    // but it must not render on the storefront until they upgrade.
    const planKey = await getShopPlan(shopDomain);
    const publishable = canPublishFeature(planKey, 'fbt');

    const data = {
      selectedTemp, temp1, temp2, temp3, condition, widgetPlacement,
      publishable,
      isEnabled: publishable && widgetEnabled,
    };
    return new Response(JSON.stringify({ status: 'success', data }), { headers });

  } catch (e) {
    console.error('[save_fbt_widget] DB error:', e.message);
    return new Response(JSON.stringify({ status: 'error', message: e.message }), { status: 500, headers });
  }
}
