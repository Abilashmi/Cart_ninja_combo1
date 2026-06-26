<?php
require_once __DIR__ . '/config.php';

$secret = $_SERVER['HTTP_X_FORGE_SECRET'] ?? '';
$expected = getenv('SHOPIFY_API_KEY') ?: '';
if ($expected && $secret !== $expected) {
    http_response_code(403);
    echo json_encode(['status' => 'error', 'message' => 'Forbidden']);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['status'=>'error','message'=>'Method not allowed']); exit;
}

$body     = json_decode(file_get_contents('php://input'), true) ?? [];
$shop     = $body['shop']             ?? null;
$actions  = $body['plan']['actions']  ?? [];
$settings = $body['plan']['settings'] ?? [];

if (!$shop || empty($actions)) {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => 'shop and plan.actions required']);
    exit;
}

function flag($v, $default = 1) {
    if ($v === null) return $default;
    return ($v === true || $v === 1 || $v === '1') ? 1 : 0;
}

$applied = [];

foreach ($actions as $action) {
    switch ($action) {

        case 'enableDrawer':
        case 'disableDrawer':
            $enabled = $action === 'enableDrawer' ? 1 : 0;
            $pdo->prepare("
                INSERT INTO cart_drawer_config (shop_domain, is_enabled)
                VALUES (?, ?)
                ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), updated_at = CURRENT_TIMESTAMP(3)
            ")->execute([$shop, $enabled]);
            $pdo->prepare("
                INSERT INTO cart_drawer (shop, cartStatus)
                VALUES (?, ?)
                ON DUPLICATE KEY UPDATE cartStatus = VALUES(cartStatus), updated_at = CURRENT_TIMESTAMP(3)
            ")->execute([$shop, $enabled]);
            $applied[] = $action;
            break;

        case 'enableGoalBar':
        case 'disableGoalBar':
            $enabled = $action === 'enableGoalBar' ? 1 : 0;
            $pdo->prepare("
                INSERT INTO progress_bar_settings (shop_domain, is_enabled)
                VALUES (?, ?)
                ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), updated_at = CURRENT_TIMESTAMP(3)
            ")->execute([$shop, $enabled]);
            $applied[] = $action;
            break;

        case 'enableUpsell':
        case 'disableUpsell':
            $enabled = $action === 'enableUpsell' ? 1 : 0;
            $pdo->prepare("
                INSERT INTO upsell_widget_settings (shop_domain, is_enabled)
                VALUES (?, ?)
                ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), updated_at = CURRENT_TIMESTAMP(3)
            ")->execute([$shop, $enabled]);
            $applied[] = $action;
            break;

        case 'applyTheme':
            $theme = $settings['theme'] ?? null;
            if ($theme) {
                $updates = [];
                if (!empty($theme['headerBgColor'])) {
                    $pdo->prepare("
                        INSERT INTO cart_drawer_config (shop_domain, header_bg_color, header_text_color)
                        VALUES (?,?,?)
                        ON DUPLICATE KEY UPDATE header_bg_color = VALUES(header_bg_color), header_text_color = VALUES(header_text_color), updated_at = CURRENT_TIMESTAMP(3)
                    ")->execute([$shop, $theme['headerBgColor'], $theme['headerTextColor'] ?? '#1a1a1a']);
                }
                if (!empty($theme['checkoutBgColor'])) {
                    $pdo->prepare("
                        INSERT INTO cart_drawer_config (shop_domain, checkout_button_bg_color, checkout_button_text_color)
                        VALUES (?,?,?)
                        ON DUPLICATE KEY UPDATE checkout_button_bg_color = VALUES(checkout_button_bg_color), checkout_button_text_color = VALUES(checkout_button_text_color), updated_at = CURRENT_TIMESTAMP(3)
                    ")->execute([$shop, $theme['checkoutBgColor'], $theme['checkoutTextColor'] ?? '#ffffff']);
                }
            }
            $applied[] = $action;
            break;
    }
}

echo json_encode(['status' => 'success', 'applied' => $applied]);
