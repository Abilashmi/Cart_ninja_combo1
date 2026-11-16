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
const readCat = (lang) => JSON.parse(fs.readFileSync(lang === 'en' ? 'app/i18n/en.json' : `app/i18n/locales/${lang}.json`, 'utf8'));
// A text with no translation yet shows in English, so the check reads the same fallback.
const cat = (lang) => ({ ...readCat('en'), ...readCat(lang) });

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
  const want = ['admin.language.title', 'admin.account.store_info', 'admin.account.plan_billing', 'admin.account.price_label', 'admin.account.support', 'admin.home.videos', 'admin.home.step1_title', 'admin.home.tips', 'admin.home.tip1_title'].map((k) => t[k]);
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
  const hWant = ['admin.home.kpi_orders', 'admin.home.kpi_revenue_generated', 'admin.home.mod_cart_title', 'admin.home.mod_combo_title', 'admin.home.mod_cod_title', 'admin.home.mod_packs_title', 'admin.home.mod_fbt_title', 'admin.home.mod_coupon_title', 'admin.home.feedback'].map((k) => t[k]);
  const hMissing = hWant.filter((w) => !homeText.includes(w));
  check(`${lang}: Home in ${lang}`, hMissing.length === 0, hMissing.length ? `missing ${JSON.stringify(hMissing)}` : '');
  await home.screenshot({ path: path.join(shotDir, `${lang}-home.png`), fullPage: true });
  if (lang === 'en') {
    const switches = home.getByRole('switch');
    // The harness says Cart Editor, COD and FBT are on, Combo and Packs off, Coupon unknown (shown off).
    const states = await switches.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-checked')));
    check('en: six switches show which features are on', states.join(',') === 'true,false,true,false,true,false', states.join(','));
    // The card pictures sit still (finished picture) until the pointer is on the card.
    const running = () => home.evaluate(() => document.querySelector('svg.brx-art-cod').getAnimations({ subtree: true }).length);
    await home.mouse.move(5, 5);
    await home.waitForTimeout(200);
    const still = await running();
    const fee = await home.evaluate(() => getComputedStyle(document.querySelector('.brx-cod-c3')).opacity);
    await home.locator('.brx-art-host').nth(2).hover();
    await home.waitForTimeout(300);
    const playing = await running();
    check('en: card pictures play only on hover', still === 0 && fee === '1' && playing > 5, `still ${still} (fee shown ${fee}), hovered ${playing}`);
    await home.mouse.move(5, 5);
    check('en: tutorials are no longer on Home', !(await home.innerText('body')).includes(t['admin.home.videos']));
    const routes = ['/app/cartdrawer', '/app/bundles', '/app/cod', '/app/packs', '/app/fbt', '/app/productwidget'];
    for (let i = 0; i < routes.length; i += 1) {
      const page = await open('home', lang);
      await page.getByRole('switch').nth(i).click();
      await page.waitForSelector('[data-testid="module-page"]');
      check(`en: switch ${i + 1} opens ${routes[i]}`, (await page.locator('[data-testid="module-page"]').innerText()) === routes[i]);
      await page.close();
    }
    // Date range picker (toolbar): Last 30 days by default, quick periods, a pick reloads the stats.
    const rangePage = await open('home', lang);
    const rangeButton = rangePage.getByRole('button', { name: /Last 30 days/ }).first();
    check('en: period picker defaults to Last 30 days', (await rangeButton.count()) === 1);
    await rangeButton.click();
    const presets = rangePage.locator('.drp-presets');
    await presets.waitFor();
    const presetText = await presets.innerText();
    check('en: period picker lists the quick periods', ['Today', 'Yesterday', 'Last 7 days', 'Last 90 days', 'This month', 'Last month'].every((w) => presetText.includes(w)), presetText.replace(/\s+/g, ' '));
    await presets.getByText('Last 7 days', { exact: true }).click();
    await rangePage.waitForTimeout(400);
    check('en: picking Last 7 days changes the period', (await rangePage.getByRole('button', { name: /Last 7 days/ }).count()) >= 1);
    await rangePage.close();
    // "How to set up": a popup with the steps, "Watch video tutorials" opens them on the Account page.
    const helpPage = await open('home', lang);
    await helpPage.getByText('How to set up', { exact: true }).first().click();
    await helpPage.getByText('How to set up BRIX').waitFor();
    check('en: How to set up opens the steps popup', (await helpPage.innerText('body')).includes('Turn on the app embed.'));
    await helpPage.getByRole('button', { name: 'Watch video tutorials' }).click();
    await helpPage.waitForTimeout(600);
    const helpText = await helpPage.innerText('body');
    check('en: Watch video tutorials opens the Account page at the tutorials', helpText.includes(t['admin.account.store_info']) && helpText.includes(t['admin.home.videos']));
    await helpPage.close();
  }
  await home.close();
}

check('no page errors', allErrors.length === 0, allErrors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed; screenshots in ${shotDir}`);
process.exit(failed ? 1 : 0);
