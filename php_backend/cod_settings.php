<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/cod_helpers.php';

/**
 * BRIX COD Checkout settings (one JSON blob per shop). Node-only, X-Forge-Secret.
 *
 *   POST { action: 'get',  shop }            → { settings: object|null }
 *   POST { action: 'save', shop, settings }  → { settings }
 *   POST { action: 'secrets_get',  shop }    → { secrets: { ga4ApiSecret, metaCapiToken, metaTestCode, msg91AuthKey, msg91TemplateId } }
 *   POST { action: 'secrets_save', shop, secrets: { ga4ApiSecret?, metaCapiToken?, metaTestCode?, msg91AuthKey?, msg91TemplateId? } } → {}
 *        a key that is missing keeps its stored value; '' or null clears it
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

const COD_SECRET_FIELDS = [
    // body key => [column, max length, allowed characters]
    'ga4ApiSecret'  => ['ga4_api_secret', 128, '/^[A-Za-z0-9_-]+$/'],
    'metaCapiToken' => ['meta_capi_token', 512, '/^[A-Za-z0-9_-]+$/'],
    'metaTestCode'  => ['meta_test_code', 64, '/^[A-Za-z0-9_-]+$/'],
    // The store's own MSG91 account for OTP SMS (else the BRIX server's, if set).
    'msg91AuthKey'    => ['msg91_auth_key', 128, '/^[A-Za-z0-9_-]+$/'],
    'msg91TemplateId' => ['msg91_template_id', 64, '/^[A-Za-z0-9_-]+$/'],
];

if ($action === 'secrets_get') {
    cod_db($pdo, function ($pdo) use ($shop) {
        $stmt = $pdo->prepare('SELECT * FROM cod_secrets WHERE shop = ? LIMIT 1');
        $stmt->execute([$shop]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
        $secrets = [];
        foreach (COD_SECRET_FIELDS as $key => [$column]) $secrets[$key] = $row[$column] ?? '';
        cod_ok(['secrets' => $secrets]);
    });
}

if ($action === 'secrets_save') {
    $input = $body['secrets'] ?? null;
    if (!is_array($input)) cod_fail(400, 'invalid_secrets', 'secrets must be an object');
    $set = [];
    foreach (COD_SECRET_FIELDS as $key => [$column, $max, $re]) {
        if (!array_key_exists($key, $input)) continue;
        $value = trim((string)($input[$key] ?? ''));
        if ($value !== '' && (strlen($value) > $max || !preg_match($re, $value))) {
            cod_fail(400, 'invalid_' . $key, $key . ' does not look right');
        }
        $set[$column] = $value === '' ? null : $value;
    }
    if (!$set) cod_ok();
    cod_db($pdo, function ($pdo) use ($shop, $set) {
        $columns = array_keys($set);
        $sql = 'INSERT INTO cod_secrets (shop, ' . implode(', ', $columns) . ') VALUES (?' . str_repeat(', ?', count($columns)) . ')'
            . ' ON DUPLICATE KEY UPDATE ' . implode(', ', array_map(fn($c) => "$c = VALUES($c)", $columns));
        $pdo->prepare($sql)->execute(array_merge([$shop], array_values($set)));
        cod_ok();
    });
}

cod_fail(400, 'invalid_action', 'Unknown action');
