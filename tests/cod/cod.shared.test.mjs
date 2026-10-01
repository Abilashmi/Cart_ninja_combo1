// Run with: node --test tests/cod/cod.shared.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_COD_SETTINGS, sanitizeCodSettings, normalizeIndianPhone, checkCodRules, codCharges, normalizeLines,
  validateAddress, provinceCodeFor, isCheckoutOnlyLine, maskPhone, splitName, parsePincodes, moneyFormatter,
} from '../../app/utils/cod.shared.js';

const on = (patch = {}) => sanitizeCodSettings({ enabled: true, ...patch });

test('defaults: COD starts off, every surface on, OTP on', () => {
  const s = sanitizeCodSettings({});
  assert.equal(s.enabled, false);
  assert.deepEqual(s.surfaces, { drawer: true, product: true, combo: true });
  assert.equal(s.requireOtp, true);
  assert.equal(s.dailyLimitPerPhone, 3);
});

test('sanitize merges a partial patch onto saved settings without resetting other fields', () => {
  const saved = sanitizeCodSettings({ enabled: true, codFee: 49, minOrder: 299, blockedPincodes: '744101' });
  const next = sanitizeCodSettings({ maxOrder: 5000 }, saved);
  assert.equal(next.enabled, true);
  assert.equal(next.codFee, 49);
  assert.equal(next.minOrder, 299);
  assert.equal(next.maxOrder, 5000);
  assert.deepEqual(next.blockedPincodes, ['744101']);
});

test('sanitize rejects bad values', () => {
  const s = sanitizeCodSettings({
    codFee: -5, dailyLimitPerPhone: 999, blockedPincodes: '744101, 12345, 012345, abcdef, 744101',
    buttons: { bg: 'red', color: '#fff', drawerText: '   ' }, surfaces: { product: false, bogus: true },
    orderTags: ['ok-tag', '<script>'], unknownKey: 1,
  });
  assert.equal(s.codFee, 0);
  assert.equal(s.dailyLimitPerPhone, 50);
  assert.deepEqual(s.blockedPincodes, ['744101']);
  assert.equal(s.buttons.bg, DEFAULT_COD_SETTINGS.buttons.bg);
  assert.equal(s.buttons.color, '#fff');
  assert.equal(s.buttons.drawerText, DEFAULT_COD_SETTINGS.buttons.drawerText);
  assert.deepEqual(s.surfaces, { drawer: true, product: false, combo: true });
  assert.deepEqual(s.orderTags, ['ok-tag']);
  assert.equal('unknownKey' in s, false);
});

test('Indian phone numbers normalize to 10 digits', () => {
  assert.equal(normalizeIndianPhone('+91 98765 43210'), '9876543210');
  assert.equal(normalizeIndianPhone('09876543210'), '9876543210');
  assert.equal(normalizeIndianPhone('919876543210'), '9876543210');
  assert.equal(normalizeIndianPhone('5876543210'), null); // must start 6-9
  assert.equal(normalizeIndianPhone('98765'), null);
  assert.equal(maskPhone('9876543210'), '98XXXX3210');
});

test('COD rules: off, surface off, min, max, blocked PIN, excluded tag, allowed', () => {
  assert.equal(checkCodRules({ settings: sanitizeCodSettings({}), subtotal: 500 }).code, 'cod_disabled');
  assert.equal(checkCodRules({ settings: on({ surfaces: { combo: false } }), subtotal: 500, surface: 'combo' }).code, 'cod_disabled');
  const s = on({ minOrder: 299, maxOrder: 5000, blockedPincodes: ['744101'], excludedProductTags: ['no-cod'] });
  assert.equal(checkCodRules({ settings: s, subtotal: 100 }).code, 'below_min');
  assert.equal(checkCodRules({ settings: s, subtotal: 5001 }).code, 'above_max');
  assert.equal(checkCodRules({ settings: s, subtotal: 1000, pincode: '744101' }).code, 'pincode_blocked');
  assert.equal(checkCodRules({ settings: s, subtotal: 1000, productTags: ['Sale', 'NO-COD'] }).code, 'product_excluded');
  assert.equal(checkCodRules({ settings: s, subtotal: 1000, pincode: '560001', productTags: ['Sale'], surface: 'drawer' }), null);
});

test('rule messages use the store currency', () => {
  const r = checkCodRules({ settings: on({ minOrder: 50 }), subtotal: 10, format: moneyFormatter('USD') });
  assert.match(r.message, /\$50/);
  assert.doesNotMatch(r.message, /₹/);
});

test('charges: shipping waived above the free-shipping threshold, COD fee always applies', () => {
  const s = on({ codFee: 49, shippingFee: 60, freeShippingAbove: 999 });
  assert.deepEqual(codCharges(s, 500), { shipping: 60, codFee: 49, total: 109 });
  assert.deepEqual(codCharges(s, 999), { shipping: 0, codFee: 49, total: 49 });
  assert.deepEqual(codCharges(on({}), 500), { shipping: 0, codFee: 0, total: 0 });
});

test('lines: GIDs accepted, duplicates merged, bad input rejected', () => {
  const { lines } = normalizeLines([
    { variantId: 'gid://shopify/ProductVariant/11', quantity: 1 },
    { variant_id: 11, quantity: 2 },
    { variantId: 12, quantity: 1, properties: { Engraving: 'A' } },
  ]);
  assert.deepEqual(lines, [
    { variantId: '11', quantity: 3, properties: {} },
    { variantId: '12', quantity: 1, properties: { Engraving: 'A' } },
  ]);
  assert.ok(normalizeLines([]).error);
  assert.ok(normalizeLines([{ variantId: 'abc', quantity: 1 }]).error);
  assert.ok(normalizeLines([{ variantId: 1, quantity: 0 }]).error);
  assert.ok(normalizeLines([{ variantId: 1, quantity: 101 }]).error);
});

test('address validation', () => {
  const good = { name: 'Ananya  Rao', address1: '14, 3rd Cross, Indiranagar', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
  assert.equal(validateAddress(good).address.name, 'Ananya Rao');
  assert.ok(validateAddress({ ...good, pincode: '056000' }).error);
  assert.ok(validateAddress({ ...good, address1: 'x' }).error);
  assert.ok(validateAddress({ ...good, email: 'not-an-email' }).error);
  assert.equal(validateAddress({ ...good, email: '' }).address.email, '');
});

test('state names map to Shopify province codes', () => {
  assert.equal(provinceCodeFor('Karnataka'), 'KA');
  assert.equal(provinceCodeFor('tamil  nadu'), 'TN');
  assert.equal(provinceCodeFor('Jammu & Kashmir'), 'JK');
  assert.equal(provinceCodeFor('Atlantis'), null);
});

test('Pack and free-gift lines are checkout-only', () => {
  assert.equal(isCheckoutOnlyLine({ _brix_pack_id: '12' }), true);
  assert.equal(isCheckoutOnlyLine({ _brixReward: 'true' }), true);
  assert.equal(isCheckoutOnlyLine({ Engraving: 'A' }), false);
  assert.equal(isCheckoutOnlyLine(undefined), false);
});

test('misc helpers', () => {
  assert.deepEqual(splitName('Ananya Rao'), { firstName: 'Ananya', lastName: 'Rao' });
  assert.deepEqual(splitName('Cher'), { firstName: 'Cher', lastName: '' });
  assert.deepEqual(parsePincodes('560001\n400001, 560001'), ['560001', '400001']);
});
