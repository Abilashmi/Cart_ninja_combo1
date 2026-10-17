// Single source of truth for pricing plans and feature gating.
// Server and client code both import this file directly (no secrets here).
// To add a plan or feature: edit this file only — do not hardcode plan
// names or feature availability anywhere else in the app.

export const PLAN_KEYS = ['free', 'starter', 'growth', 'pro'];

export const PLANS = {
  free: {
    key: 'free',
    label: 'Free',
    tagline: 'Launch & learn',
    price: { monthly: 0, annual: 0 },
    rank: 0,
    // Free has no order cap — unlimited orders, same as Pro (see
    // plan_order_cap_exceeded in php_backend/plan_helpers.php, which
    // already treats a null orderCap as never-exceeded).
    orderCap: null,
    overageRate: 0,
    aiBrixCredits: 10,
    aiBrixOverageRate: 0.10,
    comboTemplateLimit: 0,
    watermarkRemovable: false,
  },
  starter: {
    key: 'starter',
    label: 'Starter',
    tagline: 'Grow your AOV',
    price: { monthly: 29, annual: 290 },
    rank: 1,
    orderCap: 500,
    overageRate: 0.03,
    aiBrixCredits: 30,
    aiBrixOverageRate: 0.03,
    comboTemplateLimit: 3,
    watermarkRemovable: true,
  },
  growth: {
    key: 'growth',
    label: 'Growth',
    tagline: 'Weight & value boxes',
    price: { monthly: 59, annual: 590 },
    rank: 2,
    orderCap: 1000,
    overageRate: 0.02,
    aiBrixCredits: 60,
    aiBrixOverageRate: 0.02,
    comboTemplateLimit: 10,
    watermarkRemovable: true,
  },
  pro: {
    key: 'pro',
    label: 'Pro',
    tagline: 'High-volume brands',
    price: { monthly: 79, annual: 790 },
    rank: 3,
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
export const FEATURES = {
  cart_drawer:              { label: 'Cart Drawer',                     states: { free: 'enabled', starter: 'enabled', growth: 'enabled', pro: 'enabled' } },
  announcement_bar:         { label: 'Announcement Bar',                states: { free: 'enabled', starter: 'enabled', growth: 'enabled', pro: 'enabled' } },
  empty_cart_customization: { label: 'Empty Cart Customization',        states: { free: 'enabled', starter: 'enabled', growth: 'enabled', pro: 'enabled' } },
  ai_brix:                  { label: 'AI BRIX',                         states: { free: 'enabled', starter: 'enabled', growth: 'enabled', pro: 'enabled' } }, // credit-limited, see aiBrixCredits; pay-as-you-go past the cap, see aiBrixOverageRate

  fbt:                      { label: 'Frequently Bought Together',      states: { free: 'preview', starter: 'enabled', growth: 'enabled', pro: 'enabled' } },
  packs:                    { label: 'Packs',                           states: { free: 'preview', starter: 'enabled', growth: 'enabled', pro: 'enabled' } },
  cod_checkout:             { label: 'COD Checkout',                    states: { free: 'preview', starter: 'enabled', growth: 'enabled', pro: 'enabled' } },
  coupon_lock_pro:        { label: 'Coupon Banner',                   states: { free: 'preview', starter: 'enabled', growth: 'enabled', pro: 'enabled' } },

  progress_bar:             { label: 'Progress Bar',                   states: { free: 'preview', starter: 'enabled', growth: 'enabled', pro: 'enabled' } },
  ai_cart_upsell:           { label: 'AI Cart Upsell',                 states: { free: 'preview', starter: 'enabled', growth: 'enabled', pro: 'enabled' } },
  full_analytics:           { label: 'Full Analytics',                 states: { free: 'locked', starter: 'enabled', growth: 'enabled', pro: 'enabled' } },
  confetti:                 { label: 'Confetti',                       states: { free: 'preview', starter: 'enabled', growth: 'enabled', pro: 'enabled' } },
  mobile_swipe_checkout:    { label: 'Mobile Swipe Checkout',          states: { free: 'preview', starter: 'enabled', growth: 'enabled', pro: 'enabled' } },
  build_a_combo:            { label: 'Build a Combo',                  states: { free: 'locked', starter: 'enabled', growth: 'enabled', pro: 'enabled' } }, // count-limited, see comboTemplateLimit
  open_countdown:           { label: 'Open Countdown',                 states: { free: 'preview', starter: 'enabled', growth: 'enabled', pro: 'enabled' } },
  custom_css:                { label: 'Custom CSS',                    states: { free: 'preview', starter: 'enabled', growth: 'enabled', pro: 'enabled' } },
  priority_email_support:   { label: 'Priority Email Support',         states: { free: 'locked', starter: 'enabled', growth: 'enabled', pro: 'enabled' } },
  ai_support_247:           { label: '24/7 AI Support',                states: { free: 'locked', starter: 'enabled', growth: 'enabled', pro: 'enabled' } },

  ai_analytics:              { label: 'AI Analytics',                  states: { free: 'locked', starter: 'locked', growth: 'locked', pro: 'enabled' } },
  advanced_ai_analytics:     { label: 'Advanced AI Analytics',         states: { free: 'locked', starter: 'locked', growth: 'locked', pro: 'enabled' } },
  unlimited_ai_agents:       { label: 'Unlimited AI Agents',           states: { free: 'locked', starter: 'locked', growth: 'locked', pro: 'enabled' } },
  // The three box combo templates (Build a Combo picker), see boxPricingFeature in combo-weight.shared.js.
  combo_quantity_pricing:    { label: 'Quantity Box combos',           states: { free: 'locked', starter: 'enabled', growth: 'enabled', pro: 'enabled' } },
  combo_weight_pricing:      { label: 'Weight Box combos',             states: { free: 'locked', starter: 'locked', growth: 'enabled', pro: 'enabled' } },
  combo_value_pricing:       { label: 'Value Box combos',              states: { free: 'locked', starter: 'locked', growth: 'enabled', pro: 'enabled' } },
  combo_tier_pricing:        { label: 'Tiered pricing on older Classic combos', states: { free: 'locked', starter: 'locked', growth: 'enabled', pro: 'enabled' } }, // Guided / Velocity / Editorial combos made before the box templates
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

// Note: several of these fields are legitimately `null` on Pro (meaning
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

export function getOverageRate(planKey) {
  return resolvePlan(planKey).overageRate;
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
