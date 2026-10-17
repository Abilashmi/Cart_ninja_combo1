// Offer ladder rules (app/utils/offer-ladder.shared.js) and the storefront copy.
//
//   node --test tests/coupon-banner/offer-ladder.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { offerLadder as O, isLadderId, newLadderId, NEW_LADDER_STYLE } from '../../app/utils/offer-ladder.shared.js';

const LADDER = {
  autoApply: true,
  tiers: [
    { text: 'Buy any 3 Get 15% Off', qty: 3, code: 'BUY3' },
    { text: 'Buy any 2 Get 10% Off', qty: '2', code: ' BUY2 ' },
    { text: 'Buy any 5 Get 25% Off', qty: 5, code: '' },
  ],
};

test('the storefront snippet carries the shared block verbatim', () => {
  const read = (...p) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf8').replace(/\r\n/g, '\n');
  const block = (s) => s.slice(s.indexOf('/* offer-ladder:begin */'), s.indexOf('/* offer-ladder:end */'));
  const src = read('app', 'utils', 'offer-ladder.shared.js');
  assert.ok(block(src).length > 1000);
  assert.equal(block(read('extensions', 'cart-drawer', 'snippets', 'coupon-slider-render.liquid')), block(src), 'copy app/utils/offer-ladder.shared.js begin..end into coupon-slider-render.liquid');
});

test('normalize: merchant order kept, item count optional, codes trimmed, max 5', () => {
  const L = O.normalize({ ...LADDER, tiers: [...LADDER.tiers, { text: '', qty: 4 }, { text: 'No count', qty: 0 }, { text: 'Comma', qty: 7, code: 'A,B' }, null] });
  assert.deepEqual(L.tiers, [
    { text: 'Buy any 3 Get 15% Off', qty: 3, code: 'BUY3' },
    { text: 'Buy any 2 Get 10% Off', qty: 2, code: 'BUY2' },
    { text: 'Buy any 5 Get 25% Off', qty: 5, code: '' },
    { text: 'No count', qty: 0, code: '' },
    { text: 'Comma', qty: 7, code: '' },
  ]);
  assert.equal(O.normalize({ tiers: Array.from({ length: 8 }, (_, i) => ({ text: `T${i}` })) }).tiers.length, 5);
  const d = O.normalize({});
  assert.deepEqual([d.look, d.separator, d.interval, d.textSize, d.bg, d.fg, d.accent, d.autoApply, d.button], ['strip', '|', 4, 14, '#111827', '#ffffff', '#facc15', false, null]);
  const bad = O.normalize({ look: 'steps', separator: '<', interval: 99, textSize: 2, bgColor: 'red;}', textColor: '#abc', autoApply: 'yes' });
  assert.deepEqual([bad.look, bad.separator, bad.interval, bad.textSize, bad.bg, bad.fg, bad.autoApply], ['strip', '|', 15, 11, '#111827', '#abc', false]);
});

test('button: only when switched on with a code; default texts per action', () => {
  assert.equal(O.normalize({ buttonShow: true }).button, null, 'no code, no button');
  assert.equal(O.normalize({ buttonCode: 'SAVE10' }).button, null, 'not switched on');
  assert.deepEqual(O.normalize({ buttonShow: true, buttonCode: ' SAVE10 ' }).button, { action: 'copy', code: 'SAVE10', text: 'Copy code', doneText: 'Copied!' });
  assert.deepEqual(O.normalize({ buttonShow: true, buttonCode: 'SAVE10', buttonAction: 'apply', buttonText: 'Get it', buttonDoneText: 'Done' }).button, { action: 'apply', code: 'SAVE10', text: 'Get it', doneText: 'Done' });
  assert.deepEqual(O.normalize({ buttonShow: true, buttonCode: 'SAVE10', buttonAction: 'apply' }).button.text, 'Apply coupon');
});

test('cartCount skips BRIX reward gifts', () => {
  assert.equal(O.cartCount({ items: [{ quantity: 2 }, { quantity: 1, properties: { _brixReward: 'true' } }, { quantity: '3' }] }), 5);
  assert.equal(O.cartCount(null), 0);
});

test('codesFor: only with auto-apply; reached code replaces the ladder\'s others, shopper codes stay', () => {
  const L = O.normalize(LADDER);
  assert.equal(O.codesFor(O.normalize({ ...LADDER, autoApply: false }), 3, []), null, 'auto-apply off: never touches the cart');
  assert.equal(O.codesFor(L, 1, []), null, 'nothing reached, nothing on the cart');
  assert.deepEqual(O.codesFor(L, 2, []), ['BUY2']);
  assert.equal(O.codesFor(L, 2, ['buy2']), null, 'already there (any case)');
  assert.deepEqual(O.codesFor(L, 3, ['BUY2', 'WELCOME']), ['WELCOME', 'BUY3'], 'step up, keep the shopper\'s own code');
  assert.deepEqual(O.codesFor(L, 1, ['BUY3', 'WELCOME']), ['WELCOME'], 'cart went down: the ladder code comes off');
  assert.deepEqual(O.codesFor(L, 6, ['BUY3']), [], 'top offer has no code (automatic discount): lower codes come off');
  assert.equal(O.reached(L, 4).qty, 3, 'best reached, whatever the order');
});

test('html: text only by default, every look, escaped, optional button', () => {
  const L = O.normalize({ tiers: [{ text: 'Buy any 2 Get 10% Off' }, { text: '<b>x</b> & "y"' }], subtextText: 'Auto <i>applied</i>' });
  for (const look of O.LOOKS) {
    const h = O.html({ ...L, look }, {});
    assert.match(h, new RegExp(`class="psl psl--${look} psl--size-full"`));
    assert.doesNotMatch(h, /<b>x<\/b>|<i>applied/, `${look}: merchant text escaped`);
    assert.match(h, /&lt;b&gt;x&lt;\/b&gt; &amp; &quot;y&quot;/);
    assert.match(h, /Auto &lt;i&gt;applied&lt;\/i&gt;/);
    assert.doesNotMatch(h, /psl-btn|psl-status|psl-bar|more item/, `${look}: no button, no progress`);
  }
  const btn = O.normalize({ ...L, buttonShow: true, buttonCode: 'SAVE"10', buttonAction: 'apply' });
  assert.match(O.html(btn, {}), /<button type="button" class="psl-btn" data-psl-action="apply" data-psl-code="SAVE&quot;10">Apply coupon<\/button>/);
  assert.match(O.html(btn, { done: true }), /class="psl-btn is-done"[^>]*>Applied!</);
  const rot = O.html({ ...L, look: 'rotate' }, { show: 3 });
  assert.equal((rot.match(/is-show/g) || []).length, 1);
  assert.match(rot, /psl-slide is-show">&lt;b&gt;/, 'show wraps around (3 % 2 = 1)');
  assert.equal(O.html(O.normalize({}), {}), '', 'no offers: nothing drawn');
});

test('ids and the new-ladder defaults', () => {
  assert.ok(isLadderId(newLadderId()));
  assert.ok(!isLadderId('text:abc') && !isLadderId(null));
  const L = O.normalize(NEW_LADDER_STYLE);
  assert.deepEqual([L.tiers.length, L.autoApply, L.button], [2, false, null], 'text only until the merchant switches extras on');
});

test('layout + box size: direction, button position, width modes, spacing', () => {
  const d = O.normalize({ tiers: [{ text: 'A' }, { text: 'B' }] });
  assert.deepEqual([d.direction, d.buttonPlace, d.boxSize, d.boxWidth, d.padY, d.padX, d.minHeight], ['row', 'right', 'full', 400, 10, 14, 0], 'defaults draw what it drew before');
  const bad = O.normalize({ direction: 'diag', buttonPlace: 'left', boxSize: 'huge', boxWidth: 5000, padY: 0, padX: 99, minHeight: -4 });
  assert.deepEqual([bad.direction, bad.buttonPlace, bad.boxSize, bad.boxWidth, bad.padY, bad.padX, bad.minHeight], ['row', 'right', 'full', 800, 4, 40, 0]);
  const L = O.normalize({ tiers: [{ text: 'A' }, { text: 'B' }], direction: 'column', buttonShow: true, buttonCode: 'X', buttonPlace: 'below', boxSize: 'custom', boxWidth: 320, padY: 18, padX: 20, minHeight: 60 });
  const h = O.html(L, {});
  assert.match(h, /class="psl psl--strip psl--size-custom psl--col psl--btn psl--btn-below"/);
  assert.match(h, /--psl-py:18px;--psl-px:20px;--psl-mh:60px;max-width:320px;/);
  assert.doesNotMatch(O.html({ ...L, look: 'ticker' }, {}), /psl--col/, 'vertical is for the one-line look only');
  assert.doesNotMatch(O.html({ ...L, boxSize: 'atc' }, {}), /max-width/, 'Add to cart width is set by the storefront from the real button');
  assert.doesNotMatch(O.html({ ...L, buttonShow: false, button: null }, {}), /psl--btn/, 'no button, no button position');
});
