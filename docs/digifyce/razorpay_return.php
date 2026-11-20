<?php
require_once __DIR__ . '/razorpay_helpers.php';

/**
 * Razorpay Checkout sends the merchant's browser here after payment
 * (POST razorpay_payment_id, razorpay_order_id, razorpay_signature).
 * We verify the signature, check the order with Razorpay, have BRIX credit the
 * wallet, then send the merchant back to the BRIX admin.
 */

$orderId = preg_replace('/[^A-Za-z0-9_]/', '', (string)($_POST['razorpay_order_id'] ?? ''));
$paymentId = preg_replace('/[^A-Za-z0-9_]/', '', (string)($_POST['razorpay_payment_id'] ?? ''));
$signature = (string)($_POST['razorpay_signature'] ?? '');

$result = ['ok' => false, 'return_url' => null];
if ($orderId !== '' && $paymentId !== '' && dg_checkout_signature_ok($orderId, $paymentId, $signature)) {
    $result = dg_credit_paid_order($orderId, $paymentId);
}

$back = $result['return_url'];
if ($back) {
    header('Location: ' . $back . (strpos($back, '?') === false ? '?' : '&') . 'paid=' . ($result['ok'] ? '1' : '0'), true, 303);
    exit;
}
header('Content-Type: text/html; charset=utf-8');
echo '<!doctype html><meta charset="utf-8"><title>Payment</title><p style="font-family:system-ui;padding:24px">'
    . ($result['ok'] ? 'Payment received. You can close this tab and go back to BRIX.' : 'We could not confirm this payment yet. If money was taken, it will show in BRIX shortly.')
    . '</p>';
