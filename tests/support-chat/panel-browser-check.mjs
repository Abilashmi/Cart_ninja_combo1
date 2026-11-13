// Run with: node tests/support-chat/panel-browser-check.mjs
// The team panel (/internal/chat, utils/support-chat-panel.js) in a real
// browser under its own Content-Security-Policy (only the nonce'd script
// runs), with /internal/chat/api mocked: inbox, where a chat is from, replies,
// take over, close, settings, and merchant text that is never run as HTML.
import { chromium } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const { supportChatPanel } = await import('../../app/utils/support-chat-panel.js');
const shotDir = path.join(os.tmpdir(), 'brix-support-chat');
fs.mkdirSync(shotDir, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const NONCE = 'dGVzdG5vbmNlMTIzNDU2';
const CSP = `default-src 'none'; script-src 'nonce-${NONCE}'; connect-src 'self'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;
const recent = new Date(Date.now() - 5 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
const CONVS = [
  { id: 7, shop: 'silverline.myshopify.com', status: 'open', needsTeam: true, aiPaused: true, unreadTeam: 2, lastMessageAt: recent, lastPreview: 'COD button is not showing',
    context: { name: 'Silverline', owner: 'Gopi', email: 'owner@example.com', domain: 'https://silverline925.in', plan: 'growth', shopifyPlan: 'Basic', embed: 'on', page: '/app/cod', locale: 'en', features: { cart: false, cod: true, packs: true } }, contextAt: recent },
  { id: 8, shop: 'kids.myshopify.com', status: 'open', needsTeam: false, aiPaused: false, unreadTeam: 1, lastMessageAt: recent, lastPreview: '<img src=x onerror=window.__hacked=1>', context: {}, contextAt: null },
];
const MESSAGES = {
  7: [
    { id: 1, sender: 'merchant', author: '', body: 'COD button is not showing', at: recent },
    { id: 2, sender: 'ai', author: 'BRIX AI', body: 'Check COD Checkout > Customize > Product page.', at: recent },
    { id: 3, sender: 'merchant', author: '', body: '<img src=x onerror="window.__hacked=1"> still missing', at: recent },
    { id: 4, sender: 'system', author: 'BRIX Support', body: 'Got it. Someone from the BRIX team will reply here shortly.', at: recent },
  ],
  8: [{ id: 9, sender: 'merchant', author: '', body: '<img src=x onerror=window.__hacked=1>', at: recent }],
};
let SETTINGS = { enabled: true, aiEnabled: true, launcherText: 'Need help setting up?', greeting: 'Hi!', awayMessage: 'Away.', handoffMessage: 'Soon.', teamName: 'BRIX Support', aiDailyLimit: 40, officeHours: { enabled: true, timeZone: 'Asia/Kolkata', days: [1, 2, 3, 4, 5, 6], from: '10:00', to: '19:00' }, quickReplies: ['Please refresh your store and check again.', 'Could you share a screenshot?'] };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const posts = [];
await page.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === '/internal/chat') return route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': CSP }, body: supportChatPanel(NONCE) });
  if (url.pathname === '/internal/chat/api') {
    const send = (data) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      posts.push(body);
      if (body.intent === 'reply') {
        const m = { id: 50 + posts.length, sender: 'team', author: body.author, body: body.body, at: recent };
        MESSAGES[body.id].push(m);
        return send({ success: true, message: m });
      }
      if (body.intent === 'update') {
        const c = CONVS.find((x) => x.id === body.id);
        if (body.status) c.status = body.status;
        if (typeof body.aiPaused === 'boolean') c.aiPaused = body.aiPaused;
        if (body.read) c.unreadTeam = 0;
        return send({ success: true, conversation: c });
      }
      if (body.intent === 'settings') { SETTINGS = { ...SETTINGS, ...body.settings }; return send({ success: true, settings: SETTINGS }); }
    }
    if (url.searchParams.get('settings')) return send({ success: true, settings: SETTINGS, online: true });
    const id = Number(url.searchParams.get('id'));
    if (id) {
      const after = Number(url.searchParams.get('after')) || 0;
      return send({ success: true, conversation: CONVS.find((c) => c.id === id), messages: MESSAGES[id].filter((m) => m.id > after) });
    }
    const filter = url.searchParams.get('filter');
    const list = CONVS.filter((c) => (filter === 'closed' ? c.status === 'closed' : filter === 'all' ? true : c.status === 'open'));
    return send({ success: true, conversations: list, waiting: CONVS.filter((c) => c.status === 'open' && (c.needsTeam || c.unreadTeam)).length });
  }
  return route.fulfill({ status: 404, body: '' });
});

await page.goto('http://brix.test/internal/chat');
await page.locator('.item').first().waitFor();
check('inbox lists the waiting chats, newest first, by store name', (await page.locator('.item b').allInnerTexts()).join('|') === 'Silverline|kids.myshopify.com');
check('tab title counts who is waiting', (await page.title()) === '(2) BRIX chat', await page.title());
check('"Needs team" and unread tags', (await page.locator('.item').first().innerText()).includes('Needs team') && (await page.locator('.item').first().innerText()).includes('2 new'));

await page.locator('.item').first().click();
await page.locator('.m.merchant').first().waitFor();
const info = await page.locator('#info').innerText();
check('where it is from: store, owner, email, plan, page, app embed', ['Silverline', 'Gopi', 'owner@example.com', 'growth', '/app/cod', 'on', 'https://silverline925.in'].every((w) => info.includes(w)), info.replace(/\s+/g, ' '));
check('features on / off as chips', (await page.locator('.chip.on').allInnerTexts()).join(',') === 'cod on,packs on');
check('merchant HTML shows as text and never runs', (await page.locator('.msgs img').count()) === 0 && (await page.locator('.m.merchant p').nth(1).innerText()).startsWith('<img src=x') && !(await page.evaluate(() => window.__hacked)));
await page.waitForTimeout(300);
check('opening a chat marks it read', posts.some((p) => p.intent === 'update' && p.id === 7 && p.read));

// Typing across several polls, with a new merchant message arriving meanwhile,
// keeps every character and the focus (polls used to rebuild the reply box).
const reply0 = page.locator('#reply');
const replyHandle = await reply0.elementHandle();
await reply0.click();
const typed = 'Hello there, I am looking at your COD settings now';
const half = Math.floor(typed.length / 2);
await page.keyboard.type(typed.slice(0, half), { delay: 60 });
MESSAGES[7].push({ id: 5, sender: 'merchant', author: '', body: 'Any update?', at: recent });
await page.waitForTimeout(3500);
await page.keyboard.type(typed.slice(half), { delay: 60 });
await page.waitForTimeout(3500);
check('typing with spaces across polls keeps every character and the focus', (await reply0.inputValue()) === typed && await page.evaluate(() => document.activeElement && document.activeElement.id === 'reply'), JSON.stringify(await reply0.inputValue()));
check('the reply box is the same element after polls', await page.evaluate((a) => a === document.getElementById('reply'), replyHandle));
check('the new merchant message was added meanwhile', (await page.locator('.m.merchant p', { hasText: 'Any update?' }).count()) === 1);
await reply0.fill('');
await page.locator('#reply').fill('Hi, checking now.');
await page.getByRole('button', { name: 'Send' }).click();
check('a reply needs your name first', (await page.locator('#reply-err').innerText()).includes('name'));
await page.locator('#agent').fill('Priya');
await page.locator('#agent').dispatchEvent('change');
await page.locator('select[aria-label="Quick replies"]').selectOption({ index: 1 });
await page.getByRole('button', { name: 'Send' }).click();
await page.locator('.m.team').waitFor();
const reply = posts.find((p) => p.intent === 'reply');
check('reply is sent as Priya with the quick reply added', reply && reply.author === 'Priya' && reply.body === 'Hi, checking now.\nPlease refresh your store and check again.', JSON.stringify(reply));
check('the reply shows in the chat', (await page.locator('.m.team span').innerText()).includes('Priya'));

await page.getByRole('button', { name: 'Hand back to AI' }).click();
await page.getByRole('button', { name: 'Take over' }).waitFor();
check('hand back to BRIX AI', posts.some((p) => p.intent === 'update' && p.aiPaused === false));
await page.getByRole('button', { name: 'Close', exact: true }).click();
await page.getByRole('button', { name: 'Reopen' }).waitFor();
check('close the chat', posts.some((p) => p.intent === 'update' && p.status === 'closed'));
await page.screenshot({ path: path.join(shotDir, 'panel-inbox.png') });

await page.getByRole('button', { name: 'Settings' }).click();
await page.locator('#s-greeting').waitFor();
check('settings show the saved values', (await page.locator('#s-launcherText').inputValue()) === 'Need help setting up?' && (await page.locator('#s-quick').inputValue()).includes('Could you share a screenshot?'));
await page.locator('#s-greeting').fill('Hello from BRIX! How can we help?');
await page.locator('#s-aiEnabled').uncheck();
await page.locator('[data-day="0"]').check();
await page.getByRole('button', { name: 'Save settings' }).click();
await page.locator('#s-msg.ok').waitFor();
const saved = posts.find((p) => p.intent === 'settings')?.settings;
check('saving sends greeting, AI off and Sunday added', saved && saved.greeting === 'Hello from BRIX! How can we help?' && saved.aiEnabled === false && saved.officeHours.days.join() === '0,1,2,3,4,5,6', JSON.stringify(saved));
await page.screenshot({ path: path.join(shotDir, 'panel-settings.png') });
check('no page errors or blocked scripts', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed; screenshots in ${shotDir}`);
process.exit(failed ? 1 : 0);
