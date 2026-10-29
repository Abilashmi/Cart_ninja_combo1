// Run with: node --import ./tests/packs/register.mjs --test tests/billing/annual-plans.test.mjs
// Yearly billing (app/config/plans.js): same 7-day trial, no usage charges (Shopify
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
  for (const key of ['lite', 'starter', 'growth', 'pro', 'scale', 'enterprise']) assert.equal(PLANS[key].price.annual, PLANS[key].price.monthly * 10, key);
  assert.equal(PLANS.growth.orderCap, 2000, 'Growth: 2000 orders a month');
});

test('no extra charges: every capped plan, monthly or yearly, pauses at its monthly orders; Enterprise never does', () => {
  for (const key of ['free', 'lite', 'starter', 'growth', 'pro', 'scale', 'enterprise']) {
    assert.equal(PLANS[key].overageRate, 0, `${key}: no per-order charge`);
    assert.equal(PLANS[key].aiBrixOverageRate, 0, `${key}: no per-credit charge`);
    const expected = key === 'enterprise' ? 'none' : 'pause';
    assert.equal(orderCapBehavior(key, 'monthly'), expected, key);
    assert.equal(orderCapBehavior(key, 'annual'), expected, key);
  }
  assert.deepEqual(['free', 'lite', 'starter', 'growth', 'pro', 'scale', 'enterprise'].map((k) => PLANS[k].orderCap), [50, 250, 500, 2000, 5000, 10000, null]);
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

test('AI BRIX: every plan stops at its monthly credits, monthly or yearly', () => {
  for (const key of ['free', 'lite', 'starter', 'growth', 'pro', 'scale', 'enterprise']) {
    const cap = PLANS[key].aiBrixCredits;
    for (const interval of ['monthly', 'annual']) {
      assert.equal(aiCreditAllowed(key, interval, cap - 1), true, `${key} ${interval}: the last credit`);
      assert.equal(aiCreditAllowed(key, interval, cap), false, `${key} ${interval}: all used`);
    }
  }
});

test('trial: 7 days, monthly or yearly; a promo code replaces it', () => {
  assert.equal(TRIAL_DAYS, 7);
  assert.equal(trialDaysFor(), 7);
  assert.equal(trialDaysFor(0), 7);
  assert.equal(trialDaysFor(30), 30);
  assert.equal(trialDaysFor(14), 14);
});

test('PHP mirror: a yearly Lite / Starter / Growth pauses at the cap (overage only when billed monthly)', () => {
  const php = fs.readFileSync(new URL('../../php_backend/plan_helpers.php', import.meta.url), 'utf8');
  assert.match(php, /if \(\$plan\['overageRate'\] > 0 && plan_billing_interval\(\$pdo, \$shopDomain\) !== 'annual'\) return false;/);
  assert.match(php, /ADD COLUMN `billing_interval` VARCHAR\(10\) NOT NULL DEFAULT 'monthly'/);
  const cfg = fs.readFileSync(new URL('../../php_backend/plan_config.php', import.meta.url), 'utf8');
  assert.match(cfg, /'orderCap' => 2000,/, 'Growth cap in PHP too');
});
