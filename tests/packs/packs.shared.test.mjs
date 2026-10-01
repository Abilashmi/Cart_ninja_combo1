// Run with: node --test tests/packs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toNumericId, toGid, sameShopifyId, calculateTier, calculateTierFromPrices, normalizeTiers, validateTiers,
  sanitizeCustomization, mergeCustomization, defaultCustomization, currencyDecimals,
  normalizeVariantIds, validateVariantCoverage, PACK_DESIGNS, applyDesign,
  normalizeOptionData, emptySelection, resolveVariant, optionChoices, selectionStatus, packSelectionRules, pickBlockReason, groupCartItems,
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

test('normalizeVariantIds dedupes and coerces GIDs to numeric strings', () => {
  assert.deepEqual(normalizeVariantIds(['gid://shopify/ProductVariant/1', '2', 2, '1', 'nope']), ['1', '2']);
  assert.deepEqual(normalizeVariantIds(null), []);
  assert.deepEqual(normalizeVariantIds('not-an-array'), []);
});

test('validateVariantCoverage: a Pack belongs to a product first, then declares which variants it covers', () => {
  const productVariantIds = ['1', '2', '3'];
  // scope='all' never needs an explicit list, and is invalid without any variants at all.
  const all = validateVariantCoverage({ packType: 'same_variant', variantScope: 'all', allowedVariantIds: [] }, productVariantIds);
  assert.equal(all.valid, true);
  assert.deepEqual(all.allowedVariantIds, []);
  assert.equal(validateVariantCoverage({ packType: 'same_variant', variantScope: 'all', allowedVariantIds: [] }, []).valid, false);
  // scope='selected' requires at least one REAL variant of the product.
  const none = validateVariantCoverage({ packType: 'same_variant', variantScope: 'selected', allowedVariantIds: [] }, productVariantIds);
  assert.equal(none.valid, false);
  assert.match(none.errors[0].message, /at least one/);
  // Variant ids from another product are never silently trusted or dropped —
  // ANY foreign id makes the whole submission invalid (never a partial "trust
  // what you can verify" pass), even when some of the ids are real.
  const foreign = validateVariantCoverage({ packType: 'same_variant', variantScope: 'selected', allowedVariantIds: ['9', '99'] }, productVariantIds);
  assert.equal(foreign.valid, false);
  assert.deepEqual(foreign.allowedVariantIds, []);
  const mixed = validateVariantCoverage({ packType: 'mix_match', variantScope: 'selected', allowedVariantIds: ['1', '9', '2'] }, productVariantIds);
  assert.equal(mixed.valid, false);
  assert.match(mixed.errors[0].message, /do not belong/);
  // Only real ids, no foreign ones: valid, and the returned list is exactly what was given.
  const real = validateVariantCoverage({ packType: 'mix_match', variantScope: 'selected', allowedVariantIds: ['1', '2'] }, productVariantIds);
  assert.equal(real.valid, true);
  assert.deepEqual(real.allowedVariantIds, ['1', '2']);
  // Invalid pack_type / variant_scope values are rejected outright.
  assert.equal(validateVariantCoverage({ packType: 'bogus', variantScope: 'all' }, productVariantIds).valid, false);
  assert.equal(validateVariantCoverage({ packType: 'same_variant', variantScope: 'bogus' }, productVariantIds).valid, false);
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

test('only the three current templates are offered; removed ones map to the closest current template', () => {
  assert.deepEqual(PACK_DESIGNS.map((design) => design.id), ['slots', 'quick_add', 'image_slots']);
  assert.deepEqual(PACK_DESIGNS.map((design) => design.name), ['Horizontal Select', 'Quick Add Picker', 'Image Variant Select']);
  assert.equal(defaultCustomization().design.preset, 'slots');
  for (const [old, next] of [['classic', 'slots'], ['highlight', 'slots'], ['premium', 'slots'], ['tabs', 'slots'], ['stacked', 'slots'], ['visual', 'image_slots']]) {
    const result = sanitizeCustomization({ design: { preset: old } });
    assert.deepEqual(result.errors, [], `${old} is not rejected`);
    assert.equal(mergeCustomization(result.value).design.preset, next);
  }
  assert.ok(sanitizeCustomization({ design: { preset: 'bogus' } }).errors.length > 0);
});

test('Buy Now is on by default and its label is validated', () => {
  assert.equal(defaultCustomization().content.showBuyNow, true);
  assert.equal(defaultCustomization().content.buyNow, 'Buy Now');
  assert.deepEqual(sanitizeCustomization({ content: { showBuyNow: false, buyNow: 'Buy it now' } }).value.content, { showBuyNow: false, buyNow: 'Buy it now' });
  assert.ok(sanitizeCustomization({ content: { buyNow: 'x'.repeat(41) } }).errors.length > 0);
});

test('button customization: validated; Packs saved before it keep their old button look', () => {
  const defaults = defaultCustomization();
  assert.equal(defaults.buttons.layout, 'side_by_side');
  assert.deepEqual(mergeCustomization({}).buttons, defaults.buttons, 'default palette derives the same values as the defaults');
  const good = sanitizeCustomization({ buttons: { layout: 'stacked', order: 'buy_first', radius: 20, fontWeight: '500', uppercase: true, buyNowBackground: '#ff0000' } });
  assert.deepEqual(good.errors, []);
  assert.equal(good.value.buttons.fontWeight, 500);
  const bad = sanitizeCustomization({ buttons: { layout: 'grid', radius: 99, buyNowText: 'red', uppercase: 'yes' } });
  assert.equal(bad.errors.length, 4);
  // Old Pack (no buttons group): Buy Now stays an outline in its button color on the card background.
  const legacy = mergeCustomization({ colors: { button: '#aa0000', cardBackground: '#fafafa' }, borders: { radius: 4 } });
  assert.deepEqual([legacy.buttons.addBorder, legacy.buttons.buyNowBackground, legacy.buttons.buyNowText, legacy.buttons.buyNowBorder, legacy.buttons.radius], ['#aa0000', '#fafafa', '#aa0000', '#aa0000', 4]);
  // Once saved with buttons, its own values win.
  assert.equal(mergeCustomization(legacy, { colors: { button: '#000000' } }).buttons.buyNowText, '#aa0000');
  // Reset styling resets the buttons too.
  assert.deepEqual(applyDesign(good.value, 'slots').buttons, defaults.buttons);
});

test('placement is below the price or custom; old buy-button placements become below the price', () => {
  assert.equal(defaultCustomization().placement.position, 'below_price');
  for (const old of ['above_buttons', 'below_buttons']) {
    const result = sanitizeCustomization({ placement: { position: old } });
    assert.deepEqual(result.errors, []);
    assert.equal(mergeCustomization(result.value).placement.position, 'below_price');
  }
  assert.equal(sanitizeCustomization({ placement: { position: 'custom' } }).value.placement.position, 'custom');
  assert.ok(sanitizeCustomization({ placement: { position: 'sidebar' } }).errors.length > 0);
});

// ─── item selection: Shopify options -> real variants ─────────────────────────
const tee = [
  { id: '1', title: 'S / Red', options: ['S', 'Red'], price: 40, availableForSale: true },
  { id: '2', title: 'M / Red', options: ['M', 'Red'], price: 40, availableForSale: true },
  { id: '3', title: 'M / Blue', options: ['M', 'Blue'], price: 42, availableForSale: true },
  { id: '4', title: 'L / Blue', options: ['L', 'Blue'], price: 42, availableForSale: false },
  { id: '5', title: 'XL / Blue', options: ['XL', 'Blue'], price: 42, availableForSale: true, maxQuantity: 1 },
];

test('options come from Shopify data: any names, any count, only values the variants use', () => {
  const { options, variants } = normalizeOptionData(['Size', 'Color'], tee);
  assert.deepEqual(options, [{ name: 'Size', values: ['S', 'M', 'L', 'XL'] }, { name: 'Color', values: ['Red', 'Blue'] }]);
  assert.deepEqual(variants[2].optionValues, ['M', 'Blue']);
  const three = normalizeOptionData([{ name: 'Finish', values: ['Gloss', 'Matte'] }, 'Capacity', 'Color'], [
    { id: 'a', options: ['Matte', '500ml', 'Black'] }, { id: 'b', options: ['Gloss', '1L', 'Black'] },
  ]);
  assert.deepEqual(three.options.map((option) => option.name), ['Finish', 'Capacity', 'Color']);
  assert.deepEqual(three.options[0].values, ['Gloss', 'Matte'], 'Shopify value order kept');
  assert.deepEqual(three.options[2].values, ['Black'], 'single value');
  assert.deepEqual(emptySelection(three.options), ['', '', 'Black'], 'a one-value option is pre-chosen');
});

test('no real options (Default Title) -> nothing to choose, the one variant resolves; missing option data falls back to titles', () => {
  const single = normalizeOptionData(['Title'], [{ id: '9', title: 'Default Title', options: ['Default Title'] }]);
  assert.deepEqual(single.options, []);
  assert.equal(resolveVariant(single.variants, single.options, []).id, '9');
  const noData = normalizeOptionData(null, [{ id: '1', title: 'Black / M' }, { id: '2', title: 'White / L' }]);
  assert.deepEqual(noData.options, [{ name: 'Variant', values: ['Black / M', 'White / L'] }]);
  assert.equal(resolveVariant(noData.variants, noData.options, ['White / L']).id, '2');
});

test('variant resolution is exact; unavailable combinations never fall back to another variant', () => {
  const { options, variants } = normalizeOptionData(['Size', 'Color'], tee);
  assert.equal(resolveVariant(variants, options, ['M', 'Blue']).id, '3');
  assert.equal(resolveVariant(variants, options, ['S', 'Blue']), null);
  assert.equal(resolveVariant(variants, options, ['M', '']), null);
  assert.deepEqual(selectionStatus(variants, options, ['', 'Red']), { variant: null, problem: 'incomplete', missing: ['Size'] });
  assert.equal(selectionStatus(variants, options, ['S', 'Blue']).problem, 'unavailable');
  assert.equal(selectionStatus(variants, options, ['L', 'Blue']).problem, 'sold_out');
  assert.equal(selectionStatus(variants, options, ['M', 'Red']).problem, null);
});

test('option choices cascade from earlier options and flag sold-out / missing values', () => {
  const { options, variants } = normalizeOptionData(['Color', 'Size'], tee.map((v) => ({ ...v, options: [v.options[1], v.options[0]] })));
  const sizes = optionChoices(variants, options, ['Red', ''], 1);
  assert.deepEqual(sizes.map((c) => [c.value, c.exists, c.available]), [['S', true, true], ['M', true, true], ['L', false, false], ['XL', false, false]]);
  const blue = optionChoices(variants, options, ['Blue', ''], 1);
  assert.deepEqual(blue.find((c) => c.value === 'L'), { value: 'L', exists: true, available: false }, 'sold out');
  assert.ok(optionChoices(variants, options, ['', 'L'], 0).every((c) => c.exists), 'the first option is never filtered by later ones');
});

test('selection rules follow the Pack type; quick-add blocks full packs, duplicates (if disallowed) and stock', () => {
  assert.deepEqual(packSelectionRules({ packType: 'same_variant' }), { sameVariant: true, allowDuplicates: true });
  assert.deepEqual(packSelectionRules({ packType: 'mix_match' }), { sameVariant: false, allowDuplicates: true });
  const [s, , , l, xl] = tee;
  assert.equal(pickBlockReason([], s, { quantity: 2 }), null);
  assert.equal(pickBlockReason(['1'], s, { quantity: 2 }), null, 'same variant twice is allowed');
  assert.equal(pickBlockReason(['1'], s, { quantity: 2, allowDuplicates: false }), 'duplicate');
  assert.equal(pickBlockReason(['1', '2'], s, { quantity: 2 }), 'full');
  assert.equal(pickBlockReason([], l, { quantity: 2 }), 'sold_out');
  assert.equal(pickBlockReason(['5'], xl, { quantity: 3 }), 'stock', 'only 1 XL in stock');
});

test('cart lines: one per real variant with the units picked', () => {
  assert.deepEqual(groupCartItems(['2', '3', '2']), [{ id: '2', quantity: 2 }, { id: '3', quantity: 1 }]);
  assert.deepEqual(groupCartItems(['2', '2']), [{ id: '2', quantity: 2 }]);
});
