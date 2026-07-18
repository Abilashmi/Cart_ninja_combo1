<?php
require_once __DIR__ . '/config.php';

// Auth check (skipped in local when SHOPIFY_API_KEY not set)
$secret = $_SERVER['HTTP_X_FORGE_SECRET'] ?? '';
$expected = getenv('SHOPIFY_API_KEY') ?: '';
if (!$expected || !hash_equals($expected, $secret)) {
    http_response_code(403);
    echo json_encode(['status' => 'error', 'message' => 'Forbidden']);
    exit;
}

// ── GET ──────────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $shop = $_GET['shop'] ?? null;
    if (!$shop) {
        http_response_code(400);
        echo json_encode(['status' => 'error', 'message' => 'shop required']);
        exit;
    }
    $stmt = $pdo->prepare('SELECT * FROM cart_drawer_config WHERE shop_domain = ? LIMIT 1');
    $stmt->execute([$shop]);
    $row = $stmt->fetch();
    echo json_encode(['status' => 'success', 'data' => $row ?: null]);
    exit;
}

// ── POST ─────────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['status' => 'error', 'message' => 'Method not allowed']);
    exit;
}

$body = json_decode(file_get_contents('php://input'), true) ?? [];
$shop = $body['shop'] ?? null;
if (!$shop) {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => 'shop required']);
    exit;
}

function flag($v, $default = 1) {
    if ($v === null) return $default;
    return ($v === true || $v === 1 || $v === '1') ? 1 : 0;
}

$sql = "
INSERT INTO cart_drawer_config (
    shop_domain, is_enabled,
    checkout_button_text, checkout_footer_text,
    checkout_button_bg_color, checkout_button_text_color, checkout_button_border_radius,
    custom_css,
    announcement_enabled, announcement_text, announcement_bg_color,
    announcement_text_color, announcement_font_size,
    open_on_add, open_on_icon_click, position,
    header_title, header_close_style, header_bg_color, header_text_color, header_border_bottom,
    design_width, design_border_radius, design_shadow, design_animation,
    empty_cart_message, empty_cart_show_continue_shopping, empty_cart_show_recommendations
) VALUES (
    :shop, :is_enabled,
    :checkout_button_text, :checkout_footer_text,
    :checkout_button_bg_color, :checkout_button_text_color, :checkout_button_border_radius,
    :custom_css,
    :announcement_enabled, :announcement_text, :announcement_bg_color,
    :announcement_text_color, :announcement_font_size,
    :open_on_add, :open_on_icon_click, :position,
    :header_title, :header_close_style, :header_bg_color, :header_text_color, :header_border_bottom,
    :design_width, :design_border_radius, :design_shadow, :design_animation,
    :empty_cart_message, :empty_cart_show_continue_shopping, :empty_cart_show_recommendations
)
ON DUPLICATE KEY UPDATE
    is_enabled                         = VALUES(is_enabled),
    checkout_button_text               = VALUES(checkout_button_text),
    checkout_footer_text               = VALUES(checkout_footer_text),
    checkout_button_bg_color           = VALUES(checkout_button_bg_color),
    checkout_button_text_color         = VALUES(checkout_button_text_color),
    checkout_button_border_radius      = VALUES(checkout_button_border_radius),
    custom_css                         = VALUES(custom_css),
    announcement_enabled               = VALUES(announcement_enabled),
    announcement_text                  = VALUES(announcement_text),
    announcement_bg_color              = VALUES(announcement_bg_color),
    announcement_text_color            = VALUES(announcement_text_color),
    announcement_font_size             = VALUES(announcement_font_size),
    open_on_add                        = VALUES(open_on_add),
    open_on_icon_click                 = VALUES(open_on_icon_click),
    position                           = VALUES(position),
    header_title                       = VALUES(header_title),
    header_close_style                 = VALUES(header_close_style),
    header_bg_color                    = VALUES(header_bg_color),
    header_text_color                  = VALUES(header_text_color),
    header_border_bottom               = VALUES(header_border_bottom),
    design_width                       = VALUES(design_width),
    design_border_radius               = VALUES(design_border_radius),
    design_shadow                      = VALUES(design_shadow),
    design_animation                   = VALUES(design_animation),
    empty_cart_message                 = VALUES(empty_cart_message),
    empty_cart_show_continue_shopping  = VALUES(empty_cart_show_continue_shopping),
    empty_cart_show_recommendations    = VALUES(empty_cart_show_recommendations),
    updated_at                         = CURRENT_TIMESTAMP(3)
";

$stmt = $pdo->prepare($sql);
$stmt->execute([
    ':shop'                               => $shop,
    ':is_enabled'                         => flag($body['is_enabled'] ?? null),
    ':checkout_button_text'               => $body['checkout_button_text']          ?? 'Checkout Now',
    ':checkout_footer_text'               => $body['checkout_footer_text']          ?? 'Shipping and taxes calculated at checkout',
    ':checkout_button_bg_color'           => $body['checkout_button_bg_color']      ?? '#111827',
    ':checkout_button_text_color'         => $body['checkout_button_text_color']    ?? '#ffffff',
    ':checkout_button_border_radius'      => $body['checkout_button_border_radius'] ?? 4,
    ':custom_css'                         => $body['custom_css']                    ?? null,
    ':announcement_enabled'               => flag($body['announcement_enabled']     ?? 0, 0),
    ':announcement_text'                  => $body['announcement_text']             ?? null,
    ':announcement_bg_color'              => $body['announcement_bg_color']         ?? '#111827',
    ':announcement_text_color'            => $body['announcement_text_color']       ?? '#ffffff',
    ':announcement_font_size'             => $body['announcement_font_size']        ?? 13,
    ':open_on_add'                        => flag($body['open_on_add']              ?? 1),
    ':open_on_icon_click'                 => flag($body['open_on_icon_click']       ?? 1),
    ':position'                           => $body['position']                      ?? 'right',
    ':header_title'                       => $body['header_title']                  ?? 'Your Cart',
    ':header_close_style'                 => $body['header_close_style']            ?? 'icon',
    ':header_bg_color'                    => $body['header_bg_color']               ?? '#ffffff',
    ':header_text_color'                  => $body['header_text_color']             ?? '#1a1a1a',
    ':header_border_bottom'               => flag($body['header_border_bottom']     ?? 1),
    ':design_width'                       => $body['design_width']                  ?? 'normal',
    ':design_border_radius'               => $body['design_border_radius']          ?? 8,
    ':design_shadow'                      => flag($body['design_shadow']            ?? 1),
    ':design_animation'                   => $body['design_animation']              ?? 'slide',
    ':empty_cart_message'                 => $body['empty_cart_message']            ?? 'Your cart is empty',
    ':empty_cart_show_continue_shopping'  => flag($body['empty_cart_show_continue_shopping'] ?? 1),
    ':empty_cart_show_recommendations'    => flag($body['empty_cart_show_recommendations']   ?? 1),
]);

$stmt2 = $pdo->prepare('SELECT * FROM cart_drawer_config WHERE shop_domain = ? LIMIT 1');
$stmt2->execute([$shop]);
echo json_encode(['status' => 'success', 'data' => $stmt2->fetch()]);
