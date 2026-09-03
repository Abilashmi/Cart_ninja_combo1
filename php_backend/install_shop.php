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
 * webhook, so a real Shopify install shows up against the agency's
 * pending onboarding row (see Internal\AgencyShopifyWebhookController on
 * that side). Additive only: never throws, never blocks/affects this
 * script's own success response, and never logs the shared secret or any
 * access token — only the shop domain and a generic outcome.
 */
function notifyAgencyDashboardStoreInstalled(string $shop): void
{
    $secret = getenv('AGENCY_DASHBOARD_INTERNAL_SECRET');

    if (!$secret) {
        error_log('notifyAgencyDashboardStoreInstalled: AGENCY_DASHBOARD_INTERNAL_SECRET is not set; skipping.');
        return;
    }

    $baseUrl = getenv('AGENCY_DASHBOARD_URL') ?: 'http://127.0.0.1:8000';
    $url = rtrim($baseUrl, '/') . '/internal/shopify/agency/store-installed';

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
            error_log("notifyAgencyDashboardStoreInstalled: webhook call failed for shop={$shop} status={$status} error={$curlError}");
        }
    } catch (\Throwable $e) {
        error_log('notifyAgencyDashboardStoreInstalled: unexpected exception - ' . $e->getMessage());
    }
}

// Database Connection
require_once __DIR__ . '/config.php';

// Get JSON Input
$input = json_decode(file_get_contents('php://input'), true);

$shop = $input['shop'] ?? null;
$accessToken = $input['accessToken'] ?? null;

if (!$shop) {
    http_response_code(400);
    echo json_encode(['error' => 'Shop parameter is required']);
    exit;
}

try {
    // Insert or update the shop
    $stmt = $pdo->prepare("
        INSERT INTO shops (shop_domain, access_token, is_active, created_at, updated_at) 
        VALUES (:shop_domain, :access_token, 1, NOW(), NOW())
        ON DUPLICATE KEY UPDATE 
            access_token = VALUES(access_token),
            is_active = 1,
            updated_at = NOW()
    ");

    $stmt->execute([
        ':shop_domain' => $shop,
        ':access_token' => $accessToken
    ]);
    
    // Send data to shop_logger.php
    $logData = [
        'shop' => $shop,
        'action' => 'shop_installed',
        'details' => 'Shop has been successfully installed and registered in the database.'
    ];

    $ch = curl_init('https://int.thebrix.io/shop_logger.php');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($logData));
    curl_setopt($ch, CURLOPT_HTTPHEADER, array('Content-Type: application/json'));
    // Execute but we don't necessarily need to wait for or check the response
    curl_exec($ch);
    curl_close($ch);

    // Notify agencydashboard_c (brix_superadmin) that this Shopify install
    // completed, so its store-connection wizard can move a pending
    // agency_store_onboarding row forward. This is purely additive and
    // must never affect the response above: the Shopify install already
    // succeeded by this point, so any failure here is only logged (never
    // an access token, never the shared secret) and swallowed.
    notifyAgencyDashboardStoreInstalled($shop);

    echo json_encode(['success' => true, 'message' => 'Shop installed and marked active']);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to install shop: ' . $e->getMessage()]);
}
?>
