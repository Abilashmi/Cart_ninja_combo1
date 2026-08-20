import { getDb } from './db.server';
import { ensurePromoTables } from './promo-schema.server';

// Whether a shop should get the free-trial promo on its next
// appSubscriptionCreate call. Fails closed (false) on any DB error — unlike
// getShopPlan's fail-open pattern, a missed promo just means the merchant is
// billed from day 1 instead of getting a trial, not a lockout.
export async function isPromoEligible(shop) {
  if (!shop) return false;
  try {
    const db = getDb();
    await ensurePromoTables(db);
    const [rows] = await db.execute(
      'SELECT promo_eligible FROM shops WHERE shop_domain = ? LIMIT 1',
      [shop]
    );
    return Boolean(rows[0]?.promo_eligible);
  } catch (error) {
    console.error('[Promo] ❌ Failed to resolve promo eligibility:', error.message);
    return false;
  }
}

// Validates and redeems a promo code for a shop. Idempotent — re-submitting
// the same already-redeemed code returns success without double-incrementing
// uses_count.
export async function redeemPromoCode(shop, code) {
  const trimmed = (code || '').trim();
  if (!trimmed) return { success: false, error: 'Enter a promo code.' };

  const db = getDb();
  await ensurePromoTables(db);

  const [shopRows] = await db.execute(
    'SELECT promo_eligible, promo_code_used FROM shops WHERE shop_domain = ? LIMIT 1',
    [shop]
  );
  if (shopRows[0]?.promo_eligible && shopRows[0]?.promo_code_used === trimmed) {
    return { success: true, alreadyApplied: true };
  }

  const [codeRows] = await db.execute(
    `SELECT id, max_uses, uses_count, expires_at, is_active FROM promo_codes
     WHERE code = ? LIMIT 1`,
    [trimmed]
  );
  const promoCode = codeRows[0];
  const isExpired = promoCode?.expires_at && new Date(promoCode.expires_at) < new Date();
  const isExhausted = promoCode?.max_uses != null && promoCode.uses_count >= promoCode.max_uses;
  if (!promoCode || !promoCode.is_active || isExpired || isExhausted) {
    return { success: false, error: 'Invalid or expired promo code.' };
  }

  await db.execute(
    `INSERT INTO shops (shop_domain, promo_eligible, promo_code_used, updated_at)
     VALUES (?, 1, ?, NOW())
     ON DUPLICATE KEY UPDATE promo_eligible = 1, promo_code_used = VALUES(promo_code_used), updated_at = NOW()`,
    [shop, trimmed]
  );
  await db.execute('UPDATE promo_codes SET uses_count = uses_count + 1 WHERE id = ?', [promoCode.id]);

  return { success: true };
}
