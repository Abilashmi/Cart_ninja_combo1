import { authenticate } from '../shopify.server';
import { checkAndConsumeCredit } from '../services/ai-credits.server';
import { loadOrderPairs, suggestRulesFromPrompt } from '../services/pairing-assistant.server';

// Backs the Pairing Assistant on the FBT page and in the Cart Editor's
// Upsell section (components/shared/PairingAssistant.jsx). Read-only: it
// returns suggested rules / order pairs, and the page adds the ones the
// merchant picks to its own manual rules, which its normal Save publishes.
//   { intent: 'orders', days, fresh }  → products bought together in past orders
//   { intent: 'prompt', prompt, maxOffers } → rules from the merchant's own words (1 AI credit)
export async function action({ request }) {
  if (request.method !== 'POST') {
    return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
  }
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
  }

  try {
    if (body.intent === 'orders') {
      const result = await loadOrderPairs(admin, shop, { days: body.days, fresh: Boolean(body.fresh) });
      return Response.json({ success: true, intent: 'orders', ...result });
    }
    if (body.intent === 'prompt') {
      const maxOffers = Math.min(Math.max(parseInt(body.maxOffers, 10) || 3, 1), 10);
      const result = await suggestRulesFromPrompt(admin, shop, body.prompt, {
        maxOffers,
        consumeCredit: () => checkAndConsumeCredit(shop, admin),
      });
      return Response.json({ success: true, intent: 'prompt', ...result });
    }
    return Response.json({ success: false, error: 'Unknown intent.' }, { status: 400 });
  } catch (e) {
    console.error('[pairing-assistant]', body.intent, e);
    return Response.json({ success: false, intent: body.intent, error: 'Something went wrong. Please try again.' }, { status: 502 });
  }
}
