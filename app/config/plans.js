// Single source of truth for pricing plans and feature gating.
// Server and client code both import this file directly (no secrets here).
// To add a plan or feature: edit this file only — do not hardcode plan
// names or feature availability anywhere else in the app.

export const PLAN_KEYS = ['free', 'lite', 'starter', 'growth', 'pro'];

// Every plan has every feature: plans differ only in how many orders a month
// they include (orders = every paid order the store gets that month, not only
// the ones a BRIX feature touched; see countBillableOrder in
// services/billable-orders.server.js), AI BRIX credits and the watermark.
// `ordersUpTo` is the top of the plan's order range on the plan page
// (Free 1-50, Lite 51-200, Starter 201-500, Growth 501-1000, Pro 1001-2000);
// `orderCap` is what's enforced: past it Free pauses the storefront widgets,
// a monthly paid plan bills `overageRate` per extra order (a yearly one
// pauses), and Pro (null) has no cap yet: pricing above 2000 isn't decided.
export const PLANS = {
  free: {
    key: 'free',
    label: 'Free',
    tagline: 'Launch & learn',
    price: { monthly: 0, annual: 0 },
    rank: 0,
    ordersUpTo: 50,
    orderCap: 50,
    overageRate: 0,
    aiBrixCredits: 10,
    aiBrixOverageRate: 0.10,
    comboTemplateLimit: null,
    watermarkRemovable: false,
  },
  lite: {
    key: 'lite',
    label: 'Lite',
    tagline: 'Your first sales',
    price: { monthly: 9, annual: 90 },
    rank: 1,
    ordersUpTo: 200,
    orderCap: 200,
    overageRate: 0.10,
    aiBrixCredits: 20,
    aiBrixOverageRate: 0.05,
    comboTemplateLimit: null,
    watermarkRemovable: true,
  },
  starter: {
    key: 'starter',
    label: 'Starter',
    tagline: 'Grow your AOV',
    price: { monthly: 29, annual: 290 },
    rank: 2,
    ordersUpTo: 500,
    orderCap: 500,
    overageRate: 0.03,
    aiBrixCredits: 30,
    aiBrixOverageRate: 0.03,
    comboTemplateLimit: null,
    watermarkRemovable: true,
  },
  growth: {
    key: 'growth',
    label: 'Growth',
    tagline: 'Scaling stores',
    price: { monthly: 59, annual: 590 },
    rank: 3,
    ordersUpTo: 1000,
    orderCap: 1000,
    overageRate: 0.02,
    aiBrixCredits: 60,
    aiBrixOverageRate: 0.02,
    comboTemplateLimit: null,
    watermarkRemovable: true,
  },
  pro: {
    key: 'pro',
    label: 'Pro',
    tagline: 'High-volume brands',
    price: { monthly: 79, annual: 790 },
    rank: 4,
    ordersUpTo: 2000,
    orderCap: null,
    overageRate: 0,
    aiBrixCredits: 90,
    aiBrixOverageRate: 0.01,
    comboTemplateLimit: null,
    watermarkRemovable: true,
  },
};

// state: 'enabled' | 'preview' | 'locked'
// - enabled: open, save, and publish to storefront
// - preview: open and save, but must NOT render on the storefront
// - locked: editing disabled, show upgrade prompt
// Every feature is 'enabled' on every plan; the states (and the gates that
// read them) stay so a feature can be limited to some plans again later.
const EVERY_PLAN = Object.freeze(Object.fromEntries(PLAN_KEYS.map((key) => [key, 'enabled'])));

export const FEATURES = {
  cart_drawer:              { label: 'Cart Drawer',                     states: EVERY_PLAN },
  announcement_bar:         { label: 'Announcement Bar',                states: EVERY_PLAN },
  empty_cart_customization: { label: 'Empty Cart Customization',        states: EVERY_PLAN },
  ai_brix:                  { label: 'AI BRIX',                         states: EVERY_PLAN }, // credit-limited, see aiBrixCredits; pay-as-you-go past the cap, see aiBrixOverageRate

  fbt:                      { label: 'Frequently Bought Together',      states: EVERY_PLAN },
  packs:                    { label: 'Packs',                           states: EVERY_PLAN },
  cod_checkout:             { label: 'COD Checkout',                    states: EVERY_PLAN },
  coupon_lock_pro:          { label: 'Coupon Banner',                   states: EVERY_PLAN },

  progress_bar:             { label: 'Progress Bar',                   states: EVERY_PLAN },
  ai_cart_upsell:           { label: 'AI Cart Upsell',                 states: EVERY_PLAN },
  full_analytics:           { label: 'Full Analytics',                 states: EVERY_PLAN },
  confetti:                 { label: 'Confetti',                       states: EVERY_PLAN },
  mobile_swipe_checkout:    { label: 'Mobile Swipe Checkout',          states: EVERY_PLAN },
  build_a_combo:            { label: 'Build a Combo',                  states: EVERY_PLAN }, // count-limited, see comboTemplateLimit (null = unlimited)
  open_countdown:           { label: 'Open Countdown',                 states: EVERY_PLAN },
  custom_css:               { label: 'Custom CSS',                     states: EVERY_PLAN },
  priority_email_support:   { label: 'Priority Email Support',         states: EVERY_PLAN },
  ai_support_247:           { label: '24/7 AI Support',                states: EVERY_PLAN },

  ai_analytics:             { label: 'AI Analytics',                   states: EVERY_PLAN },
  advanced_ai_analytics:    { label: 'Advanced AI Analytics',          states: EVERY_PLAN },
  unlimited_ai_agents:      { label: 'Unlimited AI Agents',            states: EVERY_PLAN },
  // The three box combo templates (Build a Combo picker), see boxPricingFeature in combo-weight.shared.js.
  combo_quantity_pricing:   { label: 'Quantity Box combos',            states: EVERY_PLAN },
  combo_weight_pricing:     { label: 'Weight Box combos',              states: EVERY_PLAN },
  combo_value_pricing:      { label: 'Value Box combos',               states: EVERY_PLAN },
  combo_tier_pricing:       { label: 'Tiered pricing on older Classic combos', states: EVERY_PLAN }, // Guided / Velocity / Editorial combos made before the box templates
};

export function isValidPlanKey(key) {
  return PLAN_KEYS.includes(key);
}

export function getFeatureState(planKey, featureKey) {
  const plan = PLANS[planKey] ? planKey : 'free';
  const feature = FEATURES[featureKey];
  if (!feature) return 'locked';
  return feature.states[plan] ?? 'locked';
}

export function canAccessFeature(planKey, featureKey) {
  const state = getFeatureState(planKey, featureKey);
  return state === 'enabled' || state === 'preview';
}

export function canPublishFeature(planKey, featureKey) {
  return getFeatureState(planKey, featureKey) === 'enabled';
}

export function canPreviewFeature(planKey, featureKey) {
  return getFeatureState(planKey, featureKey) === 'preview';
}

// Lowest plan key that has this feature 'enabled' (fully live/publishable).
export function getMinPlanForFeature(featureKey) {
  for (const key of PLAN_KEYS) {
    if (FEATURES[featureKey]?.states[key] === 'enabled') return key;
  }
  return null;
}

// Note: several of these fields are legitimately `null` (meaning
// "unlimited"/"no cap") — resolve via an explicit valid-plan check rather
// than `??`, which would treat that intentional `null` as missing and wrongly
// fall back to the Free limit.
function resolvePlan(planKey) {
  return isValidPlanKey(planKey) ? PLANS[planKey] : PLANS.free;
}

export function getAiBrixCreditLimit(planKey) {
  return resolvePlan(planKey).aiBrixCredits;
}

export function getAiBrixOverageRate(planKey) {
  return resolvePlan(planKey).aiBrixOverageRate;
}

export function getComboTemplateLimit(planKey) {
  return resolvePlan(planKey).comboTemplateLimit;
}

export function getOrderCap(planKey) {
  return resolvePlan(planKey).orderCap;
}

// The plan's order range for the plan page: { from, to } (Lite = 51-200).
export function getOrderRange(planKey) {
  const plan = resolvePlan(planKey);
  const prev = PLANS[PLAN_KEYS[PLAN_KEYS.indexOf(plan.key) - 1]];
  return { from: prev ? prev.ordersUpTo + 1 : 1, to: plan.ordersUpTo };
}

export function getOverageRate(planKey) {
  return resolvePlan(planKey).overageRate;
}

// A day's orders past the plan's monthly cap: the ones that took the month
// over it (a 500-order plan at 480 orders before the day and 30 that day = 10).
// `monthToDate` includes the day's own orders. Used by the daily overage job.
export function dayOverageOrders(monthToDate, dayOrders, orderCap) {
  if (orderCap === null || orderCap === undefined) return 0;
  return Math.max(0, monthToDate - orderCap) - Math.max(0, monthToDate - dayOrders - orderCap);
}

// ── Billing interval (monthly | annual) ──
// Paid plans can be billed every 30 days or yearly (price.annual = 10 ×
// monthly, two months free), both with the same 14-day trial. Shopify doesn't allow usage charges on a yearly subscription, so
// a yearly plan can't bill per-order or AI BRIX overage: past the monthly
// order cap its storefront widgets pause until next month (like Free; Pro has
// no cap), and AI BRIX stops at the monthly credits. Mirrored by
// plan_order_cap_exceeded in php_backend/plan_helpers.php.
export const BILLING_INTERVALS = ['monthly', 'annual'];
export const TRIAL_DAYS = 14;

export function normalizeBillingInterval(value) {
  return /annual|year/i.test(String(value || '')) ? 'annual' : 'monthly';
}

// Whether this plan bills per-order / AI credit overage (Shopify usage charges).
export function billsUsage(interval) {
  return normalizeBillingInterval(interval) !== 'annual';
}

// Past the monthly order cap: 'charge' (overage billed), 'pause' (storefront
// widgets pause until next month) or 'none' (no cap).
export function orderCapBehavior(planKey, interval) {
  const plan = resolvePlan(planKey);
  if (plan.orderCap === null) return 'none';
  return plan.overageRate > 0 && billsUsage(interval) ? 'charge' : 'pause';
}

// Whether one more AI BRIX credit may be used: past the monthly credits only
// plans that bill usage keep going (charged per credit).
export function aiCreditAllowed(planKey, interval, creditsUsed) {
  return billsUsage(interval) || creditsUsed < resolvePlan(planKey).aiBrixCredits;
}

// Trial length for a new subscription, monthly or yearly: a redeemed promo
// code's length, else the standard 14 days.
export function trialDaysFor(promoTrialDays = 0) {
  const promo = Number(promoTrialDays) || 0;
  return promo > 0 ? promo : TRIAL_DAYS;
}
