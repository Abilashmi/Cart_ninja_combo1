<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/plan_helpers.php';

function ensureWatermarkColumn($pdo) {
    static $ensured = false;
    if ($ensured) return;
    $existingCols = array_column(
        $pdo->query("SHOW COLUMNS FROM cart_drawer")->fetchAll(PDO::FETCH_ASSOC),
        'Field'
    );
    if (!in_array('watermark_enabled', $existingCols)) {
        $pdo->exec("ALTER TABLE cart_drawer ADD COLUMN `watermark_enabled` TINYINT(1) NOT NULL DEFAULT 1");
    }
    $ensured = true;
}

/**
 * Resolves whether the "Powered by BRIX" watermark should render on the
 * storefront. Free plans always show it regardless of the merchant's saved
 * toggle; Starter/Pro respect the toggle (default on).
 */
function resolveShowWatermark($planKey, $watermarkEnabledRaw) {
    $plan = plan_get_config($planKey);
    if (empty($plan['watermarkRemovable'])) {
        return true;
    }
    if ($watermarkEnabledRaw === null || $watermarkEnabledRaw === '') {
        return true;
    }
    return (bool)((int)$watermarkEnabledRaw);
}

/**
 * Strips fields gated behind locked plan features from the outgoing GET
 * response. Only mutates the array that gets echoed — never touches the
 * stored database row — so a merchant's design/config is preserved as-is
 * if they later upgrade.
 */
function applyPlanGatingToCartDrawerResult(array $result, string $planKey): array {
    $result['showWatermark'] = resolveShowWatermark($planKey, $result['watermark_enabled'] ?? null);

    // ---- Progress Bar (+ bundled confetti-on-completion) ----
    if (!plan_can_publish_feature($planKey, 'progress_bar')) {
        $result['progress_status'] = 0;
        $result['progressStatus'] = 0;
        // The storefront widget also falls back to an `enabled` flag baked
        // into progress_data itself (admin always saves pb.enabled there
        // regardless of plan) — strip it too or the top-level flags above
        // do nothing and the widget still renders.
        $progressData = json_decode($result['progress_data'] ?? '', true);
        if (is_array($progressData)) {
            $progressData['enabled'] = false;
            $result['progress_data'] = json_encode($progressData, JSON_UNESCAPED_UNICODE);
        }
    } elseif (!plan_can_publish_feature($planKey, 'confetti')) {
        // Progress bar itself is allowed, but confetti specifically is not
        // (e.g. plan differences between the two features in the future).
        $progressData = json_decode($result['progress_data'] ?? '', true);
        if (is_array($progressData)) {
            $progressData['confetti'] = false;
            $progressData['enableConfetti'] = false;
            $result['progress_data'] = json_encode($progressData, JSON_UNESCAPED_UNICODE);
        }
    }

    // ---- AI Cart Upsell ----
    if (!plan_can_publish_feature($planKey, 'ai_cart_upsell')) {
        $result['upsell_status'] = 0;
        $result['upsellStatus'] = 0;
        // Same embedded-flag leak as progress bar above.
        $upsellData = json_decode($result['upsell_data'] ?? '', true);
        if (is_array($upsellData)) {
            $upsellData['enabled'] = false;
            $result['upsell_data'] = json_encode($upsellData, JSON_UNESCAPED_UNICODE);
        }
    }

    // ---- Custom CSS ----
    if (!plan_can_publish_feature($planKey, 'custom_css')) {
        $result['customCSS'] = null;
    }

    // ---- Mobile Swipe Checkout ----
    if (!plan_can_publish_feature($planKey, 'mobile_swipe_checkout')) {
        $checkoutStyle = json_decode($result['checkout_button_style'] ?? '', true);
        if (is_array($checkoutStyle) && isset($checkoutStyle['mobileButtonType']) && $checkoutStyle['mobileButtonType'] === 'swipe') {
            $checkoutStyle['mobileButtonType'] = 'standard';
            $result['checkout_button_style'] = json_encode($checkoutStyle, JSON_UNESCAPED_UNICODE);
        }
    }

    // ---- Open Countdown (per-coupon timer inside coupon_data.selectedCoupons) ----
    if (!plan_can_publish_feature($planKey, 'open_countdown')) {
        $couponData = json_decode($result['coupon_data'] ?? '', true);
        if (is_array($couponData) && !empty($couponData['selectedCoupons']) && is_array($couponData['selectedCoupons'])) {
            $couponData['selectedCoupons'] = array_map(function ($coupon) {
                if (is_array($coupon)) {
                    $coupon['timerEnabled'] = false;
                }
                return $coupon;
            }, $couponData['selectedCoupons']);
            $result['coupon_data'] = json_encode($couponData, JSON_UNESCAPED_UNICODE);
        }
    }

    return $result;
}

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
        ensureWatermarkColumn($pdo);
        $stmt = $pdo->prepare("
            SELECT cd.*,
              cdc.announcement_enabled, cdc.announcement_text, cdc.announcement_bg_color,
              cdc.announcement_text_color, cdc.announcement_font_size,
              cdc.header_title, cdc.header_bg_color, cdc.header_text_color, cdc.header_border_bottom,
              cdc.design_animation, cdc.design_border_radius, cdc.design_shadow, cdc.design_width,
              cdc.empty_cart_message, cdc.empty_cart_show_continue_shopping, cdc.empty_cart_show_recommendations
            FROM cart_drawer cd
            LEFT JOIN cart_drawer_config cdc ON cdc.shop_domain = cd.shop COLLATE utf8mb4_unicode_ci
            WHERE cd.shop = :shop
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

        $planKey = resolve_plan_key($pdo, $shopDomain);
        $result = applyPlanGatingToCartDrawerResult($result, $planKey);

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
$watermarkEnabled = normalizeFlag($payload['watermark_enabled'] ?? ($settingsData['watermarkEnabled'] ?? 1), 1);

// ===== PLAN ENFORCEMENT (defense-in-depth) =====
// The admin UI lets a Free merchant fully customize/save these design-type
// fields (no editing block), but never lets them publish. This endpoint is
// what actually enforces that, and it can also be hit directly (e.g. by a
// merchant on the Free plan bypassing the UI entirely). Force
// the gated sub-fields to a disabled/neutral value before persisting so a
// direct POST can't silently turn on a feature the shop's plan doesn't
// allow. The GET handler above also re-strips on the way out, so even a
// row saved while on a paid plan won't leak these to the storefront after
// a downgrade.
$planKey = resolve_plan_key($pdo, $shop);
ensureWatermarkColumn($pdo);

// Free plan cannot disable the watermark — force it on regardless of what
// the merchant's toggle submitted.
$planConfigForWatermark = plan_get_config($planKey);
if (empty($planConfigForWatermark['watermarkRemovable'])) {
    $watermarkEnabled = 1;
}

if (!plan_can_publish_feature($planKey, 'progress_bar')) {
    $progressStatus = 0;
    $progressDataArr = json_decode($progressData ?? '', true);
    if (is_array($progressDataArr)) {
        $progressDataArr['enabled'] = false;
        $progressData = json_encode($progressDataArr, JSON_UNESCAPED_UNICODE);
    }
} elseif (!plan_can_publish_feature($planKey, 'confetti')) {
    $progressDataArr = json_decode($progressData ?? '', true);
    if (is_array($progressDataArr)) {
        $progressDataArr['confetti'] = false;
        $progressDataArr['enableConfetti'] = false;
        $progressData = json_encode($progressDataArr, JSON_UNESCAPED_UNICODE);
    }
}

if (!plan_can_publish_feature($planKey, 'ai_cart_upsell')) {
    $upsellStatus = 0;
    $upsellDataArr = json_decode($upsellData ?? '', true);
    if (is_array($upsellDataArr)) {
        $upsellDataArr['enabled'] = false;
        $upsellData = json_encode($upsellDataArr, JSON_UNESCAPED_UNICODE);
    }
}

if (!plan_can_publish_feature($planKey, 'custom_css')) {
    $customCSS = null;
}

if (!plan_can_publish_feature($planKey, 'mobile_swipe_checkout')) {
    $checkoutStyleArr = json_decode($checkoutButtonStyle ?? '', true);
    if (is_array($checkoutStyleArr) && ($checkoutStyleArr['mobileButtonType'] ?? null) === 'swipe') {
        $checkoutStyleArr['mobileButtonType'] = 'standard';
        $checkoutButtonStyle = json_encode($checkoutStyleArr, JSON_UNESCAPED_UNICODE);
    }
}

if (!plan_can_publish_feature($planKey, 'open_countdown')) {
    $couponDataArr = json_decode($couponData ?? '', true);
    if (is_array($couponDataArr) && !empty($couponDataArr['selectedCoupons']) && is_array($couponDataArr['selectedCoupons'])) {
        $couponDataArr['selectedCoupons'] = array_map(function ($coupon) {
            if (is_array($coupon)) {
                $coupon['timerEnabled'] = false;
            }
            return $coupon;
        }, $couponDataArr['selectedCoupons']);
        $couponData = json_encode($couponDataArr, JSON_UNESCAPED_UNICODE);
    }
}

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
    watermark_enabled,
    progress_updated_at,
    coupon_updated_at,
    upsell_updated_at,
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
    :watermark_enabled,
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3),
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
    watermark_enabled = VALUES(watermark_enabled),
    progress_updated_at = IF(VALUES(progress_data) IS NOT NULL, CURRENT_TIMESTAMP(3), progress_updated_at),
    coupon_updated_at    = IF(VALUES(coupon_data)   IS NOT NULL, CURRENT_TIMESTAMP(3), coupon_updated_at),
    upsell_updated_at    = IF(VALUES(upsell_data)   IS NOT NULL, CURRENT_TIMESTAMP(3), upsell_updated_at),
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
        ':upsell_status' => $upsellStatus,
        ':watermark_enabled' => $watermarkEnabled
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