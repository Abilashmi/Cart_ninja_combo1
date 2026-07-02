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

const PLAN_KEYS = ['free', 'starter', 'pro'];

const PLANS = [
    'free' => [
        'key' => 'free',
        'label' => 'Free',
        'orderCap' => 50,
        'overageRate' => 0.30,
        'aiBrixCredits' => 10,
        'comboTemplateLimit' => 0,
        'watermarkRemovable' => false,
    ],
    'starter' => [
        'key' => 'starter',
        'label' => 'Starter',
        'orderCap' => 500,
        'overageRate' => 0.10,
        'aiBrixCredits' => 30,
        'comboTemplateLimit' => 3,
        'watermarkRemovable' => true,
    ],
    'pro' => [
        'key' => 'pro',
        'label' => 'Pro',
        'orderCap' => null,
        'overageRate' => 0.0,
        'aiBrixCredits' => null,
        'comboTemplateLimit' => null,
        'watermarkRemovable' => true,
    ],
];

// state: 'enabled' | 'preview' | 'locked'
const FEATURES = [
    'cart_drawer'              => ['free' => 'enabled', 'starter' => 'enabled', 'pro' => 'enabled'],
    'announcement_bar'         => ['free' => 'enabled', 'starter' => 'enabled', 'pro' => 'enabled'],
    'empty_cart_customization' => ['free' => 'enabled', 'starter' => 'enabled', 'pro' => 'enabled'],
    'ai_brix'                  => ['free' => 'enabled', 'starter' => 'enabled', 'pro' => 'enabled'],

    'fbt'                      => ['free' => 'preview', 'starter' => 'enabled', 'pro' => 'enabled'],
    'coupon_lock_pro'          => ['free' => 'preview', 'starter' => 'enabled', 'pro' => 'enabled'],

    'progress_bar'             => ['free' => 'locked', 'starter' => 'enabled', 'pro' => 'enabled'],
    'ai_cart_upsell'           => ['free' => 'locked', 'starter' => 'enabled', 'pro' => 'enabled'],
    'full_analytics'           => ['free' => 'locked', 'starter' => 'enabled', 'pro' => 'enabled'],
    'confetti'                 => ['free' => 'locked', 'starter' => 'enabled', 'pro' => 'enabled'],
    'mobile_swipe_checkout'    => ['free' => 'locked', 'starter' => 'enabled', 'pro' => 'enabled'],
    'build_a_combo'            => ['free' => 'locked', 'starter' => 'enabled', 'pro' => 'enabled'],
    'open_countdown'           => ['free' => 'locked', 'starter' => 'enabled', 'pro' => 'enabled'],
    'custom_css'               => ['free' => 'locked', 'starter' => 'enabled', 'pro' => 'enabled'],
    'priority_email_support'   => ['free' => 'locked', 'starter' => 'enabled', 'pro' => 'enabled'],
    'ai_support_247'           => ['free' => 'locked', 'starter' => 'enabled', 'pro' => 'enabled'],

    'ai_analytics'             => ['free' => 'locked', 'starter' => 'locked', 'pro' => 'enabled'],
    'advanced_ai_analytics'    => ['free' => 'locked', 'starter' => 'locked', 'pro' => 'enabled'],
    'unlimited_ai_agents'      => ['free' => 'locked', 'starter' => 'locked', 'pro' => 'enabled'],
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
