/**
 * Numbers for the personalized Home (components/guide/GuideDashboard.jsx),
 * for stores that picked features in the guided setup. Only what BRIX really
 * records; anything it can't read is null and shows as "No data yet".
 *
 *   impact   revenue and average order of the orders BRIX recorded
 *            (store_order_events, as Home's KPIs) for the period and the
 *            period before it; orders this month against the plan's limit
 *            (analytics_daily_rollup.billable_order_count, as Billing).
 *   plan     the plan's name, monthly price and order limit (config/plans.js).
 *   numbers  per picked feature:
 *     cod       share of the store's orders paid by COD, RTO rate, cash to
 *               collect (BRIX COD orders of the period, as the COD dashboard)
 *     cart      upsell revenue, checkout clicks (cart drawer click tracking)
 *     fbt       orders with FBT products; combo: combo orders (daily rollup)
 *     packs     active Packs (Pack orders aren't recorded)
 *     coupon    coupon clicks
 *     discounts active discounts in Shopify
 *     brix_ai   AI credits used this month
 *
 * Read-only. Never throws: each source has a time limit and is null when it
 * fails. Every source can be replaced (`sources`) for the tests.
 */
import { getDb } from './db.server';
import { getAnalyticsData } from './analytics.server';
import { getShopPlan } from './plan-permissions.server';
import { loadCodOrders, summarizeCodOrders } from './cod.server';
import { listActivePacks } from './packs.server';
import { PLANS } from '../config/plans';
import { addDays } from '../utils/cod-dates.shared';
import { GUIDE_MODULE_IDS } from '../utils/guide.shared.js';

const TIME_LIMIT_MS = 3500;

function settle(promise) {
  let timer;
  return Promise.race([
    Promise.resolve().then(() => promise).catch(() => null),
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), TIME_LIMIT_MS); }),
  ]).finally(() => clearTimeout(timer));
}

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

async function firstRow(sql, params) {
  const [rows] = await getDb().execute(sql, params);
  return Array.isArray(rows) ? rows[0] || null : null;
}

const DEFAULT_SOURCES = {
  analytics: async (shop, from, to) => {
    const res = await getAnalyticsData(shop, from, to);
    return res?.success ? res.data : null;
  },
  plan: (shop) => getShopPlan(shop),
  monthOrders: async (shop, monthStart) => {
    const row = await firstRow('SELECT COALESCE(SUM(billable_order_count), 0) AS total FROM analytics_daily_rollup WHERE shop_domain = ? AND date >= ?', [shop, monthStart]);
    return num(row?.total);
  },
  storeOrders: async (shop, from, to) => {
    const row = await firstRow('SELECT COUNT(*) AS n FROM store_orders WHERE shop_domain = ? AND cancelled_at IS NULL AND created_at_shopify >= ? AND created_at_shopify < ?', [shop, `${from} 00:00:00`, `${addDays(to, 1)} 00:00:00`]);
    return num(row?.n);
  },
  rollup: async (shop, from, to) => {
    const row = await firstRow('SELECT COALESCE(SUM(fbt_order_count), 0) AS fbt, COALESCE(SUM(combo_order_count), 0) AS combo FROM analytics_daily_rollup WHERE shop_domain = ? AND date >= ? AND date <= ?', [shop, from, to]);
    return row ? { fbt: num(row.fbt), combo: num(row.combo) } : null;
  },
  codOrders: async (admin, shop, startMs, endMs) => (await loadCodOrders(admin, shop, { limit: 500, startMs, endMs })).orders,
  activePacks: async (shop) => (await listActivePacks(shop)).length,
  activeDiscounts: async (admin) => {
    if (!admin) return null;
    const res = await admin.graphql(`#graphql
      query BrixDashDiscounts { discountNodes(first: 100, query: "status:active") { edges { node { id } } } }`);
    const json = await res.json();
    if (json?.errors) throw new Error('discounts query failed');
    return (json.data?.discountNodes?.edges || []).length;
  },
  aiCredits: async (shop) => {
    // Loaded only when Brix AI is picked (it brings in the billing / Shopify app setup).
    const { getCreditStatus } = await import('./ai-credits.server');
    const s = await getCreditStatus(shop);
    return s ? { used: num(s.used), limit: num(s.limit) } : null;
  },
};

/**
 * `range` = Home's period ({ from, to, days, startMs, endMs }, utils/cod-dates.shared.js);
 * `current` = Home's analytics for it (or a promise of them), so they aren't read twice.
 */
export async function loadGuideDashboard(shop, { admin = null, modules = [], range, current = null, now = new Date(), sources = {} } = {}) {
  const src = { ...DEFAULT_SOURCES, ...sources };
  const picked = GUIDE_MODULE_IDS.filter((id) => (modules || []).includes(id));
  const days = Math.max(1, Number(range?.days) || 30);
  const prevTo = addDays(range.from, -1);
  const prevFrom = addDays(range.from, -days);
  const monthStart = `${now.toISOString().slice(0, 7)}-01`;
  const has = (id) => picked.includes(id);

  const [cur, prev, planKey, usedThisMonth, cod, storeOrders, rollNow, rollPrev, packs, discounts, ai] = await Promise.all([
    settle(current),
    settle(src.analytics(shop, prevFrom, prevTo)),
    settle(src.plan(shop)),
    settle(src.monthOrders(shop, monthStart)),
    has('cod') ? settle(src.codOrders(admin, shop, range.startMs, range.endMs)) : null,
    has('cod') ? settle(src.storeOrders(shop, range.from, range.to)) : null,
    has('fbt') || has('combo') ? settle(src.rollup(shop, range.from, range.to)) : null,
    has('fbt') || has('combo') ? settle(src.rollup(shop, prevFrom, prevTo)) : null,
    has('packs') ? settle(src.activePacks(shop)) : null,
    has('discounts') ? settle(src.activeDiscounts(admin)) : null,
    has('brix_ai') ? settle(src.aiCredits(shop)) : null,
  ]);

  const plan = PLANS[planKey] || PLANS.free;
  const value = (data, key) => (data ? num(data[key]) : null);

  const numbers = [];
  const add = (module, id, kind, now_, prev_, note, extra = {}) => numbers.push({ module, id, kind, value: now_ ?? null, prev: prev_ ?? null, note, ...extra });
  for (const id of picked) {
    if (id === 'cod') {
      const list = Array.isArray(cod) ? cod : null;
      const summary = list ? summarizeCodOrders(list) : null;
      const count = summary ? summary.count : null;
      const rto = list ? list.filter((o) => o.lifecycle === 'rto').length : null;
      add('cod', 'cod_share', 'percent', count != null && storeOrders > 0 ? (count / storeOrders) * 100 : null, null, 'in_period');
      add('cod', 'cod_rto', 'percent', count > 0 ? (rto / count) * 100 : null, null, 'lower_better');
      add('cod', 'cod_collect', 'money', summary ? summary.toCollect : null, null, 'in_period');
    }
    if (id === 'cart') {
      add('cart', 'cart_upsell', 'money', value(cur, 'upsell_revenue_generated'), value(prev, 'upsell_revenue_generated'), 'vs_prev');
      add('cart', 'cart_checkout', 'count', value(cur, 'checkout_click'), value(prev, 'checkout_click'), 'vs_prev');
    }
    if (id === 'fbt') add('fbt', 'fbt_orders', 'count', rollNow?.fbt, rollPrev?.fbt, 'vs_prev');
    if (id === 'combo') add('combo', 'combo_orders', 'count', rollNow?.combo, rollPrev?.combo, 'vs_prev');
    if (id === 'packs') add('packs', 'packs_active', 'count', num(packs), null, 'right_now');
    if (id === 'coupon') add('coupon', 'coupon_clicks', 'count', value(cur, 'coupon_click'), value(prev, 'coupon_click'), 'vs_prev');
    if (id === 'discounts') add('discounts', 'discounts_active', 'count', num(discounts), null, 'right_now', { capped: num(discounts) >= 100 });
    if (id === 'brix_ai') add('brix_ai', 'ai_credits', 'count', ai?.used ?? null, null, 'this_month', { limit: ai?.limit ?? null });
  }

  return {
    modules: picked,
    period: { from: range.from, to: range.to, days, prevFrom, prevTo },
    impact: {
      revenue: { now: value(cur, 'cartdrawer_total_revenue'), prev: value(prev, 'cartdrawer_total_revenue') },
      aov: { now: value(cur, 'avg_order_value'), prev: value(prev, 'avg_order_value') },
      orders: { now: value(cur, 'order_count'), prev: value(prev, 'order_count') },
    },
    plan: { key: plan.key, label: plan.label, price: plan.price?.monthly ?? 0, cap: plan.orderCap ?? null, used: usedThisMonth },
    numbers,
  };
}
