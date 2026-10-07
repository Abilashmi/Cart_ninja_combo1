// Run with: node --test tests/cart-drawer/cart-banner.shared.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BANNER_PLACEMENT_VALUES, DEFAULT_BANNER_PLACEMENT, isValidBannerImage, cleanBannerImage, cleanBannerPlacement,
  bannerSources, bannerVisible, bannerSlot,
} from '../../app/utils/cart-banner.shared.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

test('placements: the five options, Above Progress Bar by default', () => {
  assert.deepEqual(BANNER_PLACEMENT_VALUES, ['above_progress', 'below_progress', 'above_products', 'below_products', 'above_checkout']);
  assert.equal(DEFAULT_BANNER_PLACEMENT, 'above_progress');
  assert.equal(cleanBannerPlacement('below_products'), 'below_products');
  assert.equal(cleanBannerPlacement('sideways'), 'above_progress');
  assert.equal(cleanBannerPlacement(undefined), 'above_progress');
});

test('images: https links and raster data URLs only', () => {
  assert.equal(isValidBannerImage('https://cdn.shopify.com/s/files/1/banner.jpg?v=2'), true);
  assert.equal(isValidBannerImage(PNG), true);
  assert.equal(isValidBannerImage('data:image/webp;base64,UklGRg=='), true);
  assert.equal(isValidBannerImage('http://example.com/a.jpg'), false, 'no plain http');
  assert.equal(isValidBannerImage('data:image/svg+xml;base64,PHN2Zz4='), false, 'no SVG');
  assert.equal(isValidBannerImage('javascript:alert(1)'), false);
  assert.equal(isValidBannerImage('https://x.com/a.jpg" onerror="x'), false, 'no attribute breakout');
  assert.equal(isValidBannerImage(`data:image/png;base64,${'A'.repeat(800000)}`), false, 'size limit');
  assert.equal(cleanBannerImage('  https://x.com/b.png  '), 'https://x.com/b.png');
  assert.equal(cleanBannerImage('nope'), null);
});

test('mobile falls back to desktop and desktop to mobile; nothing without images', () => {
  assert.deepEqual(bannerSources('https://x.com/d.jpg', ''), { desktop: 'https://x.com/d.jpg', mobile: 'https://x.com/d.jpg' });
  assert.deepEqual(bannerSources('', 'https://x.com/m.jpg'), { desktop: 'https://x.com/m.jpg', mobile: 'https://x.com/m.jpg' });
  assert.deepEqual(bannerSources('https://x.com/d.jpg', 'https://x.com/m.jpg'), { desktop: 'https://x.com/d.jpg', mobile: 'https://x.com/m.jpg' });
  assert.equal(bannerSources('', ''), null);
  assert.equal(bannerVisible({ enabled: true, desktopImage: '', mobileImage: '' }), false, 'no image → nothing');
  assert.equal(bannerVisible({ enabled: false, desktopImage: 'https://x.com/d.jpg' }), false, 'off → nothing');
  assert.equal(bannerVisible({ enabled: true, desktopImage: '', mobileImage: 'https://x.com/m.jpg' }), true);
});

test('slot: progress-bar placements follow the bar; products / checkout are fixed', () => {
  const top = { progressShown: true, progressPosition: 'top' };
  const bottom = { progressShown: true, progressPosition: 'bottom' };
  const none = { progressShown: false, progressPosition: 'top' };
  assert.equal(bannerSlot('above_progress', top), 'top', 'default order: header → banner → progress bar → products');
  assert.equal(bannerSlot('below_progress', top), 'afterTopBar');
  assert.equal(bannerSlot('above_progress', bottom), 'beforeBottomBar');
  assert.equal(bannerSlot('below_progress', bottom), 'afterBottomBar');
  assert.equal(bannerSlot('above_progress', none), 'top', 'no progress bar → top of the cart');
  assert.equal(bannerSlot('below_progress', none), 'top');
  for (const ctx of [top, bottom, none]) {
    assert.equal(bannerSlot('above_products', ctx), 'beforeProducts');
    assert.equal(bannerSlot('below_products', ctx), 'afterProducts');
    assert.equal(bannerSlot('above_checkout', ctx), 'end');
  }
  assert.equal(bannerSlot('garbage', top), 'top', 'unknown placement → the default');
});
