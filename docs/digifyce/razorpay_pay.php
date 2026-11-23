<?php
require_once __DIR__ . '/razorpay_helpers.php';

/**
 * The page the merchant opens (from BRIX) to pay a recharge: Razorpay Checkout
 * for one order. The amount comes from Razorpay's own copy of the order, never
 * from the address, so changing the link changes nothing.
 */

$orderId = preg_replace('/[^A-Za-z0-9_]/', '', (string)($_GET['order_id'] ?? ''));
[$status, $order] = $orderId === '' ? [0, null] : dg_razorpay('GET', '/orders/' . rawurlencode($orderId));
$notes = is_array($order['notes'] ?? null) ? $order['notes'] : [];
$valid = $status === 200 && ($notes['purpose'] ?? '') === 'brix_otp_wallet' && ($order['status'] ?? '') === 'created';
$h = fn($v) => htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header("Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://checkout.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com; connect-src https://lumberjack.razorpay.com https://api.razorpay.com; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'");
?><!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Add OTP credit</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f7f9;color:#161a22;margin:0;display:grid;place-items:center;min-height:100vh}
.card{background:#fff;border:1px solid #dde1e8;border-radius:12px;padding:28px;max-width:380px;width:calc(100% - 32px);text-align:center}
button{background:#1d5fd1;color:#fff;border:0;border-radius:8px;padding:12px 22px;font-size:16px;cursor:pointer}
p{color:#5b6475}</style></head><body><div class="card">
<?php if ($valid): $amount = (int)$order['amount']; $shop = dg_shop($notes['shop'] ?? ''); ?>
  <h2>Add OTP credit</h2>
  <p>Store: <?= $h($shop) ?></p>
  <h1>₹<?= $h(number_format($amount / 100, 2)) ?></h1>
  <button id="pay">Pay with Razorpay</button>
  <p id="msg"></p>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <script>
    var options = {
      key: <?= json_encode(dg_env('RAZORPAY_KEY_ID')) ?>,
      order_id: <?= json_encode($orderId) ?>,
      amount: <?= (int)$amount ?>,
      currency: 'INR',
      name: 'BRIX OTP credit',
      description: 'Prepaid OTP SMS wallet',
      callback_url: <?= json_encode(rtrim(dg_env('DIGIFYCE_PUBLIC_URL'), '/') . '/razorpay_return.php') ?>,
      redirect: true,
      theme: { color: '#1d5fd1' }
    };
    document.getElementById('pay').onclick = function () { new Razorpay(options).open(); };
    new Razorpay(options).open();
  </script>
<?php else: ?>
  <h2>This payment link is not valid</h2>
  <p>It may already be paid or expired. Go back to BRIX and choose Add money again.</p>
<?php endif; ?>
</div></body></html>
