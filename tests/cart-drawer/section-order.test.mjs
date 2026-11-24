import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { sanitizeSectionOrder, deriveSectionOrder, moveSection, SECTION_ZONES } from '../../app/utils/section-order.shared.js';

// The storefront's ES5 copy (cart_drawer_inline.js), pulled out and run on its own.
const inline = fs.readFileSync(new URL('../../extensions/cart-drawer/assets/cart_drawer_inline.js', import.meta.url), 'utf8');
const start = inline.indexOf('var CC_SECTION_ZONES');
const end = inline.indexOf('  // Puts the drawn parts in the saved order');
const ctx = {};
vm.runInNewContext(inline.slice(start, end) + '\nthis.ccSectionOrder = ccSectionOrder; this.zones = CC_SECTION_ZONES;', ctx);

test('storefront zones match the shared ones', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.zones)), SECTION_ZONES);
});

test('nothing saved = null on both sides (the drawer is untouched)', () => {
  for (const raw of [undefined, null, '', 5, 'x']) {
    assert.equal(sanitizeSectionOrder(raw), null);
    assert.equal(ctx.ccSectionOrder(raw), null);
  }
});

test('shared and storefront sanitizers agree: unknown dropped, duplicates once, missing added', () => {
  const raw = {
    main: ['items', 'nope', 'items', 'progress', 'announcement'],
    footer: 'broken',
  };
  const a = sanitizeSectionOrder(raw);
  const b = JSON.parse(JSON.stringify(ctx.ccSectionOrder(raw)));
  assert.deepEqual(a, b);
  assert.deepEqual(a.main, ['items', 'progress', 'announcement', 'header', 'countdown', 'coupons', 'banner', 'upsell']);
  assert.deepEqual(a.footer, SECTION_ZONES.footer);
});

test('an earlier { top, body } save is joined into main, on both sides', () => {
  const raw = { top: ['countdown', 'header'], body: ['items', 'progress'], footer: ['trust'] };
  const a = sanitizeSectionOrder(raw);
  assert.deepEqual(a, JSON.parse(JSON.stringify(ctx.ccSectionOrder(raw))));
  assert.deepEqual(a.main.slice(0, 4), ['countdown', 'header', 'items', 'progress']);
});

test('derived order = what the drawer shows today', () => {
  const d = deriveSectionOrder({ progressPos: 'top', couponPos: 'top', upsellPos: 'bottom', bannerSlot: 'afterTopBar', trustPlacement: 'below', continuePlacement: 'below' });
  assert.deepEqual(d.main, ['header', 'announcement', 'countdown', 'progress', 'banner', 'coupons', 'items', 'upsell']);
  assert.deepEqual(d.footer, ['summary', 'checkout', 'cards', 'trust', 'continue']);
  const e = deriveSectionOrder({ progressPos: 'bottom', couponPos: 'bottom', upsellPos: 'top', bannerSlot: 'top', trustPlacement: 'above', continuePlacement: 'above' });
  assert.deepEqual(e.main.slice(3), ['banner', 'upsell', 'items', 'progress', 'coupons']);
  assert.deepEqual(e.footer, ['summary', 'continue', 'trust', 'checkout', 'cards']);
});

test('moveSection: down goes after the target, up goes before; the footer is untouched', () => {
  const base = sanitizeSectionOrder({ main: SECTION_ZONES.main, footer: SECTION_ZONES.footer });
  // An announcement can go down past body parts, and a body part up past the header.
  assert.deepEqual(moveSection(base, 'main', 'announcement', 'coupons').main, ['header', 'countdown', 'progress', 'coupons', 'announcement', 'banner', 'upsell', 'items']);
  assert.deepEqual(moveSection(base, 'main', 'items', 'header').main, ['items', 'header', 'announcement', 'countdown', 'progress', 'coupons', 'banner', 'upsell']);
  assert.deepEqual(moveSection(base, 'main', 'items', 'items').main, base.main);
  assert.deepEqual(moveSection(base, 'main', 'progress', 'trust').main, base.main);
  assert.deepEqual(moveSection(base, 'main', 'progress', 'banner').footer, base.footer);
});
