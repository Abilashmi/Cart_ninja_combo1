<?php
/**
 * Shared code for the BRIX OTP wallet on digifyceglobal.com/wallet-brix-convert.
 * Upload every file in docs/digifyce/ to the same folder on the Digifyce server.
 *
 * Server environment (SetEnv in .htaccess, see .htaccess.example). Nothing secret is in the code:
 *   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
 *   BRIX_API_KEY          long random value BRIX sends as "Authorization: Bearer ..."
 *                         (same value as DIGIFYCE_API_KEY on the BRIX side)
 *   BRIX_CONFIRM_URL      https://<BRIX PHP server>/otp_wallet_confirm.php
 *   BRIX_CONFIRM_SECRET   32+ characters, same as DIGIFYCE_CONFIRM_SECRET on the BRIX PHP server
 *   DIGIFYCE_PUBLIC_URL   https://digifyceglobal.com/wallet-brix-convert (this folder, no trailing slash)
 */

function dg_json($status, $body) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body);
    exit;
}

function dg_env($name) {
    return (string)getenv($name);
}

/** Only BRIX may call create-order. */
function dg_require_brix() {
    $key = dg_env('BRIX_API_KEY');
    if (strlen($key) < 32) dg_json(503, ['ok' => false, 'error' => 'not_configured']);
    $sent = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
    if (stripos($sent, 'Bearer ') !== 0 || !hash_equals($key, trim(substr($sent, 7)))) dg_json(401, ['ok' => false, 'error' => 'unauthorized']);
}

function dg_post_body() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') dg_json(405, ['ok' => false, 'error' => 'post_only']);
    $raw = file_get_contents('php://input');
    if (strlen($raw) > 16 * 1024) dg_json(413, ['ok' => false, 'error' => 'too_large']);
    $body = json_decode($raw ?: '{}', true);
    if (!is_array($body)) dg_json(400, ['ok' => false, 'error' => 'invalid_json']);
    return $body;
}

/** A BRIX shop id: abc.myshopify.com. */
function dg_shop($value) {
    $shop = strtolower(trim((string)$value));
    return preg_match('/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/', $shop) ? $shop : '';
}

/** Only back to the merchant's Shopify admin (no open redirect). */
function dg_return_url_ok($url) {
    $host = strtolower((string)parse_url((string)$url, PHP_URL_HOST));
    return parse_url((string)$url, PHP_URL_SCHEME) === 'https'
        && ($host === 'admin.shopify.com' || substr($host, -14) === '.myshopify.com')
        && strlen((string)$url) <= 250;
}

/** Calls Razorpay's API. Returns [httpStatus, decodedJson|null]. */
function dg_razorpay($method, $path, $body = null) {
    $ch = curl_init('https://api.razorpay.com/v1' . $path);
    $opts = [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_USERPWD => dg_env('RAZORPAY_KEY_ID') . ':' . dg_env('RAZORPAY_KEY_SECRET'),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    ];
    if ($body !== null) $opts[CURLOPT_POSTFIELDS] = json_encode($body);
    curl_setopt_array($ch, $opts);
    $raw = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    return [$status, is_string($raw) ? json_decode($raw, true) : null];
}

/** The signature Razorpay Checkout returns: HMAC-SHA256(order_id|payment_id, key secret). */
function dg_checkout_signature_ok($orderId, $paymentId, $signature) {
    $expected = hash_hmac('sha256', $orderId . '|' . $paymentId, dg_env('RAZORPAY_KEY_SECRET'));
    return hash_equals($expected, strtolower((string)$signature));
}

/**
 * Tells BRIX a payment is captured, so it credits the wallet. BRIX checks the
 * signature, the recharge and the amount, and credits a payment once, so this is
 * safe to call from both the webhook and the return page, and to retry.
 */
function dg_confirm_to_brix($shop, $rechargeId, $amountPaise, $orderId, $paymentId) {
    $url = dg_env('BRIX_CONFIRM_URL');
    $secret = dg_env('BRIX_CONFIRM_SECRET');
    if ($url === '' || strlen($secret) < 32) return false;
    $payload = json_encode([
        'recharge_id' => (int)$rechargeId, 'shop' => $shop, 'amount_paise' => (int)$amountPaise,
        'payment_id' => $paymentId, 'order_id' => $orderId, 'status' => 'paid',
    ]);
    for ($attempt = 1; $attempt <= 3; $attempt++) {
        $timestamp = (string)time();
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'X-Digifyce-Timestamp: ' . $timestamp,
                'X-Digifyce-Signature: ' . hash_hmac('sha256', $timestamp . '.' . $payload, $secret),
            ],
            CURLOPT_POSTFIELDS => $payload,
        ]);
        curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($status === 200) return true;
        // A refusal that won't change on retry (bad amount, unknown recharge).
        if (in_array($status, [400, 401, 404, 409], true)) {
            error_log("[digifyce] BRIX refused the recharge confirmation: HTTP $status (payment $paymentId)");
            return false;
        }
        usleep(400000 * $attempt);
    }
    error_log("[digifyce] BRIX did not confirm the recharge (payment $paymentId); Razorpay will retry the webhook");
    return false;
}

/**
 * Checks with Razorpay itself (never the browser) that the order is paid in full
 * for a BRIX wallet recharge, then has BRIX credit it. Returns
 * ['ok' => bool, 'return_url' => string|null].
 */
function dg_credit_paid_order($orderId, $paymentId) {
    [$status, $order] = dg_razorpay('GET', '/orders/' . rawurlencode($orderId));
    if ($status !== 200 || !is_array($order)) return ['ok' => false, 'return_url' => null];
    $notes = is_array($order['notes'] ?? null) ? $order['notes'] : [];
    $returnUrl = dg_return_url_ok($notes['return_url'] ?? '') ? $notes['return_url'] : null;
    if (($notes['purpose'] ?? '') !== 'brix_otp_wallet') return ['ok' => false, 'return_url' => null];
    if (($order['status'] ?? '') !== 'paid' || (int)($order['amount_paid'] ?? 0) !== (int)($order['amount'] ?? -1)) {
        return ['ok' => false, 'return_url' => $returnUrl];
    }
    // The payment must belong to this order and be captured.
    [$pStatus, $payment] = dg_razorpay('GET', '/payments/' . rawurlencode($paymentId));
    if ($pStatus !== 200 || !is_array($payment) || ($payment['order_id'] ?? '') !== $orderId || ($payment['status'] ?? '') !== 'captured') {
        return ['ok' => false, 'return_url' => $returnUrl];
    }
    $shop = dg_shop($notes['shop'] ?? '');
    $rechargeId = (int)($notes['recharge_id'] ?? 0);
    if ($shop === '' || $rechargeId < 1) return ['ok' => false, 'return_url' => $returnUrl];
    return ['ok' => dg_confirm_to_brix($shop, $rechargeId, (int)$order['amount'], $orderId, $paymentId), 'return_url' => $returnUrl];
}
