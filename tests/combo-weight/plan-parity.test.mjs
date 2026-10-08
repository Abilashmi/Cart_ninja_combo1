// Run with: node --test tests/combo-weight
// php_backend/plan_config.php must mirror app/config/plans.js feature states
// (the PHP storefront endpoints gate on it).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FEATURES } from '../../app/config/plans.js';

const php = fs.readFileSync(new URL('../../php_backend/plan_config.php', import.meta.url), 'utf8');
const phpFeatures = {};
for (const m of php.matchAll(/'(\w+)'\s*=>\s*\['free'\s*=>\s*'(\w+)',\s*'starter'\s*=>\s*'(\w+)',\s*'pro'\s*=>\s*'(\w+)'\]/g)) {
  phpFeatures[m[1]] = { free: m[2], starter: m[3], pro: m[4] };
}

test('weight-based combo pricing is Pro only, in both files', () => {
  assert.deepEqual(FEATURES.combo_weight_pricing.states, { free: 'locked', starter: 'locked', pro: 'enabled' });
  assert.deepEqual(phpFeatures.combo_weight_pricing, { free: 'locked', starter: 'locked', pro: 'enabled' });
});

test('every feature has the same states in plans.js and plan_config.php', () => {
  assert.deepEqual(Object.keys(phpFeatures).sort(), Object.keys(FEATURES).sort());
  for (const [key, feature] of Object.entries(FEATURES)) assert.deepEqual(phpFeatures[key], feature.states, key);
});
