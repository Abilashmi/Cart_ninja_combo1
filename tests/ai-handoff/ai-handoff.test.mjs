// Run with: node --import ./tests/packs/register.mjs --test tests/ai-handoff
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAiModule, resolveHandoffTarget, getModuleForPath, AI_MODULE_ROUTES } from '../../app/config/ai-module-routes.js';
import { createHandoff, consumeHandoff } from '../../app/utils/ai-handoff.js';

const fakeStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _m: m,
  };
};

test('module routes point at real route files', async () => {
  const { existsSync } = await import('node:fs');
  assert.ok(existsSync('app/routes/app.cartdrawer.jsx'));
  assert.ok(existsSync('app/routes/app.fbt.jsx'));
  assert.ok(existsSync('app/routes/app.bundles._index.jsx'));
  assert.ok(existsSync('app/routes/app.productwidget.jsx'));
  assert.deepEqual(Object.keys(AI_MODULE_ROUTES), ['cart_editor', 'fbt', 'build_combo', 'coupon_banner']);
});

test('detects the spec examples', () => {
  assert.deepEqual(detectAiModule('Change my progress bar goal to ₹2000'), { module: 'cart_editor', features: ['progress_bar'] });
  assert.deepEqual(detectAiModule('turn on announcement'), { module: 'cart_editor', features: ['announcement'] });
  assert.deepEqual(detectAiModule('change coupon slider'), { module: 'cart_editor', features: ['coupon_slider'] });
  assert.deepEqual(detectAiModule('Change my FBT template to Modern Cards'), { module: 'fbt', features: [] });
  assert.deepEqual(detectAiModule('change my FBT template and add another product'), { module: 'fbt', features: [] });
  assert.deepEqual(detectAiModule('Create a combo with these products'), { module: 'build_combo', features: [] });
});

test('multiple Cart Editor features stay one module, ordered as written', () => {
  const r = detectAiModule('Turn on the announcement and change my progress bar goal to ₹2000');
  assert.deepEqual(r, { module: 'cart_editor', features: ['announcement', 'progress_bar'] });
  assert.deepEqual(detectAiModule('set the progress bar goal then enable the announcement').features, ['progress_bar', 'announcement']);
});

test('announcement wording variants and typos', () => {
  for (const m of ['Make my announcment red', 'announce our summer sale in the cart', 'edit the top bar message', 'Change the announcement text']) {
    assert.equal(detectAiModule(m).features[0], 'announcement', m);
  }
});

test('the other Cart Editor features map', () => {
  assert.equal(detectAiModule('add an upsell for the mug').features[0], 'upsell');
  assert.equal(detectAiModule('start a countdown timer').features[0], 'countdown_timer');
  assert.equal(detectAiModule('edit my empty cart message').features[0], 'empty_cart');
  assert.equal(detectAiModule('make the checkout button green').features[0], 'checkout_button');
  assert.equal(detectAiModule('add custom CSS').features[0], 'custom_css');
  assert.deepEqual(detectAiModule('turn on my cart drawer'), { module: 'cart_editor', features: [] });
});

test('never guesses: no module or several modules -> null', () => {
  assert.equal(detectAiModule('how can I increase my AOV?'), null);
  assert.equal(detectAiModule('create a discount code for 10% off'), null);
  assert.equal(detectAiModule('hello'), null);
  assert.equal(detectAiModule(''), null);
  assert.equal(detectAiModule('change my FBT template and my progress bar goal'), null);
  assert.equal(detectAiModule('create a combo and add an upsell'), null);
});

test('already on the module -> no navigation', () => {
  assert.equal(resolveHandoffTarget('Change the template to Modern Cards FBT', '/app/fbt'), null);
  assert.equal(resolveHandoffTarget('change the progress bar goal', '/app/cartdrawer'), null);
  assert.equal(resolveHandoffTarget('create a combo', '/app/bundles/customize'), null);
});

test('from the global page -> navigates to the real module route', () => {
  const t = resolveHandoffTarget('Change my progress bar goal to ₹2000', '/app/brix-ai');
  assert.equal(t.module, 'cart_editor');
  assert.equal(t.route, '/app/cartdrawer');
  assert.equal(t.feature, 'progress_bar');
  assert.equal(resolveHandoffTarget('Change my FBT template to Modern Cards', '/app/brix-ai').route, '/app/fbt');
  assert.equal(resolveHandoffTarget('Create a combo with these products', '/app/brix-ai').route, '/app/bundles');
  assert.equal(resolveHandoffTarget('what is my AOV', '/app/brix-ai'), null);
  // being on a *different* module page still navigates
  assert.equal(resolveHandoffTarget('change my FBT template', '/app/cartdrawer').module, 'fbt');
});

test('getModuleForPath is segment-aware', () => {
  assert.equal(getModuleForPath('/app/fbt'), 'fbt');
  assert.equal(getModuleForPath('/app/bundles/customize'), 'build_combo');
  assert.equal(getModuleForPath('/app/cartdrawer/'), 'cart_editor');
  assert.equal(getModuleForPath('/app/fbtx'), null);
  assert.equal(getModuleForPath('/app/brix-ai'), null);
});

test('handoff carries the exact original message and required fields', () => {
  const s = fakeStorage();
  const msg = 'Turn on the announcement and change my progress bar goal to ₹2000';
  const rec = createHandoff({ message: `  ${msg} `, targetModule: 'cart_editor', targetFeatures: ['announcement', 'progress_bar'] }, s);
  assert.equal(rec.message, msg);
  assert.equal(rec.source, 'global-ai');
  assert.equal(rec.targetModule, 'cart_editor');
  assert.equal(rec.targetFeature, 'announcement');
  assert.deepEqual(rec.targetFeatures, ['announcement', 'progress_bar']);
  assert.ok(rec.handoffId);
  assert.equal(createHandoff({ message: 'x', targetModule: 'nope' }, s), null);
  assert.equal(createHandoff({ message: '  ', targetModule: 'fbt' }, s), null);
});

test('a handoff is consumed exactly once (refresh / back-forward / double effect)', () => {
  const s = fakeStorage();
  const rec = createHandoff({ message: 'change my FBT template', targetModule: 'fbt' }, s);
  const first = consumeHandoff('fbt', s);
  assert.equal(first.handoff.message, 'change my FBT template');
  assert.equal(first.handoff.handoffId, rec.handoffId);
  assert.deepEqual(consumeHandoff('fbt', s), {});
  assert.deepEqual(consumeHandoff('fbt', s), {});
  // even if the record is written back with the same id, it is refused
  s.setItem('brix-ai-handoff', JSON.stringify(rec));
  assert.deepEqual(consumeHandoff('fbt', s), {});
});

test('a handoff still runs only once if storage removal fails', () => {
  const s = fakeStorage();
  s.removeItem = () => { throw new Error('blocked'); };
  createHandoff({ message: 'change my FBT template', targetModule: 'fbt' }, s);
  assert.ok(consumeHandoff('fbt', s).handoff);
  assert.deepEqual(consumeHandoff('fbt', s), {});
});

test('wrong module leaves the handoff for its own module', () => {
  const s = fakeStorage();
  createHandoff({ message: 'change my FBT template', targetModule: 'fbt' }, s);
  assert.deepEqual(consumeHandoff('cart_editor', s), {});
  assert.ok(consumeHandoff('fbt', s).handoff);
});

test('expired handoffs are dropped, not run', () => {
  const s = fakeStorage();
  const rec = createHandoff({ message: 'change my FBT template', targetModule: 'fbt' }, s);
  assert.deepEqual(consumeHandoff('fbt', s, rec.createdAt + 3 * 60 * 1000), {});
  assert.equal(s.getItem('brix-ai-handoff'), null);
});

test('corrupt or forged records are discarded with an error', () => {
  const s = fakeStorage();
  s.setItem('brix-ai-handoff', '{not json');
  assert.deepEqual(consumeHandoff('fbt', s), { error: 'invalid' });
  assert.equal(s.getItem('brix-ai-handoff'), null);
  s.setItem('brix-ai-handoff', JSON.stringify({ handoffId: 'x', message: 'hi', source: 'somewhere', targetModule: 'fbt', targetFeatures: [], createdAt: Date.now() }));
  assert.deepEqual(consumeHandoff('fbt', s), { error: 'invalid' });
  assert.deepEqual(consumeHandoff('fbt', fakeStorage()), {});
  assert.deepEqual(consumeHandoff('fbt', null), {});
});

test('storage blocked entirely: handoff still works via the in-memory fallback, once', () => {
  const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() { throw new Error('SecurityError'); } };
  const rec = createHandoff({ message: 'change my announcement', targetModule: 'cart_editor', targetFeatures: ['announcement'] }, blocked);
  assert.ok(rec);
  assert.deepEqual(consumeHandoff('fbt', blocked), {}, 'wrong module leaves it');
  assert.equal(consumeHandoff('cart_editor', blocked).handoff.message, 'change my announcement');
  assert.deepEqual(consumeHandoff('cart_editor', blocked), {});
  // and with no storage object at all
  createHandoff({ message: 'change my FBT template', targetModule: 'fbt' }, null);
  assert.ok(consumeHandoff('fbt', null).handoff);
  assert.deepEqual(consumeHandoff('fbt', null), {});
});

test('Coupon Banner is its own module, distinct from the cart drawer Coupon Slider', () => {
  assert.deepEqual(detectAiModule('create a coupon banner latest one coupon'), { module: 'coupon_banner', features: [] });
  assert.equal(resolveHandoffTarget('create a coupon banner latest one coupon', '/app/brix-ai').route, '/app/productwidget');
  assert.equal(detectAiModule('change the coupon slider colors').module, 'cart_editor');
  assert.equal(detectAiModule('add a coupon banner to my cart drawer'), null, 'two modules named -> stay put');
  assert.equal(resolveHandoffTarget('make the coupon banner blue', '/app/productwidget'), null);
  assert.equal(getModuleForPath('/app/productwidget'), 'coupon_banner');
});

test('only change requests redirect; questions and analytics stay in the current chat', async () => {
  const { isChangeRequest } = await import('../../app/config/ai-module-routes.js');
  const stay = [
    "what's my progress bar setup?", 'how are my upsells doing?', 'how do I add an upsell?', 'how much revenue did my upsells make',
    'show my progress bar revenue', 'is my announcement enabled?', 'my upsell revenue this month', 'which FBT template am I using?',
  ];
  for (const m of stay) {
    assert.equal(isChangeRequest(m), false, m);
    assert.equal(resolveHandoffTarget(m, '/app/brix-ai'), null, m);
  }
  const go = ['Change my progress bar goal to ₹2000', 'turn on announcement', 'Add an upsell for the mug', 'can you change my FBT template?', 'please make the checkout button green'];
  for (const m of go) {
    assert.equal(isChangeRequest(m), true, m);
    assert.ok(resolveHandoffTarget(m, '/app/brix-ai'), m);
  }
});

test('milestone / threshold / free-gift wording routes to the Cart Editor progress bar', () => {
  for (const m of ['create a milestone for above 2000 will get free shipping', 'add a free gift at 3000', 'set a free shipping threshold of 1500', 'add a reward tier at 5000']) {
    const t = resolveHandoffTarget(m, '/app/brix-ai');
    assert.equal(t?.module, 'cart_editor', m);
    assert.equal(t?.feature, 'progress_bar', m);
  }
  // a discount is not a module page
  assert.equal(resolveHandoffTarget('create a free shipping discount code', '/app/brix-ai'), null);
  // tip-card clicks ("Set up <title> for my store") route by their title
  assert.equal(resolveHandoffTarget('Set up Upselling and Cross-selling for my store', '/app/brix-ai').feature, 'upsell');
  assert.equal(resolveHandoffTarget('Set up Bundling Products for my store', '/app/brix-ai').module, 'build_combo');
  assert.equal(resolveHandoffTarget('Set up Free Shipping Threshold for my store', '/app/brix-ai').feature, 'progress_bar');
  assert.equal(resolveHandoffTarget('Set up Urgency with a Countdown Timer for my store', '/app/brix-ai').feature, 'countdown_timer');
});

test('a typo in the verb still redirects a change request, but read topics stay', () => {
  const t = resolveHandoffTarget('ceate milestone above 3000 free shipping', '/app/brix-ai');
  assert.equal(t?.feature, 'progress_bar');
  assert.equal(resolveHandoffTarget('announcement red', '/app/brix-ai')?.feature, 'announcement');
  assert.equal(resolveHandoffTarget('upsell revenue last month', '/app/brix-ai'), null);
  assert.equal(resolveHandoffTarget('can you show my upsell revenue', '/app/brix-ai'), null);
  assert.equal(resolveHandoffTarget('progress bar status', '/app/brix-ai'), null);
});
