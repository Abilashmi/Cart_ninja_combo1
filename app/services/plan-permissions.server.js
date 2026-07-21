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

// A locally-resolved 'free' shop gets re-verified against Shopify's own
// Billing API at most this often. Catches two distinct cases with one
// mechanism: shops that predate plan_key tracking entirely (subscription_id
// never recorded), *and* shops whose locally-recorded subscription_id/status
// has gone stale or wrong (e.g. a webhook recorded CANCELLED while Shopify's
// own Manage App page still shows the subscription active/billing) — trusting
// "we already have a subscription_id on file" turned out not to be safe,
// so this re-checks periodically rather than only once-ever.
const PLAN_LIVE_SYNC_TTL_MS = 24 * 60 * 60 * 1000;

// `admin` is optional and only available to callers running inside an
// authenticated Shopify request (e.g. app/routes/app.jsx's root loader). When
// present, and the shop resolves to 'free' locally but hasn't been verified
// against Shopify's Billing API recently, this reconciles — see
// reconcilePlanFromShopify below for why that's necessary.
export async function getShopPlan(shop, admin = null) {
  if (!shop) return 'free';

  const cached = planCache.get(shop);
  if (cached && cached.expiresAt > Date.now()) return cached.planKey;

  let planKey = 'free';
  let needsLiveSync = false;
  try {
    const db = getDb();
    await ensurePlanTables(db);

    const [rows] = await db.execute(
      'SELECT plan_key, plan_name, subscription_id, plan_synced_at FROM shops WHERE shop_domain = ? LIMIT 1',
      [shop]
    );

    if (rows.length > 0) {
      const row = rows[0];
      if (row.plan_key && isValidPlanKey(row.plan_key)) {
        planKey = row.plan_key;
      } else {
        planKey = aliasLegacyPlanName(row.plan_name);
      }
      const syncedAt = row.plan_synced_at ? new Date(row.plan_synced_at).getTime() : 0;
      needsLiveSync = Boolean(admin) && planKey === 'free' && (Date.now() - syncedAt) > PLAN_LIVE_SYNC_TTL_MS;
    }
  } catch (error) {
    console.error('[Plan] ❌ Failed to resolve shop plan:', error.message);
  }

  if (needsLiveSync) {
    try {
      planKey = await reconcilePlanFromShopify(shop, admin);
    } catch (error) {
      console.error('[Plan] ❌ Live reconciliation against Shopify failed:', error.message);
    }
  }

  planCache.set(shop, { planKey, expiresAt: Date.now() + CACHE_TTL_MS });
  return planKey;
}

function invalidateShopPlanCache(shop) {
  planCache.delete(shop);
}

// Gates app access on having approved a real Shopify subscription at least
// once — including Free, which is created as a $0 usage-only subscription
// specifically so its overage line item exists (see app.subscribe.jsx's
// action). Without this, a shop can use the app past its free order/AI BRIX
// caps indefinitely: chargeOverageForShopDate in billing.server.js only
// *attempts* a charge once a shop crosses its cap, and that attempt silently
// fails with no subscription line item to attach it to — nothing else stops
// the merchant from continuing to use the app uncharged. Must check
// subscription_status = 'active' specifically, not just subscription_id
// presence — Shopify fires app_subscriptions/update (and this app's own
// webhook handler writes subscription_id) the moment a subscription is
// *created* as PENDING too, before the merchant has actually clicked Approve
// on Shopify's own confirmation page. Treating PENDING as approved would
// lock a merchant who merely clicked a plan button (without finishing
// approval) out of ever seeing the subscribe page again. Fails open (treats
// as approved) on DB errors — a transient DB/proxy outage locking every
// merchant out of the entire app would be far worse than the revenue gap
// this closes.
// `admin` is optional; when provided it's used as a fallback live check
// (see below) for the moment right after a merchant approves a subscription
// and Shopify redirects them back — the webhook that writes subscription
// status to the DB is async and isn't guaranteed to have landed yet, and
// without this fallback that race would bounce a merchant who just approved
// straight back to /app/subscribe.
export async function hasApprovedSubscription(shop, admin = null) {
  if (!shop) return false;
  try {
    const db = getDb();
    await ensurePlanTables(db);
    const [rows] = await db.execute(
      'SELECT subscription_id, subscription_status FROM shops WHERE shop_domain = ? LIMIT 1',
      [shop]
    );
    if (rows[0]?.subscription_id && String(rows[0]?.subscription_status || '').toLowerCase() === 'active') {
      return true;
    }
  } catch (error) {
    console.error('[Plan] ❌ Failed to check subscription approval:', error.message);
    return true; // fail open — a DB hiccup shouldn't lock everyone out.
  }

  if (!admin) return false;
  try {
    const res = await admin.graphql(`query { currentAppInstallation { activeSubscriptions { id status } } }`);
    const data = await res.json();
    const subs = data.data?.currentAppInstallation?.activeSubscriptions || [];
    return subs.some((s) => String(s.status || '').toUpperCase() === 'ACTIVE');
  } catch (error) {
    console.error('[Plan] ❌ Live subscription check failed:', error.message);
    return false;
  }
}

// One-time backfill for shops whose subscription predates this app's
// plan_key tracking. Shopify only fires app_subscriptions/update on status
// *changes* — a subscription that's been sitting ACTIVE since before this
// system existed never re-fires it, so plan_key stays stuck at the column's
// 'free' default forever unless something actively checks Shopify's own
// Billing API. Runs at most once per shop (gated by plan_synced_at in
// getShopPlan) so genuinely-free shops don't pay this GraphQL round-trip on
// every request.
async function reconcilePlanFromShopify(shop, admin) {
  const db = getDb();
  await ensurePlanTables(db);

  let resolvedPlanKey = 'free';
  try {
    const res = await admin.graphql(`
      query {
        currentAppInstallation {
          activeSubscriptions {
            id
            name
            status
            lineItems {
              plan {
                pricingDetails {
                  __typename
                  ... on AppRecurringPricing { price { amount } }
                }
              }
            }
          }
        }
      }
    `);
    const data = await res.json();
    // activeSubscriptions returns both ACTIVE and PENDING subscriptions —
    // Shopify already excludes cancelled/declined/expired/frozen ones, but
    // PENDING means merely *created*, not yet approved by the merchant on
    // Shopify's own confirmation page. Only an ACTIVE one legitimately
    // grants plan access; a PENDING one is still recorded below (so it's
    // trackable once it transitions), it just doesn't resolve a paid
    // plan_key prematurely.
    const subs = data.data?.currentAppInstallation?.activeSubscriptions || [];
    const activeSub = subs.find((s) => String(s.status || '').toUpperCase() === 'ACTIVE');
    const sub = activeSub || subs[0];

    if (sub) {
      const recurringLine = sub.lineItems?.find(
        (li) => li.plan?.pricingDetails?.__typename === 'AppRecurringPricing'
      );
      const amount = parseFloat(recurringLine?.plan?.pricingDetails?.price?.amount || '0');
      // Match by the actual billed price first — pre-migration subscriptions
      // used ad-hoc names ("Cart Ninja Pro" was really the old $29 tier, see
      // aliasLegacyPlanName below), so price is the more reliable signal.
      // Falls back to name matching only for $0 usage-only subscriptions
      // where price can't disambiguate.
      const byPrice = PLAN_KEYS.find((key) => amount > 0 && PLANS[key].price.monthly === amount);
      resolvedPlanKey = activeSub ? (byPrice || aliasLegacyPlanName(sub.name)) : 'free';

      await db.execute(
        `INSERT INTO shops (shop_domain, plan_key, plan_name, subscription_id, subscription_status, pending_plan_key, plan_synced_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, NOW(), NOW())
         ON DUPLICATE KEY UPDATE plan_key = VALUES(plan_key), plan_name = VALUES(plan_name), subscription_id = VALUES(subscription_id), subscription_status = VALUES(subscription_status), pending_plan_key = NULL, plan_synced_at = NOW(), updated_at = NOW()`,
        [shop, resolvedPlanKey, sub.name, sub.id, String(sub.status || '').toLowerCase()]
      );
    } else {
      // No live subscription found on Shopify's side either — mark checked
      // so this shop's genuinely-free status doesn't retrigger a GraphQL
      // call on every future request.
      await db.execute(`UPDATE shops SET plan_synced_at = NOW() WHERE shop_domain = ?`, [shop]);
    }
  } finally {
    invalidateShopPlanCache(shop);
  }

  return resolvedPlanKey;
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
