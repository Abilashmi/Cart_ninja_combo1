// Run with: node --test tests/cod/price-tags.test.mjs
// Price tags in the COD and Buy it now button texts ("Buy it for {cod_price} COD"),
// the combo page COD position, and the storefront copy of the tag rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  COD_PRICE_TAGS, hasPriceTags, showsCodFee, fillPriceTags, codPriceValues, paymentPriceValues, tagMoney,
} from '../../app/utils/price-tags.shared.js';
import { sanitizeCodSettings, DEFAULT_COD_SETTINGS, COD_COMBO_PLACEMENTS } from '../../app/utils/cod.shared.js';
import { productPaymentPricing, onlineButtonLabel } from '../../app/utils/product-payment.shared.js';
import { toForm, toSettings } from '../../app/components/cod/codSettingsForm.js';

const rupees = (n) => `₹${n}`;

test('COD button: {price}, {cod_fee} and {cod_price} for a ₹200 product with a ₹100 fee', () => {
  const values = codPriceValues(200, 100);
  assert.equal(fillPriceTags('Buy it for {cod_price} COD', values, rupees), 'Buy it for ₹300 COD');
  assert.equal(fillPriceTags('Buy it for {price} COD', values, rupees), 'Buy it for ₹200 COD');
  assert.equal(fillPriceTags('{price} + {cod_fee} fee', values, rupees), '₹200 + ₹100 fee');
  assert.equal(fillPriceTags('Buy it for {{cod_price}} COD', values, rupees), 'Buy it for ₹300 COD', '{{tag}} works too');
  assert.equal(fillPriceTags('Pay { cod_price } cash', values, rupees), 'Pay ₹300 cash', 'spaces inside the braces');
});

test('COD button: no fee, unknown price, no tags', () => {
  assert.equal(fillPriceTags('Buy it for {cod_price} COD', codPriceValues(200, 0), rupees), 'Buy it for ₹200 COD');
  assert.equal(fillPriceTags('Buy it for {cod_price} COD', codPriceValues(null, 100), rupees), 'Buy it for COD', 'price not known yet: the tag drops out cleanly');
  assert.equal(fillPriceTags('Cash on Delivery', codPriceValues(200, 100), rupees), 'Cash on Delivery');
  assert.equal(fillPriceTags('Pay {total}', codPriceValues(200, 100), rupees), 'Pay {total}', 'unknown tags are left as typed');
});

test('which texts have tags, and which already show the fee', () => {
  assert.deepEqual(COD_PRICE_TAGS, ['price', 'cod_fee', 'cod_price', 'prepaid_price', 'saving']);
  assert.equal(hasPriceTags('Buy {price}'), true);
  assert.equal(hasPriceTags('Buy {{prepaid_price}}'), true);
  assert.equal(hasPriceTags('Cash on Delivery'), false);
  assert.equal(hasPriceTags('Buy {percent}'), false);
  assert.equal(showsCodFee('Buy it for {cod_price} COD'), true);
  assert.equal(showsCodFee('{price} + {{cod_fee}}'), true);
  assert.equal(showsCodFee('Buy it for {price} COD'), false);
});

test('Buy it now: {prepaid_price}, {price}, {saving}; no "· Save 10%" suffix on tagged text', () => {
  const prepaid = { percent: 10, minSubtotal: 0, showBadge: true };
  const pr = productPaymentPricing({ unitPrice: 200, prepaid, codFee: 100 });
  assert.equal(onlineButtonLabel('Buy it now {prepaid_price} Prepaid', pr, prepaid, rupees), 'Buy it now ₹180 Prepaid');
  assert.equal(onlineButtonLabel('Buy it now {price}, save {saving}', pr, prepaid, rupees), 'Buy it now ₹200, save ₹20');
  assert.equal(onlineButtonLabel('Buy it now', pr, prepaid, rupees), 'Buy it now · Save 10%', 'untagged text keeps the old suffix');
  const none = productPaymentPricing({ unitPrice: 200, prepaid: null });
  assert.equal(onlineButtonLabel('Buy it now {prepaid_price} Prepaid', none, null, rupees), 'Buy it now ₹200 Prepaid', 'no discount: the regular price');
  assert.equal(onlineButtonLabel('Save {saving} now', none, null, rupees), 'Save now', 'no saving: {saving} drops out');
  assert.deepEqual(paymentPriceValues(pr), { price: 200, prepaid_price: 180, saving: 20, cod_fee: 100, cod_price: 300 });
});

test('tagMoney drops ".00" from whole amounts only', () => {
  const fmt = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  assert.equal(tagMoney(fmt)(1299), '₹1,299');
  assert.equal(tagMoney(fmt)(1299.5), '₹1,299.50');
});

test('combo page position: below by default (where it always was), replace/above/below only', () => {
  assert.equal(DEFAULT_COD_SETTINGS.comboPlacement, 'below');
  assert.deepEqual(COD_COMBO_PLACEMENTS, ['replace', 'above', 'below']);
  assert.equal(sanitizeCodSettings({}).comboPlacement, 'below');
  assert.equal(sanitizeCodSettings({ comboPlacement: 'replace' }).comboPlacement, 'replace');
  const saved = sanitizeCodSettings({ comboPlacement: 'above' });
  assert.equal(sanitizeCodSettings({ comboPlacement: 'sideways' }, saved).comboPlacement, 'above', 'a bad value keeps the saved one');
  assert.equal(sanitizeCodSettings({ codFee: 10 }, saved).comboPlacement, 'above', 'other saves keep it');
  assert.equal(sanitizeCodSettings({}, { ...DEFAULT_COD_SETTINGS, comboPlacement: undefined }).comboPlacement, 'below', 'settings saved before it existed');
  assert.equal(sanitizeCodSettings(toSettings({ ...toForm(saved), comboPlacement: 'replace' }), saved).comboPlacement, 'replace', 'round-trips through the admin form');
});

test('the storefront (brix_cod.js) uses the same tags, and PHP passes the combo position', () => {
  const js = fs.readFileSync(new URL('../../extensions/cart-drawer/assets/brix_cod.js', import.meta.url), 'utf8');
  const shared = fs.readFileSync(new URL('../../app/utils/price-tags.shared.js', import.meta.url), 'utf8');
  const tagRe = /PRICE_TAG = (\/.*\/g);/;
  assert.equal(tagRe.exec(js)[1], tagRe.exec(shared)[1], 'same tag pattern in both');
  const php = fs.readFileSync(new URL('../../php_backend/cod_storefront.php', import.meta.url), 'utf8');
  assert.match(php, /'comboPlacement' => cods_enum\(\$s\['comboPlacement'\] \?\? '', \['replace', 'above', 'below'\], 'below'\)/);
});
