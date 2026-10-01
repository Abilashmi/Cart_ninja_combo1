/* eslint-env node */
// Starts a throwaway MariaDB (XAMPP's binaries, a fresh data folder in the
// temp dir, its own port) and PHP's built-in server hosting copies of the
// php_backend/cod_*.php files with a test config.php. Never touches the
// real XAMPP data folder or the shared production database.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mysql from 'mysql2/promise';

const XAMPP = process.env.XAMPP_DIR || 'C:/xampp';
const MYSQLD = path.join(XAMPP, 'mysql/bin/mysqld.exe');
const INSTALL_DB = path.join(XAMPP, 'mysql/bin/mysql_install_db.exe');
const PHP = path.join(XAMPP, 'php/php.exe');
const DB_PORT = 3399;
const PHP_PORT = 8399;
const SECRET = 'test-forge-secret';

export const harnessAvailable = () => [MYSQLD, INSTALL_DB, PHP].every((f) => fs.existsSync(f));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, label, timeoutMs = 30000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try { const v = await fn(); if (v) return v; } catch (e) { lastError = e; }
    await sleep(250);
  }
  throw new Error(`${label} did not start: ${lastError?.message || 'timeout'}`);
}

export async function startHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brix-cod-php-'));
  const dataDir = path.join(root, 'data');
  const webDir = path.join(root, 'web');
  fs.mkdirSync(webDir);

  execFileSync(INSTALL_DB, [`--datadir=${dataDir}`, `--port=${DB_PORT}`], { stdio: 'ignore' });
  const mysqld = spawn(MYSQLD, [`--datadir=${dataDir}`, `--port=${DB_PORT}`, '--bind-address=127.0.0.1', '--skip-grant-tables', '--console'], { stdio: 'ignore' });

  const admin = await waitFor(() => mysql.createConnection({ host: '127.0.0.1', port: DB_PORT, user: 'root' }), 'MariaDB');
  await admin.query('CREATE DATABASE IF NOT EXISTS brix_cod_test');
  await admin.end();
  const db = await mysql.createConnection({ host: '127.0.0.1', port: DB_PORT, user: 'root', database: 'brix_cod_test' });
  // Minimal `shops` table for plan_helpers.php's plan lookup.
  await db.query('CREATE TABLE IF NOT EXISTS shops (shop_domain VARCHAR(255) PRIMARY KEY, plan_name VARCHAR(50) NULL)');

  const backend = path.resolve('php_backend');
  for (const f of ['cod_helpers.php', 'cod_settings.php', 'cod_otp.php', 'cod_orders.php', 'cod_storefront.php', 'plan_helpers.php', 'plan_config.php']) fs.copyFileSync(path.join(backend, f), path.join(webDir, f));
  fs.writeFileSync(path.join(webDir, 'config.php'), `<?php
$pdo = new PDO('mysql:host=127.0.0.1;port=${DB_PORT};dbname=brix_cod_test;charset=utf8mb4', 'root', '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
`);

  const php = spawn(PHP, ['-S', `127.0.0.1:${PHP_PORT}`, '-t', webDir], { stdio: 'ignore', env: { ...process.env, SHOPIFY_API_KEY: SECRET } });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${PHP_PORT}/cod_settings.php`)).status === 403, 'PHP server');

  return {
    baseUrl: `http://127.0.0.1:${PHP_PORT}`,
    secret: SECRET,
    db,
    async stop() {
      await db.end().catch(() => {});
      php.kill();
      mysqld.kill();
      await sleep(1500);
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* files may still be locked on Windows */ }
    },
  };
}
