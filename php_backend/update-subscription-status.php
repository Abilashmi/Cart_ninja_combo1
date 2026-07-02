<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/plan_helpers.php';

/**
 * POST /update-subscription-status.php
 * Called by Shopify webhook (app_subscriptions/update) via the Node app.
 * Keeps the shops table in sync with Shopify subscription status.
 *
 * Body: {
 *   shop_domain: string,
 *   subscription_id: string,       // Shopify GID
 *   subscription_status: string,   // active | cancelled | declined | expired | frozen | pending
 *   plan_name: string,
 *   trial_ends_on: string|null,    // ISO date or null
 *   billing_on: string|null        // ISO date or null
 * }
 */

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'POST only']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);

$shop             = $input['shop_domain']         ?? null;
$subscriptionId   = $input['subscription_id']     ?? null;
$status           = $input['subscription_status'] ?? null;
$planName         = $input['plan_name']            ?? 'Cart Ninja Pro';
$planKey          = $input['plan_key']             ?? null;
$trialEndsOn      = $input['trial_ends_on']        ?? null;
$billingOn        = $input['billing_on']           ?? null;

if (!$shop || !$status) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'shop_domain and subscription_status are required']);
    exit;
}

try {
    // ===== SAFE MIGRATION: add columns if they don't exist =====
    $existingCols = array_column(
        $pdo->query("SHOW COLUMNS FROM shops")->fetchAll(PDO::FETCH_ASSOC),
        'Field'
    );

    $alterations = [];
    if (!in_array('subscription_id', $existingCols))
        $alterations[] = "ADD COLUMN `subscription_id` VARCHAR(255) DEFAULT NULL";
    if (!in_array('subscription_status', $existingCols))
        $alterations[] = "ADD COLUMN `subscription_status` VARCHAR(50) DEFAULT 'free'";
    if (!in_array('trial_ends_on', $existingCols))
        $alterations[] = "ADD COLUMN `trial_ends_on` DATE DEFAULT NULL";
    if (!in_array('billing_on', $existingCols))
        $alterations[] = "ADD COLUMN `billing_on` DATE DEFAULT NULL";
    if (!in_array('subscription_updated_at', $existingCols))
        $alterations[] = "ADD COLUMN `subscription_updated_at` TIMESTAMP DEFAULT NULL";

    if (!empty($alterations)) {
        $pdo->exec("ALTER TABLE shops " . implode(', ', $alterations));
    }
    plan_ensure_columns($pdo);

    // ===== MAP Shopify status → plan_name (legacy, human-readable) =====
    // active/pending = on paid plan; everything else = free
    $resolvedPlan = in_array($status, ['active', 'pending']) ? $planName : 'free';

    // plan_key is the canonical value — Node's confirmPlanFromWebhook()
    // already wrote it directly to this same MySQL database, so this PHP
    // sync only needs to mirror it when the caller explicitly provides it.
    // Never inferred by parsing $planName.
    $updatePlanKeySql = '';
    $params = [
        ':shop'       => $shop,
        ':sub_id'     => $subscriptionId,
        ':sub_status' => $status,
        ':plan'       => $resolvedPlan,
        ':trial'      => $trialEndsOn,
        ':billing'    => $billingOn,
    ];
    if ($planKey !== null && plan_is_valid_key($planKey)) {
        $updatePlanKeySql = ', plan_key = VALUES(plan_key)';
        $params[':plan_key'] = $planKey;
    }

    // ===== UPSERT subscription data =====
    $stmt = $pdo->prepare("
        INSERT INTO shops
            (shop_domain, subscription_id, subscription_status, plan_name" . ($planKey !== null && plan_is_valid_key($planKey) ? ", plan_key" : "") . ", trial_ends_on, billing_on, subscription_updated_at, updated_at)
        VALUES
            (:shop, :sub_id, :sub_status, :plan" . ($planKey !== null && plan_is_valid_key($planKey) ? ", :plan_key" : "") . ", :trial, :billing, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
            subscription_id         = VALUES(subscription_id),
            subscription_status     = VALUES(subscription_status),
            plan_name               = VALUES(plan_name)" . $updatePlanKeySql . ",
            trial_ends_on           = VALUES(trial_ends_on),
            billing_on              = VALUES(billing_on),
            subscription_updated_at = NOW(),
            updated_at              = NOW()
    ");

    $stmt->execute($params);

    echo json_encode([
        'success' => true,
        'message' => "Subscription status updated for $shop",
        'data'    => [
            'shop'                => $shop,
            'subscription_status' => $status,
            'plan_name'           => $resolvedPlan,
            'trial_ends_on'       => $trialEndsOn,
        ]
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
?>
