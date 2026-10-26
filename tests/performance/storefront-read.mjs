/* eslint-env node */
// Storefront read load test: the PHP endpoints every shopper's page view hits
// (through the Shopify App Proxy / int.thebrix.io), on the isolated environment.
//
//   node tests/performance/storefront-read.mjs [profile]
//
// Profiles: smoke (2 VUs, 30 s) | baseline (10 VUs, 60 s) | load25 | load50 | load100
//           stress (150→200 VUs, needs PERF_ALLOW_STRESS=1) | soak (25 VUs, 30 min, needs PERF_ALLOW_SOAK=1)
//
// Page-view mix per VU iteration (weights): cart drawer config 35 (10% of shops have
// two uploaded banner images, reported separately as config_banner), drawer coupons 35
// (the drawer fetches both on every page load), FBT widget 15, COD config 10, Packs 5.
//
// Env: PERF_SHOPS (2000), PERF_PHP_WORKERS (4), PERF_OPCACHE (1), PERF_THINK_MS ("1000-3000"),
//      PERF_P95_MS (500), PERF_MAX_FAIL_PCT (1) = acceptance criteria for this environment,
//      PERF_TARGET_URLS = comma-separated base URLs of an already running staging backend
//      (skips the local environment; needs PERF_TARGET_SHOPS = comma-separated test shops).
//      PERF_VARIANT=no-schema-checks = local experiment, see CONFIG_FILE below.
// Writes reports/results/<date>T<time>-storefront-<profile>[-<variant>].json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runLoad } from './lib/runner.mjs';
import { startEnvironment, processStats, dbStatus, diffStatus, slowLogOffset, slowLogSummary } from './lib/env.mjs';
import { seed, seedCod, warmUp, shopName } from './lib/seed.mjs';

const PROFILES = {
  smoke: [{ duration: 5, target: 2 }, { duration: 25, target: 2 }],
  baseline: [{ duration: 10, target: 10 }, { duration: 50, target: 10 }],
  load25: [{ duration: 15, target: 25 }, { duration: 45, target: 25 }],
  load50: [{ duration: 15, target: 50 }, { duration: 45, target: 50 }],
  load100: [{ duration: 20, target: 100 }, { duration: 60, target: 100 }],
  stress: [{ duration: 20, target: 150 }, { duration: 40, target: 150 }, { duration: 20, target: 200 }, { duration: 40, target: 200 }],
  soak: [{ duration: 30, target: 25 }, { duration: 1800, target: 25 }],
};

const profile = process.argv[2] || 'smoke';
if (!PROFILES[profile]) { console.error(`Unknown profile ${profile}. Use one of: ${Object.keys(PROFILES).join(', ')}`); process.exit(2); }
if (profile === 'stress' && process.env.PERF_ALLOW_STRESS !== '1') { console.error('stress needs PERF_ALLOW_STRESS=1 (explicit approval + monitoring)'); process.exit(2); }
if (profile === 'soak' && process.env.PERF_ALLOW_SOAK !== '1') { console.error('soak needs PERF_ALLOW_SOAK=1 (explicit approval)'); process.exit(2); }

const SHOPS = Number(process.env.PERF_SHOPS || 2000);
const [thinkMin, thinkMax] = (process.env.PERF_THINK_MS || '1000-3000').split('-').map(Number);
const CRITERIA = { p95Ms: Number(process.env.PERF_P95_MS || 500), maxFailPct: Number(process.env.PERF_MAX_FAIL_PCT || 1) };

const external = (process.env.PERF_TARGET_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
const externalShops = (process.env.PERF_TARGET_SHOPS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (external.length && !externalShops.length) { console.error('PERF_TARGET_URLS needs PERF_TARGET_SHOPS (test shops only)'); process.exit(2); }

// PERF_VARIANT=no-schema-checks: the drawer config is read from the experiment copy
// without per-request SHOW COLUMNS (lib/env.mjs writeNoSchemaVariant; local only).
const VARIANT = process.env.PERF_VARIANT || '';
if (VARIANT && VARIANT !== 'no-schema-checks') { console.error(`Unknown PERF_VARIANT ${VARIANT}`); process.exit(2); }
if (VARIANT && (process.env.PERF_TARGET_URLS || '')) { console.error('PERF_VARIANT is for the local environment only'); process.exit(2); }
const CONFIG_FILE = VARIANT ? 'save_cart_drawer_noschema.php' : 'save_cart_drawer.php';

const json = (text) => { try { return JSON.parse(text); } catch { return null; } };
const randomShop = (banner) => {
  if (external.length) return externalShops[Math.floor(Math.random() * externalShops.length)];
  // Every 10th shop has banners (seed bannerEvery = 10).
  if (banner) return shopName(10 * Math.floor(Math.random() * Math.floor(SHOPS / 10)));
  let i;
  do { i = Math.floor(Math.random() * SHOPS); } while (i % 10 === 0);
  return shopName(i);
};

const checkConfig = (res, text) => {
  if (res.status !== 200) return `http_${res.status}`;
  const j = json(text);
  if (j?.status !== 'success' || !j.data?.shop) return 'bad_body';
  if (text.includes('data:image')) return 'banner_data_leaked'; // the GET must send links, never image data
  return true;
};
const checkStatusSuccess = (res, text) => (res.status !== 200 ? `http_${res.status}` : json(text)?.status === 'success' ? true : 'bad_body');
const checkSuccessTrue = (res, text) => (res.status !== 200 ? `http_${res.status}` : json(text)?.success === true ? true : 'bad_body');

const scenarios = [
  { name: 'config', weight: 31.5, request: () => ({ path: `/${CONFIG_FILE}?shopdomain=${randomShop(false)}` }), check: checkConfig },
  { name: 'config_banner', weight: 3.5, request: () => ({ path: `/${CONFIG_FILE}?shopdomain=${randomShop(true)}` }), check: checkConfig },
  { name: 'coupons', weight: 35, request: () => ({ path: `/save_coupon.php?shopdomain=${randomShop(false)}` }), check: checkStatusSuccess },
  { name: 'fbt', weight: 15, request: () => ({ path: `/save_fbt_widget.php?shopdomain=${randomShop(false)}` }), check: checkStatusSuccess },
  // Every 3rd shop has COD settings; the others get { enabled: false } (still a valid answer).
  { name: 'cod_config', weight: 10, request: () => ({ path: `/cod_storefront.php?shop=${randomShop(false)}&action=config` }), check: checkSuccessTrue },
  { name: 'packs', weight: 5, request: () => ({ path: `/packs_storefront.php?shop=${randomShop(false)}&productId=${7000 + Math.floor(Math.random() * 3)}` }), check: checkSuccessTrue },
];

function verdict(s) {
  if (!s.requests) return 'NOT RUN';
  return s.p95Ms <= CRITERIA.p95Ms && s.failRate <= CRITERIA.maxFailPct && s.timeouts === 0 ? 'PASS' : 'FAIL';
}

const env = external.length ? null : await startEnvironment();
let seeded = null;
try {
  let baseUrls = external;
  if (env) {
    console.log(`[perf] isolated environment: MariaDB :${env.dbPort}, ${env.baseUrls.length} PHP ${env.php.version} workers (OPcache ${env.php.opcache ? 'on' : 'off'})`);
    const t0 = Date.now();
    seeded = await seed(env.db, { shops: SHOPS });
    await seedCod(env.baseUrls[0], env.secret, env.db, SHOPS);
    await warmUp(env.baseUrls[0]);
    console.log(`[perf] seeded ${SHOPS} synthetic shops in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    baseUrls = env.baseUrls;
  } else {
    console.log(`[perf] external target(s): ${external.join(', ')} — make sure this is staging, not production`);
  }

  // Functional preflight: every scenario answers correctly before any load is applied.
  const preflight = {};
  for (const sc of scenarios) {
    for (let k = 0; k < 3; k++) {
      const req = sc.request({ vu: -1, iter: k });
      const res = await fetch(baseUrls[0] + req.path, { signal: AbortSignal.timeout(10000) });
      const verdictText = sc.check(res, await res.text(), req);
      if (verdictText !== true) { console.error(`[perf] preflight failed: ${sc.name} ${req.path} → ${verdictText}`); process.exitCode = 1; throw new Error('preflight failed'); }
    }
    preflight[sc.name] = 'ok (3/3)';
  }
  console.log('[perf] preflight:', JSON.stringify(preflight));

  const procBefore = env ? { php: processStats(env.pids.php), mysqld: processStats([env.pids.mysqld]) } : null;
  const dbBefore = env ? await dbStatus(env.db) : null;
  const slowFrom = env ? slowLogOffset(env.slowLog) : 0;

  const summary = await runLoad({
    name: `storefront-${profile}`,
    stages: PROFILES[profile],
    thinkMs: [thinkMin, thinkMax],
    timeoutMs: 10000,
    baseUrls,
    scenarios,
    onProgress: ({ t, vus, requests }) => console.log(`[perf] t=${t}s vus=${vus} requests=${requests}`),
  });

  if (env) {
    const dbAfter = await dbStatus(env.db);
    summary.environment = { type: 'local-isolated', php: env.php, shops: seeded, machine: `${os.cpus()[0]?.model}, ${os.cpus().length} logical CPUs, ${Math.round(os.totalmem() / 1073741824)} GB RAM, ${process.platform}`, loadGenerator: 'same machine (competes for CPU with PHP + MariaDB)' };
    summary.resources = {
      php: { before: procBefore.php, after: processStats(env.pids.php) },
      mysqld: { before: procBefore.mysqld, after: processStats([env.pids.mysqld]) },
      db: diffStatus(dbBefore, dbAfter),
    };
    summary.resources.db.questionsPerRequest = Math.round((summary.resources.db.Questions / summary.overall.requests) * 10) / 10;
    summary.slowQueries = slowLogSummary(env.slowLog, slowFrom); // during the run only
  } else {
    summary.environment = { type: 'external', targets: external };
  }
  summary.preflight = preflight;
  summary.variant = VARIANT || 'none (php_backend files as in the repo)';
  summary.criteria = CRITERIA;
  summary.verdicts = Object.fromEntries([['overall', verdict(summary.overall)], ...Object.entries(summary.byScenario).map(([k, v]) => [k, verdict(v)])]);

  const outDir = path.resolve('reports/results');
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${summary.startedAt.slice(0, 19).replace(/:/g, '')}-storefront-${profile}${VARIANT ? `-${VARIANT}` : ''}${external.length ? '-external' : ''}.json`);
  fs.writeFileSync(file, JSON.stringify(summary, null, 2));

  const o = summary.overall;
  console.log(`\n${summary.name}: ${summary.maxVus} VUs, ${summary.durationSeconds} s, ${o.requests} requests, ${o.rps} req/s, p50 ${o.p50Ms} ms, p95 ${o.p95Ms} ms, max ${o.maxMs} ms, failed ${o.failRate}% → ${summary.verdicts.overall}`);
  console.table(Object.fromEntries(Object.entries(summary.byScenario).map(([k, v]) => [k, { requests: v.requests, p50: v.p50Ms, p90: v.p90Ms, p95: v.p95Ms, max: v.maxMs, 'fail%': v.failRate, verdict: summary.verdicts[k] }])));
  if (Object.keys(o.failReasons).length) console.log('failures:', o.failReasons);
  if (summary.resources) console.log('resources:', JSON.stringify(summary.resources));
  console.log(`saved ${path.relative(process.cwd(), file)}`);
} finally {
  if (env) await env.stop();
}
