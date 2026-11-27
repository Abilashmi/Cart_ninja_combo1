// Shared by the support chat tests: an in-memory stand-in for the chat's
// MySQL tables (services/support-chat.server.js).
// An in-memory stand-in for the three tables, for exactly the statements the service runs.
export function fakeDb() {
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
