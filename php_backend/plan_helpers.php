<?php
require_once __DIR__ . '/plan_config.php';

/**
 * PHP-side plan resolution, mirroring app/services/plan-permissions.server.js.
 * This is the actual gate for storefront-facing endpoints (FBT, coupon
 * slider, cart drawer GET handlers) since those are hit directly by the
 * storefront via the Shopify App Proxy and cannot go through Node.
 */

function plan_ensure_columns($pdo) {
    static $ensured = false;
    if ($ensured) return;

    $existingCols = array_column(
        $pdo->query("SHOW COLUMNS FROM shops")->fetchAll(PDO::FETCH_ASSOC),
        'Field'
    );

    $alterations = [];
    if (!in_array('plan_key', $existingCols)) {
        $alterations[] = "ADD COLUMN `plan_key` VARCHAR(20) NOT NULL DEFAULT 'free'";
    }
    if (!in_array('pending_plan_key', $existingCols)) {
        $alterations[] = "ADD COLUMN `pending_plan_key` VARCHAR(20) NULL DEFAULT NULL";
    }
    if (!empty($alterations)) {
        $pdo->exec("ALTER TABLE shops " . implode(', ', $alterations));
    }

    $ensured = true;
}

function plan_alias_legacy_plan_name($planName) {
    if (!$planName) return 'free';
    $normalized = strtolower($planName);
    if ($normalized === 'free') return 'free';
    if (strpos($normalized, 'pro') !== false) return 'pro';
    return 'starter';
}

/**
 * Resolves a shop domain to its canonical plan key ('free'|'starter'|'pro').
 * Reads shops.plan_key first, falling back to alias-mapping the legacy
 * plan_name for rows that predate the plan_key column.
 */
function resolve_plan_key($pdo, $shopDomain) {
    if (!$shopDomain) return 'free';

    plan_ensure_columns($pdo);

    $stmt = $pdo->prepare("SELECT plan_key, plan_name FROM shops WHERE shop_domain = :shop LIMIT 1");
    $stmt->execute([':shop' => $shopDomain]);
    $row = $stmt->fetch();

    if (!$row) return 'free';

    if (!empty($row['plan_key']) && plan_is_valid_key($row['plan_key'])) {
        return $row['plan_key'];
    }

    return plan_alias_legacy_plan_name($row['plan_name'] ?? null);
}

/**
 * Whether this shop's plan enforces a hard storefront cutoff (a capped,
 * zero-overage-rate plan like Free) and the shop has hit that cap for the
 * current calendar month. Plans that bill per-order overage instead (a
 * positive overageRate, e.g. Starter) or have no cap (Pro) never cut off —
 * they just get billed by the existing usage-charge path in
 * app/services/billing.server.js. Storefront widgets read this directly
 * (see save_cart_drawer.php / save_fbt_widget.php /
 * save_coupon_slider_widget.php) since analytics_daily_rollup lives in the
 * same database PHP already connects to. Resets itself automatically each
 * month — no cron/reset job needed, since the SUM below is always scoped to
 * the current calendar month to date.
 */
function plan_order_cap_exceeded($pdo, $shopDomain, $planKey) {
    if (!$shopDomain) return false;

    $plan = plan_get_config($planKey);
    if ($plan['orderCap'] === null || $plan['overageRate'] > 0) return false;

    $stmt = $pdo->prepare(
        "SELECT COALESCE(SUM(billable_order_count), 0) AS total
         FROM analytics_daily_rollup
         WHERE shop_domain = :shop AND date >= DATE_FORMAT(NOW(), '%Y-%m-01')"
    );
    $stmt->execute([':shop' => $shopDomain]);
    $total = (int) ($stmt->fetch()['total'] ?? 0);

    return $total >= $plan['orderCap'];
}
