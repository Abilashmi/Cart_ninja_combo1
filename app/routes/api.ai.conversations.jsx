import { authenticate } from '../shopify.server';
import { BASE_PHP_URL } from '../utils/api-helpers';

async function callPhp(method, shop, body = null) {
  const url = method === 'GET'
    ? `${BASE_PHP_URL}/ai_conversations.php?shop=${encodeURIComponent(shop)}`
    : `${BASE_PHP_URL}/ai_conversations.php`;

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
    const { session } = await authenticate.admin(request);
    const result = await callPhp('GET', session.shop);
    return Response.json({ success: true, conversations: result.conversations ?? [] });
  } catch {
    return Response.json({ success: true, conversations: [] });
  }
}

export async function action({ request }) {
  try {
    const { session } = await authenticate.admin(request);
    const { title } = await request.json();
    const result = await callPhp('POST', session.shop, { shop: session.shop, title });
    return Response.json({ success: result.status === 'success', conversation: result.conversation });
  } catch {
    return Response.json({ success: false, conversations: [] });
  }
}
