/* eslint-env node */
// COD duplicate-action and limit checks under concurrency, against the real
// php_backend cod_otp.php / cod_orders.php on the isolated environment (4 PHP
// workers, so requests really overlap). No SMS is sent and no order is created:
// these files only store hashes, and Shopify is never called.
//
//   node tests/performance/cod-concurrency.mjs
//
// Each check fires its requests at the same moment (burst) and compares the
// result with the rule the code documents. Writes reports/results/<stamp>-cod-concurrency.json.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { burst } from './lib/runner.mjs';
import { startEnvironment } from './lib/env.mjs';

const BURST = Number(process.env.PERF_BURST || 12);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const SHOP = 'perf-cod-0001.myshopify.com';

const env = await startEnvironment();
const results = { startedAt: new Date().toISOString(), burst: BURST, workers: env.baseUrls.length, checks: [] };
let rr = 0;
async function call(file, body) {
  const base = env.baseUrls[rr++ % env.baseUrls.length];
  const res = await fetch(`${base}/${file}`, { method: 'POST', headers: { 'X-Forge-Secret': env.secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ shop: SHOP, ...body }) });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, json };
}
const tally = (settled, key) => {
  const t = {};
  for (const s of settled) {
    const k = s.status === 'fulfilled' ? key(s.value) : `error:${s.reason?.message}`;
    t[k] = (t[k] || 0) + 1;
  }
  return t;
};
function record(name, rule, expected, observed, pass, detail) {
  results.checks.push({ name, rule, expected, observed, outcome: pass ? 'PASS' : 'FAIL', detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      rule: ${rule}\n      expected: ${expected}\n      observed: ${observed}`);
}

try {
  await call('cod_otp.php', { action: 'delete', id: 0 }); // creates the COD tables

  // 1. OTP send limit: one code per phone per 30 s (cod_otp.php create).
  {
    const phone = sha('phone-1');
    const settled = await burst(BURST, (i) => call('cod_otp.php', { action: 'create', phone_hash: phone, code_hash: sha(`code-${i}`) }));
    const ok = settled.filter((s) => s.status === 'fulfilled' && s.value.status === 200).length;
    const [[{ n }]] = await env.db.query('SELECT COUNT(*) AS n FROM cod_otp WHERE shop = ? AND phone_hash = ?', [SHOP, phone]);
    record('OTP create burst, same phone', 'one code per phone per 30 s, max 5 per hour (each accepted create = one SMS sent by Node)',
      '1 accepted, the rest 429 otp_too_soon; 1 row', `${ok} accepted, rows stored = ${n}; responses ${JSON.stringify(tally(settled, (v) => `${v.status}:${v.json?.code || 'ok'}`))}`,
      ok === 1 && Number(n) === 1);
  }

  // 2. OTP wrong-guess limit: 5 tries per code (cod_otp.php verify).
  {
    const phone = sha('phone-2');
    await env.db.query('INSERT INTO cod_otp (shop, phone_hash, code_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))', [SHOP, phone, sha('right-code')]);
    const settled = await burst(BURST * 2, (i) => call('cod_otp.php', { action: 'verify', phone_hash: phone, code_hash: sha(`wrong-${i}`) }));
    const [[row]] = await env.db.query('SELECT attempts FROM cod_otp WHERE shop = ? AND phone_hash = ?', [SHOP, phone]);
    // A guess was compared with the code whenever attempts was incremented.
    record('OTP verify burst, wrong codes', 'at most 5 wrong tries per code, then locked',
      'attempts column ≤ 5 (later guesses answered "locked" without being compared)', `attempts column = ${row.attempts} after ${BURST * 2} concurrent wrong guesses; responses ${JSON.stringify(tally(settled, (v) => v.json?.result || v.status))}`,
      Number(row.attempts) <= 5);
  }

  // 3. OTP correct code verified at once from several requests: only one may claim it.
  {
    const phone = sha('phone-3');
    await env.db.query('INSERT INTO cod_otp (shop, phone_hash, code_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))', [SHOP, phone, sha('right-code')]);
    const settled = await burst(BURST, () => call('cod_otp.php', { action: 'verify', phone_hash: phone, code_hash: sha('right-code') }));
    const oks = settled.filter((s) => s.status === 'fulfilled' && s.value.json?.result === 'ok').length;
    record('OTP verify burst, right code', 'a code can be verified once', '1 "ok", the rest "expired"', `${oks} "ok"; responses ${JSON.stringify(tally(settled, (v) => v.json?.result || v.status))}`, oks === 1);
  }

  // 4. Double tap on Place order: same idempotency key (cod_orders.php begin).
  {
    const idem = 'perfidem-double-tap-0001';
    const settled = await burst(BURST, () => call('cod_orders.php', { action: 'begin', idem_key: idem, source: 'drawer', phone_hash: sha('phone-4'), phone_masked: '+91 ******1234', phone_verified: 1, total: 999, currency: 'INR' }));
    const ok = settled.filter((s) => s.status === 'fulfilled' && s.value.status === 200).length;
    const [[{ n }]] = await env.db.query('SELECT COUNT(*) AS n FROM cod_orders WHERE shop = ? AND idem_key = ?', [SHOP, idem]);
    record('Order begin burst, same idempotency key', 'one order attempt per (shop, idem_key) — a double tap can never create two orders',
      '1 accepted, the rest 409 duplicate; 1 row', `${ok} accepted, rows = ${n}; responses ${JSON.stringify(tally(settled, (v) => `${v.status}:${v.json?.code || 'ok'}`))}`, ok === 1 && Number(n) === 1);
  }

  // 5. Daily order limit per phone, several sheets at once (different idempotency keys),
  //    replaying placeCodOrder's storage calls in app/services/cod.server.js:
  //    find → count_recent (placed only) → begin → [Shopify draftOrderCreate + complete, simulated 1.5 s] → complete.
  {
    const DAILY_LIMIT = 1;
    const phone = sha('phone-5');
    const shopifyMs = 1500;
    const settled = await burst(5, async (i) => {
      const idem = `perfidem-daily-${i}-${Date.now()}`;
      await call('cod_orders.php', { action: 'find', idem_key: idem });
      const { json: c } = await call('cod_orders.php', { action: 'count_recent', phone_hash: phone });
      if (c.count >= DAILY_LIMIT) return 'daily_limit';
      const b = await call('cod_orders.php', { action: 'begin', idem_key: idem, source: 'product', phone_hash: phone, phone_masked: '+91 ******5555', phone_verified: 1, total: 499, currency: 'INR' });
      if (b.status !== 200) return `begin_${b.status}`;
      await new Promise((r) => setTimeout(r, shopifyMs));
      const done = await call('cod_orders.php', { action: 'complete', idem_key: idem, draft_order_id: `gid://shopify/DraftOrder/${i}`, order_id: `gid://shopify/Order/${i}`, order_name: `#P${i}`, total: 499, currency: 'INR' });
      return done.status === 200 ? 'placed' : `complete_${done.status}`;
    });
    const [[{ n }]] = await env.db.query("SELECT COUNT(*) AS n FROM cod_orders WHERE shop = ? AND phone_hash = ? AND status = 'placed'", [SHOP, phone]);
    const observed = tally(settled, (v) => v);
    record('Daily COD limit, 5 sheets at once for one phone (limit 1)', 'settings.dailyLimitPerPhone placed orders per phone per 24 h',
      `${DAILY_LIMIT} placed, the rest "daily_limit"`, `${n} placed; outcomes ${JSON.stringify(observed)} (simulated Node sequence; Node's own per-phone limiter allows 5 per 10 min per process)`, Number(n) <= DAILY_LIMIT);
  }
} finally {
  await env.stop();
}

const outDir = path.resolve('reports/results');
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `${results.startedAt.slice(0, 19).replace(/:/g, '')}-cod-concurrency.json`);
fs.writeFileSync(file, JSON.stringify(results, null, 2));
console.log(`saved ${path.relative(process.cwd(), file)}`);
