<?php
/**
 * The one function that talks to the SMS gateway. Replace the body with the
 * gateway Digifyce really uses; otp_send.php only needs this contract:
 *
 *   dg_send_otp_sms(string $mobile10, string $otp4): array  ->  [bool $sent, string $messageId]
 *
 * Return [true, id] only when the gateway accepted the message.
 *
 * The version below sends through MSG91's OTP API as a working example. It reads
 * DIGIFYCE_MSG91_AUTH_KEY and DIGIFYCE_MSG91_TEMPLATE_ID (a DLT-approved OTP
 * template containing ##OTP##) from the server environment.
 */

function dg_send_otp_sms($mobile10, $otp4) {
    $authKey = (string)getenv('DIGIFYCE_MSG91_AUTH_KEY');
    $template = (string)getenv('DIGIFYCE_MSG91_TEMPLATE_ID');
    if ($authKey === '' || $template === '') {
        error_log('[digifyce] SMS gateway is not configured (sms_gateway.php)');
        return [false, ''];
    }
    $url = 'https://control.msg91.com/api/v5/otp?' . http_build_query(['template_id' => $template, 'mobile' => '91' . $mobile10, 'otp' => $otp4]);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 8,
        CURLOPT_HTTPHEADER => ['authkey: ' . $authKey, 'Content-Type: application/json'],
        CURLOPT_POSTFIELDS => '{}',
    ]);
    $raw = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $json = is_string($raw) ? json_decode($raw, true) : null;
    if ($status === 200 && is_array($json) && ($json['type'] ?? '') !== 'error') return [true, (string)($json['request_id'] ?? $json['message'] ?? '')];
    error_log('[digifyce] MSG91 refused the OTP: HTTP ' . $status . ' ' . substr((string)$raw, 0, 160));
    return [false, ''];
}
