// Run with: node --test tests/packs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toNumericId, toGid, sameShopifyId, calculateTier, calculateTierFromPrices, normalizeTiers, validateTiers,
  sanitizeCustomization, mergeCustomization, defaultCustomization, currencyDecimals,
} from '../../app/utils/packs.shared.js';

test('Shopify id helpers match exactly, never by suffix', () => {
  assert.equal(toNumericId('gid://shopify/Product/123'), '123');
  assert.equal(toNumericId(123), '123');
  assert.equal(toNumericId('abc'), null);
  assert.equal(toGid('Product', '123'), 'gid://shopify/Product/123');
  assert.ok(sameShopifyId('gid://shopify/Product/123', '123'));
  assert.ok(!sameShopifyId('gid://shopify/Product/1123', '123'));
  assert.ok(!sameShopifyId('123', '1123'));
  assert.ok(!sameShopifyId(null, '123'));
});

test('tier calculation matches the brief example (80 x3 @10%)', () => {
  const tier = calculateTier(80, { quantity: 3, discountType: 'percentage', discountValue: 10 });
  assert.equal(tier.subtotal, 240);
  assert.equal(tier.discountAmount, 24);
  assert.equal(tier.price, 216);
  assert.equal(tier.savings, 24);
  assert.equal(tier.effectiveUnitPrice, 72);
});

test('fixed discount, none discount and clamping', () => {
  assert.equal(calculateTier(50, { quantity: 2, discountType: 'fixed', discountValue: 15 }).price, 85);
  const none = calculateTier(50, { quantity: 2, discountType: 'none', discountValue: 99 });
  assert.equal(none.price, 100);
  assert.equal(none.savings, 0);
  assert.equal(calculateTier(10, { quantity: 1, discountType: 'fixed', discountValue: 500 }).price, 0);
});

test('no float drift (0.1 + 0.2 style)', () => {
  const tier = calculateTier(0.1, { quantity: 3, discountType: 'percentage', discountValue: 10 });
  assert.equal(tier.subtotal, 0.3);
  assert.equal(tier.price, 0.27);
});

test('currency decimals and formatted values follow the shop currency', () => {
  assert.equal(currencyDecimals('JPY'), 0);
  assert.equal(currencyDecimals('USD'), 2);
  const jpy = calculateTier(1000, { quantity: 3, discountType: 'percentage', discountValue: 7.5 }, { currencyCode: 'JPY' });
  assert.equal(jpy.price, 2775);
  assert.match(jpy.formatted.price, /2,775/);
  assert.doesNotMatch(jpy.formatted.price, /\./);
  const inr = calculateTier(80, { quantity: 3, discountType: 'percentage', discountValue: 10 }, { currencyCode: 'INR' });
  assert.match(inr.formatted.price, /₹/);
  const usd = calculateTier(80, { quantity: 3, discountType: 'percentage', discountValue: 10 }, { currencyCode: 'USD' });
  assert.doesNotMatch(usd.formatted.price, /₹/);
});

test('calculateTierFromPrices handles mixed-variant packs', () => {
  const tier = calculateTierFromPrices([10, 20, 30], { quantity: 3, discountType: 'percentage', discountValue: 10 }, 2);
  assert.equal(tier.subtotal, 60);
  assert.equal(tier.price, 54);
});

test('validateTiers rejects invalid structures', () => {
  const ok = validateTiers([{ quantity: 1, discountType: 'none' }, { quantity: 2, discountType: 'percentage', discountValue: 5 }, { quantity: 3, discountType: 'percentage', discountValue: 10 }], { basePrice: 80 });
  assert.equal(ok.valid, true);
  const bad = (tiers, opts) => validateTiers(tiers, opts).errors.map((e) => e.message).join('|');
  assert.match(bad([]), /at least one/);
  assert.match(bad([{ quantity: 0 }]), /positive whole/);
  assert.match(bad([{ quantity: 1.5 }]), /positive whole/);
  assert.match(bad([{ quantity: '' }]), /positive whole/);
  assert.match(bad([{ quantity: 2 }, { quantity: 2 }]), /unique/);
  assert.match(bad([{ quantity: 3 }, { quantity: 2 }]), /ascending/);
  assert.match(bad([{ quantity: 2, discountType: 'percentage', discountValue: 101 }]), /at most 100/);
  assert.match(bad([{ quantity: 2, discountType: 'percentage', discountValue: -5 }]), /negative/);
  assert.match(bad([{ quantity: 2, discountType: 'percentage', discountValue: '' }]), /Enter a discount value/);
  assert.match(bad([{ quantity: 2, discountType: 'fixed', discountValue: 500 }], { basePrice: 80 }), /larger than the Pack subtotal/);
  assert.match(bad([{ quantity: 2, discountType: 'bogus' }]), /valid discount type/);
  assert.match(bad([{ quantity: 2, badge: 'x'.repeat(30) }]), /24 characters/);
  assert.match(bad(Array.from({ length: 7 }, (_, i) => ({ quantity: i + 1 }))), /at most 6/);
});

test('normalizeTiers sorts and coerces', () => {
  const tiers = normalizeTiers([{ quantity: '3', discountType: 'percentage', discountValue: '10', badge: ' Best ' }, { quantity: '1' }]);
  assert.deepEqual(tiers.map((t) => t.quantity), [1, 3]);
  assert.equal(tiers[1].discountValue, 10);
  assert.equal(tiers[1].badge, 'Best');
  assert.equal(tiers[0].discountType, 'none');
});

test('customization merge preserves nested defaults', () => {
  const merged = mergeCustomization({ colors: { primary: '#ff0000' } });
  const defaults = defaultCustomization();
  assert.equal(merged.colors.primary, '#ff0000');
  assert.equal(merged.colors.text, defaults.colors.text);
  assert.deepEqual(merged.typography, defaults.typography);
  assert.deepEqual(merged.spacing, defaults.spacing);
  assert.deepEqual(merged.borders, defaults.borders);
  // layered: stored then patch
  const stored = mergeCustomization({ typography: { headingSize: 30 } });
  const next = mergeCustomization(stored, { colors: { primary: '#123456' } });
  assert.equal(next.typography.headingSize, 30);
  assert.equal(next.colors.primary, '#123456');
});

test('sanitizeCustomization validates and drops unknown fields', () => {
  const good = sanitizeCustomization({ colors: { primary: '#abc' }, typography: { headingSize: '24', fontWeight: '700' }, evil: { x: 1 }, advanced: { customCss: 'body{display:none}' } });
  assert.deepEqual(good.errors, []);
  assert.equal(good.value.typography.headingSize, 24);
  assert.equal(good.value.typography.fontWeight, 700);
  assert.equal(good.value.evil, undefined);
  assert.equal(good.value.advanced, undefined);
  const bad = sanitizeCustomization({ colors: { primary: 'red; background:url(x)' }, borders: { radius: 999 }, content: { heading: 5 }, spacing: 'no' });
  assert.equal(bad.errors.length, 4);
  assert.equal(sanitizeCustomization('nope').errors.length, 1);
});
