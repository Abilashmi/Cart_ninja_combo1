import { authenticate } from '../shopify.server';
import { checkAndConsumeCredit } from '../services/ai-credits.server';
import { getShopPlan, canPublishFeature } from '../services/plan-permissions.server';
import { getBestUpsellPair } from '../services/upsell-recommendation.server';
import { appendUpsellRule } from '../services/upsell-rules.server';
import { getDb } from '../services/db.server';

// Re-reads the shop's manual_rules and confirms the rule we just wrote is
// actually there — never report success on the write call's say-so alone.
async function verifyRuleSaved(shop, ruleId) {
  const db = getDb();
  const [rows] = await db.execute(
    'SELECT manual_rules FROM upsell_widget_settings WHERE shop_domain = ? LIMIT 1',
    [shop]
  );
  try {
    const rules = rows[0]?.manual_rules ? JSON.parse(rows[0].manual_rules) : [];
    return rules.some(r => r.id === ruleId);
  } catch {
    return false;
  }
}

export async function action({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;

    const planKey = await getShopPlan(shop);
    if (!canPublishFeature(planKey, 'ai_cart_upsell')) {
      return Response.json({ status: 'locked', message: 'Upsell rules need the Starter plan or above.' });
    }

    const credit = await checkAndConsumeCredit(shop, admin);
    const credits = { remaining: credit.remaining, limit: credit.limit, isOverage: credit.isOverage };

    const pair = await getBestUpsellPair(shop);
    if (pair.status === 'insufficient-data') {
      return Response.json({
        status: 'insufficient',
        message: "I don't have enough order history yet to generate a data-driven recommendation. You can add a rule manually in Cart Editor > Upsells, or ask me again once you've had a few more sales.",
        credits,
      });
    }

    const { rule } = await appendUpsellRule(shop, {
      triggerProductId: pair.trigger.id, triggerTitle: pair.trigger.title,
      offerProductId: pair.offer.id, offerTitle: pair.offer.title,
    });

    const verified = await verifyRuleSaved(shop, rule.id);
    if (!verified) {
      return Response.json({
        status: 'error',
        message: "I generated a recommendation but couldn't confirm it saved correctly. Please try again.",
        credits,
      });
    }

    return Response.json({
      status: 'saved',
      trigger: pair.trigger,
      offer: pair.offer,
      basis: pair.basis,
      credits,
    });
  } catch (e) {
    console.error('[api.ai-agent.auto-upsell]', e);
    return Response.json({ status: 'error', message: 'Something went wrong while generating a recommendation. Please try again.' });
  }
}
