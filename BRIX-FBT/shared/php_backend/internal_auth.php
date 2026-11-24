<?php
/**
 * Server-to-server auth between the BRIX app on Fly and this PHP backend.
 *
 * The secret is BRIX_INTERNAL_SECRET (env, set to the same long random value
 * here and on Fly), sent as X-Brix-Internal-Secret. It used to be
 * SHOPIFY_API_KEY in X-Forge-Secret, but that is the app's public client id
 * (it is in every merchant's admin page), so anyone could call these
 * endpoints, including db_proxy.php.
 *
 * Switching over without downtime: while BRIX_ACCEPT_LEGACY_SECRET=1 is set
 * here (and on Fly), the old header is still accepted and still sent. Once
 * both sides run this code, remove BRIX_ACCEPT_LEGACY_SECRET on both.
 * Fails closed: no BRIX_INTERNAL_SECRET (and no legacy switch) = every call refused.
 */

function brix_internal_secret() {
    $secret = getenv('BRIX_INTERNAL_SECRET') ?: '';
    return strlen($secret) >= 32 ? $secret : '';
}

function brix_accept_legacy_secret() {
    return getenv('BRIX_ACCEPT_LEGACY_SECRET') === '1';
}

/** True when the request carries the internal secret (or, during the switch, the old one). */
function brix_internal_request_ok() {
    $secret = brix_internal_secret();
    $sent = $_SERVER['HTTP_X_BRIX_INTERNAL_SECRET'] ?? '';
    if ($secret !== '' && is_string($sent) && $sent !== '' && hash_equals($secret, $sent)) return true;
    if (brix_accept_legacy_secret()) {
        $legacy = getenv('SHOPIFY_API_KEY') ?: '';
        $old = $_SERVER['HTTP_X_FORGE_SECRET'] ?? '';
        if ($legacy !== '' && is_string($old) && $old !== '' && hash_equals($legacy, $old)) return true;
    }
    return false;
}

/** Headers for calling the Fly app (curl CURLOPT_HTTPHEADER lines). */
function brix_internal_headers() {
    $headers = [];
    $secret = brix_internal_secret();
    if ($secret !== '') $headers[] = 'X-Brix-Internal-Secret: ' . $secret;
    if (brix_accept_legacy_secret() && getenv('SHOPIFY_API_KEY')) $headers[] = 'X-Forge-Secret: ' . getenv('SHOPIFY_API_KEY');
    return $headers;
}

/** True when this server can call the Fly app at all. */
function brix_internal_configured() {
    return brix_internal_secret() !== '' || (brix_accept_legacy_secret() && getenv('SHOPIFY_API_KEY'));
}
