// Run with: node --import ./tests/packs/register.mjs --test tests/support-chat
// The BRIX support chat: settings, office hours, merchant messages, BRIX AI
// answering / handing to the team, and the team's replies, on a fake DB and
// a fake AI.
import test from 'node:test';
import assert from 'node:assert/strict';

const shared = await import('../../app/utils/support-chat.shared.js');
const chat = await import('../../app/services/support-chat.server.js');
const { sanitizeChatSettings, teamOnline, cleanMessage, DEFAULT_CHAT_SETTINGS } = shared;

// An in-memory stand-in for the three tables, for exactly the statements the service runs.
function fakeDb() {
  const t = { conv: [], msgs: [], settings: null };
  let convId = 0;
  let msgId = 0;
  const conv = (id) => t.conv.find((c) => c.id === Number(id));
  const waiting = (c) => c.status === 'open' && (c.needs_team === 1 || c.unread_team > 0);
  const db = {
    t,
    async execute(sql, p = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.startsWith('CREATE TABLE')) return [[]];
      if (s.startsWith('SELECT data FROM support_chat_settings')) return [t.settings ? [t.settings] : []];
      if (s.startsWith('INSERT INTO support_chat_settings')) { t.settings = { data: p[0] }; return [{ affectedRows: 1 }]; }
      if (s.startsWith('SELECT * FROM support_chat_conversations WHERE shop = ?')) return [t.conv.filter((c) => c.shop === p[0]).slice(0, 1)];
      if (s.startsWith('SELECT * FROM support_chat_conversations WHERE id = ?')) return [t.conv.filter((c) => c.id === Number(p[0]))];
      if (s.startsWith('INSERT IGNORE INTO support_chat_conversations')) {
        if (!t.conv.some((c) => c.shop === p[0])) t.conv.push({ id: ++convId, shop: p[0], status: p[1], needs_team: 0, ai_paused: 0, unread_team: 0, unread_merchant: 0, last_message_at: null, last_preview: '', context: null, context_at: null, created_at: p[2] });
        return [{ affectedRows: 1 }];
      }
      if (s.startsWith('INSERT INTO support_chat_messages')) {
        t.msgs.push({ id: ++msgId, conversation_id: p[0], sender: p[1], author: p[2], body: p[3], created_at: p[4] });
        return [{ insertId: msgId, affectedRows: 1 }];
      }
      if (s.startsWith('SELECT id, sender, author, body, created_at FROM support_chat_messages WHERE conversation_id = ? AND id > ?')) {
        return [t.msgs.filter((m) => m.conversation_id === p[0] && m.id > p[1])];
      }
      if (s.startsWith('SELECT id, sender, author, body, created_at FROM support_chat_messages WHERE conversation_id = ? ORDER BY id DESC')) {
        return [t.msgs.filter((m) => m.conversation_id === p[0]).reverse().slice(0, 150)];
      }
      if (s.startsWith('SELECT COUNT(*) AS n FROM support_chat_messages')) {
        return [[{ n: t.msgs.filter((m) => m.conversation_id === p[0] && m.sender === 'ai' && m.created_at >= p[1]).length }]];
      }
      if (s.startsWith('UPDATE support_chat_conversations SET last_message_at')) {
        const c = conv(p[4]);
        Object.assign(c, { last_message_at: p[0], last_preview: p[1], unread_team: c.unread_team + p[2], unread_merchant: c.unread_merchant + p[3] });
        if (s.includes("status = 'open'")) c.status = 'open';
        return [{ affectedRows: 1 }];
      }
      if (s.startsWith('UPDATE support_chat_conversations SET context')) { Object.assign(conv(p[2]), { context: p[0], context_at: p[1] }); return [{ affectedRows: 1 }]; }
      if (s.startsWith('UPDATE support_chat_conversations SET')) {
        const cols = s.slice('UPDATE support_chat_conversations SET '.length, s.indexOf(' WHERE id = ?')).split(', ').map((x) => x.replace(' = ?', ''));
        const c = conv(p[p.length - 1]);
        cols.forEach((col, i) => { c[col] = p[i]; });
        return [{ affectedRows: 1 }];
      }
      if (s.startsWith('SELECT COUNT(*) AS n FROM support_chat_conversations')) return [[{ n: t.conv.filter(waiting).length }]];
      if (s.startsWith('SELECT * FROM support_chat_conversations WHERE')) {
        let rows = t.conv;
        if (s.includes('needs_team = 1 OR unread_team > 0')) rows = rows.filter(waiting);
        else if (s.includes("status = 'open'")) rows = rows.filter((c) => c.status === 'open');
        else if (s.includes("status = 'closed'")) rows = rows.filter((c) => c.status === 'closed');
        if (s.includes('shop LIKE ?')) rows = rows.filter((c) => c.shop.includes(p[0].replace(/%/g, '')));
        return [rows];
      }
      throw new Error(`fake db: unexpected ${s.slice(0, 90)}`);
    },
  };
  return db;
}

// 2026-11-13 is a Friday; 06:00 UTC = 11:30 in India (office hours), 16:00 UTC = 21:30 (away).
const IN_HOURS = new Date('2026-11-13T06:00:00Z');
const AWAY = new Date('2026-11-13T16:00:00Z');
const deps = (db, llm, now = IN_HOURS) => ({ db, llm, now: () => now });
const SHOP = 'demo.myshopify.com';

test('settings: defaults, cleaned values, office hours', () => {
  const s = sanitizeChatSettings({ launcherText: '  ', aiDailyLimit: 9999, officeHours: { timeZone: 'Mars/Base', days: [1, 1, 9], from: '25:00' }, quickReplies: ['a', '', 'b'] });
  assert.equal(s.launcherText, DEFAULT_CHAT_SETTINGS.launcherText);
  assert.equal(s.aiDailyLimit, 500);
  assert.deepEqual(s.officeHours, { enabled: true, timeZone: 'Asia/Kolkata', days: [1], from: '10:00', to: '19:00' });
  assert.deepEqual(s.quickReplies, ['a', 'b']);
  const d = sanitizeChatSettings({});
  assert.equal(teamOnline(d, IN_HOURS), true, 'Friday 11:30 IST');
  assert.equal(teamOnline(d, AWAY), false, 'Friday 21:30 IST');
  assert.equal(teamOnline(d, new Date('2026-11-15T06:00:00Z')), false, 'Sunday');
  assert.equal(teamOnline(sanitizeChatSettings({ officeHours: { enabled: false } }), AWAY), true, 'office hours off = always');
  assert.equal(cleanMessage('  hi \r\n\r\n\r\n there  '), 'hi\n\nthere');
});

test('merchant writes, BRIX AI answers from the guide with the store context', async () => {
  const db = fakeDb();
  const prompts = [];
  const llm = async (messages) => { prompts.push(messages); return 'Go to Online Store > Themes > Customize > App embeds and switch on "Custom Cart Drawer".'; };
  const sent = await chat.merchantSend(SHOP, { body: 'The drawer does not show', context: { plan: 'starter', embed: 'off', page: '/app', features: { cart: true, cod: false } } }, deps(db, llm));
  assert.equal(sent.aiWillAnswer, true);
  const answer = await chat.aiAnswer(SHOP, deps(db, llm));
  assert.equal(answer.sender, 'ai');
  assert.match(prompts[0][0].content, /App embeds/);
  assert.match(prompts[0][0].content, /App embed: off/);
  assert.match(prompts[0][0].content, /Features on: cart/);
  assert.deepEqual(prompts[0].slice(1), [{ role: 'user', content: 'The drawer does not show' }]);
  const view = await chat.getMerchantChat(SHOP, {}, deps(db, llm));
  assert.deepEqual(view.messages.map((m) => m.sender), ['merchant', 'ai']);
  assert.equal(view.conversation.unread, 1);
  assert.equal(await chat.aiAnswer(SHOP, deps(db, llm)), null, 'nothing new to answer');
});

test('[TEAM], a failed model or the daily limit hands the chat to the team', async () => {
  for (const [name, llm, extra, now, expect] of [
    ['[TEAM]', async () => '[TEAM] Our team will check your billing.', {}, IN_HOURS, DEFAULT_CHAT_SETTINGS.handoffMessage],
    ['no answer', async () => null, {}, AWAY, DEFAULT_CHAT_SETTINGS.awayMessage],
    ['daily limit', async () => 'answer', { aiDailyLimit: 0 }, IN_HOURS, DEFAULT_CHAT_SETTINGS.handoffMessage],
  ]) {
    const db = fakeDb();
    if (Object.keys(extra).length) await chat.saveChatSettings(extra, deps(db, llm, now));
    await chat.merchantSend(SHOP, { body: 'Refund my plan' }, deps(db, llm, now));
    const note = await chat.aiAnswer(SHOP, deps(db, llm, now));
    assert.equal(note.sender, 'system', name);
    assert.equal(note.body, expect, name);
    const conv = await chat.findConversation(SHOP, deps(db, llm, now));
    assert.equal(conv.needsTeam, true, name);
    assert.equal(conv.aiPaused, true, name);
    const inbox = await chat.listConversations({ filter: 'waiting' }, deps(db, llm, now));
    assert.equal(inbox.waiting, 1, name);
  }
});

test('"Talk to a person" stops the AI; a team reply takes over and clears the waiting', async () => {
  const db = fakeDb();
  let calls = 0;
  const llm = async () => { calls += 1; return 'AI text'; };
  await chat.merchantSend(SHOP, { body: 'Hello' }, deps(db, llm));
  const note = await chat.merchantAskTeam(SHOP, deps(db, llm, AWAY));
  assert.equal(note.body, DEFAULT_CHAT_SETTINGS.awayMessage);
  assert.equal(await chat.aiAnswer(SHOP, deps(db, llm)), null);
  assert.equal(calls, 0);
  const conv = await chat.findConversation(SHOP, deps(db, llm));
  const reply = await chat.teamReply(conv.id, { body: 'Hi, Priya here. Let me check.', author: 'Priya' }, deps(db, llm));
  assert.equal(reply.author, 'Priya');
  const after = await chat.getConversation(conv.id, deps(db, llm));
  assert.equal(after.needsTeam, false);
  assert.equal(after.unreadTeam, 0);
  assert.equal(after.unreadMerchant, 2, 'the away note + the reply');
  assert.equal((await chat.listConversations({ filter: 'waiting' }, deps(db, llm))).waiting, 0);
  // Handing back to the AI lets it answer the next message.
  await chat.teamUpdate(conv.id, { aiPaused: false }, deps(db, llm));
  await chat.merchantSend(SHOP, { body: 'One more question' }, deps(db, llm));
  assert.equal((await chat.aiAnswer(SHOP, deps(db, llm))).sender, 'ai');
  // Closing takes it off the open list; a new merchant message reopens it.
  await chat.teamUpdate(conv.id, { status: 'closed' }, deps(db, llm));
  assert.equal((await chat.listConversations({ filter: 'open' }, deps(db, llm))).conversations.length, 0);
  await chat.merchantSend(SHOP, { body: 'Back again' }, deps(db, llm));
  assert.equal((await chat.findConversation(SHOP, deps(db, llm))).status, 'open');
});

test('refused: an empty message, the chat switched off; AI off = no AI answer', async () => {
  const db = fakeDb();
  const llm = async () => 'x';
  await assert.rejects(chat.merchantSend(SHOP, { body: '   ' }, deps(db, llm)), { code: 'empty' });
  await chat.saveChatSettings({ aiEnabled: false }, deps(db, llm));
  const sent = await chat.merchantSend(SHOP, { body: 'hi' }, deps(db, llm));
  assert.equal(sent.aiWillAnswer, false);
  assert.equal(await chat.aiAnswer(SHOP, deps(db, llm)), null);
  await chat.saveChatSettings({ enabled: false }, deps(db, llm));
  await assert.rejects(chat.merchantSend(SHOP, { body: 'hi' }, deps(db, llm)), { code: 'off' });
  const view = await chat.getMerchantChat('other.myshopify.com', {}, deps(db, llm));
  assert.equal(view.settings.enabled, false);
  assert.equal(view.conversation, null);
});
