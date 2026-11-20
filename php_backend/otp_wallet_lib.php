<?php
/**
 * OTP wallet shared code (see otp_wallet.php and otp_wallet_confirm.php).
 *
 * Every store has a prepaid balance in paise (50 paise per OTP SMS sent
 * through Digifyce). BRIX owns the balance; Digifyce only sends the SMS and
 * takes the Razorpay payment. Tables are created here on first use:
 *
 *   otp_wallet         one row per shop: balance_paise
 *   otp_wallet_ledger  every credit / debit / refund; (shop, ref) is unique, so
 *                      a retried request can never move money twice
 *   otp_recharges      one row per recharge asked for (created -> paid)
 *
 * While the balance is under one OTP's price a store with no keys of its own
 * gets no OTP step (cod_settings blob `_runtime.otpAvailable`), and this file
 * keeps that flag in step in the same transaction as the money.
 */

const OTPW_PRICE_PAISE = 50;
const OTPW_MIN_RECHARGE_PAISE = 10000;     // Rs 100
const OTPW_MAX_RECHARGE_PAISE = 5000000;   // Rs 50,000

class OtpWalletError extends Exception {
    public $httpStatus;
    public $errCode;
    public function __construct($httpStatus, $errCode, $message) {
        parent::__construct($message);
        $this->httpStatus = $httpStatus;
        $this->errCode = $errCode;
    }
}

function otpw_ensure_tables($pdo) {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS otp_wallet (
            shop          VARCHAR(255) NOT NULL,
            balance_paise BIGINT NOT NULL DEFAULT 0,
            updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (shop)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS otp_wallet_ledger (
            id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            shop          VARCHAR(255) NOT NULL,
            type          VARCHAR(10) NOT NULL,
            amount_paise  BIGINT NOT NULL,
            balance_after BIGINT NOT NULL,
            ref           VARCHAR(120) NOT NULL,
            note          VARCHAR(160) NULL,
            created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uniq_otpw_ref (shop, ref),
            KEY idx_otpw_shop (shop, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS otp_recharges (
            id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            shop                 VARCHAR(255) NOT NULL,
            amount_paise         BIGINT NOT NULL,
            status               VARCHAR(10) NOT NULL DEFAULT 'created',
            razorpay_order_id    VARCHAR(64) NULL,
            razorpay_payment_id  VARCHAR(64) NULL,
            created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            paid_at              DATETIME NULL,
            PRIMARY KEY (id),
            KEY idx_otpr_shop (shop, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
}

function otpw_balance($pdo, $shop) {
    $stmt = $pdo->prepare('SELECT balance_paise FROM otp_wallet WHERE shop = ? LIMIT 1');
    $stmt->execute([$shop]);
    $value = $stmt->fetchColumn();
    return $value === false ? 0 : (int)$value;
}

/**
 * Moves money in one transaction. $type: 'credit' | 'refund' (adds) or 'debit'.
 * Returns ['balance' => int, 'duplicate' => bool]; a ref already in the ledger
 * changes nothing and reports duplicate. A debit above the balance throws
 * OtpWalletError(402, 'wallet_empty').
 */
function otpw_apply($pdo, $shop, $type, $amount, $ref, $note = null) {
    if ($amount <= 0) throw new OtpWalletError(400, 'invalid_amount', 'Amount must be positive');
    $ref = substr((string)$ref, 0, 120);
    if ($ref === '') throw new OtpWalletError(400, 'invalid_ref', 'A reference is required');
    $pdo->beginTransaction();
    try {
        $pdo->prepare('INSERT IGNORE INTO otp_wallet (shop, balance_paise) VALUES (?, 0)')->execute([$shop]);
        $stmt = $pdo->prepare('SELECT balance_paise FROM otp_wallet WHERE shop = ? FOR UPDATE');
        $stmt->execute([$shop]);
        $balance = (int)$stmt->fetchColumn();

        $seen = $pdo->prepare('SELECT id FROM otp_wallet_ledger WHERE shop = ? AND ref = ? LIMIT 1');
        $seen->execute([$shop, $ref]);
        if ($seen->fetchColumn() !== false) {
            $pdo->commit();
            return ['balance' => $balance, 'duplicate' => true];
        }

        $delta = $type === 'debit' ? -$amount : $amount;
        if ($balance + $delta < 0) {
            $pdo->rollBack();
            throw new OtpWalletError(402, 'wallet_empty', 'Not enough OTP credit');
        }
        $after = $balance + $delta;
        $pdo->prepare('UPDATE otp_wallet SET balance_paise = ? WHERE shop = ?')->execute([$after, $shop]);
        $pdo->prepare('INSERT INTO otp_wallet_ledger (shop, type, amount_paise, balance_after, ref, note) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([$shop, $type, $amount, $after, $ref, $note === null ? null : mb_substr((string)$note, 0, 160)]);
        otpw_sync_runtime($pdo, $shop, $after);
        $pdo->commit();
        return ['balance' => $after, 'duplicate' => false];
    } catch (OtpWalletError $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
}

/**
 * Keeps `_runtime.otpAvailable` in the store's COD settings in step with the
 * balance, so the storefront drops / restores the OTP step without waiting for
 * Node. A store with its own MSG91 keys never depends on the wallet, so its flag
 * is left alone. No settings row yet = nothing to update.
 */
function otpw_sync_runtime($pdo, $shop, $balance) {
    $stmt = $pdo->prepare('SELECT settings_json FROM cod_settings WHERE shop = ? LIMIT 1');
    $stmt->execute([$shop]);
    $json = $stmt->fetchColumn();
    if ($json === false) return;
    $settings = json_decode($json, true);
    if (!is_array($settings)) return;

    $own = $pdo->prepare('SELECT msg91_auth_key, msg91_template_id FROM cod_secrets WHERE shop = ? LIMIT 1');
    $own->execute([$shop]);
    $keys = $own->fetch(PDO::FETCH_ASSOC);
    if ($keys && !empty($keys['msg91_auth_key']) && !empty($keys['msg91_template_id'])) return;

    $available = $balance >= OTPW_PRICE_PAISE;
    $runtime = is_array($settings['_runtime'] ?? null) ? $settings['_runtime'] : [];
    if (($runtime['otpAvailable'] ?? null) === $available) return;
    $runtime['otpAvailable'] = $available;
    $settings['_runtime'] = $runtime;
    $out = json_encode($settings, JSON_UNESCAPED_UNICODE);
    if ($out === false || strlen($out) > 60000) return;
    $pdo->prepare('UPDATE cod_settings SET settings_json = ? WHERE shop = ?')->execute([$out, $shop]);
}

/** Runs $fn inside the shared COD error handling; OtpWalletError becomes its HTTP answer. */
function otpw_run($pdo, $fn) {
    cod_db($pdo, function ($pdo) use ($fn) {
        try {
            otpw_ensure_tables($pdo);
            return $fn($pdo);
        } catch (OtpWalletError $e) {
            cod_fail($e->httpStatus, $e->errCode, $e->getMessage());
        }
    });
}
