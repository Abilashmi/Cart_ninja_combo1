<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/cod_helpers.php';

/**
 * BRIX COD Checkout settings (one JSON blob per shop). Node-only, X-Forge-Secret.
 *
 *   POST { action: 'get',  shop }            → { settings: object|null }
 *   POST { action: 'save', shop, settings }  → { settings }
 *
 * Node (app/services/cod.server.js) validates and merges the settings before
 * saving (sanitizeCodSettings in app/utils/cod.shared.js), so a field omitted
 * from a patch keeps its stored value; this file stores the result as-is.
 */

cod_require_secret();
$body = cod_body();
$shop = cod_shop($body['shop'] ?? '');
$action = $body['action'] ?? '';

if ($action === 'get') {
    cod_db($pdo, function ($pdo) use ($shop) {
        $stmt = $pdo->prepare('SELECT settings_json FROM cod_settings WHERE shop = ? LIMIT 1');
        $stmt->execute([$shop]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        $settings = $row ? json_decode($row['settings_json'], true) : null;
        cod_ok(['settings' => is_array($settings) ? $settings : null]);
    });
}

if ($action === 'save') {
    $settings = $body['settings'] ?? null;
    if (!is_array($settings)) cod_fail(400, 'invalid_settings', 'settings must be an object');
    $json = json_encode($settings, JSON_UNESCAPED_UNICODE);
    if ($json === false || strlen($json) > 60000) cod_fail(400, 'invalid_settings', 'settings are too large');
    cod_db($pdo, function ($pdo) use ($shop, $json, $settings) {
        $stmt = $pdo->prepare('INSERT INTO cod_settings (shop, settings_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json)');
        $stmt->execute([$shop, $json]);
        cod_ok(['settings' => $settings]);
    });
}

cod_fail(400, 'invalid_action', 'Unknown action');
