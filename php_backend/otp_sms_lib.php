<?php
/**
 * BRIX's own OTP SMS, sent from this server: the sender behind the OTP wallet
 * (otp_wallet.php `send` charges 50 paise, calls otps_send(), refunds on failure).
 * A store with its own MSG91 keys never comes here: Node sends those itself.
 *
 * Server environment (php_backend/.htaccess):
 *   BRIX_MSG91_AUTH_KEY      MSG91 → Settings → API keys (Authkey)
 *   BRIX_MSG91_TEMPLATE_ID   MSG91's template ID (letters and numbers, not the DLT number)
 *   BRIX_MSG91_API           otp  = template under MSG91 → OTP (holds ##OTP##), default
 *                            flow = template under MSG91 → SMS → Templates
 *   BRIX_MSG91_VARIABLE      flow only: the template variable that holds the code (default OTP)
 *   BRIX_MSG91_BASE          default https://control.msg91.com (the tests point it at a fake server)
 *
 * The same two requests as app/services/cod-sms.server.js msg91OtpRequest /
 * msg91FlowRequest (scripts/msg91-otp-tester.mjs tries a template with them).
 */

const OTPS_TIMEOUT_SECONDS = 8;

function otps_env($name, $default = '') {
    $value = trim((string)getenv($name));
    return $value === '' ? $default : $value;
}

function otps_configured() {
    return otps_env('BRIX_MSG91_AUTH_KEY') !== '' && otps_env('BRIX_MSG91_TEMPLATE_ID') !== '';
}

/**
 * Sends $otp to +91 $mobile10. Returns ['sent' => bool, 'message_id' => string, 'error' => string];
 * 'sent' is true only when MSG91 accepted the message.
 */
function otps_send($mobile10, $otp) {
    if (!otps_configured()) return ['sent' => false, 'message_id' => '', 'error' => 'not_configured'];
    $authKey = otps_env('BRIX_MSG91_AUTH_KEY');
    $template = otps_env('BRIX_MSG91_TEMPLATE_ID');
    $base = rtrim(otps_env('BRIX_MSG91_BASE', 'https://control.msg91.com'), '/');
    $headers = ['authkey: ' . $authKey, 'Content-Type: application/json', 'Accept: application/json'];

    if (otps_env('BRIX_MSG91_API', 'otp') === 'flow') {
        $variable = preg_replace('/[^A-Za-z0-9_]/', '', otps_env('BRIX_MSG91_VARIABLE', 'OTP')) ?: 'OTP';
        $url = $base . '/api/v5/flow';
        $payload = json_encode(['template_id' => $template, 'short_url' => '0', 'recipients' => [['mobiles' => '91' . $mobile10, $variable => $otp]]]);
    } else {
        $url = $base . '/api/v5/otp?' . http_build_query(['template_id' => $template, 'mobile' => '91' . $mobile10, 'otp' => $otp]);
        $payload = '{}';
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => OTPS_TIMEOUT_SECONDS,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_POSTFIELDS => $payload,
    ]);
    $raw = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($raw === false) {
        error_log('[otp_sms] MSG91 unreachable: ' . substr($curlError, 0, 160));
        return ['sent' => false, 'message_id' => '', 'error' => 'unreachable'];
    }
    $json = json_decode((string)$raw, true);
    if ($status === 200 && is_array($json) && ($json['type'] ?? '') !== 'error') {
        return ['sent' => true, 'message_id' => substr((string)($json['request_id'] ?? $json['message'] ?? ''), 0, 120), 'error' => ''];
    }
    // MSG91's own reason (wrong template, DLT, balance, ...), never the key.
    error_log('[otp_sms] MSG91 refused the OTP: HTTP ' . $status . ' ' . substr((string)($json['message'] ?? $raw), 0, 160));
    return ['sent' => false, 'message_id' => '', 'error' => 'rejected'];
}
