// Run with: node --import ./tests/packs/register.mjs --test tests/analytics
// Home's Conversion Rate card (services/analytics.server.js conversionRate):
// orders ÷ storefront visits. It used to be orders ÷ BRIX drawer Checkout
// clicks, so 23 orders and 1 click showed 2300%.
import test from 'node:test';
import assert from 'node:assert/strict';

const { conversionRate } = await import('../../app/services/analytics.server.js');

test('orders ÷ visits, as a percent', () => {
  assert.equal(conversionRate(23, 1000), 2.3);
  assert.equal(conversionRate(0, 500), 0);
  assert.equal(conversionRate(10, 10), 100);
});

test('no real rate = null (Home shows "—"), never over 100%', () => {
  assert.equal(conversionRate(23, 1), null, 'more orders than visits: visits not fully recorded');
  assert.equal(conversionRate(5, 0), null, 'no visits recorded');
  assert.equal(conversionRate(0, 0), null);
  assert.equal(conversionRate(3, undefined), null);
});
