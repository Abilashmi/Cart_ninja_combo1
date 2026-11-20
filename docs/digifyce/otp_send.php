<?php
require_once __DIR__ . '/razorpay_helpers.php';
require_once __DIR__ . '/sms_gateway.php';

/**
 * BRIX -> Digifyce: send one OTP SMS.
 *
 *   POST  Authorization: Bearer <BRIX_API_KEY>
 *   { shop, mobile: "9876543210", otp: "1234", ref: "otp:123" }
 *   -> { ok: true, messageId }   |   { ok: false, error }
 *
 * BRIX has already taken 50 paise from the store's wallet before calling and
 * gives it back when this answers ok: false, so answer ok: true only when the
 * SMS was really handed to the gateway.
 */

dg_require_brix();
$body = dg_post_body();
$shop = dg_shop($body['shop'] ?? '');
$mobile = (string)($body['mobile'] ?? '');
$otp = (string)($body['otp'] ?? '');
if ($shop === '' || !preg_match('/^[6-9]\d{9}$/', $mobile) || !preg_match('/^\d{4}$/', $otp)) {
    dg_json(400, ['ok' => false, 'error' => 'invalid_request']);
}

[$sent, $messageId] = dg_send_otp_sms($mobile, $otp);
if (!$sent) dg_json(502, ['ok' => false, 'error' => 'sms_failed']);
dg_json(200, ['ok' => true, 'messageId' => (string)$messageId]);
