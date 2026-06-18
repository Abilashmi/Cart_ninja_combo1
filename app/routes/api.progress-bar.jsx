/**
 * GET  /api/progress-bar?shop=…  — load settings + tiers
 * POST /api/progress-bar          — save settings + tiers (full replace)
 */
import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';

function parseJson(v, fb = null) {
  if (!v) return fb;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fb; }
}

const DEFAULTS = {
  is_enabled: 0,
  mode: 'amount',
  show_on_empty: 1,
  bar_background_color: '#e5e7eb',
  bar_foreground_color: '#2563eb',
  icon_color: '#2563eb',
  border_radius: 8,
  placement: 'top',
  completion_text: "🎉 You've unlocked free shipping!",
  completion_text_color: '#10b981',
  enable_confetti: 1,
  tiers: [],
};

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const db = getDb();

  const [rows] = await db.execute(
    'SELECT * FROM progress_bar_settings WHERE shop_domain = ? LIMIT 1', [shop]
  );

  if (!rows.length) return Response.json({ success: true, data: { ...DEFAULTS, shop_domain: shop } });

  const settings = rows[0];
  const [tiers] = await db.execute(
    'SELECT * FROM progress_bar_tiers WHERE settings_id = ? AND is_active = 1 ORDER BY sort_order ASC',
    [settings.id]
  );

  return Response.json({ success: true, data: { ...settings, tiers } });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();
  const db = getDb();

  if (request.method === 'DELETE') {
    await db.execute('UPDATE progress_bar_settings SET is_enabled = 0 WHERE shop_domain = ?', [shop]);
    return Response.json({ success: true });
  }

  const {
    is_enabled = 0,
    mode = 'amount',
    show_on_empty = 1,
    bar_background_color = '#e5e7eb',
    bar_foreground_color = '#2563eb',
    icon_color = '#2563eb',
    border_radius = 8,
    placement = 'top',
    completion_text = "🎉 You've unlocked free shipping!",
    completion_text_color = '#10b981',
    enable_confetti = 1,
    tiers = [],
  } = body;

  const [ins] = await db.execute(`
    INSERT INTO progress_bar_settings
      (shop_domain, is_enabled, mode, show_on_empty, bar_background_color, bar_foreground_color,
       icon_color, border_radius, placement, completion_text, completion_text_color, enable_confetti)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      is_enabled           = VALUES(is_enabled),
      mode                 = VALUES(mode),
      show_on_empty        = VALUES(show_on_empty),
      bar_background_color = VALUES(bar_background_color),
      bar_foreground_color = VALUES(bar_foreground_color),
      icon_color           = VALUES(icon_color),
      border_radius        = VALUES(border_radius),
      placement            = VALUES(placement),
      completion_text      = VALUES(completion_text),
      completion_text_color= VALUES(completion_text_color),
      enable_confetti      = VALUES(enable_confetti),
      updated_at           = CURRENT_TIMESTAMP(3)
  `, [shop, is_enabled ? 1 : 0, mode, show_on_empty ? 1 : 0,
      bar_background_color, bar_foreground_color, icon_color, border_radius,
      placement, completion_text, completion_text_color, enable_confetti ? 1 : 0]);

  // Get settings id (either from insert or from existing row)
  let settingsId = ins.insertId;
  if (!settingsId) {
    const [ex] = await db.execute('SELECT id FROM progress_bar_settings WHERE shop_domain = ?', [shop]);
    settingsId = ex[0]?.id;
  }

  if (settingsId && Array.isArray(tiers)) {
    await db.execute('DELETE FROM progress_bar_tiers WHERE settings_id = ?', [settingsId]);
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      await db.execute(`
        INSERT INTO progress_bar_tiers
          (shop_domain, settings_id, min_value, min_quantity, description, reward_type,
           icon_type, icon_preset, icon_custom_svg, reward_products, is_active, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `, [
        shop, settingsId,
        t.minValue ?? t.min_value ?? 0,
        t.minQuantity ?? t.min_quantity ?? 0,
        t.description || 'Milestone',
        t.rewardType || t.reward_type || 'free_shipping',
        t.iconType || t.icon_type || 'preset',
        t.iconPreset || t.icon_preset || 'gift',
        t.iconCustomSvg || t.icon_custom_svg || null,
        t.products?.length ? JSON.stringify(t.products) : null,
        i,
      ]);
    }
  }

  const [result] = await db.execute(
    'SELECT p.*, JSON_ARRAYAGG(JSON_OBJECT("id",t.id,"min_value",t.min_value,"description",t.description,"reward_type",t.reward_type,"icon_preset",t.icon_preset,"sort_order",t.sort_order)) as tiers FROM progress_bar_settings p LEFT JOIN progress_bar_tiers t ON t.settings_id = p.id AND t.is_active=1 WHERE p.shop_domain = ? GROUP BY p.id',
    [shop]
  );

  return Response.json({ success: true, data: result[0] });
}
