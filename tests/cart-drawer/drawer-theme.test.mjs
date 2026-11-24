import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { THEME_PRESETS, sanitizeDrawerTheme, drawerThemeCss } from '../../app/utils/drawer-theme.shared.js';

// The storefront's ES5 copy (cart_drawer_inline.js), pulled out and run on its own.
const inline = fs.readFileSync(new URL('../../extensions/cart-drawer/assets/cart_drawer_inline.js', import.meta.url), 'utf8');
const start = inline.indexOf('var CC_THEME_PRESETS');
const end = inline.indexOf('  // Paints the drawer with the theme');
const ctx = {};
vm.runInNewContext(inline.slice(start, end) + '\nthis.t = ccDrawerTheme; this.css = ccDrawerThemeCss; this.presets = CC_THEME_PRESETS;', ctx);
const j = (v) => JSON.parse(JSON.stringify(v));

test('storefront presets match the shared ones', () => {
  const shared = Object.fromEntries(THEME_PRESETS.map((p) => [p.id, [p.c1, p.c2]]));
  assert.deepEqual(j(ctx.presets), shared);
});

test('nothing saved or no usable colour = no theme, on both sides', () => {
  for (const raw of [undefined, null, '', 5, {}, { preset: 'custom' }, { color1: 'red' }, { color1: '#12' }]) {
    assert.equal(sanitizeDrawerTheme(raw), null);
    assert.equal(ctx.t(raw), null);
  }
});

test('shared and storefront agree on presets, custom colours, angle and text colour', () => {
  const cases = [
    { preset: 'sunset' },
    { preset: 'night', angle: 45, textColor: '#FFF' },
    { preset: 'custom', color1: '#ABC', color2: '#112233', angle: 999 },
    { preset: 'custom', color1: '#abcdef', color2: 'nope', angle: -4, textColor: 'bad' },
    { color1: '#ffffff' },
  ];
  for (const raw of cases) {
    const a = sanitizeDrawerTheme(raw);
    assert.deepEqual(a, j(ctx.t(raw)), JSON.stringify(raw));
    assert.deepEqual(drawerThemeCss(a), j(ctx.css(a)));
  }
  assert.equal(sanitizeDrawerTheme({ preset: 'custom', color1: '#ABC', color2: '#112233', angle: 999 }).angle, 360);
  assert.equal(sanitizeDrawerTheme({ preset: 'custom', color1: '#ABC' }).color1, '#aabbcc');
});

test('css: a mix is a gradient, one colour is plain; text goes dark or light on its own', () => {
  const light = drawerThemeCss(sanitizeDrawerTheme({ preset: 'peach' }));
  assert.match(light.background, /^linear-gradient\(160deg, #ffe3d8, #ffd1e3\)$/);
  assert.equal(light.color, '#111827');
  assert.equal(light.dark, false);
  const dark = drawerThemeCss(sanitizeDrawerTheme({ preset: 'night' }));
  assert.equal(dark.color, '#ffffff');
  assert.equal(dark.dark, true);
  const solid = drawerThemeCss(sanitizeDrawerTheme({ color1: '#222222' }));
  assert.equal(solid.background, '#222222');
  assert.equal(drawerThemeCss(sanitizeDrawerTheme({ color1: '#222222', textColor: '#ff0000' })).color, '#ff0000');
  assert.equal(drawerThemeCss(null), null);
});
