/* eslint-env node */
// Real-browser check of the admin in the merchant's language: the Account
// page (with Account → Language) and Home, bundled by tests/i18n/admin-harness
// (Vite) with server modules stubbed. Run from the repo root:
//   node tests/i18n/admin-browser-check.mjs
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.join(process.cwd(), 'tests', 'i18n', 'admin-harness');
const dist = path.join(os.tmpdir(), 'brix-i18n-admin-harness');
if (!process.env.SKIP_HARNESS_BUILD) execFileSync(process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', path.join(root, 'vite.config.mjs')], { stdio: 'ignore' });
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const shotDir = path.join(os.tmpdir(), 'brix-i18n-admin');
fs.mkdirSync(shotDir, { recursive: true });
const cat = (lang) => JSON.parse(fs.readFileSync(lang === 'en' ? 'app/i18n/en.json' : `app/i18n/locales/${lang}.json`, 'utf8'));

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch();
const allErrors = [];

async function open(pageName, lang) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  page.on('pageerror', (e) => allErrors.push(`${pageName}/${lang}: ${e.message}`));
  await page.addInitScript(() => { window.shopify = { toast: { show: (m) => { window.__toast = m; } } }; });
  await page.route('http://harness.test/**', async (route) => {
    const url = new URL(route.request().url());
    const file = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ contentType: MIME[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`http://harness.test/?page=${pageName}&lang=${lang}`);
  await page.waitForTimeout(600);
  return page;
}

for (const lang of ['hi', 'ta', 'es', 'en']) {
  const t = cat(lang);
  const account = await open('account', lang);
  const text = await account.innerText('body');
  const want = ['admin.language.title', 'admin.account.store_info', 'admin.account.plan_billing', 'admin.account.price_label', 'admin.account.support'].map((k) => t[k]);
  const missing = want.filter((w) => !text.includes(w));
  check(`${lang}: Account page in ${lang}`, missing.length === 0, missing.length ? `missing ${JSON.stringify(missing)}` : '');
  // The picker always names each language in its own script.
  const options = await account.locator('select').first().locator('option').allInnerTexts();
  check(`${lang}: language picker lists every language by its own name`, ['English', 'हिन्दी', 'தமிழ்', 'Español'].every((n) => options.includes(n)) && options.includes(t['admin.language.auto']), options.join(' | '));
  await account.screenshot({ path: path.join(shotDir, `${lang}-account.png`), fullPage: true });
  if (lang === 'hi') {
    await account.locator('select').first().selectOption('ta');
    await account.waitForTimeout(400);
    const posts = await account.evaluate(() => window.__posts);
    const toast = await account.evaluate(() => window.__toast);
    check('hi: picking Tamil saves language=ta and confirms', posts.some((p) => p.intent === 'language' && p.language === 'ta') && toast === t['admin.language.saved'], JSON.stringify({ posts, toast }));
  }
  await account.close();

  const home = await open('home', lang);
  const homeText = await home.innerText('body');
  // First visit opens "Getting started"; check its texts, then the dashboard.
  const gs = ['admin.home.welcome', 'admin.home.videos', 'admin.home.step1_title', 'admin.home.tips', 'admin.home.tip1_title'].map((k) => t[k]);
  const gsMissing = gs.filter((w) => !homeText.includes(w));
  check(`${lang}: Home getting started in ${lang}`, gsMissing.length === 0, gsMissing.length ? `missing ${JSON.stringify(gsMissing)}` : '');
  await home.screenshot({ path: path.join(shotDir, `${lang}-home-start.png`), fullPage: true });
  await home.getByRole('button', { name: t['admin.home.go_dashboard'] }).click();
  await home.waitForTimeout(300);
  const dash = await home.innerText('body');
  const dWant = ['admin.home.welcome_back', 'admin.home.kpi_revenue', 'admin.home.quick_links', 'admin.home.feedback', 'admin.nav.cart_editor'].map((k) => t[k]);
  const dMissing = dWant.filter((w) => !dash.includes(w));
  check(`${lang}: Home dashboard in ${lang}`, dMissing.length === 0, dMissing.length ? `missing ${JSON.stringify(dMissing)}` : '');
  await home.screenshot({ path: path.join(shotDir, `${lang}-home.png`), fullPage: true });
  await home.close();
}

check('no page errors', allErrors.length === 0, allErrors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed; screenshots in ${shotDir}`);
process.exit(failed ? 1 : 0);
