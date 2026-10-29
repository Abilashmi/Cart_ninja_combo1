// Run with: node --import ./tests/packs/register.mjs --test tests/admin
// The home page's app embed status comes from App Bridge's
// shopify.app.extensions() (Built for Shopify 4.2.3); it used to always say
// "Store embed active".
import test from 'node:test';
import assert from 'node:assert/strict';
import { embedStatusFrom } from '../../app/components/shared/useAppEmbedStatus.js';

const theme = (status) => [{
  handle: 'cart-drawer', type: 'theme_app_extension',
  activations: [
    { handle: 'Fbt', target: 'body', status: 'active', activations: [] },
    { handle: 'cart_drawer', name: 'Custom Cart Drawer', target: 'body', status, activations: [] },
  ],
}];

test('the Custom Cart Drawer embed: active only when Shopify says so', () => {
  assert.equal(embedStatusFrom(theme('active')), 'active');
  assert.equal(embedStatusFrom(theme('available')), 'off', 'in the theme but switched off');
  assert.equal(embedStatusFrom(theme('unavailable')), 'off');
});

test('no theme extension, or no such embed: off; other blocks being on does not count', () => {
  assert.equal(embedStatusFrom([]), 'off');
  assert.equal(embedStatusFrom(null), 'off');
  assert.equal(embedStatusFrom([{ handle: 'x', type: 'ui_extension', activations: [{ target: 'admin.product-details.block.render' }] }]), 'off');
  assert.equal(embedStatusFrom([{ handle: 'cart-drawer', type: 'theme_app_extension', activations: [{ handle: 'Fbt', status: 'active' }] }]), 'off');
});
