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

// Self-heals the Countdown Timer columns onto coupon_slider_widget — this
// endpoint used to have no columns for them at all, so the admin page's
// "Countdown Timer" section (Enable countdown timer / hours / minutes /
// label / colors) was saved from the browser, POSTed here, and silently
// dropped: nothing in the INSERT below referenced them, so the timer looked
// configured in the admin session but was never actually persisted — the
// next page load (or the very next unrelated save) reverted to "off" with
// no error shown anywhere. Column names deliberately match the JS payload's
// own field names (timerEnabled/timerHours/...) so the GET response's raw
// row can be handed straight back to the client with no renaming step.
function ensureTimerColumns($pdo) {
    static $ensured = false;
    if ($ensured) return;
    $pdo->exec("
        ALTER TABLE coupon_slider_widget
            ADD COLUMN IF NOT EXISTS timerEnabled TINYINT(1) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS timerHours INT NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS timerMins INT NOT NULL DEFAULT 15,
            ADD COLUMN IF NOT EXISTS timerLabel VARCHAR(255) NOT NULL DEFAULT 'Offer expires in',
            ADD COLUMN IF NOT EXISTS timerExpired VARCHAR(255) NOT NULL DEFAULT 'Offer expired!',
            ADD COLUMN IF NOT EXISTS timerBg VARCHAR(20) NOT NULL DEFAULT '#fef2f2',
            ADD COLUMN IF NOT EXISTS timerText VARCHAR(20) NOT NULL DEFAULT '#991b1b',
            ADD COLUMN IF NOT EXISTS timerAccent VARCHAR(20) NOT NULL DEFAULT '#dc2626',
            ADD COLUMN IF NOT EXISTS timerMode VARCHAR(10) NOT NULL DEFAULT 'session'
    ");
    $ensured = true;
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
        ensureTimerColumns($pdo);
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
        // Free plan order-cap cutoff: once a capped, zero-overage-rate plan
        // crosses its monthly order cap, storefront widgets pause for the
        // rest of the month — see plan_order_cap_exceeded() in plan_helpers.php.
        $result['is_enabled'] = ($result['is_enabled'] && plan_can_publish_feature($planKey, 'coupon_lock_pro') && !plan_order_cap_exceeded($pdo, $shopDomain, $planKey)) ? 1 : 0;

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

// The admin page only ever sends ONE template's styles per save — whichever
// is currently selected (see app.productwidget.jsx's submitCouponConfig,
// which builds a single flat `template` object keyed by the active
// `activeTemplate`, never all three). Before this fetch existed, the two
// templates NOT included in a given save had no source anywhere in
// $payload, so their computed value fell all the way through to null —
// and the INSERT below unconditionally applied that null via
// `tempNDefaultStyle = VALUES(tempNDefaultStyle)`, wiping out whatever
// customization was previously saved for them on every single save. That's
// the actual cause behind "the preview shows a placeholder instead of what
// was last configured" — the merchant's real Minimal Card customization,
// say, gets nulled out the next time they save anything while looking at
// Classic Banner or Bold & Vibrant.
$existingTemplateRow = [];
try {
    $existStmt = $pdo->prepare('
        SELECT temp1DefaultStyle, temp2DefaultStyle, temp3DefaultStyle,
               temp1CouponStyle, temp2CouponStyle, temp3CouponStyle,
               temp1CouponCondition, temp2CouponCondition, temp3CouponCondition
        FROM coupon_slider_widget WHERE shopDomain = :shopDomain LIMIT 1
    ');
    $existStmt->execute([':shopDomain' => $shopDomain]);
    $existingTemplateRow = $existStmt->fetch() ?: [];
} catch (PDOException $e) {
    logError('Failed to fetch existing row before partial template save', ['error' => $e->getMessage()]);
}

$template1Present = array_key_exists('template1', $payload);
$template2Present = array_key_exists('template2', $payload);
$template3Present = array_key_exists('template3', $payload);

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

// Only encode this save's computed value for a template that was actually
// present in the payload; otherwise keep the existing stored value exactly
// as-is so an untouched template is never silently cleared.
$temp1DefaultStyle = $template1Present ? encodeForJsonColumn(decodeIfJsonString($temp1DefaultStyleSource)) : ($existingTemplateRow['temp1DefaultStyle'] ?? null);
$temp2DefaultStyle = $template2Present ? encodeForJsonColumn(decodeIfJsonString($temp2DefaultStyleSource)) : ($existingTemplateRow['temp2DefaultStyle'] ?? null);
$temp3DefaultStyle = $template3Present ? encodeForJsonColumn(decodeIfJsonString($temp3DefaultStyleSource)) : ($existingTemplateRow['temp3DefaultStyle'] ?? null);

$temp1CouponStyle = $template1Present ? encodeForJsonColumn(decodeIfJsonString($temp1CouponStyleSource)) : ($existingTemplateRow['temp1CouponStyle'] ?? null);
$temp2CouponStyle = $template2Present ? encodeForJsonColumn(decodeIfJsonString($temp2CouponStyleSource)) : ($existingTemplateRow['temp2CouponStyle'] ?? null);
$temp3CouponStyle = $template3Present ? encodeForJsonColumn(decodeIfJsonString($temp3CouponStyleSource)) : ($existingTemplateRow['temp3CouponStyle'] ?? null);

$temp1CouponCondition = $template1Present ? encodeForJsonColumn(decodeIfJsonString($temp1CouponConditionSource)) : ($existingTemplateRow['temp1CouponCondition'] ?? null);
$temp2CouponCondition = $template2Present ? encodeForJsonColumn(decodeIfJsonString($temp2CouponConditionSource)) : ($existingTemplateRow['temp2CouponCondition'] ?? null);
$temp3CouponCondition = $template3Present ? encodeForJsonColumn(decodeIfJsonString($temp3CouponConditionSource)) : ($existingTemplateRow['temp3CouponCondition'] ?? null);

$timerEnabled = payloadValue($payload, ['timerEnabled'], false) ? 1 : 0;
$timerHours = (int) payloadValue($payload, ['timerHours'], 0);
$timerMins = (int) payloadValue($payload, ['timerMins'], 15);
$timerLabel = (string) payloadValue($payload, ['timerLabel'], 'Offer expires in');
$timerExpired = (string) payloadValue($payload, ['timerExpired'], 'Offer expired!');
$timerBg = (string) payloadValue($payload, ['timerBg'], '#fef2f2');
$timerText = (string) payloadValue($payload, ['timerText'], '#991b1b');
$timerAccent = (string) payloadValue($payload, ['timerAccent'], '#dc2626');

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

try {
    ensureTimerColumns($pdo);
} catch (PDOException $e) {
    logError('ensureTimerColumns failed', ['error' => $e->getMessage()]);
}

// 'session' (restarts each visit, then shows the expired label) or 'loop'
// (starts again from the full time whenever it reaches zero). A save that
// doesn't send it (e.g. BRIX's Coupon Banner tool) keeps the saved mode.
$timerMode = payloadValue($payload, ['timerMode'], null);
if (!in_array($timerMode, ['session', 'loop'], true)) {
    $timerMode = 'session';
    try {
        $modeStmt = $pdo->prepare('SELECT timerMode FROM coupon_slider_widget WHERE shopDomain = :shopDomain LIMIT 1');
        $modeStmt->execute([':shopDomain' => $shopDomain]);
        $savedMode = $modeStmt->fetchColumn();
        if (in_array($savedMode, ['session', 'loop'], true)) $timerMode = $savedMode;
    } catch (PDOException $e) {
        logError('Failed to read saved timerMode', ['error' => $e->getMessage()]);
    }
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
    timerEnabled,
    timerHours,
    timerMins,
    timerLabel,
    timerExpired,
    timerBg,
    timerText,
    timerAccent,
    timerMode,
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
    :timerEnabled,
    :timerHours,
    :timerMins,
    :timerLabel,
    :timerExpired,
    :timerBg,
    :timerText,
    :timerAccent,
    :timerMode,
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
    timerEnabled = VALUES(timerEnabled),
    timerHours = VALUES(timerHours),
    timerMins = VALUES(timerMins),
    timerLabel = VALUES(timerLabel),
    timerExpired = VALUES(timerExpired),
    timerBg = VALUES(timerBg),
    timerText = VALUES(timerText),
    timerAccent = VALUES(timerAccent),
    timerMode = VALUES(timerMode),
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
        ':temp3CouponCondition'   => $temp3CouponCondition,
        ':timerEnabled'           => $timerEnabled,
        ':timerHours'             => $timerHours,
        ':timerMins'              => $timerMins,
        ':timerLabel'             => $timerLabel,
        ':timerExpired'           => $timerExpired,
        ':timerBg'                => $timerBg,
        ':timerText'              => $timerText,
        ':timerAccent'            => $timerAccent,
        ':timerMode'              => $timerMode
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
