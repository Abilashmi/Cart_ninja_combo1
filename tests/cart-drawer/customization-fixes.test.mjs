// Cart drawer customization fixes: shared rules for colour codes, the rotating
// announcement bar, progress bar colours, FBT colours and free gift
// variant / badge. Pure functions, no network.
// Run with: node --import ./tests/packs/register.mjs --test tests/cart-drawer/customization-fixes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { isHexColor, normalizeHex } from '../../app/utils/color.shared.js';
import { announcementMessages, clampInterval, cleanMessages, messagesFromConfig } from '../../app/utils/announcement.shared.js';
import { withoutLegacyBarColors } from '../../app/utils/progress-bar-colors.shared.js';
import { darken, fbtEffectiveColors, pickFbtExtras } from '../../app/utils/fbt-style.shared.js';
import { getUnlockedRewards, getPreviewTotals, rewardBadgeText, rewardVariant } from '../../app/utils/preview-cart.js';
import { COUPON_ICON_OPTIONS, COUPON_ICON_PATHS, couponIconSvg } from '../../app/utils/coupon-style.shared.js';

test('colour codes: #rgb and #rrggbb (with or without #) are valid and stored as #rrggbb', () => {
  for (const ok of ['#008060', '#FF5733', '#000000', '#abc', 'ABC', '008060', '  #fff  ']) assert.equal(isHexColor(ok), true, ok);
  for (const bad of ['', '#12', '#12345', '#1234567', 'red', 'rgb(0,0,0)', '#ggg', null, undefined, 123]) assert.equal(isHexColor(bad), false, String(bad));
  assert.equal(normalizeHex('#ABC'), '#aabbcc');
  assert.equal(normalizeHex('FF5733'), '#ff5733');
  assert.equal(normalizeHex('#00806'), null);
});

test('announcements: the stored list wins, else the single text; blanks dropped, max 10', () => {
  assert.deepEqual(messagesFromConfig('["Free shipping","  ","Sale ends Sunday"]', 'old'), ['Free shipping', 'Sale ends Sunday']);
  assert.deepEqual(messagesFromConfig(null, 'Only one'), ['Only one'], 'bars saved before rotation keep their text');
  assert.deepEqual(messagesFromConfig('not json', ''), []);
  assert.equal(cleanMessages(Array.from({ length: 14 }, (_, i) => `m${i}`)).length, 10);
  assert.deepEqual(announcementMessages({ messages: ['', ''], text: 'Fallback' }), ['Fallback']);
  assert.equal(clampInterval(1), 2);
  assert.equal(clampInterval(99), 15);
  assert.equal(clampInterval('x'), 4);
});

test('progress bar: old flat colour keys are folded into colors and never saved again', () => {
  const blob = { enabled: true, barBackgroundColor: '#e2e8f0', barForegroundColor: '#2563eb', fill_color: '#2563eb', colors: { background: '#ff0000' }, tiers: [] };
  const out = withoutLegacyBarColors(blob);
  assert.equal(out.colors.background, '#ff0000', "the picker's value wins over the stale flat key");
  assert.equal(out.colors.fill, '#2563eb', 'a value only in the old key is kept');
  for (const k of ['barBackgroundColor', 'barForegroundColor', 'fill_color']) assert.equal(k in out, false, k);
  assert.equal(withoutLegacyBarColors({ colors: {} }).colors.background, undefined);
});

test('FBT: empty extra colours follow the base colours, so saved widgets look the same', () => {
  const base = { textColor: '#111827', priceColor: '#059669', buttonColor: '#111827', buttonTextColor: '#ffffff' };
  const c = fbtEffectiveColors({ ...base, ...pickFbtExtras({}) });
  assert.equal(c.heading, '#111827');
  assert.equal(c.title, '#111827');
  assert.equal(c.selectedBg, '#008060', 'Classic "Added" keeps its old green until changed');
  assert.equal(c.checkbox, '#111827');
  assert.equal(c.successText, '#ffffff');
  assert.equal(c.buttonHover, darken('#111827'));
  const custom = fbtEffectiveColors({ ...base, ...pickFbtExtras({ headingColor: '#ABC', selectedBgColor: '#ff5733', titleColor: 'red' }) });
  assert.equal(custom.heading, '#aabbcc');
  assert.equal(custom.selectedBg, '#ff5733');
  assert.equal(custom.title, '#111827', 'an invalid code is ignored');
  assert.equal(darken('#ffffff'), '#e0e0e0');
});

test('free gift: the chosen variant is added while in stock, else the first in-stock one', () => {
  const product = {
    id: 'gid://shopify/Product/1', title: 'Mug', price: '100',
    variants: [
      { id: 'gid://shopify/ProductVariant/10', title: 'Red', price: '100', available: false },
      { id: 'gid://shopify/ProductVariant/11', title: 'Blue', price: '120', available: true },
      { id: 'gid://shopify/ProductVariant/12', title: 'Green', price: '130', available: true },
    ],
  };
  assert.equal(rewardVariant(product, 'gid://shopify/ProductVariant/12').title, 'Green');
  assert.equal(rewardVariant(product, 'gid://shopify/ProductVariant/10').title, 'Blue', 'sold-out choice falls back');
  assert.equal(rewardVariant(product, undefined).title, 'Blue');
  assert.equal(rewardVariant({ variants: [] }, 'x'), null);

  const tiers = [{ id: 't', minimumSpend: 500, rewardProducts: [product.id], rewardPricing: 'regular', rewardVariants: { [product.id]: 'gid://shopify/ProductVariant/12' }, rewardBadgeLabel: 'BIRTHDAY GIFT' }];
  const [r] = getUnlockedRewards({ tiers, mode: 'amount', total: 600, count: 1, allProducts: [product] });
  assert.equal(r.variant.title, 'Green');
  assert.equal(r.badge, 'BIRTHDAY GIFT');
  assert.equal(getPreviewTotals({ baseTotal: 600, added: [], rewards: [r] }).regularRewardTotal, 130, 'regular-price gift is priced at its chosen variant');
});

test('free gift badge: own text, else FREE GIFT / REWARD; "free" text only on a free gift', () => {
  assert.equal(rewardBadgeText('', true), 'FREE GIFT');
  assert.equal(rewardBadgeText('  ', false), 'REWARD');
  assert.equal(rewardBadgeText('VIP BONUS', false), 'VIP BONUS');
  assert.equal(rewardBadgeText('Free mug', true), 'Free mug');
  assert.equal(rewardBadgeText('Free mug', false), 'REWARD', 'never claim free on a charged gift');
  assert.equal(rewardBadgeText('x'.repeat(40), true).length, 30);
});

test('coupon icons: a ₹ (rupee) icon is offered and drawn as SVG paths, not text', () => {
  assert.ok(COUPON_ICON_OPTIONS.some((o) => o.value === 'rupee'));
  assert.ok(COUPON_ICON_PATHS.rupee.startsWith('<path'));
  const svg = couponIconSvg('rupee', 18, '#008060');
  assert.match(svg, /fill="#008060"/);
  assert.doesNotMatch(svg, /₹|<text/);
});
