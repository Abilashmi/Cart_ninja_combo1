<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Internal-Secret');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

/**
 * Read-only "is BRIX actually installed + active on this shop?" check for
 * agencydashboard_c's store-connection wizard.
 *
 * The agency dashboard mirrors Shopify install state onto its own
 * brix_superadmin.stores.installation_status, but that mirror is only
 * written when install_shop.php's webhook happens to land while a live
 * agency_store_onboarding row exists. A store that was already installed
 * before the agency started onboarding it never triggers that write, so
 * the wizard wrongly bounces the merchant back to the App Store. This
 * endpoint is the authoritative counter-check: the `shops` table here is
 * written by install_shop.php / uninstall_shop.php on every real Shopify
 * install/uninstall.
 *
 * Authenticated by the same shared secret as the notify* calls in
 * install_shop.php, checked in the reverse direction. Never returns the
 * access token or any other shop data — only a boolean.
 */

$secret = getenv('AGENCY_DASHBOARD_INTERNAL_SECRET');
$provided = $_SERVER['HTTP_X_INTERNAL_SECRET'] ?? '';

if (!$secret) {
    error_log('store_install_status: AGENCY_DASHBOARD_INTERNAL_SECRET is not set; refusing.');
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Server misconfiguration.']);
    exit;
}

if (!is_string($provided) || $provided === '' || !hash_equals($secret, $provided)) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized.']);
    exit;
}

require_once __DIR__ . '/config.php';

$shop = $_GET['shop_domain'] ?? null;

if (!$shop && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $shop = is_array($input) ? ($input['shop_domain'] ?? null) : null;
}

$shop = strtolower(trim((string) $shop));

if ($shop === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'shop_domain is required']);
    exit;
}

try {
    $stmt = $pdo->prepare('SELECT is_active FROM shops WHERE shop_domain = :shop_domain LIMIT 1');
    $stmt->execute([':shop_domain' => $shop]);
    $row = $stmt->fetch();

    $installed = $row !== false && (int) $row['is_active'] === 1;

    echo json_encode([
        'success' => true,
        'data' => [
            'shop_domain' => $shop,
            'installed' => $installed,
        ],
    ]);
} catch (\Throwable $e) {
    error_log('store_install_status: lookup failed for shop=' . $shop . ' - ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'lookup failed']);
}
