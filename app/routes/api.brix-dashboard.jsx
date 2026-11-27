// The Brix Partner Dashboard's webhook (services/brix-dashboard.server.js
// handleDashboardWebhook). The team answers chats there; this puts each
// reply back in the merchant's chat and closes / reopens the chat with the
// ticket. No Shopify session: it is signed with BRIX_DASHBOARD_WEBHOOK_SECRET
// (X-Brix-Signature over the raw body); other apps' chats are ignored.
// In the dashboard: Settings → Webhooks → URL https://<this app>/api/brix-dashboard,
// events ticket.replied and ticket.status_changed.
import { handleDashboardWebhook } from '../services/brix-dashboard.server';

export const loader = () => Response.json({ ok: false, error: 'POST only.' }, { status: 405 });

export async function action({ request }) {
  if (request.method !== 'POST') return Response.json({ ok: false, error: 'POST only.' }, { status: 405 });
  const raw = await request.text();
  const { status, body } = await handleDashboardWebhook(raw, request.headers.get('x-brix-signature'), {
    deliveryId: request.headers.get('x-brix-delivery'),
  });
  return Response.json(body, { status });
}
