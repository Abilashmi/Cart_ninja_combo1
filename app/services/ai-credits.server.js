import { getDb } from './db.server';
import { ensurePlanTables } from './plan-schema.server';
import { getShopPlan, getShopBillingInterval } from './plan-permissions.server';
import { getAiBrixCreditLimit, getAiBrixOverageRate, aiCreditAllowed, billsUsage } from '../config/plans';
import { chargeAiCreditOverage } from './billing.server';

function currentPeriodKey() {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${now.getUTCFullYear()}-${month}`;
}

// Increments the shop's message count for this period. Past the plan's
// monthly cap, a plan with a credit overage rate billed monthly would pay per
// extra credit (chargeAiCreditOverage); no plan has one today, so every shop
// stops at its cap (allowed: false, no credit used) until next month
// (aiCreditAllowed in config/plans.js).
export async function checkAndConsumeCredit(shop, admin) {
  const db = getDb();
  await ensurePlanTables(db);

  const planKey = await getShopPlan(shop);
  const interval = await getShopBillingInterval(shop);
  const limit = getAiBrixCreditLimit(planKey);
  const overageRate = getAiBrixOverageRate(planKey);
  const periodKey = currentPeriodKey();

  if (!billsUsage(interval)) {
    const [usedRows] = await db.execute(
      'SELECT credits_used FROM ai_brix_credit_usage WHERE shop_domain = ? AND period_key = ? LIMIT 1',
      [shop, periodKey]
    );
    const used = usedRows[0]?.credits_used || 0;
    if (!aiCreditAllowed(planKey, interval, used)) {
      return { allowed: false, remaining: 0, limit, planKey, isOverage: false, overageRate: 0, overageCharge: null };
    }
  }

  await db.execute(
    `INSERT INTO ai_brix_credit_usage (shop_domain, period_key, credits_used)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE credits_used = credits_used + 1, updated_at = NOW()`,
    [shop, periodKey]
  );

  const [rows] = await db.execute(
    'SELECT credits_used FROM ai_brix_credit_usage WHERE shop_domain = ? AND period_key = ? LIMIT 1',
    [shop, periodKey]
  );
  const creditsUsedAfter = rows[0]?.credits_used || 1;
  const isOverage = billsUsage(interval) && creditsUsedAfter > limit;

  let overageCharge = null;
  if (isOverage) {
    const creditNumber = creditsUsedAfter - limit;
    overageCharge = await chargeAiCreditOverage(admin, shop, periodKey, creditNumber, planKey, overageRate);
  }

  return {
    allowed: true,
    remaining: Math.max(0, limit - creditsUsedAfter),
    limit,
    planKey,
    isOverage,
    overageRate,
    overageCharge,
  };
}

// Read-only status for the credits pill — does not consume a credit.
export async function getCreditStatus(shop) {
  const db = getDb();
  await ensurePlanTables(db);

  const planKey = await getShopPlan(shop);
  const interval = await getShopBillingInterval(shop);
  const limit = getAiBrixCreditLimit(planKey);
  const overageRate = billsUsage(interval) ? getAiBrixOverageRate(planKey) : 0;
  const periodKey = currentPeriodKey();

  const [rows] = await db.execute(
    'SELECT credits_used FROM ai_brix_credit_usage WHERE shop_domain = ? AND period_key = ? LIMIT 1',
    [shop, periodKey]
  );
  const used = rows[0]?.credits_used || 0;

  return {
    planKey,
    interval,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    isOverage: billsUsage(interval) && used > limit,
    // Yearly plans stop at the monthly credits (no usage billing).
    exhausted: !aiCreditAllowed(planKey, interval, used),
    overageRate,
  };
}
