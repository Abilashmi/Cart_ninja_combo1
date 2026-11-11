import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import process from 'node:process';
import { unauthenticated } from '../shopify.server';
import { getDb } from '../services/db.server';
import { MAX_SHOP_TRIAL_DAYS } from '../config/plans';

/**
 * POST /api/admin/trial-extend   { shop, days }
 *
 * Adds `days` to the trial of a store that is in its free trial right now
 * (Shopify appSubscriptionTrialExtend on the shop's ACTIVE subscription).
 * Called only by php_backend/promo_admin.php ("Extend a current trial").
 * shops.trial_days_override only changes the NEXT subscription's trial; a
 * running trial can only be changed this way.
 *
 * Gated by BRIX_ADMIN_SECRET (X-Brix-Admin-Secret), set on both this app and
 * the PHP server. Not X-Forge-Secret: that is SHOPIFY_API_KEY, the public
 * client id, and this endpoint gives away paid days. Fails closed when unset.
 */
export async function action({ request }) {
  if (request.method !== 'POST') return json({ success: false, error: 'POST only.' }, 405);
  if (!isAuthorized(request)) return json({ success: false, error: 'Unauthorized.' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Invalid JSON.' }, 400);
  }

  const shop = String(body?.shop || '').trim().toLowerCase();
  const days = Number(body?.days);
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    return json({ success: false, error: 'Enter a store like 1fd597-3.myshopify.com.' }, 400);
  }
  if (!Number.isInteger(days) || days < 1 || days > MAX_SHOP_TRIAL_DAYS) {
    return json({ success: false, error: `Days must be a whole number from 1 to ${MAX_SHOP_TRIAL_DAYS}.` }, 400);
  }

  let admin;
  try {
    ({ admin } = await unauthenticated.admin(shop));
  } catch {
    return json({ success: false, error: `${shop} has no app session. Is the app installed there?` }, 404);
  }

  try {
    const subRes = await admin.graphql(`
      query ActiveSubscriptions {
        currentAppInstallation { activeSubscriptions { id name status trialDays } }
      }
    `);
    const subData = await subRes.json();
    const subscription = (subData.data?.currentAppInstallation?.activeSubscriptions || [])
      .find((s) => String(s.status || '').toUpperCase() === 'ACTIVE');
    if (!subscription) {
      return json({ success: false, error: `${shop} has no active paid plan, so there is no trial to extend. Use Shop Trials to set the trial for its next plan instead.` }, 409);
    }

    const extRes = await admin.graphql(`
      mutation TrialExtend($id: ID!, $days: Int!) {
        appSubscriptionTrialExtend(id: $id, days: $days) {
          appSubscription { id name status trialDays }
          userErrors { field message code }
        }
      }
    `, { variables: { id: subscription.id, days } });
    const extData = await extRes.json();
    const result = extData.data?.appSubscriptionTrialExtend;
    const userError = result?.userErrors?.[0];
    if (userError || !result?.appSubscription) {
      const message = userError?.code === 'TRIAL_NOT_ACTIVE'
        ? `The trial on ${shop}'s ${subscription.name} plan has already ended, so Shopify can't extend it.`
        : userError?.message || 'Shopify did not extend the trial.';
      return json({ success: false, error: message, code: userError?.code || null }, 422);
    }

    const trialEndsOn = await pushTrialEnd(shop, days);
    console.log(`[TrialExtend] ${shop}: +${days} days on ${subscription.id}, trial now ${result.appSubscription.trialDays} days, ends ${trialEndsOn || 'unknown'}`);

    return json({
      success: true,
      shop,
      days,
      plan: result.appSubscription.name,
      trialDays: result.appSubscription.trialDays,
      trialEndsOn,
    });
  } catch (error) {
    console.error(`[TrialExtend] ${shop} failed:`, error.message);
    return json({ success: false, error: 'Shopify request failed. Try again.' }, 502);
  }
}

export function loader() {
  return json({ success: false, error: 'POST only.' }, 405);
}

// Moves shops.trial_ends_on (synced from the subscriptions webhook) out by the
// same number of days, so overage stays suppressed through the new trial
// (billing.server.js) without waiting on a webhook. A later webhook carrying
// Shopify's own date overwrites it. Returns the new date, or null if unknown.
async function pushTrialEnd(shop, days) {
  try {
    const db = getDb();
    await db.execute(
      `UPDATE shops SET trial_ends_on = DATE_ADD(trial_ends_on, INTERVAL ? DAY), updated_at = NOW()
       WHERE shop_domain = ? AND trial_ends_on IS NOT NULL`,
      [days, shop]
    );
    const [rows] = await db.execute(
      `SELECT DATE_FORMAT(trial_ends_on, '%Y-%m-%d') AS ends FROM shops WHERE shop_domain = ? LIMIT 1`,
      [shop]
    );
    return rows[0]?.ends || null;
  } catch (error) {
    console.error(`[TrialExtend] trial_ends_on update failed for ${shop}:`, error.message);
    return null;
  }
}

function isAuthorized(request) {
  const secret = process.env.BRIX_ADMIN_SECRET || '';
  const given = request.headers.get('x-brix-admin-secret') || '';
  if (!secret || !given) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(data, status = 200) {
  return Response.json(data, { status });
}
