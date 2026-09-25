// Real-browser check of the global Brix AI -> module chat handoff.
//
//   node --import ./tests/packs/register.mjs tests/ai-handoff/browser-check.mjs
//
// Bundles the REAL BrixAiPage, BrixBar and CartEditorPage (tests/ai-handoff/harness,
// Vite) behind a static server; FBT / Build a Combo are stub pages hosting the real
// BrixBar. /api/ai/* is mocked with Playwright routes, so no Shopify session,
// LLM, credit or database is touched. It verifies the wiring — navigation,
// original message shown, one send, no re-run on refresh/back/forward — not the
// LLM tools themselves (those are unchanged and shared with typed messages).
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.join(process.cwd(), 'tests', 'ai-handoff', 'harness');
if (!process.env.SKIP_HARNESS_BUILD) execFileSync(process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', path.join(root, 'vite.config.mjs')], { stdio: 'ignore' });
const dist = path.join(root, 'dist');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };

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

const browser = await chromium.launch();
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n').slice(0, 8).join(' | ')]); }
};

async function newPage({ existingConversations = [] } = {}) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const state = { chats: [], conversationCreates: 0 };
  page.on('pageerror', (e) => { state.pageError = e.message; });
  await page.route('**/api/ai/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const ep = url.pathname.replace('/api/ai/', '');
    if (ep === 'chat') {
      const body = JSON.parse(req.postData());
      state.chats.push(body.message);
      return json({ success: true, message: `mock reply to: ${body.message}`, credits: { remaining: 9, limit: 10, isOverage: false } });
    }
    if (ep === 'conversations') {
      if (req.method() === 'POST') {
        state.conversationCreates += 1;
        return json({ success: true, conversation: { id: `conv-${state.conversationCreates}`, title: 'New', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
      }
      return json({ success: true, conversations: existingConversations });
    }
    if (ep === 'credits') return json({ success: true, credits: { remaining: 10, limit: 10, isOverage: false } });
    if (ep === 'suggestions') return json({ success: true, suggestions: [] });
    if (ep === 'tools') return json({ success: true, tools: [] });
    return json({ success: true });
  });
  return { page, state, context };
}

const sendGlobal = async (page, text) => {
  await page.goto(`${base}/app/brix-ai`);
  await page.locator('.bai-input').fill(text);
  await page.locator('.bai-input').press('Enter');
};
const userBubbles = (page) => page.locator('.bxb-bubble-user').allTextContents();

// ── Test 1 ── Global -> Cart Editor (real CartEditorPage + sidebar) ──────────
await check('1. global -> Cart Editor: navigates, original message shown, sent once, section opens', async () => {
  const { page, state, context } = await newPage();
  const msg = 'Change my progress bar goal to ₹2000';
  await sendGlobal(page, msg);
  await page.getByText("I'll take you to Cart Editor so I can take care of that.").waitFor();
  await page.waitForURL('**/app/cartdrawer');
  await page.locator('.bxb-bubble-user').first().waitFor();
  assert.deepEqual(await userBubbles(page), [msg]);
  await page.getByText(`mock reply to: ${msg}`).waitFor();
  assert.deepEqual(state.chats, [msg]);
  const ev = await page.evaluate(() => window.__handoffEvents);
  assert.deepEqual(ev, [{ module: 'cart_editor', feature: 'progress_bar', features: ['progress_bar'] }]);
  // the existing accordion opened the Progress Bar section (same highlight a preview click gives)
  const bg = await page.locator('button', { hasText: 'Progress Bar' }).first().evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.equal(bg, 'rgb(240, 247, 245)');
  assert.equal(await page.locator('.bxb-input').count(), 1, 'exactly one chat input on Cart Editor');
  assert.equal(state.pageError, undefined);
  await context.close();
});

// ── Test 2 ── Global -> FBT ───────────────────────────────────────────────────
await check('2. global -> FBT: existing chat shows original message, sent once', async () => {
  const { page, state, context } = await newPage();
  const msg = 'Change my FBT template to Modern Cards';
  await sendGlobal(page, msg);
  await page.waitForURL('**/app/fbt');
  await page.locator('.bxb-bubble-user').first().waitFor();
  assert.deepEqual(await userBubbles(page), [msg]);
  await page.getByText(`mock reply to: ${msg}`).waitFor();
  assert.deepEqual(state.chats, [msg]);
  assert.equal((await page.evaluate(() => window.__handoffEvents))[0].module, 'fbt');
  await context.close();
});

// ── Test 3 ── Global -> Build a Combo ────────────────────────────────────────
await check('3. global -> Build a Combo: existing chat shows original message', async () => {
  const { page, state, context } = await newPage();
  const msg = 'Create a combo with the snowboard and the wax';
  await sendGlobal(page, msg);
  await page.waitForURL('**/app/bundles');
  await page.locator('.bxb-bubble-user').first().waitFor();
  assert.deepEqual(await userBubbles(page), [msg]);
  assert.deepEqual(state.chats, [msg]);
  await context.close();
});

// ── Test 4 ── Already inside the module: no navigation ───────────────────────
await check('4. already on FBT: typing there does not navigate, chat handles it', async () => {
  const { page, state, context } = await newPage();
  await page.goto(`${base}/app/fbt`);
  await page.locator('.bxb-input').fill('Change the template to Modern Cards');
  await page.locator('.bxb-input').press('Enter');
  await page.getByText('mock reply to: Change the template to Modern Cards').waitFor();
  assert.ok(page.url().endsWith('/app/fbt'));
  assert.deepEqual(state.chats, ['Change the template to Modern Cards']);
  assert.deepEqual(await page.evaluate(() => window.__handoffEvents), []);
  await context.close();
});

// ── Test 5 ── Cart Editor, multiple features, ONE full message ───────────────
await check('5. Cart Editor multi-feature: complete original message, one send, first feature opened', async () => {
  const { page, state, context } = await newPage();
  const msg = 'Turn on announcement and change progress bar goal to ₹2000';
  await sendGlobal(page, msg);
  await page.waitForURL('**/app/cartdrawer');
  await page.locator('.bxb-bubble-user').first().waitFor();
  assert.deepEqual(await userBubbles(page), [msg]);
  assert.deepEqual(state.chats, [msg]);
  const [ev] = await page.evaluate(() => window.__handoffEvents);
  assert.deepEqual(ev.features, ['announcement', 'progress_bar']);
  const bg = await page.locator('button', { hasText: 'Announcements' }).first().evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.equal(bg, 'rgb(240, 247, 245)');
  await context.close();
});

// ── Test 6 ── Refresh / back / forward must not re-run ───────────────────────
await check('6. refresh, back and forward never execute the handoff again', async () => {
  const { page, state, context } = await newPage();
  const msg = 'Change my FBT template to Modern Cards';
  await sendGlobal(page, msg);
  await page.waitForURL('**/app/fbt');
  await page.getByText(`mock reply to: ${msg}`).waitFor();
  assert.equal(state.chats.length, 1);
  await page.reload();
  await page.locator('.bxb-input').waitFor();
  await page.waitForTimeout(4500); // longer than the receiver's 3s history-wait fallback
  assert.equal(state.chats.length, 1, 'refresh re-ran the request');
  assert.deepEqual(await userBubbles(page), []);
  await page.goBack();
  await page.locator('.bai-input').waitFor();
  await page.goForward();
  await page.locator('.bxb-input').waitFor();
  await page.waitForTimeout(1500);
  assert.equal(state.chats.length, 1, 'back/forward re-ran the request');
  await context.close();
});

// ── Test 7 ── Existing chat history is preserved ─────────────────────────────
await check('7. existing conversations stay in history; handoff starts its own conversation like any new module chat', async () => {
  const old = { id: 'old-1', title: 'How is my FBT configured', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
  const { page, state, context } = await newPage({ existingConversations: [old] });
  const msg = 'Change my FBT template to Modern Cards';
  await sendGlobal(page, msg);
  await page.waitForURL('**/app/fbt');
  await page.getByText(`mock reply to: ${msg}`).waitFor();
  assert.deepEqual(state.chats, [msg]);
  assert.equal(state.conversationCreates, 1);
  await page.locator('.bxb-hist-btn').click();
  const titles = await page.locator('.bxb-hist-title').allTextContents();
  assert.ok(titles.includes('How is my FBT configured'), `history lost the old conversation: ${titles}`);
  await context.close();
});

// ── Global stays global when there is no single confident module ─────────────
await check('8. no module / several modules: stays in the global chat and runs there', async () => {
  for (const msg of ['How can I increase my AOV?', 'Change my FBT template and my progress bar goal']) {
    const { page, state, context } = await newPage();
    await sendGlobal(page, msg);
    await page.getByText(`mock reply to: ${msg}`).waitFor();
    assert.ok(page.url().endsWith('/app/brix-ai'), `navigated away for: ${msg}`);
    assert.deepEqual(state.chats, [msg]);
    await context.close();
  }
});

await check('9. stale handoff (older than 2 minutes) is ignored', async () => {
  const { page, state, context } = await newPage();
  await page.goto(`${base}/app/brix-ai`);
  await page.evaluate(() => sessionStorage.setItem('brix-ai-handoff', JSON.stringify({
    handoffId: 'stale-1', message: 'Change my FBT template', source: 'global-ai', targetModule: 'fbt',
    targetFeature: null, targetFeatures: [], createdAt: Date.now() - 5 * 60 * 1000,
  })));
  await page.goto(`${base}/app/fbt`);
  await page.waitForTimeout(1500);
  assert.equal(state.chats.length, 0);
  await context.close();
});

await check('10. tampered handoff shows a normal error in the existing chat, sends nothing', async () => {
  const { page, state, context } = await newPage();
  await page.goto(`${base}/app/brix-ai`);
  await page.evaluate(() => sessionStorage.setItem('brix-ai-handoff', '{broken'));
  await page.goto(`${base}/app/fbt`);
  await page.getByText("I couldn't pass your request along").waitFor();
  assert.equal(state.chats.length, 0);
  await context.close();
});

await check('11. typing in the chat bar on a non-module page (Analytics) redirects announcement requests to Cart Editor', async () => {
  const { page, state, context } = await newPage();
  const msg = 'Change the announcement text to Big Summer Sale';
  await page.goto(`${base}/app/analytics`);
  await page.locator('.bxb-input').fill(msg);
  await page.locator('.bxb-input').press('Enter');
  await page.getByText("I'll take you to Cart Editor so I can take care of that.").waitFor();
  await page.waitForURL('**/app/cartdrawer');
  await page.getByText(`mock reply to: ${msg}`).waitFor(); // only the Cart Editor chat produces this
  assert.deepEqual(await userBubbles(page), [msg]);
  assert.deepEqual(state.chats, [msg]);
  const [ev] = await page.evaluate(() => window.__handoffEvents);
  assert.equal(ev.feature, 'announcement');
  await context.close();
});

await check('12. typo "announcment" still routes; module pages never redirect', async () => {
  const a = await newPage();
  await sendGlobal(a.page, 'Make my announcment red');
  await a.page.waitForURL('**/app/cartdrawer');
  await a.context.close();
  const b = await newPage();
  await b.page.goto(`${base}/app/fbt`);
  await b.page.locator('.bxb-input').fill('Change the announcement text to Hello');
  await b.page.locator('.bxb-input').press('Enter');
  await b.page.getByText('mock reply to: Change the announcement text to Hello').waitFor();
  assert.ok(b.page.url().endsWith('/app/fbt'));
  await b.context.close();
});

await check('13. sessionStorage blocked (embedded iframe): the handoff still redirects and runs once', async () => {
  const { page, state, context } = await newPage();
  await context.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  const msg = 'change the announcemnet bar text to free shipping above 3000';
  await page.goto(`${base}/app/brix-ai`);
  await page.locator('.bai-input').fill(msg);
  await page.locator('.bai-input').press('Enter');
  await page.waitForURL('**/app/cartdrawer');
  await page.getByText(`mock reply to: ${msg}`).waitFor();
  assert.deepEqual(state.chats, [msg]);
  assert.equal((await page.evaluate(() => window.__handoffEvents))[0].feature, 'announcement');
  await context.close();
});

await check('14. global -> Coupon Banner: original message shown in that page chat, sent once', async () => {
  const { page, state, context } = await newPage();
  const msg = 'create a coupon banner latest one coupon';
  await sendGlobal(page, msg);
  await page.waitForURL('**/app/productwidget');
  await page.getByText('mock reply to: ' + msg).waitFor();
  assert.deepEqual(await userBubbles(page), [msg]);
  assert.deepEqual(state.chats, [msg]);
  await context.close();
});

await check('15. "Try Brix AI Agent" cue: black/white, blinks ~3s, disappears, never shows again', async () => {
  const { page, context } = await newPage();
  await page.goto(`${base}/app/cartdrawer`);
  const pill = page.locator('.brix-ai-discovery-pill');
  await pill.waitFor({ state: 'visible' });
  const colors = await page.evaluate(() => {
    const el = document.querySelector('.brix-ai-discovery-pill');
    const cs = getComputedStyle(el);
    return { anim: cs.animationName, iterations: cs.animationIterationCount, duration: cs.animationDuration, borderColor: cs.borderTopColor };
  });
  assert.equal(colors.anim, 'brix-ai-discovery-blink-pill');
  assert.equal(colors.iterations, '5');
  assert.equal(colors.duration, '0.6s'); // 5 x 0.6s = 3 seconds of blinking
  assert.equal(colors.borderColor, 'rgb(0, 0, 0)');
  // Sample the pill's colours over its lifetime: only black/white shades, and both states seen.
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 2800) {
    seen.add(await page.evaluate(() => {
      const el = document.querySelector('.brix-ai-discovery-pill');
      if (!el) return 'gone';
      const cs = getComputedStyle(el);
      return `${cs.backgroundColor}|${cs.color}`;
    }));
    await page.waitForTimeout(80);
  }
  const palette = [...seen].filter((s) => s !== 'gone');
  assert.ok(palette.every((s) => /^(rgb\(0, 0, 0\)\|rgb\(255, 255, 255\)|rgb\(255, 255, 255\)\|rgb\(0, 0, 0\))$/.test(s)), `non black/white colour seen: ${palette}`);
  assert.equal(palette.length, 2, `expected both black and white states, saw: ${palette}`);
  await pill.waitFor({ state: 'detached', timeout: 2500 });
  await page.reload();
  await page.locator('.bxb-input').waitFor();
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('.brix-ai-discovery-pill').count(), 0, 'cue came back after a reload');
  await page.goto(`${base}/app/fbt`);
  await page.goto(`${base}/app/cartdrawer`);
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('.brix-ai-discovery-pill').count(), 0, 'cue came back on a later visit');
  await context.close();
  // a brand-new browser profile sees it once
  const fresh = await newPage();
  await fresh.page.goto(`${base}/app/cartdrawer`);
  await fresh.page.locator('.brix-ai-discovery-pill').waitFor({ state: 'visible' });
  await fresh.context.close();
});

await check('16. Build a Combo embed notice: steps, theme-editor deep link, check-again button', async () => {
  const { page, context } = await newPage();
  await page.goto(`${base}/__embed-banner`);
  await page.getByText('Turn on the Cart Drawer app embed so your combo pages show up').waitFor();
  const body = await page.locator('.Polaris-Banner').innerText();
  for (const s of ['App embeds', 'Custom Cart Drawer', 'Save', 'check again', 'once per theme']) assert.ok(body.includes(s), `notice is missing: ${s}`);
  assert.equal(await page.locator('.Polaris-Banner ol li').count(), 4);
  const link = page.getByRole('link', { name: 'Open theme editor' });
  assert.equal(await link.getAttribute('target'), '_blank');
  assert.equal(
    await link.getAttribute('href'),
    'https://demo.myshopify.com/admin/themes/current/editor?context=apps&activateAppId=c57aa0a4-9f48-795d-3a28-d57b2bbe1419dcaa27cf/cart_drawer',
  );
  if (process.env.SHOT_DIR) await page.locator('.Polaris-Banner').screenshot({ path: path.join(process.env.SHOT_DIR, 'embed-banner.png') });
  await page.getByRole('button', { name: /check again/i }).click();
  assert.equal(await page.evaluate(() => window.__checkAgain), 1);
  await context.close();
});

// ── Build a Combo builder: app-embed notice at SAVE time (real builder page) ──
const EDITOR_URL = 'https://demo.myshopify.com/admin/themes/current/editor?context=apps&activateAppId=abc/cart_drawer';
async function saveInBuilder({ status, delay = 0 }) {
  const { page, context, state } = await newPage();
  await context.addInitScript(({ status, delay }) => {
    window.__EMBED_STATUS = status;
    window.__EMBED_DELAY = delay;
  }, { status, delay });
  await page.goto(`${base}/app/bundles/customize`);
  // An existing template starts as "saved" (Save disabled) — make a real edit first.
  await page.getByText('Banner Settings').first().click();
  await page.locator('input[type=checkbox]:visible').first().click({ force: true });
  await page.getByRole('button', { name: 'Save Template' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  return { page, context, state };
}
const noticeTitle = 'Your template is saved — one more step';

await check('17. save with the Cart Drawer embed OFF: shows the how-to first, then continues', async () => {
  const { page, context } = await saveInBuilder({ status: { checked: true, enabled: false, editorUrl: EDITOR_URL } });
  await page.getByText(noticeTitle).waitFor();
  const dialog = page.getByRole('dialog', { name: noticeTitle }); // the Save Template modal may still be fading out
  const text = await dialog.innerText();
  for (const s of ['not turned on in your theme', 'App embeds', 'Custom Cart Drawer', 'Save', 'once per theme']) assert.ok(text.includes(s), `notice is missing: ${s}`);
  assert.ok(!text.includes("couldn't check"), 'confirmed-off wording, not the unknown wording');
  assert.equal(await dialog.getByRole('link', { name: 'Open theme editor' }).getAttribute('href'), EDITOR_URL);
  assert.ok(page.url().endsWith('/app/bundles/customize'), 'must not navigate away before the merchant has seen it');
  if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, 'embed-save-modal.png') });
  assert.equal(await page.evaluate(() => window.__saves.length), 1, 'template was saved exactly once');
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL('**/app/bundles/templates');
  await context.close();
});

await check('18. save with the embed already ON: no notice, goes straight on as before', async () => {
  const { page, context } = await saveInBuilder({ status: { checked: true, enabled: true, editorUrl: EDITOR_URL } });
  await page.waitForURL('**/app/bundles/templates');
  assert.equal(await page.getByText(noticeTitle).count(), 0);
  await context.close();
});

await check('19. embed status unknown (theme unreadable): asks the merchant to confirm rather than claiming it is off', async () => {
  const { page, context } = await saveInBuilder({ status: { checked: false, enabled: true, editorUrl: EDITOR_URL } });
  await page.getByText(noticeTitle).waitFor();
  const text = await page.getByRole('dialog', { name: noticeTitle }).innerText();
  assert.ok(text.includes("couldn't check"), text);
  assert.ok(!text.includes('is not turned on in your theme yet'));
  await context.close();
});

await check('20. slow check: waits for it (no early redirect), and gives up after 5s instead of hanging', async () => {
  const slow = await saveInBuilder({ status: { checked: true, enabled: false, editorUrl: EDITOR_URL }, delay: 1500 });
  await slow.page.getByText(noticeTitle).waitFor({ timeout: 4000 });
  assert.ok(slow.page.url().endsWith('/app/bundles/customize'));
  await slow.context.close();
  const hung = await saveInBuilder({ status: { checked: true, enabled: true, editorUrl: EDITOR_URL }, delay: 9000 });
  await hung.page.getByText(noticeTitle).waitFor({ timeout: 8000 }); // 5s cap -> unknown -> reminder
  await hung.context.close();
});

await browser.close();
server.close();
for (const r of results) console.log(r.join('  '));
if (results.some((r) => r[0] === 'FAIL')) process.exit(1);
