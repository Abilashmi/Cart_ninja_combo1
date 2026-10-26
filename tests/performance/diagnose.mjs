/* eslint-env node */
// Single-user diagnostics on the isolated environment (no concurrency), to explain
// what the load tests measure:
//   1. per endpoint: serial latency (40 requests, one worker) and the database work
//      one request does (statements, SHOW COLUMNS, on-disk temp tables, bytes from MariaDB)
//   2. the cost of one SHOW COLUMNS on its own
//   3. the drawer config SELECT with and without uploaded banner images
//   4. EXPLAIN of the cart_drawer ↔ cart_drawer_config join for both collations
//      cart_drawer_config could have in production (not known from the repo)
//   5. PHP OPcache on vs off (same database, interleaved requests)
//
//   node tests/performance/diagnose.mjs
// Writes reports/results/<date>-diagnose.json.
import fs from 'node:fs';
import path from 'node:path';
import { percentile } from './lib/runner.mjs';
import { startEnvironment, dbStatus, diffStatus } from './lib/env.mjs';
import { seed, seedCod, warmUp, shopName } from './lib/seed.mjs';

const SHOPS = Number(process.env.PERF_SHOPS || 2000);
const N = 40;
const round = (v) => Math.round(v * 10) / 10;

async function serial(base, pathFor, db) {
  const before = await dbStatus(db);
  const lat = [];
  let bytes = 0;
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    const res = await fetch(base + pathFor(i));
    const text = await res.text();
    lat.push(performance.now() - t0);
    bytes += text.length;
    if (res.status !== 200) throw new Error(`${pathFor(i)} → HTTP ${res.status}`);
  }
  const d = diffStatus(before, await dbStatus(db));
  lat.sort((a, b) => a - b);
  const per = (k) => round((d[k] - (k === 'Questions' ? 1 : 0)) / N); // minus our own SHOW STATUS
  return {
    p50Ms: round(percentile(lat, 50)), p95Ms: round(percentile(lat, 95)), maxMs: round(lat[lat.length - 1]),
    statementsPerRequest: per('Questions'), showColumnsPerRequest: per('Com_show_fields'), selectsPerRequest: per('Com_select'),
    diskTempTablesPerRequest: per('Created_tmp_disk_tables'), dbBytesSentPerRequest: Math.round(d.Bytes_sent / N), responseBytes: Math.round(bytes / N),
  };
}

const env = await startEnvironment({ workers: 1 });
const out = { startedAt: new Date().toISOString(), php: env.php, shops: SHOPS };
try {
  await seed(env.db, { shops: SHOPS });
  await seedCod(env.baseUrls[0], env.secret, env.db, SHOPS);
  await warmUp(env.baseUrls[0]);
  await new Promise((r) => setTimeout(r, 10000)); // let InnoDB finish flushing the seed data
  const base = env.baseUrls[0];
  // Shops without banners (every 10th shop has them), different each request.
  const plain = (i) => { const k = 1 + ((i * 7) % (SHOPS - 2)); return shopName(k % 10 === 0 ? k + 1 : k); };
  const banner = (i) => shopName(10 * (1 + (i % Math.floor((SHOPS - 1) / 10))));

  // 1. per endpoint
  out.endpoints = {
    'save_cart_drawer.php GET (no banner)': await serial(base, (i) => `/save_cart_drawer.php?shopdomain=${plain(i)}`, env.db),
    'save_cart_drawer.php GET (2 uploaded banners)': await serial(base, (i) => `/save_cart_drawer.php?shopdomain=${banner(i)}`, env.db),
    'save_coupon.php GET': await serial(base, (i) => `/save_coupon.php?shopdomain=${plain(i)}`, env.db),
    'save_fbt_widget.php GET': await serial(base, (i) => `/save_fbt_widget.php?shopdomain=${plain(i)}`, env.db),
    'cod_storefront.php config (COD on)': await serial(base, (i) => `/cod_storefront.php?shop=${shopName(3 * (1 + (i % 600)))}&action=config`, env.db),
    'cod_storefront.php config (no COD settings)': await serial(base, (i) => `/cod_storefront.php?shop=${shopName(3 * (1 + (i % 600)) + 1)}&action=config`, env.db),
    'packs_storefront.php GET': await serial(base, (i) => `/packs_storefront.php?shop=${plain(i)}&productId=7001`, env.db),
  };

  // 2. one SHOW COLUMNS
  const t = [];
  for (let i = 0; i < 200; i++) { const t0 = performance.now(); await env.db.query('SHOW COLUMNS FROM cart_drawer_config'); t.push(performance.now() - t0); }
  t.sort((a, b) => a - b);
  out.showColumns = { table: 'cart_drawer_config', p50Ms: round(percentile(t, 50)), p95Ms: round(percentile(t, 95)) };

  // 3. the drawer SELECT itself, banner vs none (MariaDB → Node, same query text as PHP)
  const sql = `SELECT cd.*, cdc.announcement_enabled, cdc.announcement_text, cdc.banner_enabled, cdc.banner_desktop_image, cdc.banner_mobile_image, cdc.banner_placement
    FROM cart_drawer cd LEFT JOIN cart_drawer_config cdc ON cdc.shop_domain = cd.shop COLLATE utf8mb4_unicode_ci WHERE cd.shop = ? LIMIT 1`;
  const timeSelect = async (shopFor) => {
    const l = [];
    for (let i = 0; i < N; i++) { const t0 = performance.now(); await env.db.query(sql, [shopFor(i)]); l.push(performance.now() - t0); }
    l.sort((a, b) => a - b);
    return { p50Ms: round(percentile(l, 50)), p95Ms: round(percentile(l, 95)) };
  };
  out.drawerSelect = { noBanner: await timeSelect(plain), twoBanners: await timeSelect(banner) };

  // 4. EXPLAIN for both collations of cart_drawer_config
  await env.db.query('CREATE TABLE cdc_general LIKE cart_drawer_config');
  await env.db.query('ALTER TABLE cdc_general CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci');
  await env.db.query('INSERT INTO cdc_general (shop_domain, announcement_enabled) SELECT shop_domain, announcement_enabled FROM cart_drawer_config');
  await env.db.query('ANALYZE TABLE cart_drawer, cart_drawer_config, cdc_general');
  const explain = async (table) => {
    const [rows] = await env.db.query(`EXPLAIN SELECT cd.id, cdc.id FROM cart_drawer cd LEFT JOIN ${table} cdc ON cdc.shop_domain = cd.shop COLLATE utf8mb4_unicode_ci WHERE cd.shop = ? LIMIT 1`, [shopName(5)]);
    const r = rows.find((x) => x.table === 'cdc');
    return { type: r.type, key: r.key, rows: Number(r.rows), extra: r.Extra };
  };
  out.joinPlan = { 'cart_drawer_config utf8mb4_unicode_ci': await explain('cart_drawer_config'), 'cart_drawer_config utf8mb4_general_ci': await explain('cdc_general') };

  // 5. OPcache on vs off: two workers on the same files and database, requests interleaved A/B.
  const off = await env.spawnWorker({ port: env.dbPort + 150, opcache: false });
  const ab = { on: { config: [], coupons: [] }, off: { config: [], coupons: [] } };
  const timed = async (url) => { const t0 = performance.now(); const r = await fetch(url); await r.text(); return performance.now() - t0; };
  for (let i = 0; i < N; i++) {
    for (const [side, url] of [['on', base], ['off', off.url]]) {
      ab[side].config.push(await timed(`${url}/save_cart_drawer.php?shopdomain=${plain(i)}`));
      ab[side].coupons.push(await timed(`${url}/save_coupon.php?shopdomain=${plain(i)}`));
    }
  }
  const p = (arr) => { const s = [...arr].sort((a, b) => a - b); return { p50Ms: round(percentile(s, 50)), p95Ms: round(percentile(s, 95)) }; };
  out.opcache = {
    method: 'same database, one worker each, interleaved on/off per request',
    workers: { on: env.php.opcache, off: off.probe.opcache },
    config: { on: p(ab.on.config), off: p(ab.off.config) },
    coupons: { on: p(ab.on.coupons), off: p(ab.off.coupons) },
  };
} finally {
  await env.stop();
}

const outDir = path.resolve('reports/results');
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `${out.startedAt.slice(0, 19).replace(/:/g, '')}-diagnose.json`);
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.table(Object.fromEntries(Object.entries(out.endpoints).map(([k, v]) => [k, { p50: v.p50Ms, p95: v.p95Ms, stmts: v.statementsPerRequest, showCols: v.showColumnsPerRequest, diskTmp: v.diskTempTablesPerRequest, dbKB: Math.round(v.dbBytesSentPerRequest / 1024), respKB: Math.round(v.responseBytes / 1024) }])));
console.log('SHOW COLUMNS alone:', out.showColumns);
console.log('drawer SELECT:', out.drawerSelect);
console.log('join plan:', out.joinPlan);
console.log('OPcache A/B:', JSON.stringify(out.opcache));
console.log(`saved ${path.relative(process.cwd(), file)}`);
