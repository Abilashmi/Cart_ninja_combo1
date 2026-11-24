// Run with: node --import ./tests/packs/register.mjs --test tests/combo-weight/combo-align.test.mjs
// Combo title / description alignment on phones: the builder used to save
// 'left' for phones on every template, so phones now follow desktop unless the
// merchant picked a phone alignment (app/utils/combo-align.shared.js), and the
// storefront kit's ES5 copy agrees.
import test from 'node:test';
import assert from 'node:assert/strict';
import { comboAlign } from '../../app/utils/combo-align.shared.js';
import { createComboWeightCore } from '../../app/utils/combo-weight.shared.js';
import { createQuickShopKit } from '../../app/utils/combo-quickshop.shared.js';

const kit = createQuickShopKit(createComboWeightCore());

const CASES = [
  // [config, phone?, expected, why]
  [{ heading_align: 'center', heading_align_mobile: 'left' }, true, 'center', 'old saved default "left" on phones follows desktop (knitnknot template 114)'],
  [{ heading_align: 'center', heading_align_mobile: 'left' }, false, 'center', 'desktop'],
  [{ heading_align: 'center', heading_align_mobile: 'left', heading_align_mobile_set: true }, true, 'left', 'left picked in the phone view counts'],
  [{ heading_align: 'left', heading_align_mobile: 'center' }, true, 'center', 'any other phone value counts'],
  [{ heading_align: 'right', heading_align_mobile: '' }, true, 'right', 'empty = same as desktop'],
  [{}, true, 'left', 'nothing saved = left'],
  [{ heading_align: 'middle', heading_align_mobile: 'nope' }, true, 'left', 'invalid values ignored'],
];

test('phones follow desktop unless the merchant set a phone alignment', () => {
  for (const [config, phone, expected, why] of CASES) assert.equal(comboAlign(config, 'heading', phone), expected, why);
});

test('the storefront kit uses the same rule', () => {
  for (const [config, phone, expected, why] of CASES) assert.equal(kit.alignOf(config, 'heading', phone), expected, why);
  assert.equal(kit.alignOf({ description_align: 'center', description_align_mobile: 'left' }, 'description', true), 'center');
});
