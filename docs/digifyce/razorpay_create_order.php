<?php
require_once __DIR__ . '/razorpay_helpers.php';

/**
 * BRIX -> Digifyce: open a Razorpay order for an OTP wallet recharge.
 *
 *   POST  Authorization: Bearer <BRIX_API_KEY>
 *   { shop, amount_paise, recharge_id, return_url }
 *   -> { ok: true, order_id, pay_url }   |   { ok: false, error }
 *
 * The merchant is sent to pay_url (razorpay_pay.php), pays by Razorpay, and
 * razorpay_return.php / razorpay_webhook.php tell BRIX to credit the wallet.
 */

dg_require_brix();
$body = dg_post_body();
$shop = dg_shop($body['shop'] ?? '');
$amount = (int)($body['amount_paise'] ?? 0);
$rechargeId = (int)($body['recharge_id'] ?? 0);
$returnUrl = (string)($body['return_url'] ?? '');

if ($shop === '' || $rechargeId < 1) dg_json(400, ['ok' => false, 'error' => 'invalid_request']);
if ($amount < 10000 || $amount > 5000000) dg_json(400, ['ok' => false, 'error' => 'invalid_amount']);
if (!dg_return_url_ok($returnUrl)) dg_json(400, ['ok' => false, 'error' => 'invalid_return_url']);
if (dg_env('RAZORPAY_KEY_ID') === '' || dg_env('RAZORPAY_KEY_SECRET') === '' || dg_env('DIGIFYCE_PUBLIC_URL') === '') {
    dg_json(503, ['ok' => false, 'error' => 'not_configured']);
}

[$status, $order] = dg_razorpay('POST', '/orders', [
    'amount' => $amount,
    'currency' => 'INR',
    'receipt' => 'brix_otp_' . $rechargeId,
    'notes' => ['purpose' => 'brix_otp_wallet', 'shop' => $shop, 'recharge_id' => (string)$rechargeId, 'return_url' => $returnUrl],
]);
if ($status !== 200 || empty($order['id'])) {
    error_log('[digifyce] Razorpay order failed: HTTP ' . $status . ' ' . substr(json_encode($order), 0, 200));
    dg_json(502, ['ok' => false, 'error' => 'razorpay_failed']);
}

dg_json(200, [
    'ok' => true,
    'order_id' => $order['id'],
    'pay_url' => rtrim(dg_env('DIGIFYCE_PUBLIC_URL'), '/') . '/razorpay_pay.php?order_id=' . rawurlencode($order['id']),
]);
