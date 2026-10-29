// Run with: node --import ./tests/packs/register.mjs --test tests/billing/annual-plans.test.mjs
// Yearly billing (app/config/plans.js): same 14-day trial, no usage charges (Shopify
// allows none on a yearly subscription), so past the monthly order cap the
// storefront pauses and AI BRIX stops at its credits. The PHP mirror of the
// order cap is plan_order_cap_exceeded in php_backend/plan_helpers.php.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PLANS, normalizeBillingInterval, billsUsage, orderCapBehavior, aiCreditAllowed, trialDaysFor,
  TRIAL_DAYS, dayOverageOrders,
} from '../../app/config/plans.js';

test('intervals: Shopify ANNUAL / annual / yearly = annual, anything else = monthly', () => {
  for (const v of ['ANNUAL', 'annual', 'Yearly']) assert.equal(normalizeBillingInterval(v), 'annual', v);
  for (const v of ['EVERY_30_DAYS', 'monthly', '', null, undefined]) assert.equal(normalizeBillingInterval(v), 'monthly', String(v));
  assert.equal(billsUsage('annual'), false);
  assert.equal(billsUsage('EVERY_30_DAYS'), true);
});

test('yearly price is 10 × monthly (two months free) on every paid plan', () => {
  for (const key of ['lite', 'starter', 'growth', 'pro']) assert.equal(PLANS[key].price.annual, PLANS[key].price.monthly * 10, key);
  assert.equal(PLANS.growth.orderCap, 1000, 'Growth: 1000 orders a month');
});

test('order cap: monthly Lite / Starter / Growth bill overage, yearly ones pause, Free pauses, Pro has none', () => {
  for (const key of ['lite', 'starter', 'growth']) {
    assert.equal(orderCapBehavior(key, 'monthly'), 'charge', key);
    assert.equal(orderCapBehavior(key, 'annual'), 'pause', key);
  }
  assert.equal(orderCapBehavior('free', 'monthly'), 'pause', 'Free pauses at 50 orders');
  assert.equal(orderCapBehavior('pro', 'annual'), 'none');
  assert.equal(orderCapBehavior('pro', 'monthly'), 'none');
});

test('overage is per month: a day bills only the orders that took the month past the cap', () => {
  // Starter, 500 a month: 30 orders a day never crossed a "500 a day" check before.
  // (month so far including the day, the day's orders, cap)
  assert.equal(dayOverageOrders(510, 30, 500), 10, 'the day the month crosses 500');
  assert.equal(dayOverageOrders(570, 30, 500), 30, 'every order after that');
  assert.equal(dayOverageOrders(480, 30, 500), 0, 'still under the cap');
  assert.equal(dayOverageOrders(500, 20, 500), 0, 'exactly at the cap');
  assert.equal(dayOverageOrders(5000, 100, null), 0, 'no cap');
  // A whole month's days add up to the month's extra orders.
  let month = 0, billed = 0;
  for (let day = 0; day < 30; day += 1) { month += 30; billed += dayOverageOrders(month, 30, 500); }
  assert.equal(billed, 900 - 500);
});

test('AI BRIX: monthly keeps going past the credits (charged), yearly stops at them', () => {
  const cap = PLANS.starter.aiBrixCredits;
  assert.equal(aiCreditAllowed('starter', 'monthly', cap + 5), true);
  assert.equal(aiCreditAllowed('starter', 'annual', cap - 1), true, 'the last credit');
  assert.equal(aiCreditAllowed('starter', 'annual', cap), false, 'all used');
  assert.equal(aiCreditAllowed('pro', 'annual', PLANS.pro.aiBrixCredits), false);
});

test('trial: 14 days, monthly or yearly; a promo code replaces it', () => {
  assert.equal(TRIAL_DAYS, 14);
  assert.equal(trialDaysFor(), 14);
  assert.equal(trialDaysFor(0), 14);
  assert.equal(trialDaysFor(30), 30);
  assert.equal(trialDaysFor(7), 7);
});

test('PHP mirror: a yearly Lite / Starter / Growth pauses at the cap (overage only when billed monthly)', () => {
  const php = fs.readFileSync(new URL('../../php_backend/plan_helpers.php', import.meta.url), 'utf8');
  assert.match(php, /if \(\$plan\['overageRate'\] > 0 && plan_billing_interval\(\$pdo, \$shopDomain\) !== 'annual'\) return false;/);
  assert.match(php, /ADD COLUMN `billing_interval` VARCHAR\(10\) NOT NULL DEFAULT 'monthly'/);
  const cfg = fs.readFileSync(new URL('../../php_backend/plan_config.php', import.meta.url), 'utf8');
  assert.match(cfg, /'orderCap' => 1000,/, 'Growth cap in PHP too');
});
