import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';
import { getShopPlan } from '../services/plan-permissions.server';
import { saveProgressBarSettings } from '../services/cart-config-writes.server';
import { syncRewardGiftDiscount } from '../services/reward-gift-shopify.server';
import { getShopCurrency } from '../utils/currency.server';

async function fetchProgressBar(db, shop) {
  const [rows] = await db.execute(
    'SELECT * FROM progress_bar_settings WHERE shop_domain = ? LIMIT 1', [shop]
  );
  const settings = rows[0] || null;
  if (!settings) return null;
  const [tierRows] = await db.execute(
    'SELECT * FROM progress_bar_tiers WHERE settings_id = ? AND is_active = 1 ORDER BY sort_order ASC',
    [settings.id]
  );
  settings.tiers = tierRows.map((t) => ({
    ...t,
    reward_products: t.reward_products
      ? (typeof t.reward_products === 'string'
          ? (() => { try { return JSON.parse(t.reward_products); } catch { return []; } })()
          : t.reward_products)
      : [],
  }));
  return settings;
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const db = getDb();
  const data = await fetchProgressBar(db, session.shop).catch(() => null);
  return Response.json({ success: !!data, data });
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();

  // The manual editor's full save always sends the complete `tiers` array
  // (a delete-and-reinsert-all is the correct behavior here — it owns the
  // whole ladder), matching this route's historical behavior exactly.
  const planKey = await getShopPlan(shop);
  const before = await fetchProgressBar(getDb(), shop).catch(() => null);
  const data = await saveProgressBarSettings(shop, planKey, { ...body, tiers: body.tiers ?? [] });

  // Free reward products are made free at checkout by a Shopify discount
  // Function whose config mirrors the saved bar — keep it in step (also when a
  // product reward was just removed). Best-effort: the save itself never fails
  // because of it, and the result says exactly what is (not) live.
  const isProductTier = (t) => (t.reward_products || t.products || t.rewardProducts || []).length > 0;
  const touchesGifts = (body.tiers ?? []).some(isProductTier) || (before?.tiers || []).some(isProductTier);
  let giftDiscount = null;
  if (touchesGifts && admin) {
    const currency = await getShopCurrency(admin, shop).catch(() => null);
    giftDiscount = await syncRewardGiftDiscount(admin, shop, { currencyCode: currency?.code ?? null });
  }
  return Response.json({ success: true, data, giftDiscount });
}
