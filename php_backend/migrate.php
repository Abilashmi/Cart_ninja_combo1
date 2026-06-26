<?php
require_once __DIR__ . '/config.php';

// Run via browser or CLI. Safe to run multiple times — checks before altering.

$results = [];

function runMigration($pdo, string $label, string $checkSql, array $checkParams, string $alterSql): array {
    try {
        $stmt = $pdo->prepare($checkSql);
        $stmt->execute($checkParams);
        $exists = $stmt->fetchColumn();
        if ($exists) {
            return ['label' => $label, 'status' => 'skipped', 'note' => 'Already exists'];
        }
        $pdo->exec($alterSql);
        return ['label' => $label, 'status' => 'applied', 'note' => 'Done'];
    } catch (PDOException $e) {
        return ['label' => $label, 'status' => 'error', 'note' => $e->getMessage()];
    }
}

$db = 'cart_drawer_ninja';

// ── Migration 1: coupon_slider_settings.selected_coupons ─────────────────────
$results[] = runMigration(
    $pdo,
    'Add selected_coupons to coupon_slider_settings',
    "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'coupon_slider_settings' AND COLUMN_NAME = 'selected_coupons'",
    [$db],
    "ALTER TABLE coupon_slider_settings ADD COLUMN selected_coupons LONGTEXT NULL AFTER layout"
);

// ── Migration 2: upsell_widget_settings.manual_rules ─────────────────────────
$results[] = runMigration(
    $pdo,
    'Add manual_rules to upsell_widget_settings',
    "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'upsell_widget_settings' AND COLUMN_NAME = 'manual_rules'",
    [$db],
    "ALTER TABLE upsell_widget_settings ADD COLUMN manual_rules LONGTEXT NULL AFTER active_template"
);

// ── Output ────────────────────────────────────────────────────────────────────
$allOk = !in_array('error', array_column($results, 'status'));

header('Content-Type: application/json');
echo json_encode([
    'success'     => $allOk,
    'migrations'  => $results,
    'summary'     => [
        'applied' => count(array_filter($results, fn($r) => $r['status'] === 'applied')),
        'skipped' => count(array_filter($results, fn($r) => $r['status'] === 'skipped')),
        'errors'  => count(array_filter($results, fn($r) => $r['status'] === 'error')),
    ],
], JSON_PRETTY_PRINT);
