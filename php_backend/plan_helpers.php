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
    if (!in_array('billing_interval', $existingCols)) {
        $alterations[] = "ADD COLUMN `billing_interval` VARCHAR(10) NOT NULL DEFAULT 'monthly'";
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
    if (strpos($normalized, 'lite') !== false) return 'lite';
    if (strpos($normalized, 'growth') !== false) return 'growth';
    if (strpos($normalized, 'pro') !== false) return 'pro';
    return 'starter';
}

/**
 * Resolves a shop domain to its canonical plan key ('free'|'lite'|'starter'|'growth'|'pro').
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

/** 'monthly' | 'annual': how the shop's plan is billed (shops.billing_interval). */
function plan_billing_interval($pdo, $shopDomain) {
    if (!$shopDomain) return 'monthly';
    plan_ensure_columns($pdo);
    $stmt = $pdo->prepare("SELECT billing_interval FROM shops WHERE shop_domain = :shop LIMIT 1");
    $stmt->execute([':shop' => $shopDomain]);
    $row = $stmt->fetch();
    return ($row && $row['billing_interval'] === 'annual') ? 'annual' : 'monthly';
}

/**
 * Whether this shop's storefront widgets are paused for the rest of the
 * month: the month's orders have reached the plan's cap. Every plan pauses
 * there today (no overage rates); a plan with an overage rate, billed
 * monthly, would bill extra orders instead (app/services/billing.server.js). Orders =
 * every paid order of the store this calendar month (billable_order_count,
 * services/billable-orders.server.js). Every storefront endpoint checks it:
 * cart drawer (upsells inside it), FBT, coupon slider, COD, Packs (combo
 * pages and the COD order API ask Node's isStorefrontPaused, same rule). Resets itself
 * each month, since the SUM below is scoped to the current calendar month.
 */
function plan_order_cap_exceeded($pdo, $shopDomain, $planKey) {
    if (!$shopDomain) return false;

    $plan = plan_get_config($planKey);
    if ($plan['orderCap'] === null) return false;
    // A plan that bills per-order overage only does so when billed monthly:
    // a yearly Lite / Starter / Growth pauses at the cap like Free
    // (orderCapBehavior in app/config/plans.js).
    if ($plan['overageRate'] > 0 && plan_billing_interval($pdo, $shopDomain) !== 'annual') return false;

    // A count that can't be read never pauses a store.
    try {
        $stmt = $pdo->prepare(
            "SELECT COALESCE(SUM(billable_order_count), 0) AS total
             FROM analytics_daily_rollup
             WHERE shop_domain = :shop AND date >= DATE_FORMAT(NOW(), '%Y-%m-01')"
        );
        $stmt->execute([':shop' => $shopDomain]);
        $total = (int) ($stmt->fetch()['total'] ?? 0);
    } catch (PDOException $e) {
        error_log('[plan_order_cap_exceeded] ' . $e->getMessage());
        return false;
    }

    return $total >= $plan['orderCap'];
}
