<?php
require_once __DIR__ . '/razorpay_helpers.php';

/**
 * Razorpay -> Digifyce webhook. In the Razorpay dashboard (Settings -> Webhooks)
 * add this URL, the secret RAZORPAY_WEBHOOK_SECRET, and the event "order.paid".
 *
 * It is the reliable path: it fires even when the merchant closes the tab before
 * the return page. A failure answers 500, so Razorpay retries; BRIX credits one
 * payment once however many times it is told.
 */

$raw = file_get_contents('php://input');
$secret = dg_env('RAZORPAY_WEBHOOK_SECRET');
$sent = (string)($_SERVER['HTTP_X_RAZORPAY_SIGNATURE'] ?? '');
if ($secret === '' || !hash_equals(hash_hmac('sha256', $raw, $secret), $sent)) {
    http_response_code(400);
    exit('bad signature');
}

$event = json_decode($raw, true);
if (!is_array($event) || ($event['event'] ?? '') !== 'order.paid') {
    http_response_code(200);   // other events are not ours
    exit('ignored');
}
$orderId = preg_replace('/[^A-Za-z0-9_]/', '', (string)($event['payload']['order']['entity']['id'] ?? ''));
$paymentId = preg_replace('/[^A-Za-z0-9_]/', '', (string)($event['payload']['payment']['entity']['id'] ?? ''));
if ($orderId === '' || $paymentId === '') {
    http_response_code(200);
    exit('ignored');
}

$result = dg_credit_paid_order($orderId, $paymentId);
// An order that isn't a BRIX recharge (the same Razorpay account may serve other apps) is ignored, not retried forever.
http_response_code($result['ok'] || $result['return_url'] === null ? 200 : 500);
echo $result['ok'] ? 'credited' : 'not credited';
