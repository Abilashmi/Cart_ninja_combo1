// Run with: node --import ./tests/packs/register.mjs --test tests/fbt-offer/fbt-size.test.mjs
// FBT "Match the shopper's size" (app/utils/fbt-size.shared.js): sizes
// compared across spellings, the size option found by name, and the variant
// picked for each recommended product. The widget's copy is checked in
// tests/fbt-offer/widget-browser-check.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSize, pickSizeVariant, sizeOptionIndex, sizeScore } from '../../app/utils/fbt-size.shared.js';

const same = (a, b) => sizeScore(parseSize(a), parseSize(b));

test('sizes match across spellings; ranges hold their ages; years never match months', () => {
  for (const v of ['12 Years', '12Y', '12 Yrs', '12 yr', '12', '12 YEARS']) assert.equal(same('12 Years', v), 2, v);
  assert.equal(same('12 Years', '11-12 Y'), 1, 'a range holding 12');
  assert.equal(same('11-12 Years', '12Y'), 1);
  assert.equal(same('12 Years', '13-14 Y'), 0);
  assert.equal(same('12 Years', '12 Months'), 0, 'years vs months');
  assert.equal(same('6-12 M', '9 Months'), 1);
  assert.equal(same('6M', 'M'), 0, 'six months is not size Medium');
  assert.equal(same('M', 'm'), 2, 'letter sizes compare as text');
  assert.equal(same('XL', 'L'), 0);
  assert.equal(same('Free Size', 'free-size'), 2);
  assert.equal(parseSize(''), null);
});

test('the size option: the merchant\'s name, else Size / Age / Years', () => {
  assert.equal(sizeOptionIndex(['Color', 'Size']), 1);
  assert.equal(sizeOptionIndex([{ name: 'Colour' }, { name: 'Age' }]), 1, '.js gives objects');
  assert.equal(sizeOptionIndex(['Color', 'Fit']), -1, 'no size option = no matching');
  assert.equal(sizeOptionIndex(['Color', 'Waist'], 'waist'), 1, 'the merchant names it');
  assert.equal(sizeOptionIndex(['Color', 'Size'], 'Length'), -1, 'a named option that isn\'t there');
});

const top = {
  optionNames: ['Color', 'Size'],
  liveVariantId: 'b2',
  variants: [
    { id: 'r1', available: true, opts: ['Red', '10 Y'] },
    { id: 'r2', available: true, opts: ['Red', '12 Y'] },
    { id: 'b1', available: true, opts: ['Blue', '11-12 Y'] },
    { id: 'b2', available: true, opts: ['Blue', '8 Y'] },
    { id: 'b3', available: false, opts: ['Blue', '12 Y'] },
  ],
};

test('pick: the exact size beats a range; the default colour is kept when it has the size', () => {
  assert.equal(pickSizeVariant(top, '12 Years').variant.id, 'r2', 'exact 12 Y (blue 12 Y is sold out)');
  assert.equal(pickSizeVariant(top, '11 Years').variant.id, 'b1', 'only the blue range holds 11');
  assert.equal(pickSizeVariant(top, '8 Years').variant.id, 'b2', 'same colour as the default');
  assert.deepEqual(pickSizeVariant(top, '14 Years'), { status: 'missing' });
  assert.deepEqual(pickSizeVariant({ optionNames: ['Title'], variants: [{ id: 'x', available: true, opts: ['Default Title'] }] }, '12 Years'), { status: 'none' }, 'one-size products are left as they are');
  assert.deepEqual(pickSizeVariant(top, ''), { status: 'none' }, 'no size on the page = no matching');
});
