// Run with: node --test tests/combo-weight
// php_backend/plan_config.php must mirror app/config/plans.js feature states
// (the PHP storefront endpoints gate on it).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FEATURES, PLANS, PLAN_KEYS } from '../../app/config/plans.js';

const php = fs.readFileSync(new URL('../../php_backend/plan_config.php', import.meta.url), 'utf8');
const phpFeatures = {};
for (const m of php.matchAll(/'(\w+)'\s*=>\s*\['free'\s*=>\s*'(\w+)',\s*'starter'\s*=>\s*'(\w+)',\s*'growth'\s*=>\s*'(\w+)',\s*'pro'\s*=>\s*'(\w+)'\]/g)) {
  phpFeatures[m[1]] = { free: m[2], starter: m[3], growth: m[4], pro: m[5] };
}

test('box templates: Quantity Box on Starter+, Weight Box and Value Box on Growth+, in both files', () => {
  const starter = { free: 'locked', starter: 'enabled', growth: 'enabled', pro: 'enabled' };
  const growth = { free: 'locked', starter: 'locked', growth: 'enabled', pro: 'enabled' };
  for (const [key, states] of [['combo_quantity_pricing', starter], ['combo_weight_pricing', growth], ['combo_value_pricing', growth], ['combo_tier_pricing', growth]]) {
    assert.deepEqual(FEATURES[key].states, states, key);
    assert.deepEqual(phpFeatures[key], states, `php ${key}`);
  }
});

test('combo template limits: Starter 3, Growth 10, Pro unlimited', () => {
  assert.equal(PLANS.starter.comboTemplateLimit, 3);
  assert.equal(PLANS.growth.comboTemplateLimit, 10);
  assert.equal(PLANS.pro.comboTemplateLimit, null);
  assert.deepEqual([PLANS.starter.price.monthly, PLANS.growth.price.monthly, PLANS.pro.price.monthly], [29, 59, 79]);
});

test('both files list the same plans in the same order', () => {
  assert.deepEqual(PLAN_KEYS, ['free', 'starter', 'growth', 'pro']);
  assert.match(php, /const PLAN_KEYS = \['free', 'starter', 'growth', 'pro'\];/);
  for (const key of PLAN_KEYS) assert.match(php, new RegExp(`'key' => '${key}'`));
});

test('every feature has the same states in plans.js and plan_config.php', () => {
  assert.deepEqual(Object.keys(phpFeatures).sort(), Object.keys(FEATURES).sort());
  for (const [key, feature] of Object.entries(FEATURES)) assert.deepEqual(phpFeatures[key], feature.states, key);
});
