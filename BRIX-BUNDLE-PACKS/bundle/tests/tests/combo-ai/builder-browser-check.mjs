/* eslint-env node */
// Browser check for the AI suggestion row in the Build a Combo builder's own
// live preview (app/routes/app.bundles.customize.jsx, config.ai_mode).
// Run with: node tests/combo-ai/builder-browser-check.mjs
// Builds tests/combo-ai/harness (the REAL builder route with a mocked loader)
// and mocks /api/combo-ai-suggestions — no store, server or AI provider.
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.join(process.cwd(), 'tests', 'combo-ai', 'harness');
if (!process.env.SKIP_HARNESS_BUILD) execFileSync(process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', path.join(root, 'vite.config.mjs')], { stdio: 'ignore' });
const dist = path.join(root, 'dist');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(dist, p);
  if (p.startsWith('/assets/') && fs.existsSync(file)) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    return res.end(fs.readFileSync(file));
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(fs.readFileSync(path.join(dist, 'index.html')));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const P = (n) => `gid://shopify/Product/${n}`;
const pairs = { [P(1)]: [P(3), P(5), P(2)], [P(3)]: [P(5), P(4), P(1)], [P(5)]: [P(4), P(3)] };

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch();

async function open({ aiMode = true, reply = null, emptyCollections = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const posts = [];
  page.on('pageerror', (e) => check('no page errors', false, e.message));
  // The builder's existing add-to-combo code toasts through the App Bridge
  // global the real admin provides.
  await page.addInitScript(() => { window.shopify = { toast: { show: () => {} } }; });
  if (!aiMode) await page.addInitScript(() => { window.__AI_MODE = false; });
  if (emptyCollections) await page.addInitScript(() => { window.__EMPTY_COLLECTIONS = true; });
  await page.route('**/api/combo-ai-suggestions', async (route) => {
    posts.push(JSON.parse(route.request().postData() || '{}'));
    if (reply) return route.fulfill(reply);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { enabled: true, pairs, ok: true } }) });
  });
  await page.goto(`${base}/app/bundles/customize`);
  await page.waitForSelector(`[data-cdo-product-id="${P(1)}"]`, { timeout: 20000 });
  return { page, posts };
}

const card = (n) => `[data-cdo-product-id="${P(n)}"]`;
const rowTitles = (page) => page.$$eval('[data-cdo-ai-suggestions] button', (btns) => btns.map((b) => b.parentElement.firstElementChild.textContent.trim()));

{
  const { page, posts } = await open();
  await page.waitForTimeout(1200);
  const body = posts[posts.length - 1];
  check('builder asks the AI for its preview products', posts.length >= 1 && body.products.length === 5, `${posts.length} call(s), ${body?.products?.length} products`);
  check('products carry collection titles', body?.products?.find((p) => p.id === P(3))?.collection === 'Serums');
  check('no row before anything is picked', (await page.$('[data-cdo-ai-suggestions]')) === null);
  const hint = await page.textContent('[data-cdo-ai-notice]').catch(() => '');
  check('builder says where the row appears before a pick', hint.includes('Add a product above'), hint);

  await page.click(card(1));
  await page.waitForSelector('[data-cdo-ai-suggestions]', { timeout: 3000 }).catch(() => {});
  const titles = await rowTitles(page);
  check('row appears after picking a product', JSON.stringify(titles) === JSON.stringify(['Vitamin C Serum', 'SPF 50 Gel', 'Rose Face Wash']), titles.join(', '));
  check('default heading', (await page.textContent('[data-cdo-ai-suggestions]')).includes('Pairs well with your picks'));
  await page.$eval('[data-cdo-ai-suggestions]', (el) => el.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: path.join('tests', 'combo-ai', 'builder-preview.png') });

  await page.click(`[data-cdo-ai-suggestions] button:has-text("Add") >> nth=0`);
  const after = await rowTitles(page);
  check('"Add" adds it to the preview combo', !after.includes('Vitamin C Serum') && after[0] === 'SPF 50 Gel', after.join(', '));
  check('multi-variant suggestion says "Choose"', after.includes('Niacinamide Serum') && (await page.textContent('[data-cdo-ai-suggestions]')).includes('Choose'));

  await page.click('[data-cdo-ai-suggestions] button:has-text("Choose")');
  await page.waitForTimeout(150);
  check('"Choose" highlights the product card', await page.$eval(card(4), (el) => el.hasAttribute('data-cdo-ai-flash')));

  await page.close();
}

// Regression: a step collection that returns no products makes the preview
// fall back to store products. The AI candidates must follow the same
// fallback, or the builder shows products but never sends the AI request.
{
  const { page, posts } = await open({ emptyCollections: true });
  await page.waitForTimeout(1200);
  check('empty step collection: preview still shows products', (await page.$$('[data-cdo-product-id]')).length >= 2);
  check('empty step collection: AI request is still sent for the products on screen', posts.length === 1 && posts[0].products.length === 5, `${posts.length} call(s)`);
  await page.click(card(1));
  await page.waitForSelector('[data-cdo-ai-suggestions]', { timeout: 3000 }).catch(() => {});
  const titles = await rowTitles(page);
  check('empty step collection: suggestion cards appear after a pick', titles.length > 0, titles.join(', '));
  await page.close();
}

{
  const { page } = await open({ reply: { status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { enabled: true, pairs: {}, ok: false, reason: 'The AI service did not answer: You exceeded your current quota' } }) } });
  await page.waitForTimeout(1200);
  const text = await page.textContent('[data-cdo-ai-notice]').catch(() => '');
  check('AI failure is shown with its reason', text.includes("couldn't load") && text.includes('exceeded your current quota'), text);
  await page.close();
}

{
  const { page } = await open({ reply: { status: 410, contentType: 'text/plain', body: '' } });
  await page.waitForTimeout(1200);
  const text = await page.textContent('[data-cdo-ai-notice]').catch(() => '');
  check('server/auth failure is shown with the HTTP status', text.includes('HTTP 410'), text);
  await page.close();
}

{
  const { page, posts } = await open({ aiMode: false });
  await page.waitForTimeout(1200);
  await page.click(card(1));
  await page.waitForTimeout(300);
  check('toggle off: no AI call', posts.length === 0);
  check('toggle off: no row', (await page.$('[data-cdo-ai-suggestions]')) === null);
  await page.close();
}

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
