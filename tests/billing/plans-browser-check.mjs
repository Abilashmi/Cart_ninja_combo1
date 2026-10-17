/* eslint-env node */
// Real-browser check of the plan page (app.subscribe.jsx): Monthly / Yearly
// switch, yearly prices, the 60-day yearly trial, yearly limits (no per-order
// or AI overage), and what each button posts. Bundled by tests/billing/harness
// (Vite) with server modules stubbed; the action is mocked. Run from the repo root:
//   node tests/billing/plans-browser-check.mjs
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.join(process.cwd(), 'tests', 'billing', 'harness');
const dist = path.join(os.tmpdir(), 'brix-billing-harness');
if (!process.env.SKIP_HARNESS_BUILD) execFileSync(process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', path.join(root, 'vite.config.mjs')], { stdio: 'ignore' });
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch();

async function open(data, width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  const posts = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((d) => { window.__DATA__ = d; }, data);
  await page.route('http://harness.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/harness/subscribe') {
      posts.push(Object.fromEntries(new URLSearchParams(route.request().postData() || '')));
      return route.fulfill({ contentType: 'application/json', body: '{}' });
    }
    const file = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ contentType: MIME[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://harness.test/');
  await page.getByText('Simple, transparent pricing').waitFor();
  return { page, posts, errors };
}

const card = (page, label) => page.locator('div', { has: page.getByRole('heading', { name: label, exact: true }) }).filter({ has: page.getByRole('button') }).last();

// ── A Free shop: monthly by default, then Yearly ──
{
  const { page, posts, errors } = await open({ currentPlanKey: 'free', currentInterval: 'monthly', promoTrialDays: 0 });
  const starter = card(page, 'Starter');
  check('monthly by default: Starter $29 / month with per-order overage', /\$29\s*\/ month/.test(await starter.innerText()) && /500 orders \/ month — then \$0\.03\/order/.test(await starter.innerText()));
  check('monthly: 14-day trial', /14-day free trial/.test(await page.innerText('body')) && /Upgrade to Starter — 14-day trial/.test(await starter.innerText()));
  await page.getByRole('radio', { name: /Yearly/ }).click();
  const st = await starter.innerText();
  check('yearly: Starter $290 / year, 60-day trial, $24.17 a month', /\$290\s*\/ year/.test(st) && /60-day free trial, then \$24\.17\/month/.test(st), st.split('\n').slice(0, 8).join(' | '));
  check('yearly: no per-order charge, the storefront pauses at 500', /500 orders \/ month — storefront pauses after that/.test(st) && !/then \$0\.03\/order/.test(st));
  check('yearly: AI BRIX credits without a per-credit charge', /AI BRIX — 30 credits \/ month$/m.test(st));
  const growth = await card(page, 'Growth').innerText();
  check('yearly: Growth $590 / year, 1000 orders then pause', /\$590\s*\/ year/.test(growth) && /1000 orders \/ month — storefront pauses after that/.test(growth));
  check('yearly: Pro $790 / year, unlimited orders', /\$790\s*\/ year/.test(await card(page, 'Pro').innerText()) && /Unlimited orders/.test(await card(page, 'Pro').innerText()));
  check('yearly: Free stays free', /\$0\s*\/ month/.test(await card(page, 'Free').innerText()) && /Always free/.test(await card(page, 'Free').innerText()));
  check('yearly: the footer explains the yearly limits', /Yearly plans include a 60-day free trial/.test(await page.innerText('body')));
  await starter.getByRole('button', { name: /Upgrade to Starter — 60-day trial/ }).click();
  const dialog = page.getByRole('dialog');
  check('yearly: the plan dialog says billed yearly, 60-day trial', /Starter \(billed yearly\), which includes a 60-day free trial/.test(await dialog.innerText()));
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(400);
  check('yearly: Starter posts interval ANNUAL', posts.length === 1 && posts[0].planKey === 'starter' && posts[0].interval === 'ANNUAL', JSON.stringify(posts));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ── A shop on yearly Growth ──
{
  const { page, posts, errors } = await open({ currentPlanKey: 'growth', currentInterval: 'annual', promoTrialDays: 0 });
  check('yearly shop: the page opens on Yearly', await page.getByRole('radio', { name: /Yearly/ }).getAttribute('aria-checked') === 'true');
  check('yearly shop: Growth yearly is the current plan', /Current Plan/.test(await card(page, 'Growth').innerText()));
  await page.getByRole('radio', { name: 'Monthly' }).click();
  const growthBtn = card(page, 'Growth').getByRole('button', { name: 'Switch to monthly billing' });
  check('yearly shop on Monthly: Growth offers "Switch to monthly billing"', await growthBtn.count() === 1);
  await growthBtn.click();
  const dialog = page.getByRole('dialog');
  if (await dialog.count()) await dialog.getByRole('button', { name: 'Continue' }).click();
  await page.waitForTimeout(400);
  check('switching to monthly posts EVERY_30_DAYS for Growth', posts.at(-1)?.planKey === 'growth' && posts.at(-1)?.interval === 'EVERY_30_DAYS', JSON.stringify(posts));
  await card(page, 'Free').getByRole('button', { name: 'Downgrade to Free' }).click();
  check('yearly shop: downgrading says the paid year is kept', /You keep your yearly plan until the year you paid for ends/.test(await page.getByRole('dialog').innerText()));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ── Phone width ──
{
  const { page, errors } = await open({ currentPlanKey: 'free', currentInterval: 'monthly', promoTrialDays: 0 }, 390);
  await page.getByRole('radio', { name: /Yearly/ }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('phone: no sideways scroll with the Yearly switch', overflow <= 0, `${overflow}px`);
  await page.screenshot({ path: path.join(os.tmpdir(), 'brix-plans-phone.png'), fullPage: false });
  check('no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
