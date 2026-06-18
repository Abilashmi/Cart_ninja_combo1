/**
 * Migrates ai-data/*.json → cart_drawer_ninja MySQL tables.
 * Safe to re-run: uses INSERT IGNORE so existing rows are skipped.
 * Run: node scripts/migrate-ai-json-to-mysql.cjs
 */
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

function toMySQL(iso) {
  if (!iso) return new Date().toISOString().slice(0, 19).replace('T', ' ');
  try { return new Date(iso).toISOString().slice(0, 19).replace('T', ' '); } catch { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8')); } catch { return []; }
}

async function run() {
  const conn = await mysql.createConnection({
    host: '127.0.0.1', user: 'root', password: '', database: 'cart_drawer_ninja',
  });

  // ── 1. Conversations ───────────────────────────────────────────────────────
  const conversations = readJson('ai-data/conversations.json');
  let convInserted = 0;
  for (const c of conversations) {
    if (!c.id || !c.shopDomain) continue;
    await conn.execute(
      'INSERT IGNORE INTO ai_conversations (id, shopDomain, title, pinned, archived, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)',
      [
        c.id,
        c.shopDomain,
        c.title || 'New Chat',
        c.pinned ? 1 : 0,
        c.archived ? 1 : 0,
        toMySQL(c.createdAt),
        toMySQL(c.updatedAt),
      ]
    );
    convInserted++;
  }
  console.log(`✅ ai_conversations: inserted ${convInserted} rows (INSERT IGNORE)`);

  // ── 2. Messages ────────────────────────────────────────────────────────────
  const messages = readJson('ai-data/messages.json');
  let msgInserted = 0;
  for (const m of messages) {
    if (!m.id || !m.conversationId) continue;
    const stringify = (v) => v == null ? null : (typeof v === 'string' ? v : JSON.stringify(v));
    await conn.execute(
      'INSERT IGNORE INTO ai_messages (id, conversationId, role, message, summary, actions, executedActions, `before`, `after`, synced, off_topic, insight_mode, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        m.id,
        m.conversationId,
        m.role || 'user',
        m.message || null,
        m.summary || null,
        stringify(m.actions),
        stringify(m.executedActions),
        stringify(m.before),
        stringify(m.after),
        m.synced != null ? (m.synced ? 1 : 0) : null,
        m.off_topic ? 1 : 0,
        m.insight_mode || null,
        toMySQL(m.createdAt),
      ]
    );
    msgInserted++;
  }
  console.log(`✅ ai_messages: inserted ${msgInserted} rows (INSERT IGNORE)`);

  // ── 3. Suggestions (top-up any missing) ──────────────────────────────────
  const suggestions = readJson('ai-data/suggestions.json');
  let suggInserted = 0;
  for (const s of suggestions) {
    if (!s.id) continue;
    await conn.execute(
      'INSERT IGNORE INTO ai_suggestions (id, page, title, prompt, priority, active, createdAt) VALUES (?,?,?,?,?,?,?)',
      [s.id, s.page || '/app', s.title || '', s.prompt || null, s.priority || 0, s.active !== false ? 1 : 0, toMySQL(s.createdAt)]
    );
    suggInserted++;
  }
  console.log(`✅ ai_suggestions: inserted ${suggInserted} rows (INSERT IGNORE)`);

  // ── 4. Tools (top-up any missing) ─────────────────────────────────────────
  const tools = readJson('ai-data/tools.json');
  let toolsInserted = 0;
  for (const t of tools) {
    if (!t.id) continue;
    await conn.execute(
      'INSERT IGNORE INTO ai_tools (id, name, description, parameters, active, createdAt) VALUES (?,?,?,?,?,?)',
      [t.id, t.name, t.description || null, t.parameters || null, t.active !== false ? 1 : 0, toMySQL(t.createdAt)]
    );
    toolsInserted++;
  }
  console.log(`✅ ai_tools: inserted ${toolsInserted} rows (INSERT IGNORE)`);

  // ── Verify ─────────────────────────────────────────────────────────────────
  console.log('\n=== Verification ===');
  for (const t of ['ai_conversations', 'ai_messages', 'ai_suggestions', 'ai_tools', 'ai_actions']) {
    const [r] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    console.log(` ${t}: ${r[0].n} rows`);
  }

  await conn.end();
  console.log('\nDone.');
}

run().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
