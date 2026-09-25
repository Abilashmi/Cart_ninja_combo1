// The BRIX agent's tool executor — one function per entry in
// app/config/ai-tool-schemas.js's TOOL_REGISTRY. Every executor takes
// (ctx, args) and returns a plain JSON-serializable result that gets fed
// back to the model as the tool's output.
//
// ctx = { shop, admin, session, planKey, requestUrl }
import {
  saveCartDrawerConfig, saveProgressBarSettings, saveUpsellWidgetSettings,
  saveCouponSliderSettings, saveFbtWidgetSettings, saveCountdownTimerSettings,
  appendFbtRule, removeFbtRule, fetchProgressBar, fetchFbtConfig,
  fetchFbtRuleById, updateFbtRuleRecord, listActiveFbtRules,
} from './cart-config-writes.server';
import { resolveProductByName, appendUpsellRule, searchProducts } from './upsell-rules.server';
import { resolveCollectionByName, searchCollections } from './collection-resolver.server';
import { checkComboPlanGate, createComboTemplate } from './combo-templates.server';
import {
  createDiscount, deleteDiscount, persistLocalCopy,
  createAutomaticFreeShipping, createAutomaticAmountOff, listActiveDiscounts,
} from './discounts.server';
import { formatMoney } from '../utils/currency.shared';
import { detectStoreTheme } from './theme-detection.server';
import { getStoreConfigSnapshot } from './store-config-snapshot.server';
import { getPeriodTotals } from './analytics-query.server';
import { buildSalesReport, REPORT_PERIODS } from './sales-report.server';
import { syncRewardGiftDiscount } from './reward-gift-shopify.server';
import { getCatalogSnapshot } from './catalog-snapshot.server';
import { canAccessFeature } from './plan-permissions.server';
import { fetchCartDrawerRecord, persistCartDrawerRecord } from './cart-drawer-record.server';
import { getDb } from './db.server';
import { saveCouponBanner } from './coupon-banner.server';
import { needsInfo, CHOICES } from '../utils/ai-needs-info';

function parseJsonSafe(v, fb) {
  if (!v) return fb;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fb; }
}

// The storefront's checkout button styling is driven entirely by the legacy
// cart_drawer.checkout_button_style JSON blob (+ checkoutName/
// checkoutFooterText) — cart_drawer_config's checkout_button_* columns only
// feed the admin's live preview. Every tool that changes checkout-button
// appearance must read-modify-write this blob too, or the change silently
// never reaches the real storefront (same bug class already fixed once for
// upsell rules/FBT settings/applyTheme — see cart-config-writes.server.js's
// header comment and the removed ai_agent_apply.php).
async function syncCheckoutButtonToLegacyRecord(shop, { text, footerText, bgColor, textColor, borderRadius }) {
  const existing = (await fetchCartDrawerRecord(shop)) || {};
  const style = parseJsonSafe(existing.checkout_button_style, {});
  if (bgColor !== undefined) style.backgroundColor = bgColor;
  if (textColor !== undefined) style.textColor = textColor;
  if (borderRadius !== undefined) style.borderRadius = borderRadius;
  const record = {
    ...existing,
    ...(text !== undefined ? { checkoutName: text } : {}),
    ...(footerText !== undefined ? { checkoutFooterText: footerText } : {}),
    checkout_button_style: JSON.stringify(style),
  };
  await persistCartDrawerRecord(shop, record);
}

// The storefront's on/off switch reads the legacy cart_drawer.cartStatus
// column, not cart_drawer_config.is_enabled (which is admin-preview-only) —
// same dual-write ai_agent_apply.php's enableDrawer/disableDrawer case used
// to do, and the same pair app.cartdrawer.jsx's toggleDrawerStatus intent
// writes today.
async function syncDrawerStatusToLegacyRecord(shop, enabled) {
  const existing = (await fetchCartDrawerRecord(shop)) || {};
  const record = { ...existing, cartStatus: enabled ? 1 : 0, cart_status: enabled ? 1 : 0 };
  await persistCartDrawerRecord(shop, record);
}

// The storefront (cart_drawer_inline.js's parseProgressData) reads milestones
// from the legacy cart_drawer.progress_data JSON blob — NOT from the
// normalized progress_bar_settings/progress_bar_tiers tables saveProgressBarSettings
// writes to. The manual Cart Editor already dual-writes this (CartEditorPage.jsx's
// handleSave sends progress_data: JSON.stringify(pb)); every progress-bar AI
// tool must do the same read-back-and-sync, or changes made via chat never
// reach the actual storefront even though they look saved in the admin.
async function syncProgressBarToLegacyRecord(shop) {
  const db = getDb();
  const [settingsRows] = await db.execute('SELECT * FROM progress_bar_settings WHERE shop_domain = ? LIMIT 1', [shop]);
  const settings = settingsRows[0];
  if (!settings) return;

  const [tierRows] = await db.execute('SELECT * FROM progress_bar_tiers WHERE settings_id = ? ORDER BY sort_order', [settings.id]);

  const progressData = {
    enabled: !!settings.is_enabled,
    mode: settings.mode,
    position: settings.placement,
    showWhenEmpty: !!settings.show_on_empty,
    colors: {
      background: settings.bar_background_color,
      fill: settings.bar_foreground_color,
      icon: settings.icon_color,
      message: settings.completion_text_color,
    },
    borderRadius: settings.border_radius,
    completionMessage: settings.completion_text,
    confetti: !!settings.enable_confetti,
    tiers: tierRows.map((t) => {
      const products = parseJsonSafe(t.reward_products, []);
      return {
        id: `tier-${t.id}`,
        minValue: Number(t.min_value) || 0,
        minimumSpend: Number(t.min_value) || 0,
        minQuantity: t.min_quantity || 0,
        title: t.description || 'Milestone',
        description: t.description || 'Milestone',
        rewardType: t.reward_type || 'product',
        icon: t.icon_preset || 'gift',
        iconType: t.icon_type || 'preset',
        iconPreset: t.icon_preset || 'gift',
        iconCustomSvg: t.icon_custom_svg || '',
        products,
        rewardProducts: products,
        // 'free' = the storefront may only keep this reward while it is really
        // free at checkout (see syncRewardProducts in cart_drawer_inline.js).
        rewardPricing: t.reward_pricing === 'free' ? 'free' : 'regular',
      };
    }),
  };

  const existing = (await fetchCartDrawerRecord(shop)) || {};
  const record = {
    ...existing,
    progress_status: settings.is_enabled ? 1 : 0,
    progress_data: JSON.stringify(progressData),
  };
  await persistCartDrawerRecord(shop, record);
}

// ── Color helpers for suggest_theme_colors ──────────────────────────────────
// Turns one base theme (detected or currently-saved) into several distinct,
// always-readable combos by rotating hue — rather than inventing arbitrary
// palettes, each option stays tied to the shop's real base color.
function hexToRgb(hex) {
  const clean = String(hex || '').replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0').slice(0, 6);
  const num = parseInt(full, 16) || 0;
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360; s /= 100; l /= 100;
  if (s === 0) { const v = l * 255; return { r: v, g: v, b: v }; }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return { r: hue2rgb(p, q, h + 1 / 3) * 255, g: hue2rgb(p, q, h) * 255, b: hue2rgb(p, q, h - 1 / 3) * 255 };
}
// Rotates a hex color's hue by `degrees`, boosting saturation to at least 35%
// so the rotation stays visible even when the base color is near-gray.
function rotateHue(hex, degrees) {
  if (!degrees) return hex;
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  const rgb = hslToRgb(h + degrees, Math.max(s, 35), Math.min(Math.max(l, 25), 75));
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}
// Simple luminance check — light backgrounds get dark text, dark get white.
function contrastTextColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#111827' : '#ffffff';
}
// Base (0° — the real detected/current theme, unchanged) plus 3 hue-rotated
// variants, each with auto-computed contrasting text — always 4 distinct,
// readable combos derived from one real starting point.
function buildPaletteOptions(base) {
  return [0, 90, 180, 270].map((deg) => {
    const headerBgColor = deg === 0 ? base.headerBgColor : rotateHue(base.headerBgColor, deg);
    const checkoutBgColor = deg === 0 ? base.checkoutBgColor : rotateHue(base.checkoutBgColor, deg);
    return {
      headerBgColor,
      headerTextColor: deg === 0 ? base.headerTextColor : contrastTextColor(headerBgColor),
      checkoutBgColor,
      checkoutTextColor: deg === 0 ? base.checkoutTextColor : contrastTextColor(checkoutBgColor),
    };
  });
}

// Real duplicate protection for the promotion-creation tools — runs
// regardless of whether the model remembered to call list_active_promotions
// itself first. Matches on type + threshold (+ value, for amount-off) among
// ACTIVE/SCHEDULED discounts only; a small tolerance absorbs float rounding.
const AMOUNT_TOLERANCE = 0.01;
function amountsMatch(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) < AMOUNT_TOLERANCE;
}
function findMatchingPromotion(discounts, { discountType, discountValue, minimumAmount }) {
  return discounts.find((d) => (
    (d.status === 'ACTIVE' || d.status === 'SCHEDULED') &&
    d.discountType === discountType &&
    (discountType === 'free_shipping' || amountsMatch(d.discountValue, discountValue)) &&
    amountsMatch(d.minimumSubtotal, minimumAmount || null)
  ));
}

function productNotFoundResult(name) {
  return { success: false, reason: 'not_found', message: `No product found matching "${name}". Try a different name, or use get_products to search.` };
}
function productAmbiguousResult(name, candidates) {
  return { success: false, reason: 'ambiguous', message: `Multiple products match "${name}" — ask the merchant which one they mean.`, candidates: candidates.map(c => c.title) };
}

// A "free product" progress bar reward has to point at real store products —
// they are what the storefront adds to the cart when the milestone is reached
// (see syncRewardProducts in cart_drawer_inline.js). Resolves the names the
// merchant gave to real Shopify product ids, in the same GID form the editor's
// Reward Products picker saves, and refuses to guess: an unknown or ambiguous
// name is returned as a failure for the model to ask about.
async function resolveRewardProducts(ctx, rawNames) {
  const names = (Array.isArray(rawNames) ? rawNames : [rawNames]).map((n) => String(n ?? '').trim()).filter(Boolean);
  const results = await Promise.all(names.map((n) => resolveProductByName(ctx.admin, n)));
  const badIdx = results.findIndex((r) => r.status !== 'found');
  if (badIdx !== -1) {
    const bad = results[badIdx];
    return { error: bad.status === 'ambiguous' ? productAmbiguousResult(names[badIdx], bad.candidates) : productNotFoundResult(names[badIdx]) };
  }
  const unique = [...new Map(results.map((r) => [r.id, r])).values()];
  return { ids: unique.map((r) => r.id), titles: unique.map((r) => r.title) };
}

// What Brix must tell the merchant after saving a FREE reward product, built
// from the real result of syncRewardGiftDiscount (never a guess).
function giftResponseHint(giftDiscount, pricing) {
  if (pricing === 'regular') return 'The milestone is saved. The reward product is added at its regular price. Say only that.';
  if (!giftDiscount) return null;
  if (giftDiscount.verified) return 'The milestone is saved and the reward product is free at checkout once the goal is reached.';
  return `The milestone IS saved and the product will be added automatically when the goal is reached, but it is NOT free at checkout yet. Reason: ${giftDiscount.message} Tell the merchant exactly that reason in plain words. Do not offer to create a discount manually in Shopify admin; the free discount switches on by itself the next time the progress bar is saved once the reason above is resolved.`;
}

const NEEDS_REWARD_PRODUCT = {
  success: false,
  reason: 'needs_reward_product',
  message: 'A free-product reward needs a specific store product. Ask the merchant which product should be given free at this milestone, then call the tool again with rewardProductNames.',
};

const rewardProductIds = (tier) => (Array.isArray(tier?.reward_products) ? tier.reward_products : []);

// Dedicated structured-error shapes for update_fbt_rule/create_fbt_rule's
// duplicate check — distinct from productNotFoundResult/productAmbiguousResult
// above (used by create_upsell_rule/create_fbt_rule's own product resolution)
// so those tools' existing result shape stays exactly as-is.
function fbtProductNotFoundResult(name) {
  return { success: false, error: 'PRODUCT_NOT_FOUND', productName: name, message: 'No matching Shopify product was found.' };
}
function fbtProductAmbiguousResult(name, candidates) {
  return {
    success: false, error: 'PRODUCT_AMBIGUOUS', productName: name,
    matches: candidates.map((c) => ({ id: c.id, title: c.title, handle: c.handle })),
    message: 'Multiple Shopify products matched this name.',
  };
}
// Canonical Shopify product IDs only (never titles), deduped + sorted so
// order never matters — shared by create_fbt_rule's duplicate check and
// update_fbt_rule's changed/unchanged diffing.
function normalizedProductIds(products) {
  return Array.from(new Set((products || []).map((p) => p.id))).sort();
}
function sameProductIdSet(a, b) {
  const na = normalizedProductIds(a);
  const nb = normalizedProductIds(b);
  return na.length === nb.length && na.every((id, i) => id === nb[i]);
}

export const TOOL_EXECUTORS = {
  // ── Reads ──────────────────────────────────────────────────────────────
  async get_current_config(ctx) {
    const db = getDb();
    const [cdcRows] = await db.execute('SELECT * FROM cart_drawer_config WHERE shop_domain = ? LIMIT 1', [ctx.shop]);
    // progress_bar_settings alone has no goal/reward columns — those live in
    // progress_bar_tiers, joined in by fetchProgressBar (already used by the
    // write tools below) but previously never fetched here, so this tool
    // could never actually answer a "what's my goal/reward" question from
    // real data. Reuses the existing read helper rather than duplicating it.
    const progressBar = await fetchProgressBar(db, ctx.shop);
    const [csRows] = await db.execute('SELECT * FROM coupon_slider_settings WHERE shop_domain = ? LIMIT 1', [ctx.shop]);
    const [upRows] = await db.execute('SELECT * FROM upsell_widget_settings WHERE shop_domain = ? LIMIT 1', [ctx.shop]);
    const fbt = await fetchFbtConfig(db, ctx.shop);
    return {
      cartDrawerConfig: cdcRows[0] || null,
      progressBar,
      couponSlider: csRows[0] || null,
      upsellWidget: upRows[0] || null,
      fbt,
    };
  },

  async get_products(ctx, { query, limit }) {
    const matches = await searchProducts(ctx.admin, query, limit || 10);
    return { matches };
  },

  async get_collections(ctx, { query, limit }) {
    const matches = await searchCollections(ctx.admin, query, limit || 10);
    return { matches };
  },

  async get_store_insights(ctx) {
    const snapshot = await getStoreConfigSnapshot(ctx.shop);
    let aov = null;
    if (canAccessFeature(ctx.planKey, 'full_analytics')) {
      try {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const startDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
        const endDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const totals = await getPeriodTotals(ctx.shop, startDate, endDate);
        if (totals.order_count >= 3) aov = totals;
      } catch (e) { console.error('[ai-agent-tools] get_store_insights analytics failed:', e.message); }
    }
    let catalog = null;
    if (!aov) {
      try { catalog = await getCatalogSnapshot(ctx.admin); } catch (e) { console.error('[ai-agent-tools] get_store_insights catalog failed:', e.message); }
    }
    return { enabledModules: snapshot, aov, catalog, analyticsLocked: !canAccessFeature(ctx.planKey, 'full_analytics') };
  },

  // Opens the in-chat discount form (see DiscountFormWidget). Creates nothing
  // itself: the merchant reviews the pre-filled details and clicks Create, which
  // runs create_free_shipping / create_amount_off_promotion / create_discount.
  async show_discount_form(ctx, { kind, value, minimumAmount, title, code } = {}) {
    const kinds = ['free_shipping', 'percentage_off', 'amount_off', 'discount_code'];
    const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
    return {
      success: true,
      form: {
        kind: kinds.includes(kind) ? kind : 'free_shipping',
        value: num(value),
        minimumAmount: num(minimumAmount),
        title: typeof title === 'string' ? title.slice(0, 80) : '',
        code: typeof code === 'string' ? code.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 30) : '',
        currency: { code: ctx.currencyCode, symbol: ctx.currencySymbol, locale: ctx.currencyLocale },
      },
    };
  },

  async get_sales_report(ctx, { period } = {}) {
    if (!canAccessFeature(ctx.planKey, 'full_analytics')) {
      return { success: false, reason: 'locked', message: 'The visual sales report is part of full analytics, which is locked on the current plan.' };
    }
    const safePeriod = REPORT_PERIODS.includes(period) ? period : 'last_30_days';
    const { report, summary } = await buildSalesReport(ctx.shop, safePeriod, {
      code: ctx.currencyCode, symbol: ctx.currencySymbol, locale: ctx.currencyLocale,
    });
    return { success: true, report, summary };
  },

  // ── Cart drawer config ───────────────────────────────────────────────────
  async set_cart_drawer_enabled(ctx, { enabled }) {
    await saveCartDrawerConfig(ctx.shop, ctx.planKey, { is_enabled: enabled ? 1 : 0 });
    await syncDrawerStatusToLegacyRecord(ctx.shop, enabled);
    return { success: true, enabled };
  },

  async update_design(ctx, args) {
    const data = await saveCartDrawerConfig(ctx.shop, ctx.planKey, args);
    return { success: true, design: { width: data.design_width, borderRadius: data.design_border_radius, shadow: !!data.design_shadow, animation: data.design_animation } };
  },

  async update_general(ctx, { drawerSide, open_on_add, open_on_icon_click }) {
    const data = await saveCartDrawerConfig(ctx.shop, ctx.planKey, {
      position: drawerSide,
      open_on_add, open_on_icon_click,
    });
    return { success: true, general: { drawerSide: data.position, openOnAdd: !!data.open_on_add, openOnIconClick: !!data.open_on_icon_click } };
  },

  async update_header(ctx, args) {
    const data = await saveCartDrawerConfig(ctx.shop, ctx.planKey, args);
    return { success: true, header: { title: data.header_title, bgColor: data.header_bg_color, textColor: data.header_text_color, borderBottom: !!data.header_border_bottom } };
  },

  async update_announcements(ctx, args) {
    const data = await saveCartDrawerConfig(ctx.shop, ctx.planKey, args);
    return { success: true, announcement: { enabled: !!data.announcement_enabled, text: data.announcement_text, bgColor: data.announcement_bg_color } };
  },

  async update_empty_cart(ctx, args) {
    const data = await saveCartDrawerConfig(ctx.shop, ctx.planKey, args);
    return { success: true, emptyCart: { message: data.empty_cart_message } };
  },

  async update_checkout_button(ctx, args) {
    const data = await saveCartDrawerConfig(ctx.shop, ctx.planKey, args);
    await syncCheckoutButtonToLegacyRecord(ctx.shop, {
      text: args.checkout_button_text, footerText: args.checkout_footer_text,
      bgColor: args.checkout_button_bg_color, textColor: args.checkout_button_text_color,
      borderRadius: args.checkout_button_border_radius,
    });
    return { success: true, checkoutButton: { text: data.checkout_button_text, bgColor: data.checkout_button_bg_color, textColor: data.checkout_button_text_color } };
  },

  async update_custom_css(ctx, { custom_css }) {
    if (!canAccessFeature(ctx.planKey, 'custom_css') && String(custom_css || '').trim()) {
      return { success: false, reason: 'locked', message: 'Custom CSS is locked on your current plan — it can be edited but won\'t publish until you upgrade.' };
    }
    await saveCartDrawerConfig(ctx.shop, ctx.planKey, { custom_css });
    return { success: true };
  },

  async update_countdown_timer(ctx, args) {
    // Turning a timer on needs a duration; everything else (label, colours,
    // mode) has a sensible default and is not asked.
    if (args.enabled === true && !(Number(args.hours) > 0 || Number(args.minutes) > 0)) {
      let existingMinutes = 0;
      try {
        const [rows] = await getDb().execute('SELECT countdown_hours, countdown_minutes FROM cart_drawer_config WHERE shop_domain = ? LIMIT 1', [ctx.shop]);
        existingMinutes = (Number(rows[0]?.countdown_hours) || 0) * 60 + (Number(rows[0]?.countdown_minutes) || 0);
      } catch { /* columns not created yet — treat as never configured */ }
      if (existingMinutes === 0) {
        return needsInfo('duration', 'Ask the merchant how long the countdown timer should run (for example 15 minutes, 1 hour, 24 hours). Then call this tool again with hours/minutes.', CHOICES.countdownDuration);
      }
    }
    const data = await saveCountdownTimerSettings(ctx.shop, ctx.planKey, args);
    return { success: true, countdownTimer: data };
  },

  // ── Progress bar ─────────────────────────────────────────────────────────
  async update_progress_bar(ctx, args) {
    const data = await saveProgressBarSettings(ctx.shop, ctx.planKey, args);
    await syncProgressBarToLegacyRecord(ctx.shop);
    return { success: true, progressBar: { enabled: !!data.is_enabled, placement: data.placement } };
  },

  async set_progress_bar_goal(ctx, { goalAmount, rewardType: requestedRewardType, rewardProductNames, rewardPricing, placement }) {
    const iconPresetMap = { free_shipping: 'shipping', product: 'gift', discount: 'diamond', gift: 'trophy' };

    // goalAmount is now optional in the schema (true partial-update support)
    // — fetched here BEFORE the write so an omitted goalAmount can be
    // explicitly preserved by this executor itself. This is deliberate:
    // saveProgressBarSettings's own goalAmount branch (cart-config-writes.
    // server.js) only runs `if (patch.goalAmount != null ...)`, i.e. it has
    // no merge-with-existing behavior for goalAmount the way it does for
    // rewardType/iconPreset — so goalAmount must never be sent as
    // undefined/guessed; it must be a real value, explicitly the prior one
    // when the merchant didn't mention it. Never relies on the model to
    // echo the current amount back.
    const before = await fetchProgressBar(getDb(), ctx.shop);
    const priorTier = before?.tiers?.[0];
    const priorGoalAmount = priorTier ? Number(priorTier.min_value) : null;
    const priorRewardType = priorTier?.reward_type ?? null;

    const effectiveGoalAmount = goalAmount ?? priorGoalAmount;
    if (effectiveGoalAmount === null || effectiveGoalAmount === undefined) {
      return { success: false, message: 'No progress bar goal is set yet — please provide a spend amount to get started.' };
    }

    // Reward products — resolved and validated BEFORE anything is written, so
    // a missing/unknown/ambiguous product can never leave the bar half-set.
    // Naming products makes the reward a free product by definition. Moving
    // the reward to any other type clears the products (the storefront adds
    // every product on a tier that has any, whatever its type).
    const wantsProducts = (Array.isArray(rewardProductNames) ? rewardProductNames : []).some((n) => String(n ?? '').trim());
    const rewardType = wantsProducts ? 'product' : requestedRewardType;
    if (!priorTier && !requestedRewardType && !wantsProducts) {
      return needsInfo('reward', 'Ask the merchant what reward the progress bar should unlock at that amount: free shipping, or a free product (then which product). Then call this tool again.', CHOICES.progressReward);
    }
    let rewardProducts; // undefined = leave the tier's products exactly as they are
    let rewardProductTitles = [];
    if (wantsProducts) {
      const resolved = await resolveRewardProducts(ctx, rewardProductNames);
      if (resolved.error) return resolved.error;
      rewardProducts = resolved.ids;
      rewardProductTitles = resolved.titles;
    } else if (rewardType && rewardType !== 'product') {
      rewardProducts = [];
    }
    if ((rewardType ?? priorRewardType) === 'product' && (rewardProducts ?? rewardProductIds(priorTier)).length === 0) {
      return NEEDS_REWARD_PRODUCT;
    }
    // A newly chosen reward product needs one decision before anything is
    // saved: free (BRIX creates the checkout discount) or its regular price.
    if (wantsProducts && rewardPricing !== 'free' && rewardPricing !== 'regular') {
      return needsInfo('rewardPricing', `Ask the merchant ONE question: should ${rewardProductTitles.join(' and ')} be free once the goal is reached (BRIX creates the discount automatically), or be added at its regular price? Then call this tool again with rewardPricing "free" or "regular". Do not save anything until they answer.`, CHOICES.rewardPricing);
    }

    // rewardType/iconPreset are passed through as-is (undefined when the
    // merchant only asked to change the goal amount) — saveProgressBarSettings
    // falls back to the tier's existing value in that case, not a hardcoded
    // default, so changing just the goal never resets an already-configured
    // reward type back to free_shipping.
    const data = await saveProgressBarSettings(ctx.shop, ctx.planKey, {
      is_enabled: 1, goalAmount: effectiveGoalAmount, rewardType, rewardProducts, rewardPricing,
      iconPreset: rewardType ? iconPresetMap[rewardType] : undefined, placement,
    });
    await syncProgressBarToLegacyRecord(ctx.shop);
    // Keep the free-gift checkout discount in step with the saved bar (also
    // when a product reward was just replaced by something else).
    const giftDiscount = (wantsProducts || rewardProductIds(priorTier).length > 0)
      ? await syncRewardGiftDiscount(ctx.admin, ctx.shop, { currencyCode: ctx.currencyCode })
      : null;

    const savedTier = data.tiers?.[0];
    // Read-back check — never report a reward product as set unless the row
    // we just re-read actually holds it.
    if (rewardProducts?.length && !rewardProducts.every((id) => rewardProductIds(savedTier).includes(id))) {
      return { success: false, message: 'The reward product could not be saved to the progress bar. Nothing was confirmed — tell the merchant it failed and to try again.' };
    }
    // Reports the values actually saved (including a preserved existing
    // one), not just an echo of what this call happened to pass in.
    const savedGoalAmount = savedTier ? Number(savedTier.min_value) : effectiveGoalAmount;
    const savedRewardType = savedTier?.reward_type || rewardType || 'free_shipping';

    // changed/unchanged built from a real before/after comparison, not from
    // which args this call happened to include — this is what actually
    // fixes "reward changed" being mislabeled as "goal changed" (goalAmount
    // was always present in args, so a presence-based split always got it
    // wrong regardless of what the response formatter did with it).
    const changed = {};
    const unchanged = {};
    if (priorGoalAmount === null || savedGoalAmount !== priorGoalAmount) changed.goalAmount = savedGoalAmount;
    else unchanged.goalAmount = savedGoalAmount;
    // Reward products are the more specific fact, so when they change they
    // stand in for "the reward type changed to a free product".
    const productsChanged = wantsProducts && JSON.stringify(rewardProductIds(priorTier)) !== JSON.stringify(rewardProducts);
    if (productsChanged) changed.rewardProducts = rewardProductTitles;
    else if (priorRewardType === null || savedRewardType !== priorRewardType) changed.rewardType = savedRewardType;
    else unchanged.rewardType = savedRewardType;

    return {
      success: true,
      changed,
      unchanged,
      giftDiscount,
      responseHint: giftResponseHint(giftDiscount, savedTier?.reward_pricing ?? 'regular'),
      rewardPricing: savedTier?.reward_pricing ?? 'regular',
      progressBar: {
        enabled: !!data.is_enabled, goalAmount: savedGoalAmount, rewardType: savedRewardType,
        rewardProducts: wantsProducts ? rewardProductTitles : undefined,
      },
    };
  },

  async update_progress_bar_tiers(ctx, { tiers }) {
    const before = await fetchProgressBar(getDb(), ctx.shop);
    const priorTiers = before?.tiers || [];

    // Every tier's reward products are resolved BEFORE the (full-replace)
    // write, so one bad product name can't wipe the existing ladder.
    const built = [];
    const summary = [];
    for (let i = 0; i < (tiers || []).length; i++) {
      const { rewardProductNames, rewardPricing, ...tier } = tiers[i];
      const wantsProducts = (Array.isArray(rewardProductNames) ? rewardProductNames : []).some((n) => String(n ?? '').trim());
      const type = wantsProducts ? 'product' : (tier.reward_type || 'free_shipping');
      let products = [];
      let titles = [];
      if (wantsProducts) {
        const resolved = await resolveRewardProducts(ctx, rewardProductNames);
        if (resolved.error) return resolved.error;
        products = resolved.ids;
        titles = resolved.titles;
        if (rewardPricing !== 'free' && rewardPricing !== 'regular') {
          return needsInfo('rewardPricing', `Ask the merchant ONE question: should ${titles.join(' and ')} be free once that milestone is reached (BRIX creates the discount automatically), or be added at its regular price? Then call this tool again with rewardPricing "free" or "regular" on that tier. Do not save anything until they answer.`, CHOICES.rewardPricing);
        }
      } else if (type === 'product') {
        // Not renamed this call: keep what this position already has rather
        // than dropping the merchant's chosen product on an amount-only edit.
        const prior = priorTiers[i];
        if (prior?.reward_type === 'product' && rewardProductIds(prior).length) products = rewardProductIds(prior);
        else return NEEDS_REWARD_PRODUCT;
      }
      const pricing = wantsProducts ? rewardPricing : (priorTiers[i]?.reward_pricing ?? 'regular');
      built.push({ ...tier, reward_type: type, products, reward_pricing: pricing });
      summary.push({ minValue: tier.min_value, rewardType: type, rewardProducts: titles.length ? titles : undefined, rewardPricing: type === 'product' ? pricing : undefined });
    }

    const data = await saveProgressBarSettings(ctx.shop, ctx.planKey, { tiers: built });
    await syncProgressBarToLegacyRecord(ctx.shop);
    const hadGift = priorTiers.some((t) => rewardProductIds(t).length > 0) || built.some((b) => b.products.length > 0);
    const giftDiscount = hadGift ? await syncRewardGiftDiscount(ctx.admin, ctx.shop, { currencyCode: ctx.currencyCode }) : null;

    // Read-back check, same as set_progress_bar_goal.
    const saved = data.tiers || [];
    const mismatch = built.some((b, i) => b.products.length && !b.products.every((id) => rewardProductIds(saved[i]).includes(id)));
    if (mismatch) {
      return { success: false, message: 'The reward products could not be saved to the progress bar. Nothing was confirmed — tell the merchant it failed and to try again.' };
    }
    const anyFree = built.some((b) => b.products.length > 0 && b.reward_pricing === 'free');
    return { success: true, tierCount: saved.length, tiers: summary, giftDiscount, ...(anyFree && giftDiscount ? { responseHint: giftResponseHint(giftDiscount, 'free') } : {}) };
  },

  // ── Coupon slider ────────────────────────────────────────────────────────
  async update_coupon_slider(ctx, args) {
    const data = await saveCouponSliderSettings(ctx.shop, ctx.planKey, args);
    return { success: true, couponSlider: { enabled: !!data.is_enabled, template: data.selected_template } };
  },

  // Product-page Coupon Banner (separate module from the cart drawer's slider above)
  async update_coupon_banner(ctx, args) {
    return saveCouponBanner(ctx, args);
  },

  // ── Upsell products ──────────────────────────────────────────────────────
  async update_upsell_products(ctx, args) {
    const data = await saveUpsellWidgetSettings(ctx.shop, ctx.planKey, args);
    return { success: true, upsell: { enabled: !!data.is_enabled, title: data.title } };
  },

  async create_upsell_rule(ctx, { triggerProductName, offerProductName }) {
    const [trigger, offer] = await Promise.all([
      resolveProductByName(ctx.admin, triggerProductName),
      resolveProductByName(ctx.admin, offerProductName),
    ]);
    if (trigger.status === 'not_found') return productNotFoundResult(triggerProductName);
    if (trigger.status === 'ambiguous') return productAmbiguousResult(triggerProductName, trigger.candidates);
    if (offer.status === 'not_found') return productNotFoundResult(offerProductName);
    if (offer.status === 'ambiguous') return productAmbiguousResult(offerProductName, offer.candidates);

    await appendUpsellRule(ctx.shop, {
      triggerProductId: trigger.id, triggerTitle: trigger.title,
      offerProductId: offer.id, offerTitle: offer.title,
    });
    return { success: true, trigger: trigger.title, offer: offer.title };
  },

  async remove_upsell_rule(ctx, { ruleId }) {
    const db = getDb();
    const [rows] = await db.execute('SELECT manual_rules FROM upsell_widget_settings WHERE shop_domain = ? LIMIT 1', [ctx.shop]);
    const rules = parseJsonSafe(rows[0]?.manual_rules, []);
    const filtered = rules.filter((r) => r.id !== ruleId);
    if (filtered.length === rules.length) return { success: false, reason: 'not_found', message: `No upsell rule found with id ${ruleId}.` };
    await db.execute('UPDATE upsell_widget_settings SET manual_rules = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE shop_domain = ?', [JSON.stringify(filtered), ctx.shop]);
    return { success: true };
  },

  // ── FBT ──────────────────────────────────────────────────────────────────
  async update_fbt_widget(ctx, args) {
    const data = await saveFbtWidgetSettings(ctx.shop, ctx.planKey, args);
    return { success: true, fbt: { enabled: !!data.is_enabled, template: data.selected_template } };
  },

  async create_fbt_rule(ctx, { triggerProductNames, offerProductNames, discountType, discountValue, showOn, template }) {
    // The two decisions that change what a merchant gets, asked before anything
    // is resolved or written: the template (only if FBT was never set up) and
    // whether it appears on every product or only specific ones. Never assumed.
    const namedTriggers = (triggerProductNames || []).some((n) => String(n ?? '').trim());
    let fbtSetUpBefore = true;
    try {
      const [tplRows] = await getDb().execute('SELECT selected_template FROM fbt_widget_settings WHERE shop_domain = ? LIMIT 1', [ctx.shop]);
      fbtSetUpBefore = !!tplRows[0];
    } catch { /* can't tell — don't block on it */ }
    if (!fbtSetUpBefore && !template) {
      return needsInfo('template', 'Ask the merchant which FBT template they want: Classic Grid, Modern Cards, or Vertical List. Then call this tool again.', CHOICES.fbtTemplate);
    }
    if (!namedTriggers && showOn !== 'all') {
      return showOn === 'specific'
        ? needsInfo('showOnTargets', 'Ask the merchant which product(s) should trigger this FBT (the products it appears on).')
        : needsInfo('showOn', 'Ask the merchant where this FBT should appear: on all product pages, or only on specific products. Then call this tool again.', CHOICES.fbtShowOn);
    }

    const offerResults = await Promise.all((offerProductNames || []).map((n) => resolveProductByName(ctx.admin, n)));
    const badOffer = offerResults.find((r) => r.status !== 'found');
    if (badOffer) {
      const idx = offerResults.indexOf(badOffer);
      return badOffer.status === 'ambiguous' ? productAmbiguousResult(offerProductNames[idx], badOffer.candidates) : productNotFoundResult(offerProductNames[idx]);
    }

    let triggerResults = [];
    if (triggerProductNames?.length) {
      triggerResults = await Promise.all(triggerProductNames.map((n) => resolveProductByName(ctx.admin, n)));
      const badTrigger = triggerResults.find((r) => r.status !== 'found');
      if (badTrigger) {
        const idx = triggerResults.indexOf(badTrigger);
        return badTrigger.status === 'ambiguous' ? productAmbiguousResult(triggerProductNames[idx], badTrigger.candidates) : productNotFoundResult(triggerProductNames[idx]);
      }
    }

    // Full product records (id/title/handle/image/price), not bare ids — the
    // storefront renderer needs these fields to show a real title/image/price
    // instead of a blank card, and fbt_rules' real rows already store this
    // shape for manually-created rules.
    const toProductRecord = (r) => ({ id: r.id, title: r.title, handle: r.handle, image: r.image, price: r.price });

    // Deterministic server-side duplicate protection — prompt instructions
    // alone (guideline 15g) proved unreliable in live testing. A duplicate is
    // the same trigger scope + the same normalized trigger product ID set +
    // the same normalized offer product ID set; order never matters and
    // titles are never compared, only canonical Shopify IDs. This only
    // rejects an EXACT duplicate — a rule sharing the same trigger but a
    // different offer set (or vice versa) is a legitimate separate rule.
    const triggerScope = triggerResults.length ? 'specific_products' : 'all';
    const existingRules = await listActiveFbtRules(ctx.shop);
    const duplicate = existingRules.find((r) => (
      (r.trigger_scope || 'all') === triggerScope &&
      sameProductIdSet(r.trigger_products, triggerResults) &&
      sameProductIdSet(r.fbt_products, offerResults)
    ));
    if (duplicate) {
      return { success: false, error: 'DUPLICATE_RULE', existingRuleId: duplicate.id, message: 'An identical FBT rule already exists.' };
    }

    const { id: ruleId } = await appendFbtRule(ctx.shop, {
      name: `Rule ${Date.now()}`,
      triggerProducts: triggerResults.map(toProductRecord),
      offerProducts: offerResults.map(toProductRecord),
      discountType: discountType || 'none',
      discountValue: discountValue || 0,
    });
    if (template) await saveFbtWidgetSettings(ctx.shop, ctx.planKey, { selected_template: template });
    return { success: true, id: ruleId, offers: offerResults.map((r) => r.title), showsOn: triggerResults.length ? triggerResults.map((r) => r.title) : 'all product pages', ...(template ? { template } : {}) };
  },

  // Modifies an EXISTING FBT rule's trigger/offer products without deleting
  // and recreating it — the flow is strictly fetch existing row -> resolve
  // ALL supplied product names -> build the complete resulting product
  // lists -> validate (non-empty offers) -> only then write, so a single bad
  // product name (e.g. one typo in a multi-product add) can never result in
  // a partial write. triggerProductNames/offerProductNames are each the
  // COMPLETE desired final list for that role, not a delta — a role left out
  // of args entirely is preserved exactly as it currently is.
  async update_fbt_rule(ctx, { ruleId, triggerProductNames, offerProductNames }) {
    const existing = await fetchFbtRuleById(ctx.shop, ruleId);
    if (!existing) {
      return { success: false, error: 'RULE_NOT_FOUND', ruleId, message: 'The requested FBT rule was not found.' };
    }

    const hasTrigger = triggerProductNames !== undefined;
    const hasOffer = offerProductNames !== undefined;
    if (!hasTrigger && !hasOffer) {
      return { success: false, error: 'NO_FIELDS_TO_UPDATE', message: 'No FBT fields were provided for update.' };
    }

    const toProductRecord = (r) => ({ id: r.id, title: r.title, handle: r.handle, image: r.image, price: r.price });
    async function resolveNames(names) {
      const results = await Promise.all(names.map((n) => resolveProductByName(ctx.admin, n)));
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'not_found') return { failure: fbtProductNotFoundResult(names[i]) };
        if (results[i].status === 'ambiguous') return { failure: fbtProductAmbiguousResult(names[i], results[i].candidates) };
      }
      return { products: results.map(toProductRecord) };
    }

    let newTriggerProducts = existing.trigger_products || [];
    let newOfferProducts = existing.fbt_products || [];

    if (hasTrigger) {
      const resolved = await resolveNames(triggerProductNames);
      if (resolved.failure) return resolved.failure;
      newTriggerProducts = resolved.products;
    }
    if (hasOffer) {
      const resolved = await resolveNames(offerProductNames);
      if (resolved.failure) return resolved.failure;
      newOfferProducts = resolved.products;
    }

    // An FBT rule must never end up with zero offer products — reject the
    // update (no write) rather than silently deleting the rule; removing the
    // whole rule stays remove_fbt_rule's job, with its own confirmation flow.
    if (!newOfferProducts.length) {
      return { success: false, error: 'EMPTY_OFFER_PRODUCTS', message: 'An FBT rule must contain at least one offer product.' };
    }

    const triggerChanged = hasTrigger && !sameProductIdSet(newTriggerProducts, existing.trigger_products || []);
    const offerChanged = hasOffer && !sameProductIdSet(newOfferProducts, existing.fbt_products || []);

    if (!triggerChanged && !offerChanged) {
      return { success: true, changed: {}, unchanged: { ruleId } };
    }

    await updateFbtRuleRecord(ctx.shop, ruleId, {
      name: existing.name,
      triggerProducts: newTriggerProducts,
      offerProducts: newOfferProducts,
    });

    const changed = {};
    const unchanged = { ruleId };
    if (triggerChanged) changed.triggerProducts = newTriggerProducts.map((p) => p.title);
    else unchanged.triggerProducts = newTriggerProducts.map((p) => p.title);
    if (offerChanged) changed.offerProducts = newOfferProducts.map((p) => p.title);
    else unchanged.offerProducts = newOfferProducts.map((p) => p.title);

    return { success: true, changed, unchanged };
  },

  async remove_fbt_rule(ctx, { ruleId }) {
    const { removed } = await removeFbtRule(ctx.shop, ruleId);
    if (!removed) return { success: false, reason: 'not_found', message: `No FBT rule found with id ${ruleId}.` };
    return { success: true };
  },

  // ── Discounts ────────────────────────────────────────────────────────────
  async create_discount(ctx, { code, title, percentage, minimumAmount, endDate, usageLimit, onePerCustomer }) {
    const finalTitle = title || `${percentage}% Off Storewide`;
    const finalCode = (code || `SAVE${Math.round(percentage)}`).toUpperCase();
    const result = await createDiscount(ctx.admin, { code: finalCode, title: finalTitle, percentage, minimumAmount, endDate, usageLimit, onePerCustomer, currencyCode: ctx.currencyCode });
    if (!result.success) return { success: false, message: `Couldn't create discount: ${result.error}` };
    await persistLocalCopy(ctx.requestUrl, ctx.shop, { code: finalCode, title: finalTitle, percentage, minimumAmount, endDate, usageLimit, onePerCustomer, discountId: result.discountId });
    return {
      success: true, confirmMessage: `Discount code ${finalCode} (${percentage}% off) is live.`, code: finalCode, title: finalTitle, percentage,
      displayMinimumAmount: minimumAmount ? formatMoney(minimumAmount, { currencyCode: ctx.currencyCode, locale: ctx.currencyLocale }) : null,
    };
  },

  async delete_discount(ctx, { discountId }) {
    const result = await deleteDiscount(ctx.admin, discountId);
    if (!result.success) return { success: false, message: `Couldn't delete discount: ${result.error}` };
    return { success: true };
  },

  async list_active_promotions(ctx) {
    const discounts = await listActiveDiscounts(ctx.admin);
    return { discounts };
  },

  async create_free_shipping(ctx, { minimumAmount, title, countries }) {
    // displayAmount is presentation-only (real store currency, via the
    // central formatter) — the model should copy this into announcement
    // text rather than composing its own $-guess. The numeric minimumAmount
    // sent to Shopify's API is unaffected either way.
    const displayAmount = minimumAmount != null ? formatMoney(minimumAmount, { currencyCode: ctx.currencyCode, locale: ctx.currencyLocale }) : null;

    const discounts = await listActiveDiscounts(ctx.admin);
    const existing = findMatchingPromotion(discounts, { discountType: 'free_shipping', minimumAmount });
    if (existing) {
      return { success: true, confirmMessage: `You already have free shipping ${displayAmount ? `over ${displayAmount} ` : ''}active, so nothing new was needed.`, alreadyExisted: true, verified: true, promotionCreated: false, discountId: existing.id, minimumAmount: existing.minimumSubtotal, displayAmount };
    }

    const finalTitle = title || (minimumAmount ? `Free Shipping Over ${displayAmount || minimumAmount}` : 'Free Shipping');
    const result = await createAutomaticFreeShipping(ctx.admin, { title: finalTitle, minimumAmount, currencyCode: ctx.currencyCode, countries });
    if (!result.success) return { success: false, promotionCreated: false, message: `Couldn't create the free-shipping promotion: ${result.error}` };

    return {
      success: true, confirmMessage: `Free shipping is now live ${displayAmount ? `on orders over ${displayAmount}` : 'on every order'}. It applies automatically at checkout.`,
      promotionCreated: true, alreadyExisted: false,
      verified: result.status === 'ACTIVE', status: result.status,
      discountId: result.discountId, minimumAmount, displayAmount, title: finalTitle,
      currencyCode: ctx.currencyCode,
    };
  },

  async create_amount_off_promotion(ctx, { percentage, amountOff, minimumAmount, title }) {
    if (percentage == null && amountOff == null) {
      return { success: false, promotionCreated: false, message: 'Need either a percentage or a fixed amount off to create this promotion.' };
    }
    const discountType = amountOff != null ? 'fixed' : 'percentage';
    const discountValue = amountOff != null ? Number(amountOff) : Number(percentage);
    const displayValue = amountOff != null ? formatMoney(amountOff, { currencyCode: ctx.currencyCode, locale: ctx.currencyLocale }) : `${percentage}%`;
    const displayMinimumAmount = minimumAmount != null ? formatMoney(minimumAmount, { currencyCode: ctx.currencyCode, locale: ctx.currencyLocale }) : null;

    const discounts = await listActiveDiscounts(ctx.admin);
    const existing = findMatchingPromotion(discounts, { discountType, discountValue, minimumAmount });
    if (existing) {
      return { success: true, confirmMessage: `You already have ${displayValue} off${displayMinimumAmount ? ` orders over ${displayMinimumAmount}` : ''} active, so nothing new was needed.`, alreadyExisted: true, verified: true, promotionCreated: false, discountId: existing.id, discountType, discountValue, minimumAmount: existing.minimumSubtotal, displayValue, displayMinimumAmount };
    }

    const finalTitle = title || (amountOff != null ? `${displayValue} Off Storewide` : `${percentage}% Off Storewide`);
    const result = await createAutomaticAmountOff(ctx.admin, { title: finalTitle, percentage, amountOff, minimumAmount, currencyCode: ctx.currencyCode });
    if (!result.success) return { success: false, promotionCreated: false, message: `Couldn't create the discount: ${result.error}` };

    return {
      success: true, confirmMessage: `${displayValue} off${displayMinimumAmount ? ` orders over ${displayMinimumAmount}` : ' every order'} is now live. It applies automatically at checkout.`,
      promotionCreated: true, alreadyExisted: false,
      verified: result.status === 'ACTIVE', status: result.status,
      discountId: result.discountId, discountType, discountValue, minimumAmount, displayValue, displayMinimumAmount, title: finalTitle,
      currencyCode: ctx.currencyCode,
    };
  },

  // ── Combo Forge ──────────────────────────────────────────────────────────
  async create_combo_template(ctx, { layout, collectionName, discountPercentage, templateName: requestedName }) {
    const gateError = await checkComboPlanGate(ctx.shop);
    if (gateError) return { success: false, reason: 'locked', message: gateError.error };

    // Only the decisions that shape the combo are asked, one at a time; the
    // page name is not (it defaults from the collection below).
    if (!layout) return needsInfo('layout', 'Ask the merchant which combo layout they want: Guided Architect (step-by-step), Velocity Stream (tab switcher), or Editorial Split (single grid). Then call this tool again.', CHOICES.comboLayout);
    if (!String(collectionName ?? '').trim()) return needsInfo('collection', 'Ask the merchant which collection the combo should pull its products from. Then call this tool again.');
    if (discountPercentage === undefined || discountPercentage === null) return needsInfo('discount', 'Ask the merchant whether the combo should have a discount, and how much (0 for none). Then call this tool again.', CHOICES.comboDiscount);

    const collection = await resolveCollectionByName(ctx.admin, collectionName);
    if (collection.status === 'not_found') return { success: false, reason: 'not_found', message: `No collection found matching "${collectionName}".` };
    if (collection.status === 'ambiguous') return { success: false, reason: 'ambiguous', message: `Multiple collections match "${collectionName}" — ask the merchant which one.`, candidates: collection.candidates.map(c => c.title) };

    const templateName = String(requestedName ?? '').trim() || `${collection.title} Combo`;
    const collectionField = layout === 'layout1' ? 'step_1_collection' : 'col_1';
    const customization = {
      layout,
      [collectionField]: collection.handle,
      collection_title: templateName,
      ...(discountPercentage > 0 ? { has_discount_offer: true, discount_percentage: discountPercentage } : {}),
    };
    const id = await createComboTemplate(ctx.shop, {
      name: templateName, template_type: layout, status: 'draft', is_active: 0,
      customization_data: JSON.stringify(customization),
    });
    return { success: true, id, name: templateName, collection: collection.title };
  },

  // ── Theme ────────────────────────────────────────────────────────────────
  async match_store_theme(ctx) {
    const theme = await detectStoreTheme(ctx.admin, ctx.session);
    if (!theme) return { success: false, message: 'Could not detect theme colors automatically. Ask the merchant for specific color codes and apply them directly instead.' };

    await saveCartDrawerConfig(ctx.shop, ctx.planKey, {
      header_bg_color: theme.headerBgColor, header_text_color: theme.headerTextColor,
      checkout_button_bg_color: theme.checkoutBgColor, checkout_button_text_color: theme.checkoutTextColor,
    });
    await syncCheckoutButtonToLegacyRecord(ctx.shop, { bgColor: theme.checkoutBgColor, textColor: theme.checkoutTextColor });
    return { success: true, theme };
  },

  // Read-only — proposes 4 complete color combos for api.ai.chat.jsx's widget
  // short-circuit to render as clickable swatches (one full combo applied per
  // click). Writes nothing; see apply_theme_colors for the counterpart that
  // actually saves whichever combo the merchant picks.
  async suggest_theme_colors(ctx) {
    const detected = await detectStoreTheme(ctx.admin, ctx.session);
    let base = detected;

    if (!base) {
      // Detection failed — fall back to the shop's currently-saved colors so
      // suggestions still start from something real, not a hardcoded default.
      const db = getDb();
      const [rows] = await db.execute('SELECT * FROM cart_drawer_config WHERE shop_domain = ? LIMIT 1', [ctx.shop]);
      const cdc = rows[0];
      base = {
        headerBgColor: cdc?.header_bg_color || '#f9fafb',
        headerTextColor: cdc?.header_text_color || '#000000',
        checkoutBgColor: cdc?.checkout_button_bg_color || '#111827',
        checkoutTextColor: cdc?.checkout_button_text_color || '#ffffff',
      };
    }

    return { success: true, palettes: buildPaletteOptions(base) };
  },

  async apply_theme_colors(ctx, args) {
    const data = await saveCartDrawerConfig(ctx.shop, ctx.planKey, {
      header_bg_color: args.headerBgColor, header_text_color: args.headerTextColor,
      checkout_button_bg_color: args.checkoutBgColor, checkout_button_text_color: args.checkoutTextColor,
    });
    if (args.checkoutBgColor !== undefined || args.checkoutTextColor !== undefined) {
      await syncCheckoutButtonToLegacyRecord(ctx.shop, { bgColor: args.checkoutBgColor, textColor: args.checkoutTextColor });
    }
    return {
      success: true,
      theme: {
        headerBgColor: data.header_bg_color, headerTextColor: data.header_text_color,
        checkoutBgColor: data.checkout_button_bg_color, checkoutTextColor: data.checkout_button_text_color,
      },
    };
  },
};
