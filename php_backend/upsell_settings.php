<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/plan_helpers.php';

$secret = $_SERVER['HTTP_X_FORGE_SECRET'] ?? '';
$expected = getenv('SHOPIFY_API_KEY') ?: '';
if (!$expected || !hash_equals($expected, $secret)) {
    http_response_code(403);
    echo json_encode(['status' => 'error', 'message' => 'Forbidden']);
    exit;
}

function flag($v, $default = 1) {
    if ($v === null) return $default;
    return ($v === true || $v === 1 || $v === '1') ? 1 : 0;
}

// ── GET ──────────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $shop = $_GET['shop'] ?? null;
    if (!$shop) { http_response_code(400); echo json_encode(['status'=>'error','message'=>'shop required']); exit; }

    $stmt = $pdo->prepare('SELECT * FROM upsell_widget_settings WHERE shop_domain = ? LIMIT 1');
    $stmt->execute([$shop]);
    $row = $stmt->fetch();

    if ($row && $row['manual_rules']) {
        $row['manual_rules'] = json_decode($row['manual_rules'], true) ?? [];
    } elseif ($row) {
        $row['manual_rules'] = [];
    }

    // Enforce plan gating: AI Cart Upsell is locked on Free — the merchant can
    // still design/save it in the admin, but it must not render on the
    // storefront until they upgrade. This only mutates the response payload;
    // the stored row is left untouched so the merchant's design is preserved.
    if ($row) {
        $planKey = resolve_plan_key($pdo, $shop);
        if (!plan_can_publish_feature($planKey, 'ai_cart_upsell')) {
            $row['is_enabled'] = 0;
        }
    }

    echo json_encode(['status' => 'success', 'data' => $row ?: null]);
    exit;
}

// ── POST ─────────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['status'=>'error','message'=>'Method not allowed']); exit;
}

$body = json_decode(file_get_contents('php://input'), true) ?? [];
$shop = $body['shop'] ?? null;
if (!$shop) { http_response_code(400); echo json_encode(['status'=>'error','message'=>'shop required']); exit; }

$manualRules = null;
if (isset($body['manualRules']) && is_array($body['manualRules'])) {
    $manualRules = json_encode($body['manualRules']);
}

$sql = "
INSERT INTO upsell_widget_settings
    (shop_domain, is_enabled, title, title_color, title_font_weight,
     show_on_empty_cart, layout, button_text, button_bg_color, button_text_color,
     button_border_radius, show_price, position, display_limit, active_template, manual_rules)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON DUPLICATE KEY UPDATE
    is_enabled          = VALUES(is_enabled),
    title               = VALUES(title),
    title_color         = VALUES(title_color),
    title_font_weight   = VALUES(title_font_weight),
    show_on_empty_cart  = VALUES(show_on_empty_cart),
    layout              = VALUES(layout),
    button_text         = VALUES(button_text),
    button_bg_color     = VALUES(button_bg_color),
    button_text_color   = VALUES(button_text_color),
    button_border_radius= VALUES(button_border_radius),
    show_price          = VALUES(show_price),
    position            = VALUES(position),
    display_limit       = VALUES(display_limit),
    active_template     = VALUES(active_template),
    manual_rules        = VALUES(manual_rules),
    updated_at          = CURRENT_TIMESTAMP(3)
";

$stmt = $pdo->prepare($sql);
$stmt->execute([
    $shop,
    flag($body['is_enabled']        ?? 0, 0),
    $body['title']                  ?? $body['upsellTitle']['text'] ?? 'Recommended for you',
    $body['title_color']            ?? $body['titleColor']          ?? '#111827',
    $body['title_font_weight']      ?? '700',
    flag($body['show_on_empty_cart']?? $body['showOnEmptyCart']     ?? 0, 0),
    $body['layout']                 ?? $body['activeTemplate']      ?? 'grid',
    $body['button_text']            ?? $body['buttonText']          ?? 'Add to Cart',
    $body['button_bg_color']        ?? $body['buttonColor']         ?? '#111827',
    $body['button_text_color']      ?? $body['buttonTextColor']     ?? '#ffffff',
    $body['button_border_radius']   ?? $body['buttonBorderRadius']  ?? 6,
    flag($body['show_price']        ?? 1),
    $body['position']               ?? 'bottom',
    $body['display_limit']          ?? $body['limit']               ?? 3,
    $body['active_template']        ?? $body['layout']              ?? 'grid',
    $manualRules,
]);

$s = $pdo->prepare('SELECT * FROM upsell_widget_settings WHERE shop_domain = ? LIMIT 1');
$s->execute([$shop]);
$row = $s->fetch();
if ($row && $row['manual_rules']) {
    $row['manual_rules'] = json_decode($row['manual_rules'], true) ?? [];
}
echo json_encode(['status' => 'success', 'data' => $row]);
