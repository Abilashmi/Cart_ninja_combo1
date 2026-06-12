let pool = null;

function getPool() {
  if (!pool) {
    const mysql = require('mysql2/promise');
    pool = mysql.createPool({
      host: process.env.AI_DB_HOST || '127.0.0.1',
      user: process.env.AI_DB_USER || 'root',
      password: process.env.AI_DB_PASS || '',
      database: process.env.AI_DB_NAME || 'u218702675_cartdrawer',
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
    });
  }
  return pool;
}

function id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function now() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function toMySQLDateTime(iso) {
  if (!iso) return now();
  try { return new Date(iso).toISOString().slice(0, 19).replace('T', ' '); } catch { return now(); }
}

/* ─── Conversations ─── */

async function listConversations(shopDomain) {
  const db = getPool();
  let sql = 'SELECT * FROM ai_conversations';
  const params = [];
  if (shopDomain) {
    sql += ' WHERE shopDomain = ?';
    params.push(shopDomain);
  }
  sql += ' ORDER BY updatedAt DESC';
  const [rows] = await db.execute(sql, params);
  return rows.map(r => ({ ...r, pinned: !!r.pinned, archived: !!r.archived }));
}

async function createConversation(shopDomain, title) {
  const db = getPool();
  const conv = { id: id(), shopDomain, title: title || 'New Chat', pinned: 0, archived: 0, createdAt: now(), updatedAt: now() };
  await db.execute(
    'INSERT INTO ai_conversations (id, shopDomain, title, pinned, archived, createdAt, updatedAt) VALUES (?,?,?,0,0,?,?)',
    [conv.id, conv.shopDomain, conv.title, conv.createdAt, conv.updatedAt]
  );
  return conv;
}

async function getConversation(convId) {
  const db = getPool();
  const [rows] = await db.execute('SELECT * FROM ai_conversations WHERE id = ?', [convId]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { ...r, pinned: !!r.pinned, archived: !!r.archived };
}

async function updateConversation(convId, updates) {
  const db = getPool();
  const fields = [];
  const params = [];
  if (updates.title !== undefined) { fields.push('title = ?'); params.push(updates.title); }
  if (updates.pinned !== undefined) { fields.push('pinned = ?'); params.push(updates.pinned ? 1 : 0); }
  if (updates.archived !== undefined) { fields.push('archived = ?'); params.push(updates.archived ? 1 : 0); }
  fields.push('updatedAt = ?');
  params.push(now());
  params.push(convId);
  await db.execute('UPDATE ai_conversations SET ' + fields.join(', ') + ' WHERE id = ?', params);
  return getConversation(convId);
}

async function deleteConversation(convId) {
  const db = getPool();
  await db.execute('DELETE FROM ai_messages WHERE conversationId = ?', [convId]);
  await db.execute('DELETE FROM ai_actions WHERE conversationId = ?', [convId]);
  await db.execute('DELETE FROM ai_conversations WHERE id = ?', [convId]);
}

/* ─── Messages ─── */

async function listMessages(conversationId) {
  const db = getPool();
  const [rows] = await db.execute(
    'SELECT * FROM ai_messages WHERE conversationId = ? ORDER BY createdAt ASC',
    [conversationId]
  );
  return rows.map(r => ({
    ...r,
    actions: typeof r.actions === 'string' ? JSON.parse(r.actions) : r.actions,
    executedActions: typeof r.executedActions === 'string' ? JSON.parse(r.executedActions) : r.executedActions,
    before: typeof r.before === 'string' ? JSON.parse(r.before) : r.before,
    after: typeof r.after === 'string' ? JSON.parse(r.after) : r.after,
    off_topic: !!r.off_topic,
    synced: r.synced,
  }));
}

async function createMessage(conversationId, role, message, extra = {}) {
  const db = getPool();
  const msg = {
    id: id(),
    conversationId,
    role,
    message,
    summary: extra.summary || null,
    actions: extra.actions ? JSON.stringify(extra.actions) : null,
    executedActions: extra.executedActions ? JSON.stringify(extra.executedActions) : null,
    before: extra.before ? JSON.stringify(extra.before) : null,
    after: extra.after ? JSON.stringify(extra.after) : null,
    synced: extra.synced !== undefined ? (extra.synced ? 1 : 0) : null,
    off_topic: extra.off_topic ? 1 : 0,
    insight_mode: extra.insight_mode || null,
    createdAt: now(),
  };
  await db.execute(
    'INSERT INTO ai_messages (id, conversationId, role, message, summary, actions, executedActions, `before`, `after`, synced, off_topic, insight_mode, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [msg.id, msg.conversationId, msg.role, msg.message, msg.summary, msg.actions, msg.executedActions, msg.before, msg.after, msg.synced, msg.off_topic, msg.insight_mode, msg.createdAt]
  );
  return { ...msg, actions: extra.actions || [], executedActions: extra.executedActions || [], before: extra.before, after: extra.after };
}

/* ─── Suggestions ─── */

async function getSuggestions(page) {
  const db = getPool();
  let sql = 'SELECT * FROM ai_suggestions WHERE active = 1';
  const params = [];
  if (page) { sql += ' AND page = ?'; params.push(page); }
  sql += ' ORDER BY priority ASC';
  const [rows] = await db.execute(sql, params);
  return rows;
}

/* ─── Tools ─── */

async function getTools() {
  const db = getPool();
  const [rows] = await db.execute('SELECT * FROM ai_tools WHERE active = 1');
  return rows;
}

/* ─── Actions ─── */

async function createAction({ conversationId, module, actionName, payload, status }) {
  const db = getPool();
  const action = {
    id: id(),
    conversationId: conversationId || null,
    module: module || '',
    actionName,
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    status: status || 'pending',
    createdAt: now(),
  };
  await db.execute(
    'INSERT INTO ai_actions (id, conversationId, module, actionName, payload, status, createdAt) VALUES (?,?,?,?,?,?,?)',
    [action.id, action.conversationId, action.module, action.actionName, action.payload, action.status, action.createdAt]
  );
  return action;
}

module.exports = {
  listConversations,
  createConversation,
  getConversation,
  updateConversation,
  deleteConversation,
  listMessages,
  createMessage,
  getSuggestions,
  getTools,
  createAction,
};
