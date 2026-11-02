import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFooterExtras } from '../../app/utils/cart-footer-extras.shared.js';

const fx = createFooterExtras();

test('storefront copy is the shared source, verbatim', () => {
  const shared = fs.readFileSync(new URL('../../app/utils/cart-footer-extras.shared.js', import.meta.url), 'utf8');
  const inline = fs.readFileSync(new URL('../../extensions/cart-drawer/assets/cart_drawer_inline.js', import.meta.url), 'utf8');
  const fn = shared.slice(shared.indexOf('export function createFooterExtras'), shared.indexOf('export const footerExtras')).replace('export function', 'function').trimEnd();
  const block = inline.slice(inline.indexOf('footer-extras:begin'), inline.indexOf('footer-extras:end'));
  const strip = (s) => s.replace(/\s+/g, '');
  assert.ok(strip(block).includes(strip(fn)));
});

test('cards: off or empty draws nothing; brands, text and https images draw', () => {
  assert.equal(fx.cardsHtml(fx.cardsConfig({ enabled: false })), '');
  assert.equal(fx.cardsHtml(fx.cardsConfig({ enabled: true, items: [] })), '');
  const html = fx.cardsHtml(fx.cardsConfig({
    enabled: true, height: 30,
    items: [{ type: 'brand', brand: 'visa' }, { type: 'text', text: 'Size <b>' }, { type: 'image', src: 'https://x.test/a.png' }, { type: 'image', src: 'javascript:alert(1)' }, { type: 'brand', brand: 'nope' }],
  }));
  assert.match(html, /aria-label="visa"/);
  assert.match(html, /Size &lt;b&gt;/);
  assert.match(html, /https:\/\/x\.test\/a\.png/);
  assert.doesNotMatch(html, /javascript:/);
  assert.equal((html.match(/class="cc-pay-card[ "]/g) || []).length, 3);
});

test('trust badges: limit, escaping, own icon image only over https', () => {
  const cfg = fx.trustConfig({ enabled: true, items: Array.from({ length: 6 }, (_, i) => ({ icon: 'truck', title: `T${i}<`, iconImage: i === 0 ? 'http://x.test/a.png' : '' })) });
  assert.equal(cfg.items.length, fx.MAX_BADGES);
  const html = fx.trustHtml(cfg);
  assert.match(html, /T0&lt;/);
  assert.doesNotMatch(html, /http:\/\/x\.test/);
  assert.equal(fx.trustHtml({ ...cfg, enabled: false }), '');
});

test('defaults match the reference design (3 badges, 2 cards) and numbers are clamped', () => {
  assert.equal(fx.trustConfig(null).items.length, 3);
  assert.equal(fx.cardsConfig(null).items.length, 2);
  assert.equal(fx.cardsConfig({ height: 999 }).height, 48);
  assert.equal(fx.trustConfig({ iconSize: 1 }).iconSize, 12);
});
