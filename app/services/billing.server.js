import { getDb } from './db.server';
import { ensurePlanTables } from './plan-schema.server';
import { getShopPlan } from './plan-permissions.server';
import { PLANS } from '../config/plans';
import { unauthenticated } from '../shopify.server';

function yesterdayDateStr() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Extracts the active subscription's usage-pricing line item for a shop,
// shared by the daily cron job and the manual "Record Usage Charge" button.
// A subscription can carry more than one AppUsagePricing line item (e.g. one
// for order overage, one for AI BRIX credit overage) so `termsIncludes` picks
// out the right one by matching a substring of its `terms` text.
async function findUsageLineItem(admin, termsIncludes) {
  const subRes = await admin.graphql(`
    query {
      currentAppInstallation {
        activeSubscriptions {
          id
          status
          lineItems {
            id
            plan { pricingDetails { __typename ... on AppUsagePricing { terms } } }
          }
        }
      }
    }
  `);
  const subData = await subRes.json();
  const activeSub = (subData.data?.currentAppInstallation?.activeSubscriptions || [])
    .find(s => s.status === 'ACTIVE');
  if (!activeSub) return { error: 'No active subscription found for this shop' };

  const usageLineItem = activeSub.lineItems?.find(
    li => li.plan.pricingDetails.__typename === 'AppUsagePricing'
      && li.plan.pricingDetails.terms?.includes(termsIncludes)
  );
  if (!usageLineItem) return { error: 'Subscription has no matching usage pricing line item' };

  return { usageLineItem };
}

async function createUsageCharge(admin, { amount, description, termsIncludes }) {
  const { usageLineItem, error } = await findUsageLineItem(admin, termsIncludes);
  if (error) return { success: false, error };

  const res = await admin.graphql(
    `mutation AppUsageRecordCreate(
      $subscriptionLineItemId: ID!
      $price: MoneyInput!
      $description: String!
    ) {
      appUsageRecordCreate(
        subscriptionLineItemId: $subscriptionLineItemId
        price: $price
        description: $description
      ) {
        appUsageRecord { id createdAt }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        subscriptionLineItemId: usageLineItem.id,
        price: { amount: amount.toFixed(2), currencyCode: 'USD' },
        description,
      },
    }
  );

  const data = await res.json();
  const userErrors = data.data?.appUsageRecordCreate?.userErrors;
  if (userErrors?.length > 0) {
    return { success: false, error: userErrors[0].message };
  }

  return { success: true, usageRecordId: data.data?.appUsageRecordCreate?.appUsageRecord?.id };
}

// Computes overage for one shop/date from analytics_daily_rollup + the plan
// config, upserts an order_overage_charges row, and attempts to record the
// Shopify usage charge. Idempotent — skips dates already charged.
async function chargeOverageForShopDate(db, admin, shop, date, orderCount) {
  const planKey = await getShopPlan(shop);
  const plan = PLANS[planKey];

  if (plan.orderCap === null || orderCount <= plan.orderCap) {
    return { skipped: true, reason: 'within cap or unlimited plan' };
  }

  const [existing] = await db.execute(
    'SELECT status FROM order_overage_charges WHERE shop_domain = ? AND date = ? LIMIT 1',
    [shop, date]
  );
  if (existing.length > 0 && existing[0].status === 'charged') {
    return { skipped: true, reason: 'already charged' };
  }

  const overageOrders = orderCount - plan.orderCap;
  const chargeAmount = overageOrders * plan.overageRate;

  await db.execute(
    `INSERT INTO order_overage_charges
       (shop_domain, date, plan_key, order_count, order_cap, overage_orders, overage_rate, charge_amount, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
     ON DUPLICATE KEY UPDATE
       plan_key = VALUES(plan_key), order_count = VALUES(order_count), order_cap = VALUES(order_cap),
       overage_orders = VALUES(overage_orders), overage_rate = VALUES(overage_rate),
       charge_amount = VALUES(charge_amount), status = 'pending', updated_at = NOW()`,
    [shop, date, planKey, orderCount, plan.orderCap, overageOrders, plan.overageRate, chargeAmount]
  );

  if (!admin) {
    return { skipped: true, reason: 'no admin client available for this shop' };
  }

  const result = await createUsageCharge(admin, {
    amount: chargeAmount,
    description: `${overageOrders} overage orders × $${plan.overageRate.toFixed(2)} (${date})`,
    termsIncludes: 'per order above',
  });

  if (result.success) {
    await db.execute(
      `UPDATE order_overage_charges SET status = 'charged', shopify_usage_record_id = ?, error_message = NULL, updated_at = NOW()
       WHERE shop_domain = ? AND date = ?`,
      [result.usageRecordId, shop, date]
    );
    return { success: true, chargeAmount, overageOrders, usageRecordId: result.usageRecordId };
  }

  await db.execute(
    `UPDATE order_overage_charges SET status = 'failed', error_message = ?, updated_at = NOW()
     WHERE shop_domain = ? AND date = ?`,
    [result.error, shop, date]
  );
  return { success: false, error: result.error };
}

// Charges one AI BRIX credit used past a shop's monthly plan cap. Idempotent
// on (shop, periodKey, creditNumber) — called live from the chat route each
// time a shop crosses into overage, so a retry of the same overage credit
// must not double-charge.
export async function chargeAiCreditOverage(admin, shop, periodKey, creditNumber, planKey, overageRate) {
  const db = getDb();
  await ensurePlanTables(db);

  const [existing] = await db.execute(
    'SELECT status FROM ai_brix_overage_charges WHERE shop_domain = ? AND period_key = ? AND credit_number = ? LIMIT 1',
    [shop, periodKey, creditNumber]
  );
  if (existing.length > 0 && existing[0].status === 'charged') {
    return { skipped: true, reason: 'already charged' };
  }

  const chargeAmount = overageRate;

  await db.execute(
    `INSERT INTO ai_brix_overage_charges
       (shop_domain, period_key, credit_number, plan_key, overage_rate, charge_amount, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')
     ON DUPLICATE KEY UPDATE
       plan_key = VALUES(plan_key), overage_rate = VALUES(overage_rate),
       charge_amount = VALUES(charge_amount), status = 'pending', updated_at = NOW()`,
    [shop, periodKey, creditNumber, planKey, overageRate, chargeAmount]
  );

  if (!admin) {
    await db.execute(
      `UPDATE ai_brix_overage_charges SET status = 'failed', error_message = ?, updated_at = NOW()
       WHERE shop_domain = ? AND period_key = ? AND credit_number = ?`,
      ['No admin client available for this shop', shop, periodKey, creditNumber]
    );
    return { success: false, error: 'No admin client available for this shop' };
  }

  const result = await createUsageCharge(admin, {
    amount: chargeAmount,
    description: `AI BRIX credit #${creditNumber} over cap × $${overageRate.toFixed(2)} (${periodKey})`,
    termsIncludes: 'per AI BRIX credit',
  });

  if (result.success) {
    await db.execute(
      `UPDATE ai_brix_overage_charges SET status = 'charged', shopify_usage_record_id = ?, error_message = NULL, updated_at = NOW()
       WHERE shop_domain = ? AND period_key = ? AND credit_number = ?`,
      [result.usageRecordId, shop, periodKey, creditNumber]
    );
    return { success: true, chargeAmount, usageRecordId: result.usageRecordId };
  }

  await db.execute(
    `UPDATE ai_brix_overage_charges SET status = 'failed', error_message = ?, updated_at = NOW()
     WHERE shop_domain = ? AND period_key = ? AND credit_number = ?`,
    [result.error, shop, periodKey, creditNumber]
  );
  return { success: false, error: result.error };
}

// Runs once daily via the cron scheduler: charges every shop that exceeded
// its plan's order cap yesterday.
export async function runDailyOverageBilling(dateOverride) {
  const db = getDb();
  await ensurePlanTables(db);
  const date = dateOverride || yesterdayDateStr();

  const [rows] = await db.execute(
    'SELECT shop_domain, order_count FROM analytics_daily_rollup WHERE date = ? AND order_count > 0',
    [date]
  );

  const results = [];
  for (const row of rows) {
    const shop = row.shop_domain;
    try {
      const { admin } = await unauthenticated.admin(shop);
      const result = await chargeOverageForShopDate(db, admin, shop, date, row.order_count);
      results.push({ shop, date, ...result });
    } catch (err) {
      console.error(`[billing] overage charge failed for ${shop} on ${date}:`, err.message);
      results.push({ shop, date, success: false, error: err.message });
    }
  }
  return results;
}

// Manual/ad-hoc trigger for "today" (used by the Billing dashboard's
// "Record Usage Charge" button), given an authenticated admin client.
export async function chargeOverageForToday(admin, shop) {
  const db = getDb();
  await ensurePlanTables(db);
  const today = new Date().toISOString().slice(0, 10);

  const [rows] = await db.execute(
    'SELECT order_count FROM analytics_daily_rollup WHERE shop_domain = ? AND date = ? LIMIT 1',
    [shop, today]
  );
  const orderCount = rows[0]?.order_count || 0;

  return chargeOverageForShopDate(db, admin, shop, today, orderCount);
}

export async function getTodayUsage(shop) {
  const db = getDb();
  await ensurePlanTables(db);
  const planKey = await getShopPlan(shop);
  const plan = PLANS[planKey];
  const today = new Date().toISOString().slice(0, 10);

  const [rows] = await db.execute(
    'SELECT order_count FROM analytics_daily_rollup WHERE shop_domain = ? AND date = ? LIMIT 1',
    [shop, today]
  );
  const totalOrders = rows[0]?.order_count || 0;
  const freeOrders = plan.orderCap;
  const overageOrders = freeOrders === null ? 0 : Math.max(0, totalOrders - freeOrders);
  const pendingCharge = overageOrders * plan.overageRate;

  return {
    planKey,
    free_orders: freeOrders,
    total_orders: totalOrders,
    overage_orders: overageOrders,
    pending_charge: pendingCharge,
    unlimited: freeOrders === null,
  };
}

export async function getChargeHistory(shop, limit = 30) {
  const db = getDb();
  await ensurePlanTables(db);
  const [rows] = await db.execute(
    `SELECT date, overage_orders, charge_amount, status
     FROM order_overage_charges WHERE shop_domain = ? ORDER BY date DESC LIMIT ?`,
    [shop, limit]
  );
  return rows;
}
