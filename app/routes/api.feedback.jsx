import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';

export async function action({ request }) {
  if (request.method !== 'POST') {
    return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const { session } = await authenticate.admin(request);
    const { rating, note } = await request.json();

    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return Response.json({ success: false, error: 'Rating must be 1-5' }, { status: 400 });
    }

    const db = getDb();
    await db.execute(
      'INSERT INTO app_feedback (shop_domain, rating, note) VALUES (?, ?, ?)',
      [session.shop, ratingNum, (note || '').trim() || null]
    );

    return Response.json({ success: true });
  } catch (e) {
    console.error('[api.feedback]', e);
    return Response.json({ success: false, error: 'Failed to save feedback' }, { status: 500 });
  }
}
