// Run with: node tests/support-chat/widget-browser-check.mjs
// The support chat widget (components/support/SupportChat.jsx) in the real
// browser, bundled by the admin harness (tests/i18n/admin-harness, page=chat),
// with /api/support-chat mocked: launcher text, never opening by itself, the
// greeting, sending, BRIX AI's answer, "Talk to a person", the unread badge,
// switched off, phones.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.join(process.cwd(), 'tests', 'i18n', 'admin-harness');
const dist = path.join(os.tmpdir(), 'brix-i18n-admin-harness');
if (!process.env.SKIP_HARNESS_BUILD) execFileSync(process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', path.join(root, 'vite.config.mjs')], { stdio: 'ignore' });
const shotDir = path.join(os.tmpdir(), 'brix-support-chat');
fs.mkdirSync(shotDir, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch();

const SETTINGS = { enabled: true, launcherText: 'Need help setting up?', greeting: 'Hi! Do you need any help to set up BRIX?', teamName: 'BRIX Support', aiEnabled: true, online: true };

async function open({ settings = SETTINGS, conversation = null, messages = [], viewport = { width: 1280, height: 860 } } = {}) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const server = { settings, conversation, messages: [...messages], posts: [], nextId: 100 };
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/support-chat') {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        server.posts.push(body);
        if (body.intent === 'send') {
          const message = { id: ++server.nextId, sender: 'merchant', author: '', body: body.body, at: '2026-11-13 10:00:00' };
          server.messages.push(message);
          server.conversation = server.conversation || { id: 1, status: 'open', needsTeam: false, unread: 0 };
          // BRIX AI answers a moment later.
          setTimeout(() => server.messages.push({ id: ++server.nextId, sender: 'ai', author: 'BRIX AI', body: 'Turn on the app embed: Online Store > Themes > Customize > App embeds.', at: '2026-11-13 10:00:02' }), 600);
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, message, aiWillAnswer: true }) });
        }
        if (body.intent === 'team') {
          const message = { id: ++server.nextId, sender: 'system', author: 'BRIX Support', body: 'Got it. Someone from the BRIX team will reply here shortly.', at: '2026-11-13 10:01:00' };
          server.messages.push(message);
          server.conversation = { ...server.conversation, needsTeam: true };
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, message }) });
        }
        if (body.intent === 'read') { server.conversation = { ...server.conversation, unread: 0 }; }
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true }) });
      }
      const after = Number(url.searchParams.get('after')) || 0;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, settings: server.settings, conversation: server.conversation, messages: server.messages.filter((m) => m.id > after) }) });
    }
    if (url.pathname === '/brix-mark.png') return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join('public', 'brix-mark.png')) });
    if (url.host === 'harness.test') {
      const file = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ contentType: MIME[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://harness.test/?page=chat&lang=en');
  await page.waitForTimeout(1800); // the widget loads 1.2 s after the page
  return { page, errors, server };
}

// 1) A store that hasn't chatted: a chat-style bubble asks, nothing opens by itself.
{
  const { page, errors, server } = await open();
  const teaser = page.locator('.bxsc-teaser');
  const text = await teaser.innerText();
  check('chat bubble: team name, "Need help setting up?", the greeting, "Chat with us"', ['BRIX Support', 'Need help setting up?', 'Do you need any help to set up BRIX?', 'Chat with us'].every((w) => text.includes(w)), text.replace(/\s+/g, ' '));
  check('the chat window does not open by itself', (await page.locator('.bxsc').count()) === 0);
  const launcher = page.locator('.bxsc-launch.round');
  const box = await launcher.boundingBox();
  const tbox = await teaser.boundingBox();
  check('round chat button in the bottom-right corner, above the Sidekick strip, the bubble above it', box && box.x + box.width > 1200 && box.y + box.height <= 860 - 80 + 1 && tbox && tbox.y + tbox.height <= box.y, JSON.stringify({ box, tbox }));
  await page.screenshot({ path: path.join(shotDir, 'desktop-bubble.png') });
  await page.getByRole('button', { name: 'Chat with us' }).click();
  await page.locator('.bxsc').waitFor();
  check('opens with the team name and the greeting', (await page.locator('.bxsc-head').innerText()).includes('BRIX Support') && (await page.locator('.bxsc-body').innerText()).includes('Do you need any help to set up BRIX?'));
  check('chat window is masked from Clarity', (await page.locator('.bxsc').getAttribute('data-clarity-mask')) === 'true');
  await page.locator('.bxsc textarea').fill('The drawer does not show on my store');
  await page.keyboard.press('Enter');
  await page.locator('.bxsc-msg.me').waitFor();
  const sent = server.posts.find((p) => p.intent === 'send');
  check('Enter sends the message with the page it was sent from', sent && sent.body === 'The drawer does not show on my store' && sent.page === '/app/chat' && ['on', 'off'].includes(sent.embed), JSON.stringify(sent));
  check('"BRIX AI is typing…" while it answers', (await page.locator('.bxsc-typing').count()) === 1);
  await page.locator('.bxsc-msg.them p', { hasText: 'Turn on the app embed' }).waitFor({ timeout: 8000 });
  check('BRIX AI\'s answer arrives (polled)', (await page.locator('.bxsc-typing').count()) === 0);
  await page.screenshot({ path: path.join(shotDir, 'desktop-chat.png') });
  await page.getByRole('button', { name: 'Talk to a person' }).click();
  await page.locator('.bxsc-note').waitFor();
  check('"Talk to a person" hands over and says the team will reply', server.posts.some((p) => p.intent === 'team') && (await page.locator('.bxsc-note').innerText()).includes('BRIX team will reply'));
  check('"Talk to a person" is gone once asked', (await page.getByRole('button', { name: 'Talk to a person' }).count()) === 0);
  await page.keyboard.press('Escape');
  check('Escape closes it; no bubble once the store has chatted, just the round button', (await page.locator('.bxsc').count()) === 0 && (await page.locator('.bxsc-launch.round').count()) === 1 && (await page.locator('.bxsc-teaser').count()) === 0);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

// 1b) The bubble's × hides it for good (this browser); the round button stays.
{
  const { page, errors } = await open();
  await page.getByRole('button', { name: 'Hide this message' }).click();
  check('× hides the bubble, the round button stays, the chat stays closed', (await page.locator('.bxsc-teaser').count()) === 0 && (await page.locator('.bxsc-launch.round').count()) === 1 && (await page.locator('.bxsc').count()) === 0);
  await page.reload();
  await page.waitForTimeout(1800);
  check('after a reload the bubble stays hidden', (await page.locator('.bxsc-teaser').count()) === 0 && (await page.locator('.bxsc-launch.round').count()) === 1);
  check('no page errors (×)', errors.length === 0, errors.join(' | '));
  await page.close();
}

// 2) A store with a team reply it hasn't read: round launcher with the count, read on open.
{
  const { page, errors, server } = await open({
    conversation: { id: 1, status: 'open', needsTeam: false, unread: 2 },
    messages: [
      { id: 1, sender: 'merchant', author: '', body: 'COD button missing', at: '2026-11-13 09:00:00' },
      { id: 2, sender: 'team', author: 'Priya', body: 'Hi, I fixed it. Please refresh.', at: '2026-11-13 09:10:00' },
    ],
  });
  check('unread badge shows 2', (await page.locator('.bxsc-badge').innerText()).trim() === '2');
  await page.locator('.bxsc-launch').click();
  await page.locator('.bxsc-msg.team').waitFor();
  check('team replies show the person\'s name', (await page.locator('.bxsc-msg.team span').innerText()).includes('Priya'));
  await page.waitForTimeout(300);
  check('opening marks it read', server.posts.some((p) => p.intent === 'read'));
  check('no page errors (unread)', errors.length === 0, errors.join(' | '));
  await page.close();
}

// 3) Chat switched off in the panel: nothing at all.
{
  const { page, errors } = await open({ settings: { ...SETTINGS, enabled: false } });
  check('switched off: no launcher', (await page.locator('.bxsc-launch').count()) === 0);
  check('no page errors (off)', errors.length === 0, errors.join(' | '));
  await page.close();
}

// 4) Phones: the chat fills the screen with a small margin.
{
  const { page, errors } = await open({ viewport: { width: 390, height: 844 } });
  const tb = await page.locator('.bxsc-teaser').boundingBox();
  check('phone: the bubble fits the screen', tb && tb.x >= 12 && tb.x + tb.width <= 390 - 11, JSON.stringify(tb));
  await page.screenshot({ path: path.join(shotDir, 'phone-bubble.png') });
  await page.locator('.bxsc-launch').click();
  await page.locator('.bxsc').waitFor();
  const box = await page.locator('.bxsc').boundingBox();
  check('phone: chat fills the width with an 8px margin', box && Math.round(box.x) === 8 && Math.round(box.width) === 374, JSON.stringify(box));
  await page.screenshot({ path: path.join(shotDir, 'phone-chat.png') });
  check('no page errors (phone)', errors.length === 0, errors.join(' | '));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed; screenshots in ${shotDir}`);
process.exit(failed ? 1 : 0);
