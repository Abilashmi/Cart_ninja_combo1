/* eslint-env node */
// Run with: node --test tests/shipping
// The dynamic shipping rules engine (app/utils/shipping.shared.js): the same
// code prices COD quotes / orders on the server and the admin's preview.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeShipping, quoteShipping, shippingErrors, parsePinList, parsePinEntry, pinMatches, rateAmount,
  shippingFromSimple, defaultShipping, newMethod, newZone, newRule, newCharge, deliveryForShopper, deliverySummary,
  etaLabel, slotLabel, referencedCollections, canonicalState,
} from '../../app/utils/shipping.shared.js';

// Monday 26 Oct 2026, 10:00 in India (04:30 UTC).
const MON_10 = new Date('2026-10-26T04:30:00Z');
const MON_15 = new Date('2026-10-26T09:30:00Z');
const SAT_10 = new Date('2026-10-31T04:30:00Z');

const BLR = { pincode: '560001', city: 'Bangalore', state: 'Karnataka' };
const GUWAHATI = { pincode: '781001', city: 'Guwahati', state: 'Assam' };
const JAIPUR = { pincode: '302001', city: 'Jaipur', state: 'Rajasthan' };

const line = (over = {}) => ({ productId: 'gid://shopify/Product/1', quantity: 1, value: 500, unitGrams: 400, tags: [], collections: [], ...over });

function config(patch = {}) {
  return sanitizeShipping({ ...defaultShipping(), ...patch });
}
const quote = (cfg, ctx = {}) => quoteShipping(cfg, { destination: BLR, now: MON_10, lines: [line()], subtotal: 500, ...ctx });
const priceOf = (res, id = 'standard') => res.options.find((o) => o.id === id)?.price;

test('PIN entries: exact, range (any order, with spaces), prefix; anything else is reported', () => {
  assert.equal(parsePinEntry('560001'), '560001');
  assert.equal(parsePinEntry('560099 - 560001'), '560001-560099');
  assert.equal(parsePinEntry('560*'), '560*');
  assert.equal(parsePinEntry('56'), '56*');
  assert.equal(parsePinEntry('060001'), null);
  assert.equal(parsePinEntry('5600011'), null);
  const { pins, bad } = parsePinList('560001, 560001 – 560099; 110*\n12345a 560001');
  assert.deepEqual(pins, ['560001', '560001-560099', '110*']);
  assert.deepEqual(bad, ['12345a']);
  assert.ok(pinMatches('560001-560099', '560050'));
  assert.ok(!pinMatches('560001-560099', '560100'));
  assert.ok(pinMatches('11*', '110021'));
});

test('sanitize: numbers typed as text, states by their own name, tiers sorted from 0, unknown zones dropped', () => {
  const zone = { id: 'metro', name: 'Metro', states: ['tamil nadu', 'Atlantis'], cities: ['Mumbai', '<b>'], pins: ['400001', 'nope'] };
  const c = sanitizeShipping({
    zones: [zone],
    methods: [{ ...newMethod('standard'), rate: { type: 'tiers', by: 'value', tiers: [{ from: '999', amount: '0' }, { from: '500', amount: '40' }, { from: '', amount: '60' }] }, zones: ['metro', 'ghost'], freeAbove: '1499' }],
  });
  assert.deepEqual(c.zones[0].states, ['Tamil Nadu']);
  assert.deepEqual(c.zones[0].cities, ['Mumbai']);
  assert.deepEqual(c.zones[0].pins, ['400001']);
  assert.deepEqual(c.methods[0].rate.tiers, [{ from: 0, amount: 60 }, { from: 500, amount: 40 }, { from: 999, amount: 0 }]);
  assert.deepEqual(c.methods[0].zones, ['metro']);
  assert.equal(c.methods[0].freeAbove, 1499);
  assert.equal(canonicalState('jammu & kashmir'), 'Jammu and Kashmir');
  // Nothing at all → one Standard option.
  assert.equal(sanitizeShipping({}).methods.length, 1);
});

test('rates: flat, free, per item, weight with extra steps, slabs by value / items / weight, % with min and max', () => {
  const m = { value: 1200, quantity: 3, grams: 2300 };
  assert.equal(rateAmount({ type: 'flat', amount: 49 }, m), 49);
  assert.equal(rateAmount({ type: 'free' }, m), 0);
  assert.equal(rateAmount({ type: 'per_item', amount: 20, first: 50 }, m), 90);
  assert.equal(rateAmount({ type: 'per_item', amount: 20, first: 0 }, m), 60);
  // ₹50 up to 500 g, then ₹30 per started 500 g: 1800 g extra → 4 steps.
  assert.equal(rateAmount({ type: 'weight', base: 50, baseGrams: 500, step: 30, stepGrams: 500 }, m), 170);
  const tiers = (by) => ({ type: 'tiers', by, tiers: [{ from: 0, amount: 80 }, { from: 2, amount: 60 }, { from: 1000, amount: 40 }, { from: 2000, amount: 20 }] });
  assert.equal(rateAmount(tiers('value'), m), 40);
  assert.equal(rateAmount(tiers('quantity'), m), 60);
  assert.equal(rateAmount(tiers('weight'), m), 20);
  assert.equal(rateAmount({ type: 'percent', percent: 5, min: 70, max: 0 }, m), 70);
  assert.equal(rateAmount({ type: 'percent', percent: 10, min: 0, max: 100 }, m), 100);
});

test('the simple settings, switched to advanced, charge exactly the same', () => {
  const cfg = sanitizeShipping(shippingFromSimple({ shippingFee: 49, freeShippingAbove: 999 }));
  assert.equal(priceOf(quote(cfg, { subtotal: 500 })), 49);
  assert.equal(priceOf(quote(cfg, { subtotal: 999, lines: [line({ value: 999 })] })), 0);
  assert.equal(quote(cfg, { subtotal: 700, lines: [line({ value: 700 })] }).options[0].freeIn, 299);
  assert.equal(priceOf(quote(sanitizeShipping(shippingFromSimple({ shippingFee: 0 })))), 0);
});

test('zones: by state, city (old names too), PIN range or prefix; the first zone in the list sets the zone price', () => {
  const metro = { ...newZone('metro'), id: 'metro' };
  const remote = { ...newZone('remote'), id: 'remote' };
  const south = { id: 'south', name: 'South PINs', states: [], cities: [], pins: ['56*', '600001-600099'] };
  const std = { ...newMethod('standard'), rate: { type: 'flat', amount: 80 }, zoneRates: [{ zone: 'south', rate: { type: 'flat', amount: 30 } }, { zone: 'metro', rate: { type: 'flat', amount: 40 } }, { zone: 'remote', rate: { type: 'flat', amount: 150 } }] };
  const cfg = config({ zones: [metro, remote, south], methods: [std] });
  // Bangalore → "Bengaluru" in Metro, and 560001 in South: Metro is higher in the zone list, so its price.
  const blr = quote(cfg);
  assert.equal(blr.zone.name, 'Metro cities');
  assert.equal(priceOf(blr), 40);
  assert.equal(priceOf(quote(cfg, { destination: { pincode: '600050', city: 'Somewhere', state: 'Tamil Nadu' } })), 30);
  assert.equal(priceOf(quote(cfg, { destination: GUWAHATI })), 150);
  assert.equal(priceOf(quote(cfg, { destination: JAIPUR })), 80, 'everywhere else');
  assert.equal(quote(cfg, { destination: JAIPUR }).zone, null);
});

test('options offered only in some zones, by order value and weight; before the address, zone-only options wait', () => {
  const local = { id: 'local', name: 'Local', states: [], cities: [], pins: ['5600*'] };
  const sameDay = { ...newMethod('same_day', 'same'), zones: ['local'] };
  const express = { ...newMethod('express', 'exp'), minOrder: 300, maxGrams: 1000 };
  const cfg = config({ zones: [local], methods: [newMethod('standard'), sameDay, express] });
  assert.deepEqual(quote(cfg).options.map((o) => o.id), ['standard', 'same', 'exp']);
  assert.deepEqual(quote(cfg, { destination: JAIPUR }).options.map((o) => o.id), ['standard', 'exp']);
  assert.deepEqual(quote(cfg, { destination: null }).options.map((o) => o.id), ['standard', 'exp']);
  assert.deepEqual(quote(cfg, { subtotal: 200, lines: [line({ value: 200 })] }).options.map((o) => o.id), ['standard', 'same']);
  const heavy = quote(cfg, { lines: [line({ unitGrams: 600, quantity: 2 })] });
  assert.deepEqual(heavy.options.map((o) => o.id), ['standard', 'same']);
  assert.match(heavy.unavailable.find((u) => u.id === 'exp').reason, /Heavier than 1 kg/);
});

test('"Don\'t deliver to" areas and "Don\'t deliver" rules block the order; a rule can hide one option', () => {
  const remote = { ...newZone('remote'), id: 'remote' };
  const cfg = config({ zones: [remote], blocked: { zones: ['remote'], states: [], cities: [], pins: ['110001-110099'], message: 'Not in your area yet.' } });
  assert.deepEqual(quote(cfg, { destination: GUWAHATI }).blocked, { message: 'Not in your area yet.', by: 'area' });
  assert.ok(quote(cfg, { destination: { pincode: '110050', city: 'Delhi', state: 'Delhi' } }).blocked);
  assert.equal(quote(cfg).blocked, null);
  assert.equal(quote(cfg, { destination: null }).blocked, null, 'no address yet: nothing blocked');

  const heavyBlock = { ...newRule('block'), name: 'Too heavy', when: { minGrams: 20000 }, then: { type: 'block', message: 'Over 20 kg: please call us.' } };
  const hideExpress = { ...newRule('hide'), name: 'No express to Assam', when: { states: ['Assam'], methods: ['exp'] } };
  const cfg2 = config({ methods: [newMethod('standard'), newMethod('express', 'exp')], rules: [heavyBlock, hideExpress] });
  assert.equal(quote(cfg2, { lines: [line({ unitGrams: 21000 })] }).blocked.message, 'Over 20 kg: please call us.');
  const assam = quote(cfg2, { destination: GUWAHATI });
  assert.deepEqual(assam.options.map((o) => o.id), ['standard']);
  assert.match(assam.unavailable[0].reason, /No express to Assam/);
});

test('rule priority: the first match, the cheapest or the dearest; no match = the option\'s own price', () => {
  const r1 = { ...newRule('rate'), name: 'Heavy', when: { minGrams: 1000 }, then: { type: 'rate', rate: { type: 'flat', amount: 120 } } };
  const r2 = { ...newRule('rate'), name: 'Karnataka', when: { states: ['Karnataka'] }, then: { type: 'rate', rate: { type: 'flat', amount: 70 } } };
  const std = { ...newMethod('standard'), rate: { type: 'flat', amount: 50 } };
  const heavyBlr = { lines: [line({ unitGrams: 1500 })] };
  assert.equal(priceOf(quote(config({ methods: [std], rules: [r1, r2], priority: 'first' }), heavyBlr)), 120);
  assert.equal(priceOf(quote(config({ methods: [std], rules: [r1, r2], priority: 'lowest' }), heavyBlr)), 70);
  assert.equal(priceOf(quote(config({ methods: [std], rules: [r2, r1], priority: 'highest' }), heavyBlr)), 120);
  assert.equal(priceOf(quote(config({ methods: [std], rules: [r1, r2] }), { destination: JAIPUR })), 50);
  const steps = quote(config({ methods: [std], rules: [r1, r2] }), heavyBlr).options[0].steps;
  assert.equal(steps[0].label, 'Rule "Heavy"');
});

test('rules by product, collection or tag: any item vs every item', () => {
  const lamp = 'gid://shopify/Product/9';
  const furniture = 'gid://shopify/Collection/77';
  const r = (when) => ({ ...newRule('free'), name: 'r', when });
  const lines = [line({ productId: lamp }), line({ collections: [furniture], tags: ['Bulky'] })];
  const std = { ...newMethod('standard'), rate: { type: 'flat', amount: 60 } };
  const run = (when) => priceOf(quote(config({ methods: [std], rules: [r(when)] }), { lines, subtotal: 1000 }));
  assert.equal(run({ products: [{ id: lamp, title: 'Lamp' }] }), 0);
  assert.equal(run({ collections: [{ id: furniture, title: 'Furniture' }] }), 0);
  assert.equal(run({ tags: ['bulky'] }), 0, 'tags ignore case');
  assert.equal(run({ tags: ['bulky'], itemMatch: 'all' }), 60, 'not every item has the tag');
  assert.deepEqual(referencedCollections(config({ rules: [r({ collections: [{ id: furniture }] })] })), [furniture]);
});

test('free shipping: from an order value, products that ship free, and items that need no shipping', () => {
  const std = { ...newMethod('standard'), rate: { type: 'per_item', amount: 30 }, freeAbove: 2000 };
  const gift = 'gid://shopify/Product/5';
  const cfg = config({ methods: [std], freeItems: { products: [{ id: gift }], collections: [], tags: ['ships-free'] } });
  const both = [line({ quantity: 2 }), line({ productId: gift, quantity: 3 })];
  assert.equal(priceOf(quote(cfg, { lines: both, subtotal: 1500 })), 60, 'only the 2 paying items count');
  assert.equal(priceOf(quote(cfg, { lines: [line({ productId: gift })] })), 0, 'every item ships free');
  assert.equal(priceOf(quote(cfg, { lines: both, subtotal: 2000 })), 0, 'free from 2000');
  const digital = quote(cfg, { lines: [line({ requiresShipping: false })] });
  assert.equal(digital.noShipping, true);
  assert.equal(digital.options.length, 0);
  assert.equal(deliveryForShopper(digital), null);
});

test('shipping discounts add up (max 100%) and never touch extra charges', () => {
  const std = { ...newMethod('standard'), rate: { type: 'flat', amount: 100 } };
  const d1 = { ...newRule('discount'), when: { minValue: 1000 }, then: { type: 'discount', percent: 50 } };
  const d2 = { ...newRule('discount'), when: { states: ['Karnataka'] }, then: { type: 'discount', percent: 25 } };
  const handling = { ...newCharge('handling'), amount: 15, alsoWhenFree: true };
  const cfg = config({ methods: [std], rules: [d1, d2], charges: [handling] });
  assert.equal(priceOf(quote(cfg, { subtotal: 1200, lines: [line({ value: 1200 })] })), 25 + 15);
  assert.equal(priceOf(quote(cfg, { subtotal: 500 })), 75 + 15);
  const d3 = { ...newRule('discount'), when: {}, then: { type: 'discount', percent: 90 } };
  assert.equal(priceOf(quote(config({ methods: [std], rules: [d1, d3] }), { subtotal: 1200, lines: [line({ value: 1200 })] })), 0);
});

test('extra charges: handling (not on free shipping unless asked), remote area, fragile per unit, extra packages', () => {
  const remote = { ...newZone('remote'), id: 'remote' };
  const std = { ...newMethod('standard'), rate: { type: 'flat', amount: 50 }, freeAbove: 1000 };
  const handling = { ...newCharge('handling'), amount: 10, percent: 1 };
  const remoteCharge = { ...newCharge('remote'), amount: 60, when: { zones: ['remote'] } };
  const fragile = { ...newCharge('fragile'), amount: 25 };
  const packs = { ...newCharge('packages'), amount: 40, packageGrams: 5000 };
  const cfg = config({ zones: [remote], methods: [std], charges: [handling, remoteCharge, fragile, packs] });
  // 500 order, Bengaluru, 1 plain item of 400 g: 50 + handling 10 + 1% of 500.
  assert.equal(priceOf(quote(cfg)), 65);
  // Free from 1000: handling is waived, the rest still apply. 12 kg = 3 packages = 2 extra.
  const free = quote(cfg, { destination: GUWAHATI, subtotal: 1200, lines: [line({ value: 1200, unitGrams: 4000, quantity: 3, tags: ['Fragile'] })] });
  assert.equal(priceOf(free), 60 + 25 * 3 + 40 * 2);
  assert.deepEqual(free.options[0].steps.filter((s) => s.charge).map((s) => s.label), ['Remote area charge', 'Fragile item handling', 'Extra package charge']);
});

test('delivery dates: processing days, the cut-off, working days and holidays', () => {
  const cfg = config();
  // Monday 10:00: work starts today, ships Tuesday (1 processing day), 3–5 working days (Sundays off).
  const mon = quote(cfg).options[0].eta;
  assert.deepEqual([mon.from, mon.to, mon.label], ['2026-10-30', '2026-11-02', '30 Oct – 2 Nov']);
  // After the 14:00 cut-off: starts Tuesday.
  assert.deepEqual(quote(cfg, { now: MON_15 }).options[0].eta.from, '2026-10-31');
  // A holiday on Wednesday pushes it a day (Saturday is a working day).
  const hol = config({ delivery: { ...defaultShipping().delivery, holidays: ['2026-10-28'] } });
  assert.equal(quote(hol).options[0].eta.from, '2026-10-31');
  // ETA off: no dates shown.
  assert.equal(quote(config({ delivery: { ...defaultShipping().delivery, showEta: false } })).options[0].eta, null);
  // Zone-specific days.
  const remote = { ...newZone('remote'), id: 'remote' };
  const std = { ...newMethod('standard'), zoneDays: [{ zone: 'remote', min: 6, max: 9 }] };
  // Ships Tue 27 Oct; 6 working days later (Sunday off) = Tue 3 Nov.
  assert.equal(quote(config({ zones: [remote], methods: [std] }), { destination: GUWAHATI }).options[0].eta.from, '2026-11-03');
});

test('same-day and next-day follow their own cut-off; next day skips Sunday', () => {
  const cfg = config({ methods: [newMethod('same_day', 'same'), newMethod('next_day', 'next')] });
  const morning = quote(cfg);
  assert.equal(morning.options.find((o) => o.id === 'same').eta.label, 'Today');
  assert.equal(morning.options.find((o) => o.id === 'next').eta.label, 'Tomorrow');
  const afternoon = quote(cfg, { now: MON_15 });
  assert.deepEqual(afternoon.options.map((o) => o.id), ['next']);
  const evening = quote(cfg, { now: new Date('2026-10-26T11:30:00Z') }); // 17:00 IST
  assert.equal(evening.options.length, 0);
  assert.equal(quote(cfg, { now: SAT_10 }).options.find((o) => o.id === 'next').eta.label, 'Mon, 2 Nov');
});

test('scheduled delivery: working days in the booking window, time slots, and the shopper\'s pick', () => {
  const cfg = config({ methods: [newMethod('standard'), newMethod('scheduled', 'sch')] });
  const base = quote(cfg, { choice: { option: 'sch' } });
  assert.equal(base.selected.id, 'sch');
  assert.deepEqual(base.selected.dates.map((x) => x.date), ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-02']);
  assert.equal(base.selected.dates[0].label, 'Tomorrow');
  assert.equal(base.date, '2026-10-27');
  assert.deepEqual(base.selected.slots.map((s) => s.label), ['10 AM – 1 PM', '1 PM – 5 PM', '5 PM – 9 PM']);
  const picked = quote(cfg, { choice: { option: 'sch', date: '2026-10-30', slot: '13:00-17:00' } });
  assert.deepEqual([picked.date, picked.slot, picked.choiceError], ['2026-10-30', '13:00-17:00', null]);
  assert.equal(deliverySummary(picked), 'Scheduled delivery on Fri, 30 Oct, 1 PM – 5 PM');
  assert.equal(quote(cfg, { choice: { option: 'sch', date: '2026-11-01' } }).choiceError, 'date', 'Sunday is not offered');
  assert.equal(quote(cfg, { choice: { option: 'sch', slot: '06:00-07:00' } }).choiceError, 'slot');
  const gone = quote(cfg, { choice: { option: 'express-x' } });
  assert.equal(gone.choiceError, 'option');
  assert.equal(gone.selected.id, 'standard');
});

test('the shopper sees options, prices and dates, never rule names or price steps', () => {
  const r = { ...newRule('rate'), name: 'Secret margin rule', when: {}, then: { type: 'rate', rate: { type: 'flat', amount: 70 } } };
  const shown = deliveryForShopper(quote(config({ rules: [r] })));
  assert.deepEqual(Object.keys(shown), ['zone', 'options', 'selected', 'date', 'slot']);
  assert.equal(shown.options[0].price, 70);
  assert.equal('steps' in shown.options[0], false);
  assert.doesNotMatch(JSON.stringify(shown), /Secret/);
});

test('admin checks: empty prices, bad PIN codes, ranges the wrong way round, cut-off times, slots', () => {
  const draft = defaultShipping();
  draft.methods[0].rate = { type: 'flat', amount: '' };
  draft.methods.push({ ...newMethod('same_day', 's'), cutoff: '25:00' });
  draft.methods.push({ ...newMethod('scheduled', 'sc'), schedule: { firstDay: 3, lastDay: 2, slots: ['13:00-10:00'] } });
  draft.zones.push({ id: 'z', name: '', states: [], cities: [], pins: ['56000'] });
  draft.zones.push({ id: 'y', name: 'Y', states: [], cities: [], pins: ['abc'] });
  draft.rules.push({ ...newRule('rate'), when: { minValue: 900, maxValue: 100 } });
  draft.charges.push({ ...newCharge('packages'), packageGrams: 0 });
  const e = shippingErrors(draft);
  for (const key of ['methods.0.rate.amount', 'methods.1.cutoff', 'methods.2.schedule.lastDay', 'methods.2.schedule.slots', 'zones.0.name', 'zones.1.pins', 'rules.0.when.maxValue', 'charges.0.packageGrams']) {
    assert.ok(e[key], `expected an error at ${key}: ${JSON.stringify(e)}`);
  }
  assert.equal(e['zones.0.where'], undefined, '56000 is a valid prefix');
  assert.deepEqual(shippingErrors(defaultShipping()), {});
  const off = defaultShipping();
  off.methods[0].enabled = false;
  assert.ok(shippingErrors(off).methods);
});

test('PIN codes: one budget of 10,000 entries for zones, Don\'t deliver to, rules and charges', () => {
  const many = Array.from({ length: 3000 }, (_, i) => String(110001 + i));
  const zones = [1, 2, 3].map((n) => ({ id: `z${n}`, name: `Z${n}`, states: [], cities: [], pins: many }));
  const rules = [{ ...newRule('free'), when: { pins: many } }];
  // Zones hold 9,000, so the rule keeps the last 1,000 once saved…
  assert.equal(sanitizeShipping({ zones, rules }).rules[0].when.pins.length, 1000);
  // …and the admin is told before saving.
  assert.match(shippingErrors({ ...defaultShipping(), zones, rules }).zones, /12,000/);
  const oneZone = { ...defaultShipping(), zones: [{ id: 'big', name: 'Big', states: [], cities: [], pins: [...many, '400001'] }] };
  assert.ok(shippingErrors(oneZone)['zones.0.pins'], 'at most 3,000 in one zone');
});

test('labels', () => {
  assert.equal(etaLabel('2026-10-27', '2026-10-27', '2026-10-26'), 'Tomorrow');
  assert.equal(etaLabel('2026-10-28', '2026-10-30', '2026-10-26'), '28–30 Oct');
  assert.equal(slotLabel('09:30-12:00'), '9:30 AM – 12 PM');
});
