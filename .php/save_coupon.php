<?php
require_once __DIR__ . '/config.php';

/* ============================================================
   ======================= GET REQUEST ========================
   ============================================================ */

if ($_SERVER['REQUEST_METHOD'] === 'GET') {

    $shopDomain = $_GET['shopdomain'] ?? null;

    if (!$shopDomain) {
        http_response_code(400);
        echo json_encode([
            "status" => "error",
            "message" => "shopdomain parameter required"
        ]);
        exit;
    }

    try {
        $stmt = $pdo->prepare("
            SELECT internal_id, shopify_id, shop_domain, code, discount_config, is_active
            FROM coupons
            WHERE shop_domain = :shop_domain
        ");

        $stmt->execute([':shop_domain' => $shopDomain]);
        $results = $stmt->fetchAll();

        if (!$results) {
            echo json_encode([
                "status" => "error",
                "message" => "No coupons found for this shop"
            ]);
            exit;
        }

        // Decode JSON config before returning
        foreach ($results as &$row) {
            if (!empty($row['discount_config'])) {
                $decoded = json_decode($row['discount_config'], true);
                if (json_last_error() === JSON_ERROR_NONE) {
                    $row['discount_config'] = $decoded;
                }
            }
        }

        echo json_encode([
            "status" => "success",
            "data"   => $results
        ]);

    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode([
            "status" => "error",
            "message" => "Fetch failed: " . $e->getMessage()
        ]);
    }

    exit;
}

/* ============================================================
   ======================= POST REQUEST =======================
   ============================================================ */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode([
        "status" => "error",
        "message" => "Method not allowed"
    ]);
    exit;
}

// ===== READ RAW PAYLOAD =====
$rawInput = file_get_contents("php://input");

if (empty($rawInput)) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Empty payload"]);
    exit;
}

$data = json_decode($rawInput, true);

if (json_last_error() !== JSON_ERROR_NONE) {
    http_response_code(400);
    echo json_encode([
        "status" => "error",
        "message" => "Invalid JSON: " . json_last_error_msg()
    ]);
    exit;
}

// Support flat or wrapped
$payload = isset($data['payload']) ? $data['payload'] : $data;

// ===== VALIDATION =====
$internalId  = $payload['id'] ?? null;
$shopifyId   = $payload['shopifyId'] ?? null;
$code        = $payload['code'] ?? null;
$shopDomain  = $payload['shopDomain'] ?? null;

$missingFields = [];
if (!$internalId) $missingFields[] = 'id';
if (!$code) $missingFields[] = 'code';
if (!$shopDomain) $missingFields[] = 'shopDomain';

if (!empty($missingFields)) {
    http_response_code(400);
    echo json_encode([
        "status"  => "error",
        "message" => "Missing required fields: " . implode(', ', $missingFields)
    ]);
    exit;
}

// ===== STORE FULL CONFIG =====
$discountConfig = json_encode($payload);

// ===== INSERT / UPDATE =====
$sql = "
INSERT INTO coupons (
    internal_id,
    shopify_id,
    shop_domain,
    code,
    discount_config,
    is_active
) VALUES (
    :internal_id,
    :shopify_id,
    :shop_domain,
    :code,
    :discount_config,
    1
)
ON DUPLICATE KEY UPDATE
    shopify_id = VALUES(shopify_id),
    code = VALUES(code),
    discount_config = VALUES(discount_config),
    is_active = 1
";

try {
    $stmt = $pdo->prepare($sql);

    $stmt->execute([
        ':internal_id'     => $internalId,
        ':shopify_id'      => $shopifyId,
        ':shop_domain'     => $shopDomain,
        ':code'            => $code,
        ':discount_config' => $discountConfig
    ]);

    echo json_encode([
        "status"  => "success",
        "message" => "Coupon saved successfully"
    ]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        "status"  => "error",
        "message" => "Database save failed: " . $e->getMessage()
    ]);
}