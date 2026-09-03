<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

/**
 * Server-to-server notification to agencydashboard_c's internal Shopify
 * webhook, so a real Shopify uninstall disconnects the store on the
 * agency side too (see Internal\AgencyShopifyWebhookController). Additive
 * only: never throws, never blocks/affects this script's own success
 * response, and never logs the shared secret or any access token — only
 * the shop domain and a generic outcome.
 */
function notifyAgencyDashboardStoreUninstalled(string $shop): void
{
    $secret = getenv('AGENCY_DASHBOARD_INTERNAL_SECRET');

    if (!$secret) {
        error_log('notifyAgencyDashboardStoreUninstalled: AGENCY_DASHBOARD_INTERNAL_SECRET is not set; skipping.');
        return;
    }

    $baseUrl = getenv('AGENCY_DASHBOARD_URL') ?: 'http://127.0.0.1:8000';
    $url = rtrim($baseUrl, '/') . '/internal/shopify/agency/store-uninstalled';

    try {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(['shop_domain' => $shop]));
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Content-Type: application/json',
            'Accept: application/json',
            'X-Internal-Secret: ' . $secret,
        ]);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
        curl_setopt($ch, CURLOPT_TIMEOUT, 5);

        $response = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($response === false || $status < 200 || $status >= 300) {
            error_log("notifyAgencyDashboardStoreUninstalled: webhook call failed for shop={$shop} status={$status} error={$curlError}");
        }
    } catch (\Throwable $e) {
        error_log('notifyAgencyDashboardStoreUninstalled: unexpected exception - ' . $e->getMessage());
    }
}

// Database Connection
require_once __DIR__ . '/config.php';

$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
];

try {
    $pdo = new PDO($dsn, $user, $pass, $options);
} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed']);
    exit;
}

// Get JSON Input
$input = json_decode(file_get_contents('php://input'), true);
$shop = $input['shop'] ?? null;

if (!$shop) {
    http_response_code(400);
    echo json_encode(['error' => 'Shop parameter is required']);
    exit;
}

try {
    // 1. Mark the shop as inactive in the shops table
    $stmt = $pdo->prepare("UPDATE shops SET is_active = 0, updated_at = NOW() WHERE shop_domain = :shop_domain");
    $stmt->execute([':shop_domain' => $shop]);

    // Optional (If relevant for your app logic): Deactivate cart drawer, coupons, etc.
    // $stmt = $pdo->prepare("UPDATE cart_drawer SET cartStatus = 0 WHERE shop = :shop");
    // $stmt->execute([':shop' => $shop]);

    // Notify agencydashboard_c so the agency-side relationship is marked
    // DISCONNECTED to match this real Shopify uninstall.
    notifyAgencyDashboardStoreUninstalled($shop);

    echo json_encode(['success' => true, 'message' => "Shop $shop marked inactive"]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to process uninstallation: ' . $e->getMessage()]);
}
?>
