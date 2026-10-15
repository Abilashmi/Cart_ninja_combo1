// Run with: node --import ./tests/packs/register.mjs --test tests/combo-weight/quickshop-filters.test.mjs
// Box templates: collection filter groups (qs_filter_groups: "Weight" with
// its collections, "Years" with its own), the membership lookup behind them
// (services/collection-members.server.js), and the top progress's milestone
// icon size, label lines and text sizes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createComboWeightCore } from '../../app/utils/combo-weight.shared.js';
import { createQuickShopKit } from '../../app/utils/combo-quickshop.shared.js';
import { loadCollectionMembers } from '../../app/services/collection-members.server.js';

const kit = createQuickShopKit(createComboWeightCore());

const product = (n, extra = {}) => ({
  id: `gid://shopify/Product/${n}`, title: `Product ${n}`, tags: [],
  variants: [{ id: `gid://shopify/ProductVariant/${n}`, title: 'Default Title', price: '100.00', grams: 500, available: true }],
  ...extra,
});
const P = [1, 2, 3, 4, 5].map((n) => product(n));
const productsByHandle = { 'all-kids': P };

const GROUPS = [
  { id: 'weight', label: 'Weight', style: 'dropdown', options: [{ handle: '250g', label: '250 g' }, { handle: '500g', label: '' }, { handle: '1kg', label: '' }, { handle: 'empty-col', label: '' }] },
  { id: 'years', label: 'Years', style: 'chips', options: [{ handle: 'age-1-2', label: '1-2 Y' }, { handle: 'age-3-4', label: '3-4 Y' }] },
];
const MEMBERS = {
  '250g': [P[0].id, P[1].id],
  '500g': [P[2].id, P[3].id],
  '1kg': [P[4].id],
  'empty-col': [],
  'age-1-2': [P[0].id, P[2].id],
  'age-3-4': [P[1].id, P[3].id, P[4].id],
};

function model(config, ui = {}, extra = {}) {
  return kit.buildModel({
    config: { layout: 'layout6', tab_count: 1, col_1: 'all-kids', ...config },
    productsByHandle,
    handles: ['all-kids'],
    collectionNames: { '500g': '500 Grams', '1kg': '1 Kg' },
    collectionMembers: MEMBERS,
    ui: { chip: 'all', dd: {}, ...ui },
    pricing: { tiers: [], enabled: false },
    symbol: '₹',
    ...extra,
  });
}

const shownIds = (m) => m.cards.map((c) => c.id);

test('filterGroups keeps only valid groups, at most 5 × 15, no repeats', () => {
  const groups = kit.filterGroups({
    qs_filter_groups: [
      { id: 'a', label: '  Weight ', options: [{ handle: '250g' }, { handle: '250g' }, { handle: 'bad handle' }, { handle: '<x>' }] },
      { id: 'b', label: '', options: [{ handle: 'x' }] }, // no name
      { id: 'c', label: 'Empty', options: [] }, // no collection
      { id: 'a', label: 'Same id', style: 'chips', options: Array.from({ length: 20 }, (_, i) => ({ handle: `c${i}`, label: `L${i}` })) },
      ...Array.from({ length: 6 }, (_, i) => ({ id: `z${i}`, label: `Z${i}`, options: [{ handle: 'h' }] })),
    ],
  });
  assert.equal(groups.length, 5);
  assert.deepEqual(groups[0], { id: 'a', label: 'Weight', style: 'dropdown', options: [{ handle: '250g', label: '' }] });
  assert.notEqual(groups[1].id, 'a', 'a repeated id gets its own');
  assert.equal(groups[1].style, 'chips');
  assert.equal(groups[1].options.length, 15);
  assert.deepEqual(kit.filterGroups({}), []);
  assert.deepEqual(kit.filterGroups({ qs_filter_groups: 'nope' }), []);
  assert.deepEqual(kit.filterGroupHandles({ qs_filter_groups: GROUPS }), ['250g', '500g', '1kg', 'empty-col', 'age-1-2', 'age-3-4']);
});

test('a dropdown group lists its collections with products on the page', () => {
  const m = model({ qs_filter_groups: GROUPS, qs_filter_type: false, qs_filter_brand: false, qs_filter_sort: false });
  const menu = m.row.menus.find((x) => x.id === 'g:weight');
  assert.ok(menu, 'Weight dropdown shown');
  assert.equal(menu.label, 'Weight');
  assert.deepEqual(menu.options.map((o) => o.label), ['All', '250 g', '500 Grams', '1 Kg'], 'own label, else collection title; empty collection hidden');
  assert.equal(m.row.groups.length, 1, 'the chips group comes back as a chip row');
  assert.deepEqual(m.row.groups[0].options.map((o) => o.label), ['1-2 Y', '3-4 Y']);
  assert.equal(m.cards.length, 5);
  assert.equal(m.row.active, false);
});

test('picking options filters, and two groups combine', () => {
  let m = model({ qs_filter_groups: GROUPS }, { dd: { 'g:weight': '500g' } });
  assert.deepEqual(shownIds(m), [P[2].id, P[3].id]);
  assert.equal(m.row.active, true);
  m = model({ qs_filter_groups: GROUPS }, { dd: { 'g:weight': '500g', 'g:years': 'age-3-4' } });
  assert.deepEqual(shownIds(m), [P[3].id], '500 g and 3-4 Y');
  m = model({ qs_filter_groups: GROUPS }, { dd: { 'g:weight': '1kg', 'g:years': 'age-1-2' } });
  assert.deepEqual(shownIds(m), [], 'nothing in both');
  assert.equal(m.empty, 'Nothing matches these filters.');
});

test('a removed group or a collection not loaded yet does not filter', () => {
  let m = model({}, { dd: { 'g:weight': '500g' } });
  assert.equal(m.cards.length, 5, 'group gone');
  m = model({ qs_filter_groups: GROUPS }, { dd: { 'g:weight': '500g' } }, { collectionMembers: {} });
  assert.equal(m.cards.length, 5, 'members unknown (builder before its fetch)');
  assert.equal(m.row.menus.find((x) => x.id === 'g:weight').options.length, 5, 'all options shown while unknown');
});

test('page collections count as known members', () => {
  const m = model({ qs_filter_groups: [{ id: 'k', label: 'Kids', options: [{ handle: 'all-kids' }] }] }, { dd: { 'g:k': 'all-kids' } }, { collectionMembers: {} });
  assert.equal(m.cards.length, 5);
});

test('chips group: tap picks, tap again clears; Clear resets every group', () => {
  const ui = { dd: {} };
  const el = (menu, value) => ({ getAttribute: (k) => ({ 'data-menu': menu, 'data-value': value }[k]) });
  assert.equal(kit.applyUiAction(ui, 'qs-group', el('g:years', 'age-1-2')), true);
  assert.equal(ui.dd['g:years'], 'age-1-2');
  kit.applyUiAction(ui, 'qs-group', el('g:years', 'age-3-4'));
  assert.equal(ui.dd['g:years'], 'age-3-4');
  kit.applyUiAction(ui, 'qs-group', el('g:years', 'age-3-4'));
  assert.equal(ui.dd['g:years'], '');
  ui.dd['g:weight'] = '500g';
  kit.applyUiAction(ui, 'qs-clear', null);
  assert.deepEqual(ui.dd, {});
});

test('render draws the dropdown and the chip row, escaped', () => {
  const groups = [...GROUPS, { id: 'x', label: '<b>Bad</b>', style: 'chips', options: [{ handle: '1kg', label: '"1kg"' }] }];
  const html = kit.render(model({ qs_filter_groups: groups }, { dd: { 'g:years': 'age-1-2' }, menu: 'g:weight' }));
  assert.match(html, /data-combo-action="qs-menu" data-menu="g:weight"/);
  assert.match(html, /data-combo-action="qs-pick" data-menu="g:weight" data-value="500g">500 Grams</);
  assert.match(html, /class="bxq-filters bxq-gchips" role="group" aria-label="Years"><span class="bxq-gchips-label">Years<\/span>/);
  assert.match(html, /class="bxq-chip is-on" aria-pressed="true" data-combo-action="qs-group" data-menu="g:years" data-value="age-1-2">1-2 Y</);
  assert.ok(!html.includes('<b>Bad</b>'));
  assert.ok(html.includes('&lt;b&gt;Bad&lt;/b&gt;'));
  assert.ok(html.includes('&quot;1kg&quot;'));
});

/* ── milestones ─────────────────────────────────────────────────────── */

const TIERS = [
  { id: 't1', min_grams: 1000, type: 'percentage', value: 5, label: '' },
  { id: 't2', min_grams: 2000, type: 'percentage', value: 10, label: '' },
  { id: 't3', min_grams: 3000, type: 'percentage', value: 15, label: '' },
];
function top(config, isMobile = false, tiers = TIERS) {
  return kit.render(model({ qs_top_style: 'milestones', ...config }, {}, {
    pricing: { measure: 'weight', unit: 'kg', tiers, enabled: true }, isMobile,
  }));
}
const milesStyle = (html) => html.match(/class="bxq-miles" style="([^"]+)"/)[1];

test('milestone icon size: default as before, merchant size, phone size', () => {
  assert.deepEqual(kit.mileSizes({}, false, 3), { icon: 18, dot: 34 });
  assert.deepEqual(kit.mileSizes({}, true, 6), { icon: 18, dot: 34 }, 'six tiers on a phone keep the old size');
  assert.deepEqual(kit.mileSizes({ qs_mile_icon_size: 30 }, false, 3), { icon: 30, dot: 46 });
  assert.deepEqual(kit.mileSizes({ qs_mile_icon_size: 30 }, true, 3), { icon: 30, dot: 46 }, 'phones follow desktop when unset');
  assert.deepEqual(kit.mileSizes({ qs_mile_icon_size: 30, qs_mile_icon_size_m: 20 }, true, 3), { icon: 20, dot: 36 });
  assert.deepEqual(kit.mileSizes({ qs_mile_icon_size: 999 }, false, 1), { icon: 48, dot: 64 }, 'clamped');
  const many = kit.mileSizes({ qs_mile_icon_size: 40 }, true, 8);
  assert.ok(many.dot <= Math.floor(260 / 8) - 8 && many.dot >= 22, `8 tiers on a phone fit (${many.dot}px)`);
  assert.ok(many.icon < 40);
  assert.match(milesStyle(top({})), /--bxq-mile-dot:34px;--bxq-mile-icon:18px;height:74px/, 'default height unchanged (74px)');
  assert.match(milesStyle(top({ qs_mile_icon_size: 30 })), /--bxq-mile-dot:46px;--bxq-mile-icon:30px;height:86px/);
});

test('label lines can be hidden and resized', () => {
  let html = top({});
  assert.match(html, /<span class="bxq-mile-label"><b>5% OFF<\/b><small>1 kg<\/small><\/span>/);
  html = top({ qs_top_show_amount: false });
  assert.match(html, /<span class="bxq-mile-label"><b>5% OFF<\/b><\/span>/);
  assert.ok(!html.includes('<small>1 kg</small>'));
  html = top({ qs_top_show_name: false });
  assert.match(html, /<span class="bxq-mile-label"><small>1 kg<\/small><\/span>/);
  html = top({ qs_top_show_name: false, qs_top_show_amount: false });
  assert.ok(!html.includes('bxq-mile-label'), 'both hidden = no label at all');
  assert.match(milesStyle(html), /height:38px/, 'circle + 4px');
  html = top({ qs_top_label_size: 16, qs_top_sub_size: 13 });
  assert.match(html, /--bxq-lbl-fs:16px;--bxq-lbl-sub:13px;/);
  assert.match(html, /--bxq-lbl-fs-mile-m:15px;/, 'phones 1px smaller when unset, as before');
  assert.match(milesStyle(html), /height:(\d+)px/);
  assert.ok(Number(milesStyle(html).match(/height:(\d+)px/)[1]) > 74, 'bigger text = more room');
  html = top({ qs_top_label_size_m: 10 }, true);
  assert.match(html, /--bxq-lbl-fs-m:10px;--bxq-lbl-fs-mile-m:10px;/);
});

test('the same label options apply to the bar and steps styles', () => {
  let html = top({ qs_top_style: 'bar', qs_top_show_amount: false });
  assert.match(html, /<b>5% OFF<\/b><\/span>/);
  assert.ok(!html.includes('<small>1 kg</small>'));
  assert.match(html, /class="bxq-ticks" style="height:24px"/);
  html = top({ qs_top_style: 'bar' });
  assert.match(html, /class="bxq-ticks" style="height:38px"/, 'default height unchanged');
  html = top({ qs_top_style: 'steps', qs_top_show_name: false });
  assert.match(html, /<div class="bxq-step-label"><small>1 kg<\/small><\/div>/);
});

/* ── membership lookup ──────────────────────────────────────────────── */

function fakeAdmin(collections, membership, calls = []) {
  return {
    calls,
    graphql: async (query, { variables }) => {
      calls.push({ query, variables });
      let data;
      if (query.includes('BrixFilterCollections')) {
        data = {};
        Object.entries(variables).forEach(([k, handle]) => { data[`c${k.slice(1)}`] = collections[handle] ? { id: collections[handle] } : null; });
      } else {
        const colIds = Object.keys(variables).filter((k) => k !== 'ids').map((k) => [k.slice(1), variables[k]]);
        data = { nodes: variables.ids.map((id) => {
          const node = { id };
          colIds.forEach(([i, cid]) => { node[`m${i}`] = (membership[cid] || []).includes(id); });
          return node;
        }) };
      }
      return { json: async () => ({ data }) };
    },
  };
}

test('loadCollectionMembers asks inCollection for the page products', async () => {
  const admin = fakeAdmin(
    { '250g': 'gid://shopify/Collection/1', '500g': 'gid://shopify/Collection/2' },
    { 'gid://shopify/Collection/1': [P[0].id], 'gid://shopify/Collection/2': [P[1].id, P[2].id] },
  );
  const out = await loadCollectionMembers(admin, { handles: ['250g', '500g', 'missing', '250g', 'bad handle'], productIds: [...P.map((p) => p.id), 'not-a-gid'] });
  assert.deepEqual(out, { '250g': [P[0].id], '500g': [P[1].id, P[2].id], missing: [] });
  assert.equal(admin.calls.length, 2);
  assert.match(admin.calls[1].query, /m0: inCollection\(id: \$c0\)/);
  assert.equal(admin.calls[1].variables.ids.length, 5);
});

test('loadCollectionMembers pages products and never throws', async () => {
  const many = Array.from({ length: 250 }, (_, i) => `gid://shopify/Product/${i + 1}`);
  const admin = fakeAdmin({ a: 'gid://shopify/Collection/1' }, { 'gid://shopify/Collection/1': [many[0], many[249]] });
  const out = await loadCollectionMembers(admin, { handles: ['a'], productIds: many });
  assert.deepEqual(out, { a: [many[0], many[249]] });
  assert.equal(admin.calls.length, 4, '1 lookup + 3 pages of 100');

  const failing = { graphql: async () => ({ json: async () => ({ errors: [{ message: 'Throttled' }] }) }) };
  assert.deepEqual(await loadCollectionMembers(failing, { handles: ['a'], productIds: many }), {}, 'failure = unknown, not empty');
  assert.deepEqual(await loadCollectionMembers(admin, { handles: [], productIds: many }), {});
});
