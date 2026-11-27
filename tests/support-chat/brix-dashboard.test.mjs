// Run with: node --import ./tests/packs/register.mjs --test tests/support-chat
// The support chat and the Brix Partner Dashboard (services/brix-dashboard.server.js):
// chats handed to the team become dashboard tickets, and the dashboard's
// signed webhook brings the team's replies back. Fake DB, fake AI, fake
// forward / fetch: nothing leaves the machine.
/* global process, globalThis */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const chat = await import('../../app/services/support-chat.server.js');
const dash = await import('../../app/services/brix-dashboard.server.js');
const { fakeDb } = await import('./fake-db.mjs');

const SHOP = 'demo.myshopify.com';
const NOW = new Date('2026-11-13T06:00:00Z'); // a Friday, in office hours
const SECRET = 'test-webhook-secret-0123456789';

// deps with a forward that records each call instead of posting to the dashboard.
function setup(llm = async () => 'AI answer') {
  const db = fakeDb();
  const sent = [];
  const deps = { db, llm, now: () => NOW, forward: async (conv, message) => { sent.push({ conv, message }); return true; } };
  return { db, sent, deps };
}

const sign = (raw, secret = SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
// The dashboard's shape: body { id, event, created_at, data }, id = the X-Brix-Delivery UUID.
const event = (event, data, id = crypto.randomUUID()) => JSON.stringify({ id, event, created_at: NOW.toISOString(), data });
const idOf = (raw) => JSON.parse(raw).id;
// A visible team reply: message { id, from, author: { name, email }, body, created_at }.
const replied = (conversationId, { body, name = 'Asha', from = 'team' }) => event('ticket.replied', {
  ticket: { conversation_id: conversationId },
  message: { id: crypto.randomUUID(), from, author: { name, email: `${name.toLowerCase()}@thebrix.test` }, body, created_at: NOW.toISOString() },
});
const statusChanged = (conversationId, from, to) => event('ticket.status_changed', { ticket: { conversation_id: conversationId }, from, to });

test('hand-off by BRIX AI sends the transcript once; later merchant messages are forwarded', async () => {
  const { sent, deps } = setup(async () => '[TEAM] The team will help with billing.');
  const first = await chat.merchantSend(SHOP, { body: 'Why was I charged twice?', context: { name: 'Demo Store', owner: 'Priya', email: 'p@demo.test' } }, deps);
  assert.equal(first.aiWillAnswer, true);
  assert.equal(sent.length, 0, 'the AI has it: nothing goes to the dashboard yet');

  await chat.aiAnswer(SHOP, deps); // [TEAM] = hand to the team
  assert.equal(sent.length, 1);
  assert.match(sent[0].message, /^Merchant: Why was I charged twice\?/);
  assert.match(sent[0].message, /Note: /, 'the hand-over note is in the transcript');
  assert.equal(sent[0].conv.shop, SHOP);
  assert.equal(sent[0].conv.context.owner, 'Priya', 'the ticket gets the store details');

  const later = await chat.merchantSend(SHOP, { body: 'It was order #1042' }, deps);
  assert.equal(later.aiWillAnswer, false);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].message, 'It was order #1042', 'a single message, not the transcript again');

  // "Talk to a person" on a chat the team already has sends nothing new.
  await chat.merchantAskTeam(SHOP, deps);
  assert.equal(sent.length, 2);
});

test('"Talk to a person" sends the transcript once, pressing it again does not', async () => {
  const { sent, deps } = setup();
  await chat.merchantSend(SHOP, { body: 'Hello' }, deps);
  await chat.aiAnswer(SHOP, deps);
  await chat.merchantAskTeam(SHOP, deps);
  assert.equal(sent.length, 1);
  assert.match(sent[0].message, /^Merchant: Hello\n\nBRIX AI: AI answer\n\nNote: /);
  await chat.merchantAskTeam(SHOP, deps);
  assert.equal(sent.length, 1);
});

test('chats BRIX AI answers never reach the dashboard', async () => {
  const { sent, deps } = setup();
  for (const body of ['How do I add a free gift?', 'And change its colour?']) {
    await chat.merchantSend(SHOP, { body }, deps);
    assert.equal((await chat.aiAnswer(SHOP, deps)).sender, 'ai');
  }
  assert.equal(sent.length, 0);
});

test('AI off: every merchant message goes to the dashboard', async () => {
  const { sent, deps } = setup();
  await chat.saveChatSettings({ aiEnabled: false }, deps);
  await chat.merchantSend(SHOP, { body: 'one' }, deps);
  await chat.merchantSend(SHOP, { body: 'two' }, deps);
  assert.deepEqual(sent.map((s) => s.message), ['one', 'two']);
});

test('after "Hand back to AI", the next hand-off sends only what came after the team reply', async () => {
  const { sent, deps } = setup();
  await chat.merchantSend(SHOP, { body: 'First question' }, deps);
  await chat.merchantAskTeam(SHOP, deps);
  const conv = await chat.findConversation(SHOP, deps);
  await chat.teamReply(conv.id, { body: 'Sorted it for you.', author: 'Asha' }, deps);
  await chat.teamUpdate(conv.id, { aiPaused: false }, deps);
  await chat.merchantSend(SHOP, { body: 'Second question' }, deps);
  await chat.aiAnswer(SHOP, deps);
  await chat.merchantAskTeam(SHOP, deps);
  assert.equal(sent.length, 2);
  assert.doesNotMatch(sent[1].message, /First question|Sorted it/);
  assert.match(sent[1].message, /^Merchant: Second question\n\nBRIX AI: AI answer\n\nNote: /);
});

test('forwardChat: posts the ticket with the key; off without a key; never throws', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  try {
    delete process.env.BRIX_DASHBOARD_KEY;
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response('{}', { status: 201 }); };
    assert.equal(await dash.forwardChat({ id: 7, shop: SHOP }, 'hi'), false);
    assert.equal(calls.length, 0);

    process.env.BRIX_DASHBOARD_KEY = 'bpd_test';
    process.env.BRIX_DASHBOARD_URL = 'https://dash.example.test/';
    const conv = { id: 7, shop: SHOP, context: { name: 'Demo Store', owner: 'Priya', email: 'p@demo.test' } };
    assert.equal(await dash.forwardChat(conv, 'hi there'), true);
    assert.equal(calls[0].url, 'https://dash.example.test/api/tickets');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer bpd_test');
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(
      { ...body },
      { conversation_id: 'cartninja-chat-7', message: 'hi there', subject: 'Chat: Demo Store', name: 'Priya', email: 'p@demo.test', shop_domain: SHOP, app: 'Cart Ninja' },
    );
    assert.equal(await dash.forwardChat(conv, '   '), false, 'empty message: nothing sent');

    globalThis.fetch = async () => { throw new Error('network down'); };
    assert.equal(await dash.forwardChat(conv, 'hi'), false);
    globalThis.fetch = async () => new Response('nope', { status: 500 });
    assert.equal(await dash.forwardChat(conv, 'hi'), false);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.BRIX_DASHBOARD_KEY;
    delete process.env.BRIX_DASHBOARD_URL;
  }
});

test('chat ids: only this app\'s conversations', () => {
  assert.equal(dash.conversationRef(12), 'cartninja-chat-12');
  assert.equal(dash.chatIdFrom('cartninja-chat-12'), 12);
  for (const ref of ['tryon-chat-1', 'cartninja-chat-', 'cartninja-chat-1x', 'x-cartninja-chat-1', null]) {
    assert.equal(dash.chatIdFrom(ref), null, String(ref));
  }
});

test('webhook: a bad, missing or unsigned signature is refused', async () => {
  const { db, deps } = setup();
  await chat.merchantSend(SHOP, { body: 'hi' }, deps);
  const raw = replied('cartninja-chat-1', { body: 'Team here' });
  process.env.BRIX_DASHBOARD_WEBHOOK_SECRET = SECRET;
  try {
    for (const sig of [sign(raw, 'wrong-secret'), null, 'sha256=abc', sign(`${raw} `)]) {
      const res = await dash.handleDashboardWebhook(raw, sig, { deps });
      assert.equal(res.status, 401, String(sig));
    }
    delete process.env.BRIX_DASHBOARD_WEBHOOK_SECRET;
    assert.equal((await dash.handleDashboardWebhook(raw, sign(raw), { deps })).status, 401, 'no secret set = refuse everything');
    assert.equal(db.t.msgs.filter((m) => m.sender === 'team').length, 0);
  } finally {
    delete process.env.BRIX_DASHBOARD_WEBHOOK_SECRET;
  }
});

test('webhook: posts the team reply, closes and reopens, ignores other apps and repeats', async () => {
  const { db, deps } = setup();
  await chat.merchantSend(SHOP, { body: 'Help please' }, deps);
  await chat.merchantAskTeam(SHOP, deps);
  const conv = await chat.findConversation(SHOP, deps);
  const ref = dash.conversationRef(conv.id);
  // As the route calls it: X-Brix-Delivery = the body's id.
  const deliver = (raw, deliveryId = idOf(raw)) => dash.handleDashboardWebhook(raw, sign(raw), { deliveryId, deps });
  const teamMsgs = () => db.t.msgs.filter((m) => m.sender === 'team');
  process.env.BRIX_DASHBOARD_WEBHOOK_SECRET = SECRET;
  try {
    // A reply goes into the chat under the agent's name; the chat stops waiting.
    const reply = replied(ref, { body: 'Hi, Asha here. Checking now.' });
    assert.deepEqual(await deliver(reply), { status: 200, body: { ok: true } });
    assert.equal(teamMsgs().length, 1);
    assert.equal(teamMsgs()[0].author, 'Asha');
    assert.equal(teamMsgs()[0].body, 'Hi, Asha here. Checking now.');
    let now = await chat.getConversation(conv.id, deps);
    assert.equal(now.needsTeam, false);
    assert.equal(now.aiPaused, true);
    assert.equal(now.unreadMerchant >= 1, true, 'the merchant sees an unread reply');

    // The same delivery again (a retry) is not posted twice.
    assert.equal((await deliver(reply)).body.ignored, 'repeat');
    assert.equal(teamMsgs().length, 1);
    // A second reply (a new delivery) is posted.
    await deliver(replied(ref, { body: 'Done!' }));
    assert.equal(teamMsgs().length, 2);
    // Without a delivery id, nothing is mistaken for a repeat.
    const noId = (raw) => dash.handleDashboardWebhook(raw, sign(raw), { deps });
    await noId(JSON.stringify({ event: 'ticket.replied', data: JSON.parse(replied(ref, { body: 'No id one' })).data }));
    await noId(JSON.stringify({ event: 'ticket.replied', data: JSON.parse(replied(ref, { body: 'No id two' })).data }));
    assert.equal(teamMsgs().length, 4);

    // Safety net: a reply not from the team stays out of the chat.
    assert.equal((await deliver(replied(ref, { body: 'Help please', name: 'Priya', from: 'merchant' }))).body.ignored, 'not_a_team_reply');
    const noFrom = JSON.parse(replied(ref, { body: 'Who sent this?' }));
    delete noFrom.data.message.from;
    assert.equal((await deliver(JSON.stringify(noFrom))).body.ignored, 'not_a_team_reply');
    assert.equal(teamMsgs().length, 4);

    // Resolved = closed; out of resolved = open again; other status moves do nothing.
    await deliver(statusChanged(ref, 'open', 'resolved'));
    now = await chat.getConversation(conv.id, deps);
    assert.equal(now.status, 'closed');
    assert.equal(now.unreadTeam, 0);
    assert.equal((await deliver(statusChanged(ref, 'open', 'pending'))).body.ignored, 'event');
    await deliver(statusChanged(ref, 'resolved', 'open'));
    assert.equal((await chat.getConversation(conv.id, deps)).status, 'open');

    // Another app's chat, an unknown event, a chat that is gone: 200, nothing changes.
    const before = db.t.msgs.length;
    assert.equal((await deliver(replied('tryon-chat-1', { body: 'Not ours' }))).body.ignored, 'other_app');
    assert.equal((await deliver(event('ticket.message_received', { ticket: { conversation_id: ref }, message: { from: 'merchant', body: 'x' } }))).body.ignored, 'event');
    const gone = await deliver(replied('cartninja-chat-999', { body: 'Hello?' }));
    assert.deepEqual(gone, { status: 200, body: { ok: true, ignored: 'not_found' } });
    assert.equal(db.t.msgs.length, before);
    assert.equal((await dash.handleDashboardWebhook('{not json', sign('{not json'), { deps })).status, 400);
  } finally {
    delete process.env.BRIX_DASHBOARD_WEBHOOK_SECRET;
  }
});

test('/internal/chat says to answer in the dashboard', async () => {
  const { supportChatPanel } = await import('../../app/utils/support-chat-panel.js');
  assert.match(supportChatPanel('n0nce'), /<p class="dash-notice"[^>]*>Answer chats in the Brix Partner Dashboard → Tickets; replies here don't reach the ticket\.<\/p>/);
});

test('the webhook route needs no Shopify session', () => {
  const src = readFileSync('app/routes/api.brix-dashboard.jsx', 'utf8');
  assert.doesNotMatch(src, /authenticate|shopify\.server/);
  assert.match(src, /handleDashboardWebhook\(raw, request\.headers\.get\('x-brix-signature'\)/);
  assert.match(src, /deliveryId: request\.headers\.get\('x-brix-delivery'\)/);
});
