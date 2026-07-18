<?php
require_once __DIR__ . '/config.php';

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

    $stmt = $pdo->prepare('SELECT * FROM progress_bar_settings WHERE shop_domain = ? LIMIT 1');
    $stmt->execute([$shop]);
    $settings = $stmt->fetch();

    if (!$settings) {
        echo json_encode(['status' => 'success', 'data' => null]);
        exit;
    }

    $stmt2 = $pdo->prepare('SELECT * FROM progress_bar_tiers WHERE settings_id = ? AND is_active = 1 ORDER BY sort_order ASC');
    $stmt2->execute([$settings['id']]);
    $tiers = $stmt2->fetchAll();

    // Parse reward_products JSON in each tier
    foreach ($tiers as &$tier) {
        if ($tier['reward_products']) {
            $decoded = json_decode($tier['reward_products'], true);
            $tier['reward_products'] = is_array($decoded) ? $decoded : [];
        } else {
            $tier['reward_products'] = [];
        }
    }

    $settings['tiers'] = $tiers;
    echo json_encode(['status' => 'success', 'data' => $settings]);
    exit;
}

// ── POST ─────────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['status'=>'error','message'=>'Method not allowed']); exit;
}

$body = json_decode(file_get_contents('php://input'), true) ?? [];
$shop = $body['shop'] ?? null;
if (!$shop) { http_response_code(400); echo json_encode(['status'=>'error','message'=>'shop required']); exit; }

// Save settings
$sql = "
INSERT INTO progress_bar_settings
    (shop_domain, is_enabled, mode, show_on_empty, bar_background_color,
     bar_foreground_color, icon_color, border_radius, placement,
     completion_text, completion_text_color, enable_confetti)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
ON DUPLICATE KEY UPDATE
    is_enabled            = VALUES(is_enabled),
    mode                  = VALUES(mode),
    show_on_empty         = VALUES(show_on_empty),
    bar_background_color  = VALUES(bar_background_color),
    bar_foreground_color  = VALUES(bar_foreground_color),
    icon_color            = VALUES(icon_color),
    border_radius         = VALUES(border_radius),
    placement             = VALUES(placement),
    completion_text       = VALUES(completion_text),
    completion_text_color = VALUES(completion_text_color),
    enable_confetti       = VALUES(enable_confetti),
    updated_at            = CURRENT_TIMESTAMP(3)
";

$stmt = $pdo->prepare($sql);
$stmt->execute([
    $shop,
    flag($body['is_enabled'] ?? 0, 0),
    $body['mode']                  ?? 'amount',
    flag($body['show_on_empty']    ?? 1),
    $body['bar_background_color']  ?? '#e5e7eb',
    $body['bar_foreground_color']  ?? '#2563eb',
    $body['icon_color']            ?? '#2563eb',
    $body['border_radius']         ?? 8,
    $body['placement']             ?? 'top',
    $body['completion_text']       ?? "You've unlocked free shipping!",
    $body['completion_text_color'] ?? '#10b981',
    flag($body['enable_confetti']  ?? 1),
]);

// Get settings id
$settingsId = $stmt->rowCount() && $pdo->lastInsertId()
    ? $pdo->lastInsertId()
    : null;

if (!$settingsId) {
    $s = $pdo->prepare('SELECT id FROM progress_bar_settings WHERE shop_domain = ?');
    $s->execute([$shop]);
    $settingsId = $s->fetchColumn();
}

// Replace tiers
$tiers = $body['tiers'] ?? [];
$pdo->prepare('DELETE FROM progress_bar_tiers WHERE settings_id = ?')->execute([$settingsId]);

foreach ($tiers as $i => $t) {
    $products = null;
    if (!empty($t['products']) && is_array($t['products'])) {
        $products = json_encode($t['products']);
    }
    $pdo->prepare("
        INSERT INTO progress_bar_tiers
            (shop_domain, settings_id, min_value, min_quantity, description,
             reward_type, icon_type, icon_preset, icon_custom_svg, reward_products, is_active, sort_order)
        VALUES (?,?,?,?,?,?,?,?,?,?,1,?)
    ")->execute([
        $shop,
        $settingsId,
        $t['min_value']      ?? $t['minValue']      ?? 0,
        $t['min_quantity']   ?? $t['minQuantity']   ?? 0,
        $t['description']    ?? 'Milestone',
        $t['reward_type']    ?? $t['rewardType']    ?? 'free_shipping',
        $t['icon_type']      ?? $t['iconType']      ?? 'preset',
        $t['icon_preset']    ?? $t['iconPreset']    ?? 'gift',
        $t['icon_custom_svg']?? $t['iconCustomSvg'] ?? null,
        $products,
        $i,
    ]);
}

$s = $pdo->prepare('SELECT * FROM progress_bar_settings WHERE shop_domain = ? LIMIT 1');
$s->execute([$shop]);
$settings = $s->fetch();

$s2 = $pdo->prepare('SELECT * FROM progress_bar_tiers WHERE settings_id = ? AND is_active = 1 ORDER BY sort_order ASC');
$s2->execute([$settingsId]);
$settings['tiers'] = $s2->fetchAll();

echo json_encode(['status' => 'success', 'data' => $settings]);
