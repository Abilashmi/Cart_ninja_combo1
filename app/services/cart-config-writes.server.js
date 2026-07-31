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

// Self-heals the countdown_* columns onto cart_drawer_config the same way
// ensureAnnouncementStyleColumns does — the Cart Drawer's countdown timer had
// no backend at all before this (see plan Phase 2); this is the first write
// path for it, so the schema can't depend on a hand-run migration.
let countdownTimerColumnsEnsured = false;
export async function ensureCountdownTimerColumns(db) {
  if (countdownTimerColumnsEnsured) return;
  await db.execute(`
    ALTER TABLE cart_drawer_config
      ADD COLUMN IF NOT EXISTS countdown_enabled          TINYINT(1)   NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS countdown_mode              VARCHAR(10)  NOT NULL DEFAULT 'session',
      ADD COLUMN IF NOT EXISTS countdown_hours              INT          NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS countdown_minutes            INT          NOT NULL DEFAULT 15,
      ADD COLUMN IF NOT EXISTS countdown_label              VARCHAR(255) NOT NULL DEFAULT 'Offer expires in',
      ADD COLUMN IF NOT EXISTS countdown_expired_label      VARCHAR(255) NOT NULL DEFAULT 'Offer expired!',
      ADD COLUMN IF NOT EXISTS countdown_bg_color           VARCHAR(20)  NOT NULL DEFAULT '#fef2f2',
      ADD COLUMN IF NOT EXISTS countdown_text_color         VARCHAR(20)  NOT NULL DEFAULT '#991b1b',
      ADD COLUMN IF NOT EXISTS countdown_accent_color       VARCHAR(20)  NOT NULL DEFAULT '#dc2626',
      ADD COLUMN IF NOT EXISTS countdown_show_on_products   TINYINT(1)   NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS countdown_show_on_coupons    TINYINT(1)   NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS countdown_coupon_code        VARCHAR(100) NULL,
      ADD COLUMN IF NOT EXISTS countdown_coupon_mode        VARCHAR(10)  NOT NULL DEFAULT 'manual'
  `);
  countdownTimerColumnsEnsured = true;
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

// `patch.tiers` must be OMITTED (not an empty array) to preserve the existing
// tier ladder — only ever pass it from a caller that explicitly means to
// replace every tier (the manual editor's full save, or the AI's
// update_progress_bar_tiers tool). update_progress_bar / set_progress_bar_goal
// must never pass `tiers` at all.
export async function saveProgressBarSettings(shop, planKey, patch) {
  const db = getDb();
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
             reward_type, icon_type, icon_preset, icon_custom_svg, reward_products, is_active, sort_order)
          VALUES (?,?,?,?,?,?,?,?,?,?,1,?)
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
        'SELECT id FROM progress_bar_tiers WHERE settings_id = ? ORDER BY sort_order ASC LIMIT 1', [settingsId]
      );
      const tierId = existingTierRows[0]?.id;
      const rewardType = patch.rewardType ?? 'free_shipping';
      const iconPreset = patch.iconPreset ?? 'shipping';
      if (tierId) {
        await db.execute(`
          UPDATE progress_bar_tiers
          SET min_value = ?, reward_type = ?, icon_preset = ?, updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ?
        `, [patch.goalAmount, rewardType, iconPreset, tierId]);
      } else {
        await db.execute(`
          INSERT INTO progress_bar_tiers
            (shop_domain, settings_id, min_value, reward_type, icon_preset, is_active, sort_order)
          VALUES (?, ?, ?, ?, ?, 1, 0)
        `, [shop, settingsId, patch.goalAmount, rewardType, iconPreset]);
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
    pick(patch.layout, ex.layout, 'horizontal'),
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
  const [rules] = await db.execute('SELECT * FROM fbt_rules WHERE shop_domain = ? AND is_active = 1 ORDER BY sort_order ASC', [shop]);
  return { ...settings[0], rules: rules.map(parseFbtRule) };
}

// Appends a single FBT rule (used by the create_fbt_rule AI tool — mirrors
// upsell-rules.server.js's appendUpsellRule, but FBT rules live in their own
// table with multi-product trigger/offer + optional discount, not a JSON
// column on the widget-settings row).
export async function appendFbtRule(shop, { name, triggerProductIds = [], triggerCollectionIds = [], offerProductIds = [], discountType = 'none', discountValue = 0 }) {
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

  const [ins] = await db.execute(`
    INSERT INTO fbt_rules (shop_domain, name, trigger_scope, trigger_products, trigger_collections, fbt_products, discount_type, discount_value, is_active, sort_order)
    VALUES (?,?,?,?,?,?,?,?,1,?)
  `, [
    shop, name || 'Rule', 'specific',
    triggerProductIds.length ? JSON.stringify(triggerProductIds) : null,
    triggerCollectionIds.length ? JSON.stringify(triggerCollectionIds) : null,
    offerProductIds.length ? JSON.stringify(offerProductIds) : null,
    discountType, discountValue, sortOrder,
  ]);

  return { id: ins.insertId };
}

export async function removeFbtRule(shop, ruleId) {
  const db = getDb();
  await db.execute('DELETE FROM fbt_rules WHERE id = ? AND shop_domain = ?', [ruleId, shop]);
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
