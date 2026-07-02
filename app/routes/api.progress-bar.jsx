import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';
import { getShopPlan } from '../services/plan-permissions.server';
import { canPublishFeature } from '../config/plans';

function flag(v, d = 1) {
  if (v == null) return d;
  return (v === true || v === 1 || v === '1') ? 1 : 0;
}

async function fetchProgressBar(db, shop) {
  const [rows] = await db.execute(
    'SELECT * FROM progress_bar_settings WHERE shop_domain = ? LIMIT 1', [shop]
  );
  const settings = rows[0] || null;
  if (!settings) return null;
  const [tierRows] = await db.execute(
    'SELECT * FROM progress_bar_tiers WHERE settings_id = ? AND is_active = 1 ORDER BY sort_order ASC',
    [settings.id]
  );
  settings.tiers = tierRows.map((t) => ({
    ...t,
    reward_products: t.reward_products
      ? (typeof t.reward_products === 'string'
          ? (() => { try { return JSON.parse(t.reward_products); } catch { return []; } })()
          : t.reward_products)
      : [],
  }));
  return settings;
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const db = getDb();
  const data = await fetchProgressBar(db, session.shop).catch(() => null);
  return Response.json({ success: !!data, data });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();
  const db = getDb();

  // Backend enforcement (defense-in-depth): Progress Bar (and its bundled
  // confetti-on-completion toggle) is 'locked' on Free. The admin UI lets a
  // Free shop fully customize and save the design (CustomizableLockedSection
  // — no blur, editing allowed), but never lets it publish. This endpoint is
  // what actually enforces that, since a Free shop could also POST directly
  // here. Force is_enabled/enable_confetti off in that case — the rest of
  // the design fields are still saved so nothing is lost if the merchant
  // upgrades later.
  const planKey = await getShopPlan(shop);
  const progressBarAllowed = canPublishFeature(planKey, 'progress_bar');
  const confettiAllowed = canPublishFeature(planKey, 'confetti');

  await db.execute(`
    INSERT INTO progress_bar_settings
      (shop_domain, is_enabled, mode, show_on_empty, bar_background_color,
       bar_foreground_color, icon_color, border_radius, placement,
       completion_text, completion_text_color, enable_confetti)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE
      is_enabled            = VALUES(is_enabled),
      mode                  = VALUES(mode),
      show_on_empty         = VALUES(show_on_empty),
      bar_background_color  = VALUES(bar_background_color),
      bar_foreground_color  = VALUES(bar_foreground_color),
      icon_color            = VALUES(icon_color),
      border_radius         = VALUES(border_radius),
      placement             = VALUES(placement),
      completion_text       = VALUES(completion_text),
      completion_text_color = VALUES(completion_text_color),
      enable_confetti       = VALUES(enable_confetti),
      updated_at            = CURRENT_TIMESTAMP(3)
  `, [
    shop,
    progressBarAllowed ? flag(body.is_enabled ?? 0, 0) : 0,
    body.mode                     ?? 'amount',
    flag(body.show_on_empty       ?? 1),
    body.bar_background_color     ?? '#e5e7eb',
    body.bar_foreground_color     ?? '#2563eb',
    body.icon_color               ?? '#2563eb',
    body.border_radius            ?? 8,
    body.placement                ?? 'top',
    body.completion_text          ?? "You've unlocked free shipping!",
    body.completion_text_color    ?? '#10b981',
    confettiAllowed ? flag(body.enable_confetti ?? 1) : 0,
  ]);

  const [idRows] = await db.execute(
    'SELECT id FROM progress_bar_settings WHERE shop_domain = ?', [shop]
  );
  const settingsId = idRows[0]?.id;

  if (settingsId) {
    await db.execute('DELETE FROM progress_bar_tiers WHERE settings_id = ?', [settingsId]);
    const tiers = body.tiers ?? [];
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      const products = t.products?.length ? JSON.stringify(t.products) : null;
      await db.execute(`
        INSERT INTO progress_bar_tiers
          (shop_domain, settings_id, min_value, min_quantity, description,
           reward_type, icon_type, icon_preset, icon_custom_svg, reward_products, is_active, sort_order)
        VALUES (?,?,?,?,?,?,?,?,?,?,1,?)
      `, [
        shop, settingsId,
        t.min_value      ?? t.minValue      ?? 0,
        t.min_quantity   ?? t.minQuantity   ?? 0,
        t.description    ?? 'Milestone',
        t.reward_type    ?? t.rewardType    ?? 'free_shipping',
        t.icon_type      ?? t.iconType      ?? 'preset',
        t.icon_preset    ?? t.iconPreset    ?? 'gift',
        t.icon_custom_svg ?? t.iconCustomSvg ?? null,
        products,
        i,
      ]);
    }
  }

  const data = await fetchProgressBar(db, shop).catch(() => null);
  return Response.json({ success: true, data });
}
