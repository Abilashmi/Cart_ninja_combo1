<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/cod_helpers.php';

/**
 * BRIX COD dynamic shipping (one JSON config per shop: delivery options,
 * zones with their PIN code lists, rules, extra charges, delivery dates).
 * Node-only, X-Forge-Secret. Used while the COD settings say
 * shippingMode: 'advanced'.
 *
 *   POST { action: 'get',  shop }           → { shipping: object|null }
 *   POST { action: 'save', shop, shipping } → {}
 *
 * Kept apart from cod_settings: PIN code lists don't fit its TEXT column, and
 * the storefront never reads this (Node prices every COD quote and order with
 * it, app/utils/shipping.shared.js). Node validates the config before saving
 * (sanitizeShipping); this file stores it as-is.
 */

const COD_SHIPPING_MAX_BYTES = 200000;

cod_require_secret();
$body = cod_body();
$shop = cod_shop($body['shop'] ?? '');
$action = $body['action'] ?? '';

function cod_ensure_shipping_table($pdo) {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS cod_shipping (
            shop        VARCHAR(255) NOT NULL,
            config_json MEDIUMTEXT NOT NULL,
            updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (shop)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
}

if ($action === 'get') {
    cod_db($pdo, function ($pdo) use ($shop) {
        cod_ensure_shipping_table($pdo);
        $stmt = $pdo->prepare('SELECT config_json FROM cod_shipping WHERE shop = ? LIMIT 1');
        $stmt->execute([$shop]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        $config = $row ? json_decode($row['config_json'], true) : null;
        cod_ok(['shipping' => is_array($config) ? $config : null]);
    });
}

if ($action === 'save') {
    $config = $body['shipping'] ?? null;
    if (!is_array($config)) cod_fail(400, 'invalid_shipping', 'shipping must be an object');
    $json = json_encode($config, JSON_UNESCAPED_UNICODE);
    if ($json === false || strlen($json) > COD_SHIPPING_MAX_BYTES) cod_fail(400, 'shipping_too_large', 'Shipping settings are too large');
    cod_db($pdo, function ($pdo) use ($shop, $json) {
        cod_ensure_shipping_table($pdo);
        $stmt = $pdo->prepare('INSERT INTO cod_shipping (shop, config_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE config_json = VALUES(config_json)');
        $stmt->execute([$shop, $json]);
        cod_ok();
    });
}

cod_fail(400, 'invalid_action', 'Unknown action');
