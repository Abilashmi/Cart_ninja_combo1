<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/cod_helpers.php';
require_once __DIR__ . '/otp_wallet_lib.php';

/**
 * Digifyce -> BRIX: "this Razorpay payment is captured, credit the wallet".
 * Called server to server by docs/digifyce/razorpay_helpers.php; never by a browser.
 *
 *   POST { recharge_id, shop, amount_paise, payment_id, order_id, status: 'paid' }
 *   Headers: X-Digifyce-Timestamp (unix seconds, within 5 minutes)
 *            X-Digifyce-Signature = hex HMAC-SHA256( timestamp + "." + rawBody, DIGIFYCE_CONFIRM_SECRET )
 *
 * The recharge must exist for that shop with the same amount (and Razorpay order,
 * when BRIX stored one), so a valid signature still can't credit a different
 * amount. The credit's reference is the payment id: the webhook and the return
 * page may both report one payment and it is credited once.
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') cod_fail(405, 'method_not_allowed', 'POST only');
$raw = file_get_contents('php://input');
if (strlen($raw) > 16 * 1024) cod_fail(413, 'too_large', 'Request is too large');

$secret = (string)getenv('DIGIFYCE_CONFIRM_SECRET');
if (strlen($secret) < 32) cod_fail(503, 'not_configured', 'Not configured');
$timestamp = (string)($_SERVER['HTTP_X_DIGIFYCE_TIMESTAMP'] ?? '');
$signature = (string)($_SERVER['HTTP_X_DIGIFYCE_SIGNATURE'] ?? '');
if (!ctype_digit($timestamp) || abs(time() - (int)$timestamp) > 300) cod_fail(401, 'stale', 'Request expired');
if (!hash_equals(hash_hmac('sha256', $timestamp . '.' . $raw, $secret), strtolower($signature))) cod_fail(401, 'bad_signature', 'Bad signature');

$body = json_decode($raw, true);
if (!is_array($body)) cod_fail(400, 'invalid_json', 'Invalid JSON');
$shop = cod_shop($body['shop'] ?? '');
$rechargeId = (int)($body['recharge_id'] ?? 0);
$amount = (int)($body['amount_paise'] ?? 0);
$paymentId = preg_replace('/[^A-Za-z0-9_]/', '', (string)($body['payment_id'] ?? ''));
$orderId = preg_replace('/[^A-Za-z0-9_]/', '', (string)($body['order_id'] ?? ''));
if (($body['status'] ?? '') !== 'paid' || $rechargeId < 1 || $paymentId === '') cod_fail(400, 'invalid_request', 'Not a paid recharge');

otpw_run($pdo, function ($pdo) use ($shop, $rechargeId, $amount, $paymentId, $orderId) {
    $stmt = $pdo->prepare('SELECT amount_paise, status, razorpay_order_id FROM otp_recharges WHERE id = ? AND shop = ? LIMIT 1');
    $stmt->execute([$rechargeId, $shop]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) cod_fail(404, 'unknown_recharge', 'Unknown recharge');
    if ((int)$row['amount_paise'] !== $amount) cod_fail(409, 'amount_mismatch', 'Amount does not match the recharge');
    if (!empty($row['razorpay_order_id']) && $orderId !== '' && $row['razorpay_order_id'] !== $orderId) cod_fail(409, 'order_mismatch', 'Order does not match the recharge');

    $result = otpw_apply($pdo, $shop, 'credit', $amount, 'pay:' . $paymentId, 'Recharge');
    $pdo->prepare("UPDATE otp_recharges SET status = 'paid', razorpay_payment_id = ?, paid_at = COALESCE(paid_at, NOW()) WHERE id = ?")
        ->execute([substr($paymentId, 0, 64), $rechargeId]);
    cod_ok(['balance_paise' => $result['balance'], 'duplicate' => $result['duplicate']]);
});
