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
            SELECT *
            FROM cart_drawer
            WHERE shop = :shop
            LIMIT 1
        ");

        $stmt->execute([':shop' => $shopDomain]);
        $result = $stmt->fetch();

        if (!$result) {
            echo json_encode([
                "status" => "error",
                "message" => "No data found for this shop"
            ]);
            exit;
        }

        echo json_encode([
            "status" => "success",
            "data" => $result
        ]);

    }
    catch (PDOException $e) {
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
$data = null;

if (!empty($rawInput)) {
    $data = json_decode($rawInput, true);

    if (json_last_error() !== JSON_ERROR_NONE) {
        $formData = [];
        parse_str($rawInput, $formData);
        if (!empty($formData)) {
            $data = $formData;
        }
    }
}

if (!is_array($data) && !empty($_POST)) {
    $data = $_POST;
}

if (!is_array($data)) {
    http_response_code(400);
    echo json_encode([
        "status" => "error",
        "message" => "Invalid or empty payload"
    ]);
    exit;
}

// Support wrapped or flat
$payload = isset($data['payload']) ? $data['payload'] : $data;

if (is_string($payload) && trim($payload) !== '') {
    $decodedPayload = json_decode($payload, true);
    if (json_last_error() === JSON_ERROR_NONE && is_array($decodedPayload)) {
        $payload = $decodedPayload;
    }
}

if (!is_array($payload)) {
    http_response_code(400);
    echo json_encode([
        "status" => "error",
        "message" => "Payload must be an object"
    ]);
    exit;
}

$shop = $payload['shop'] ?? ($payload['shopDomain'] ?? ($payload['Id'] ?? ($payload['id'] ?? null)));

if (!$shop) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Shop is required"]);
    exit;
}

function normalizeJsonField($value)
{
    if ($value === null) {
        return null;
    }

    if (is_array($value) || is_object($value)) {
        return json_encode($value, JSON_UNESCAPED_UNICODE);
    }

    if (is_string($value)) {
        return $value;
    }

    return json_encode($value, JSON_UNESCAPED_UNICODE);
}

function normalizeFlag($value, $default = 0)
{
    if ($value === null || $value === '') {
        return (int)$default;
    }

    if (is_bool($value)) {
        return $value ? 1 : 0;
    }

    if (is_numeric($value)) {
        return ((int)$value) ? 1 : 0;
    }

    if (is_string($value)) {
        $valueLower = strtolower(trim($value));
        if (in_array($valueLower, ['active', 'enabled', 'true', '1', 'yes'], true)) {
            return 1;
        }
        if (in_array($valueLower, ['inactive', 'disabled', 'false', '0', 'no'], true)) {
            return 0;
        }
    }

    return (int)$default;
}

// ===== MAP DATA =====
$cartStatus = normalizeFlag($payload['cartstatus'] ?? ($payload['cartStatus'] ?? 0));
$progressData = normalizeJsonField($payload['progress_data'] ?? ($payload['progressData'] ?? null));
$couponData = normalizeJsonField($payload['coupon_data'] ?? ($payload['couponData'] ?? null));
$upsellData = normalizeJsonField($payload['upsell_data'] ?? ($payload['upsellData'] ?? null));

$settingsRaw = $payload['settings_data'] ?? null;
$settingsData = [];

if (is_array($settingsRaw)) {
    $settingsData = $settingsRaw;
}
elseif (is_string($settingsRaw) && trim($settingsRaw) !== '') {
    $decodedSettings = json_decode($settingsRaw, true);
    if (json_last_error() === JSON_ERROR_NONE && is_array($decodedSettings)) {
        $settingsData = $decodedSettings;
    }
}

$checkoutName = $payload['checkoutName'] ?? ($settingsData['checkoutName'] ?? null);
$checkoutFooterText = $payload['checkoutFooterText'] ?? ($settingsData['checkoutFooterText'] ?? null);
$customCSS = $payload['customCSS'] ?? ($settingsData['customCSS'] ?? null);
$checkoutButtonStyle = normalizeJsonField($payload['checkout_button_style'] ?? ($settingsData['checkout_button_style'] ?? null));

$progressStatus = normalizeFlag($payload['progress_status'] ?? ($payload['progressStatus'] ?? 0));
$couponStatus = normalizeFlag($payload['coupon_status'] ?? ($payload['couponStatus'] ?? 0));
$upsellStatus = normalizeFlag($payload['upsell_status'] ?? ($payload['upsellStatus'] ?? 0));

// ===== INSERT / UPDATE =====
$sql = "
INSERT INTO cart_drawer (
    shop,
    cartStatus,
    progress_data,
    coupon_data,
    upsell_data,
    checkoutName,
    checkoutFooterText,
    customCSS,
    checkout_button_style,
    progress_status,
    coupon_status,
    upsell_status,
    updated_at
) VALUES (
    :shop,
    :cartStatus,
    :progress_data,
    :coupon_data,
    :upsell_data,
    :checkoutName,
    :checkoutFooterText,
    :customCSS,
    :checkout_button_style,
    :progress_status,
    :coupon_status,
    :upsell_status,
    CURRENT_TIMESTAMP(3)
)
ON DUPLICATE KEY UPDATE
    cartStatus = VALUES(cartStatus),
    progress_data = VALUES(progress_data),
    coupon_data = VALUES(coupon_data),
    upsell_data = VALUES(upsell_data),
    checkoutName = VALUES(checkoutName),
    checkoutFooterText = VALUES(checkoutFooterText),
    customCSS = VALUES(customCSS),
    checkout_button_style = VALUES(checkout_button_style),
    progress_status = VALUES(progress_status),
    coupon_status = VALUES(coupon_status),
    upsell_status = VALUES(upsell_status),
    updated_at = CURRENT_TIMESTAMP(3)
";

try {
    $stmt = $pdo->prepare($sql);

    $stmt->execute([
        ':shop' => $shop,
        ':cartStatus' => $cartStatus,
        ':progress_data' => $progressData,
        ':coupon_data' => $couponData,
        ':upsell_data' => $upsellData,
        ':checkoutName' => $checkoutName,
        ':checkoutFooterText' => $checkoutFooterText,
        ':customCSS' => $customCSS,
        ':checkout_button_style' => $checkoutButtonStyle,
        ':progress_status' => $progressStatus,
        ':coupon_status' => $couponStatus,
        ':upsell_status' => $upsellStatus
    ]);

    echo json_encode([
        "status" => "success",
        "message" => "Cart drawer data saved successfully"
    ]);

}
catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        "status" => "error",
        "message" => "Database save failed: " . $e->getMessage()
    ]);
} 