/* eslint-env node */
// Run with: node --test tests/packs/php-storefront.test.mjs
// The REAL php_backend/packs_storefront.php on a throwaway MariaDB (the COD harness): which packs a product
// page gets, including the extra pages a pack is shown on, before and after migrations/alter_brix_packs_extra_products.sql.
// Nothing here touches the shared database or a store.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { harnessAvailable, startHarness } from '../cod/php-harness.mjs';

if (!harnessAvailable()) {
  console.log('SKIP packs php storefront tests: XAMPP PHP / MariaDB binaries not found (set XAMPP_DIR).');
  process.exit(0);
}

const harness = await startHarness({ extraFiles: ['packs_storefront.php'], portOffset: 40 });
after(() => harness.stop());
const sql = (q, p = []) => harness.db.query(q, p).then(([rows]) => rows);
const run = async (file) => { for (const statement of fs.readFileSync(file, 'utf8').split(/;\s*\n/).map((s) => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean)) await sql(statement); };

const SHOP = 'demo.myshopify.com';
const tiers = JSON.stringify([{ quantity: 3, discountType: 'percentage', discountValue: 10, name: '', badge: '' }]);

await run('migrations/create_brix_packs.sql');
await run('migrations/create_brix_packs_shop_state.sql');
await run('migrations/alter_brix_packs_variant_scope.sql');
await sql('INSERT INTO shops (shop_domain, plan_name) VALUES (?, ?)', [SHOP, 'pro']).catch(() => {});

async function addPack(id, productId, variantId, extra = {}, withExtraColumns = true) {
  const cols = { id, shop_domain: SHOP, product_id: productId, variant_id: variantId, product_title: `Product ${productId}`, variant_title: 'A', status: 'active', enabled: 1,
    template: 'choose_each_item', pack_type: 'mix_match', variant_scope: 'all', allowed_variant_ids_json: '[]', tiers_json: tiers, customization_json: '{}', ...extra };
  if (!withExtraColumns) for (const k of ['extra_products_json', 'show_on_json', 'show_on_ids', 'product_handle']) delete cols[k];
  const names = Object.keys(cols);
  await sql(`INSERT INTO brix_packs (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`, names.map((n) => cols[n]));
}
const verify = (versions) => sql('REPLACE INTO brix_packs_shop_state (shop_domain, discount_verified, discount_state, discount_message, verified_packs_json) VALUES (?, 1, ?, ?, ?)', [SHOP, 'active', 'ok', JSON.stringify(versions)]);
const get = async (productId, extra = '') => (await fetch(`${harness.baseUrl}/packs_storefront.php?shop=${SHOP}&productId=${productId}${extra}`)).json();

test('before the migration: a pack is found on its own product page, and the endpoint keeps working', async () => {
  await addPack(1, '100', '1001', {}, false);
  await verify({ 1: 1 });
  const body = await get('100');
  assert.deepEqual(body.packs.map((p) => p.id), [1]);
  assert.equal(body.packs[0].productId, '100');
  assert.deepEqual(body.packs[0].extraProducts, []);
  assert.deepEqual((await get('555')).packs, [], 'another page gets nothing');
});

test('after the migration: extra products and "show on" pages', async () => {
  await run('migrations/alter_brix_packs_extra_products.sql');
  await run('migrations/alter_brix_packs_extra_products.sql'); // safe to run twice
  await addPack(2, '200', '2001', {
    extra_products_json: JSON.stringify([
      { productId: 'gid://shopify/Product/201', handle: 'soap-lavender', title: 'Lavender', variantScope: 'selected', allowedVariantIds: ['2011', 'gid://shopify/ProductVariant/2012'] },
      { productId: '202', handle: '../bad', title: 'Mint', variantScope: 'all', allowedVariantIds: ['9'] },
      { productId: '201' }, // duplicate
    ]),
    show_on_json: JSON.stringify(['201', '300']),
    show_on_ids: ',201,300,',
    product_handle: 'soap-rose',
  });
  await verify({ 1: 1, 2: 1 });

  const own = (await get('200')).packs.find((p) => p.id === 2);
  assert.equal(own.productId, '200');
  assert.equal(own.productHandle, 'soap-rose');
  assert.deepEqual(own.extraProducts, [
    { productId: '201', handle: 'soap-lavender', title: 'Lavender', variantScope: 'selected', allowedVariantIds: ['2011', '2012'] },
    { productId: '202', handle: '', title: 'Mint', variantScope: 'all', allowedVariantIds: [] },
  ]);

  assert.deepEqual((await get('201')).packs.map((p) => p.id), [2], 'a page the merchant chose');
  assert.deepEqual((await get('300')).packs.map((p) => p.id), [2]);
  assert.deepEqual((await get('20')).packs, [], '20 never matches ,201,');
  assert.deepEqual((await get('202')).packs, [], 'an extra product is not a page unless it was chosen in "show on"');
  assert.deepEqual((await get('100')).packs.map((p) => p.id), [1], 'old packs are unchanged');
});

test('a pack is only offered while the checkout discount config holds its current version', async () => {
  await verify({ 1: 1 }); // pack 2 missing from the verified list
  assert.deepEqual((await get('201')).packs, [], 'unverified = not shown, also on a show-on page');
  assert.equal((await get('201')).reason, 'discount_unverified');
  await verify({ 1: 1, 2: 1 });
  assert.equal((await get('201')).packs.length, 1);
});

test('a same-variant pack never exposes extra products', async () => {
  await addPack(3, '400', '4001', { template: 'same_variant', pack_type: 'same_variant', variant_scope: 'selected', allowed_variant_ids_json: '["4001"]', extra_products_json: JSON.stringify([{ productId: '401', variantScope: 'all' }]) });
  await verify({ 1: 1, 2: 1, 3: 1 });
  assert.deepEqual((await get('400')).packs[0].extraProducts, []);
});
