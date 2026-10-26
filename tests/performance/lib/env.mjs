/* eslint-env node */
// Isolated performance environment, built the same way as tests/cod/php-harness.mjs
// but with several PHP workers so requests really run in parallel:
//   - a throwaway MariaDB from XAMPP's binaries (fresh data folder in the temp dir,
//     own port, slow query log on) — never the XAMPP data folder or the shared DB
//   - N `php -S` processes serving copies of php_backend files with a test config.php
//     (PHP's built-in server handles one request at a time per process on Windows,
//     so N processes ≈ N PHP-FPM / LiteSpeed workers)
//   - a fake BRIX app server standing in for Fly (cod_checkout.php relays to it), with
//     a configurable delay; it never talks to Shopify, MSG91, GA4 or Meta
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import mysql from 'mysql2/promise';

const XAMPP = process.env.XAMPP_DIR || 'C:/xampp';
const MYSQLD = path.join(XAMPP, 'mysql/bin/mysqld.exe');
const INSTALL_DB = path.join(XAMPP, 'mysql/bin/mysql_install_db.exe');
const PHP = path.join(XAMPP, 'php/php.exe');
export const SECRET = 'perf-test-forge-secret';
export const DB_NAME = 'brix_perf';

export const PHP_FILES = [
  'config.php', // written below, not copied
  'save_cart_drawer.php', 'save_coupon.php', 'save_fbt_widget.php', 'cart_banner_image.php',
  'plan_helpers.php', 'plan_config.php', 'shop_integrations.php',
  'cod_helpers.php', 'cod_settings.php', 'cod_otp.php', 'cod_orders.php', 'cod_storefront.php', 'cod_checkout.php',
  'packs_storefront.php',
];

export const environmentAvailable = () => [MYSQLD, INSTALL_DB, PHP].every((f) => fs.existsSync(f));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, label, timeoutMs = 45000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try { const v = await fn(); if (v) return v; } catch (e) { lastError = e; }
    await sleep(250);
  }
  throw new Error(`${label} did not start: ${lastError?.message || 'timeout'}`);
}

/**
 * @param {object} o
 * @param {number} o.workers      PHP worker processes (default PERF_PHP_WORKERS or 4)
 * @param {boolean} o.opcache     load OPcache like a production PHP (default true; PERF_OPCACHE=0 turns it off)
 * @param {number} o.basePort     DB port; PHP workers use basePort+101.., the fake app basePort+100
 */
export async function startEnvironment({ workers = Number(process.env.PERF_PHP_WORKERS || 4), opcache = process.env.PERF_OPCACHE !== '0', basePort = Number(process.env.PERF_BASE_PORT || 3460) } = {}) {
  if (!environmentAvailable()) throw new Error(`XAMPP binaries not found under ${XAMPP} (set XAMPP_DIR)`);
  const DB_PORT = basePort;
  const APP_PORT = basePort + 100;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brix-perf-'));
  const dataDir = path.join(root, 'data');
  const webDir = path.join(root, 'web');
  const slowLog = path.join(root, 'slow.log');
  fs.mkdirSync(webDir);

  execFileSync(INSTALL_DB, [`--datadir=${dataDir}`, `--port=${DB_PORT}`], { stdio: 'ignore' });
  const mysqld = spawn(MYSQLD, [
    `--datadir=${dataDir}`, `--port=${DB_PORT}`, '--bind-address=127.0.0.1', '--skip-grant-tables', '--console',
    '--slow-query-log=1', `--slow-query-log-file=${slowLog}`, '--long-query-time=0.05', // 50 ms
  ], { stdio: 'ignore' });

  const admin = await waitFor(() => mysql.createConnection({ host: '127.0.0.1', port: DB_PORT, user: 'root' }), 'MariaDB');
  await admin.query(`CREATE DATABASE IF NOT EXISTS ${DB_NAME}`);
  await admin.end();
  const db = await mysql.createConnection({ host: '127.0.0.1', port: DB_PORT, user: 'root', database: DB_NAME, multipleStatements: true });

  const backend = path.resolve('php_backend');
  for (const f of PHP_FILES) if (f !== 'config.php') fs.copyFileSync(path.join(backend, f), path.join(webDir, f));
  fs.writeFileSync(path.join(webDir, 'config.php'), `<?php
$pdo = new PDO('mysql:host=127.0.0.1;port=${DB_PORT};dbname=${DB_NAME};charset=utf8mb4', 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
`);
  writeNoSchemaVariant(webDir);
  // Tiny probe so the run records whether OPcache really loaded.
  fs.writeFileSync(path.join(webDir, '__perf_probe.php'), `<?php header('Content-Type: application/json'); echo json_encode(['php' => PHP_VERSION, 'opcache' => function_exists('opcache_get_status') && (opcache_get_status(false)['opcache_enabled'] ?? false)]);`);

  // Fake BRIX app (Fly). app.delayMs simulates Shopify / Fly latency; app.reply builds the answer.
  const app = {
    delayMs: 0,
    requests: 0,
    inFlight: 0,
    maxInFlight: 0,
    reply: (entry) => ({ status: 200, body: { success: true, echo: entry.path } }),
  };
  const appServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      app.requests++;
      app.inFlight++;
      app.maxInFlight = Math.max(app.maxInFlight, app.inFlight);
      if (app.delayMs) await sleep(app.delayMs);
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
      const { status, body: out } = app.reply({ path: req.url, headers: req.headers, body });
      app.inFlight--;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise((r) => appServer.listen(APP_PORT, '127.0.0.1', r));

  const phpArgs = opcache ? ['-d', 'zend_extension=opcache', '-d', 'opcache.enable=1', '-d', 'opcache.enable_cli=1', '-d', 'opcache.validate_timestamps=0'] : [];
  const phpEnv = { ...process.env, SHOPIFY_API_KEY: SECRET, BRIX_APP_URL: `http://127.0.0.1:${APP_PORT}` };
  const phps = [];
  const baseUrls = [];
  for (let i = 0; i < workers; i++) {
    const port = basePort + 101 + i;
    phps.push(spawn(PHP, [...phpArgs, '-S', `127.0.0.1:${port}`, '-t', webDir], { stdio: 'ignore', env: phpEnv }));
    baseUrls.push(`http://127.0.0.1:${port}`);
  }
  for (const u of baseUrls) await waitFor(async () => (await fetch(`${u}/__perf_probe.php`)).ok, `PHP worker ${u}`);
  const probe = await (await fetch(`${baseUrls[0]}/__perf_probe.php`)).json();

  /** One more PHP worker on the same files and database (e.g. OPcache off for an A/B). */
  async function spawnWorker({ port, opcache: withOpcache }) {
    const args = withOpcache ? ['-d', 'zend_extension=opcache', '-d', 'opcache.enable=1', '-d', 'opcache.enable_cli=1', '-d', 'opcache.validate_timestamps=0'] : [];
    phps.push(spawn(PHP, [...args, '-S', `127.0.0.1:${port}`, '-t', webDir], { stdio: 'ignore', env: phpEnv }));
    const url = `http://127.0.0.1:${port}`;
    await waitFor(async () => (await fetch(`${url}/__perf_probe.php`)).ok, `PHP worker ${url}`);
    return { url, probe: await (await fetch(`${url}/__perf_probe.php`)).json() };
  }

  return {
    root,
    spawnWorker,
    baseUrls,
    appUrl: `http://127.0.0.1:${APP_PORT}`,
    secret: SECRET,
    db,
    dbPort: DB_PORT,
    app,
    slowLog,
    php: { version: probe.php, opcache: probe.opcache, workers },
    pids: { php: phps.map((p) => p.pid), mysqld: mysqld.pid },
    async stop() {
      appServer.close();
      await db.end().catch(() => {});
      for (const p of phps) p.kill();
      mysqld.kill();
      await sleep(1500);
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* files may still be locked on Windows */ }
    },
  };
}

/**
 * Experiment only (never written to php_backend/): a copy of the drawer config GET
 * without its per-request schema checks (4 ensure*Columns calls + plan_ensure_columns,
 * = 5 SHOW COLUMNS), served as save_cart_drawer_noschema.php next to the original.
 * The original still runs once in warmUp, so the columns exist.
 */
function writeNoSchemaVariant(webDir) {
  let drawer = fs.readFileSync(path.join(webDir, 'save_cart_drawer.php'), 'utf8');
  const calls = ['ensureWatermarkColumn($pdo);', 'ensureAnnouncementStyleColumns($pdo);', 'ensureCountdownColumns($pdo);', 'ensureBannerColumns($pdo);'];
  for (const c of calls) {
    const re = new RegExp(`^(\\s*)${c.replace(/[$()]/g, '\\$&')}\\s*$`, 'm');
    if (!re.test(drawer)) throw new Error(`no-schema variant: "${c}" not found in save_cart_drawer.php`);
    drawer = drawer.replace(re, `$1// ${c} (skipped by the no-schema experiment)`);
  }
  drawer = drawer.replace("require_once __DIR__ . '/plan_helpers.php';", "require_once __DIR__ . '/plan_helpers_noschema.php';");
  let plan = fs.readFileSync(path.join(webDir, 'plan_helpers.php'), 'utf8');
  const before = plan;
  plan = plan.replace(/(function plan_ensure_columns\(\$pdo\) \{\s*static \$ensured = )false;/, '$1true;');
  if (plan === before) throw new Error('no-schema variant: plan_ensure_columns not found in plan_helpers.php');
  fs.writeFileSync(path.join(webDir, 'save_cart_drawer_noschema.php'), drawer);
  fs.writeFileSync(path.join(webDir, 'plan_helpers_noschema.php'), plan);
}

/** CPU seconds and peak memory of the given processes (Windows, via PowerShell). */
export function processStats(pids) {
  if (process.platform !== 'win32' || !pids.length) return null;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,CPU,WorkingSet64,PeakWorkingSet64 | ConvertTo-Json -Compress`], { encoding: 'utf8' });
    const rows = [].concat(JSON.parse(out || '[]'));
    return {
      cpuSeconds: Math.round(rows.reduce((a, r) => a + (r.CPU || 0), 0) * 100) / 100,
      workingSetMb: Math.round(rows.reduce((a, r) => a + r.WorkingSet64, 0) / 1048576),
      peakWorkingSetMb: Math.round(rows.reduce((a, r) => a + r.PeakWorkingSet64, 0) / 1048576),
    };
  } catch { return null; }
}

/** MariaDB counters worth diffing across a run. */
export async function dbStatus(db) {
  const [rows] = await db.query("SHOW GLOBAL STATUS WHERE Variable_name IN ('Questions','Com_select','Com_show_fields','Com_create_table','Com_insert','Com_update','Com_delete','Slow_queries','Threads_connected','Max_used_connections','Connections','Aborted_connects','Created_tmp_disk_tables','Innodb_row_lock_waits','Bytes_sent')");
  return Object.fromEntries(rows.map((r) => [r.Variable_name, Number(r.Value)]));
}

export function diffStatus(before, after) {
  const out = {};
  for (const k of Object.keys(after)) out[k] = ['Threads_connected', 'Max_used_connections'].includes(k) ? after[k] : after[k] - (before[k] || 0);
  return out;
}

/** Current size of the slow log, to read only what a run adds (pass it to slowLogSummary). */
export function slowLogOffset(file) {
  try { return fs.statSync(file).size; } catch { return 0; }
}

/** Number of slow-log entries (queries over 50 ms) after `fromOffset` and the slowest statements. */
export function slowLogSummary(file, fromOffset = 0) {
  let text = '';
  try { text = fs.readFileSync(file).subarray(fromOffset).toString('utf8'); } catch { return { count: 0, top: [] }; }
  const entries = [];
  const re = /# Query_time: ([\d.]+)[^\n]*\n(?:#[^\n]*\n)*(?:SET timestamp=\d+;\n)?([^\n]+)/g;
  let m;
  while ((m = re.exec(text))) entries.push({ seconds: Number(m[1]), sql: m[2].slice(0, 160) });
  entries.sort((a, b) => b.seconds - a.seconds);
  return { count: entries.length, top: entries.slice(0, 5) };
}
