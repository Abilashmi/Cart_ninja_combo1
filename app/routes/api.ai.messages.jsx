import { authenticate } from '../shopify.server';
import { BASE_PHP_URL } from '../utils/api-helpers';

async function callPhp(method, params = {}, body = null) {
  const qs = new URLSearchParams(params).toString();
  const url = method === 'GET'
    ? `${BASE_PHP_URL}/ai_messages.php?${qs}`
    : `${BASE_PHP_URL}/ai_messages.php`;

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Forge-Secret': process.env.SHOPIFY_API_KEY || '',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

export async function loader({ request }) {
  try {
    await authenticate.admin(request);
    const url = new URL(request.url);
    const conversationId = url.searchParams.get('conversationId');
    if (!conversationId) return Response.json({ success: true, messages: [] });
    const result = await callPhp('GET', { conversationId });
    return Response.json({ success: true, messages: result.messages ?? [] });
  } catch {
    return Response.json({ success: true, messages: [] });
  }
}

export async function action({ request }) {
  try {
    await authenticate.admin(request);
    const { conversationId, role, message } = await request.json();
    if (!conversationId || !role || !message) {
      return Response.json({ success: false, error: 'Missing fields' }, { status: 400 });
    }
    const result = await callPhp('POST', {}, { conversationId, role, message });
    return Response.json({ success: result.status === 'success', message: result.message });
  } catch {
    return Response.json({ success: false, messages: [] });
  }
}
