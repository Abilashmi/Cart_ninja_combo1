/* eslint-env node */
// Run with: node --test tests/webhooks/internal-auth.test.mjs
// Server-to-server auth (app/utils/internal-auth.js + php_backend/internal_auth.php):
// the public client id (SHOPIFY_API_KEY) is no longer a password; only
// BRIX_INTERNAL_SECRET is, plus the old header while BRIX_ACCEPT_LEGACY_SECRET=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SECRET = 'internal-secret-for-tests-0123456789';
const CLIENT_ID = 'public-client-id-123';
const { internalAuthHeaders, isInternalRequest } = await import('../../app/utils/internal-auth.js');
const req = (headers) => new Request('https://app.test/api/cod/otp', { headers });

function withEnv(env, fn) {
  const keys = ['BRIX_INTERNAL_SECRET', 'BRIX_ACCEPT_LEGACY_SECRET', 'SHOPIFY_API_KEY'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { return fn(); } finally { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}

test('Node: sends and accepts only the internal secret', () => {
  withEnv({ BRIX_INTERNAL_SECRET: SECRET, SHOPIFY_API_KEY: CLIENT_ID }, () => {
    assert.deepEqual(internalAuthHeaders(), { 'X-Brix-Internal-Secret': SECRET });
    assert.equal(isInternalRequest(req({ 'x-brix-internal-secret': SECRET })), true);
    assert.equal(isInternalRequest(req({ 'x-forge-secret': CLIENT_ID })), false, 'the public client id is refused');
    assert.equal(isInternalRequest(req({ 'x-brix-internal-secret': SECRET.slice(0, -1) + 'x' })), false);
    assert.equal(isInternalRequest(req({})), false);
  });
});

test('Node: during the switch both headers go out and both are accepted', () => {
  withEnv({ BRIX_INTERNAL_SECRET: SECRET, SHOPIFY_API_KEY: CLIENT_ID, BRIX_ACCEPT_LEGACY_SECRET: '1' }, () => {
    assert.deepEqual(internalAuthHeaders(), { 'X-Brix-Internal-Secret': SECRET, 'X-Forge-Secret': CLIENT_ID });
    assert.equal(isInternalRequest(req({ 'x-forge-secret': CLIENT_ID })), true);
  });
});

test('Node: fails closed without a long enough secret', () => {
  withEnv({ BRIX_INTERNAL_SECRET: 'short', SHOPIFY_API_KEY: CLIENT_ID }, () => {
    assert.deepEqual(internalAuthHeaders(), {});
    assert.equal(isInternalRequest(req({ 'x-brix-internal-secret': 'short' })), false);
    assert.equal(isInternalRequest(req({ 'x-forge-secret': CLIENT_ID })), false);
  });
});

const PHP = process.env.PHP_BIN || 'php';
const phpOk = spawnSync(PHP, ['-v']).status === 0;

// The real internal_auth.php, as PHP sees a request.
function phpCheck(env, headers) {
  const server = Object.entries(headers).map(([k, v]) => `$_SERVER['HTTP_${k.toUpperCase().replace(/-/g, '_')}'] = ${JSON.stringify(v)};`).join(' ');
  const code = `${server} require ${JSON.stringify(path.join(ROOT, 'php_backend/internal_auth.php'))}; echo json_encode([brix_internal_request_ok(), brix_internal_headers(), (bool) brix_internal_configured()]);`;
  const out = spawnSync(PHP, ['-r', code], { env: { PATH: process.env.PATH, ...env } });
  return JSON.parse(String(out.stdout));
}

test('PHP: same rules as Node', { skip: !phpOk && 'php not installed' }, () => {
  const env = { BRIX_INTERNAL_SECRET: SECRET, SHOPIFY_API_KEY: CLIENT_ID };
  assert.deepEqual(phpCheck(env, { 'X-Brix-Internal-Secret': SECRET }), [true, [`X-Brix-Internal-Secret: ${SECRET}`], true]);
  assert.equal(phpCheck(env, { 'X-Forge-Secret': CLIENT_ID })[0], false, 'the public client id is refused');
  assert.equal(phpCheck(env, {})[0], false);
  const legacy = phpCheck({ ...env, BRIX_ACCEPT_LEGACY_SECRET: '1' }, { 'X-Forge-Secret': CLIENT_ID });
  assert.deepEqual(legacy, [true, [`X-Brix-Internal-Secret: ${SECRET}`, `X-Forge-Secret: ${CLIENT_ID}`], true]);
  assert.deepEqual(phpCheck({ SHOPIFY_API_KEY: CLIENT_ID }, { 'X-Forge-Secret': CLIENT_ID }), [false, [], false], 'no secret set = everything refused');
});
