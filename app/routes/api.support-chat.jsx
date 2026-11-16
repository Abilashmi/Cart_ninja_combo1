// The merchant side of the BRIX support chat (components/support/SupportChat.jsx).
// GET ?after=<id>  = settings, the chat and new messages.
// POST { intent: 'send', body, page, embed } | { intent: 'read' } | { intent: 'team' }.
// The store is the signed-in shop (never from the browser). With a message,
// what the team needs to know about the store is saved on the chat (at most
// every 10 minutes): name, domain, email, plan, page, app embed, features on.
import { authenticate } from '../shopify.server';
import { getShopPlan } from '../services/plan-permissions.server';
import { loadModuleStatus } from '../services/home-status.server';
import { afterResponse } from '../services/webhook-queue.server';
import {
  aiAnswer, contextIsStale, getMerchantChat, merchantAskTeam, merchantMarkRead, merchantSend,
} from '../services/support-chat.server';

const SEND_LIMIT = 20; // messages per store per minute
const sent = new Map();
function tooFast(shop) {
  const now = Date.now();
  const recent = (sent.get(shop) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  sent.set(shop, recent);
  return recent.length > SEND_LIMIT;
}

async function storeContext(admin, shop, { page, embed, locale }) {
  const [plan, features, info] = await Promise.all([
    getShopPlan(shop, admin).catch(() => null),
    loadModuleStatus(shop).catch(() => null),
    admin.graphql(`#graphql
      query BrixSupportShop { shop { name email contactEmail shopOwnerName ianaTimezone currencyCode primaryDomain { url } plan { displayName } } }`)
      .then((r) => r.json()).then((j) => j?.data?.shop || null).catch(() => null),
  ]);
  return {
    shop,
    name: info?.name || '',
    owner: info?.shopOwnerName || '',
    email: info?.contactEmail || info?.email || '',
    domain: info?.primaryDomain?.url || '',
    shopifyPlan: info?.plan?.displayName || '',
    timeZone: info?.ianaTimezone || '',
    currency: info?.currencyCode || '',
    plan: plan || '',
    page: String(page || '').slice(0, 120),
    embed: ['on', 'off'].includes(embed) ? embed : 'unknown',
    locale: String(locale || '').slice(0, 10),
    features,
  };
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const after = Number(new URL(request.url).searchParams.get('after')) || 0;
  try {
    return Response.json({ success: true, ...(await getMerchantChat(session.shop, { after })) });
  } catch (e) {
    console.error('[support-chat] load failed:', e.message);
    return Response.json({ success: false, error: 'Chat is not available right now.' }, { status: 503 });
  }
}

export async function action({ request }) {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json().catch(() => ({}));
  try {
    if (body.intent === 'read') {
      await merchantMarkRead(shop);
      return Response.json({ success: true });
    }
    if (body.intent === 'team') {
      return Response.json({ success: true, message: await merchantAskTeam(shop) });
    }
    if (body.intent !== 'send') return Response.json({ success: false, error: 'Unknown request.' }, { status: 400 });
    if (tooFast(shop)) return Response.json({ success: false, error: 'You are sending messages very fast. Please wait a moment.' }, { status: 429 });
    const context = (await contextIsStale(shop)) ? await storeContext(admin, shop, body) : null;
    const { message, aiWillAnswer } = await merchantSend(shop, { body: body.body, context });
    if (aiWillAnswer) afterResponse('support-chat-ai', () => aiAnswer(shop));
    return Response.json({ success: true, message, aiWillAnswer });
  } catch (e) {
    if (e.code === 'empty' || e.code === 'off') return Response.json({ success: false, error: e.message }, { status: 400 });
    console.error('[support-chat] action failed:', e.message);
    return Response.json({ success: false, error: 'Your message could not be sent. Please try again.' }, { status: 500 });
  }
}
