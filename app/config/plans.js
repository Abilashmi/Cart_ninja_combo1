// Single source of truth for pricing plans and feature gating.
// Server and client code both import this file directly (no secrets here).
// To add a plan or feature: edit this file only — do not hardcode plan
// names or feature availability anywhere else in the app.

export const PLAN_KEYS = ['free', 'starter', 'pro'];

export const PLANS = {
  free: {
    key: 'free',
    label: 'Free',
    tagline: 'Launch & learn',
    price: { monthly: 0, annual: 0 },
    rank: 0,
    orderCap: 50,
    overageRate: 0.30,
    aiBrixCredits: 10,
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
    overageRate: 0.10,
    aiBrixCredits: 30,
    comboTemplateLimit: 3,
    watermarkRemovable: true,
  },
  pro: {
    key: 'pro',
    label: 'Pro',
    tagline: 'High-volume brands',
    price: { monthly: 79, annual: 790 },
    rank: 2,
    orderCap: null,
    overageRate: 0,
    aiBrixCredits: null,
    comboTemplateLimit: null,
    watermarkRemovable: true,
  },
};

// state: 'enabled' | 'preview' | 'locked'
// - enabled: open, save, and publish to storefront
// - preview: open and save, but must NOT render on the storefront
// - locked: editing disabled, show upgrade prompt
export const FEATURES = {
  cart_drawer:              { label: 'Cart Drawer',                     states: { free: 'enabled', starter: 'enabled', pro: 'enabled' } },
  announcement_bar:         { label: 'Announcement Bar',                states: { free: 'enabled', starter: 'enabled', pro: 'enabled' } },
  empty_cart_customization: { label: 'Empty Cart Customization',        states: { free: 'enabled', starter: 'enabled', pro: 'enabled' } },
  ai_brix:                  { label: 'AI BRIX',                         states: { free: 'enabled', starter: 'enabled', pro: 'enabled' } }, // credit-limited, see aiBrixCredits

  fbt:                      { label: 'Frequently Bought Together',      states: { free: 'preview', starter: 'enabled', pro: 'enabled' } },
  coupon_lock_pro:          { label: 'Coupon Lock Pro',                 states: { free: 'preview', starter: 'enabled', pro: 'enabled' } },

  progress_bar:             { label: 'Progress Bar',                   states: { free: 'locked', starter: 'enabled', pro: 'enabled' } },
  ai_cart_upsell:           { label: 'AI Cart Upsell',                 states: { free: 'locked', starter: 'enabled', pro: 'enabled' } },
  full_analytics:           { label: 'Full Analytics',                 states: { free: 'locked', starter: 'enabled', pro: 'enabled' } },
  confetti:                 { label: 'Confetti',                       states: { free: 'locked', starter: 'enabled', pro: 'enabled' } },
  mobile_swipe_checkout:    { label: 'Mobile Swipe Checkout',          states: { free: 'locked', starter: 'enabled', pro: 'enabled' } },
  build_a_combo:            { label: 'Build a Combo',                  states: { free: 'locked', starter: 'enabled', pro: 'enabled' } }, // count-limited, see comboTemplateLimit
  open_countdown:           { label: 'Open Countdown',                 states: { free: 'locked', starter: 'enabled', pro: 'enabled' } },
  custom_css:                { label: 'Custom CSS',                    states: { free: 'locked', starter: 'enabled', pro: 'enabled' } },
  priority_email_support:   { label: 'Priority Email Support',         states: { free: 'locked', starter: 'enabled', pro: 'enabled' } },
  ai_support_247:           { label: '24/7 AI Support',                states: { free: 'locked', starter: 'enabled', pro: 'enabled' } },

  ai_analytics:              { label: 'AI Analytics',                  states: { free: 'locked', starter: 'locked', pro: 'enabled' } },
  advanced_ai_analytics:     { label: 'Advanced AI Analytics',         states: { free: 'locked', starter: 'locked', pro: 'enabled' } },
  unlimited_ai_agents:       { label: 'Unlimited AI Agents',           states: { free: 'locked', starter: 'locked', pro: 'enabled' } },
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

export function getComboTemplateLimit(planKey) {
  return resolvePlan(planKey).comboTemplateLimit;
}

export function getOrderCap(planKey) {
  return resolvePlan(planKey).orderCap;
}

export function getOverageRate(planKey) {
  return resolvePlan(planKey).overageRate;
}
