// Cart Editor → Design → Layout (drawer width + spacing per device): shared
// rules and their copy in cart_drawer_inline.js (ccDrawerLayout). Pure
// functions, no network.
// Run with: node --test tests/cart-drawer/drawer-layout.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_LAYOUT, LAYOUT_DEVICES, sanitizeDrawerLayout } from '../../app/utils/drawer-layout.shared.js';

test('defaults: the drawer as it was (phone folded, desktop not)', () => {
  assert.deepEqual(sanitizeDrawerLayout(undefined, 'phone'), { ...DEFAULT_LAYOUT.phone });
  assert.deepEqual(sanitizeDrawerLayout(undefined, 'desktop'), { ...DEFAULT_LAYOUT.desktop });
  assert.equal(DEFAULT_LAYOUT.phone.foldSummary, true);
  assert.equal(DEFAULT_LAYOUT.desktop.foldSummary, false);
  assert.equal(DEFAULT_LAYOUT.desktop.drawerWidth, 420);
  assert.equal(DEFAULT_LAYOUT.phone.drawerWidth, 100);
});

test('numbers are clamped per device, bad values fall back', () => {
  const p = sanitizeDrawerLayout({ drawerWidth: 50, headerPadding: 99, bodyPadding: -3, sectionGap: '5.6', footerPadding: 'x', itemImageSize: 10, showFooterNote: 0 }, 'phone');
  assert.deepEqual(p, { ...DEFAULT_LAYOUT.phone, drawerWidth: 70, headerPadding: 32, bodyPadding: 0, sectionGap: 6, itemImageSize: 40 });
  assert.equal(sanitizeDrawerLayout({ drawerWidth: 900 }, 'desktop').drawerWidth, 640);
  assert.equal(sanitizeDrawerLayout({ drawerWidth: 100 }, 'desktop').drawerWidth, 320);
  assert.equal(sanitizeDrawerLayout({ foldSummary: true }, 'desktop').foldSummary, true);
  assert.equal(sanitizeDrawerLayout({ bodyPadding: '' }, 'phone').bodyPadding, 10);
  assert.equal(sanitizeDrawerLayout({ bodyPadding: null }, 'desktop').bodyPadding, 16);
});

test('product text sizes go by half pixels, other numbers by whole ones', () => {
  assert.equal(DEFAULT_LAYOUT.phone.itemTitleSize, 13.5);
  const p = sanitizeDrawerLayout({ itemTitleSize: 12.3, itemPriceSize: '11.75', itemTotalSize: 40, itemImageSize: 52.5 }, 'phone');
  assert.deepEqual([p.itemTitleSize, p.itemPriceSize, p.itemTotalSize, p.itemImageSize], [12.5, 12, 24, 53]);
  assert.equal(sanitizeDrawerLayout({ itemTitleSize: 2 }, 'desktop').itemTitleSize, 10);
});

test('cart_drawer_inline.js ccDrawerLayout matches the shared rules', () => {
  const src = fs.readFileSync('extensions/cart-drawer/assets/cart_drawer_inline.js', 'utf8');
  const consts = src.match(/const CC_SPACING_LIMITS = \{[\s\S]+?\n {2}const CC_LAYOUT_DEFAULTS = \{[\s\S]+?\n {2}\};/);
  assert.ok(consts, 'CC_SPACING_LIMITS ... CC_LAYOUT_DEFAULTS in cart_drawer_inline.js');
  const start = src.indexOf('function ccDrawerLayout(');
  let depth = 0;
  let end = src.indexOf('{', start);
  for (let i = end; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  const cc = new Function(`${consts[0]} ${src.slice(start, end)}; return ccDrawerLayout;`)();
  const cases = [
    null,
    {},
    { foldSummary: false },
    { foldSummary: true, showFooterNote: 'no' },
    { drawerWidth: 85, headerPadding: 6, bodyPadding: 4, sectionGap: 2, footerPadding: 6 },
    { drawerWidth: 9999, headerPadding: 99, bodyPadding: -3, sectionGap: '5.6', footerPadding: 'x' },
    { bodyPadding: '', sectionGap: null },
    { announcementPadding: 0, countdownPadding: 3, progressPadding: 30, progressHeadingGap: 0, progressHeadingSize: 9, progressLabelGap: 4,
      itemPadding: 6, itemGap: 4, itemImageSize: 52, summaryRowGap: 2, summaryGap: 4, buttonGap: 6,
      foldSummary: false, showItemsHeading: false, showFooterNote: false },
    { itemTitleSize: 12.3, itemPriceSize: '11.75', itemTotalSize: 99 },
  ];
  for (const device of LAYOUT_DEVICES) {
    for (const c of cases) assert.deepEqual(cc(c, device), sanitizeDrawerLayout(c, device), `${device} ${JSON.stringify(c)}`);
  }
});
