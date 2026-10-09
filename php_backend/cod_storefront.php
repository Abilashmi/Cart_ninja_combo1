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
        // '' = the store's own /policies/terms-of-service (brix_cod.js).
        'termsUrl' => preg_match('#^(https://[^\s"\'<>\\\\]{1,300}|/[^\s"\'<>\\\\]{0,300})$#', trim((string)($q['termsUrl'] ?? ''))) ? trim((string)$q['termsUrl']) : '',
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
        // replace | above | below Shopify's Buy it now; saved before it existed: from replaceBuyNow.
        'buyNowPlacement' => cods_enum($q['buyNowPlacement'] ?? '', ['replace', 'above', 'below'], ($q['replaceBuyNow'] ?? true) !== false ? 'replace' : 'above'),
        // Text for Shopify's Buy it now while it shows; may hold price tags. '' = Shopify's own.
        'buyNowText' => cods_text($q['buyNowText'] ?? '', '', 60),
        // The theme's Buy it now, when BRIX can't find it by itself. '' = automatic.
        'buyNowSelector' => cods_selector($q['buyNowSelector'] ?? ''),
        'marginTop' => $size('marginTop', 10, 0, 60),
        'marginBottom' => $size('marginBottom', 0, 0, 60),
        'paddingY' => $size('paddingY', 14, 4, 32),
        'paddingX' => $size('paddingX', 16, 4, 48),
        'radius' => $size('radius', 12, 0, 40),
    ];
}

/**
 * One COD button look, re-checked: style, colours, font size, bold, capitals,
 * icon (+ radius). Anything invalid falls back to $base.
 */
function cods_button_look($raw, $base) {
    $l = is_array($raw) ? $raw : [];
    $hex = '/^#[0-9a-f]{3}([0-9a-f]{3})?$/i';
    $out = [
        'style' => cods_enum($l['style'] ?? '', ['filled', 'outline', 'minimal'], $base['style']),
        'bg' => preg_match($hex, $l['bg'] ?? '') ? $l['bg'] : $base['bg'],
        'color' => preg_match($hex, $l['color'] ?? '') ? $l['color'] : $base['color'],
        'fontSize' => is_numeric($l['fontSize'] ?? null) ? max(12, min(22, (int)$l['fontSize'])) : $base['fontSize'],
        'bold' => array_key_exists('bold', $l) ? (bool)$l['bold'] : $base['bold'],
        'uppercase' => array_key_exists('uppercase', $l) ? (bool)$l['uppercase'] : $base['uppercase'],
        'icon' => array_key_exists('icon', $l) ? (bool)$l['icon'] : $base['icon'],
    ];
    if (array_key_exists('radius', $base)) {
        $out['radius'] = is_numeric($l['radius'] ?? null) ? max(0, min(40, (int)$l['radius'])) : $base['radius'];
    }
    return $out;
}

/**
 * The COD button look for each place, resolved like codButtonLook() in
 * app/utils/cod.shared.js: product and combo use the cart drawer look while
 * their "same" is on. The product page's corners come from productButton.
 */
function cods_button_looks($buttons, $productRadius) {
    $drawer = cods_button_look($buttons, [
        'style' => 'filled', 'bg' => '#111827', 'color' => '#ffffff', 'fontSize' => 15,
        'bold' => true, 'uppercase' => false, 'icon' => true, 'radius' => 12,
    ]);
    $p = is_array($buttons['product'] ?? null) ? $buttons['product'] : [];
    $c = is_array($buttons['combo'] ?? null) ? $buttons['combo'] : null;
    $product = ($p['same'] ?? true) === false ? cods_button_look($p, $drawer) : $drawer;
    $product['radius'] = $productRadius;
    // Settings saved before combo had its own look kept the old combo look:
    // white with a dark outline, no icon.
    $comboOld = ['style' => 'outline', 'bg' => '#111827', 'color' => '#ffffff', 'fontSize' => 15, 'bold' => true, 'uppercase' => false, 'icon' => false, 'radius' => 8];
    $combo = $c === null ? $comboOld : (($c['same'] ?? false) === true ? $drawer : cods_button_look($c, $comboOld));
    return ['drawer' => $drawer, 'product' => $product, 'combo' => $combo];
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

// Merchant text: no control characters, trimmed, at most $max characters.
function cods_text($value, $default, $max) {
    if (!is_string($value)) return $default;
    $t = trim(preg_replace('/\s+/u', ' ', preg_replace('/[\x00-\x1F\x7F]/u', ' ', $value)));
    $t = mb_substr($t, 0, $max);
    return $t !== '' ? $t : $default;
}

function cods_hex($value, $default) {
    return is_string($value) && preg_match('/^#[0-9a-f]{3}([0-9a-f]{3})?$/i', $value) ? $value : $default;
}

function cods_bool($value, $default) {
    return is_bool($value) ? $value : $default;
}

/**
 * Product page payment selector (Pay Online / Cash on Delivery). Mirrors
 * sanitizeProductPayment in app/utils/product-payment.shared.js. null = off.
 *
 * The prepaid offer is passed on only when the Node app VERIFIED the BRIX
 * prepaid discount is active in Shopify (`_runtime.prepaid`, written after it
 * synced the Function's config), and with the percentage / minimum Shopify
 * really has, so shoppers are never promised a discount checkout won't give.
 * The browser never decides the discount: the Discount Function does.
 */
function cods_product_payment($s, $codLive) {
    $p = is_array($s['productPayment'] ?? null) ? $s['productPayment'] : null;
    if (!$p || ($p['enabled'] ?? false) !== true) return null;
    $on = is_array($p['online'] ?? null) ? $p['online'] : [];
    $cd = is_array($p['cod'] ?? null) ? $p['cod'] : [];
    $pre = is_array($p['prepaid'] ?? null) ? $p['prepaid'] : [];
    $ly = is_array($p['layout'] ?? null) ? $p['layout'] : [];
    $ap = is_array($p['appearance'] ?? null) ? $p['appearance'] : [];
    $surfaces = is_array($s['surfaces'] ?? null) ? $s['surfaces'] : [];

    $onlineOn = cods_bool($on['enabled'] ?? null, true);
    // Both off: still sent (as both disabled), so brix_cod.js shows nothing at
    // all instead of falling back to the plain product page COD button.
    $codOn = $codLive && cods_bool($cd['enabled'] ?? null, true) && ($surfaces['product'] ?? true) !== false;

    $prepaid = null;
    $rt = is_array($s['_runtime']['prepaid'] ?? null) ? $s['_runtime']['prepaid'] : [];
    $percent = is_numeric($rt['percent'] ?? null) ? round((float)$rt['percent'], 2) : 0;
    if ($onlineOn && cods_bool($pre['enabled'] ?? null, false) && ($rt['verified'] ?? false) === true && $percent >= 1 && $percent <= 50) {
        $prepaid = [
            'percent' => $percent,
            'minSubtotal' => cods_num($rt['minSubtotal'] ?? 0),
            'currency' => is_string($rt['currency'] ?? null) && preg_match('/^[A-Z]{3}$/', $rt['currency']) ? $rt['currency'] : '',
            'showBadge' => cods_bool($pre['showBadge'] ?? null, true),
            'showSavingsAmount' => cods_bool($pre['showSavingsAmount'] ?? null, true),
            'offerTitle' => cods_text($pre['offerTitle'] ?? null, '{percent}% off when you pay online', 80),
            'offerDescription' => cods_text($pre['offerDescription'] ?? null, '', 120),
            'minNotMetText' => cods_text($pre['minNotMetText'] ?? null, '', 100),
        ];
    }

    $placements = ['below_price', 'below_variants', 'below_quantity', 'before_purchase_buttons', 'above_buy_now', 'below_add_to_cart', 'app_block'];
    $radius = is_numeric($ly['radius'] ?? null) ? max(0, min(24, (int)round((float)$ly['radius']))) : 8;
    return [
        'heading' => array_key_exists('heading', $p) ? cods_text($p['heading'], '', 60) : 'Choose payment method',
        'defaultMethod' => cods_enum($p['defaultMethod'] ?? '', ['online', 'cod'], 'online'),
        'relabelBuyNow' => cods_bool($p['relabelBuyNow'] ?? null, true),
        'online' => [
            'enabled' => $onlineOn,
            'label' => cods_text($on['label'] ?? null, 'Pay Online', 40),
            'description' => cods_text($on['description'] ?? null, '', 80),
            'buttonText' => cods_text($on['buttonText'] ?? null, 'Buy it now', 60),
            'showIcon' => cods_bool($on['showIcon'] ?? null, true),
        ],
        'cod' => [
            'enabled' => $codOn,
            'label' => cods_text($cd['label'] ?? null, 'Cash on Delivery', 40),
            'description' => cods_text($cd['description'] ?? null, '', 80),
            'showIcon' => cods_bool($cd['showIcon'] ?? null, true),
        ],
        'prepaid' => $prepaid,
        'layout' => [
            'placement' => cods_enum($ly['placement'] ?? '', $placements, 'before_purchase_buttons'),
            'cardLayout' => cods_enum($ly['cardLayout'] ?? '', ['horizontal', 'vertical'], 'horizontal'),
            'cardStyle' => cods_enum($ly['cardStyle'] ?? '', ['border', 'filled', 'minimal'], 'border'),
            'selectedStyle' => cods_enum($ly['selectedStyle'] ?? '', ['border', 'background', 'radio_border'], 'radio_border'),
            'radius' => $radius,
            'spacing' => cods_enum($ly['spacing'] ?? '', ['small', 'medium', 'large'], 'medium'),
            'showRadio' => cods_bool($ly['showRadio'] ?? null, true),
            'showIcons' => cods_bool($ly['showIcons'] ?? null, true),
            'showBanner' => cods_bool($ly['showBanner'] ?? null, true),
            'bannerPlacement' => cods_enum($ly['bannerPlacement'] ?? '', ['above_selector', 'in_online_card', 'below_price'], 'above_selector'),
        ],
        'appearance' => [
            'onlineColor' => cods_hex($ap['onlineColor'] ?? null, '#008060'),
            'codColor' => cods_hex($ap['codColor'] ?? null, '#111827'),
            'cardBackground' => cods_hex($ap['cardBackground'] ?? null, '#ffffff'),
            'borderColor' => cods_hex($ap['borderColor'] ?? null, '#d1d5db'),
            'selectedBackground' => cods_hex($ap['selectedBackground'] ?? null, '#f0fdf4'),
            'badgeBackground' => cods_hex($ap['badgeBackground'] ?? null, '#008060'),
            'badgeText' => cods_hex($ap['badgeText'] ?? null, '#ffffff'),
        ],
    ];
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'GET') cods_fail(405, 'method_not_allowed', 'GET only');

$shop = strtolower(trim((string)($_GET['shop'] ?? '')));
if (!preg_match('/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/', $shop)) cods_fail(400, 'invalid_shop', 'A valid shop is required.');
$action = $_GET['action'] ?? 'config';

if ($action === 'config') {
    $s = cods_settings($pdo, $shop);
    // The plan publishes COD and the product page payment options (with the
    // prepaid offer) together: feature `cod_checkout`.
    $planLive = false;
    $wanted = $s && (!empty($s['enabled']) || (($s['productPayment']['enabled'] ?? false) === true));
    if ($wanted) {
        try {
            $planLive = plan_get_feature_state(resolve_plan_key($pdo, $shop), 'cod_checkout') === 'enabled';
        } catch (Throwable $e) {
            error_log('[cod_storefront] plan lookup: ' . $e->getMessage());
        }
    }
    $live = $planLive && !empty($s['enabled']);
    $payment = $planLive ? cods_product_payment($s, $live) : null;
    if (!$live) cods_ok(array_merge(['enabled' => false], $payment ? ['productPayment' => $payment] : []), 30);

    $surfaces = is_array($s['surfaces'] ?? null) ? $s['surfaces'] : [];
    $buttons = is_array($s['buttons'] ?? null) ? $s['buttons'] : [];
    $productButton = cods_product_button($s['productButton'] ?? null);
    $looks = cods_button_looks($buttons, $productButton['radius']);
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
        'comboPlacement' => cods_enum($s['comboPlacement'] ?? '', ['replace', 'above', 'below'], 'below'),
        'drawerSelector' => cods_selector($s['drawerSelector'] ?? ''),
        // Text for the theme drawer's Checkout button; may hold price tags. '' = the theme's.
        'drawerCheckoutText' => cods_text($s['drawerCheckoutText'] ?? '', '', 60),
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
            'comboText' => cods_text($buttons['comboText'] ?? '', 'Cash on Delivery', 60),
            // Each place's own button look (cart drawer, product page, combo page).
            'looks' => $looks,
        ],
        'productButton' => $productButton,
        'sheet' => cods_sheet($s['sheet'] ?? null),
        'tracking' => cods_tracking($s['tracking'] ?? null),
        'productPayment' => $payment,
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
