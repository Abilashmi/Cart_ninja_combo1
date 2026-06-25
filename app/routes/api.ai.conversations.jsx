import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';

export async function loader({ request }) {
  try {
    const { session } = await authenticate.admin(request);
    const db = getDb();
    const [rows] = await db.execute(
      'SELECT id, title, shop_domain, created_at as createdAt, updated_at as updatedAt FROM ai_conversations WHERE shop_domain = ? ORDER BY updated_at DESC LIMIT 50',
      [session.shop]
    );
    return Response.json({ success: true, conversations: rows });
  } catch {
    return Response.json({ success: true, conversations: [] });
  }
}

export async function action({ request }) {
  try {
    const { session } = await authenticate.admin(request);
    const { title } = await request.json();
    const db = getDb();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await db.execute(
      'INSERT INTO ai_conversations (id, shop_domain, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, session.shop, title || 'New Chat', now, now]
    );
    return Response.json({ success: true, conversation: { id, title: title || 'New Chat', shopDomain: session.shop, createdAt: now, updatedAt: now } });
  } catch {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const now = new Date().toISOString();
    return Response.json({ success: true, conversation: { id, title: 'New Chat', createdAt: now, updatedAt: now } });
  }
}
