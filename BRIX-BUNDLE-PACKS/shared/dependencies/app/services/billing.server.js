import { getDb } from './db.server';
import { ensurePlanTables } from './plan-schema.server';
import { getShopPlan, getShopBillingInterval } from './plan-permissions.server';
import { PLANS, orderCapBehavior, dayOverageOrders } from '../config/plans';
import { unauthenticated } from '../shopify.server';

function yesterdayDateStr() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Extracts the active subscription's usage-pricing line item for a shop,
// shared by the daily cron job and the manual "Record Usage Charge" button.
// Shopify's Billing API allows only one AppUsagePricing line item per
// subscription (confirmed directly via the API — a second one fails
// appSubscriptionCreate with "Cannot have more than one plan with the same
// pricing details" regardless of differing terms/cappedAmount), so order
// overage and AI BRIX credit overage share this single line item —
// individual charges are told apart by their `description`, not by which
// line item they're attached to.
async function findUsageLineItem(admin) {
  const subRes = await admin.graphql(`
    query {
      currentAppInstallation {
        activeSubscriptions {
          id
          status
          lineItems {
            id
            plan { pricingDetails { __typename } }
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
  );
  if (!usageLineItem) return { error: 'Subscription has no usage pricing line item' };

  return { usageLineItem };
}

async function createUsageCharge(admin, { amount, description }) {
  const { usageLineItem, error } = await findUsageLineItem(admin);
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

// The month's orders (billable_order_count, every order of the store, see
// billable-orders.server.js) from the 1st of `date`'s month through `date`.
async function monthOrdersThrough(db, shop, date) {
  const [rows] = await db.execute(
    `SELECT COALESCE(SUM(billable_order_count), 0) AS total
     FROM analytics_daily_rollup WHERE shop_domain = ? AND date >= ? AND date <= ?`,
    [shop, date.slice(0, 7) + '-01', date]
  );
  return Number(rows[0]?.total || 0);
}

// Computes overage for one shop/date from analytics_daily_rollup + the plan
// config, upserts an order_overage_charges row, and attempts to record the
// Shopify usage charge. Idempotent — skips dates already charged.
async function chargeOverageForShopDate(db, admin, shop, date, orderCount) {
  const planKey = await getShopPlan(shop);
  const plan = PLANS[planKey];
  const interval = await getShopBillingInterval(shop);

  // A yearly plan has no usage line item (Shopify allows none on yearly
  // subscriptions): its storefront pauses at the cap instead. overageRate
  // === 0 (Free) pauses too — see plan_order_cap_exceeded in
  // php_backend/plan_helpers.php, the actual enforcement point.
  if (orderCapBehavior(planKey, interval) !== 'charge') {
    return { skipped: true, reason: 'unlimited plan, or plan has no per-order charge' };
  }
  // The cap is per calendar month, not per day.
  const overageOrders = dayOverageOrders(await monthOrdersThrough(db, shop, date), orderCount, plan.orderCap);
  if (overageOrders <= 0) {
    return { skipped: true, reason: 'within the monthly cap' };
  }

  // Free trials shouldn't incur usage charges before the merchant has even
  // been billed their base plan fee — trial_ends_on is synced onto `shops`
  // from the app_subscriptions/update webhook (see
  // php_backend/update-subscription-status.php). Comparing as date strings
  // is safe since both sides are YYYY-MM-DD.
  const [trialRows] = await db.execute(
    `SELECT 1 FROM shops WHERE shop_domain = ? AND trial_ends_on IS NOT NULL AND ? <= trial_ends_on LIMIT 1`,
    [shop, date]
  );
  if (trialRows.length > 0) {
    return { skipped: true, reason: 'shop still within trial period — overage suppressed until trial ends' };
  }

  const [existing] = await db.execute(
    'SELECT status FROM order_overage_charges WHERE shop_domain = ? AND date = ? LIMIT 1',
    [shop, date]
  );
  if (existing.length > 0 && existing[0].status === 'charged') {
    return { skipped: true, reason: 'already charged' };
  }

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
    'SELECT shop_domain, billable_order_count FROM analytics_daily_rollup WHERE date = ? AND billable_order_count > 0',
    [date]
  );

  const results = [];
  for (const row of rows) {
    const shop = row.shop_domain;
    try {
      const { admin } = await unauthenticated.admin(shop);
      const result = await chargeOverageForShopDate(db, admin, shop, date, row.billable_order_count);
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
    'SELECT billable_order_count FROM analytics_daily_rollup WHERE shop_domain = ? AND date = ? LIMIT 1',
    [shop, today]
  );
  const orderCount = rows[0]?.billable_order_count || 0;

  return chargeOverageForShopDate(db, admin, shop, today, orderCount);
}

// This month's orders against the plan's monthly cap, for the Billing page
// (field names kept from when it showed one day).
export async function getTodayUsage(shop) {
  const db = getDb();
  await ensurePlanTables(db);
  const planKey = await getShopPlan(shop);
  const plan = PLANS[planKey];
  const charges = orderCapBehavior(planKey, await getShopBillingInterval(shop)) === 'charge';
  const today = new Date().toISOString().slice(0, 10);

  const [rows] = await db.execute(
    `SELECT COALESCE(SUM(billable_order_count), 0) AS total, COALESCE(SUM(fbt_order_count), 0) AS fbt,
            COALESCE(SUM(combo_order_count), 0) AS combo,
            COALESCE(SUM(CASE WHEN date = ? THEN billable_order_count ELSE 0 END), 0) AS today
     FROM analytics_daily_rollup WHERE shop_domain = ? AND date >= ? AND date <= ?`,
    [today, shop, today.slice(0, 7) + '-01', today]
  );
  const totalOrders = Number(rows[0]?.total || 0);
  const freeOrders = plan.orderCap;
  const overageOrders = freeOrders === null ? 0 : Math.max(0, totalOrders - freeOrders);
  const pendingCharge = charges ? overageOrders * plan.overageRate : 0;

  // Reporting-only breakdown — an order can be tagged under more than one
  // source, so these can sum to more than total_orders. They don't feed
  // into overage_orders/pending_charge, which stay driven by total_orders
  // alone (see webhooks.orders.paid.jsx for why sources aren't billed
  // separately).
  const fbtOrders = Number(rows[0]?.fbt || 0);
  const comboOrders = Number(rows[0]?.combo || 0);

  return {
    planKey,
    period: 'month',
    free_orders: freeOrders,
    total_orders: totalOrders,
    today_orders: Number(rows[0]?.today || 0),
    overage_orders: overageOrders,
    pending_charge: pendingCharge,
    charges_overage: charges,
    unlimited: freeOrders === null,
    fbt_orders: fbtOrders,
    combo_orders: comboOrders,
    other_orders: Math.max(0, totalOrders - fbtOrders - comboOrders),
  };
}

// Node-side mirror of plan_order_cap_exceeded() in
// php_backend/plan_helpers.php — that PHP function enforces the cutoff for
// the widgets PHP serves; this one is used by the admin Billing dashboard
// and by isStorefrontPaused (combo pages, COD orders), computed the same
// way: current calendar month to date, only for a plan that pauses at its
// cap (Free, or a capped plan billed yearly).
export async function getMonthlyOrderCapStatus(shop) {
  const db = getDb();
  await ensurePlanTables(db);
  const planKey = await getShopPlan(shop);
  const plan = PLANS[planKey];

  // Capped plans that don't bill overage: Free, and Lite / Starter / Growth billed yearly.
  if (orderCapBehavior(planKey, await getShopBillingInterval(shop)) !== 'pause') {
    return { applies: false };
  }

  const monthStart = new Date().toISOString().slice(0, 7) + '-01';
  const [rows] = await db.execute(
    `SELECT COALESCE(SUM(billable_order_count), 0) AS total
     FROM analytics_daily_rollup WHERE shop_domain = ? AND date >= ?`,
    [shop, monthStart]
  );
  const totalOrders = Number(rows[0]?.total || 0);

  return {
    applies: true,
    totalOrders,
    orderCap: plan.orderCap,
    exceeded: totalOrders >= plan.orderCap,
  };
}

// Whether the shop's storefront features are paused for the rest of the
// month (getMonthlyOrderCapStatus().exceeded), for what Node serves to
// shoppers: combo pages and COD orders. Cached a minute per shop; a lookup
// that fails never pauses a store.
const PAUSE_CACHE_MS = 60_000;
const pauseCache = new Map(); // shop -> { paused, expiresAt }

export async function isStorefrontPaused(shop) {
  const hit = pauseCache.get(shop);
  if (hit && hit.expiresAt > Date.now()) return hit.paused;
  let paused = false;
  try {
    paused = Boolean((await getMonthlyOrderCapStatus(shop)).exceeded);
  } catch (err) {
    console.error(`[billing] order cap lookup failed for ${shop}:`, err.message);
  }
  pauseCache.set(shop, { paused, expiresAt: Date.now() + PAUSE_CACHE_MS });
  return paused;
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
