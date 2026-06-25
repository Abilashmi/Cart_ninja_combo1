import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';

export async function loader({ request }) {
  try {
    await authenticate.admin(request);
    const url = new URL(request.url);
    const conversationId = url.searchParams.get('conversationId');
    if (!conversationId) return Response.json({ success: true, messages: [] });
    const db = getDb();
    const [rows] = await db.execute(
      'SELECT id, role, message, created_at as createdAt FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [conversationId]
    );
    return Response.json({ success: true, messages: rows });
  } catch {
    return Response.json({ success: true, messages: [] });
  }
}

export async function action({ request }) {
  try {
    await authenticate.admin(request);
    const { conversationId, role, message } = await request.json();
    if (!conversationId || !role || !message) return Response.json({ success: false, error: 'Missing fields' }, { status: 400 });
    const db = getDb();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await db.execute(
      'INSERT INTO ai_messages (id, conversation_id, role, message, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, conversationId, role, message, now]
    );
    await db.execute('UPDATE ai_conversations SET updated_at = ? WHERE id = ?', [now, conversationId]);
    return Response.json({ success: true, message: { id, conversationId, role, message, createdAt: now } });
  } catch {
    return Response.json({ success: true, message: { id: Date.now().toString(), createdAt: new Date().toISOString() } });
  }
}
