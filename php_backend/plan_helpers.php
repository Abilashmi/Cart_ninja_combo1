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
