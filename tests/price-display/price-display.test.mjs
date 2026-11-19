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
  assert.deepEqual(await getPriceDisplay(fakeAdmin()), { wholePrices: false, font: '' });
  assert.deepEqual(await getPriceDisplay(fakeAdmin({ stored: { wholePrices: true } })), { wholePrices: true, font: '' });
  assert.deepEqual(await getPriceDisplay(fakeAdmin({ stored: { wholePrices: 'yes' } })), { wholePrices: false, font: '' }, 'only a real true counts');
  assert.deepEqual(await getPriceDisplay(fakeAdmin({ broken: true })), { wholePrices: false, font: '' });
});

test('save: an app-data metafield brix.display on the app installation', async () => {
  const admin = fakeAdmin();
  assert.deepEqual(await savePriceDisplay(admin, { wholePrices: true }), { wholePrices: true, font: '' });
  const mf = admin.calls.find((c) => c.op === 'BrixPriceDisplaySave').variables.metafields[0];
  assert.equal(mf.ownerId, 'gid://shopify/AppInstallation/7');
  assert.equal(mf.namespace, 'brix');
  assert.equal(mf.key, 'display');
  assert.equal(mf.type, 'json');
  assert.deepEqual(JSON.parse(mf.value), { wholePrices: true, font: '', fontQuery: '', fontStack: '' });
  await assert.rejects(savePriceDisplay(fakeAdmin({ reject: true }), { wholePrices: true }), /Nope/);
});

const saved = (admin) => JSON.parse(admin.calls.find((c) => c.op === 'BrixPriceDisplaySave').variables.metafields[0].value);

test('font: theme font by default; a listed font is saved with its Google query and CSS stack', async () => {
  assert.deepEqual(await getPriceDisplay(fakeAdmin({ stored: { wholePrices: false, font: 'Poppins' } })), { wholePrices: false, font: 'Poppins' });
  assert.equal((await getPriceDisplay(fakeAdmin({ stored: { font: 'Comic Sans' } }))).font, '', 'not on the list = theme font');
  const admin = fakeAdmin();
  assert.deepEqual(await savePriceDisplay(admin, { font: 'open sans' }), { wholePrices: false, font: 'Open Sans' });
  assert.deepEqual(saved(admin), {
    wholePrices: false, font: 'Open Sans', fontQuery: 'Open+Sans:wght@400;500;600;700',
    fontStack: `'Open Sans', system-ui, -apple-system, "Segoe UI", sans-serif`,
  });
  const serif = fakeAdmin();
  await savePriceDisplay(serif, { font: 'Merriweather' });
  assert.deepEqual(saved(serif), { wholePrices: false, font: 'Merriweather', fontQuery: 'Merriweather:wght@400;700', fontStack: `'Merriweather', Georgia, serif` });
  const bad = fakeAdmin();
  await savePriceDisplay(bad, { font: "x';}</style><script>" });
  assert.deepEqual(saved(bad), { wholePrices: false, font: '', fontQuery: '', fontStack: '' }, 'anything else = theme font, nothing printed');
});

test('each save keeps the other setting; an unreadable setting refuses the save', async () => {
  const a = fakeAdmin({ stored: { wholePrices: true, font: 'Inter' } });
  assert.deepEqual(await savePriceDisplay(a, { font: 'Lato' }), { wholePrices: true, font: 'Lato' });
  assert.equal(saved(a).wholePrices, true);
  const b = fakeAdmin({ stored: { wholePrices: false, font: 'Inter' } });
  assert.deepEqual(await savePriceDisplay(b, { wholePrices: true }), { wholePrices: true, font: 'Inter' });
  assert.equal(saved(b).fontQuery, 'Inter:wght@400;500;600;700');
  const c = fakeAdmin({ stored: { wholePrices: true, font: 'Inter' } });
  assert.deepEqual(await savePriceDisplay(c, { font: '' }), { wholePrices: true, font: '' }, 'back to the theme font');
  await assert.rejects(savePriceDisplay(fakeAdmin({ broken: true }), { font: 'Inter' }), /network down/);
});
