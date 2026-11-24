// Run with: node --import ./tests/packs/register.mjs --test tests/onboarding
// The personalized Home: tips and tutorials for what the store picked, the
// change against the previous period, and the numbers read from fake sources
// (no database, no Shopify).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickTips, tipsHeading, pickTutorials, compareWithPrevious, GUIDE_TIPS, GUIDE_TUTORIALS } from '../../app/utils/guide-dashboard.shared.js';
import { GUIDE_MODULE_IDS } from '../../app/utils/guide.shared.js';

const { loadGuideDashboard } = await import('../../app/services/guide-dashboard.server.js');

test('tips follow the payment answer and the picked features', () => {
  assert.deepEqual(pickTips('prepaid', ['cod', 'packs']).map((t) => t.id), ['cod_prepaid', 'packs_bestsellers'], 'no OTP tip for a prepaid store');
  assert.deepEqual(pickTips('postpaid', ['cod', 'packs']).map((t) => t.id), ['cod_otp', 'cod_prepaid']);
  assert.deepEqual(pickTips('both', ['fbt']).map((t) => t.id), ['fbt_orders', 'embed_on'], 'the general tip fills in');
  assert.equal(tipsHeading('prepaid'), 'admin.gdash.tips_prepaid');
  assert.equal(tipsHeading('postpaid'), 'admin.gdash.tips_cod');
  assert.equal(tipsHeading('both'), 'admin.gdash.tips_store');
});

test('tips say how, never promise a result (Built for Shopify 4.3.1)', async () => {
  const fs = await import('node:fs');
  const en = JSON.parse(fs.readFileSync('app/i18n/en.json', 'utf8'));
  for (const tip of GUIDE_TIPS) {
    const text = `${en[tip.title]} ${en[tip.body]}`;
    assert.ok(en[tip.title] && en[tip.body], tip.id);
    assert.doesNotMatch(text, /\d+\s*%\s*(more|higher|increase|boost)|\d+\s*[x×]\s|guarantee|double your/i, tip.id);
  }
});

test('tutorials: basics of each picked feature first, real video links only', () => {
  const list = pickTutorials(['packs', 'cod', 'cart']);
  assert.deepEqual(list.map((t) => t.id), ['cod_basics', 'cart_basics', 'packs_basics', 'cod_more']);
  assert.equal(list.find((t) => t.id === 'cart_basics').url.startsWith('https://www.youtube.com/embed/'), true);
  assert.equal(list.find((t) => t.id === 'cod_basics').url, '', 'no COD video yet: the card says so');
  for (const id of GUIDE_MODULE_IDS) assert.ok(GUIDE_TUTORIALS[id]?.length, `${id} has a tutorial`);
});

test('change against the previous period', () => {
  assert.deepEqual(compareWithPrevious(120, 100), { pct: 20, direction: 'up' });
  assert.deepEqual(compareWithPrevious(50, 100), { pct: 50, direction: 'down' });
  assert.deepEqual(compareWithPrevious(100, 100), { pct: 0, direction: 'same' });
  assert.equal(compareWithPrevious(100, 0), null, 'nothing to compare with');
  assert.equal(compareWithPrevious(null, 10), null);
});

const RANGE = { from: '2026-10-26', to: '2026-11-24', days: 30, startMs: Date.parse('2026-10-26T00:00:00Z'), endMs: Date.parse('2026-11-25T00:00:00Z'), label: 'Last 30 days' };
const NOW = new Date('2026-11-24T10:00:00Z');

function fakes(over = {}) {
  const calls = [];
  return {
    calls,
    sources: {
      analytics: async (shop, from, to) => { calls.push(['analytics', from, to]); return { cartdrawer_total_revenue: 800, avg_order_value: 400, order_count: 2, upsell_revenue_generated: 100, checkout_click: 30, coupon_click: 5 }; },
      plan: async () => 'free',
      monthOrders: async (shop, monthStart) => { calls.push(['month', monthStart]); return 12; },
      storeOrders: async () => 40,
      rollup: async (shop, from) => (from === RANGE.from ? { fbt: 6, combo: 2 } : { fbt: 3, combo: 0 }),
      codOrders: async () => [
        { status: 'pending', total: 500, lifecycle: 'placed' },
        { status: 'paid', total: 700, lifecycle: 'paid' },
        { status: 'pending', total: 300, lifecycle: 'rto' },
        { status: 'cancelled', total: 200, lifecycle: 'cancelled' },
      ],
      activePacks: async () => 3,
      activeDiscounts: async () => 120,
      aiCredits: async () => ({ used: 4, limit: 10 }),
      ...over,
    },
  };
}

test('impact: this period vs the one before, orders this month vs the plan', async () => {
  const f = fakes();
  const current = { cartdrawer_total_revenue: 1000, avg_order_value: 500, order_count: 2 };
  const d = await loadGuideDashboard('demo.myshopify.com', { modules: ['cod'], range: RANGE, current: Promise.resolve(current), now: NOW, sources: f.sources });
  assert.deepEqual(d.period, { from: '2026-10-26', to: '2026-11-24', days: 30, prevFrom: '2026-09-26', prevTo: '2026-10-25' });
  assert.ok(f.calls.some(([k, from, to]) => k === 'analytics' && from === '2026-09-26' && to === '2026-10-25'), 'previous period read');
  assert.deepEqual(d.impact.revenue, { now: 1000, prev: 800 });
  assert.deepEqual(d.impact.aov, { now: 500, prev: 400 });
  assert.deepEqual(d.plan, { key: 'free', label: 'Free', price: 0, cap: 50, used: 12 });
  assert.ok(f.calls.some(([k, start]) => k === 'month' && start === '2026-11-01'));
});

test('numbers only for the picked features, from their own data', async () => {
  const f = fakes();
  const d = await loadGuideDashboard('demo.myshopify.com', { modules: ['packs', 'cod'], range: RANGE, current: {}, now: NOW, sources: f.sources });
  assert.deepEqual(d.modules, ['cod', 'packs'], 'setup order');
  const byId = Object.fromEntries(d.numbers.map((n) => [n.id, n]));
  assert.deepEqual(Object.keys(byId), ['cod_share', 'cod_rto', 'cod_collect', 'packs_active']);
  assert.equal(byId.cod_share.value, 10, '4 COD orders of 40');
  assert.equal(byId.cod_rto.value, 25, '1 of 4 came back');
  assert.equal(byId.cod_collect.value, 800, 'the pending ones');
  assert.equal(byId.packs_active.value, 3);
});

test('every feature has its numbers; FBT / combo compare with the period before', async () => {
  const f = fakes();
  const d = await loadGuideDashboard('demo.myshopify.com', { modules: ['cart', 'fbt', 'combo', 'coupon', 'discounts', 'brix_ai'], range: RANGE, current: { upsell_revenue_generated: 150, checkout_click: 45, coupon_click: 9 }, now: NOW, sources: f.sources });
  const byId = Object.fromEntries(d.numbers.map((n) => [n.id, n]));
  assert.deepEqual([byId.cart_upsell.value, byId.cart_upsell.prev], [150, 100]);
  assert.deepEqual([byId.fbt_orders.value, byId.fbt_orders.prev], [6, 3]);
  assert.deepEqual([byId.combo_orders.value, byId.combo_orders.prev], [2, 0]);
  assert.equal(byId.coupon_clicks.value, 9);
  assert.equal(byId.discounts_active.value, 120);
  assert.equal(byId.discounts_active.capped, true, '100 or more');
  assert.deepEqual([byId.ai_credits.value, byId.ai_credits.limit], [4, 10]);
});

test('a source that fails or has nothing is unknown, never a made-up number', async () => {
  const f = fakes({
    analytics: async () => { throw new Error('upstream down'); },
    codOrders: async () => { throw new Error('PHP down'); },
    storeOrders: async () => 0,
    monthOrders: async () => { throw new Error('db down'); },
  });
  const d = await loadGuideDashboard('demo.myshopify.com', { modules: ['cod', 'cart'], range: RANGE, current: null, now: NOW, sources: f.sources });
  assert.equal(d.impact.revenue.now, null);
  assert.equal(d.impact.revenue.prev, null);
  assert.equal(d.plan.used, null);
  const byId = Object.fromEntries(d.numbers.map((n) => [n.id, n]));
  assert.equal(byId.cod_share.value, null);
  assert.equal(byId.cod_rto.value, null);
  assert.equal(byId.cod_collect.value, null);
  assert.equal(byId.cart_upsell.value, null);
});

test('features not picked are never read', async () => {
  let read = 0;
  const count = async () => { read++; return 1; };
  const f = fakes({ codOrders: count, activePacks: count, activeDiscounts: count, aiCredits: count, rollup: count, storeOrders: count });
  await loadGuideDashboard('demo.myshopify.com', { modules: ['cart'], range: RANGE, current: {}, now: NOW, sources: f.sources });
  assert.equal(read, 0);
});
