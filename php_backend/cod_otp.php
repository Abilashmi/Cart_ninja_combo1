<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/cod_helpers.php';

/**
 * BRIX COD Checkout one-time codes. Node-only, X-Forge-Secret.
 * Node generates the code, sends the SMS and hashes phone + code
 * (HMAC with SHOPIFY_API_SECRET); this file stores and compares hashes only.
 *
 *   POST { action: 'create', shop, phone_hash, code_hash }
 *        → { id }  |  429 otp_too_soon (one code per 30 s)  |  429 otp_limit (5 per hour)
 *   POST { action: 'delete', shop, id }            (SMS failed to send)
 *   POST { action: 'verify', shop, phone_hash, code_hash }
 *        → { result: 'ok' | 'wrong' | 'expired' | 'locked', attemptsLeft }
 *          'ok' marks the code used, so it can't be verified twice.
 */

const COD_OTP_TTL_MINUTES = 10;
const COD_OTP_RESEND_SECONDS = 30;
const COD_OTP_MAX_PER_HOUR = 5;
const COD_OTP_MAX_ATTEMPTS = 5;

cod_require_secret();
$body = cod_body();
$shop = cod_shop($body['shop'] ?? '');
$action = $body['action'] ?? '';

if ($action === 'create') {
    $phoneHash = cod_hash($body['phone_hash'] ?? '', 'phone_hash');
    $codeHash = cod_hash($body['code_hash'] ?? '', 'code_hash');
    cod_db($pdo, function ($pdo) use ($shop, $phoneHash, $codeHash) {
        // Old codes are never needed again.
        $pdo->prepare('DELETE FROM cod_otp WHERE shop = ? AND created_at < DATE_SUB(NOW(), INTERVAL 1 DAY)')->execute([$shop]);

        $stmt = $pdo->prepare(
            'SELECT COUNT(*) AS sends,
                    SUM(TIMESTAMPDIFF(SECOND, created_at, NOW()) < ?) AS recent
               FROM cod_otp
              WHERE shop = ? AND phone_hash = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)'
        );
        $stmt->execute([COD_OTP_RESEND_SECONDS, $shop, $phoneHash]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ((int)($row['recent'] ?? 0) > 0) cod_fail(429, 'otp_too_soon', 'Please wait ' . COD_OTP_RESEND_SECONDS . ' seconds before asking for a new code.');
        if ((int)($row['sends'] ?? 0) >= COD_OTP_MAX_PER_HOUR) cod_fail(429, 'otp_limit', 'Too many codes were sent to this number. Try again in an hour, or pay online.');

        $stmt = $pdo->prepare('INSERT INTO cod_otp (shop, phone_hash, code_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ' . COD_OTP_TTL_MINUTES . ' MINUTE))');
        $stmt->execute([$shop, $phoneHash, $codeHash]);
        cod_ok(['id' => (int)$pdo->lastInsertId(), 'resendAfter' => COD_OTP_RESEND_SECONDS]);
    });
}

if ($action === 'delete') {
    $id = (int)($body['id'] ?? 0);
    cod_db($pdo, function ($pdo) use ($shop, $id) {
        $pdo->prepare('DELETE FROM cod_otp WHERE id = ? AND shop = ?')->execute([$id, $shop]);
        cod_ok();
    });
}

if ($action === 'verify') {
    $phoneHash = cod_hash($body['phone_hash'] ?? '', 'phone_hash');
    $codeHash = cod_hash($body['code_hash'] ?? '', 'code_hash');
    cod_db($pdo, function ($pdo) use ($shop, $phoneHash, $codeHash) {
        $stmt = $pdo->prepare(
            'SELECT id, code_hash, attempts FROM cod_otp
              WHERE shop = ? AND phone_hash = ? AND verified = 0 AND expires_at > NOW()
              ORDER BY id DESC LIMIT 1'
        );
        $stmt->execute([$shop, $phoneHash]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) cod_ok(['result' => 'expired', 'attemptsLeft' => 0]);

        $attempts = (int)$row['attempts'];
        if ($attempts >= COD_OTP_MAX_ATTEMPTS) cod_ok(['result' => 'locked', 'attemptsLeft' => 0]);

        if (!hash_equals((string)$row['code_hash'], $codeHash)) {
            $pdo->prepare('UPDATE cod_otp SET attempts = attempts + 1 WHERE id = ?')->execute([$row['id']]);
            $left = COD_OTP_MAX_ATTEMPTS - $attempts - 1;
            cod_ok(['result' => $left > 0 ? 'wrong' : 'locked', 'attemptsLeft' => max(0, $left)]);
        }

        // Only one request can claim the code (verified = 0 in the WHERE).
        $claim = $pdo->prepare('UPDATE cod_otp SET verified = 1 WHERE id = ? AND verified = 0');
        $claim->execute([$row['id']]);
        cod_ok(['result' => $claim->rowCount() === 1 ? 'ok' : 'expired', 'attemptsLeft' => 0]);
    });
}

cod_fail(400, 'invalid_action', 'Unknown action');
