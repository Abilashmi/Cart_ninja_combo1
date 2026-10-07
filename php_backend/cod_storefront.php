<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/plan_helpers.php';

/**
 * BRIX COD Checkout — public storefront reads, called by
 * extensions/cart-drawer/assets/brix_cod.js straight from the shopper's
 * browser (like save_cart_drawer.php). Read-only; no secret.
 *
 *   GET ?action=config&shop=<shop>.myshopify.com
 *       → { success, enabled: false }  or  { success, enabled: true, surfaces, otpRequired, minOrder, ... }
 *   GET ?action=pincode&shop=<shop>&pin=560001
 *       → { success, pincode, found, city, state, blocked }
 *
 * Settings are written by the Node app through cod_settings.php. Only display
 * hints are returned here; every rule is enforced again by the Node app when
 * the order is priced and placed.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

function cods_fail($status, $code, $error) {
    http_response_code($status);
    header('Cache-Control: no-store');
    echo json_encode(['success' => false, 'code' => $code, 'error' => $error]);
    exit;
}

function cods_ok($body, $maxAge) {
    header('Cache-Control: public, max-age=' . (int)$maxAge);
    echo json_encode(array_merge(['success' => true], $body));
    exit;
}

/** Stored settings for the shop (as saved by Node), or null. Never throws. */
function cods_settings($pdo, $shop) {
    try {
        $stmt = $pdo->prepare('SELECT settings_json FROM cod_settings WHERE shop = ? LIMIT 1');
        $stmt->execute([$shop]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        $settings = $row ? json_decode($row['settings_json'], true) : null;
        return is_array($settings) ? $settings : null;
    } catch (Throwable $e) {
        error_log('[cod_storefront] ' . $e->getMessage());  // table not created yet, DB hiccup → COD off
        return null;
    }
}

function cods_num($value) {
    return is_numeric($value) && $value > 0 ? round((float)$value, 2) : 0;
}

function cods_str_list($value) {
    return array_values(array_filter(array_map('strval', is_array($value) ? $value : []), 'strlen'));
}

// Look of the shopper's COD popup. Mirrors sanitizeCodSettings' "sheet" rules
// (app/utils/cod.shared.js): the logo must be an https URL or a small raster
// data URL, since brix_cod.js puts it straight into an <img src>.
function cods_sheet($sheet) {
    $q = is_array($sheet) ? $sheet : [];
    $logo = (string)($q['logo'] ?? '');
    $logoOk = (strlen($logo) <= 40000 && preg_match('#^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$#', $logo))
        || preg_match('#^https://[^\s"\'<>()\\\\]{1,500}$#', $logo);
    $accent = (string)($q['accent'] ?? '');
    return [
        'logo' => $logoOk ? $logo : '',
        'logoSize' => in_array($q['logoSize'] ?? '', ['sm', 'md', 'lg'], true) ? $q['logoSize'] : 'md',
        'accent' => preg_match('/^#[0-9a-f]{3}([0-9a-f]{3})?$/i', $accent) ? $accent : '',
        'radius' => in_array($q['radius'] ?? '', ['rounded', 'soft', 'sharp'], true) ? $q['radius'] : 'rounded',
        'showSummary' => ($q['showSummary'] ?? true) !== false,
        'showTrust' => ($q['showTrust'] ?? true) !== false,
        'thankYouText' => mb_substr((string)($q['thankYouText'] ?? ''), 0, 120),
        'showCoupon' => ($q['showCoupon'] ?? true) !== false,
        'couponLabel' => mb_substr(trim((string)($q['couponLabel'] ?? '')), 0, 40) ?: 'Have a coupon code?',
        'couponOpen' => !empty($q['couponOpen']),
        'offers' => cods_offers($q['offers'] ?? []),
    ];
}

// The product page button: replace "Buy it now" + spacing in px. Mirrors
// sanitizeCodSettings' "productButton" rules (COD_PRODUCT_BUTTON_LIMITS).
function cods_product_button($pb) {
    $q = is_array($pb) ? $pb : [];
    $size = function ($key, $default, $min, $max) use ($q) {
        return is_numeric($q[$key] ?? null) ? max($min, min($max, (int)$q[$key])) : $default;
    };
    return [
        'replaceBuyNow' => ($q['replaceBuyNow'] ?? true) !== false,
        'marginTop' => $size('marginTop', 10, 0, 60),
        'marginBottom' => $size('marginBottom', 0, 0, 60),
        'paddingY' => $size('paddingY', 14, 4, 32),
        'paddingX' => $size('paddingX', 16, 4, 48),
        'radius' => $size('radius', 12, 0, 40),
    ];
}

// One of the allowed values, else the default. Mirrors sanitizeCodSettings' pick().
function cods_enum($value, $allowed, $default) {
    return in_array($value, $allowed, true) ? $value : $default;
}

// Theme drawer Checkout button selector (advanced). Same character set as
// isValidDrawerSelector in app/utils/cod.shared.js; brix_cod.js only ever
// passes it to querySelectorAll.
function cods_selector($value) {
    $v = trim((string)$value);
    return preg_match('#^[\w\s\-.:\[\]="\'>~+*(),^$|/\#]{1,200}$#', $v) ? $v : '';
}

function cods_offers($offers) {
    $out = [];
    $seen = [];
    foreach (is_array($offers) ? $offers : [] as $o) {
        if (!is_array($o)) continue;
        $code = trim((string)($o['code'] ?? ''));
        if (!preg_match('/^[\w-]{1,60}$/', $code) || isset($seen[strtolower($code)])) continue;
        $seen[strtolower($code)] = true;
        $out[] = ['code' => $code, 'text' => mb_substr(trim((string)($o['text'] ?? '')), 0, 80)];
        if (count($out) >= 5) break;
    }
    return $out;
}

// GA4 / Meta Pixel IDs for the popup's browser events. Public IDs only — the
// GA4 API secret and Meta Conversions API token live in cod_secrets and are
// never read by this file. Mirrors sanitizeCodSettings' "tracking" rules.
function cods_tracking($tracking) {
    $t = is_array($tracking) ? $tracking : [];
    $ga4 = strtoupper(trim((string)($t['ga4Id'] ?? '')));
    $pixel = trim((string)($t['metaPixelId'] ?? ''));
    return [
        'ga4Id' => preg_match('/^G-[A-Z0-9]{4,12}$/', $ga4) ? $ga4 : '',
        'metaPixelId' => preg_match('/^\d{10,20}$/', $pixel) ? $pixel : '',
        'metaContentId' => in_array($t['metaContentId'] ?? '', ['shopify', 'variant', 'sku'], true) ? $t['metaContentId'] : 'shopify',
        'dataLayer' => ($t['dataLayer'] ?? true) !== false,
    ];
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'GET') cods_fail(405, 'method_not_allowed', 'GET only');

$shop = strtolower(trim((string)($_GET['shop'] ?? '')));
if (!preg_match('/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/', $shop)) cods_fail(400, 'invalid_shop', 'A valid shop is required.');
$action = $_GET['action'] ?? 'config';

if ($action === 'config') {
    $s = cods_settings($pdo, $shop);
    $live = false;
    if ($s && !empty($s['enabled'])) {
        try {
            $live = plan_get_feature_state(resolve_plan_key($pdo, $shop), 'cod_checkout') === 'enabled';
        } catch (Throwable $e) {
            error_log('[cod_storefront] plan lookup: ' . $e->getMessage());
        }
    }
    if (!$live) cods_ok(['enabled' => false], 30);

    $surfaces = is_array($s['surfaces'] ?? null) ? $s['surfaces'] : [];
    $buttons = is_array($s['buttons'] ?? null) ? $s['buttons'] : [];
    // Settings saved before the fee switch existed charged codFee whenever it was set.
    $feeOn = array_key_exists('codFeeEnabled', $s) ? !empty($s['codFeeEnabled']) : true;
    $feeLabel = mb_substr(trim((string)($s['codFeeLabel'] ?? '')), 0, 40);
    cods_ok([
        'enabled' => true,
        'surfaces' => [
            'drawer' => ($surfaces['drawer'] ?? true) !== false,
            'product' => ($surfaces['product'] ?? true) !== false,
            'combo' => ($surfaces['combo'] ?? true) !== false,
        ],
        // OTP is asked only when the merchant wants it AND the Node app has an
        // SMS provider (Node records that in _runtime whenever it saves).
        'otpRequired' => !empty($s['requireOtp']) && !empty($s['_runtime']['otpAvailable']),
        'minOrder' => cods_num($s['minOrder'] ?? 0),
        'maxOrder' => cods_num($s['maxOrder'] ?? 0),
        'drawerPlacement' => cods_enum($s['drawerPlacement'] ?? '', ['replace', 'above', 'below'], 'above'),
        'drawerSelector' => cods_selector($s['drawerSelector'] ?? ''),
        // The fee actually charged (0 while the fee switch is off).
        'codFee' => $feeOn ? cods_num($s['codFee'] ?? 0) : 0,
        'showCodFee' => ($s['showCodFee'] ?? true) !== false,
        'codFeeLabel' => $feeLabel !== '' ? $feeLabel : 'Cash on Delivery Fee',
        'shippingFee' => cods_num($s['shippingFee'] ?? 0),
        'freeShippingAbove' => cods_num($s['freeShippingAbove'] ?? 0),
        'blockedPincodes' => cods_str_list($s['blockedPincodes'] ?? []),
        'excludedProductTags' => cods_str_list($s['excludedProductTags'] ?? []),
        'excludedBehavior' => cods_enum($s['excludedBehavior'] ?? '', ['unavailable', 'hide'], 'unavailable'),
        'allowCoupons' => ($s['allowCoupons'] ?? true) !== false,
        'prepaidNudgeText' => (string)($s['prepaidNudgeText'] ?? ''),
        'buttons' => [
            'drawerText' => (string)($buttons['drawerText'] ?? 'Cash on Delivery'),
            'productText' => (string)($buttons['productText'] ?? 'Buy with Cash on Delivery'),
            'bg' => preg_match('/^#[0-9a-f]{3}([0-9a-f]{3})?$/i', $buttons['bg'] ?? '') ? $buttons['bg'] : '#111827',
            'color' => preg_match('/^#[0-9a-f]{3}([0-9a-f]{3})?$/i', $buttons['color'] ?? '') ? $buttons['color'] : '#ffffff',
            'style' => cods_enum($buttons['style'] ?? '', ['filled', 'outline', 'minimal'], 'filled'),
            'radius' => is_numeric($buttons['radius'] ?? null) ? max(0, min(40, (int)$buttons['radius'])) : 12,
        ],
        'productButton' => cods_product_button($s['productButton'] ?? null),
        'sheet' => cods_sheet($s['sheet'] ?? null),
        'tracking' => cods_tracking($s['tracking'] ?? null),
    ], 30);
}

if ($action === 'pincode') {
    $pin = trim((string)($_GET['pin'] ?? ''));
    if (!preg_match('/^[1-9]\d{5}$/', $pin)) cods_fail(400, 'invalid_pincode', 'Enter a valid 6-digit PIN code.');
    $s = cods_settings($pdo, $shop);
    $blocked = in_array($pin, cods_str_list($s['blockedPincodes'] ?? []), true);

    // City/state from India Post. If that lookup fails the shopper types them in.
    $city = '';
    $state = '';
    $ch = curl_init('https://api.postalpincode.in/pincode/' . $pin);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 4, CURLOPT_CONNECTTIMEOUT => 3]);
    $raw = curl_exec($ch);
    curl_close($ch);
    $data = $raw ? json_decode($raw, true) : null;
    if (is_array($data) && ($data[0]['Status'] ?? '') === 'Success' && !empty($data[0]['PostOffice'][0])) {
        $office = $data[0]['PostOffice'][0];
        $city = (string)($office['District'] ?? ($office['Block'] ?? ''));
        $state = (string)($office['State'] ?? '');
    }
    cods_ok(['pincode' => $pin, 'found' => $state !== '', 'city' => $city, 'state' => $state, 'blocked' => $blocked], 300);
}

cods_fail(400, 'invalid_action', 'Unknown action');
