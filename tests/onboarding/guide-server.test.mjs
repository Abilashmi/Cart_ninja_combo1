// Run with: node --import ./tests/packs/register.mjs --test tests/onboarding
// Guided setup on the server: the saved progress (app-data metafield, fake
// Admin API) and each feature's configured / active, read from fake sources.
// No database or Shopify store is touched.
import test from 'node:test';
import assert from 'node:assert/strict';

const { getGuideState, saveGuidePatch } = await import('../../app/services/guide-state.server.js');
const { loadGuideStatus, isModuleConfigured } = await import('../../app/services/guide-status.server.js');
const { completeModulePatch } = await import('../../app/utils/guide.shared.js');

const SHOP = 'demo.myshopify.com';
const NOW = new Date('2026-11-24T10:00:00Z');

// A fake Admin API: one app installation holding the brix.onboarding metafield.
function fakeAdmin({ value = null, failRead = false, userErrors = [] } = {}) {
  const calls = [];
  const store = { value };
  const admin = {
    calls, store,
    async graphql(query, opts) {
      calls.push({ query, variables: opts?.variables });
      if (/BrixGuideState/.test(query)) {
        if (failRead) return { json: async () => ({ errors: [{ message: 'Throttled' }] }) };
        return { json: async () => ({ data: { currentAppInstallation: { id: 'gid://shopify/AppInstallation/1', metafield: store.value ? { jsonValue: store.value } : null } } }) };
      }
      if (/BrixGuideSave/.test(query)) {
        const mf = opts.variables.metafields[0];
        if (!userErrors.length) store.value = JSON.parse(mf.value);
        return { json: async () => ({ data: { metafieldsSet: { metafields: [{ id: 'gid://shopify/Metafield/9' }], userErrors } } }) };
      }
      throw new Error(`unexpected query ${query.slice(0, 60)}`);
    },
  };
  return admin;
}

test('a store that never answered has no saved state', async () => {
  assert.equal(await getGuideState(fakeAdmin()), null);
  assert.equal(await getGuideState(fakeAdmin({ failRead: true })), null, 'unreadable = none, never throws');
});

test('answers are saved on the app installation, cleaned, and merged', async () => {
  const admin = fakeAdmin();
  const first = await saveGuidePatch(admin, { status: 'active', payment: 'postpaid', modules: ['cart', 'cod', 'zzz'], current: { module: 'cod', step: 0 } }, { now: NOW });
  assert.deepEqual(first.modules, ['cod', 'cart']);
  const write = admin.calls.find((c) => /BrixGuideSave/.test(c.query)).variables.metafields[0];
  assert.equal(write.ownerId, 'gid://shopify/AppInstallation/1');
  assert.equal(write.namespace, 'brix');
  assert.equal(write.key, 'onboarding');
  assert.equal(write.type, 'json');
  const second = await saveGuidePatch(admin, { current: { module: 'cod', step: 2 }, progress: { cod: { step: 2, done: ['turn-on', 'position'] } } }, { now: NOW });
  assert.equal(second.payment, 'postpaid', 'earlier answers kept');
  assert.deepEqual(second.progress.cod.done, ['turn-on', 'position']);
  assert.deepEqual((await getGuideState(admin)).current, { module: 'cod', step: 2 });
});

test('the browser cannot mark a feature set up; the server check can', async () => {
  const admin = fakeAdmin({ value: { status: 'active', payment: 'both', modules: ['cod', 'fbt'], current: { module: 'cod', step: 4 } } });
  const cheat = await saveGuidePatch(admin, { progress: { cod: { tour: 'completed' } } }, { now: NOW });
  assert.equal(cheat.progress.cod.tour, 'in_progress');
  const real = await saveGuidePatch(admin, (current) => completeModulePatch(current, 'cod', NOW), { trusted: true, now: NOW });
  assert.equal(real.progress.cod.tour, 'completed');
  assert.deepEqual(real.current, { module: 'fbt', step: 0 });
});

test('a save that cannot read first, or that Shopify refuses, throws', async () => {
  await assert.rejects(saveGuidePatch(fakeAdmin({ failRead: true }), { status: 'dismissed' }), /GraphQL/);
  const refused = fakeAdmin({ userErrors: [{ message: 'Value is too big' }] });
  await assert.rejects(saveGuidePatch(refused, { status: 'dismissed' }), /too big/);
  assert.equal(refused.store.value, null, 'nothing stored');
});

// Fake sources for the configured / active reads.
function sources(o = {}) {
  return {
    cartRecord: async () => (o.cart === undefined ? null : o.cart),
    codState: async () => o.cod || { saved: false, settings: { enabled: false, surfaces: {} } },
    allPacks: async () => o.packs || [],
    activePacks: async () => (o.packs || []).filter((p) => p.status === 'active'),
    discounts: async () => o.discounts || { any: false, live: false },
    conversations: async () => o.conversations || 0,
    query: async (sql) => {
      if (sql.includes('fbt_widget_settings') && sql.includes('mode')) return o.fbtRow || null;
      if (sql.includes('fbt_widget_settings')) return o.fbtRow ? { is_enabled: o.fbtRow.is_enabled ?? 0 } : null;
      if (sql.includes('fbt_rules')) return { n: o.fbtRules || 0 };
      if (sql.includes('COUNT(*) AS n FROM combo_templates WHERE shop_domain = ? AND is_active')) return { n: o.activeCombos || 0 };
      if (sql.includes('combo_templates')) return { n: o.combos || 0 };
      if (sql.includes('coupon_slider_widget')) return o.couponWidget || null;
      if (sql.includes('coupon_slider_settings')) return o.couponSettings || null;
      throw new Error(`unexpected query ${sql}`);
    },
  };
}

test('a brand-new store: nothing configured, not "existing"', async () => {
  const status = await loadGuideStatus(SHOP, { sources: sources() });
  assert.equal(status.existing, false);
  for (const [id, s] of Object.entries(status.modules)) assert.equal(s.configured, false, id);
  assert.equal(status.modules.cart.active, true, 'no drawer record = the Cart Editor default (on), as on Home');
  assert.equal(status.modules.brix_ai.active, null, 'BRIX AI has no on/off');
});

test('configured and active come from each feature\'s own settings', async () => {
  const status = await loadGuideStatus(SHOP, {
    sources: sources({
      cart: { cartStatus: 0 },
      cod: { saved: true, settings: { enabled: true, surfaces: { drawer: true } } },
      packs: [{ id: 1, status: 'draft' }],
      fbtRow: { mode: 'manual', is_enabled: 1 }, fbtRules: 2,
      combos: 1, activeCombos: 0,
      couponWidget: { selectedTemplateCoupon: '["gid://shopify/DiscountCodeNode/1"]' },
      couponSettings: { is_enabled: 0 },
      discounts: { any: true, live: false },
      conversations: 3,
    }),
  });
  assert.equal(status.existing, true);
  assert.deepEqual(status.modules, {
    cod: { configured: true, active: true },
    cart: { configured: true, active: false },
    fbt: { configured: true, active: true },
    combo: { configured: true, active: false },
    packs: { configured: true, active: false },
    coupon: { configured: true, active: false },
    discounts: { configured: true, active: false },
    brix_ai: { configured: true, active: null },
  });
});

test('FBT needs AI mode or a rule; the Coupon Banner needs a coupon picked', async () => {
  assert.equal(await isModuleConfigured(SHOP, 'fbt', { sources: sources({ fbtRow: { mode: 'manual' }, fbtRules: 0 }) }), false);
  assert.equal(await isModuleConfigured(SHOP, 'fbt', { sources: sources({ fbtRow: { mode: 'ai' } }) }), true);
  assert.equal(await isModuleConfigured(SHOP, 'coupon', { sources: sources({ couponWidget: { selectedTemplateCoupon: '[]' } }) }), false);
  assert.equal(await isModuleConfigured(SHOP, 'coupon', { sources: sources({ couponWidget: { selectedTemplateCoupon: 'gid://shopify/DiscountCodeNode/5' } }) }), true);
  assert.equal(await isModuleConfigured(SHOP, 'nope', { sources: sources() }), null);
});

test('a source that fails is unknown (null), never an error', async () => {
  const broken = { ...sources(), query: async () => { throw new Error('db down'); }, discounts: async () => { throw new Error('shopify down'); } };
  const status = await loadGuideStatus(SHOP, { sources: broken });
  assert.equal(status.modules.fbt.configured, null);
  assert.equal(status.modules.discounts.configured, null);
  assert.equal(await isModuleConfigured(SHOP, 'combo', { sources: broken }), null);
});

test('stores not using the guide only get the cheap reads', async () => {
  let extra = 0;
  const counting = { ...sources({ cart: { cartStatus: 1 } }), allPacks: async () => { extra++; return []; }, discounts: async () => { extra++; return null; }, conversations: async () => { extra++; return 0; } };
  const status = await loadGuideStatus(SHOP, { full: false, sources: counting });
  assert.equal(status.modules, null);
  assert.equal(status.existing, true, 'a saved drawer = an existing store');
  assert.equal(extra, 0);
  assert.deepEqual(Object.keys(status.moduleStatus), ['cart', 'combo', 'cod', 'packs', 'fbt', 'coupon']);
});
