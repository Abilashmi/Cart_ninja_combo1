import { authenticate } from '../shopify.server';
import { BASE_PHP_URL } from '../utils/api-helpers';

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let body;
  try { body = await request.json(); } catch {
    return Response.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const { plan } = body || {};
  if (!plan?.actions?.length) {
    return Response.json({ success: false, error: 'No actions provided' }, { status: 400 });
  }

  const res = await fetch(`${BASE_PHP_URL}/ai_agent_apply.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forge-Secret': process.env.SHOPIFY_API_KEY || '',
    },
    body: JSON.stringify({ shop, plan }),
  });

  const result = await res.json();
  return Response.json({ success: result.status === 'success', applied: result.applied ?? [], after: result.after ?? null });
}
