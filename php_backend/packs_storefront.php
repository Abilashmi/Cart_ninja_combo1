<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/plan_helpers.php';

/**
 * BRIX Packs storefront data, read straight from this server's MySQL.
 *
 * GET /apps/cart-app/packs_storefront.php?shop=<shop>.myshopify.com&productId=<id>[&preview=1]
 * (Shopify's App Proxy forwards it here and appends its own `shop` param.)
 *
 * This server has no Shopify access, so it returns the STORED Packs only
 * (tiers, customization, variant coverage). The widget prices them in the
 * browser from the product page's own Liquid variant data, which is live.
 *
 * Whether the checkout discount is really active comes from
 * brix_packs_shop_state, recorded by the Node app every time it verifies the
 * discount with Shopify (see migrations/create_brix_packs_shop_state.sql).
 * A Pack is shown to shoppers only when that record is verified AND lists the
 * Pack's current version; `preview=1` returns it anyway, flagged unverified.
 *
 * Response (same contract as the Node /api/packs-storefront, plus
 * pricing:'client' meaning tier prices are not included):
 *   200 { success, pricing, packs, reason, checkoutDiscount, preview }
 *   4xx/5xx { success:false, error, code }
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=15');

function packs_fail($status, $code, $error) {
    http_response_code($status);
    echo json_encode(['success' => false, 'error' => $error, 'code' => $code]);
    exit;
}

function packs_ok($body) {
    echo json_encode(array_merge(['success' => true, 'pricing' => 'client'], $body));
    exit;
}

function packs_numeric_id($value) {
    return preg_match('/(\d+)$/', (string)$value, $m) ? $m[1] : null;
}

function packs_json($value, $fallback) {
    $decoded = json_decode((string)$value, true);
    return $decoded === null ? $fallback : $decoded;
}

// Mirrors normalizeTiers in app/utils/packs.shared.js.
function packs_normalize_tiers($raw) {
    if (!is_array($raw)) return [];
    $tiers = [];
    foreach ($raw as $tier) {
        if (!is_array($tier)) continue;
        $type = in_array($tier['discountType'] ?? null, ['none', 'percentage', 'fixed'], true) ? $tier['discountType'] : 'none';
        $tiers[] = [
            'quantity' => (int)($tier['quantity'] ?? 0),
            'name' => is_string($tier['name'] ?? null) ? trim($tier['name']) : '',
            'badge' => is_string($tier['badge'] ?? null) ? trim($tier['badge']) : '',
            'discountType' => $type,
            'discountValue' => $type === 'none' ? 0 : (float)($tier['discountValue'] ?? 0),
        ];
    }
    $tiers = array_values(array_filter($tiers, function ($tier) { return $tier['quantity'] > 0; }));
    usort($tiers, function ($a, $b) { return $a['quantity'] - $b['quantity']; });
    return $tiers;
}

// Mirrors rowToPack + publicPack in the Node app — only what the widget needs.
function packs_public($row) {
    $template = $row['template'] ?? 'same_variant';
    $packType = !empty($row['pack_type']) ? $row['pack_type'] : ($template === 'choose_each_item' ? 'mix_match' : 'same_variant');
    $scope = !empty($row['variant_scope']) ? $row['variant_scope'] : 'selected';
    $anchor = packs_numeric_id($row['variant_id']) ?: (string)$row['variant_id'];
    $allowed = [];
    if ($scope !== 'all') {
        $rawAllowed = isset($row['allowed_variant_ids_json']) ? packs_json($row['allowed_variant_ids_json'], []) : [$anchor];
        foreach ((array)$rawAllowed as $id) {
            $numeric = packs_numeric_id($id);
            if ($numeric && !in_array($numeric, $allowed, true)) $allowed[] = $numeric;
        }
    }
    $customization = packs_json($row['customization_json'] ?? '', []);
    return [
        'id' => (int)$row['id'],
        'version' => (int)($row['version'] ?? 1),
        'variantId' => $anchor,
        'template' => $template,
        'packType' => $packType,
        'variantScope' => $scope,
        'allowedVariantIds' => $allowed,
        'productTitle' => $row['product_title'],
        'variantTitle' => $row['variant_title'],
        'productImage' => $row['product_image'] ?: '',
        'basePrice' => (float)$row['base_price'],
        'tiers' => packs_normalize_tiers(packs_json($row['tiers_json'] ?? '', [])),
        'customization' => is_array($customization) && $customization ? $customization : new stdClass(),
    ];
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'GET') packs_fail(405, 'method_not_allowed', 'Method not allowed');

$shop = strtolower(trim((string)($_GET['shop'] ?? '')));
$productId = packs_numeric_id($_GET['productId'] ?? '');
$preview = ($_GET['preview'] ?? '') === '1';
if (!preg_match('/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/', $shop)) packs_fail(400, 'invalid_shop', 'A valid shop is required.');
if (!$productId) packs_fail(400, 'invalid_product', 'A valid productId is required.');

$empty = ['packs' => [], 'checkoutDiscount' => null, 'preview' => $preview];

try {
    if (plan_get_feature_state(resolve_plan_key($pdo, $shop), 'packs') !== 'enabled') {
        packs_ok(array_merge($empty, ['reason' => 'plan_restricted']));
    }

    $stmt = $pdo->prepare("SELECT * FROM brix_packs WHERE shop_domain = ? AND status = 'active' AND enabled = 1 AND product_id IN (?, ?)");
    $stmt->execute([$shop, $productId, 'gid://shopify/Product/' . $productId]);
    $packs = array_map('packs_public', $stmt->fetchAll(PDO::FETCH_ASSOC));
    if (!$packs) packs_ok(array_merge($empty, ['reason' => 'no_active_pack']));
} catch (PDOException $e) {
    error_log('[packs_storefront] ' . $e->getMessage());
    packs_fail(503, 'database_error', 'Could not load Packs.');
}

$state = null;
try {
    $stmt = $pdo->prepare('SELECT * FROM brix_packs_shop_state WHERE shop_domain = ? LIMIT 1');
    $stmt->execute([$shop]);
    $state = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
} catch (PDOException $e) {
    // Table not created yet — treated as "not verified" below.
    error_log('[packs_storefront] brix_packs_shop_state: ' . $e->getMessage());
}

$verifiedPacks = $state && (int)$state['discount_verified'] === 1 ? (array)packs_json($state['verified_packs_json'] ?? '', []) : [];
$verified = array_values(array_filter($packs, function ($pack) use ($verifiedPacks) {
    return isset($verifiedPacks[(string)$pack['id']]) && (int)$verifiedPacks[(string)$pack['id']] === $pack['version'];
}));

if (count($verified) === count($packs)) {
    $checkoutDiscount = ['verified' => true, 'state' => 'active', 'message' => 'Checkout discount is active.'];
} elseif ($state && (int)$state['discount_verified'] !== 1) {
    $checkoutDiscount = ['verified' => false, 'state' => $state['discount_state'], 'message' => $state['discount_message']];
} else {
    $checkoutDiscount = ['verified' => false, 'state' => 'config_out_of_date', 'message' => 'Pack configuration has not been verified with Shopify yet. Open the Packs page in the BRIX app to re-check.'];
}

if ($preview) packs_ok(['packs' => $packs, 'reason' => null, 'checkoutDiscount' => $checkoutDiscount, 'preview' => true]);
if (!$verified) packs_ok(array_merge($empty, ['checkoutDiscount' => $checkoutDiscount, 'reason' => 'discount_unverified']));
packs_ok(['packs' => $verified, 'reason' => null, 'checkoutDiscount' => ['verified' => true, 'state' => 'active', 'message' => 'Checkout discount is active.'], 'preview' => false]);
