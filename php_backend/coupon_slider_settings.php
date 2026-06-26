<?php
require_once __DIR__ . '/config.php';

$secret = $_SERVER['HTTP_X_FORGE_SECRET'] ?? '';
$expected = getenv('SHOPIFY_API_KEY') ?: '';
if ($expected && $secret !== $expected) {
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

    $stmt = $pdo->prepare('SELECT * FROM coupon_slider_settings WHERE shop_domain = ? LIMIT 1');
    $stmt->execute([$shop]);
    $row = $stmt->fetch();

    if ($row && $row['selected_coupons']) {
        $row['selected_coupons'] = json_decode($row['selected_coupons'], true) ?? [];
    } elseif ($row) {
        $row['selected_coupons'] = [];
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

$selectedCoupons = null;
if (isset($body['selectedCoupons']) && is_array($body['selectedCoupons'])) {
    $selectedCoupons = json_encode($body['selectedCoupons']);
}

$sql = "
INSERT INTO coupon_slider_settings
    (shop_domain, is_enabled, selected_template, title_text, title_color,
     title_font_size, title_font_weight, title_alignment, section_bg_color,
     card_bg_color, card_border_color, card_border_width, card_border_radius,
     card_shadow, auto_slide, slide_interval, position, layout, selected_coupons)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON DUPLICATE KEY UPDATE
    is_enabled        = VALUES(is_enabled),
    selected_template = VALUES(selected_template),
    title_text        = VALUES(title_text),
    title_color       = VALUES(title_color),
    title_font_size   = VALUES(title_font_size),
    title_font_weight = VALUES(title_font_weight),
    title_alignment   = VALUES(title_alignment),
    section_bg_color  = VALUES(section_bg_color),
    card_bg_color     = VALUES(card_bg_color),
    card_border_color = VALUES(card_border_color),
    card_border_width = VALUES(card_border_width),
    card_border_radius= VALUES(card_border_radius),
    card_shadow       = VALUES(card_shadow),
    auto_slide        = VALUES(auto_slide),
    slide_interval    = VALUES(slide_interval),
    position          = VALUES(position),
    layout            = VALUES(layout),
    selected_coupons  = VALUES(selected_coupons),
    updated_at        = CURRENT_TIMESTAMP(3)
";

$stmt = $pdo->prepare($sql);
$stmt->execute([
    $shop,
    flag($body['is_enabled']        ?? 0, 0),
    $body['selected_template']      ?? $body['template']         ?? 'template1',
    $body['title_text']             ?? $body['sectionTitle']     ?? 'Apply Coupon',
    $body['title_color']            ?? $body['titleColor']       ?? '#1e293b',
    $body['title_font_size']        ?? $body['titleFontSize']    ?? 14,
    $body['title_font_weight']      ?? 700,
    $body['title_alignment']        ?? $body['titleTextAlign']   ?? 'left',
    $body['section_bg_color']       ?? '#ffffff',
    $body['card_bg_color']          ?? '#ffffff',
    $body['card_border_color']      ?? '#e5e7eb',
    $body['card_border_width']      ?? 1,
    $body['card_border_radius']     ?? 8,
    flag($body['card_shadow']       ?? 0, 0),
    flag($body['auto_slide']        ?? 0, 0),
    $body['slide_interval']         ?? 5,
    $body['position']               ?? 'above_cart',
    $body['layout']                 ?? 'grid',
    $selectedCoupons,
]);

$s = $pdo->prepare('SELECT * FROM coupon_slider_settings WHERE shop_domain = ? LIMIT 1');
$s->execute([$shop]);
$row = $s->fetch();
if ($row && $row['selected_coupons']) {
    $row['selected_coupons'] = json_decode($row['selected_coupons'], true) ?? [];
}
echo json_encode(['status' => 'success', 'data' => $row]);
