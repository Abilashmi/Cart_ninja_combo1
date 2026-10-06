<?php
/**
 * BRIX COD Checkout — shared by cod_settings.php, cod_otp.php and cod_orders.php.
 *
 * These endpoints own the COD tables. They are called only by the Node app
 * (app/services/cod.server.js), authenticated with the X-Forge-Secret header
 * like db_proxy.php / progress_bar.php. Shopify work (pricing, creating the
 * order) and hashing of phones / OTP codes happen in Node; this backend never
 * sees a raw phone number or OTP code, only their hashes.
 *
 * Tables (created on first request):
 *   cod_settings  one JSON settings blob per shop
 *   cod_otp       hashed one-time codes
 *   cod_orders    one row per COD order attempt (idempotency, daily limits, admin list),
 *                 plus its later Shopify lifecycle (shipped / delivered / cancelled …) and
 *                 whether the GA4 / Meta server-side Purchase was sent
 *   cod_secrets   per-shop GA4 Measurement Protocol secret + Meta Conversions API token
 *                 (never served to the storefront; the admin only sees "set / last 4")
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function cod_fail($status, $code, $error) {
    http_response_code($status);
    echo json_encode(['success' => false, 'code' => $code, 'error' => $error]);
    exit;
}

function cod_ok($body = []) {
    echo json_encode(array_merge(['success' => true], $body));
    exit;
}

function cod_require_secret() {
    $secret = $_SERVER['HTTP_X_FORGE_SECRET'] ?? '';
    $expected = getenv('SHOPIFY_API_KEY') ?: '';
    if (!$expected || !hash_equals($expected, $secret)) cod_fail(403, 'forbidden', 'Forbidden');
}

function cod_body() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') cod_fail(405, 'method_not_allowed', 'POST only');
    $raw = file_get_contents('php://input');
    if (strlen($raw) > 256 * 1024) cod_fail(413, 'too_large', 'Request is too large');
    $body = json_decode($raw ?: '{}', true);
    if (!is_array($body)) cod_fail(400, 'invalid_json', 'Invalid JSON');
    return $body;
}

function cod_shop($value) {
    $shop = strtolower(trim((string)$value));
    if (!preg_match('/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/', $shop)) cod_fail(400, 'invalid_shop', 'A valid shop is required');
    return $shop;
}

function cod_hash($value, $field) {
    $hash = (string)$value;
    if (!preg_match('/^[a-f0-9]{64}$/', $hash)) cod_fail(400, 'invalid_' . $field, $field . ' must be a sha256 hex digest');
    return $hash;
}

function cod_str($value, $max) {
    return mb_substr(trim((string)($value ?? '')), 0, $max);
}

function cod_ensure_tables($pdo) {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS cod_settings (
            shop          VARCHAR(255) NOT NULL,
            settings_json TEXT NOT NULL,
            updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (shop)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS cod_otp (
            id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            shop        VARCHAR(255) NOT NULL,
            phone_hash  CHAR(64) NOT NULL,
            code_hash   CHAR(64) NOT NULL,
            attempts    INT NOT NULL DEFAULT 0,
            verified    TINYINT(1) NOT NULL DEFAULT 0,
            expires_at  DATETIME NOT NULL,
            created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_cod_otp_phone (shop, phone_hash, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS cod_orders (
            id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            shop            VARCHAR(255) NOT NULL,
            idem_key        VARCHAR(64) NOT NULL,
            status          VARCHAR(16) NOT NULL DEFAULT 'creating',
            source          VARCHAR(16) NOT NULL,
            phone_hash      CHAR(64) NOT NULL,
            phone_masked    VARCHAR(16) NOT NULL,
            phone_verified  TINYINT(1) NOT NULL DEFAULT 0,
            customer_name   VARCHAR(120) NULL,
            pincode         VARCHAR(10) NULL,
            total           DECIMAL(12,2) NULL,
            currency        VARCHAR(8) NULL,
            draft_order_id  VARCHAR(64) NULL,
            order_id        VARCHAR(64) NULL,
            order_name      VARCHAR(32) NULL,
            created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uniq_cod_orders_idem (shop, idem_key),
            KEY idx_cod_orders_phone (shop, phone_hash, created_at),
            KEY idx_cod_orders_shop (shop, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS cod_secrets (
            shop             VARCHAR(255) NOT NULL,
            ga4_api_secret   VARCHAR(128) NULL,
            meta_capi_token  VARCHAR(512) NULL,
            meta_test_code   VARCHAR(64) NULL,
            updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (shop)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
    cod_ensure_order_columns($pdo);
}

/** Columns added after cod_orders first shipped. SHOW COLUMNS works on MySQL and MariaDB alike. */
function cod_ensure_order_columns($pdo) {
    $have = array_column($pdo->query('SHOW COLUMNS FROM cod_orders')->fetchAll(PDO::FETCH_ASSOC), 'Field');
    $add = [
        'lifecycle'          => "VARCHAR(16) NOT NULL DEFAULT 'placed'",
        'financial_status'   => 'VARCHAR(32) NULL',
        'fulfillment_status' => 'VARCHAR(32) NULL',
        'shipment_status'    => 'VARCHAR(32) NULL',
        'refunded_total'     => 'DECIMAL(12,2) NOT NULL DEFAULT 0',
        'cancelled_at'       => 'DATETIME NULL',
        'ga4_status'         => 'VARCHAR(24) NULL',
        'meta_status'        => 'VARCHAR(24) NULL',
    ];
    $missing = array_diff_key($add, array_flip($have));
    foreach ($missing as $column => $definition) {
        $pdo->exec("ALTER TABLE cod_orders ADD COLUMN $column $definition");
    }
    if ($missing) {
        $keys = array_column($pdo->query("SHOW INDEX FROM cod_orders WHERE Key_name = 'idx_cod_orders_order'")->fetchAll(PDO::FETCH_ASSOC), 'Key_name');
        if (!$keys) $pdo->exec('ALTER TABLE cod_orders ADD KEY idx_cod_orders_order (shop, order_id)');
    }
}

/** Runs $fn with the PDO handle; any DB failure becomes a clean 503 (details only in the server log). */
function cod_db($pdo, $fn) {
    try {
        cod_ensure_tables($pdo);
        return $fn($pdo);
    } catch (PDOException $e) {
        if ((string)$e->getCode() === '23000' && stripos($e->getMessage(), 'Duplicate') !== false) {
            cod_fail(409, 'duplicate', 'This request was already received');
        }
        error_log('[cod] ' . $e->getMessage());
        cod_fail(503, 'database_error', 'COD storage is temporarily unavailable');
    }
}
