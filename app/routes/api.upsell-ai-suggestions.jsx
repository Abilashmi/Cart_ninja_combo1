import { authenticate } from '../shopify.server';
import { getShopPlan } from '../services/plan-permissions.server';
import { generateAiUpsellRules } from '../services/cart-config-writes.server';

// Backs the Cart Drawer's Upsell Products > AI Recommendations > Regenerate
// Suggestions button. Used to be a bare LLM call (see git history) that
// asked a model to freely pick a flat count of "good upsells" from the
// catalog with zero grounding in real purchase behavior, and turned every
// pick into a blanket triggerType:'all' rule shown on every cart regardless
// of contents — never actually "matching" whatever the shopper just added,
// which is the exact complaint this replaces. Now calls the same real,
// data-driven engine FBT's AI Coverage Run uses (real co-purchase history,
// falling back to product type / collection, skipping a product rather than
// inventing an unrelated pairing) and writes real per-product rules
// directly — same "click Regenerate, it's saved" behavior as FBT, not a
// preview the merchant has to separately Save afterward.
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

  const countPerProduct = Math.min(Math.max(parseInt(body.count, 10) || 3, 1), 5);
  const planKey = await getShopPlan(shop);

  try {
    const result = await generateAiUpsellRules(admin, shop, planKey, countPerProduct);
    if (result.totalProducts < 2) {
      return Response.json(
        { success: false, error: 'Need at least 2 products in your store to generate upsell suggestions.' },
        { status: 400 }
      );
    }
    if (result.productsCovered === 0) {
      return Response.json(
        {
          success: false,
          error: 'No genuine pairings found yet — this needs either some order history or products organized into collections. Try again once you have a few orders, or add products to collections.',
        },
        { status: 200 }
      );
    }
    return Response.json({
      success: true,
      rules: result.rules,
      productsCovered: result.productsCovered,
      totalProducts: result.totalProducts,
      productsSkipped: result.productsSkipped,
      truncated: result.truncated,
    });
  } catch (e) {
    console.error('[upsell-ai-suggestions] generateAiUpsellRules failed:', e);
    return Response.json({ success: false, error: 'AI suggestion generation failed. Please try again.' }, { status: 502 });
  }
}
