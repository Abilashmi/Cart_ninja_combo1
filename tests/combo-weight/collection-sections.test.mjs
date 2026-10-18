// Run with: node --import ./tests/packs/register.mjs --test tests/combo-weight/collection-sections.test.mjs
// Box templates: the collections' own names on the page (qs_col_titles),
// the chip row's alignment (qs_chips_align) and products shown in one section
// per collection (qs_group_by_collection, title alignment / size). Nothing set
// = the page as before. Order = col_1..col_N (reordered in Box Collections).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createComboWeightCore } from '../../app/utils/combo-weight.shared.js';
import { createQuickShopKit } from '../../app/utils/combo-quickshop.shared.js';

const kit = createQuickShopKit(createComboWeightCore());
const product = (n) => ({ id: `p${n}`, title: `Product ${n}`, tags: [], variants: [{ id: `v${n}`, title: 'Default Title', price: '10.00', available: true }] });
const P = [1, 2, 3, 4, 5].map(product);

function build(config = {}, { handles = ['tees', 'jeans'], ui = {}, extra = null } = {}) {
  const productsByHandle = { tees: [P[0], P[1]], jeans: [P[2], P[1]] }; // P2 is in both
  if (extra) productsByHandle[kit.EXTRA_HANDLE] = extra;
  return kit.buildModel({
    config: { layout: 'layout7', ...config },
    productsByHandle, handles,
    collectionNames: { tees: 'Boys Tees 2024', jeans: 'Jeans' },
    ui: { chip: 'all', dd: {}, ...ui }, pricing: { tiers: [] }, symbol: '₹',
  });
}
const chipLabels = (m) => m.row.chips.map((c) => c.label);

test('nothing set: Shopify names, chips left, one grid (as before)', () => {
  const m = build();
  assert.deepEqual(chipLabels(m), ['All', 'Boys Tees 2024', 'Jeans']);
  assert.equal(m.sections, null);
  const html = kit.render(m);
  assert.match(html, /<div class="bxq-filters">/);
  assert.equal((html.match(/class="bxq-grid"/g) || []).length, 1);
  assert.doesNotMatch(html, /bxq-section/);
});

test('own names replace the Shopify names on chips and the picture bar; empty = Shopify name', () => {
  const titles = { qs_col_titles: { tees: '  Tees ', jeans: '' } };
  assert.deepEqual(chipLabels(build(titles)), ['All', 'Tees', 'Jeans']);
  const pictures = kit.render(build({ ...titles, qs_chip_style: 'images' }));
  assert.match(pictures, /class="bxq-col-name">Tees</);
  assert.match(pictures, /class="bxq-col-name">Jeans</);
});

test('the collections order is the chips order', () => {
  assert.deepEqual(chipLabels(build({}, { handles: ['jeans', 'tees'] })), ['All', 'Jeans', 'Boys Tees 2024']);
});

test('chips alignment: centre / right on the chip row and the picture bar', () => {
  assert.match(kit.render(build({ qs_chips_align: 'center' })), /<div class="bxq-filters bxq-al-center">/);
  assert.match(kit.render(build({ qs_chips_align: 'right', qs_chip_style: 'images' })), /<div class="bxq-colbar bxq-al-right"/);
  assert.match(kit.render(build({ qs_chips_align: 'nonsense' })), /<div class="bxq-filters">/, 'unknown = left');
});

test('sections: one per collection in order, a product in two shows in the first, own names and alignment', () => {
  const m = build({ qs_group_by_collection: true, qs_col_titles: { tees: 'Tees' }, qs_group_title_align: 'center', qs_group_title_size: 26, qs_group_title_size_m: 15 });
  assert.deepEqual(m.sections.map((s) => [s.title, s.cards.map((c) => c.id)]), [['Tees', ['p1', 'p2']], ['Jeans', ['p3']]]);
  const html = kit.render(m);
  assert.match(html, /<h2 class="bxq-section-title" style="text-align:center">Tees<\/h2>/);
  assert.match(html, /--bxq-sec-fs:26px/);
  assert.match(html, /--bxq-sec-fs-m:15px/);
  assert.equal((html.match(/data-product-id="p2"/g) || []).length >= 1, true);
  assert.equal((html.match(/<article class="bxq-card[^"]*" data-product-id="p2"/g) || []).length, 1, 'p2 drawn once');
  // Reordered: Jeans first, and p2 now shows there.
  const swapped = build({ qs_group_by_collection: true }, { handles: ['jeans', 'tees'] });
  assert.deepEqual(swapped.sections.map((s) => [s.title, s.cards.map((c) => c.id)]), [['Jeans', ['p3', 'p2']], ['Boys Tees 2024', ['p1']]]);
});

test('sections follow the filters: a collection chip leaves one section, empty sections are dropped', () => {
  const m = build({ qs_group_by_collection: true }, { ui: { chip: 'c:jeans' } });
  assert.deepEqual(m.sections.map((s) => s.title), ['Jeans']);
});

test('products added by hand come last, under their own title or none', () => {
  const extra = [P[4]];
  const noTitle = build({ qs_group_by_collection: true }, { extra });
  assert.deepEqual(noTitle.sections.map((s) => [s.title, s.cards.map((c) => c.id)]).at(-1), ['', ['p5']]);
  assert.doesNotMatch(kit.render(noTitle).split('data-collection="__brix_extra"')[1].slice(0, 80), /bxq-section-title/);
  const titled = build({ qs_group_by_collection: true, qs_extra_title: 'Also try' }, { extra });
  assert.equal(titled.sections.at(-1).title, 'Also try');
});
