// Run with: node --import ./tests/packs/register.mjs --test tests/price-display/price-display.test.mjs
// app/services/price-display.server.js against a fake Admin API: the store-wide
// "Hide decimals in prices" is an app-data metafield (brix.display) that the
// theme extension reads as app.metafields.brix.display.
import test from 'node:test';
import assert from 'node:assert/strict';

const { getPriceDisplay, savePriceDisplay } = await import('../../app/services/price-display.server.js');

function fakeAdmin({ stored = null, reject = false, broken = false } = {}) {
  const calls = [];
  return {
    calls,
    async graphql(query, opts = {}) {
      if (broken) throw new Error('network down');
      const op = /(query|mutation)\s+(\w+)/.exec(query)[2];
      calls.push({ op, variables: opts.variables });
      let data;
      if (op === 'BrixPriceDisplay') data = { currentAppInstallation: { metafield: stored ? { jsonValue: stored } : null } };
      else if (op === 'BrixInstallationId') data = { currentAppInstallation: { id: 'gid://shopify/AppInstallation/7' } };
      else if (op === 'BrixPriceDisplaySave') data = { metafieldsSet: { metafields: reject ? [] : [{ id: 'm1' }], userErrors: reject ? [{ field: ['value'], message: 'Nope', code: 'INVALID' }] : [] } };
      else throw new Error(`unhandled ${op}`);
      return new Response(JSON.stringify({ data }));
    },
  };
}

test('read: off when never set, on when saved, off when Shopify fails', async () => {
  assert.deepEqual(await getPriceDisplay(fakeAdmin()), { wholePrices: false });
  assert.deepEqual(await getPriceDisplay(fakeAdmin({ stored: { wholePrices: true } })), { wholePrices: true });
  assert.deepEqual(await getPriceDisplay(fakeAdmin({ stored: { wholePrices: 'yes' } })), { wholePrices: false }, 'only a real true counts');
  assert.deepEqual(await getPriceDisplay(fakeAdmin({ broken: true })), { wholePrices: false });
});

test('save: an app-data metafield brix.display on the app installation', async () => {
  const admin = fakeAdmin();
  assert.deepEqual(await savePriceDisplay(admin, { wholePrices: true }), { wholePrices: true });
  const mf = admin.calls.find((c) => c.op === 'BrixPriceDisplaySave').variables.metafields[0];
  assert.equal(mf.ownerId, 'gid://shopify/AppInstallation/7');
  assert.equal(mf.namespace, 'brix');
  assert.equal(mf.key, 'display');
  assert.equal(mf.type, 'json');
  assert.deepEqual(JSON.parse(mf.value), { wholePrices: true });
  await assert.rejects(savePriceDisplay(fakeAdmin({ reject: true }), { wholePrices: true }), /Nope/);
});
