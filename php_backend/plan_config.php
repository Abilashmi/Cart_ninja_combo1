<?php
/**
 * PHP mirror of app/config/plans.js — the single source of truth for
 * pricing plans and feature gating, transcribed for use by PHP endpoints
 * (which are the actual storefront-facing choke points and cannot import
 * Node code).
 *
 * IMPORTANT: keep this file structurally identical to app/config/plans.js.
 * Any change to plan tiers, prices, caps, or feature states must be made
 * in BOTH files.
 */

const PLAN_KEYS = ['free', 'lite', 'starter', 'growth', 'pro', 'scale', 'enterprise'];

// Every plan has every feature; plans differ by orders a month. orderCap is
// a hard limit: past it the storefront widgets pause until next month. No
// plan bills extra orders (overageRate 0 everywhere). Enterprise has no cap.
const PLANS = [
    'free' => [
        'key' => 'free',
        'label' => 'Free',
        'orderCap' => 50,
        'overageRate' => 0.0,
        'aiBrixCredits' => 10,
        'comboTemplateLimit' => null,
        'watermarkRemovable' => false,
    ],
    'lite' => [
        'key' => 'lite',
        'label' => 'Lite',
        'orderCap' => 250,
        'overageRate' => 0.0,
        'aiBrixCredits' => 20,
        'comboTemplateLimit' => null,
        'watermarkRemovable' => true,
    ],
    'starter' => [
        'key' => 'starter',
        'label' => 'Starter',
        'orderCap' => 500,
        'overageRate' => 0.0,
        'aiBrixCredits' => 30,
        'comboTemplateLimit' => null,
        'watermarkRemovable' => true,
    ],
    'growth' => [
        'key' => 'growth',
        'label' => 'Growth',
        'orderCap' => 2000,
        'overageRate' => 0.0,
        'aiBrixCredits' => 60,
        'comboTemplateLimit' => null,
        'watermarkRemovable' => true,
    ],
    'pro' => [
        'key' => 'pro',
        'label' => 'Pro',
        'orderCap' => 5000,
        'overageRate' => 0.0,
        'aiBrixCredits' => 90,
        'comboTemplateLimit' => null,
        'watermarkRemovable' => true,
    ],
    'scale' => [
        'key' => 'scale',
        'label' => 'Scale',
        'orderCap' => 10000,
        'overageRate' => 0.0,
        'aiBrixCredits' => 120,
        'comboTemplateLimit' => null,
        'watermarkRemovable' => true,
    ],
    'enterprise' => [
        'key' => 'enterprise',
        'label' => 'Enterprise',
        'orderCap' => null,
        'overageRate' => 0.0,
        'aiBrixCredits' => 200,
        'comboTemplateLimit' => null,
        'watermarkRemovable' => true,
    ],
];

// state: 'enabled' | 'preview' | 'locked'. Every feature is 'enabled' on
// every plan; the states stay so a feature can be limited again later.
const EVERY_PLAN = ['free' => 'enabled', 'lite' => 'enabled', 'starter' => 'enabled', 'growth' => 'enabled', 'pro' => 'enabled', 'scale' => 'enabled', 'enterprise' => 'enabled'];

const FEATURES = [
    'cart_drawer'              => EVERY_PLAN,
    'announcement_bar'         => EVERY_PLAN,
    'empty_cart_customization' => EVERY_PLAN,
    'ai_brix'                  => EVERY_PLAN,
    'fbt'                      => EVERY_PLAN,
    'coupon_lock_pro'          => EVERY_PLAN,
    'progress_bar'             => EVERY_PLAN,
    'ai_cart_upsell'           => EVERY_PLAN,
    'full_analytics'           => EVERY_PLAN,
    'confetti'                 => EVERY_PLAN,
    'mobile_swipe_checkout'    => EVERY_PLAN,
    'build_a_combo'            => EVERY_PLAN,
    'packs'                    => EVERY_PLAN,
    'cod_checkout'             => EVERY_PLAN,
    'open_countdown'           => EVERY_PLAN,
    'custom_css'               => EVERY_PLAN,
    'priority_email_support'   => EVERY_PLAN,
    'ai_support_247'           => EVERY_PLAN,
    'ai_analytics'             => EVERY_PLAN,
    'advanced_ai_analytics'    => EVERY_PLAN,
    'unlimited_ai_agents'      => EVERY_PLAN,
    'combo_quantity_pricing'   => EVERY_PLAN,
    'combo_weight_pricing'     => EVERY_PLAN,
    'combo_value_pricing'      => EVERY_PLAN,
    'combo_tier_pricing'       => EVERY_PLAN,
];

function plan_is_valid_key($key) {
    return in_array($key, PLAN_KEYS, true);
}

function plan_get_feature_state($planKey, $featureKey) {
    $plan = plan_is_valid_key($planKey) ? $planKey : 'free';
    if (!isset(FEATURES[$featureKey])) return 'locked';
    return FEATURES[$featureKey][$plan] ?? 'locked';
}

function plan_can_access_feature($planKey, $featureKey) {
    $state = plan_get_feature_state($planKey, $featureKey);
    return $state === 'enabled' || $state === 'preview';
}

function plan_can_publish_feature($planKey, $featureKey) {
    return plan_get_feature_state($planKey, $featureKey) === 'enabled';
}

function plan_can_preview_feature($planKey, $featureKey) {
    return plan_get_feature_state($planKey, $featureKey) === 'preview';
}

function plan_get_config($planKey) {
    $plan = plan_is_valid_key($planKey) ? $planKey : 'free';
    return PLANS[$plan];
}
