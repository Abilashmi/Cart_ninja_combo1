/**
 * Links the support chat to the Brix Partner Dashboard, where the team
 * answers every app's chats in one place.
 *
 * Out: once a chat is with the team (the merchant asked for a person, the
 * AI handed it over, or the AI is off), it becomes a dashboard ticket, with
 * the transcript so far, and every later merchant message is added to it.
 * In:  the dashboard's signed webhook (routes/api.brix-dashboard.jsx) puts
 * team replies back in the chat and closes / reopens it.
 *
 *   BRIX_DASHBOARD_URL             default https://admin-partners.thebrix.io
 *   BRIX_DASHBOARD_KEY             an API key from dashboard Settings → API keys (unset = off)
 *   BRIX_DASHBOARD_WEBHOOK_SECRET  the dashboard webhook's signing secret
 *   BRIX_DASHBOARD_APP             this app's name or Partner app ID in the dashboard (default Cart Ninja)
 */
import crypto from 'node:crypto';
import { teamReply, teamUpdate } from './support-chat.server';

const PREFIX = 'cartninja-chat-';
const env = () => ({
  url: (process.env.BRIX_DASHBOARD_URL || 'https://admin-partners.thebrix.io').replace(/\/+$/, ''),
  key: process.env.BRIX_DASHBOARD_KEY || '',
  secret: process.env.BRIX_DASHBOARD_WEBHOOK_SECRET || '',
  app: process.env.BRIX_DASHBOARD_APP || 'Cart Ninja',
});

export const conversationRef = (chatId) => `${PREFIX}${chatId}`;

/** The chat ID in a dashboard conversation_id, or null when it belongs to another app. */
export function chatIdFrom(ref) {
  const m = new RegExp(`^${PREFIX}(\\d+)$`).exec(String(ref || ''));
  return m ? Number(m[1]) : null;
}

export function verifySignature(rawBody, header) {
  const { secret } = env();
  if (!secret || !header) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const WHO = { merchant: 'Merchant', ai: 'BRIX AI', system: 'Note' };

/** The chat so far, one block per message, for the ticket's first message. */
export function transcript(messages) {
  return messages
    .map((m) => `${m.sender === 'team' ? (m.author || 'BRIX team') : (WHO[m.sender] || m.sender)}: ${m.body}`)
    .join('\n\n')
    .slice(0, 19000);
}

/**
 * Adds `message` to the chat's dashboard ticket (the dashboard makes the
 * ticket on the first call for a conversation). Never throws, never blocks
 * the chat: when the dashboard can't be reached, the chat works as before.
 */
export async function forwardChat(conv, message, { subject } = {}) {
  const { url, key, app } = env();
  if (!key || !conv?.id || !String(message || '').trim()) return false;
  const ctx = conv.context || {};
  try {
    const res = await fetch(`${url}/api/tickets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        conversation_id: conversationRef(conv.id),
        message: String(message).slice(0, 19000),
        subject: subject || `Chat: ${ctx.name || conv.shop}`,
        name: ctx.owner || ctx.name || undefined,
        email: ctx.email || undefined,
        shop_domain: conv.shop,
        app,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error('[brix-dashboard] forward failed:', res.status, (await res.text()).slice(0, 200));
    return res.ok;
  } catch (e) {
    console.error('[brix-dashboard] forward failed:', e.message);
    return false;
  }
}

/* ---------- the dashboard's webhook (routes/api.brix-dashboard.jsx) ---------- */

// The dashboard sends ticket.replied only for a team reply the merchant can
// see (internal notes never; merchant messages are ticket.message_received).
// A safety net all the same: anything not from the team stays out of the chat.
const teamMessageFor = (m = {}) => m.from === 'team';

const SEEN_MAX = 1000;
const seen = new Set(); // delivery IDs handled, so a retried webhook doesn't post a reply twice
const remember = (id) => {
  if (!id) return;
  seen.add(id);
  if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value);
};

/**
 * One webhook delivery: `raw` = the exact body, `signature` = X-Brix-Signature
 * (sha256=<HMAC-SHA256 of the raw body>), `deliveryId` = X-Brix-Delivery (a
 * UUID, the same as the body's `id`). Body: { id, event, created_at, data }.
 * The dashboard retries only on a non-2xx answer or one slower than 10 s
 * (after 1, 5, 30, 120 and 360 min); repeats are remembered per process, so
 * a retry landing on another Fly machine after a lost response could post
 * twice (rare; store the delivery id with the message in MySQL if it matters). Returns { status, body } for the route. `deps` = the chat
 * service's ({ db, now }) for the tests.
 */
export async function handleDashboardWebhook(raw, signature, { deliveryId, deps } = {}) {
  if (!verifySignature(raw, signature)) return { status: 401, body: { ok: false, error: 'Bad signature.' } };
  let evt;
  try { evt = JSON.parse(raw); } catch { return { status: 400, body: { ok: false, error: 'Bad JSON.' } }; }

  const chatId = chatIdFrom(evt?.data?.ticket?.conversation_id);
  const id = String(deliveryId || evt?.id || '') || null;
  if (!chatId) return { status: 200, body: { ok: true, ignored: 'other_app' } };
  if (id && seen.has(id)) return { status: 200, body: { ok: true, ignored: 'repeat' } };

  try {
    if (evt.event === 'ticket.replied') {
      const m = evt.data.message || {};
      if (!teamMessageFor(m)) { remember(id); return { status: 200, body: { ok: true, ignored: 'not_a_team_reply' } }; }
      await teamReply(chatId, { body: m.body, author: m.author?.name || 'BRIX team' }, deps);
    } else if (evt.event === 'ticket.status_changed' && (evt.data.to === 'resolved' || evt.data.from === 'resolved')) {
      await teamUpdate(chatId, { status: evt.data.to === 'resolved' ? 'closed' : 'open', read: true }, deps);
    } else {
      return { status: 200, body: { ok: true, ignored: 'event' } };
    }
  } catch (e) {
    // The chat was deleted, or the reply was empty: nothing to retry.
    if (e.code === 'not_found' || e.code === 'empty') { remember(id); return { status: 200, body: { ok: true, ignored: e.code } }; }
    console.error('[brix-dashboard] webhook failed:', e.message);
    return { status: 500, body: { ok: false, error: 'Could not save.' } };
  }
  remember(id);
  return { status: 200, body: { ok: true } };
}
