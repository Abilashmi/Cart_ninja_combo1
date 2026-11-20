/* eslint-env node */
// Run with: node --import ./tests/packs/register.mjs --test tests/cod/otp-wallet.test.mjs
// The OTP wallet (50 paise per SMS sent by Digifyce) against the REAL
// php_backend/otp_wallet*.php files on a throwaway MariaDB. Digifyce itself is
// the harness's fake app server: it answers otp_send.php and
// razorpay_create_order.php, and the test plays Digifyce's signed confirmation.
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { harnessAvailable, startHarness } from './php-harness.mjs';

if (!harnessAvailable()) {
  console.log('SKIP otp-wallet tests: XAMPP PHP / MariaDB binaries not found (set XAMPP_DIR).');
  process.exit(0);
}

const CONFIRM_SECRET = 'confirm-secret-0123456789abcdef0123456789';
const API_KEY = 'digifyce-api-key-0123456789abcdef0123456789';
const harness = await startHarness({
  portOffset: 40,
  extraFiles: ['otp_wallet.php', 'otp_wallet_lib.php', 'otp_wallet_confirm.php'],
  extraEnv: ({ appUrl }) => ({ DIGIFYCE_API_URL: appUrl, DIGIFYCE_API_KEY: API_KEY, DIGIFYCE_CONFIRM_SECRET: CONFIRM_SECRET }),
});
process.env.PHP_BASE_URL = harness.baseUrl;
process.env.BRIX_INTERNAL_SECRET = harness.secret;
delete process.env.BRIX_ACCEPT_LEGACY_SECRET;
process.env.SHOPIFY_API_SECRET = 'test-secret';
process.env.DIGIFYCE_API_URL = harness.appUrl;
process.env.DIGIFYCE_API_KEY = API_KEY;
delete process.env.MSG91_AUTH_KEY;
delete process.env.COD_OTP_DEV_LOG;

const cod = await import('../../app/services/cod.server.js');
const { smsProviderStatus } = await import('../../app/services/cod-sms.server.js');

const SHOP = 'demo.myshopify.com';
const sql = (q, p = []) => harness.db.query(q, p).then(([rows]) => rows);
const reset = async () => {
  for (const t of ['cod_settings', 'cod_otp', 'cod_orders', 'cod_secrets', 'otp_wallet', 'otp_wallet_ledger', 'otp_recharges']) await sql(`DELETE FROM ${t}`).catch(() => {});
  harness.app.requests.length = 0;
  harness.app.reply = (entry) => {
    if (entry.path.startsWith('/otp_send.php')) return { status: 200, body: { ok: true, messageId: 'm1' } };
    if (entry.path.startsWith('/razorpay_create_order.php')) return { status: 200, body: { ok: true, order_id: 'order_TEST1', pay_url: 'https://digifyce.example/razorpay_pay.php?order_id=order_TEST1' } };
    return { status: 404, body: {} };
  };
};
beforeEach(reset);
after(() => harness.stop());

const wallet = (path, body) => fetch(`${harness.baseUrl}/${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Brix-Internal-Secret': harness.secret }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, json: await r.json() }));
const credit = (paise) => wallet('otp_wallet.php', { action: 'refund', shop: SHOP, amount_paise: paise, ref: `seed:${crypto.randomUUID()}` });
const balance = async () => (await wallet('otp_wallet.php', { action: 'balance', shop: SHOP })).json.balance_paise;
const ageOtp = () => sql('UPDATE cod_otp SET created_at = created_at - INTERVAL 60 SECOND');
const runtimeFlag = async () => JSON.parse((await sql('SELECT settings_json FROM cod_settings WHERE shop = ?', [SHOP]))[0].settings_json)._runtime?.otpAvailable;

// Digifyce's signed confirmation, as docs/digifyce/razorpay_helpers.php sends it.
const confirm = (payload, { secret = CONFIRM_SECRET, ts = String(Math.floor(Date.now() / 1000)) } = {}) => {
  const raw = JSON.stringify(payload);
  return fetch(`${harness.baseUrl}/otp_wallet_confirm.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Digifyce-Timestamp': ts, 'X-Digifyce-Signature': crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex') },
    body: raw,
  }).then(async (r) => ({ status: r.status, json: await r.json() }));
};

test('an empty wallet: no OTP step, no SMS, nothing charged', async () => {
  await cod.saveCodSettings(SHOP, { requireOtp: true });
  assert.equal(await cod.otpAvailableForShop(SHOP), false);
  await assert.rejects(() => cod.sendCodOtp(SHOP, '9876543210'), (e) => e.code === 'otp_not_needed');
  assert.equal(harness.app.requests.length, 0, 'Digifyce was not asked to send');
  assert.equal(await balance(), 0);
  assert.equal(await runtimeFlag(), false, 'the storefront flag says no OTP');
});

test('a funded wallet: OTP on; each SMS costs 50 paise; at 0 the OTP step switches off', async () => {
  await cod.saveCodSettings(SHOP, { requireOtp: true });
  await credit(100);
  await cod.getOtpWalletPaise(SHOP, { fresh: true });   // the page's 10-second cache
  assert.equal(await cod.otpAvailableForShop(SHOP), true);

  await cod.sendCodOtp(SHOP, '9876543210');
  const sent = harness.app.requests.find((r) => r.path.startsWith('/otp_send.php'));
  assert.equal(sent.headers.authorization, `Bearer ${API_KEY}`);
  assert.deepEqual([sent.body.shop, sent.body.mobile, /^\d{4}$/.test(sent.body.otp)], [SHOP, '9876543210', true]);
  assert.equal(await balance(), 50);

  await ageOtp();
  await cod.sendCodOtp(SHOP, '9876543210');
  assert.equal(await balance(), 0);
  assert.equal(await runtimeFlag(), false, 'switched off in the same transaction as the last debit');

  await ageOtp();
  await assert.rejects(() => cod.sendCodOtp(SHOP, '9876543210'), (e) => e.code === 'otp_not_needed');
  assert.equal(harness.app.requests.filter((r) => r.path.startsWith('/otp_send.php')).length, 2);
});

test('an SMS that fails to send is refunded', async () => {
  await credit(50);
  harness.app.reply = () => ({ status: 502, body: { ok: false, error: 'sms_failed' } });
  await assert.rejects(() => cod.sendCodOtp(SHOP, '9876543210'), (e) => e.code === 'otp_send_failed');
  assert.equal(await balance(), 50);
  const ledger = await sql("SELECT type, amount_paise FROM otp_wallet_ledger WHERE ref LIKE 'otp:%' OR ref LIKE 'refund:%' ORDER BY id");
  assert.deepEqual(ledger.map((l) => l.type), ['debit', 'refund']);
  assert.equal((await sql('SELECT COUNT(*) AS n FROM cod_otp'))[0].n, 0, 'the unsent code is not kept');
});

test('the same debit reference never charges twice', async () => {
  await credit(200);
  const a = await wallet('otp_wallet.php', { action: 'debit', shop: SHOP, amount_paise: 50, ref: 'otp:1' });
  const b = await wallet('otp_wallet.php', { action: 'debit', shop: SHOP, amount_paise: 50, ref: 'otp:1' });
  assert.deepEqual([a.json.duplicate, b.json.duplicate, b.json.balance_paise], [false, true, 150]);
  const over = await wallet('otp_wallet.php', { action: 'debit', shop: SHOP, amount_paise: 500, ref: 'otp:2' });
  assert.deepEqual([over.status, over.json.code], [402, 'wallet_empty']);
  assert.equal(await balance(), 150, 'a refused debit takes nothing');
});

test('recharge: any amount (₹100 to ₹50,000), Razorpay order from Digifyce, credited once on a signed confirmation', async () => {
  const bad = await wallet('otp_wallet.php', { action: 'recharge_create', shop: SHOP, amount_paise: 5000, return_url: 'https://demo.myshopify.com/admin' });
  assert.equal(bad.json.code, 'invalid_amount');
  const evil = await wallet('otp_wallet.php', { action: 'recharge_create', shop: SHOP, amount_paise: 12345, return_url: 'https://evil.example/' });
  assert.equal(evil.json.code, 'invalid_return_url');

  const made = await wallet('otp_wallet.php', { action: 'recharge_create', shop: SHOP, amount_paise: 12345, return_url: 'https://demo.myshopify.com/admin/apps/x/app/cod/customize' });
  assert.equal(made.status, 200);
  assert.match(made.json.pay_url, /^https:\/\/digifyce\.example\//);
  const asked = harness.app.requests.find((r) => r.path.startsWith('/razorpay_create_order.php'));
  assert.equal(asked.headers.authorization, `Bearer ${API_KEY}`);
  assert.deepEqual([asked.body.shop, asked.body.amount_paise, asked.body.recharge_id], [SHOP, 12345, made.json.recharge_id]);
  assert.equal(await balance(), 0, 'nothing is credited before payment');

  const paid = { recharge_id: made.json.recharge_id, shop: SHOP, amount_paise: 12345, payment_id: 'pay_ABC1', order_id: 'order_TEST1', status: 'paid' };
  const first = await confirm(paid);
  assert.deepEqual([first.status, first.json.balance_paise, first.json.duplicate], [200, 12345, false]);
  const again = await confirm(paid);       // the webhook and the return page both report it
  assert.deepEqual([again.status, again.json.balance_paise, again.json.duplicate], [200, 12345, true]);
  assert.equal(await balance(), 12345);
  assert.equal((await sql('SELECT status FROM otp_recharges'))[0].status, 'paid');
});

test('confirmation is refused: wrong signature, stale, wrong amount, unknown recharge, wrong order', async () => {
  const made = await wallet('otp_wallet.php', { action: 'recharge_create', shop: SHOP, amount_paise: 20000, return_url: 'https://demo.myshopify.com/admin' });
  const paid = { recharge_id: made.json.recharge_id, shop: SHOP, amount_paise: 20000, payment_id: 'pay_X', order_id: 'order_TEST1', status: 'paid' };
  assert.equal((await confirm(paid, { secret: 'x'.repeat(40) })).status, 401);
  assert.equal((await confirm(paid, { ts: String(Math.floor(Date.now() / 1000) - 3600) })).status, 401);
  assert.equal((await confirm({ ...paid, amount_paise: 99999 })).json.code, 'amount_mismatch');
  assert.equal((await confirm({ ...paid, recharge_id: 9999 })).json.code, 'unknown_recharge');
  assert.equal((await confirm({ ...paid, order_id: 'order_OTHER' })).json.code, 'order_mismatch');
  assert.equal((await confirm({ ...paid, shop: 'other.myshopify.com' })).json.code, 'unknown_recharge', 'another store cannot claim it');
  assert.equal(await balance(), 0);
  const noSecret = await fetch(`${harness.baseUrl}/otp_wallet.php`, { method: 'POST', body: '{}' });
  assert.equal(noSecret.status, 403, 'wallet endpoints need the internal secret');
});

test('a store with its own MSG91 keys never uses the wallet', async () => {
  assert.equal(smsProviderStatus({ authKey: 'a', templateId: 't' }, 0).source, 'store');
  assert.deepEqual(smsProviderStatus({}, 0), { configured: false, provider: 'digifyce', source: 'wallet' });
  assert.deepEqual(smsProviderStatus({}, 50), { configured: true, provider: 'digifyce', source: 'wallet' });
  assert.equal(smsProviderStatus({}, 49).configured, false);
});
