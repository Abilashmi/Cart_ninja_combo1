// Run with: node --import ./tests/packs/register.mjs --test tests/pairing
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeOrderPairs, partnersOf, matchProducts, buildRulesFromPlan, parsePromptHeuristically,
  ruleKey, toFbtRule, toUpsellRule, fbtRuleKey, upsellRuleKey, mergeInstructionRules, instructionsHash,
} from '../../app/utils/pairing.shared.js';

const P = (id, title, extra = {}) => ({ id: `gid://shopify/Product/${id}`, title, handle: title.toLowerCase().replace(/\s+/g, '-'), image: '', price: '10.00', productType: '', tags: [], collectionIds: [], ...extra });

const CATALOG = [
  P(1, 'Boys Joggers', { productType: 'Bottoms', collectionIds: ['c-kids'] }),
  P(2, 'Girls Joggers', { productType: 'Bottoms', collectionIds: ['c-kids'] }),
  P(3, 'Ankle Socks', { productType: 'Socks', tags: ['accessory'] }),
  P(4, 'Crew Socks', { productType: 'Socks', tags: ['accessory'] }),
  P(5, 'Coffee Mug', { collectionIds: ['c-kitchen'] }),
  P(6, 'Coffee Beans', { collectionIds: ['c-kitchen'] }),
  P(7, 'Milk Frother', { collectionIds: ['c-kitchen'] }),
  P(8, 'Cap'),
];
const COLLECTIONS = [{ id: 'c-kids', title: 'Kids' }, { id: 'c-kitchen', title: 'Kitchen' }];

const order = (id, ...productIds) => ({ id, products: productIds.map((p) => ({ id: `gid://shopify/Product/${p}`, title: `P${p}` })) });

test('order pairs: counts orders together, shares and lift; one product per order counted once', () => {
  const orders = [
    order('o1', 1, 3), order('o2', 1, 3, 3), order('o3', 1, 4), order('o4', 1), order('o5', 5, 6),
  ];
  const { totalOrders, multiItemOrders, pairs } = computeOrderPairs(orders);
  assert.equal(totalOrders, 5);
  assert.equal(multiItemOrders, 4);
  const top = pairs[0];
  assert.deepEqual([top.a.id, top.b.id], ['1', '3']);
  assert.equal(top.together, 2, 'duplicate line of the same product is one order, not two');
  assert.equal(top.aToB, 50, 'joggers were in 4 orders, 2 of them had socks');
  assert.equal(top.bToA, 100);
  assert.ok(top.lift > 1);
});

test('order pairs: minTogether drops rare pairs; orders without products are ignored', () => {
  const { totalOrders, pairs } = computeOrderPairs([order('a', 1, 3), order('b', 1, 3), order('c', 5, 6), { id: 'd', products: [] }], { minTogether: 2 });
  assert.equal(totalOrders, 3);
  assert.equal(pairs.length, 1);
});

test('partnersOf ranks the products bought most with a product, either side of the pair', () => {
  const { pairs } = computeOrderPairs([order(1, 1, 3), order(2, 1, 3), order(3, 4, 1), order(4, 8, 3)]);
  assert.deepEqual(partnersOf(pairs, 'gid://shopify/Product/1', 5).map((x) => x.id), ['3', '4']);
  assert.deepEqual(partnersOf(pairs, '3', 5).map((x) => x.id), ['1', '8']);
});

test('matchProducts: exact title, every-word group, plural tolerant, and title-in-sentence', () => {
  assert.equal(matchProducts('coffee mug', CATALOG).products[0].title, 'Coffee Mug');
  const joggers = matchProducts('joggers', CATALOG);
  assert.equal(joggers.status, 'many');
  assert.equal(joggers.products.length, 2);
  assert.equal(matchProducts('sock', CATALOG).products.length, 2, '"sock" finds "Socks"');
  assert.equal(matchProducts('the milk frother please', CATALOG).products[0].title, 'Milk Frother');
  assert.equal(matchProducts('Snowboard', CATALOG).status, 'not_found');
});

test('plan → rules: a group trigger becomes one rule; offers capped and never include the trigger', () => {
  const plan = { rules: [{ trigger: { products: ['joggers'] }, offer: { products: ['socks', 'Boys Joggers', 'Cap'] } }] };
  const { rules, warnings } = buildRulesFromPlan(plan, { catalog: CATALOG, collections: COLLECTIONS, maxOffers: 2 });
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].triggerProducts.map((p) => p.title), ['Boys Joggers', 'Girls Joggers']);
  assert.equal(rules[0].offerProducts.length, 2);
  assert.ok(!rules[0].offerProducts.some((p) => p.title.includes('Joggers')), 'a trigger product is never recommended with itself');
  assert.ok(warnings.some((w) => w.includes('kept the top 2')));
});

test('plan → rules: when several offers match, the ones bought together most win', () => {
  const { pairs } = computeOrderPairs([order(1, 1, 4), order(2, 1, 4), order(3, 1, 3)]);
  const plan = { rules: [{ trigger: { products: ['Boys Joggers'] }, offer: { products: ['socks'], count: 1 } }] };
  const { rules } = buildRulesFromPlan(plan, { catalog: CATALOG, pairs });
  assert.deepEqual(rules[0].offerProducts.map((p) => p.title), ['Crew Socks']);
});

test('plan → rules: collections, product types and tags resolve to real products', () => {
  const plan = { rules: [
    { trigger: { collections: ['kitchen'] }, offer: { products: ['Cap'] } },
    { trigger: { productTypes: ['Bottoms'] }, offer: { tags: ['accessory'] } },
  ] };
  const { rules, warnings } = buildRulesFromPlan(plan, { catalog: CATALOG, collections: COLLECTIONS, maxOffers: 3 });
  assert.equal(rules.length, 2);
  assert.equal(rules[0].triggerProducts.length, 3);
  assert.deepEqual(rules[1].offerProducts.map((p) => p.title).sort(), ['Ankle Socks', 'Crew Socks']);
  assert.deepEqual(warnings, []);
});

test('plan → rules: unknown products are reported and never invented; empty offers drop the rule', () => {
  const plan = { rules: [
    { trigger: { products: ['Snowboard'] }, offer: { products: ['Cap'] } },
    { trigger: { products: ['Cap'] }, offer: { products: ['Unicorn Hat'] } },
  ] };
  const { rules, warnings } = buildRulesFromPlan(plan, { catalog: CATALOG, collections: COLLECTIONS });
  assert.equal(rules.length, 0);
  assert.ok(warnings.some((w) => w.includes('"Snowboard"')));
  assert.ok(warnings.some((w) => w.includes('"Unicorn Hat"')));
});

test('plan → rules: "what customers buy with it" makes one rule per trigger from past orders', () => {
  const { pairs } = computeOrderPairs([order(1, 5, 6), order(2, 5, 6), order(3, 5, 7), order(4, 6, 7)]);
  const plan = { rules: [{ trigger: { collections: ['Kitchen'] }, offer: { fromOrderHistory: true, count: 1 } }] };
  const { rules } = buildRulesFromPlan(plan, { catalog: CATALOG, collections: COLLECTIONS, pairs });
  const byTrigger = Object.fromEntries(rules.map((r) => [r.triggerProducts[0].title, r.offerProducts.map((p) => p.title)]));
  assert.deepEqual(byTrigger['Coffee Mug'], ['Coffee Beans']);
  assert.deepEqual(byTrigger['Coffee Beans'], ['Coffee Mug']);
  assert.equal(rules.every((r) => r.basis === 'orders'), true);
});

test('plan → rules: history with no orders for a product warns instead of guessing', () => {
  const plan = { rules: [{ trigger: { products: ['Cap'] }, offer: { fromOrderHistory: true } }] };
  const { rules, warnings } = buildRulesFromPlan(plan, { catalog: CATALOG, pairs: [] });
  assert.equal(rules.length, 0);
  assert.ok(warnings[0].includes('Cap'));
});

test('plan → rules: "all products" trigger and duplicate rules merged', () => {
  const plan = { rules: [
    { trigger: { allProducts: true }, offer: { products: ['Cap'] } },
    { trigger: { allProducts: true }, offer: { products: ['cap'] } },
  ] };
  const { rules } = buildRulesFromPlan(plan, { catalog: CATALOG });
  assert.equal(rules.length, 1);
  assert.equal(rules[0].allProducts, true);
  assert.deepEqual(rules[0].triggerProducts, []);
});

test('heuristic parser handles the common phrasings', () => {
  const { rules } = parsePromptHeuristically([
    'Pair Boys Joggers with Ankle Socks, Cap',
    'Coffee Mug -> Coffee Beans and Milk Frother',
    'all products: Cap',
    'Crew Socks with what customers usually buy',
    'hello there',
  ].join('\n'));
  assert.equal(rules.length, 4);
  assert.deepEqual(rules[0], { trigger: { products: ['Boys Joggers'] }, offer: { products: ['Ankle Socks', 'Cap'] } });
  assert.deepEqual(rules[1].offer.products, ['Coffee Beans', 'Milk Frother']);
  assert.equal(rules[2].trigger.allProducts, true);
  assert.equal(rules[3].offer.fromOrderHistory, true);
});

test('surface shapes: FBT and upsell rules, and their keys match the generic rule key', () => {
  const generic = { name: 'Boys Joggers', allProducts: false, triggerProducts: [{ id: 'gid://shopify/Product/1', title: 'Boys Joggers' }], offerProducts: [{ id: 'gid://shopify/Product/3', title: 'Ankle Socks' }] };
  const fbt = toFbtRule(generic, 'r1');
  assert.equal(fbt.displayScope, 'per_product');
  assert.deepEqual(fbt.fbtProducts, generic.offerProducts);
  const up = toUpsellRule(generic, 'r2');
  assert.equal(up.triggerType, 'specific');
  assert.deepEqual(up.upsellProductIds, ['gid://shopify/Product/3']);
  assert.deepEqual(up.upsellProductDetails, generic.offerProducts);
  const key = ruleKey(['1'], ['gid://shopify/Product/3']);
  assert.equal(fbtRuleKey(fbt), key);
  assert.equal(upsellRuleKey(up), key);

  const everywhere = toFbtRule({ ...generic, allProducts: true, triggerProducts: [] }, 'r3');
  assert.equal(everywhere.displayScope, 'all');
  assert.equal(toUpsellRule({ ...generic, allProducts: true, triggerProducts: [] }).triggerType, 'all');
});

// ── FBT AI-Powered mode: instructions first ──
const offer = (n, title) => ({ id: `gid://shopify/Product/${n}`, title, handle: '', image: '', price: '10.00' });
const autoRule = (t, ...offers) => ({ name: `AI: ${t.title}`, trigger_products: [t], fbt_products: offers });

test('instructions: named products get their offers first, AI fills up to the count; others untouched', () => {
  const J = offer(1, 'Boys Joggers'); const S = offer(3, 'Ankle Socks'); const C = offer(8, 'Cap'); const M = offer(5, 'Coffee Mug'); const B = offer(6, 'Coffee Beans');
  const auto = [autoRule(J, C, M), autoRule(M, B, J)];
  const pinned = [{ allProducts: false, triggerProducts: [J], offerProducts: [S] }];
  const { rules, pinnedProducts } = mergeInstructionRules(auto, pinned, 2);
  assert.equal(pinnedProducts, 1);
  const byTrigger = Object.fromEntries(rules.map((r) => [r.trigger_products[0].title, r.fbt_products.map((p) => p.title)]));
  assert.deepEqual(byTrigger['Boys Joggers'], ['Ankle Socks', 'Cap'], 'instruction offer first, then the best AI pick');
  assert.deepEqual(byTrigger['Coffee Mug'], ['Coffee Beans', 'Boys Joggers']);
  assert.equal(rules.find((r) => r.trigger_products[0].title === 'Boys Joggers').name, 'Your rule: Boys Joggers');
  assert.equal(rules.find((r) => r.trigger_products[0].title === 'Coffee Mug').name, 'AI: Coffee Mug');
});

test('instructions: more offers than the count are all kept; a product AI skipped still gets its rule', () => {
  const J = offer(1, 'Boys Joggers'); const S = offer(3, 'Ankle Socks'); const C = offer(8, 'Cap'); const T = offer(9, 'Tee');
  const pinned = [{ allProducts: false, triggerProducts: [T], offerProducts: [S, C, J] }];
  const { rules } = mergeInstructionRules([], pinned, 1);
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].fbt_products.map((p) => p.title), ['Ankle Socks', 'Cap', 'Boys Joggers']);
});

test('instructions: "every product" offers go on every catalog product, never on themselves', () => {
  const J = offer(1, 'Boys Joggers'); const C = offer(8, 'Cap'); const M = offer(5, 'Coffee Mug');
  const catalog = [{ gid: J.id, title: J.title }, { gid: C.id, title: C.title }, { gid: M.id, title: M.title }];
  const { rules } = mergeInstructionRules([autoRule(J, M)], [{ allProducts: true, triggerProducts: [], offerProducts: [C] }], 2, catalog);
  const byTrigger = Object.fromEntries(rules.map((r) => [r.trigger_products[0].title, r.fbt_products.map((p) => p.title)]));
  assert.deepEqual(byTrigger['Boys Joggers'], ['Cap', 'Coffee Mug']);
  assert.deepEqual(byTrigger['Coffee Mug'], ['Cap']);
  assert.equal(byTrigger.Cap, undefined, 'Cap is not recommended on its own page, and nothing else is known for it');
});

test('instructions: no instructions = the automatic rules unchanged', () => {
  const J = offer(1, 'Boys Joggers'); const M = offer(5, 'Coffee Mug');
  const auto = [autoRule(J, M)];
  const { rules, pinnedProducts } = mergeInstructionRules(auto, [], 3);
  assert.equal(pinnedProducts, 0);
  assert.deepEqual(rules.map((r) => [r.name, r.fbt_products.map((p) => p.id)]), [['AI: Boys Joggers', [M.id]]]);
});

test('instructionsHash changes with the text or the count, not with spacing', () => {
  assert.equal(instructionsHash('socks with joggers', 3), instructionsHash('  socks   with joggers ', 3));
  assert.notEqual(instructionsHash('socks with joggers', 3), instructionsHash('socks with joggers', 4));
  assert.notEqual(instructionsHash('socks with joggers', 3), instructionsHash('caps with joggers', 3));
});

// ── "match the tops and bottoms" (words that are not in any product title) ──
import { matchGroup } from '../../app/utils/pairing.shared.js';

const CLOTHES = [
  P(21, 'Cotton T-Shirt'), P(22, 'Oversized Hoodie'), P(23, 'Linen Kurta'),
  P(24, 'Boys Joggers'), P(25, 'Slim Fit Jeans'), P(26, 'Cargo Pants'),
  P(27, 'Leather Belt'),
];

test('"match the bottom and top": both ways, tops and bottoms found by their usual names', () => {
  const plan = parsePromptHeuristically('match the bottom and top');
  assert.equal(plan.rules.length, 2);
  const { rules, warnings } = buildRulesFromPlan(plan, { catalog: CLOTHES, maxOffers: 3 });
  assert.deepEqual(warnings.filter((w) => w.includes('No product')), []);
  const byFirst = Object.fromEntries(rules.map((r) => [r.triggerProducts[0].title, r]));
  assert.deepEqual(byFirst['Boys Joggers'].triggerProducts.map((p) => p.title).sort(), ['Boys Joggers', 'Cargo Pants', 'Slim Fit Jeans']);
  assert.deepEqual(byFirst['Boys Joggers'].offerProducts.map((p) => p.title).sort(), ['Cotton T-Shirt', 'Linen Kurta', 'Oversized Hoodie']);
  assert.deepEqual(byFirst['Cotton T-Shirt'].offerProducts.map((p) => p.title).sort(), ['Boys Joggers', 'Cargo Pants', 'Slim Fit Jeans']);
  assert.ok(!rules.some((r) => [...r.triggerProducts, ...r.offerProducts].some((p) => p.title === 'Leather Belt')), 'a belt is neither');
});

test('group words prefer the store\'s own collection, type or tag over the built-in word list', () => {
  const catalog = [
    { ...P(31, 'Classic Polo'), collectionIds: ['c-tops'] },
    { ...P(32, 'Cotton T-Shirt'), collectionIds: [] },
    { ...P(33, 'Denim Shorts'), productType: 'Bottom Wear' },
    { ...P(34, 'Yoga Leggings'), tags: ['bottoms'] },
  ];
  const tops = matchGroup('tops', catalog, [{ id: 'c-tops', title: 'Tops' }]);
  assert.deepEqual(tops.products.map((p) => p.title), ['Classic Polo'], 'the merchant\'s Tops collection wins');
  assert.match(tops.via, /collection/);
  assert.deepEqual(matchGroup('bottoms', catalog).products.map((p) => p.title), ['Denim Shorts'], 'product type before tags');
  assert.equal(matchGroup('spaceships', catalog), null);
});

test('more phrasings: "pair X & Y", "X and Y together", and "with" still one way', () => {
  assert.equal(parsePromptHeuristically('pair tops & bottoms').rules.length, 2);
  assert.equal(parsePromptHeuristically('tops and bottoms together').rules.length, 2);
  const oneWay = parsePromptHeuristically('pair joggers with socks and caps').rules;
  assert.equal(oneWay.length, 1);
  assert.deepEqual(oneWay[0].offer.products, ['socks', 'caps']);
});

test('unknown group word still warns instead of guessing', () => {
  const { rules, warnings } = buildRulesFromPlan(parsePromptHeuristically('match spaceships and rockets'), { catalog: CLOTHES });
  assert.equal(rules.length, 0);
  assert.ok(warnings.some((w) => w.includes('"spaceships"')));
});
