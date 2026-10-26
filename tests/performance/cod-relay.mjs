/* eslint-env node */
// COD relay load test: storefront → php_backend/cod_checkout.php → BRIX app (Fly).
// The app is the environment's fake server with a fixed delay standing in for
// Fly + Shopify (draftOrderCalculate / draftOrderCreate): nothing reaches Fly,
// Shopify or MSG91. Shows how many COD requests the PHP side can relay at once,
// since each one holds a PHP worker until the app answers (curl, 45 s timeout).
//
//   node tests/performance/cod-relay.mjs
// Env: PERF_UPSTREAM_MS (800) = simulated app latency, PERF_PHP_WORKERS (4),
//      PERF_RELAY_STEPS ("2,4,8,16") = VUs per step, 30 s each, think 1-2 s.
// Writes reports/results/<stamp>-cod-relay.json.
import fs from 'node:fs';
import path from 'node:path';
import { runLoad } from './lib/runner.mjs';
import { startEnvironment } from './lib/env.mjs';

const UPSTREAM_MS = Number(process.env.PERF_UPSTREAM_MS || 800);
const STEPS = (process.env.PERF_RELAY_STEPS || '2,4,8,16').split(',').map(Number);
const SHOP = 'perf-cod-0001.myshopify.com';

const env = await startEnvironment();
env.app.delayMs = UPSTREAM_MS;
env.app.reply = (entry) => ({ status: 200, body: { success: true, quote: { subtotal: 999, codFee: 49, total: 1048 }, path: entry.path } });
const out = { startedAt: new Date().toISOString(), upstreamMs: UPSTREAM_MS, workers: env.baseUrls.length, steps: [] };
try {
  const scenario = {
    name: 'cod_quote_relay',
    request: () => ({ path: '/cod_checkout.php', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { endpoint: 'quote', shop: SHOP, surface: 'drawer', items: [{ variantId: 1, quantity: 1 }] } }),
    check: (res, text) => (res.status === 200 && text.includes('"success":true') ? true : `http_${res.status}`),
  };
  for (const vus of STEPS) {
    env.app.maxInFlight = 0;
    const s = await runLoad({ name: `cod-relay-${vus}vu`, stages: [{ duration: 5, target: vus }, { duration: 25, target: vus }], thinkMs: [1000, 2000], timeoutMs: 60000, baseUrls: env.baseUrls, scenarios: [scenario] });
    s.appMaxInFlight = env.app.maxInFlight;
    // Without queueing, one request ≈ the upstream delay; anything above it is waiting for a free PHP worker.
    s.queueingMsP50 = Math.max(0, Math.round(s.overall.p50Ms - UPSTREAM_MS));
    out.steps.push(s);
    const o = s.overall;
    console.log(`${vus} VUs: ${o.requests} req, ${o.rps} req/s, p50 ${o.p50Ms} ms, p95 ${o.p95Ms} ms, max ${o.maxMs} ms, failed ${o.failRate}%, app requests in flight at most ${s.appMaxInFlight}`);
  }

  // Head-of-line blocking: PHP workers are shared by every endpoint, so while COD
  // relays wait on the app, an unrelated cheap request (a PHP-only probe, no DB) waits too.
  const probe = async (ms) => {
    const lat = [];
    const end = Date.now() + ms;
    let k = 0;
    while (Date.now() < end) {
      const t = performance.now();
      await (await fetch(`${env.baseUrls[k++ % env.baseUrls.length]}/__perf_probe.php`)).text();
      lat.push(performance.now() - t);
      await new Promise((r) => setTimeout(r, 250));
    }
    lat.sort((a, b) => a - b);
    return { samples: lat.length, p50Ms: Math.round(lat[Math.floor(lat.length / 2)]), p95Ms: Math.round(lat[Math.min(lat.length - 1, Math.ceil(lat.length * 0.95) - 1)]), maxMs: Math.round(lat[lat.length - 1]) };
  };
  const idle = await probe(10000);
  const busyVus = STEPS[STEPS.length - 1];
  const [busy] = await Promise.all([
    new Promise((r) => setTimeout(r, 5000)).then(() => probe(20000)),
    runLoad({ name: 'cod-relay-hol', stages: [{ duration: 3, target: busyVus }, { duration: 25, target: busyVus }], thinkMs: [1000, 2000], timeoutMs: 60000, baseUrls: env.baseUrls, scenarios: [scenario] }),
  ]);
  out.headOfLine = { probe: '__perf_probe.php (no database)', idle, duringCodLoad: { codVus: busyVus, ...busy } };
  console.log('unrelated request, idle →', idle, `| while ${busyVus} VUs use COD →`, busy);

  // Fly down: the relay should answer a clean 503 quickly, not hang.
  env.app.delayMs = 0;
  env.app.reply = () => ({ status: 502, body: '<html>Bad gateway</html>' });
  const t0 = performance.now();
  const res = await fetch(`${env.baseUrls[0]}/cod_checkout.php`, { method: 'POST', body: JSON.stringify({ endpoint: 'quote', shop: SHOP }) });
  const body = await res.json();
  out.appDown = { status: res.status, code: body.code, ms: Math.round(performance.now() - t0) };
  console.log('app down →', out.appDown);
} finally {
  await env.stop();
}
const outDir = path.resolve('reports/results');
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `${out.startedAt.slice(0, 19).replace(/:/g, '')}-cod-relay.json`);
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`saved ${path.relative(process.cwd(), file)}`);
