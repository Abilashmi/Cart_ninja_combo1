// Run with: node --test tests/cod/cod.shared.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_COD_SETTINGS, sanitizeCodSettings, normalizeIndianPhone, checkCodRules, codCharges, normalizeLines,
  validateAddress, provinceCodeFor, isCheckoutOnlyLine, maskPhone, splitName, parsePincodes, moneyFormatter,
  isValidCodLogo, parseCodOffers, sanitizeCodTrack, codButtonLook,
} from '../../app/utils/cod.shared.js';

const on = (patch = {}) => sanitizeCodSettings({ enabled: true, ...patch });

test('button looks: drawer, product page and combo page each have their own', () => {
  const s = on({
    buttons: {
      bg: '#0c7a43', style: 'filled', radius: 20, fontSize: 17, uppercase: true,
      product: { same: false, style: 'outline', bg: '#1d4ed8', fontSize: 14, icon: false },
      combo: { same: false, style: 'minimal', bg: '#be185d', radius: 4, bold: false },
      comboText: 'Pay cash',
    },
    productButton: { radius: 6 },
  });
  assert.deepEqual(codButtonLook(s, 'drawer'), { style: 'filled', bg: '#0c7a43', color: '#ffffff', fontSize: 17, bold: true, uppercase: true, icon: true, radius: 20, text: 'Cash on Delivery' });
  const product = codButtonLook(s, 'product');
  assert.deepEqual([product.style, product.bg, product.fontSize, product.icon, product.radius, product.uppercase], ['outline', '#1d4ed8', 14, false, 6, false], 'own look; corners from productButton');
  const combo = codButtonLook(s, 'combo');
  assert.deepEqual([combo.style, combo.bg, combo.radius, combo.bold, combo.text], ['minimal', '#be185d', 4, false, 'Pay cash']);
});

test('button looks: product follows the drawer until split; old settings keep the old combo look', () => {
  const s = on({ buttons: { bg: '#6d28d9', style: 'outline' } });
  const product = codButtonLook(s, 'product');
  assert.equal(product.bg, '#6d28d9', 'same: true by default');
  assert.equal(product.style, 'outline');
  const combo = codButtonLook(s, 'combo');
  assert.deepEqual([combo.style, combo.bg, combo.icon, combo.radius], ['outline', '#111827', false, 8], 'combo pages look as they did before');
  const followed = on({ buttons: { bg: '#6d28d9', combo: { same: true } } });
  assert.equal(codButtonLook(followed, 'combo').bg, '#6d28d9');
  // Junk never gets through, and an existing value is kept.
  const junk = sanitizeCodSettings({ buttons: { fontSize: 99, product: { bg: 'red', style: 'neon', same: false } } }, s);
  assert.equal(junk.buttons.fontSize, 22);
  assert.equal(junk.buttons.product.style, 'filled');
  assert.equal(junk.buttons.product.bg, '#111827');
  // Turning the drawer off changes nothing about the other places.
  const drawerOff = on({ surfaces: { drawer: false } });
  assert.deepEqual(drawerOff.surfaces, { drawer: false, product: true, combo: true });
  assert.equal(checkCodRules({ settings: drawerOff, subtotal: 500, surface: 'product' }), null);
  assert.equal(checkCodRules({ settings: drawerOff, subtotal: 500, surface: 'combo' }), null);
});

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

test('product page button: replace Buy it now by default, sizes clamped, partial patches keep the rest', () => {
  assert.deepEqual(sanitizeCodSettings({}).productButton, DEFAULT_COD_SETTINGS.productButton);
  assert.equal(DEFAULT_COD_SETTINGS.productButton.replaceBuyNow, true);
  const s = sanitizeCodSettings({ productButton: { replaceBuyNow: false, marginTop: 999, paddingY: -3, paddingX: '20', radius: 'x', bogus: 1 } });
  assert.deepEqual(s.productButton, { replaceBuyNow: false, buyNowText: '', marginTop: 60, marginBottom: 0, paddingY: 4, paddingX: 20, radius: 12 });
  const next = sanitizeCodSettings({ productButton: { radius: 0 } }, s);
  assert.deepEqual(next.productButton, { ...s.productButton, radius: 0 });
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

test('popup look (sheet): only safe logos, known options, merged on later saves', () => {
  assert.equal(isValidCodLogo('https://cdn.shopify.com/s/files/logo.png'), true);
  assert.equal(isValidCodLogo('data:image/webp;base64,UklGRg=='), true);
  assert.equal(isValidCodLogo('data:image/svg+xml;base64,PHN2Zz4='), false, 'no SVG (could carry script)');
  assert.equal(isValidCodLogo('http://example.com/logo.png'), false, 'https only');
  assert.equal(isValidCodLogo('https://x.com/a.png" onerror="alert(1)'), false);
  assert.equal(isValidCodLogo('data:image/png;base64,' + 'A'.repeat(50000)), false, 'too big');
  const s = sanitizeCodSettings({ sheet: { logo: 'javascript:alert(1)', radius: 'blob', logoSize: 'lg', accent: 'red', thankYouText: 'x'.repeat(200) } });
  assert.equal(s.sheet.logo, '');
  assert.equal(s.sheet.radius, 'rounded');
  assert.equal(s.sheet.logoSize, 'lg');
  assert.equal(s.sheet.accent, '');
  assert.equal(s.sheet.thankYouText.length, 120);
  const saved = sanitizeCodSettings({ sheet: { logo: 'https://cdn.shopify.com/a.png', showTrust: false } });
  const next = sanitizeCodSettings({ codFee: 10 }, saved);
  assert.equal(next.sheet.logo, 'https://cdn.shopify.com/a.png');
  assert.equal(next.sheet.showTrust, false);
});

test('popup coupon options: valid unique codes, short text, at most 5', () => {
  const offers = parseCodOffers([
    { code: ' SAVE10 ', text: '10% off' }, { code: 'save10', text: 'dupe' }, { code: 'NO SPACES', text: 'x' },
    { code: 'A1' }, { code: 'B2', text: 'y'.repeat(100) }, { code: 'C3' }, { code: 'D4' }, { code: 'E5' },
  ]);
  assert.deepEqual(offers.map((o) => o.code), ['SAVE10', 'A1', 'B2', 'C3', 'D4']);
  assert.equal(offers[2].text.length, 80);
  const s = sanitizeCodSettings({ sheet: { couponLabel: '   ', couponOpen: 1, showCoupon: false } });
  assert.equal(s.sheet.couponLabel, 'Have a coupon code?', 'blank label falls back');
  assert.equal(s.sheet.couponOpen, true);
  assert.equal(s.sheet.showCoupon, false);
});

test('tracking IDs: only real GA4 / Meta Pixel IDs, merged on later saves', () => {
  assert.deepEqual(sanitizeCodSettings({}).tracking, { ga4Id: '', metaPixelId: '', metaContentId: 'shopify', dataLayer: true });
  const s = sanitizeCodSettings({ tracking: { ga4Id: ' g-abc123xyz ', metaPixelId: '123456789012345', metaContentId: 'sku', dataLayer: false, apiSecret: 'leak' } });
  assert.deepEqual(s.tracking, { ga4Id: 'G-ABC123XYZ', metaPixelId: '123456789012345', metaContentId: 'sku', dataLayer: false }, 'unknown keys dropped');
  const bad = sanitizeCodSettings({ tracking: { ga4Id: 'UA-1234-1', metaPixelId: '12ab', metaContentId: 'title' } });
  assert.equal(bad.tracking.ga4Id, '');
  assert.equal(bad.tracking.metaPixelId, '');
  assert.equal(bad.tracking.metaContentId, 'shopify');
  const next = sanitizeCodSettings({ codFee: 10 }, s);
  assert.equal(next.tracking.ga4Id, 'G-ABC123XYZ', 'other saves keep the IDs');
  assert.equal(sanitizeCodSettings({ tracking: { ga4Id: '' } }, s).tracking.ga4Id, '', 'can be cleared');
});

test('shopper tracking context: well-formed cookies only, consent defaults to no', () => {
  const t = sanitizeCodTrack({
    gaClientId: '1234567890.1700000000', gaSessionId: '1700000123', fbp: 'fb.1.1700000000000.987654321',
    fbc: 'fb.1.1700000000000.IwAR0abc', consent: { analytics: true, marketing: 'yes' }, pageUrl: 'https://demo.myshopify.com/products/kit?x=1',
  });
  assert.equal(t.gaClientId, '1234567890.1700000000');
  assert.equal(t.fbc, 'fb.1.1700000000000.IwAR0abc');
  assert.deepEqual(t.consent, { analytics: true, marketing: false }, 'only a real true counts');
  assert.equal(t.pageUrl, 'https://demo.myshopify.com/products/kit?x=1');
  const junk = sanitizeCodTrack({ gaClientId: '<script>', fbp: 'x', pageUrl: 'javascript:alert(1)' });
  assert.deepEqual(junk, { gaClientId: '', gaSessionId: '', fbp: '', fbc: '', consent: { analytics: false, marketing: false }, pageUrl: '' });
  assert.deepEqual(sanitizeCodTrack(null).consent, { analytics: false, marketing: false });
});

test('drawer placement, excluded behaviour and button style: defaults, allowed values only, kept on other saves', () => {
  const d = sanitizeCodSettings({});
  assert.equal(d.drawerPlacement, 'above', 'existing stores keep COD above Checkout');
  assert.equal(d.excludedBehavior, 'unavailable');
  assert.equal(d.buttons.style, 'filled');
  assert.equal(d.buttons.radius, 12);
  assert.equal(d.drawerSelector, '');
  const s = sanitizeCodSettings({ drawerPlacement: 'replace', excludedBehavior: 'hide', buttons: { style: 'outline', radius: 99 } });
  assert.equal(s.drawerPlacement, 'replace');
  assert.equal(s.excludedBehavior, 'hide');
  assert.equal(s.buttons.style, 'outline');
  assert.equal(s.buttons.radius, 40, 'radius clamped to 0..40');
  const bad = sanitizeCodSettings({ drawerPlacement: 'sideways', excludedBehavior: 'show', buttons: { style: 'neon' } }, s);
  assert.equal(bad.drawerPlacement, 'replace', 'unknown values keep the saved one');
  assert.equal(bad.excludedBehavior, 'hide');
  assert.equal(bad.buttons.style, 'outline');
  const next = sanitizeCodSettings({ minOrder: 100 }, s);
  assert.equal(next.drawerPlacement, 'replace');
  assert.equal(next.buttons.style, 'outline');
});

test('drawer selector: CSS selectors only, never markup', () => {
  assert.equal(sanitizeCodSettings({ drawerSelector: ' #CartDrawer .cart__checkout-button ' }).drawerSelector, '#CartDrawer .cart__checkout-button');
  assert.equal(sanitizeCodSettings({ drawerSelector: "a[href*='/checkout']" }).drawerSelector, "a[href*='/checkout']");
  assert.equal(sanitizeCodSettings({ drawerSelector: '</style><script>' }).drawerSelector, '');
  assert.equal(sanitizeCodSettings({ drawerSelector: 'x{color:red}' }).drawerSelector, '');
  const saved = sanitizeCodSettings({ drawerSelector: '#ok' });
  assert.equal(sanitizeCodSettings({ drawerSelector: '<b>' }, saved).drawerSelector, '#ok', 'a bad value keeps the saved one');
  assert.equal(sanitizeCodSettings({ drawerSelector: '' }, saved).drawerSelector, '', 'can be cleared');
});

test('COD fee switch: charged only while on; title and visibility; settings from before the switch keep charging', () => {
  const legacy = sanitizeCodSettings({ codFee: 49 });
  assert.equal(legacy.codFeeEnabled, true, 'an amount without a switch means on');
  assert.equal(legacy.codFeeLabel, 'Cash on Delivery Fee');
  assert.equal(legacy.showCodFee, true);
  const off = sanitizeCodSettings({ codFeeEnabled: false }, legacy);
  assert.equal(off.codFee, 49, 'turning it off keeps the amount for later');
  assert.deepEqual(codCharges({ ...off, shippingFee: 0 }, 500), { shipping: 0, codFee: 0, total: 0 });
  assert.equal(sanitizeCodSettings({ maxOrder: 900 }, off).codFeeEnabled, false, 'other saves keep it off');
  const on40 = sanitizeCodSettings({ codFeeEnabled: true, codFee: 40, codFeeLabel: '  Handling fee ', showCodFee: false });
  assert.equal(on40.codFeeLabel, 'Handling fee');
  assert.equal(on40.showCodFee, false);
  assert.deepEqual(codCharges(on40, 1299), { shipping: 0, codFee: 40, total: 40 }, 'hidden fee is still charged');
  assert.equal(sanitizeCodSettings({ codFeeLabel: '' }, on40).codFeeLabel, 'Cash on Delivery Fee', 'empty title falls back');
  assert.equal(sanitizeCodSettings({ codFee: 0 }, on40).codFeeEnabled, false, 'old-style codFee: 0 still means no fee');
});

test('excluded tags: any matching product tag blocks COD, case-insensitive, many tags', () => {
  const s = on({ excludedProductTags: ['no-cod', 'Pre-Order', 'fragile'] });
  assert.deepEqual(s.excludedProductTags, ['no-cod', 'Pre-Order', 'fragile']);
  assert.equal(checkCodRules({ settings: s, subtotal: 500, productTags: ['summer', 'PRE-ORDER'] })?.code, 'product_excluded');
  assert.equal(checkCodRules({ settings: s, subtotal: 500, productTags: ['fragile'] })?.code, 'product_excluded');
  assert.equal(checkCodRules({ settings: s, subtotal: 500, productTags: ['summer', 'cod-ok'] }), null, 'tags are exclusions, not a list of COD products');
  assert.equal(checkCodRules({ settings: on({}), subtotal: 500, productTags: ['no-cod'] }), null);
});
