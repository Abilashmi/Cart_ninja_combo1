// Shared save functions for every cart-editor-shaped settings table. Both the
// manual editor's HTTP routes (api.cart-drawer-config.jsx, api.progress-bar.jsx,
// api.upsell-settings.jsx, api.coupon-slider-settings.jsx, api.fbt-settings.jsx,
// api.countdown-timer.jsx) and the AI tool executor (ai-agent-tools.server.js)
// call these directly — no internal HTTP round-trip, since both callers
// already have `shop`/`planKey` in hand.
//
// The one behavior every function here enforces that the original routes
// didn't (except coupon-slider, which is the reference this was copied from):
// a field omitted from `patch` falls back to the EXISTING DB row, never a
// hardcoded default. Without this, an AI tool that only means to change one
// field (e.g. header color) would silently reset every other field in that
// section back to its factory default.
import { getDb } from './db.server';
import { getShopPlan } from './plan-permissions.server';
import { canPublishFeature } from '../config/plans';
import { buildAiFbtRules, shapeAiUpsellRules } from '../utils/fbt-ai.shared';

function flag(v, d = 1) {
  if (v == null) return d;
  return (v === true || v === 1 || v === '1') ? 1 : 0;
}

// v: incoming value (may be undefined/null meaning "not supplied").
// exVal: value already in the DB row (may itself be null/undefined for a
// brand-new shop with no row yet, in which case def is used).
function pick(v, exVal, def) {
  if (v !== undefined && v !== null) return v;
  if (exVal !== undefined && exVal !== null) return exVal;
  return def;
}

function pickFlag(v, exVal, def) {
  if (v !== undefined && v !== null) return flag(v, def);
  if (exVal !== undefined && exVal !== null) return flag(exVal, def);
  return def;
}

// Adds only the columns that are genuinely missing, and issues no
// ALTER TABLE at all when they're all already there.
//
// This matters much more than it looks. `ALTER TABLE ... ADD COLUMN IF NOT
// EXISTS` still has to take an exclusive METADATA LOCK on the table even
// when it changes nothing — and MySQL's lock_wait_timeout defaults to
// 31536000 seconds (a year), so if any other connection is holding even a
// shared lock on that table (an in-flight query, an open transaction), the
// ALTER waits essentially forever. Worse, once an ALTER is queued waiting
// for that lock, every later query on the same table queues behind it, so
// one stuck ALTER freezes the table for every request.
//
// That was the cause of the FBT admin page hanging on Save "loading
// forever": its loader calls ensureFbtRulesSourceColumn on every load,
// including the revalidation React Router fires after each save, and the
// per-process `ensured` flag resets on every deploy — so the first save
// after a restart re-ran the ALTER. Right after an AI Coverage Run (a
// DELETE plus up to 300 sequential INSERTs against fbt_rules) there is
// almost always a concurrent connection holding a lock on that exact
// table, which is why it hung specifically then.
//
// Reading information_schema instead takes no lock on the table itself, so
// the normal path is now one cheap SELECT and zero ALTERs, forever.
const ensuredColumnGroups = new Set();
async function ensureColumns(db, cacheKey, table, defs) {
  if (ensuredColumnGroups.has(cacheKey)) return;
  const [rows] = await db.execute(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [table]
  );
  const existing = new Set(
    (rows || []).map((r) => String(r.COLUMN_NAME ?? r.column_name ?? '').toLowerCase())
  );
  const missing = defs.filter((d) => !existing.has(d.name.toLowerCase()));
  if (missing.length) {
    await db.execute(
      `ALTER TABLE \`${table}\` ${missing.map((d) => `ADD COLUMN ${d.ddl}`).join(', ')}`
    );
  }
  ensuredColumnGroups.add(cacheKey);
}

async function ensureAnnouncementStyleColumns(db) {
  await ensureColumns(db, 'cart_drawer_config.announcement_style', 'cart_drawer_config', [
    { name: 'announcement_bold', ddl: '`announcement_bold` TINYINT(1) NOT NULL DEFAULT 0' },
    { name: 'announcement_italic', ddl: '`announcement_italic` TINYINT(1) NOT NULL DEFAULT 0' },
    { name: 'announcement_text_align', ddl: "`announcement_text_align` VARCHAR(10) NOT NULL DEFAULT 'center'" },
  ]);
}

// Self-heals the countdown_* columns onto cart_drawer_config the same way
// ensureAnnouncementStyleColumns does — the Cart Drawer's countdown timer had
// no backend at all before this (see plan Phase 2); this is the first write
// path for it, so the schema can't depend on a hand-run migration.
// A milestone's reward product is either given away free (BRIX makes it free at
// checkout via the free gift discount Function) or added at its regular price.
// Self-heals the column like the ones above. Existing tiers default to 'regular' so
// nothing that was already live silently becomes free; 'free' is always an explicit choice.
export async function ensureRewardPricingColumn(db) {
  await ensureColumns(db, 'progress_bar_tiers.reward_pricing', 'progress_bar_tiers', [
    { name: 'reward_pricing', ddl: "`reward_pricing` VARCHAR(10) NOT NULL DEFAULT 'regular'" },
  ]);
}

export async function ensureCountdownTimerColumns(db) {
  await ensureColumns(db, 'cart_drawer_config.countdown', 'cart_drawer_config', [
    { name: 'countdown_enabled', ddl: '`countdown_enabled` TINYINT(1) NOT NULL DEFAULT 0' },
    { name: 'countdown_mode', ddl: "`countdown_mode` VARCHAR(10) NOT NULL DEFAULT 'session'" },
    { name: 'countdown_hours', ddl: '`countdown_hours` INT NOT NULL DEFAULT 0' },
    { name: 'countdown_minutes', ddl: '`countdown_minutes` INT NOT NULL DEFAULT 15' },
    { name: 'countdown_label', ddl: "`countdown_label` VARCHAR(255) NOT NULL DEFAULT 'Offer expires in'" },
    { name: 'countdown_expired_label', ddl: "`countdown_expired_label` VARCHAR(255) NOT NULL DEFAULT 'Offer expired!'" },
    { name: 'countdown_bg_color', ddl: "`countdown_bg_color` VARCHAR(20) NOT NULL DEFAULT '#fef2f2'" },
    { name: 'countdown_text_color', ddl: "`countdown_text_color` VARCHAR(20) NOT NULL DEFAULT '#991b1b'" },
    { name: 'countdown_accent_color', ddl: "`countdown_accent_color` VARCHAR(20) NOT NULL DEFAULT '#dc2626'" },
    { name: 'countdown_show_on_products', ddl: '`countdown_show_on_products` TINYINT(1) NOT NULL DEFAULT 1' },
    { name: 'countdown_show_on_coupons', ddl: '`countdown_show_on_coupons` TINYINT(1) NOT NULL DEFAULT 1' },
    { name: 'countdown_coupon_code', ddl: '`countdown_coupon_code` VARCHAR(100) NULL' },
    { name: 'countdown_coupon_mode', ddl: "`countdown_coupon_mode` VARCHAR(10) NOT NULL DEFAULT 'manual'" },
  ]);
}

// ── Cart Drawer Config (design/general/header/announcements/emptyCart/checkoutButton/customCSS) ──

export async function saveCartDrawerConfig(shop, planKey, patch) {
  const db = getDb();
  await ensureAnnouncementStyleColumns(db);

  const [exRows] = await db.execute(
    'SELECT * FROM cart_drawer_config WHERE shop_domain = ? LIMIT 1', [shop]
  );
  const ex = exRows[0] || {};

  // Custom CSS is 'locked' on Free — always forced to null on save when not
  // publishable, regardless of what's already stored (matches the original
  // route's enforcement: Free shops can never have a persisted custom_css).
  const customCssAllowed = canPublishFeature(planKey, 'custom_css');
  const customCss = customCssAllowed ? pick(patch.custom_css, ex.custom_css, null) : null;

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
    pickFlag(patch.is_enabled, ex.is_enabled, 1),
    pick(patch.checkout_button_text, ex.checkout_button_text, 'Checkout Now'),
    pick(patch.checkout_footer_text, ex.checkout_footer_text, 'Shipping and taxes calculated at checkout'),
    pick(patch.checkout_button_bg_color, ex.checkout_button_bg_color, '#111827'),
    pick(patch.checkout_button_text_color, ex.checkout_button_text_color, '#ffffff'),
    pick(patch.checkout_button_border_radius, ex.checkout_button_border_radius, 4),
    customCss,
    pickFlag(patch.announcement_enabled, ex.announcement_enabled, 0),
    pick(patch.announcement_text, ex.announcement_text, null),
    pick(patch.announcement_bg_color, ex.announcement_bg_color, '#111827'),
    pick(patch.announcement_text_color, ex.announcement_text_color, '#ffffff'),
    pick(patch.announcement_font_size, ex.announcement_font_size, 13),
    pickFlag(patch.announcement_bold, ex.announcement_bold, 0),
    pickFlag(patch.announcement_italic, ex.announcement_italic, 0),
    pick(patch.announcement_text_align, ex.announcement_text_align, 'center'),
    pickFlag(patch.open_on_add, ex.open_on_add, 1),
    pickFlag(patch.open_on_icon_click, ex.open_on_icon_click, 1),
    pick(patch.position, ex.position, 'right'),
    pick(patch.header_title, ex.header_title, 'Your Cart'),
    pick(patch.header_close_style, ex.header_close_style, 'icon'),
    pick(patch.header_bg_color, ex.header_bg_color, '#ffffff'),
    pick(patch.header_text_color, ex.header_text_color, '#1a1a1a'),
    pickFlag(patch.header_border_bottom, ex.header_border_bottom, 1),
    pick(patch.design_width, ex.design_width, 'normal'),
    pick(patch.design_border_radius, ex.design_border_radius, 8),
    pickFlag(patch.design_shadow, ex.design_shadow, 1),
    pick(patch.design_animation, ex.design_animation, 'slide'),
    pick(patch.empty_cart_message, ex.empty_cart_message, 'Your cart is empty'),
    pickFlag(patch.empty_cart_show_continue_shopping, ex.empty_cart_show_continue_shopping, 1),
    pickFlag(patch.empty_cart_show_recommendations, ex.empty_cart_show_recommendations, 1),
  ]);

  const [rows] = await db.execute(
    'SELECT * FROM cart_drawer_config WHERE shop_domain = ? LIMIT 1', [shop]
  );
  return rows[0] || null;
}

// ── Progress Bar ──

export async function fetchProgressBar(db, shop) {
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

// `patch.tiers` must be OMITTED (not an empty array) to preserve the existing
// tier ladder — only ever pass it from a caller that explicitly means to
// replace every tier (the manual editor's full save, or the AI's
// update_progress_bar_tiers tool). update_progress_bar / set_progress_bar_goal
// must never pass `tiers` at all.
export async function saveProgressBarSettings(shop, planKey, patch) {
  const db = getDb();
  await ensureRewardPricingColumn(db);
  const ex = (await fetchProgressBar(db, shop)) || {};

  const progressBarAllowed = canPublishFeature(planKey, 'progress_bar');
  const confettiAllowed = canPublishFeature(planKey, 'confetti');

  const isEnabled = progressBarAllowed ? pickFlag(patch.is_enabled, ex.is_enabled, 0) : 0;
  const enableConfetti = confettiAllowed ? pickFlag(patch.enable_confetti, ex.enable_confetti, 1) : 0;

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
    isEnabled,
    pick(patch.mode, ex.mode, 'amount'),
    pickFlag(patch.show_on_empty, ex.show_on_empty, 1),
    pick(patch.bar_background_color, ex.bar_background_color, '#e5e7eb'),
    pick(patch.bar_foreground_color, ex.bar_foreground_color, '#2563eb'),
    pick(patch.icon_color, ex.icon_color, '#2563eb'),
    pick(patch.border_radius, ex.border_radius, 8),
    pick(patch.placement, ex.placement, 'top'),
    pick(patch.completion_text, ex.completion_text, "You've unlocked free shipping!"),
    pick(patch.completion_text_color, ex.completion_text_color, '#10b981'),
    enableConfetti,
  ]);

  if (Array.isArray(patch.tiers)) {
    const [idRows] = await db.execute(
      'SELECT id FROM progress_bar_settings WHERE shop_domain = ?', [shop]
    );
    const settingsId = idRows[0]?.id;
    if (settingsId) {
      await db.execute('DELETE FROM progress_bar_tiers WHERE settings_id = ?', [settingsId]);
      for (let i = 0; i < patch.tiers.length; i++) {
        const t = patch.tiers[i];
        const products = t.products?.length ? JSON.stringify(t.products) : null;
        await db.execute(`
          INSERT INTO progress_bar_tiers
            (shop_domain, settings_id, min_value, min_quantity, description,
             reward_type, icon_type, icon_preset, icon_custom_svg, reward_products, reward_pricing, is_active, sort_order)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)
        `, [
          shop, settingsId,
          t.min_value ?? t.minValue ?? 0,
          t.min_quantity ?? t.minQuantity ?? 0,
          t.description ?? 'Milestone',
          t.reward_type || t.rewardType || 'free_shipping',
          t.icon_type ?? t.iconType ?? 'preset',
          t.icon_preset ?? t.iconPreset ?? 'gift',
          t.icon_custom_svg ?? t.iconCustomSvg ?? null,
          products,
          (t.reward_pricing ?? t.rewardPricing) === 'free' ? 'free' : 'regular',
          i,
        ]);
      }
    }
  }

  // Upserts only the first/primary tier (by sort_order) in place — used by
  // set_progress_bar_goal / the old enableGoalBar convenience path. Mutually
  // exclusive with patch.tiers in practice (callers pass one or the other).
  if (patch.goalAmount !== undefined && patch.goalAmount !== null && patch.goalAmount > 0 && !Array.isArray(patch.tiers)) {
    const [idRows] = await db.execute('SELECT id FROM progress_bar_settings WHERE shop_domain = ?', [shop]);
    const settingsId = idRows[0]?.id;
    if (settingsId) {
      const [existingTierRows] = await db.execute(
        'SELECT id, reward_type, icon_preset, reward_pricing FROM progress_bar_tiers WHERE settings_id = ? ORDER BY sort_order ASC LIMIT 1', [settingsId]
      );
      const existingTier = existingTierRows[0];
      const tierId = existingTier?.id;
      // A caller changing only the goal amount (e.g. set_progress_bar_goal
      // with no rewardType) must not reset an already-configured reward —
      // fall back to the existing tier's own value, same as every other
      // field in this function, before falling back to a hardcoded default.
      const rewardType = patch.rewardType ?? existingTier?.reward_type ?? 'free_shipping';
      const iconPreset = patch.iconPreset ?? existingTier?.icon_preset ?? 'shipping';
      // `patch.rewardProducts` omitted = keep the tier's Reward Products as they
      // are; an array (including an empty one) replaces them.
      const setProducts = Array.isArray(patch.rewardProducts);
      const productsJson = setProducts && patch.rewardProducts.length ? JSON.stringify(patch.rewardProducts) : null;
      // `patch.rewardPricing` omitted = keep the tier's existing pricing choice.
      const rewardPricing = patch.rewardPricing === 'regular' ? 'regular' : patch.rewardPricing === 'free' ? 'free' : (existingTier?.reward_pricing ?? 'regular');
      if (tierId) {
        await db.execute(`
          UPDATE progress_bar_tiers
          SET min_value = ?, reward_type = ?, icon_preset = ?, reward_pricing = ?, ${setProducts ? 'reward_products = ?, ' : ''}updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ?
        `, [patch.goalAmount, rewardType, iconPreset, rewardPricing, ...(setProducts ? [productsJson] : []), tierId]);
      } else {
        await db.execute(`
          INSERT INTO progress_bar_tiers
            (shop_domain, settings_id, min_value, reward_type, icon_preset, reward_products, reward_pricing, is_active, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)
        `, [shop, settingsId, patch.goalAmount, rewardType, iconPreset, productsJson, rewardPricing]);
      }
    }
  }

  return fetchProgressBar(db, shop);
}

// ── Upsell Widget Settings ──

function parseManualRules(row) {
  if (!row) return row;
  try {
    row.manual_rules = row.manual_rules ? JSON.parse(row.manual_rules) : [];
  } catch {
    row.manual_rules = [];
  }
  return row;
}

// `patch.manualRules` must be OMITTED (not an empty array) to preserve
// existing rules — the original route's bug (writing NULL whenever
// manualRules wasn't sent) is fixed here by falling back to the existing
// JSON column rather than to null.
export async function saveUpsellWidgetSettings(shop, planKey, patch) {
  const db = getDb();
  const [exRows] = await db.execute(
    'SELECT * FROM upsell_widget_settings WHERE shop_domain = ? LIMIT 1', [shop]
  );
  const ex = parseManualRules(exRows[0] || {}) || {};

  const manualRules = Array.isArray(patch.manualRules)
    ? JSON.stringify(patch.manualRules)
    : (Array.isArray(ex.manual_rules) ? JSON.stringify(ex.manual_rules) : null);

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
    pickFlag(patch.is_enabled, ex.is_enabled, 0),
    pick(patch.title, ex.title, 'Recommended for you'),
    pick(patch.title_color, ex.title_color, '#111827'),
    pick(patch.title_font_weight, ex.title_font_weight, 700),
    pickFlag(patch.show_on_empty_cart, ex.show_on_empty_cart, 0),
    pick(patch.layout, ex.layout, 'grid'),
    pick(patch.button_text, ex.button_text, 'Add to Cart'),
    pick(patch.button_bg_color, ex.button_bg_color, '#111827'),
    pick(patch.button_text_color, ex.button_text_color, '#ffffff'),
    pick(patch.button_border_radius, ex.button_border_radius, 6),
    pickFlag(patch.show_price, ex.show_price, 1),
    pick(patch.position, ex.position, 'bottom'),
    pick(patch.display_limit, ex.display_limit, 3),
    pick(patch.active_template ?? patch.layout, ex.active_template, 'grid'),
    manualRules,
  ]);

  const [rows] = await db.execute(
    'SELECT * FROM upsell_widget_settings WHERE shop_domain = ? LIMIT 1', [shop]
  );
  return parseManualRules(rows[0] || null);
}

// ── Coupon Slider (already-safe reference implementation, extracted as-is) ──

function parseSelectedCoupons(row) {
  if (!row) return row;
  try {
    row.selected_coupons = row.selected_coupons ? JSON.parse(row.selected_coupons) : [];
  } catch {
    row.selected_coupons = [];
  }
  return row;
}

export async function saveCouponSliderSettings(shop, planKey, patch) {
  const db = getDb();
  const [exRows] = await db.execute(
    'SELECT * FROM coupon_slider_settings WHERE shop_domain = ? LIMIT 1', [shop]
  );
  const ex = exRows[0] || {};

  const countdownAllowed = canPublishFeature(planKey, 'open_countdown');
  const couponLockPublishable = canPublishFeature(planKey, 'coupon_lock_pro');

  const selectedCouponsArr = Array.isArray(patch.selectedCoupons)
    ? (countdownAllowed ? patch.selectedCoupons : patch.selectedCoupons.map((c) => ({ ...c, timerEnabled: false })))
    : null;
  const selectedCoupons = selectedCouponsArr ? JSON.stringify(selectedCouponsArr) : (ex.selected_coupons ?? null);

  await db.execute(`
    INSERT INTO coupon_slider_settings
      (shop_domain, is_enabled, selected_template, title_text, title_color,
       title_font_size, title_font_weight, title_alignment, section_bg_color,
       card_bg_color, card_border_color, card_border_width, card_border_radius,
       card_shadow, auto_slide, slide_interval, position, layout, selected_coupons)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE
      is_enabled        = VALUES(is_enabled),
      selected_template = VALUES(selected_template),
      title_text        = VALUES(title_text),
      title_color       = VALUES(title_color),
      title_font_size   = VALUES(title_font_size),
      title_font_weight = VALUES(title_font_weight),
      title_alignment   = VALUES(title_alignment),
      section_bg_color  = VALUES(section_bg_color),
      card_bg_color     = VALUES(card_bg_color),
      card_border_color = VALUES(card_border_color),
      card_border_width = VALUES(card_border_width),
      card_border_radius= VALUES(card_border_radius),
      card_shadow       = VALUES(card_shadow),
      auto_slide        = VALUES(auto_slide),
      slide_interval    = VALUES(slide_interval),
      position          = VALUES(position),
      layout            = VALUES(layout),
      selected_coupons  = VALUES(selected_coupons),
      updated_at        = CURRENT_TIMESTAMP(3)
  `, [
    shop,
    couponLockPublishable ? pickFlag(patch.is_enabled, ex.is_enabled, 0) : 0,
    pick(patch.selected_template ?? patch.template, ex.selected_template, 'template1'),
    pick(patch.title_text ?? patch.sectionTitle, ex.title_text, 'Apply Coupon'),
    pick(patch.title_color ?? patch.titleColor, ex.title_color, '#1e293b'),
    pick(patch.title_font_size ?? patch.titleFontSize, ex.title_font_size, 14),
    pick(patch.title_font_weight, ex.title_font_weight, 700),
    pick(patch.title_alignment ?? patch.titleTextAlign, ex.title_alignment, 'left'),
    pick(patch.section_bg_color, ex.section_bg_color, '#ffffff'),
    pick(patch.card_bg_color, ex.card_bg_color, '#ffffff'),
    pick(patch.card_border_color, ex.card_border_color, '#e5e7eb'),
    pick(patch.card_border_width, ex.card_border_width, 1),
    pick(patch.card_border_radius, ex.card_border_radius, 8),
    pickFlag(patch.card_shadow, ex.card_shadow, 0),
    pickFlag(patch.auto_slide, ex.auto_slide, 0),
    pick(patch.slide_interval, ex.slide_interval, 5),
    pick(patch.position, ex.position, 'above_cart'),
    pick(patch.layout, ex.layout, 'grid'),
    selectedCoupons,
  ]);

  const [rows] = await db.execute(
    'SELECT * FROM coupon_slider_settings WHERE shop_domain = ? LIMIT 1', [shop]
  );
  return parseSelectedCoupons(rows[0] || null);
}

// ── FBT (Frequently Bought Together) Widget Settings ──

function parseFbtRule(r) {
  return {
    ...r,
    trigger_products: parseJsonSafe(r.trigger_products, []),
    trigger_collections: parseJsonSafe(r.trigger_collections, []),
    fbt_products: parseJsonSafe(r.fbt_products, []),
  };
}
function parseJsonSafe(v, fb) {
  if (!v) return fb;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fb; }
}

// Read-only FBT lookup for the AI agent's get_current_config tool — mirrors
// app.fbt.jsx's own loader branching exactly (normalized fbt_widget_settings
// row present -> read rules from fbt_rules; no row yet -> fall back to the
// legacy fbt_widget.condition blob) so a shop that only ever used the old
// path is never falsely reported as having no FBT rules. discount_type/
// discount_value are intentionally omitted from each rule: they're stored on
// fbt_rules but nothing downstream (the storefront renderer or the admin UI)
// actually reads or applies them yet, so surfacing them would imply a
// working discount feature that doesn't exist.
export async function fetchFbtConfig(db, shop) {
  const [settingsRows] = await db.execute('SELECT * FROM fbt_widget_settings WHERE shop_domain = ? LIMIT 1', [shop]);
  const settings = settingsRows[0] || null;

  if (settings) {
    const [ruleRows] = await db.execute(
      'SELECT * FROM fbt_rules WHERE shop_domain = ? ORDER BY sort_order ASC', [shop]
    );
    return {
      source: 'normalized',
      widget: {
        enabled: !!settings.is_enabled,
        selectedTemplate: settings.selected_template,
        mode: settings.mode,
        layout: settings.layout,
        interactionType: settings.interaction_type,
        showPrices: !!settings.show_prices,
        showAddAllButton: !!settings.show_add_all_button,
        bgColor: settings.bg_color,
        textColor: settings.text_color,
        priceColor: settings.price_color,
        buttonColor: settings.button_color,
        buttonTextColor: settings.button_text_color,
        buttonText: settings.button_text,
        borderColor: settings.border_color,
        borderRadius: settings.border_radius,
      },
      rules: ruleRows.map((r) => ({
        id: r.id,
        name: r.name || null,
        triggerScope: r.trigger_scope || 'all',
        triggerProducts: parseJsonSafe(r.trigger_products, []),
        triggerCollections: parseJsonSafe(r.trigger_collections, []),
        fbtProducts: parseJsonSafe(r.fbt_products, []),
        active: !!r.is_active,
      })),
    };
  }

  const [legacyRows] = await db.execute('SELECT * FROM fbt_widget WHERE shopDomain = ? LIMIT 1', [shop]);
  const legacy = legacyRows[0] || null;
  if (!legacy) return { source: 'none', widget: null, rules: [] };

  const activeTemplateKey = ['fbt1', 'fbt2', 'fbt3'].includes(legacy.selectedTemp) ? legacy.selectedTemp : 'fbt1';
  const slotKey = { fbt1: 'temp1', fbt2: 'temp2', fbt3: 'temp3' }[activeTemplateKey];
  const tpl = parseJsonSafe(legacy[slotKey], {});
  const legacyRules = parseJsonSafe(legacy.condition, []);

  return {
    source: 'legacy',
    widget: {
      // No is_enabled column on the legacy table — app.fbt.jsx's own loader
      // treats the mere existence of this row as "enabled", so this mirrors
      // that same established convention rather than inventing a new one.
      enabled: true,
      selectedTemplate: activeTemplateKey,
      mode: legacy.selectedMode || 'manual',
      layout: tpl.layout ?? null,
      interactionType: tpl.interactionType ?? null,
      showPrices: tpl.showPrices !== false,
      showAddAllButton: tpl.showAddAllButton !== false,
      bgColor: tpl.bgColor ?? null,
      textColor: tpl.textColor ?? null,
      priceColor: tpl.priceColor ?? null,
      buttonColor: tpl.buttonColor ?? null,
      buttonTextColor: tpl.buttonTextColor ?? null,
      borderColor: tpl.borderColor ?? null,
      borderRadius: tpl.borderRadius ?? null,
    },
    rules: legacyRules.map((r, i) => ({
      id: r.id ?? `legacy-${i}`,
      name: r.name || null,
      triggerScope: r.displayScope || 'all',
      triggerProducts: Array.isArray(r.triggerProducts) ? r.triggerProducts : [],
      triggerCollections: Array.isArray(r.triggerCollections) ? r.triggerCollections : [],
      fbtProducts: Array.isArray(r.fbtProducts) ? r.fbtProducts : [],
      active: true,
    })),
  };
}

// The storefront reads FBT config exclusively from the legacy fbt_widget
// table's temp1/temp2/temp3 blobs (via save_fbt_widget.php's GET) — never
// from fbt_widget_settings, which is this function's only write target.
// Without this sync, any FBT change made through the AI agent (this function
// is its sole write path) is saved but never reaches the storefront — the
// same bug class already fixed for checkout button/drawer status/progress
// bar (see ai-agent-tools.server.js's other sync* helpers). Only the temp
// slot matching the currently selected template is touched; the other two
// are passed through untouched so an AI edit to one template can't clobber
// another template's saved design.
const FBT_TEMPLATE_NAMES = { fbt1: 'Classic Grid', fbt2: 'Modern Cards', fbt3: 'Vertical List' };
function passthroughFbtJson(v) {
  if (v == null) return null;
  return typeof v === 'string' ? v : JSON.stringify(v);
}
async function syncFbtWidgetToLegacyRecord(shop, settings) {
  const db = getDb();
  const [rows] = await db.execute('SELECT * FROM fbt_widget WHERE shopDomain = ? LIMIT 1', [shop]);
  const existing = rows[0] || {};
  const selectedTemplate = settings.selected_template && FBT_TEMPLATE_NAMES[settings.selected_template]
    ? settings.selected_template
    : 'fbt1';
  const slotKey = { fbt1: 'temp1', fbt2: 'temp2', fbt3: 'temp3' }[selectedTemplate];

  const mergedSlot = {
    ...parseJsonSafe(existing[slotKey], {}),
    name: FBT_TEMPLATE_NAMES[selectedTemplate],
    layout: settings.layout,
    interactionType: settings.interaction_type,
    bgColor: settings.bg_color,
    textColor: settings.text_color,
    priceColor: settings.price_color,
    buttonColor: settings.button_color,
    buttonTextColor: settings.button_text_color,
    borderColor: settings.border_color,
    borderRadius: settings.border_radius,
    showPrices: !!settings.show_prices,
    showAddAllButton: !!settings.show_add_all_button,
  };

  await db.execute(`
    INSERT INTO fbt_widget (shopDomain, temp1, temp2, temp3, selectedTemp, selectedMode, \`condition\`, ai_enabled, ai_product_count, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE
      temp1=VALUES(temp1),temp2=VALUES(temp2),temp3=VALUES(temp3),
      selectedTemp=VALUES(selectedTemp),selectedMode=VALUES(selectedMode),
      \`condition\`=VALUES(\`condition\`),ai_enabled=VALUES(ai_enabled),
      ai_product_count=VALUES(ai_product_count),updated_at=CURRENT_TIMESTAMP(3)
  `, [
    shop,
    slotKey === 'temp1' ? JSON.stringify(mergedSlot) : passthroughFbtJson(existing.temp1),
    slotKey === 'temp2' ? JSON.stringify(mergedSlot) : passthroughFbtJson(existing.temp2),
    slotKey === 'temp3' ? JSON.stringify(mergedSlot) : passthroughFbtJson(existing.temp3),
    selectedTemplate,
    existing.selectedMode ?? settings.mode ?? 'manual',
    passthroughFbtJson(existing.condition),
    settings.mode === 'ai' ? 1 : (existing.ai_enabled ?? 0),
    settings.ai_product_count ?? existing.ai_product_count ?? 3,
  ]);
}

// `patch.rules` must be OMITTED (not an empty array) to preserve existing
// rules — already the case in the original route (guarded by
// Array.isArray(body.rules)), kept as-is here.
export async function saveFbtWidgetSettings(shop, planKey, patch) {
  const db = getDb();
  const [exRows] = await db.execute(
    'SELECT * FROM fbt_widget_settings WHERE shop_domain = ? LIMIT 1', [shop]
  );
  const ex = exRows[0] || {};

  const fbtAllowed = canPublishFeature(planKey, 'fbt');
  const isEnabled = fbtAllowed
    ? pickFlag(patch.is_enabled ?? patch.enabled, ex.is_enabled, 0)
    : 0;

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
    isEnabled,
    pick(patch.selected_template ?? patch.selectedTemplate ?? patch.activeTemplate, ex.selected_template, 'fbt1'),
    pick(patch.mode, ex.mode, 'manual'),
    pick(patch.ai_product_count ?? patch.aiProductCount, ex.ai_product_count, 3),
    pick(patch.bg_color ?? patch.bgColor, ex.bg_color, '#ffffff'),
    pick(patch.text_color ?? patch.textColor, ex.text_color, '#111827'),
    pick(patch.price_color ?? patch.priceColor, ex.price_color, '#059669'),
    pick(patch.button_color ?? patch.buttonColor, ex.button_color, '#111827'),
    pick(patch.button_text_color ?? patch.buttonTextColor, ex.button_text_color, '#ffffff'),
    pick(patch.button_text ?? patch.buttonText, ex.button_text, 'Add All to Cart'),
    pick(patch.border_color ?? patch.borderColor, ex.border_color, '#e5e7eb'),
    pick(patch.border_radius ?? patch.borderRadius, ex.border_radius, 8),
    pick(patch.layout, ex.layout, 'carousel'),
    pick(patch.interaction_type ?? patch.interactionType, ex.interaction_type, 'classic'),
    pickFlag(patch.show_prices, ex.show_prices, 1),
    pickFlag(patch.show_add_all_button, ex.show_add_all_button, 1),
  ]);

  if (Array.isArray(patch.rules)) {
    await db.execute('DELETE FROM fbt_rules WHERE shop_domain = ?', [shop]);
    for (let i = 0; i < patch.rules.length; i++) {
      const r = patch.rules[i];
      await db.execute(`
        INSERT INTO fbt_rules (shop_domain, name, trigger_scope, trigger_products, trigger_collections, fbt_products, discount_type, discount_value, is_active, sort_order)
        VALUES (?,?,?,?,?,?,?,?,1,?)
      `, [
        shop, r.name || `Rule ${i + 1}`, r.trigger_scope || r.displayScope || 'all',
        r.trigger_products?.length ? JSON.stringify(r.trigger_products) : null,
        r.trigger_collections?.length ? JSON.stringify(r.trigger_collections) : null,
        r.fbt_products?.length ? JSON.stringify(r.fbt_products) : (r.fbtProducts?.length ? JSON.stringify(r.fbtProducts) : null),
        r.discount_type || 'none', r.discount_value ?? 0, i,
      ]);
    }
  }

  const [settings] = await db.execute('SELECT * FROM fbt_widget_settings WHERE shop_domain = ?', [shop]);
  if (settings[0]) await syncFbtWidgetToLegacyRecord(shop, settings[0]);
  const [rules] = await db.execute('SELECT * FROM fbt_rules WHERE shop_domain = ? AND is_active = 1 ORDER BY sort_order ASC', [shop]);
  return { ...settings[0], rules: rules.map(parseFbtRule) };
}

// `fbt_widget.condition` is the ONLY thing the storefront widget
// (extensions/cart-drawer/snippets/fbt-widget-render.liquid) reads for rules
// — it never queries fbt_rules. fbt_rules is the normalized source of truth;
// condition is a generated cache of it. appendFbtRule/removeFbtRule below
// keep the two in sync for the specific rule they touch, WITHOUT rebuilding
// condition from the shop's full fbt_rules set — a full rebuild would also
// resurrect any pre-existing fbt_rules row that was never synced to
// condition before this fix shipped (a historical-backfill side effect that
// must not happen just because a merchant's next AI action runs this code).
// Each entry is keyed by the fbt_rules primary key (as a string) so a later
// removal can find and drop exactly the entry this same code created,
// without touching entries the manual editor's own save wrote (those use
// client-generated `rule-<timestamp>` ids, never a bare fbt_rules row id).
function buildFbtConditionEntry(ruleId, { name, triggerProducts, fbtProducts }) {
  return {
    id: String(ruleId),
    name,
    displayScope: triggerProducts.length ? 'per_product' : 'all',
    triggerProducts,
    triggerCollections: [],
    fbtProducts,
    aiGenerated: true,
  };
}
async function readFbtLegacyCondition(db, shop) {
  const [rows] = await db.execute('SELECT `condition` FROM fbt_widget WHERE shopDomain = ? LIMIT 1', [shop]);
  return parseJsonSafe(rows[0]?.condition, []);
}
async function writeFbtLegacyCondition(db, shop, conditionArray) {
  await db.execute(`
    INSERT INTO fbt_widget (shopDomain, \`condition\`, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE \`condition\` = VALUES(\`condition\`), updated_at = CURRENT_TIMESTAMP(3)
  `, [shop, JSON.stringify(conditionArray)]);
}

// Scoped single-rule read for the update_fbt_rule AI tool's RULE_NOT_FOUND
// check — filters by shop_domain so a ruleId can never be resolved against
// another shop's row.
export async function fetchFbtRuleById(shop, ruleId) {
  const db = getDb();
  const [rows] = await db.execute('SELECT * FROM fbt_rules WHERE id = ? AND shop_domain = ? LIMIT 1', [ruleId, shop]);
  return rows[0] ? parseFbtRule(rows[0]) : null;
}

// All of a shop's active rules, parsed — used by create_fbt_rule's
// server-side duplicate check to compare a new rule's normalized product ID
// sets against every rule that already exists before inserting it.
export async function listActiveFbtRules(shop) {
  const db = getDb();
  const [rows] = await db.execute('SELECT * FROM fbt_rules WHERE shop_domain = ? AND is_active = 1 ORDER BY sort_order ASC', [shop]);
  return rows.map(parseFbtRule);
}

// Appends a single FBT rule (used by the create_fbt_rule AI tool — mirrors
// upsell-rules.server.js's appendUpsellRule, but FBT rules live in their own
// table with multi-product trigger/offer + optional discount, not a JSON
// column on the widget-settings row). triggerProducts/offerProducts are full
// {id,title,handle,image,price} objects (not bare ids) — fbt_rules' real rows
// already store full objects (this is what the manual editor writes too, and
// what the storefront renderer needs to show a title/image/price), so the AI
// path now matches that shape instead of storing ids the renderer can't use.
export async function appendFbtRule(shop, { name, triggerProducts = [], triggerCollectionIds = [], offerProducts = [], discountType = 'none', discountValue = 0 }) {
  const db = getDb();

  const [existing] = await db.execute('SELECT is_enabled FROM fbt_widget_settings WHERE shop_domain = ?', [shop]);
  if (!existing.length) {
    await db.execute(`
      INSERT INTO fbt_widget_settings (shop_domain, is_enabled) VALUES (?, 1)
    `, [shop]);
  } else if (!existing[0].is_enabled) {
    await db.execute(`UPDATE fbt_widget_settings SET is_enabled = 1, updated_at = CURRENT_TIMESTAMP(3) WHERE shop_domain = ?`, [shop]);
  }

  const [countRows] = await db.execute('SELECT COUNT(*) AS c FROM fbt_rules WHERE shop_domain = ? AND is_active = 1', [shop]);
  const sortOrder = countRows[0]?.c ?? 0;
  const ruleName = name || 'Rule';

  // fbt_rules.trigger_scope is a real enforced MySQL enum
  // ('all'|'specific_products'|'specific_collections') — the previous
  // hardcoded 'specific' isn't a member, so MySQL was silently coercing it
  // to ''. A rule with named trigger products is 'specific_products'; one
  // with none (applies to every product, per the tool schema's own
  // description) is 'all'.
  const [ins] = await db.execute(`
    INSERT INTO fbt_rules (shop_domain, name, trigger_scope, trigger_products, trigger_collections, fbt_products, discount_type, discount_value, is_active, sort_order)
    VALUES (?,?,?,?,?,?,?,?,1,?)
  `, [
    shop, ruleName, triggerProducts.length ? 'specific_products' : 'all',
    triggerProducts.length ? JSON.stringify(triggerProducts) : null,
    triggerCollectionIds.length ? JSON.stringify(triggerCollectionIds) : null,
    offerProducts.length ? JSON.stringify(offerProducts) : null,
    discountType, discountValue, sortOrder,
  ]);

  const condition = await readFbtLegacyCondition(db, shop);
  condition.push(buildFbtConditionEntry(ins.insertId, { name: ruleName, triggerProducts, fbtProducts: offerProducts }));
  await writeFbtLegacyCondition(db, shop, condition);

  return { id: ins.insertId };
}

// Modifies an EXISTING rule's trigger/offer products in place (used by the
// update_fbt_rule AI tool) — the UPDATE only ever SETs trigger_scope/
// trigger_products/fbt_products/updated_at, so id/name/discount_type/
// discount_value/is_active/sort_order/trigger_collections are never touched,
// and the row is never deleted+reinserted (its id survives the edit). The
// caller (ai-agent-tools.server.js) has already fetched the existing row,
// resolved every supplied product name to exactly one real Shopify product,
// and confirmed the resulting offer list is non-empty — this function only
// ever receives an already-validated final state, so the write itself can
// never apply partially.
export async function updateFbtRuleRecord(shop, ruleId, { name, triggerProducts, offerProducts }) {
  const db = getDb();
  await db.execute(`
    UPDATE fbt_rules SET
      trigger_scope = ?,
      trigger_products = ?,
      fbt_products = ?,
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ? AND shop_domain = ?
  `, [
    triggerProducts.length ? 'specific_products' : 'all',
    triggerProducts.length ? JSON.stringify(triggerProducts) : null,
    JSON.stringify(offerProducts),
    ruleId, shop,
  ]);

  // Same condition-cache convention as appendFbtRule/removeFbtRule below:
  // only the target rule's entry is touched, keyed by the fbt_rules id.
  const condition = await readFbtLegacyCondition(db, shop);
  const idx = condition.findIndex((entry) => String(entry.id) === String(ruleId));
  const entry = buildFbtConditionEntry(ruleId, { name, triggerProducts, fbtProducts: offerProducts });
  if (idx >= 0) condition[idx] = entry; else condition.push(entry);
  await writeFbtLegacyCondition(db, shop, condition);
}

// Returns { removed: false } (never throws) when ruleId doesn't belong to
// this shop, so the caller can honestly report failure instead of assuming
// success — mirrors remove_upsell_rule's existing not-found handling.
export async function removeFbtRule(shop, ruleId) {
  const db = getDb();
  const [result] = await db.execute('DELETE FROM fbt_rules WHERE id = ? AND shop_domain = ?', [ruleId, shop]);
  if (!result.affectedRows) return { removed: false };

  const condition = await readFbtLegacyCondition(db, shop);
  const filtered = condition.filter((entry) => String(entry.id) !== String(ruleId));
  if (filtered.length !== condition.length) {
    await writeFbtLegacyCondition(db, shop, filtered);
  }
  return { removed: true };
}

// Tags every fbt_rules row with which mode created it — 'manual' (the admin
// page's own rule builder) or 'ai' (generateAiFbtRules below). Without this,
// switching the FBT admin page's mode selector between Manual and AI does
// nothing real: both modes wrote into the exact same fbt_rules/condition
// rows, so whichever set was saved last kept showing on the storefront no
// matter which mode was selected afterward — reported as "FBT still shows
// the old rule even after switching to AI". Self-heals like the other
// ADD COLUMN helpers above; existing rows default to 'manual' since every
// row created before this was written by the admin page's manual rule
// builder (appendFbtRule's chat-created rows are a separate, unaffected
// concern — they stay visible in both modes' fbt_rules reads today, but
// they aren't what this bug was about).
export async function ensureFbtRulesSourceColumn(db) {
  await ensureColumns(db, 'fbt_rules.source', 'fbt_rules', [
    { name: 'source', ddl: "`source` VARCHAR(10) NOT NULL DEFAULT 'manual'" },
  ]);
}

// Rebuilds the storefront-facing fbt_widget.condition blob from exactly the
// fbt_rules rows tagged with the given mode — the one and only place that
// blob gets written now, so it can never end up holding a stale mix of the
// other mode's rules. Also flips fbt_widget.selectedMode to match, since the
// widget script itself doesn't branch on mode but this keeps the stored
// record honest about which set is live.
export async function rebuildFbtLegacyConditionForMode(shop, mode) {
  const db = getDb();
  await ensureFbtRulesSourceColumn(db);
  const [rows] = await db.execute(
    'SELECT * FROM fbt_rules WHERE shop_domain = ? AND source = ? AND is_active = 1 ORDER BY sort_order ASC',
    [shop, mode]
  );
  const condition = rows.map((r) => ({
    id: String(r.id),
    name: r.name,
    displayScope: r.trigger_scope === 'all' ? 'all' : 'per_product',
    triggerProducts: parseJsonSafe(r.trigger_products, []),
    triggerCollections: parseJsonSafe(r.trigger_collections, []),
    fbtProducts: parseJsonSafe(r.fbt_products, []),
    aiGenerated: mode === 'ai',
  }));
  await writeFbtLegacyCondition(db, shop, condition);
  await db.execute('UPDATE fbt_widget SET selectedMode = ? WHERE shopDomain = ?', [mode, shop]);
}

// Bounded so one "Configure AI" / "Regenerate Suggestions" click stays
// inside a single request — a shop with a bigger catalog gets its first
// AI_COVERAGE_PRODUCT_CAP active products covered per run (reported honestly
// via the returned productsSkipped/truncated, never silently).
const AI_COVERAGE_PRODUCT_CAP = 300;

function extractNumericGid(gid) {
  const m = String(gid || '').match(/(\d+)$/);
  return m ? m[1] : null;
}

async function fetchCatalogForAiFbt(admin) {
  const products = [];
  let cursor = null;
  for (let page = 0; page < 3 && products.length < AI_COVERAGE_PRODUCT_CAP; page++) {
    const res = await admin.graphql(
      `query CatalogPage($cursor: String) {
        products(first: 100, after: $cursor, query: "status:active") {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              title
              handle
              productType
              featuredImage { url }
              priceRangeV2 { minVariantPrice { amount } }
              collections(first: 3) { edges { node { id } } }
            }
          }
        }
      }`,
      { variables: { cursor } }
    );
    const data = await res.json();
    const conn = data.data?.products;
    if (!conn) break;
    for (const edge of conn.edges) {
      const n = edge.node;
      const numericId = extractNumericGid(n.id);
      if (!numericId) continue;
      products.push({
        gid: n.id,
        numericId,
        title: n.title,
        handle: n.handle,
        productType: n.productType || '',
        // Many merchants never fill in Product Type at all (it's an easy
        // field to skip) but do organize their catalog into Collections —
        // this store's own catalog is a real example: every product has an
        // empty productType, but real, purposeful collections exist. Without
        // this, the productType fallback below has nothing to group by and
        // every product gets skipped, so AI Coverage Run silently covers 0
        // products and the storefront widget goes completely blank.
        collectionIds: (n.collections?.edges || []).map((e) => e.node.id),
        image: n.featuredImage?.url || '',
        price: n.priceRangeV2?.minVariantPrice?.amount || '0',
      });
    }
    if (!conn.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return products.slice(0, AI_COVERAGE_PRODUCT_CAP);
}

// Real co-purchase counts from actual order history (store_order_line_items,
// populated by every orders webhook via order-ingest.server.js) — the
// genuine "frequently bought together" signal, and the reason this needs no
// LLM call at all. Grouped/ranked in JS rather than a SQL window function so
// this doesn't depend on a specific MySQL version being available in
// production.
async function fetchCoPurchaseMap(db, shop, countPerProduct) {
  const [rows] = await db.execute(
    `SELECT a.product_id AS trigger_id, b.product_id AS offer_id, COUNT(DISTINCT a.order_id) AS cnt
     FROM store_order_line_items a
     JOIN store_order_line_items b
       ON a.shop_domain = b.shop_domain AND a.order_id = b.order_id AND a.product_id <> b.product_id
     WHERE a.shop_domain = ? AND a.product_id IS NOT NULL AND b.product_id IS NOT NULL
     GROUP BY a.product_id, b.product_id`,
    [shop]
  );
  const byTrigger = new Map();
  for (const r of rows) {
    const list = byTrigger.get(r.trigger_id) || [];
    list.push({ id: r.offer_id, cnt: r.cnt });
    byTrigger.set(r.trigger_id, list);
  }
  for (const [key, list] of byTrigger) {
    list.sort((a, b) => b.cnt - a.cnt);
    byTrigger.set(key, list.slice(0, countPerProduct));
  }
  return byTrigger;
}

// The real "who genuinely pairs with what" engine — shared by FBT's AI
// Coverage Run and the Upsell widget's AI Recommendations (see
// generateAiUpsellRules below), since the ranking logic (real co-purchase
// history first, same-product-type/collection fallback, skip rather than
// invent a pairing) is identical between the two; only what each feature
// does with the resulting rules differs. Kept here, not in either feature's
// own function, so neither one can drift from the other. Ranking/fallback
// decision logic itself lives in the pure, unit-tested
// app/utils/fbt-ai.shared.js so it can be tested without a live DB pool or
// Admin GraphQL client.
async function computeAiPairingRules(admin, shop, countPerProduct) {
  const db = getDb();
  const n = Math.max(1, Math.min(10, Number(countPerProduct) || 3));

  const [catalog, coPurchaseMap] = await Promise.all([
    fetchCatalogForAiFbt(admin),
    fetchCoPurchaseMap(db, shop, n),
  ]);

  const { rules, covered } = buildAiFbtRules(catalog, coPurchaseMap, n);

  return {
    rules,
    covered,
    n,
    totalProducts: catalog.length,
    productsSkipped: catalog.length - covered,
    truncated: catalog.length >= AI_COVERAGE_PRODUCT_CAP,
  };
}

// The "AI Coverage Run" behind the FBT admin page's Configure AI/Regenerate
// Suggestions buttons. Generates one rule per catalog product (see
// computeAiPairingRules above for the ranking). Every row this writes is
// tagged source='ai' and only source='ai' rows are ever touched here, so a
// merchant's own manual rules are never affected by running or re-running
// this.
export async function generateAiFbtRules(admin, shop, countPerProduct) {
  const db = getDb();
  await ensureFbtRulesSourceColumn(db);

  const { rules, covered, n, totalProducts, productsSkipped, truncated } = await computeAiPairingRules(admin, shop, countPerProduct);

  await db.execute('DELETE FROM fbt_rules WHERE shop_domain = ? AND source = ?', [shop, 'ai']);

  // One multi-row INSERT per chunk, not one statement per rule. getDb() is
  // not a local MySQL pool — it's an HTTPS proxy to php_backend/db_proxy.php
  // (see db.server.js), so every execute() is a full network round trip to
  // another host. At up to AI_COVERAGE_PRODUCT_CAP generated rules this loop
  // was issuing ~300 sequential round trips, which is tens of seconds of the
  // admin sitting on "Saving…" — the "save just loads and loads" report.
  // Chunked rather than one giant statement so a single query stays well
  // clear of max_allowed_packet (each row carries two JSON product blobs).
  const RULE_INSERT_CHUNK = 50;
  for (let start = 0; start < rules.length; start += RULE_INSERT_CHUNK) {
    const chunk = rules.slice(start, start + RULE_INSERT_CHUNK);
    const params = [];
    chunk.forEach((r, idx) => {
      params.push(
        shop, r.name, 'specific_products',
        JSON.stringify(r.trigger_products), null, JSON.stringify(r.fbt_products),
        start + idx, 'ai'
      );
    });
    await db.execute(
      `INSERT INTO fbt_rules (shop_domain, name, trigger_scope, trigger_products, trigger_collections, fbt_products, is_active, sort_order, source)
       VALUES ${chunk.map(() => '(?,?,?,?,?,?,1,?,?)').join(',')}`,
      params
    );
  }

  await db.execute(`
    INSERT INTO fbt_widget_settings (shop_domain, is_enabled, mode, ai_product_count)
    VALUES (?, 1, 'ai', ?)
    ON DUPLICATE KEY UPDATE mode = 'ai', ai_product_count = VALUES(ai_product_count), updated_at = CURRENT_TIMESTAMP(3)
  `, [shop, n]);
  await rebuildFbtLegacyConditionForMode(shop, 'ai');

  return { totalProducts, productsCovered: covered, productsSkipped, truncated };
}

// The Upsell widget's own "AI Recommendations" — was previously a bare LLM
// call (api.upsell-ai-suggestions.jsx) that asked a model to freely pick a
// flat count of "good upsells" from up to 100 catalog products with zero
// grounding in real purchase behavior, and applied every pick as a blanket
// triggerType:'all' rule — shown on every cart regardless of what's actually
// in it, never genuinely "matching" the product the shopper just added. Now
// reuses the exact same real engine as FBT's AI Coverage Run
// (computeAiPairingRules) and produces one rule per catalog product, so the
// storefront (renderUpsellSectionAsync in cart_drawer_inline.js, which
// already only matches a rule when its triggerProductIds is in the cart)
// actually shows a genuinely-paired product for whatever was added — the
// exact "like FBT" behavior asked for.
//
// upsell_widget_settings.manual_rules is a single undifferentiated JSON
// array with no source column (unlike fbt_rules) — AI-generated rules are
// tagged aiGenerated:true on the rule object itself so a later regenerate
// can replace only those, never a merchant's own hand-built rules.
export async function generateAiUpsellRules(admin, shop, planKey, countPerProduct) {
  const db = getDb();

  const { rules, covered, totalProducts, productsSkipped, truncated } = await computeAiPairingRules(admin, shop, countPerProduct);

  const aiRules = shapeAiUpsellRules(rules);

  const [exRows] = await db.execute('SELECT manual_rules FROM upsell_widget_settings WHERE shop_domain = ? LIMIT 1', [shop]);
  let existingRules = [];
  try { existingRules = exRows[0]?.manual_rules ? JSON.parse(exRows[0].manual_rules) : []; } catch { existingRules = []; }
  const keptManualRules = (Array.isArray(existingRules) ? existingRules : []).filter((r) => !r?.aiGenerated);
  const nextManualRules = [...keptManualRules, ...aiRules];

  const settings = await saveUpsellWidgetSettings(shop, planKey, { manualRules: nextManualRules });

  return { totalProducts, productsCovered: covered, productsSkipped, truncated, rules: aiRules, settings };
}

// ── Countdown Timer (cart drawer's own — distinct from the Product Widget's
// separately-shipped countdown, which lives on cart_drawer.countdown_data) ──

function shapeCountdownRow(row) {
  if (!row) return null;
  return {
    enabled: !!row.countdown_enabled,
    mode: row.countdown_mode,
    hours: row.countdown_hours,
    minutes: row.countdown_minutes,
    label: row.countdown_label,
    expiredLabel: row.countdown_expired_label,
    bgColor: row.countdown_bg_color,
    textColor: row.countdown_text_color,
    accentColor: row.countdown_accent_color,
    showOnProducts: !!row.countdown_show_on_products,
    showOnCoupons: !!row.countdown_show_on_coupons,
    couponCode: row.countdown_coupon_code,
    couponMode: row.countdown_coupon_mode,
  };
}

export async function saveCountdownTimerSettings(shop, planKey, patch) {
  const db = getDb();
  await ensureCountdownTimerColumns(db);

  const [exRows] = await db.execute(
    'SELECT countdown_enabled, countdown_mode, countdown_hours, countdown_minutes, countdown_label, countdown_expired_label, countdown_bg_color, countdown_text_color, countdown_accent_color, countdown_show_on_products, countdown_show_on_coupons, countdown_coupon_code, countdown_coupon_mode FROM cart_drawer_config WHERE shop_domain = ? LIMIT 1',
    [shop]
  );
  const ex = exRows[0] || {};

  // Countdown timer shares no existing plan-gate key of its own — treated as
  // part of the base cart-editor surface (unlike progress_bar/custom_css,
  // which are explicit FEATURES entries). Revisit if a dedicated gate is
  // introduced later.
  await db.execute(`
    INSERT INTO cart_drawer_config (
      shop_domain, countdown_enabled, countdown_mode, countdown_hours, countdown_minutes,
      countdown_label, countdown_expired_label, countdown_bg_color, countdown_text_color,
      countdown_accent_color, countdown_show_on_products, countdown_show_on_coupons,
      countdown_coupon_code, countdown_coupon_mode
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE
      countdown_enabled           = VALUES(countdown_enabled),
      countdown_mode               = VALUES(countdown_mode),
      countdown_hours               = VALUES(countdown_hours),
      countdown_minutes             = VALUES(countdown_minutes),
      countdown_label               = VALUES(countdown_label),
      countdown_expired_label       = VALUES(countdown_expired_label),
      countdown_bg_color            = VALUES(countdown_bg_color),
      countdown_text_color          = VALUES(countdown_text_color),
      countdown_accent_color        = VALUES(countdown_accent_color),
      countdown_show_on_products    = VALUES(countdown_show_on_products),
      countdown_show_on_coupons     = VALUES(countdown_show_on_coupons),
      countdown_coupon_code         = VALUES(countdown_coupon_code),
      countdown_coupon_mode         = VALUES(countdown_coupon_mode),
      updated_at                    = CURRENT_TIMESTAMP(3)
  `, [
    shop,
    pickFlag(patch.enabled, ex.countdown_enabled, 0),
    pick(patch.mode, ex.countdown_mode, 'session'),
    pick(patch.hours, ex.countdown_hours, 0),
    pick(patch.minutes, ex.countdown_minutes, 15),
    pick(patch.label, ex.countdown_label, 'Offer expires in'),
    pick(patch.expiredLabel, ex.countdown_expired_label, 'Offer expired!'),
    pick(patch.bgColor, ex.countdown_bg_color, '#fef2f2'),
    pick(patch.textColor, ex.countdown_text_color, '#991b1b'),
    pick(patch.accentColor, ex.countdown_accent_color, '#dc2626'),
    pickFlag(patch.showOnProducts, ex.countdown_show_on_products, 1),
    pickFlag(patch.showOnCoupons, ex.countdown_show_on_coupons, 1),
    pick(patch.couponCode, ex.countdown_coupon_code, null),
    pick(patch.couponMode, ex.countdown_coupon_mode, 'manual'),
  ]);

  const [rows] = await db.execute(
    'SELECT countdown_enabled, countdown_mode, countdown_hours, countdown_minutes, countdown_label, countdown_expired_label, countdown_bg_color, countdown_text_color, countdown_accent_color, countdown_show_on_products, countdown_show_on_coupons, countdown_coupon_code, countdown_coupon_mode FROM cart_drawer_config WHERE shop_domain = ? LIMIT 1',
    [shop]
  );
  return shapeCountdownRow(rows[0]);
}

export { pick, pickFlag, flag, getShopPlan };
