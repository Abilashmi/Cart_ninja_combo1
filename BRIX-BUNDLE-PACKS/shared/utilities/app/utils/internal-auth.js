/* global process */
// Server-to-server auth between this app and the PHP backend (int.thebrix.io).
// See php_backend/internal_auth.php for the other side.
//
// BRIX_INTERNAL_SECRET (Fly secret, the same long random value on the PHP
// server) is sent as X-Brix-Internal-Secret. It replaces SHOPIFY_API_KEY in
// X-Forge-Secret: that is the app's public client id (it is in every
// merchant's admin page), so anyone could call the PHP endpoints with it,
// db_proxy.php included. While BRIX_ACCEPT_LEGACY_SECRET=1 is set (on Fly and
// on the PHP server) the old header is still sent and accepted, so the two
// sides can be deployed in any order; remove it on both once both are live.
//
// Server-only: call these from loaders, actions and .server modules.
function internalSecret() {
  const secret = process.env.BRIX_INTERNAL_SECRET || '';
  return secret.length >= 32 ? secret : '';
}

function acceptLegacy() {
  return process.env.BRIX_ACCEPT_LEGACY_SECRET === '1';
}

/** Headers to send with every call to the PHP backend. */
export function internalAuthHeaders() {
  const headers = {};
  const secret = internalSecret();
  if (secret) headers['X-Brix-Internal-Secret'] = secret;
  if (acceptLegacy() && process.env.SHOPIFY_API_KEY) headers['X-Forge-Secret'] = process.env.SHOPIFY_API_KEY;
  return headers;
}

// Constant-time compare (no node:crypto import, so route files can import this).
function same(a, b) {
  const x = String(a);
  const y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/** True when a request came from the PHP backend (e.g. the COD relay). */
export function isInternalRequest(request) {
  const secret = internalSecret();
  const sent = request.headers.get('x-brix-internal-secret');
  if (secret && sent && same(secret, sent)) return true;
  if (acceptLegacy()) {
    const legacy = process.env.SHOPIFY_API_KEY;
    const old = request.headers.get('x-forge-secret');
    if (legacy && old && same(legacy, old)) return true;
  }
  return false;
}
