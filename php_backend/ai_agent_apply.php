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
$unsupported = [];

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

            $cartDrawerPosition = $settings['cartDrawerPosition'] ?? null;
            if ($cartDrawerPosition === 'left' || $cartDrawerPosition === 'right') {
                $pdo->prepare("
                    UPDATE cart_drawer_config SET position = ?, updated_at = CURRENT_TIMESTAMP(3)
                    WHERE shop_domain = ?
                ")->execute([$cartDrawerPosition, $shop]);
            }

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

            $goalMessage = $settings['goalMessage'] ?? null;
            if ($goalMessage) {
                $pdo->prepare("
                    UPDATE progress_bar_settings SET completion_text = ?, updated_at = CURRENT_TIMESTAMP(3)
                    WHERE shop_domain = ?
                ")->execute([$goalMessage, $shop]);
            }

            // Placement is a plain settings column (not tier-scoped) — 'top'
            // or 'bottom', matching ProgressBarSection.jsx's own Select options.
            $placement = $settings['placement'] ?? null;
            if ($placement === 'top' || $placement === 'bottom') {
                $pdo->prepare("
                    UPDATE progress_bar_settings SET placement = ?, updated_at = CURRENT_TIMESTAMP(3)
                    WHERE shop_domain = ?
                ")->execute([$placement, $shop]);
            }

            // Only ever sets the single FIRST/primary tier (by sort_order) —
            // multi-tier setup still requires the manual Progress Bar panel.
            // Updates that tier in place (or creates it if none exists yet)
            // rather than the manual save's delete-and-replace-all, so any
            // other tiers the merchant already configured are left alone.
            $goalAmount = $settings['goalAmount'] ?? null;
            $rewardType = $settings['rewardType'] ?? 'free_shipping';
            $iconPreset = $settings['iconPreset'] ?? 'shipping';
            if ($goalAmount !== null && $goalAmount > 0) {
                $pdo->prepare("
                    UPDATE progress_bar_settings SET mode = 'amount', updated_at = CURRENT_TIMESTAMP(3)
                    WHERE shop_domain = ?
                ")->execute([$shop]);

                $settingsRow = $pdo->prepare("SELECT id FROM progress_bar_settings WHERE shop_domain = ?");
                $settingsRow->execute([$shop]);
                $settingsId = $settingsRow->fetchColumn();

                if ($settingsId) {
                    $existingTier = $pdo->prepare("
                        SELECT id FROM progress_bar_tiers WHERE settings_id = ? ORDER BY sort_order ASC LIMIT 1
                    ");
                    $existingTier->execute([$settingsId]);
                    $tierId = $existingTier->fetchColumn();

                    if ($tierId) {
                        $pdo->prepare("
                            UPDATE progress_bar_tiers
                            SET min_value = ?, reward_type = ?, icon_preset = ?, updated_at = CURRENT_TIMESTAMP(3)
                            WHERE id = ?
                        ")->execute([$goalAmount, $rewardType, $iconPreset, $tierId]);
                    } else {
                        $pdo->prepare("
                            INSERT INTO progress_bar_tiers
                                (shop_domain, settings_id, min_value, reward_type, icon_preset, is_active, sort_order)
                            VALUES (?, ?, ?, ?, ?, 1, 0)
                        ")->execute([$shop, $settingsId, $goalAmount, $rewardType, $iconPreset]);
                    }
                }
            }

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

        case 'enableFBT':
        case 'disableFBT':
            $enabled = $action === 'enableFBT' ? 1 : 0;
            $pdo->prepare("
                INSERT INTO fbt_widget_settings (shop_domain, is_enabled)
                VALUES (?, ?)
                ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), updated_at = CURRENT_TIMESTAMP(3)
            ")->execute([$shop, $enabled]);

            // Optional template/mode from the merchant's message (e.g. "classic
            // grid" / "ai recommended") — separate conditional updates, same
            // pattern as applyTheme below, so an unspecified field never
            // clobbers whatever the merchant already has set.
            $fbtTemplate = $settings['fbtTemplate'] ?? null;
            if ($fbtTemplate) {
                $pdo->prepare("
                    UPDATE fbt_widget_settings SET selected_template = ?, updated_at = CURRENT_TIMESTAMP(3)
                    WHERE shop_domain = ?
                ")->execute([$fbtTemplate, $shop]);
            }
            $fbtMode = $settings['fbtMode'] ?? null;
            if ($fbtMode) {
                $pdo->prepare("
                    UPDATE fbt_widget_settings SET mode = ?, updated_at = CURRENT_TIMESTAMP(3)
                    WHERE shop_domain = ?
                ")->execute([$fbtMode, $shop]);
            }

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

                    // The storefront's actual checkout-button styling is driven by
                    // cart_drawer.checkout_button_style (a JSON blob column on a
                    // different table) — the cart_drawer_config columns above only
                    // feed the admin's live preview. Read-modify-write it here so the
                    // color change reaches the real storefront too (same "write
                    // succeeds, storefront read path doesn't include it" bug class
                    // already fixed for upsell rules and FBT settings).
                    $cdRow = $pdo->prepare("SELECT checkout_button_style FROM cart_drawer WHERE shop = ?");
                    $cdRow->execute([$shop]);
                    $existingStyle = $cdRow->fetchColumn();
                    $styleData = $existingStyle ? (json_decode($existingStyle, true) ?: []) : [];
                    $styleData['backgroundColor'] = $theme['checkoutBgColor'];
                    $styleData['textColor'] = $theme['checkoutTextColor'] ?? '#ffffff';
                    $pdo->prepare("
                        INSERT INTO cart_drawer (shop, checkout_button_style)
                        VALUES (?, ?)
                        ON DUPLICATE KEY UPDATE checkout_button_style = VALUES(checkout_button_style), updated_at = CURRENT_TIMESTAMP(3)
                    ")->execute([$shop, json_encode($styleData, JSON_UNESCAPED_UNICODE)]);
                }
            }
            $applied[] = $action;
            break;

        default:
            // Recognized by the client-side keyword matcher but with no real
            // backing DB column/handler here (e.g. trust badges, matchTheme,
            // optimizeMobile). Must NOT be added to $applied, or the caller
            // will report "Completed" for a no-op.
            $unsupported[] = $action;
            break;
    }
}

// Read back the real, current per-shop state so the caller can sync its UI
// instead of trusting that "applied" == "actually reflected everywhere".
$after = ['cart' => []];

$cdc = $pdo->prepare("
    SELECT is_enabled, announcement_enabled,
           header_bg_color, header_text_color,
           checkout_button_bg_color, checkout_button_text_color,
           updated_at
    FROM cart_drawer_config WHERE shop_domain = ?
");
$cdc->execute([$shop]);
if ($row = $cdc->fetch(PDO::FETCH_ASSOC)) {
    $after['cart']['drawerEnabled'] = (bool) $row['is_enabled'];
    $after['cart']['updatedAt'] = $row['updated_at'];
    $after['cart']['announcement'] = ['enabled' => (bool) $row['announcement_enabled']];
    // Read back header/checkout colors too — needed so applyTheme results
    // (and any other color-writing action) actually reach CartEditorContext's
    // live-sync listener instead of only showing up after a page reload.
    if ($row['header_bg_color'] !== null || $row['header_text_color'] !== null) {
        $after['cart']['header'] = [
            'bgColor' => $row['header_bg_color'],
            'textColor' => $row['header_text_color'],
        ];
    }
    if ($row['checkout_button_bg_color'] !== null || $row['checkout_button_text_color'] !== null) {
        $after['cart']['checkoutButton'] = [
            'backgroundColor' => $row['checkout_button_bg_color'],
            'textColor' => $row['checkout_button_text_color'],
        ];
    }
}

$pb = $pdo->prepare("SELECT is_enabled, updated_at FROM progress_bar_settings WHERE shop_domain = ?");
$pb->execute([$shop]);
if ($row = $pb->fetch(PDO::FETCH_ASSOC)) {
    $after['cart']['goalBar'] = ['enabled' => (bool) $row['is_enabled'], 'updatedAt' => $row['updated_at']];
}

$up = $pdo->prepare("SELECT is_enabled, updated_at FROM upsell_widget_settings WHERE shop_domain = ?");
$up->execute([$shop]);
if ($row = $up->fetch(PDO::FETCH_ASSOC)) {
    $after['cart']['upsell'] = ['enabled' => (bool) $row['is_enabled'], 'updatedAt' => $row['updated_at']];
}

$cs = $pdo->prepare("SELECT is_enabled FROM coupon_slider_settings WHERE shop_domain = ?");
$cs->execute([$shop]);
if ($row = $cs->fetch(PDO::FETCH_ASSOC)) {
    $after['cart']['couponSlider'] = ['enabled' => (bool) $row['is_enabled']];
}

$fbt = $pdo->prepare("SELECT is_enabled, updated_at FROM fbt_widget_settings WHERE shop_domain = ?");
$fbt->execute([$shop]);
if ($row = $fbt->fetch(PDO::FETCH_ASSOC)) {
    $after['fbt'] = ['widgetEnabled' => (bool) $row['is_enabled'], 'updatedAt' => $row['updated_at']];
}

$status = empty($unsupported) ? 'success' : (empty($applied) ? 'unsupported' : 'partial');
echo json_encode(['status' => $status, 'applied' => $applied, 'unsupported' => $unsupported, 'after' => $after]);
