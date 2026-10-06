<?php
require_once __DIR__ . '/config.php';

/**
 * BRIX COD Checkout — the storefront's single endpoint for placing a COD
 * order (extensions/cart-drawer/assets/brix_cod.js). The shopper's browser
 * only ever talks to this PHP backend.
 *
 *   POST { endpoint: 'otp' | 'quote' | 'order', shop, ...payload }
 *
 * Sending the SMS code, pricing the cart through Shopify and creating the
 * Shopify order need the store's Shopify access, which only the BRIX app
 * server holds — so this file relays the request server-to-server to
 * <BRIX_APP_URL>/api/cod/<endpoint> and returns its answer unchanged. It adds
 * X-Forge-Secret plus the shopper's real IP (X-Brix-Client-Ip), so the app
 * server's per-shopper rate limits still apply to each shopper instead of
 * to this server, and the shopper's User-Agent (X-Brix-Client-Ua), which the
 * Meta Conversions API Purchase event needs.
 *
 * BRIX_APP_URL (env, e.g. in .htaccess) defaults to https://cartdrawer.fly.dev.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-store');

function codc_fail($status, $code, $error) {
    http_response_code($status);
    echo json_encode(['success' => false, 'code' => $code, 'error' => $error]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') codc_fail(405, 'method_not_allowed', 'POST only');

$raw = file_get_contents('php://input');
if (strlen($raw) > 64 * 1024) codc_fail(413, 'too_large', 'Request is too large.');
$body = json_decode($raw ?: '{}', true);
if (!is_array($body)) codc_fail(400, 'invalid_request', 'Refresh the page and try again.');

$endpoint = $body['endpoint'] ?? '';
if (!in_array($endpoint, ['otp', 'quote', 'order'], true)) codc_fail(400, 'invalid_request', 'Refresh the page and try again.');
unset($body['endpoint']);

$secret = getenv('SHOPIFY_API_KEY') ?: '';
if (!$secret) {
    error_log('[cod_checkout] SHOPIFY_API_KEY is not set on this server');
    codc_fail(503, 'not_configured', 'Cash on Delivery is temporarily unavailable. Please try again, or pay online.');
}

$clientIp = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? ($_SERVER['REMOTE_ADDR'] ?? '');
$clientUa = substr(preg_replace('/[\x00-\x1f\x7f]/', '', (string)($_SERVER['HTTP_USER_AGENT'] ?? '')), 0, 400);
$appUrl = rtrim(getenv('BRIX_APP_URL') ?: 'https://cartdrawer.fly.dev', '/');

$ch = curl_init($appUrl . '/api/cod/' . $endpoint);
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($body),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT => 45, // placing an order waits for Shopify
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Accept: application/json',
        'X-Forge-Secret: ' . $secret,
        'X-Brix-Client-Ip: ' . $clientIp,
        'X-Brix-Client-Ua: ' . $clientUa,
        'ngrok-skip-browser-warning: 1', // lets BRIX_APP_URL point at a dev tunnel
    ],
]);
$response = curl_exec($ch);
$status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);

$json = is_string($response) ? json_decode($response, true) : null;
if (!is_array($json) || !array_key_exists('success', $json)) {
    error_log('[cod_checkout] app server ' . $appUrl . '/api/cod/' . $endpoint . ' gave HTTP ' . $status . ($error ? ' (' . $error . ')' : '') . ': ' . substr((string)$response, 0, 200));
    codc_fail(503, 'app_unavailable', 'Cash on Delivery is temporarily unavailable. Please try again, or pay online.');
}

http_response_code($status ?: 200);
echo json_encode($json);
