// Run with: node --import ./tests/packs/register.mjs --test tests/ai-handoff
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTips } from '../../app/utils/tip-parser.js';
import { resolveReportPeriod } from '../../app/services/sales-report.server.js';

const AOV_REPLY = `To increase your Average Order Value (AOV), consider these strategies:

1. **Upselling and Cross-selling**: Use upsell products in your cart drawer.

2. **Bundling Products**: Create bundles or combo offers
that give a discount.

3. **Free Shipping Threshold**: Set a free shipping goal slightly above your AOV.

Want me to set one of these up for you?`;

test('numbered advice becomes intro + tip cards + outro', () => {
  const r = parseTips(AOV_REPLY);
  assert.equal(r.tips.length, 3);
  assert.equal(r.tips[0].title, 'Upselling and Cross-selling');
  assert.equal(r.tips[0].body, 'Use upsell products in your cart drawer.');
  assert.equal(r.tips[1].body, 'Create bundles or combo offers that give a discount.');
  assert.match(r.intro, /^To increase your Average Order Value/);
  assert.equal(r.outro, 'Want me to set one of these up for you?');
});
test('title with the colon inside the bold is handled', () => {
  const r = parseTips('1. **Upsells:** show add-ons\n2. **Bundles:** sell sets');
  assert.deepEqual(r.tips.map((t) => t.title), ['Upsells', 'Bundles']);
  assert.equal(r.tips[1].body, 'sell sets');
});
test('plain answers, single items and untitled bullets are left alone', () => {
  assert.equal(parseTips('Your Progress Bar is enabled.\n\nGoal: 999'), null);
  assert.equal(parseTips('1. Only one item'), null);
  assert.equal(parseTips('- red\n- blue\n- green'), null);
  assert.equal(parseTips(''), null);
});
test('bold-titled bullets also become cards', () => {
  assert.equal(parseTips('Ideas:\n- **A**: one\n- **B**: two').tips.length, 2);
});

test('report periods resolve to the right local dates', () => {
  const now = new Date(2026, 8, 25); // 25 Sep 2026
  const d = (x) => `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`;
  const p7 = resolveReportPeriod('last_7_days', now);
  assert.equal(d(p7.start), '2026-9-19');
  assert.equal(d(p7.end), '2026-9-25');
  const lm = resolveReportPeriod('last_month', now);
  assert.equal(d(lm.start), '2026-8-1');
  assert.equal(d(lm.end), '2026-8-31');
  const tm = resolveReportPeriod('this_month', now);
  assert.equal(d(tm.start), '2026-9-1');
  assert.equal(resolveReportPeriod('bogus', now).key, 'last_30_days');
});

test('plain manual steps stay a numbered list, only titled ideas become cards', () => {
  assert.equal(parseTips('Steps:\n1. Go to your Shopify admin panel.\n2. Click on **Discounts**.\n3. Click **Create Discount**.'), null);
  assert.equal(parseTips('1. **A**: one\n2. plain two'), null);
});

import { formatMoneyWhole } from '../../app/utils/money-display.js';
test('whole amounts lose ".00" but never a thousands group', () => {
  assert.equal(formatMoneyWhole(3000, { currencyCode: 'USD' }), '$3,000');
  assert.equal(formatMoneyWhole(10000, { currencyCode: 'USD' }), '$10,000');
  assert.equal(formatMoneyWhole(1000000, { currencyCode: 'USD' }), '$1,000,000');
  assert.equal(formatMoneyWhole(84500, { currencyCode: 'INR', locale: 'en-IN' }), '₹84,500');
  assert.equal(formatMoneyWhole(12.5, { currencyCode: 'USD' }), '$12.50');
  assert.equal(formatMoneyWhole(1500, { currencyCode: 'EUR', locale: 'de-DE' }), '1.500 €');
});
