/* eslint-env node */
// Run with: node --import ./tests/packs/register.mjs --test tests/cod/otp-wallet.test.mjs
// The OTP wallet (50 paise per SMS, sent by the BRIX PHP server with BRIX's MSG91
// account) against the REAL php_backend/otp_wallet*.php + otp_sms_lib.php files on a
// throwaway MariaDB. The harness's fake app server stands in for MSG91 (/api/v5/flow)
// and for Digifyce's razorpay_create_order.php; the test plays Digifyce's signed
// confirmation.
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
const MSG91_KEY = 'brix-msg91-key-0123456789';
const harness = await startHarness({
  portOffset: 40,
  extraFiles: ['otp_wallet.php', 'otp_wallet_lib.php', 'otp_wallet_confirm.php', 'otp_sms_lib.php'],
  extraEnv: ({ appUrl }) => ({
    DIGIFYCE_API_URL: appUrl, DIGIFYCE_API_KEY: API_KEY, DIGIFYCE_CONFIRM_SECRET: CONFIRM_SECRET,
    BRIX_MSG91_AUTH_KEY: MSG91_KEY, BRIX_MSG91_TEMPLATE_ID: 'tmplBRIX01', BRIX_MSG91_BASE: appUrl, // no BRIX_MSG91_API = Flow
  }),
});
process.env.PHP_BASE_URL = harness.baseUrl;
process.env.BRIX_INTERNAL_SECRET = harness.secret;
delete process.env.BRIX_ACCEPT_LEGACY_SECRET;
process.env.SHOPIFY_API_SECRET = 'test-secret';
// Node itself never talks to Digifyce or BRIX's MSG91: the PHP server sends.
delete process.env.DIGIFYCE_API_URL;
delete process.env.DIGIFYCE_API_KEY;
// Rollout switch: only this test store uses the wallet (OTHER below never does).
process.env.OTP_WALLET_SHOPS = 'demo.myshopify.com';
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
    if (entry.path.startsWith('/api/v5/flow')) return { status: 200, body: { type: 'success', message: 'r1' } };
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
  assert.equal(harness.app.requests.length, 0, 'MSG91 was not asked to send');
  assert.equal(await balance(), 0);
  assert.equal(await runtimeFlag(), false, 'the storefront flag says no OTP');
});

test('a funded wallet: OTP on; each SMS costs 50 paise; at 0 the OTP step switches off', async () => {
  await cod.saveCodSettings(SHOP, { requireOtp: true });
  await credit(100);
  await cod.getOtpWalletPaise(SHOP, { fresh: true });   // the page's 10-second cache
  assert.equal(await cod.otpAvailableForShop(SHOP), true);

  await cod.sendCodOtp(SHOP, '9876543210');
  const sent = harness.app.requests.find((r) => r.path.startsWith('/api/v5/flow'));
  assert.equal(sent.headers.authkey, MSG91_KEY, "BRIX's MSG91 key, from the PHP server's environment");
  // MSG91's Flow request for an SMS template with the variable OTP (BRIX's own template).
  assert.equal(sent.body.template_id, 'tmplBRIX01');
  assert.equal(sent.body.short_url, '0');
  assert.equal(sent.body.recipients.length, 1);
  assert.equal(sent.body.recipients[0].mobiles, '919876543210');
  assert.match(sent.body.recipients[0].OTP, /^\d{4}$/);
  assert.equal(await balance(), 50);

  await ageOtp();
  await cod.sendCodOtp(SHOP, '9876543210');
  assert.equal(await balance(), 0);
  assert.equal(await runtimeFlag(), false, 'switched off in the same transaction as the last debit');

  await ageOtp();
  await assert.rejects(() => cod.sendCodOtp(SHOP, '9876543210'), (e) => e.code === 'otp_not_needed');
  assert.equal(harness.app.requests.filter((r) => r.path.startsWith('/api/v5/flow')).length, 2);
});

test('an SMS that fails to send is refunded', async () => {
  await credit(50);
  harness.app.reply = () => ({ status: 200, body: { type: 'error', message: 'Template not approved' } });
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

test('recharge: any amount from ₹1 (no upper limit), Razorpay order from Digifyce, credited once on a signed confirmation', async () => {
  const bad = await wallet('otp_wallet.php', { action: 'recharge_create', shop: SHOP, amount_paise: 50, return_url: 'https://demo.myshopify.com/admin' });
  assert.equal(bad.json.code, 'invalid_amount', 'under ₹1');
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
  // No upper limit: a big recharge opens its payment page too.
  const big = await wallet('otp_wallet.php', { action: 'recharge_create', shop: SHOP, amount_paise: 25000000, return_url: 'https://demo.myshopify.com/admin/apps/x/app/cod/customize' });
  assert.equal(big.status, 200, 'no upper limit: ₹2,50,000 is fine');
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
  assert.equal(smsProviderStatus({ authKey: 'a', templateId: 't' }, 0, SHOP).source, 'store');
  assert.deepEqual(smsProviderStatus({}, 0, SHOP), { configured: false, provider: 'brix', source: 'wallet' });
  assert.deepEqual(smsProviderStatus({}, 50, SHOP), { configured: true, provider: 'brix', source: 'wallet' });
  assert.equal(smsProviderStatus({}, 49, SHOP).configured, false);
});

test('activity page: newest first, pages by id, filter by kind, exact times', async () => {
  // 1 recharge, then 30 codes sent, every 5th one refunded.
  await wallet('otp_wallet.php', { action: 'refund', shop: SHOP, amount_paise: 10000, ref: 'seed:recharge' });
  for (let i = 1; i <= 30; i += 1) {
    await wallet('otp_wallet.php', { action: 'debit', shop: SHOP, amount_paise: 50, ref: `otp:${i}` });
    if (i % 5 === 0) await wallet('otp_wallet.php', { action: 'refund', shop: SHOP, amount_paise: 50, ref: `refund:otp:${i}` });
  }
  const first = await cod.getOtpWalletLedger(SHOP, { limit: 25 });
  assert.equal(first.entries.length, 25);
  assert.equal(first.hasMore, true);
  assert.equal(first.balancePaise, 10000 - 30 * 50 + 6 * 50);
  assert.equal(first.entries[0].type, 'refund'); // refund of code 30 is the newest
  assert.ok(first.entries.every((e, i, all) => i === 0 || e.id < all[i - 1].id), 'newest first');
  assert.ok(Math.abs(first.entries[0].atMs - Date.now()) < 120000, 'atMs is the real moment');

  const second = await cod.getOtpWalletLedger(SHOP, { limit: 25, beforeId: first.nextBefore });
  assert.equal(second.entries.length, 37 - 25);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextBefore, null);
  assert.equal(second.entries.at(-1).type, 'refund'); // the seed recharge (made with refund here), oldest
  assert.equal(new Set([...first.entries, ...second.entries].map((e) => e.id)).size, 37, 'no entry twice');

  const refunds = await cod.getOtpWalletLedger(SHOP, { type: 'refund', limit: 25 });
  assert.equal(refunds.entries.length, 7);
  assert.ok(refunds.entries.every((e) => e.type === 'refund'));
  const sent = await cod.getOtpWalletLedger(SHOP, { type: 'debit', limit: 20 });
  assert.equal(sent.entries.length, 20);
  assert.equal(sent.hasMore, true);
  const sentRest = await cod.getOtpWalletLedger(SHOP, { type: 'debit', limit: 20, beforeId: sent.nextBefore });
  assert.equal(sentRest.entries.length, 10);
  assert.ok(sentRest.entries.every((e) => e.type === 'debit'));
  // An unknown kind = everything.
  assert.equal((await cod.getOtpWalletLedger(SHOP, { type: 'x', limit: 100 })).entries.length, 37);
});

test('rollout: only stores in OTP_WALLET_SHOPS use the wallet; every other store is as before', async () => {
  const OTHER = 'other-store.myshopify.com';
  const { otpWalletShopAllowed } = await import('../../app/services/cod-sms.server.js');
  assert.equal(otpWalletShopAllowed(SHOP), true);
  assert.equal(otpWalletShopAllowed('DEMO.myshopify.com'), true, 'any case');
  assert.equal(otpWalletShopAllowed(OTHER), false);
  assert.equal(smsProviderStatus({}, 5000, OTHER).source, null, 'no wallet, no server MSG91 here = no provider, as before');
  // The other store: no OTP step, no SMS, no money moved, even with credit in its wallet.
  await wallet('otp_wallet.php', { action: 'grant', shop: OTHER, amount_paise: 1000, ref: 'grant:test' });
  await cod.saveCodSettings(OTHER, { requireOtp: true });
  assert.equal(await cod.otpAvailableForShop(OTHER), false);
  await assert.rejects(cod.sendCodOtp(OTHER, '9876543210'), (e) => e.code === 'otp_send_failed');
  assert.equal(harness.app.requests.filter((r) => r.path.startsWith('/api/v5/')).length, 0, 'no SMS from BRIX for it');
  assert.equal((await wallet('otp_wallet.php', { action: 'balance', shop: OTHER })).json.balance_paise, 1000, 'nothing charged');
  // '*' = every store.
  process.env.OTP_WALLET_SHOPS = '*';
  try {
    assert.equal(otpWalletShopAllowed(OTHER), true);
  } finally {
    process.env.OTP_WALLET_SHOPS = SHOP;
  }
  delete process.env.OTP_WALLET_SHOPS;
  try {
    assert.equal(otpWalletShopAllowed(SHOP), false, 'unset = no store');
  } finally {
    process.env.OTP_WALLET_SHOPS = SHOP;
  }
});

test('grant: free codes from BRIX, once per reference, turns the OTP step on', async () => {
  await cod.saveCodSettings(SHOP, { requireOtp: true });
  assert.equal(await runtimeFlag(), false, 'empty wallet = no OTP step');
  const first = await wallet('otp_wallet.php', { action: 'grant', shop: SHOP, amount_paise: 20 * 50, ref: 'grant:20-codes' });
  assert.equal(first.status, 200);
  assert.equal(first.json.balance_paise, 1000);
  assert.equal(await runtimeFlag(), true, 'PHP switches the OTP step on with the credit');
  const again = await wallet('otp_wallet.php', { action: 'grant', shop: SHOP, amount_paise: 20 * 50, ref: 'grant:20-codes' });
  assert.equal(again.json.duplicate, true);
  assert.equal(await balance(), 1000, 'same ref never credits twice');
  assert.equal((await wallet('otp_wallet.php', { action: 'grant', shop: SHOP, amount_paise: 100001, ref: 'grant:big' })).status, 400, 'max Rs 1,000');
  assert.equal((await wallet('otp_wallet.php', { action: 'grant', shop: SHOP, amount_paise: 100, ref: 'otp:1' })).status, 400, 'refs start with grant:');
  const [entry] = (await cod.getOtpWalletLedger(SHOP, { type: 'credit' })).entries;
  assert.equal(entry.note, 'Free credit from BRIX');
  assert.equal(await cod.otpAvailableForShop(SHOP), true);
});

test('send: the PHP server charges, sends and refunds in one call; a retried call never sends twice', async () => {
  await credit(100);
  const body = { action: 'send', shop: SHOP, mobile: '9876543210', otp: '4321', ref: 'otp:77' };
  const first = await wallet('otp_wallet.php', body);
  assert.deepEqual([first.status, first.json.sent, first.json.balance_paise], [200, true, 50]);
  const again = await wallet('otp_wallet.php', body);
  assert.deepEqual([again.json.sent, again.json.duplicate, again.json.balance_paise], [true, true, 50], 'charged once');
  assert.equal(harness.app.requests.filter((r) => r.path.startsWith('/api/v5/flow')).length, 1, 'sent once');
  // The price is the server's: an amount sent by the caller is ignored.
  const cheap = await wallet('otp_wallet.php', { ...body, ref: 'otp:78', amount_paise: 1 });
  assert.equal(cheap.json.balance_paise, 0);
  // Bad input is refused before any money moves.
  assert.equal((await wallet('otp_wallet.php', { ...body, ref: 'x:1' })).status, 400);
  assert.equal((await wallet('otp_wallet.php', { ...body, ref: 'otp:79', mobile: '12345' })).status, 400);
  // Empty: 402, nothing sent.
  const empty = await wallet('otp_wallet.php', { ...body, ref: 'otp:80' });
  assert.deepEqual([empty.status, empty.json.code], [402, 'wallet_empty']);
  assert.equal(harness.app.requests.filter((r) => r.path.startsWith('/api/v5/flow')).length, 2);
  // A refused send that is retried stays refunded and unsent.
  await credit(50);
  harness.app.reply = () => ({ status: 200, body: { type: 'error', message: 'DLT' } });
  const refused = await wallet('otp_wallet.php', { ...body, ref: 'otp:81' });
  assert.deepEqual([refused.json.sent, refused.json.balance_paise], [false, 50]);
  const retried = await wallet('otp_wallet.php', { ...body, ref: 'otp:81' });
  assert.deepEqual([retried.json.sent, retried.json.duplicate, retried.json.balance_paise], [false, true, 50]);
});

test('Recharge: only the stores in OTP_WALLET_RECHARGE (a list, * or 1 = every wallet store)', async () => {
  const { otpWalletRechargeOn } = await import('../../app/services/cod-sms.server.js');
  const before = process.env.OTP_WALLET_RECHARGE;
  try {
    delete process.env.OTP_WALLET_RECHARGE;
    assert.equal(otpWalletRechargeOn(SHOP), false, 'unset = no store');
    process.env.OTP_WALLET_RECHARGE = 'demo.myshopify.com';
    assert.equal(otpWalletRechargeOn(SHOP), true);
    assert.equal(otpWalletRechargeOn('other-store.myshopify.com'), false);
    for (const all of ['*', '1']) {
      process.env.OTP_WALLET_RECHARGE = all;
      assert.equal(otpWalletRechargeOn('other-store.myshopify.com'), true, all);
    }
  } finally {
    if (before === undefined) delete process.env.OTP_WALLET_RECHARGE; else process.env.OTP_WALLET_RECHARGE = before;
  }
});

test('Recharge when the payment server is not set up: the real reason, never a silent or generic failure', async () => {
  // Digifyce answers as it does before its .htaccess is filled in.
  harness.app.reply = (entry) => (entry.path.startsWith('/razorpay_create_order.php')
    ? { status: 503, body: { ok: false, error: 'not_configured' } }
    : { status: 404, body: {} });
  await assert.rejects(cod.startOtpRecharge(SHOP, 50000), (e) => e.code === 'payment_unavailable');
  // A refused amount comes back with int's own message.
  await assert.rejects(cod.startOtpRecharge(SHOP, 50), (e) => e.code === 'invalid_amount' && /Rs 1/.test(e.message));
  assert.equal(await balance(), 0, 'nothing credited');
});
