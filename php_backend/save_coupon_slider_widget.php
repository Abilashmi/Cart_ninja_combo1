<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/plan_helpers.php';

$requestMethod = $_SERVER['REQUEST_METHOD'] ?? 'UNKNOWN';

// ===== ERROR LOG FUNCTION =====
function logToFile($fileName, $message, $context = []) {
    $logDir = __DIR__ . '/logs';
    if (!is_dir($logDir)) {
        mkdir($logDir, 0777, true);
    }

    $logFile = $logDir . '/' . $fileName;

    $logData = [
        "timestamp" => date("Y-m-d H:i:s"),
        "message"   => $message,
        "context"   => $context
    ];

    file_put_contents(
        $logFile,
        json_encode($logData, JSON_PRETTY_PRINT) . "\n---\n",
        FILE_APPEND
    );
}

function logError($message, $context = []) {
    logToFile('coupon_slider_error.log', $message, $context);
}

function logRequest($message, $context = []) {
    logToFile('coupon_slider_request.log', $message, $context);
}

function decodeIfJsonString($value) {
    if (!is_string($value)) {
        return $value;
    }

    $trimmed = trim($value);
    if ($trimmed === '') {
        return $value;
    }

    $decoded = json_decode($trimmed, true);
    if (json_last_error() === JSON_ERROR_NONE) {
        return $decoded;
    }

    return $value;
}

function encodeForJsonColumn($value) {
    if ($value === null) {
        return null;
    }

    if (is_string($value)) {
        $trimmed = trim($value);

        if ($trimmed === '') {
            return null;
        }

        $decoded = json_decode($trimmed, true);
        if (json_last_error() === JSON_ERROR_NONE) {
            return $trimmed;
        }

        return json_encode($value);
    }

    if (is_array($value) || is_object($value)) {
        return json_encode($value);
    }

    return json_encode($value);
}

function payloadValue($payload, $keys, $default = null) {
    foreach ($keys as $key) {
        if (array_key_exists($key, $payload)) {
            return $payload[$key];
        }
    }

    return $default;
}

function extractCouponIdentifier($value) {
    if (is_string($value) || is_numeric($value)) {
        $normalized = trim((string)$value);
        return $normalized !== '' ? $normalized : null;
    }

    if (!is_array($value)) {
        return null;
    }

    $preferredKeys = ['couponId', 'id', 'shopifyId', 'code', 'title'];
    foreach ($preferredKeys as $key) {
        if (isset($value[$key]) && $value[$key] !== '') {
            $normalized = trim((string)$value[$key]);
            if ($normalized !== '') {
                return $normalized;
            }
        }
    }

    return null;
}

function normalizeSelectedTemplateCoupon($value, $maxLength = 50) {
    $decodedValue = decodeIfJsonString($value);
    $candidate = extractCouponIdentifier($decodedValue);

    if ($candidate === null && is_array($decodedValue) && !empty($decodedValue)) {
        $firstItem = reset($decodedValue);
        $candidate = extractCouponIdentifier($firstItem);
    }

    if ($candidate === null || $candidate === '') {
        return null;
    }

    return substr($candidate, 0, $maxLength);
}

$rawInput = file_get_contents('php://input');
$rawInputPreview = null;

if (!empty($rawInput)) {
    $rawInputPreview = substr($rawInput, 0, 5000);
    if (strlen($rawInput) > 5000) {
        $rawInputPreview .= '...[truncated]';
    }
}

logRequest('Endpoint hit', [
    'method' => $requestMethod,
    'requestUri' => $_SERVER['REQUEST_URI'] ?? null,
    'query' => $_GET,
    'payloadPreview' => $rawInputPreview
]);

/* ============================================================
   ======================= GET REQUEST ========================
   ============================================================ */

if ($requestMethod === 'GET') {

    $shopDomain = $_GET['shopdomain'] ?? ($_GET['shopDomain'] ?? null);

    if (!$shopDomain) {
        logError('GET missing shopdomain', ['query' => $_GET]);
        http_response_code(400);
        echo json_encode([
            'status' => 'error',
            'message' => 'shopdomain parameter required'
        ]);
        exit;
    }

    try {
        $stmt = $pdo->prepare('
            SELECT *
            FROM coupon_slider_widget
            WHERE shopDomain = :shopDomain
            LIMIT 1
        ');

        $stmt->execute([':shopDomain' => $shopDomain]);
        $result = $stmt->fetch();

        if (!$result) {
            logRequest('GET no data', ['shopDomain' => $shopDomain]);
            echo json_encode([
                'status' => 'error',
                'message' => 'No data found for this shop'
            ]);
            exit;
        }

        $jsonFields = [
            'temp1DefaultStyle',
            'temp2DefaultStyle',
            'temp3DefaultStyle',
            'selectedTemplateCoupon',
            'temp1CouponStyle',
            'temp2CouponStyle',
            'temp3CouponStyle',
            'temp1CouponCondition',
            'temp2CouponCondition',
            'temp3CouponCondition'
        ];

        foreach ($jsonFields as $field) {
            if (!empty($result[$field])) {
                $decoded = json_decode($result[$field], true);
                if (json_last_error() === JSON_ERROR_NONE) {
                    $result[$field] = $decoded;
                }
            }
        }

        // Return all selected coupons as an array (+ single alias for older consumers).
        $rawSelected = $result['selectedTemplateCoupon'] ?? null;
        // It may already be json-decoded into an array earlier in this handler.
        $decodedSelected = is_array($rawSelected) ? $rawSelected
            : (is_string($rawSelected) ? json_decode($rawSelected, true) : null);
        if (is_array($decodedSelected)) {
            $globalIds = array_values(array_filter(array_map(function ($x) {
                return is_string($x) ? trim($x) : '';
            }, $decodedSelected), function ($x) { return $x !== ''; }));
            $result['selectedCouponsGlobal'] = $globalIds;
            $result['selectedTemplateCoupon'] = $globalIds[0] ?? null;
        } else {
            $normalizedSelectedCoupon = normalizeSelectedTemplateCoupon($rawSelected);
            $result['selectedTemplateCoupon'] = $normalizedSelectedCoupon;
            $result['selectedCouponsGlobal'] = $normalizedSelectedCoupon !== null ? [$normalizedSelectedCoupon] : [];
        }

        // Also fetch placement/position from coupon_slider_settings
        try {
            $settingsStmt = $pdo->prepare('SELECT position, is_enabled, layout FROM coupon_slider_settings WHERE shop_domain = ? LIMIT 1');
            $settingsStmt->execute([$shopDomain]);
            $settings = $settingsStmt->fetch();
            $result['widgetPlacement'] = $settings['position'] ?? 'above_cart';
            $result['is_enabled'] = $settings['is_enabled'] ?? 1;
            $result['layout'] = $settings['layout'] ?? 'list';
        } catch (PDOException $e) {
            $result['widgetPlacement'] = 'above_cart';
            $result['layout'] = 'list';
        }

        // Enforce plan gating: Coupon Lock Pro is 'preview' on Free — merchant can
        // design/save it, but it must not render on the storefront until they
        // upgrade. Only the response is mutated; the stored row is left untouched.
        $planKey = resolve_plan_key($pdo, $shopDomain);
        $result['is_enabled'] = ($result['is_enabled'] && plan_can_publish_feature($planKey, 'coupon_lock_pro')) ? 1 : 0;

        echo json_encode([
            'status' => 'success',
            'data' => $result
        ]);

        logRequest('GET fetch success', ['shopDomain' => $shopDomain]);

    } catch (PDOException $e) {
        logError('GET fetch failed', [
            'shopDomain' => $shopDomain,
            'error' => $e->getMessage()
        ]);
        http_response_code(500);
        echo json_encode([
            'status' => 'error',
            'message' => 'Fetch failed: ' . $e->getMessage()
        ]);
    }

    exit;
}

/* ============================================================
   ======================= POST REQUEST =======================
   ============================================================ */

if ($requestMethod !== 'POST') {
    logError('Method not allowed', ['method' => $requestMethod]);
    http_response_code(405);
    echo json_encode([
        'status' => 'error',
        'message' => 'Method not allowed'
    ]);
    exit;
}

if (empty($rawInput)) {
    logError('POST empty payload', ['method' => $requestMethod]);
    http_response_code(400);
    echo json_encode([
        'status' => 'error',
        'message' => 'Empty payload'
    ]);
    exit;
}

$data = json_decode($rawInput, true);

if (json_last_error() !== JSON_ERROR_NONE) {
    logError('POST invalid JSON', ['jsonError' => json_last_error_msg()]);
    http_response_code(400);
    echo json_encode([
        'status' => 'error',
        'message' => 'Invalid JSON: ' . json_last_error_msg()
    ]);
    exit;
}

$payload = isset($data['payload']) ? $data['payload'] : $data;

if (is_string($payload) && trim($payload) !== '') {
    $decodedPayload = json_decode($payload, true);
    if (json_last_error() === JSON_ERROR_NONE && is_array($decodedPayload)) {
        $payload = $decodedPayload;
    }
}

if (!is_array($payload)) {
    logError('POST invalid payload object', [
        'payloadType' => gettype($payload)
    ]);
    http_response_code(400);
    echo json_encode([
        'status' => 'error',
        'message' => 'Payload must be an object'
    ]);
    exit;
}

$shopDomain = payloadValue($payload, ['shopDomain', 'shopdomain', 'shop'], null);

if (!$shopDomain) {
    logError('POST missing shopDomain', ['payload' => $payload]);
    http_response_code(400);
    echo json_encode([
        'status' => 'error',
        'message' => 'shopDomain required'
    ]);
    exit;
}

$template1 = decodeIfJsonString($payload['template1'] ?? []);
$template2 = decodeIfJsonString($payload['template2'] ?? []);
$template3 = decodeIfJsonString($payload['template3'] ?? []);

$template1 = is_array($template1) ? $template1 : [];
$template2 = is_array($template2) ? $template2 : [];
$template3 = is_array($template3) ? $template3 : [];

$selectedTemplate = payloadValue($payload, ['selectedTemplate', 'selectedTemp'], null);

$selectedTemplateCouponSource = payloadValue(
    $payload,
    ['selectedTemplateCoupon', 'selectedCouponsGlobal', 'selectedCoupon', 'selectedCoupons'],
    null
);

$temp1DefaultStyleSource = $template1['styles'] ?? payloadValue($payload, ['temp1DefaultStyle'], null);
$temp2DefaultStyleSource = $template2['styles'] ?? payloadValue($payload, ['temp2DefaultStyle'], null);
$temp3DefaultStyleSource = $template3['styles'] ?? payloadValue($payload, ['temp3DefaultStyle'], null);

$temp1CouponStyleSource = $template1['couponStyles'] ?? ($template1['couponStyle'] ?? payloadValue($payload, ['temp1CouponStyle'], null));
$temp2CouponStyleSource = $template2['couponStyles'] ?? ($template2['couponStyle'] ?? payloadValue($payload, ['temp2CouponStyle'], null));
$temp3CouponStyleSource = $template3['couponStyles'] ?? ($template3['couponStyle'] ?? payloadValue($payload, ['temp3CouponStyle'], null));

$temp1CouponConditionSource = $template1['couponConditions'] ?? ($template1['conditions'] ?? payloadValue($payload, ['temp1CouponCondition'], null));
$temp2CouponConditionSource = $template2['couponConditions'] ?? ($template2['conditions'] ?? payloadValue($payload, ['temp2CouponCondition'], null));
$temp3CouponConditionSource = $template3['couponConditions'] ?? ($template3['conditions'] ?? payloadValue($payload, ['temp3CouponCondition'], null));

$temp1DefaultStyle = encodeForJsonColumn(decodeIfJsonString($temp1DefaultStyleSource));
$temp2DefaultStyle = encodeForJsonColumn(decodeIfJsonString($temp2DefaultStyleSource));
$temp3DefaultStyle = encodeForJsonColumn(decodeIfJsonString($temp3DefaultStyleSource));

$temp1CouponStyle = encodeForJsonColumn(decodeIfJsonString($temp1CouponStyleSource));
$temp2CouponStyle = encodeForJsonColumn(decodeIfJsonString($temp2CouponStyleSource));
$temp3CouponStyle = encodeForJsonColumn(decodeIfJsonString($temp3CouponStyleSource));

$temp1CouponCondition = encodeForJsonColumn(decodeIfJsonString($temp1CouponConditionSource));
$temp2CouponCondition = encodeForJsonColumn(decodeIfJsonString($temp2CouponConditionSource));
$temp3CouponCondition = encodeForJsonColumn(decodeIfJsonString($temp3CouponConditionSource));

// Support multiple coupons: store a JSON array (column is longtext). Fall back to a single id.
$globalCouponArr = $payload['selectedCouponsGlobal'] ?? null;
if (is_array($globalCouponArr)) {
    $cleanCouponIds = array_values(array_filter(array_map(function ($x) {
        return is_string($x) ? trim($x) : '';
    }, $globalCouponArr), function ($x) { return $x !== ''; }));
    $selectedTemplateCoupon = json_encode($cleanCouponIds);
} else {
    $selectedTemplateCoupon = normalizeSelectedTemplateCoupon($selectedTemplateCouponSource);
}

$sql = '
INSERT INTO coupon_slider_widget (
    shopDomain,
    temp1DefaultStyle,
    temp2DefaultStyle,
    temp3DefaultStyle,
    selectedTemplate,
    selectedTemplateCoupon,
    temp1CouponStyle,
    temp2CouponStyle,
    temp3CouponStyle,
    temp1CouponCondition,
    temp2CouponCondition,
    temp3CouponCondition,
    updated_at
) VALUES (
    :shopDomain,
    :temp1DefaultStyle,
    :temp2DefaultStyle,
    :temp3DefaultStyle,
    :selectedTemplate,
    :selectedTemplateCoupon,
    :temp1CouponStyle,
    :temp2CouponStyle,
    :temp3CouponStyle,
    :temp1CouponCondition,
    :temp2CouponCondition,
    :temp3CouponCondition,
    CURRENT_TIMESTAMP(3)
)
ON DUPLICATE KEY UPDATE
    temp1DefaultStyle = VALUES(temp1DefaultStyle),
    temp2DefaultStyle = VALUES(temp2DefaultStyle),
    temp3DefaultStyle = VALUES(temp3DefaultStyle),
    selectedTemplate = VALUES(selectedTemplate),
    selectedTemplateCoupon = VALUES(selectedTemplateCoupon),
    temp1CouponStyle = VALUES(temp1CouponStyle),
    temp2CouponStyle = VALUES(temp2CouponStyle),
    temp3CouponStyle = VALUES(temp3CouponStyle),
    temp1CouponCondition = VALUES(temp1CouponCondition),
    temp2CouponCondition = VALUES(temp2CouponCondition),
    temp3CouponCondition = VALUES(temp3CouponCondition),
    updated_at = CURRENT_TIMESTAMP(3)
';

try {
    $stmt = $pdo->prepare($sql);

    $stmt->execute([
        ':shopDomain'             => $shopDomain,
        ':temp1DefaultStyle'      => $temp1DefaultStyle,
        ':temp2DefaultStyle'      => $temp2DefaultStyle,
        ':temp3DefaultStyle'      => $temp3DefaultStyle,
        ':selectedTemplate'       => $selectedTemplate,
        ':selectedTemplateCoupon' => $selectedTemplateCoupon,
        ':temp1CouponStyle'       => $temp1CouponStyle,
        ':temp2CouponStyle'       => $temp2CouponStyle,
        ':temp3CouponStyle'       => $temp3CouponStyle,
        ':temp1CouponCondition'   => $temp1CouponCondition,
        ':temp2CouponCondition'   => $temp2CouponCondition,
        ':temp3CouponCondition'   => $temp3CouponCondition
    ]);

    echo json_encode([
        'status'  => 'success',
        'message' => 'Coupon slider widget saved successfully'
    ]);

    logRequest('POST save success', [
        'shopDomain' => $shopDomain,
        'selectedTemplate' => $selectedTemplate,
        'selectedTemplateCoupon' => $selectedTemplateCoupon
    ]);

} catch (PDOException $e) {
    logError('POST database save failed', [
        'shopDomain' => $shopDomain,
        'error' => $e->getMessage(),
        'selectedTemplateCoupon' => $selectedTemplateCoupon
    ]);
    http_response_code(500);
    echo json_encode([
        'status'  => 'error',
        'message' => 'Database save failed: ' . $e->getMessage()
    ]);
}
