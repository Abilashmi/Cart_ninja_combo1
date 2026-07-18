import { getDb } from './db.server';
import { ensurePlanTables } from './plan-schema.server';
import {
  PLANS,
  PLAN_KEYS,
  isValidPlanKey,
  getFeatureState as configGetFeatureState,
  canAccessFeature as configCanAccessFeature,
  canPublishFeature as configCanPublishFeature,
  canPreviewFeature as configCanPreviewFeature,
  getMinPlanForFeature,
} from '../config/plans';

// Short-lived in-process cache so multiple loaders/actions on the same
// request cycle don't each hit the DB for the same shop's plan.
const CACHE_TTL_MS = 30_000;
const planCache = new Map(); // shop -> { planKey, expiresAt }

// Legacy shops.plan_name values (set before plan_key existed) mapped to the
// new canonical plan keys. Only used as a fallback for rows that predate
// the plan_key column — never used once plan_key is populated.
function aliasLegacyPlanName(planName) {
  if (!planName) return 'free';
  const normalized = String(planName).toLowerCase();
  if (normalized === 'free') return 'free';
  if (normalized.includes('pro')) return 'pro';
  // Any other historical subscription name ("Cart Ninja Pro" was actually
  // the old $29 tier despite the name) maps to starter.
  return 'starter';
}

export async function getShopPlan(shop) {
  if (!shop) return 'free';

  const cached = planCache.get(shop);
  if (cached && cached.expiresAt > Date.now()) return cached.planKey;

  let planKey = 'free';
  try {
    const db = getDb();
    await ensurePlanTables(db);

    const [rows] = await db.execute(
      'SELECT plan_key, plan_name FROM shops WHERE shop_domain = ? LIMIT 1',
      [shop]
    );

    if (rows.length > 0) {
      const row = rows[0];
      if (row.plan_key && isValidPlanKey(row.plan_key)) {
        planKey = row.plan_key;
      } else {
        planKey = aliasLegacyPlanName(row.plan_name);
      }
    }
  } catch (error) {
    console.error('[Plan] ❌ Failed to resolve shop plan:', error.message);
  }

  planCache.set(shop, { planKey, expiresAt: Date.now() + CACHE_TTL_MS });
  return planKey;
}

function invalidateShopPlanCache(shop) {
  planCache.delete(shop);
}

// Called by app.subscribe.jsx's action right after Shopify confirms a
// subscription was created, before redirecting the merchant to the
// confirmation URL. Records the *intended* plan so the webhook can promote
// it once the merchant actually confirms — this is how plan_key is set
// explicitly, rather than ever being inferred by parsing the Shopify
// subscription name string.
export async function setPendingPlanKey(shop, planKey) {
  if (!shop || !isValidPlanKey(planKey)) return;
  const db = getDb();
  await ensurePlanTables(db);
  await db.execute(
    `INSERT INTO shops (shop_domain, pending_plan_key, updated_at)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE pending_plan_key = VALUES(pending_plan_key), updated_at = NOW()`,
    [shop, planKey]
  );
  invalidateShopPlanCache(shop);
}

// Called by the app_subscriptions/update webhook handler once Shopify
// reports a subscription status. `planHandle` is Shopify's own
// `plan_handle` field from the webhook payload (e.g. "starter", "pro") and
// is the primary signal — it identifies the subscription's plan directly,
// unlike pending_plan_key which is this app's own handoff flag and breaks
// under rapid plan switching (see below). Falls back to pending_plan_key
// only for payloads that lack a recognized plan_handle. On cancel/decline/
// expire, only falls back to free if there's no pending_plan_key waiting on
// a still-in-flight ACTIVE webhook for a replacement subscription —
// otherwise leaves plan_key untouched. Returns the resolved plan_key.
export async function confirmPlanFromWebhook(shop, subscriptionStatus, planHandle) {
  if (!shop) return 'free';
  const db = getDb();
  await ensurePlanTables(db);

  const status = String(subscriptionStatus || '').toLowerCase();
  const isActive = status === 'active' || status === 'pending';
  const handleKey = String(planHandle || '').toLowerCase();

  const [rows] = await db.execute(
    'SELECT plan_key, pending_plan_key FROM shops WHERE shop_domain = ? LIMIT 1',
    [shop]
  );
  const row = rows[0];

  if (isActive) {
    // Rapid plan switching (e.g. Free -> Starter -> Pro within seconds)
    // fires multiple ACTIVE webhooks for different subscriptions in
    // whichever order they're delivered — an earlier one can already
    // consume/clear pending_plan_key before a later one for a different
    // subscription is processed, causing that later webhook to wrongly fall
    // back to the shop's current plan_key. Shopify's own plan_handle on
    // each webhook sidesteps that entirely: it always names the plan for
    // *this* specific subscription, so it's trusted first.
    const resolvedPlanKey = isValidPlanKey(handleKey)
      ? handleKey
      : (row?.pending_plan_key && isValidPlanKey(row.pending_plan_key))
        ? row.pending_plan_key
        : (row?.plan_key && isValidPlanKey(row.plan_key) ? row.plan_key : 'free');

    await db.execute(
      `INSERT INTO shops (shop_domain, plan_key, pending_plan_key, updated_at)
       VALUES (?, ?, NULL, NOW())
       ON DUPLICATE KEY UPDATE plan_key = VALUES(plan_key), pending_plan_key = NULL, updated_at = NOW()`,
      [shop, resolvedPlanKey]
    );
    invalidateShopPlanCache(shop);
    return resolvedPlanKey;
  }

  // Terminal/negative statuses (CANCELLED, DECLINED, EXPIRED, FROZEN) fire
  // for the *old* subscription during a plan switch — cancelActiveSubscription
  // in app.subscribe.jsx cancels the previous plan right before creating the
  // new one, so this webhook can arrive before or after the new plan's ACTIVE
  // webhook in either order. It must never clear pending_plan_key: doing so
  // unconditionally previously let a same-moment CANCELLED delivery for the
  // old plan wipe the pending flag meant for the new plan, causing the
  // merchant's plan to fall back to 'free' after an upgrade. It also must
  // not downgrade plan_key here — that only happens once the ACTIVE webhook
  // for a replacement subscription confirms there isn't one, or a genuine
  // standalone cancellation (no pending switch in flight) should still drop
  // the shop to free.
  const hasPendingSwitch = row?.pending_plan_key && isValidPlanKey(row.pending_plan_key);
  const resolvedPlanKey = hasPendingSwitch
    ? (row?.plan_key && isValidPlanKey(row.plan_key) ? row.plan_key : 'free')
    : 'free';

  await db.execute(
    `INSERT INTO shops (shop_domain, plan_key, updated_at)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE plan_key = VALUES(plan_key), updated_at = NOW()`,
    [shop, resolvedPlanKey]
  );
  invalidateShopPlanCache(shop);
  return resolvedPlanKey;
}

export function getFeatureState(planKey, featureKey) {
  return configGetFeatureState(planKey, featureKey);
}
export function canAccessFeature(planKey, featureKey) {
  return configCanAccessFeature(planKey, featureKey);
}
export function canPublishFeature(planKey, featureKey) {
  return configCanPublishFeature(planKey, featureKey);
}
export function canPreviewFeature(planKey, featureKey) {
  return configCanPreviewFeature(planKey, featureKey);
}

export { PLANS, PLAN_KEYS, getMinPlanForFeature };
