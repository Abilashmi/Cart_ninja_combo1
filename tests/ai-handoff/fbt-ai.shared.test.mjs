// Run with: node --import ./tests/packs/register.mjs --test tests/ai-handoff
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAiFbtRules, toFbtOfferShape } from '../../app/utils/fbt-ai.shared.js';

function product(id, title, productType, price) {
  return { gid: `gid://shopify/Product/${id}`, numericId: id, title, handle: title.toLowerCase(), productType, image: '', price };
}

test('real co-purchase history wins over the same-product-type fallback', () => {
  const wheelbarrow = product('1', 'Wheelbarrow', 'Garden', '100');
  const gloves = product('2', 'Garden Gloves', 'Garden', '10');
  const hose = product('3', 'Hose Connector', 'Garden', '5');
  const catalog = [wheelbarrow, gloves, hose];

  // Real order history: Wheelbarrow was actually bought with the Hose
  // Connector 5 times, never with the Gloves.
  const coPurchaseMap = new Map([['1', [{ id: '3', cnt: 5 }]]]);

  const { rules, covered } = buildAiFbtRules(catalog, coPurchaseMap, 1);
  assert.equal(covered, 3);
  const rule = rules.find((r) => r.trigger_products[0].id === wheelbarrow.gid);
  assert.equal(rule.fbt_products.length, 1);
  assert.equal(rule.fbt_products[0].id, hose.gid, 'co-purchase signal must be preferred over the type-match fallback');
});

test('falls back to same product type, ranked by price proximity, when there is no purchase history', () => {
  const mug = product('1', 'Coffee Mug', 'Kitchen', '15');
  const kettle = product('2', 'Kettle', 'Kitchen', '40');
  const plate = product('3', 'Dinner Plate', 'Kitchen', '18');
  const shirt = product('4', 'T-Shirt', 'Apparel', '20');
  const catalog = [mug, kettle, plate, shirt];

  const { rules } = buildAiFbtRules(catalog, new Map(), 1);
  const mugRule = rules.find((r) => r.trigger_products[0].id === mug.gid);
  // Plate ($18) is closer to the Mug's $15 than the Kettle ($40) is.
  assert.equal(mugRule.fbt_products[0].id, plate.gid);

  const shirtRule = rules.find((r) => r.trigger_products[0].id === shirt.gid);
  assert.equal(shirtRule, undefined, 'the only Apparel product has nothing to pair with and must be skipped, never given an unrelated Kitchen pairing');
});

test('a product with neither co-purchase data nor a same-type peer is skipped, never given an invented pairing', () => {
  const lonelyProduct = product('1', 'One of a Kind', 'Unique', '50');
  const other = product('2', 'Something Else', 'Different', '5');
  const catalog = [lonelyProduct, other];

  const { rules, covered } = buildAiFbtRules(catalog, new Map(), 3);
  assert.equal(covered, 0);
  assert.equal(rules.length, 0);
});

test('co-purchase offers are capped at countPerProduct even when more history exists', () => {
  const a = product('1', 'A', 'X', '10');
  const b = product('2', 'B', 'X', '10');
  const c = product('3', 'C', 'X', '10');
  const d = product('4', 'D', 'X', '10');
  const catalog = [a, b, c, d];
  const coPurchaseMap = new Map([['1', [{ id: '2', cnt: 9 }, { id: '3', cnt: 5 }, { id: '4', cnt: 1 }]]]);

  const { rules } = buildAiFbtRules(catalog, coPurchaseMap, 2);
  const ruleA = rules.find((r) => r.trigger_products[0].id === a.gid);
  assert.equal(ruleA.fbt_products.length, 2);
  assert.deepEqual(ruleA.fbt_products.map((p) => p.id), [b.gid, c.gid], 'must keep the two highest-count co-purchases, not just the first two seen');
});

test('a co-purchased id that no longer exists in the current catalog is silently dropped, not crashed on', () => {
  const a = product('1', 'A', 'X', '10');
  const catalog = [a];
  const coPurchaseMap = new Map([['1', [{ id: '999', cnt: 3 }]]]); // '999' was deleted/unpublished

  const { rules, covered } = buildAiFbtRules(catalog, coPurchaseMap, 3);
  assert.equal(covered, 0);
  assert.equal(rules.length, 0);
});

test('toFbtOfferShape only carries the fields the storefront widget actually reads', () => {
  const p = product('1', 'A', 'X', '10');
  assert.deepEqual(toFbtOfferShape(p), { id: p.gid, title: 'A', handle: 'a', image: '', price: '10' });
});
