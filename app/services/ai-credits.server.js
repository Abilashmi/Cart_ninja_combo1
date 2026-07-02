import { getDb } from './db.server';
import { ensurePlanTables } from './plan-schema.server';
import { getShopPlan } from './plan-permissions.server';
import { getAiBrixCreditLimit } from '../config/plans';

function currentPeriodKey() {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${now.getUTCFullYear()}-${month}`;
}

export const AI_BRIX_EXHAUSTED_MESSAGE =
  "You've used all your AI BRIX credits for this month. Upgrade your plan or wait until your credits reset.";

// Checks whether the shop has AI BRIX credits remaining this month, and if
// so, consumes one. Pro (unlimited) always allows and still increments for
// telemetry, never blocking.
export async function checkAndConsumeCredit(shop) {
  const db = getDb();
  await ensurePlanTables(db);

  const planKey = await getShopPlan(shop);
  const limit = getAiBrixCreditLimit(planKey);
  const periodKey = currentPeriodKey();

  const [rows] = await db.execute(
    'SELECT credits_used FROM ai_brix_credit_usage WHERE shop_domain = ? AND period_key = ? LIMIT 1',
    [shop, periodKey]
  );
  const creditsUsed = rows[0]?.credits_used || 0;

  if (limit !== null && creditsUsed >= limit) {
    return { allowed: false, remaining: 0, limit, planKey };
  }

  await db.execute(
    `INSERT INTO ai_brix_credit_usage (shop_domain, period_key, credits_used)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE credits_used = credits_used + 1, updated_at = NOW()`,
    [shop, periodKey]
  );

  const remaining = limit === null ? null : Math.max(0, limit - (creditsUsed + 1));
  return { allowed: true, remaining, limit, planKey };
}
