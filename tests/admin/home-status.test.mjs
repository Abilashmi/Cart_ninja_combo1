// Run with: node --import ./tests/packs/register.mjs --test tests/admin/home-status.test.mjs
// The Home page card switches: each feature's on/off, read from where it keeps it.
import test from 'node:test';
import assert from 'node:assert/strict';

const { loadModuleStatus } = await import('../../app/services/home-status.server.js');

const fakeQuery = (rows) => async (sql) => {
  if (sql.includes('combo_templates')) return { n: rows.combos ?? 0 };
  if (sql.includes('fbt_widget_settings')) return rows.fbt === undefined ? null : { is_enabled: rows.fbt };
  if (sql.includes('coupon_slider_settings')) return rows.coupon === undefined ? null : { is_enabled: rows.coupon };
  throw new Error(`unexpected query ${sql}`);
};

test('each switch follows its feature', async () => {
  const status = await loadModuleStatus('demo.myshopify.com', {
    cartRecord: async () => ({ cartStatus: 1 }),
    codSettings: async () => ({ enabled: true, surfaces: { drawer: false, product: true, combo: false } }),
    activePacks: async () => [{ id: 1 }],
    query: fakeQuery({ combos: 2, fbt: 1, coupon: '0' }),
  });
  assert.deepEqual(status, { cart: true, combo: true, cod: true, packs: true, fbt: true, coupon: false });
});

test('off when switched off, nothing saved, or COD on nowhere', async () => {
  const status = await loadModuleStatus('demo.myshopify.com', {
    cartRecord: async () => ({ cart_status: '0' }),
    codSettings: async () => ({ enabled: true, surfaces: { drawer: false, product: false, combo: false } }),
    activePacks: async () => [],
    query: fakeQuery({ combos: 0 }),
  });
  assert.deepEqual(status, { cart: false, combo: false, cod: false, packs: false, fbt: false, coupon: false });
});

test('no drawer record = the Cart Editor default (on); a failing source = null, never throws', async () => {
  const status = await loadModuleStatus('demo.myshopify.com', {
    cartRecord: async () => null,
    codSettings: async () => { throw new Error('PHP down'); },
    activePacks: async () => { throw new Error('db down'); },
    query: async () => { throw new Error('db down'); },
  });
  assert.deepEqual(status, { cart: true, combo: null, cod: null, packs: null, fbt: null, coupon: null });
});
