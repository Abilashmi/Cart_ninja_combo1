// Run with: node --import ./tests/packs/register.mjs --test tests/combo-weight
// The three box templates (Quantity Box layout7 / Weight Box layout5 / Value
// Box layout6) and the older Classic Combo designs (layout1/2/4). Pure rules
// only (plan gating, measures, design switch, labels).
import test from 'node:test';
import assert from 'node:assert/strict';
import { canPublishFeature } from '../../app/config/plans.js';
import {
  boxPricingFeature, fixedMeasureFor, layoutAllowsMeasures, offerLabel, computeBox, normalizeWeightPricing, progressOf, boxMessage,
  usesQuickShop, isWeightCombo, comboCollectionHandles,
} from '../../app/utils/combo-weight.shared.js';
import { CLASSIC_DESIGNS, isClassicLayout, designCollections, switchComboDesign } from '../../app/utils/combo-design.shared.js';

test('box pricing feature per template: Quantity Box = Starter+, Weight / Value Box = Growth+, Pro unlimited', () => {
  assert.equal(boxPricingFeature('layout7'), 'combo_quantity_pricing');
  assert.equal(boxPricingFeature('layout5'), 'combo_weight_pricing');
  assert.equal(boxPricingFeature('layout6'), 'combo_value_pricing');
  for (const layout of ['layout1', 'layout2', 'layout4', undefined]) assert.equal(boxPricingFeature(layout), 'combo_tier_pricing', String(layout));

  const can = (plan, layout) => canPublishFeature(plan, boxPricingFeature(layout));
  assert.deepEqual(['layout7', 'layout5', 'layout6'].map((l) => can('free', l)), [false, false, false]);
  assert.deepEqual(['layout7', 'layout5', 'layout6'].map((l) => can('starter', l)), [true, false, false]);
  assert.deepEqual(['layout7', 'layout5', 'layout6'].map((l) => can('growth', l)), [true, true, true]);
  assert.deepEqual(['layout7', 'layout5', 'layout6'].map((l) => can('pro', l)), [true, true, true]);
  assert.equal(can('starter', 'layout1'), false, 'older Classic tiers stay Growth+');
});

test('each box template has one measure; only the older Classic designs choose', () => {
  assert.equal(fixedMeasureFor('layout7'), 'quantity');
  assert.equal(fixedMeasureFor('layout5'), 'weight');
  assert.equal(fixedMeasureFor('layout6'), 'value');
  assert.equal(fixedMeasureFor('layout3'), 'weight');
  for (const layout of ['layout1', 'layout2', 'layout4']) {
    assert.equal(fixedMeasureFor(layout), null, layout);
    assert.equal(layoutAllowsMeasures(layout), true, layout);
  }
  for (const layout of ['layout5', 'layout6', 'layout7']) {
    assert.equal(layoutAllowsMeasures(layout), false, layout);
    assert.equal(usesQuickShop(layout), true, layout);
    assert.equal(isWeightCombo({ layout }), true, layout);
  }
  assert.deepEqual(comboCollectionHandles({ layout: 'layout7', col_1: 'tops', col_2: 'bottoms', tab_count: 2 }), ['tops', 'bottoms']);
});

test('design list and classic layouts', () => {
  assert.deepEqual(CLASSIC_DESIGNS.map((d) => d.layout), ['layout1', 'layout2', 'layout4']);
  assert.equal(isClassicLayout(undefined), true);
  assert.equal(isClassicLayout('layout4'), true);
  assert.equal(isClassicLayout('layout5'), false);
  assert.equal(isClassicLayout('layout6'), false);
});

test('switching design carries the collections over and keeps everything else', () => {
  const guided = {
    layout: 'layout1', max_selections: 3, step_1_collection: 'tops', step_2_collection: 'bottoms', step_3_collection: '',
    pricing_mode: 'weight', weight_pricing: { measure: 'quantity' }, tier_progress_style: 'bar',
  };
  assert.deepEqual(designCollections(guided), ['tops', 'bottoms']);

  const tabs = switchComboDesign(guided, 'layout2');
  assert.deepEqual(tabs, { layout: 'layout2', col_1: 'tops', col_2: 'bottoms', tab_count: 2 });
  const asTabs = { ...guided, ...tabs };
  assert.equal(asTabs.pricing_mode, 'weight', 'offer untouched');
  assert.equal(asTabs.step_1_collection, 'tops', 'old design keys kept, so switching back restores them');

  assert.deepEqual(switchComboDesign(asTabs, 'layout4'), { layout: 'layout4', collection_handle: 'tops' });
  // Back to Guided: it still has its own steps, so nothing is overwritten.
  assert.deepEqual(switchComboDesign({ ...asTabs, layout: 'layout4', collection_handle: 'tops' }, 'layout1'), { layout: 'layout1' });

  const grid = { layout: 'layout4', collection_handle: 'gifts' };
  assert.deepEqual(switchComboDesign(grid, 'layout1'), { layout: 'layout1', step_1_collection: 'gifts', max_selections: 1 });

  // A design that already has its own collections keeps them.
  assert.deepEqual(switchComboDesign({ ...grid, col_1: 'mine', tab_count: 1 }, 'layout2'), { layout: 'layout2' });
  // Not a Classic design: no patch.
  assert.deepEqual(switchComboDesign(grid, 'layout6'), {});
});

test('"Buy 2 for 999" on a Classic Combo: quantity box price, needs a max', () => {
  const raw = { measure: 'quantity', max_grams: 3, tiers: [
    { id: 'a', min_grams: 2, type: 'fixed_price', value: 999, label: '' },
    { id: 'b', min_grams: 3, type: 'fixed_price', value: 1399, label: '' },
  ] };
  const { value, errors } = normalizeWeightPricing(raw);
  assert.deepEqual(errors, []);
  assert.equal(value.measure, 'quantity');
  assert.ok(normalizeWeightPricing({ ...raw, max_grams: null }).errors.some((e) => e.field === 'max_grams'), 'a box price without a max is refused');

  const line = (key, price, qty) => ({ key, unitGrams: null, quantity: qty, subtotalMinor: price * qty * 100, qualifies: true });
  const one = computeBox({ pricing: value, lines: [line('x', 700, 1)] });
  assert.equal(one.tier, null);
  const two = computeBox({ pricing: value, lines: [line('x', 700, 1), line('y', 650, 1)] });
  assert.equal(two.tier.id, 'a');
  assert.equal(two.subtotalMinor - two.discountMinor, 99900, 'the 2 items cost 999');
  const four = computeBox({ pricing: value, lines: [line('x', 700, 4)] });
  assert.equal(four.overMax, true);

  assert.equal(offerLabel(value.tiers[0], 'quantity', '₹'), 'Any 2 for ₹999');
  assert.equal(offerLabel({ ...value.tiers[0], label: 'COMBO DEAL' }, 'quantity', '₹'), 'COMBO DEAL');
  assert.equal(offerLabel({ min_grams: 1000, type: 'fixed_price', value: 499 }, 'weight', '₹'), 'Box at ₹499');
  assert.equal(offerLabel({ min_grams: 3, type: 'percentage', value: 10 }, 'quantity', '₹'), '10% OFF');
  assert.equal(offerLabel({ min_grams: 999, type: 'fixed_amount', value: 100 }, 'value', '₹'), '₹100 OFF');
});

test('value tiers: progress and message in money', () => {
  const { value } = normalizeWeightPricing({ measure: 'value', tiers: [
    { id: 'a', min_grams: 999, type: 'fixed_amount', value: 100 },
    { id: 'b', min_grams: 1999, type: 'percentage', value: 15 },
  ] });
  const box = computeBox({ pricing: value, decimals: 2, lines: [{ key: 'x', quantity: 1, subtotalMinor: 120000, qualifies: true }] });
  assert.equal(box.tier.id, 'a');
  const view = { measure: 'value', tiers: value.tiers, messages: value.messages, enabled: true, currencySymbol: '₹' };
  const progress = progressOf(view, box);
  assert.equal(progress.marks[0].hit, true);
  assert.equal(progress.marks[1].hit, false);
  assert.match(boxMessage(view, box).text, /₹799/, 'what is still needed, in the shop currency');
});
