// Run with: node --import ./tests/packs/register.mjs --test tests/combo-weight
// attachVariantStock (combo-stock.server.js): stock limits from a fake Admin API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachVariantStock } from '../../app/services/combo-stock.server.js';

const V = (n) => `gid://shopify/ProductVariant/${n}`;
const json = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const page = () => ({ c: [{ id: 'p1', variants: [{ id: V(1) }, { id: V(2) }, { id: V(3) }, { id: V(4) }] }] });

test('only tracked, stop-at-zero variants get a number; the rest stay unlimited', async () => {
  const data = page();
  const admin = { graphql: async () => json({ data: { nodes: [
    { id: V(1), inventoryQuantity: 3, inventoryPolicy: 'DENY', inventoryItem: { tracked: true } },
    { id: V(2), inventoryQuantity: -2, inventoryPolicy: 'DENY', inventoryItem: { tracked: true } },
    { id: V(3), inventoryQuantity: 0, inventoryPolicy: 'CONTINUE', inventoryItem: { tracked: true } },
    { id: V(4), inventoryQuantity: 0, inventoryPolicy: 'DENY', inventoryItem: { tracked: false } },
  ] } }) };
  await attachVariantStock(admin, data);
  assert.deepEqual(data.c[0].variants.map((v) => v.stock), [3, 0, null, null]);
});

test('Shopify refusing the query (e.g. scope) leaves the page as before: no limits, no error', async () => {
  const data = page();
  const admin = { graphql: async () => json({ errors: [{ message: 'Access denied for inventoryQuantity field.' }] }) };
  await attachVariantStock(admin, data);
  assert.ok(data.c[0].variants.every((v) => v.stock === undefined));
  const thrower = { graphql: async () => { throw new Error('network'); } };
  await attachVariantStock(thrower, page());
});
