// Run with: node --import ./tests/packs/register.mjs --test tests/ai-handoff
import test from 'node:test';
import assert from 'node:assert/strict';
import { localizeCurrencySymbols as L, localizeCurrencyDeep } from '../../app/utils/currency-text.js';

const usd = { symbol: '$', code: 'USD' };

test('USD store: foreign symbols before an amount become $', () => {
  assert.equal(L('The milestone for a free gift is set to ₹3,000.', usd), 'The milestone for a free gift is set to $3,000.');
  assert.equal(L('Free shipping over ₹ 999 and €50 and £20', usd), 'Free shipping over $999 and $50 and $20');
});
test('store symbol and unrelated text are left alone', () => {
  assert.equal(L('Goal: $50', usd), 'Goal: $50');
  assert.equal(L('No amounts here, just ₹ mentioned', usd), 'No amounts here, just ₹ mentioned');
  assert.equal(L('Rate is R2D2 and kr', usd), 'Rate is R2D2 and kr');
  assert.equal(L('', usd), '');
  assert.equal(L(undefined, usd), undefined);
});
test('INR store: $ becomes ₹, ₹ untouched', () => {
  const inr = { symbol: '₹', code: 'INR' };
  assert.equal(L('Free gift at $3,000 (₹3,000)', inr), 'Free gift at ₹3,000 (₹3,000)');
});
test('dollar-family store keeps its own $ but swaps others', () => {
  const aud = { symbol: 'A$', code: 'AUD' };
  assert.equal(L('Spend $50 or ₹3,000', aud), 'Spend $50 or A$3,000');
});
test('letter symbols get a space; euro store', () => {
  assert.equal(L('Spend ₹500', { symbol: 'CHF', code: 'CHF' }), 'Spend CHF 500');
  assert.equal(L('Spend $500', { symbol: '€', code: 'EUR' }), 'Spend €500');
});
test('deep: strings only, numbers/keys untouched', () => {
  const out = localizeCurrencyDeep({ tiers: [{ min_value: 3000, description: 'Free gift at ₹3000', on: true }], n: null }, usd);
  assert.deepEqual(out, { tiers: [{ min_value: 3000, description: 'Free gift at $3000', on: true }], n: null });
});
