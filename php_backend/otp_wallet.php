<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/cod_helpers.php';
require_once __DIR__ . '/otp_wallet_lib.php';

/**
 * BRIX OTP wallet. Node-only (X-Brix-Internal-Secret).
 *
 *   POST { action: 'balance', shop }                         -> { balance_paise }
 *   POST { action: 'debit',  shop, amount_paise, ref }       -> { balance_paise, duplicate }
 *        402 wallet_empty when the balance is lower than the amount
 *   POST { action: 'refund', shop, amount_paise, ref }       -> { balance_paise, duplicate }
 *        (an OTP SMS that failed to send after it was charged)
 *   POST { action: 'grant',  shop, amount_paise, ref }       -> { balance_paise, duplicate }
 *        free credit from BRIX (max Rs 1,000 a call); the same ref never credits twice.
 *        Run by scripts/otp-wallet-grant.mjs.
 *   POST { action: 'ledger', shop, limit?, before_id?, type? } -> { balance_paise, entries: [...], has_more }
 *        newest first, `limit` 1-100 (default 20); `before_id` = the last id shown
 *        (next page); `type` = debit | refund | credit (else all). created_ts =
 *        Unix seconds, so Node can show the time in the shop's zone.
 *   POST { action: 'recharge_create', shop, amount_paise, return_url }
 *        -> { recharge_id, pay_url }  asks Digifyce (digifyce.global.com) for a
 *        Razorpay payment page; the money is credited only when Digifyce confirms
 *        the payment to otp_wallet_confirm.php.
 *
 * Server environment (php_backend/.htaccess): DIGIFYCE_API_URL (e.g.
 * https://digifyce.global.com), DIGIFYCE_API_KEY.
 */

cod_require_secret();
$body = cod_body();
$shop = cod_shop($body['shop'] ?? '');
$action = $body['action'] ?? '';
$amount = (int)($body['amount_paise'] ?? 0);

if ($action === 'balance') {
    otpw_run($pdo, function ($pdo) use ($shop) {
        cod_ok(['balance_paise' => otpw_balance($pdo, $shop)]);
    });
}

if ($action === 'debit' || $action === 'refund') {
    $ref = (string)($body['ref'] ?? '');
    otpw_run($pdo, function ($pdo) use ($shop, $action, $amount, $ref) {
        $result = otpw_apply($pdo, $shop, $action, $amount, $ref, $action === 'debit' ? 'OTP SMS' : 'OTP SMS not sent');
        cod_ok(['balance_paise' => $result['balance'], 'duplicate' => $result['duplicate']]);
    });
}

if ($action === 'grant') {
    $ref = (string)($body['ref'] ?? '');
    if ($amount > OTPW_MAX_GRANT_PAISE) cod_fail(400, 'invalid_amount', 'A grant can be at most Rs ' . (OTPW_MAX_GRANT_PAISE / 100) . '.');
    if (strpos($ref, 'grant:') !== 0) cod_fail(400, 'invalid_ref', 'A grant reference starts with grant:');
    otpw_run($pdo, function ($pdo) use ($shop, $amount, $ref) {
        $result = otpw_apply($pdo, $shop, 'credit', $amount, $ref, 'Free credit from BRIX');
        cod_ok(['balance_paise' => $result['balance'], 'duplicate' => $result['duplicate']]);
    });
}

if ($action === 'ledger') {
    $limit = max(1, min(100, (int)($body['limit'] ?? 20)));
    $before = max(0, (int)($body['before_id'] ?? 0));
    $type = in_array($body['type'] ?? '', ['debit', 'refund', 'credit'], true) ? $body['type'] : '';
    otpw_run($pdo, function ($pdo) use ($shop, $limit, $before, $type) {
        $sql = 'SELECT id, type, amount_paise, balance_after, note, created_at, UNIX_TIMESTAMP(created_at) AS created_ts FROM otp_wallet_ledger WHERE shop = ?';
        $params = [$shop];
        if ($before > 0) { $sql .= ' AND id < ?'; $params[] = $before; }
        if ($type !== '') { $sql .= ' AND type = ?'; $params[] = $type; }
        // One extra row tells whether there is a next page.
        $stmt = $pdo->prepare($sql . ' ORDER BY id DESC LIMIT ' . ($limit + 1));
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $hasMore = count($rows) > $limit;
        cod_ok(['balance_paise' => otpw_balance($pdo, $shop), 'entries' => array_slice($rows, 0, $limit), 'has_more' => $hasMore]);
    });
}

if ($action === 'recharge_create') {
    if ($amount < OTPW_MIN_RECHARGE_PAISE || $amount > OTPW_MAX_RECHARGE_PAISE) {
        cod_fail(400, 'invalid_amount', 'Enter an amount between Rs ' . (OTPW_MIN_RECHARGE_PAISE / 100) . ' and Rs ' . number_format(OTPW_MAX_RECHARGE_PAISE / 100) . '.');
    }
    $returnUrl = (string)($body['return_url'] ?? '');
    $host = strtolower((string)parse_url($returnUrl, PHP_URL_HOST));
    if (parse_url($returnUrl, PHP_URL_SCHEME) !== 'https' || !($host === 'admin.shopify.com' || substr($host, -14) === '.myshopify.com')) {
        cod_fail(400, 'invalid_return_url', 'Return address must be the store admin.');
    }
    $base = rtrim((string)getenv('DIGIFYCE_API_URL'), '/');
    $key = (string)getenv('DIGIFYCE_API_KEY');
    if ($base === '' || $key === '') cod_fail(503, 'digifyce_not_configured', 'Recharge is not set up on this server yet.');

    otpw_run($pdo, function ($pdo) use ($shop, $amount, $returnUrl, $base, $key) {
        $pdo->prepare("INSERT INTO otp_recharges (shop, amount_paise, status) VALUES (?, ?, 'created')")->execute([$shop, $amount]);
        $rechargeId = (int)$pdo->lastInsertId();

        $ch = curl_init($base . '/razorpay_create_order.php');
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json', 'Authorization: Bearer ' . $key],
            CURLOPT_POSTFIELDS => json_encode(['shop' => $shop, 'amount_paise' => $amount, 'recharge_id' => $rechargeId, 'return_url' => $returnUrl]),
        ]);
        $raw = curl_exec($ch);
        $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $json = is_string($raw) ? json_decode($raw, true) : null;
        if ($http !== 200 || !is_array($json) || empty($json['ok']) || empty($json['order_id']) || empty($json['pay_url'])) {
            error_log('[otp_wallet] Digifyce create order failed: HTTP ' . $http . ' ' . substr((string)$raw, 0, 200));
            $pdo->prepare("UPDATE otp_recharges SET status = 'failed' WHERE id = ?")->execute([$rechargeId]);
            cod_fail(502, 'payment_unavailable', 'The payment page could not be opened. Please try again.');
        }
        $pdo->prepare('UPDATE otp_recharges SET razorpay_order_id = ? WHERE id = ?')->execute([substr((string)$json['order_id'], 0, 64), $rechargeId]);
        cod_ok(['recharge_id' => $rechargeId, 'pay_url' => (string)$json['pay_url']]);
    });
}

cod_fail(400, 'invalid_action', 'Unknown action');
