// Run with: node --test tests/combo-weight
// php_backend/plan_config.php must mirror app/config/plans.js (the PHP
// storefront endpoints gate on it): plans, order caps, overage, credits,
// feature states.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FEATURES, PLANS, PLAN_KEYS, getOrderRange, getFeatureState, getMinPlanForFeature } from '../../app/config/plans.js';

const php = fs.readFileSync(new URL('../../php_backend/plan_config.php', import.meta.url), 'utf8');

// 'key' => [ ... ] blocks of PHP's PLANS, as { orderCap, overageRate, ... } (null / numbers / booleans).
function phpPlans() {
  const out = {};
  for (const m of php.matchAll(/'(\w+)' => \[\s*'key' => '\w+',([\s\S]*?)\],/g)) {
    const fields = {};
    for (const f of m[2].matchAll(/'(\w+)' => ([^,\n]+),/g)) {
      const raw = f[2].trim();
      fields[f[1]] = raw === 'null' ? null : raw === 'true' ? true : raw === 'false' ? false : /^'/.test(raw) ? raw.slice(1, -1) : Number(raw);
    }
    out[m[1]] = fields;
  }
  return out;
}

test('both files list the same plans in the same order', () => {
  assert.deepEqual(PLAN_KEYS, ['free', 'lite', 'starter', 'growth', 'pro']);
  assert.match(php, /const PLAN_KEYS = \['free', 'lite', 'starter', 'growth', 'pro'\];/);
  for (const key of PLAN_KEYS) assert.match(php, new RegExp(`'key' => '${key}'`));
});

test('plans differ by orders: Free 1-50, Lite 51-200, Starter 201-500, Growth 501-1000, Pro 1001-2000', () => {
  assert.deepEqual(PLAN_KEYS.map((k) => PLANS[k].price.monthly), [0, 9, 29, 59, 79]);
  assert.deepEqual(PLAN_KEYS.map((k) => getOrderRange(k)), [
    { from: 1, to: 50 }, { from: 51, to: 200 }, { from: 201, to: 500 }, { from: 501, to: 1000 }, { from: 1001, to: 2000 },
  ]);
  assert.deepEqual(PLAN_KEYS.map((k) => PLANS[k].orderCap), [50, 200, 500, 1000, null], 'Pro: no cap above 2000 yet');
});

test('every feature is enabled on every plan, combo templates unlimited', () => {
  for (const featureKey of Object.keys(FEATURES)) {
    for (const planKey of PLAN_KEYS) assert.equal(getFeatureState(planKey, featureKey), 'enabled', `${featureKey} on ${planKey}`);
    assert.equal(getMinPlanForFeature(featureKey), 'free', featureKey);
  }
  for (const planKey of PLAN_KEYS) assert.equal(PLANS[planKey].comboTemplateLimit, null, planKey);
});

test('PHP has the same caps, overage rates, credits, template limits and watermark', () => {
  const p = phpPlans();
  assert.deepEqual(Object.keys(p), PLAN_KEYS);
  for (const key of PLAN_KEYS) {
    for (const field of ['label', 'orderCap', 'overageRate', 'aiBrixCredits', 'comboTemplateLimit', 'watermarkRemovable']) {
      assert.equal(p[key][field], PLANS[key][field], `${key}.${field}`);
    }
  }
});

test('every feature has the same states in plans.js and plan_config.php', () => {
  const every = php.match(/const EVERY_PLAN = \[([^\]]*)\];/);
  assert.ok(every, 'EVERY_PLAN in PHP');
  const states = Object.fromEntries([...every[1].matchAll(/'(\w+)' => '(\w+)'/g)].map((m) => [m[1], m[2]]));
  const phpFeatures = {};
  const block = php.slice(php.indexOf('const FEATURES = ['));
  for (const m of block.matchAll(/^\s*'(\w+)'\s*=>\s*EVERY_PLAN,/gm)) phpFeatures[m[1]] = states;
  assert.deepEqual(Object.keys(phpFeatures).sort(), Object.keys(FEATURES).sort());
  for (const [key, feature] of Object.entries(FEATURES)) assert.deepEqual(phpFeatures[key], { ...feature.states }, key);
});
