/**
 * BRIX support chat (utils/support-chat.shared.js): one conversation per
 * store, its messages, and the chat settings, in MySQL (db_proxy.php; tables
 * made on first use). Merchants write from the widget (routes/api.support-chat.jsx),
 * BRIX AI answers first (aiAnswer, run after the response), and the team
 * answers from /internal/chat (routes/internal.chat*.jsx). A team reply, or
 * the merchant asking for a person, stops the AI in that chat.
 *
 * Every function takes `deps` ({ db, llm, now }) so the tests can run it on
 * fakes.
 */
import { getDb } from './db.server';
import { callLlm } from './ai-llm.server';
import { SUPPORT_GUIDE } from './support-chat-knowledge';
import {
  DEFAULT_CHAT_SETTINGS, cleanMessage, publicChatSettings, sanitizeChatSettings, teamOnline,
} from '../utils/support-chat.shared.js';

export const AI_AUTHOR = 'BRIX AI';
const TEAM_MARK = /^\s*\[TEAM\]\s*/i;
const SETTINGS_TTL_MS = 20_000;
const CONTEXT_TTL_MS = 10 * 60_000;

const sqlTime = (d) => new Date(d).toISOString().slice(0, 19).replace('T', ' ');
const resolve = (deps = {}) => ({ db: deps.db || getDb(), llm: deps.llm || callLlm, now: deps.now || (() => new Date()) });

const ensured = new WeakSet();
async function ensureTables(db) {
  if (ensured.has(db)) return;
  await db.execute(`CREATE TABLE IF NOT EXISTS support_chat_conversations (
    id INT NOT NULL AUTO_INCREMENT,
    shop VARCHAR(255) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'open',
    needs_team TINYINT(1) NOT NULL DEFAULT 0,
    ai_paused TINYINT(1) NOT NULL DEFAULT 0,
    unread_team INT NOT NULL DEFAULT 0,
    unread_merchant INT NOT NULL DEFAULT 0,
    last_message_at DATETIME NULL,
    last_preview VARCHAR(200) NOT NULL DEFAULT '',
    context MEDIUMTEXT NULL,
    context_at DATETIME NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_shop (shop),
    KEY idx_last (last_message_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.execute(`CREATE TABLE IF NOT EXISTS support_chat_messages (
    id BIGINT NOT NULL AUTO_INCREMENT,
    conversation_id INT NOT NULL,
    sender VARCHAR(10) NOT NULL,
    author VARCHAR(80) NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    created_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    KEY idx_conv (conversation_id, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.execute(`CREATE TABLE IF NOT EXISTS support_chat_settings (
    id TINYINT NOT NULL,
    data MEDIUMTEXT NOT NULL,
    updated_at DATETIME NOT NULL,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  ensured.add(db);
}

const rowsOf = (result) => (Array.isArray(result?.[0]) ? result[0] : []);
const parse = (json, fallback) => { try { return json ? JSON.parse(json) : fallback; } catch { return fallback; } };

/* ---------- settings ---------- */

const settingsCache = new WeakMap();
export async function getChatSettings(deps) {
  const { db, now } = resolve(deps);
  const hit = settingsCache.get(db);
  if (hit && now().getTime() - hit.at < SETTINGS_TTL_MS) return hit.value;
  await ensureTables(db);
  const row = rowsOf(await db.execute('SELECT data FROM support_chat_settings WHERE id = 1'))[0];
  const value = sanitizeChatSettings(parse(row?.data, {}), DEFAULT_CHAT_SETTINGS);
  settingsCache.set(db, { at: now().getTime(), value });
  return value;
}

export async function saveChatSettings(patch, deps) {
  const { db, now } = resolve(deps);
  const value = sanitizeChatSettings(patch, await getChatSettings(deps));
  await db.execute(
    'INSERT INTO support_chat_settings (id, data, updated_at) VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at)',
    [JSON.stringify(value), sqlTime(now())],
  );
  settingsCache.set(db, { at: now().getTime(), value });
  return value;
}

/* ---------- conversations and messages ---------- */

function conversationOut(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    shop: row.shop,
    status: row.status === 'closed' ? 'closed' : 'open',
    needsTeam: Boolean(Number(row.needs_team)),
    aiPaused: Boolean(Number(row.ai_paused)),
    unreadTeam: Number(row.unread_team) || 0,
    unreadMerchant: Number(row.unread_merchant) || 0,
    lastMessageAt: row.last_message_at ? String(row.last_message_at) : null,
    lastPreview: row.last_preview || '',
    context: parse(row.context, {}),
    contextAt: row.context_at ? String(row.context_at) : null,
  };
}

const messageOut = (row) => ({ id: Number(row.id), sender: row.sender, author: row.author || '', body: row.body, at: String(row.created_at) });

export async function findConversation(shop, deps) {
  const { db } = resolve(deps);
  await ensureTables(db);
  return conversationOut(rowsOf(await db.execute('SELECT * FROM support_chat_conversations WHERE shop = ? LIMIT 1', [shop]))[0]);
}

export async function getConversation(id, deps) {
  const { db } = resolve(deps);
  await ensureTables(db);
  return conversationOut(rowsOf(await db.execute('SELECT * FROM support_chat_conversations WHERE id = ? LIMIT 1', [Number(id)]))[0]);
}

async function ensureConversation(shop, deps) {
  const { db, now } = resolve(deps);
  const found = await findConversation(shop, deps);
  if (found) return found;
  await db.execute('INSERT IGNORE INTO support_chat_conversations (shop, status, created_at) VALUES (?, ?, ?)', [shop, 'open', sqlTime(now())]);
  return findConversation(shop, deps);
}

/** Messages after `after` (id), oldest first; the newest 150 when after = 0. */
export async function listMessages(conversationId, { after = 0 } = {}, deps) {
  const { db } = resolve(deps);
  await ensureTables(db);
  const from = Number(after) || 0;
  if (from > 0) {
    return rowsOf(await db.execute(
      'SELECT id, sender, author, body, created_at FROM support_chat_messages WHERE conversation_id = ? AND id > ? ORDER BY id ASC LIMIT 200',
      [conversationId, from],
    )).map(messageOut);
  }
  return rowsOf(await db.execute(
    'SELECT id, sender, author, body, created_at FROM support_chat_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 150',
    [conversationId],
  )).map(messageOut).reverse();
}

async function addMessage(conv, sender, body, author, deps) {
  const { db, now } = resolve(deps);
  const at = sqlTime(now());
  const [res] = await db.execute(
    'INSERT INTO support_chat_messages (conversation_id, sender, author, body, created_at) VALUES (?, ?, ?, ?, ?)',
    [conv.id, sender, author || '', body, at],
  );
  const fromMerchant = sender === 'merchant';
  await db.execute(
    `UPDATE support_chat_conversations SET last_message_at = ?, last_preview = ?,
      unread_team = unread_team + ?, unread_merchant = unread_merchant + ?${fromMerchant ? ", status = 'open'" : ''}
     WHERE id = ?`,
    [at, body.slice(0, 200), fromMerchant ? 1 : 0, fromMerchant ? 0 : 1, conv.id],
  );
  return { id: Number(res?.insertId) || null, sender, author: author || '', body, at };
}

async function setFlags(id, flags, deps) {
  const { db } = resolve(deps);
  const cols = { needsTeam: 'needs_team', aiPaused: 'ai_paused', unreadTeam: 'unread_team', unreadMerchant: 'unread_merchant', status: 'status' };
  const sets = [];
  const values = [];
  for (const [key, col] of Object.entries(cols)) {
    if (!(key in flags)) continue;
    sets.push(`${col} = ?`);
    values.push(typeof flags[key] === 'boolean' ? (flags[key] ? 1 : 0) : flags[key]);
  }
  if (!sets.length) return;
  await db.execute(`UPDATE support_chat_conversations SET ${sets.join(', ')} WHERE id = ?`, [...values, Number(id)]);
}

/* ---------- merchant side ---------- */

/** The widget's view: public settings, the chat (null before the first message) and messages after `after`. */
export async function getMerchantChat(shop, { after = 0 } = {}, deps) {
  const { now } = resolve(deps);
  const settings = await getChatSettings(deps);
  const conv = await findConversation(shop, deps);
  return {
    settings: publicChatSettings(settings, now()),
    conversation: conv ? { id: conv.id, status: conv.status, needsTeam: conv.needsTeam, unread: conv.unreadMerchant } : null,
    messages: conv ? await listMessages(conv.id, { after }, deps) : [],
  };
}

/** Does the store context need gathering again (none yet, or older than 10 minutes)? */
export async function contextIsStale(shop, deps) {
  const { now } = resolve(deps);
  const conv = await findConversation(shop, deps);
  if (!conv?.contextAt) return true;
  return now().getTime() - Date.parse(`${conv.contextAt.replace(' ', 'T')}Z`) > CONTEXT_TTL_MS;
}

/**
 * The merchant's message. `context` (optional) = what the team sees about the
 * store (plan, page, app embed, features on...). Returns { message, aiWillAnswer }.
 */
export async function merchantSend(shop, { body, context = null } = {}, deps) {
  const { db, now } = resolve(deps);
  const text = cleanMessage(body);
  if (!text) throw Object.assign(new Error('Write a message first.'), { code: 'empty' });
  const settings = await getChatSettings(deps);
  if (!settings.enabled) throw Object.assign(new Error('Chat is switched off.'), { code: 'off' });
  const conv = await ensureConversation(shop, deps);
  if (context && typeof context === 'object') {
    await db.execute('UPDATE support_chat_conversations SET context = ?, context_at = ? WHERE id = ?', [JSON.stringify(context).slice(0, 20000), sqlTime(now()), conv.id]);
  }
  const message = await addMessage(conv, 'merchant', text, '', deps);
  return { message, aiWillAnswer: settings.aiEnabled && !conv.aiPaused };
}

export async function merchantMarkRead(shop, deps) {
  const conv = await findConversation(shop, deps);
  if (conv?.unreadMerchant) await setFlags(conv.id, { unreadMerchant: 0 }, deps);
}

/** "Talk to a person": the AI stops in this chat and the team is asked to answer. */
export async function merchantAskTeam(shop, deps) {
  const { now } = resolve(deps);
  const settings = await getChatSettings(deps);
  const conv = await ensureConversation(shop, deps);
  await setFlags(conv.id, { needsTeam: true, aiPaused: true, status: 'open' }, deps);
  return addMessage(conv, 'system', teamOnline(settings, now()) ? settings.handoffMessage : settings.awayMessage, settings.teamName, deps);
}

/* ---------- BRIX AI ---------- */

/** One line per fact the team gathered about the store, for the AI's context. */
export function contextSummary(context = {}) {
  const c = context || {};
  const on = c.features ? Object.entries(c.features).filter(([, v]) => v === true).map(([k]) => k) : [];
  return [
    c.plan ? `Plan: ${c.plan}` : null,
    c.embed ? `App embed: ${c.embed}` : null,
    c.features ? `Features on: ${on.length ? on.join(', ') : 'none'}` : null,
    c.page ? `Page open in BRIX: ${c.page}` : null,
  ].filter(Boolean).join('\n');
}

export function buildAiPrompt(messages, context) {
  const system = `You are BRIX AI, the support assistant inside the BRIX Shopify app, chatting with a store owner.
Answer only from the BRIX guide below. Be short (under 120 words), friendly and plain: no markdown headings, numbered steps when there are steps.
Reply in the language the merchant writes in.
If the guide does not answer it, if the merchant wants a person, or for bugs, errors, billing, refunds or anything about their own orders, reply with [TEAM] followed by one short sentence saying the team will help. Never guess or promise anything the guide doesn't say.

BRIX guide:
${SUPPORT_GUIDE}
${contextSummary(context) ? `\nAbout this store:\n${contextSummary(context)}` : ''}`;
  const turns = messages
    .filter((m) => m.sender === 'merchant' || m.sender === 'ai' || m.sender === 'team')
    .slice(-12)
    .map((m) => ({ role: m.sender === 'merchant' ? 'user' : 'assistant', content: m.body }));
  return [{ role: 'system', content: system }, ...turns];
}

async function aiAnswersToday(conv, deps) {
  const { db, now } = resolve(deps);
  const start = new Date(now());
  start.setUTCHours(0, 0, 0, 0);
  const row = rowsOf(await db.execute(
    "SELECT COUNT(*) AS n FROM support_chat_messages WHERE conversation_id = ? AND sender = 'ai' AND created_at >= ?",
    [conv.id, sqlTime(start)],
  ))[0];
  return Number(row?.n) || 0;
}

/**
 * Answer the merchant's newest message with BRIX AI (run after the response).
 * Does nothing when AI is off, the chat was handed to the team, or the newest
 * message isn't the merchant's. Out of answers for today, no answer from the
 * model, or [TEAM] = the chat goes to the team with the handoff / away message.
 */
export async function aiAnswer(shop, deps) {
  const { llm, now } = resolve(deps);
  const settings = await getChatSettings(deps);
  const conv = await findConversation(shop, deps);
  if (!conv || !settings.aiEnabled || conv.aiPaused) return null;
  const messages = await listMessages(conv.id, {}, deps);
  if (messages[messages.length - 1]?.sender !== 'merchant') return null;

  const handOff = async () => {
    await setFlags(conv.id, { needsTeam: true, aiPaused: true }, deps);
    return addMessage(conv, 'system', teamOnline(settings, now()) ? settings.handoffMessage : settings.awayMessage, settings.teamName, deps);
  };
  if ((await aiAnswersToday(conv, deps)) >= settings.aiDailyLimit) return handOff();

  let reply = null;
  try {
    reply = await llm(buildAiPrompt(messages, conv.context), { maxTokens: 400, temperature: 0.2, timeoutMs: 25_000 });
  } catch (e) {
    console.error('[support-chat] AI answer failed:', e.message);
  }
  // A team reply or "talk to a person" may have come in while the model was thinking.
  const fresh = await getConversation(conv.id, deps);
  if (!fresh || fresh.aiPaused) return null;
  const text = cleanMessage(reply);
  if (!text || TEAM_MARK.test(text)) return handOff();
  return addMessage(conv, 'ai', text, AI_AUTHOR, deps);
}

/* ---------- team side (/internal/chat) ---------- */

const FILTERS = {
  waiting: "status = 'open' AND (needs_team = 1 OR unread_team > 0)",
  open: "status = 'open'",
  closed: "status = 'closed'",
  all: '1 = 1',
};

/** Conversations for the panel, newest first; `q` matches the store domain or name. */
export async function listConversations({ filter = 'waiting', q = '' } = {}, deps) {
  const { db } = resolve(deps);
  await ensureTables(db);
  const where = [FILTERS[filter] || FILTERS.waiting];
  const params = [];
  const search = String(q || '').trim().slice(0, 80);
  if (search) { where.push('(shop LIKE ? OR context LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  const rows = rowsOf(await db.execute(
    `SELECT * FROM support_chat_conversations WHERE ${where.join(' AND ')} ORDER BY last_message_at IS NULL, last_message_at DESC LIMIT 200`,
    params,
  ));
  const waiting = rowsOf(await db.execute(`SELECT COUNT(*) AS n FROM support_chat_conversations WHERE ${FILTERS.waiting}`))[0];
  return { conversations: rows.map(conversationOut), waiting: Number(waiting?.n) || 0 };
}

/** A team reply: posted as `author`, the AI stops in this chat, read by the team. */
export async function teamReply(id, { body, author }, deps) {
  const conv = await getConversation(id, deps);
  if (!conv) throw Object.assign(new Error('Chat not found.'), { code: 'not_found' });
  const text = cleanMessage(body);
  if (!text) throw Object.assign(new Error('Write a reply first.'), { code: 'empty' });
  const message = await addMessage(conv, 'team', text, String(author || 'BRIX team').trim().slice(0, 80) || 'BRIX team', deps);
  await setFlags(conv.id, { aiPaused: true, needsTeam: false, unreadTeam: 0, status: 'open' }, deps);
  return message;
}

/** Close / reopen, hand back to the AI (aiPaused false) or take over, mark read. */
export async function teamUpdate(id, { status, aiPaused, read } = {}, deps) {
  const flags = {};
  if (status === 'open' || status === 'closed') flags.status = status;
  if (status === 'closed') flags.needsTeam = false;
  if (typeof aiPaused === 'boolean') flags.aiPaused = aiPaused;
  if (aiPaused === false) flags.needsTeam = false;
  if (read) flags.unreadTeam = 0;
  await setFlags(Number(id), flags, deps);
  return getConversation(id, deps);
}
