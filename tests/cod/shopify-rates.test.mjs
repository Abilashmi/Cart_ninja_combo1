// Run with: node --import ./tests/packs/register.mjs --test tests/cod/shopify-rates.test.mjs
// COD shipping from the store's own Shopify rates (settings.shippingMode
// 'shopify'): quoteCod asks draftOrderCalculate for availableShippingRates
// with the shopper's address, offers them as delivery options (cheapest
// first), charges the pick + the COD fee, and refuses an address Shopify
// doesn't ship to. Fake Admin API; checked by hand on a real store that
// Shopify returns rates for a PIN code alone (Trufoods: "Standard ₹0").
import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteCod, shopifyShipping, rateAddress, cleanDeliveryChoice } from '../../app/services/cod.server.js';
import { sanitizeCodSettings, codCharges } from '../../app/utils/cod.shared.js';

const LINES = [{ variantId: '11', quantity: 1, properties: {} }];
const money = (n) => ({ shopMoney: { amount: String(n) } });

// Shopify's rates for an address: Standard ₹60 and Express (2-3 days) ₹120 in
// Tamil Nadu, Standard only elsewhere, nothing for the Andamans PIN 744101.
function ratesFor(address) {
  if (!address || address.zip === '744101') return [];
  const rates = [{ handle: 'h-std', title: 'Standard', price: { amount: '60.0' } }];
  if (address.provinceCode === 'TN') rates.push({ handle: 'h-exp', title: 'Express (2-3 days)', price: { amount: '120.0' } });
  return rates;
}

function fakeAdmin() {
  const calls = [];
  const admin = {
    async graphql(query, { variables } = {}) {
      const reply = (data) => ({ json: async () => data });
      if (query.includes('CodVariants')) {
        return reply({ data: { nodes: [{ id: 'gid://shopify/ProductVariant/11', availableForSale: true, product: { id: 'gid://shopify/Product/1', title: 'Saree', tags: [], status: 'ACTIVE' } }] } });
      }
      if (query.includes('CodCalculate')) {
        const input = variables.input;
        const withRates = query.includes('availableShippingRates');
        calls.push({ input, withRates });
        const ship = Number(input.shippingLine?.priceWithCurrency?.amount ?? input.shippingLine?.price ?? 0);
        return reply({ data: { draftOrderCalculate: { userErrors: [], calculatedDraftOrder: {
          currencyCode: 'INR', taxesIncluded: true, discountCodes: [],
          ...(withRates ? { availableShippingRates: ratesFor(input.shippingAddress) } : {}),
          lineItems: [{ name: 'Saree', title: 'Saree', quantity: 1, originalTotalSet: money(999), discountedTotalSet: money(999), variant: { id: 'gid://shopify/ProductVariant/11' }, product: { id: 'gid://shopify/Product/1' } }],
          lineItemsSubtotalPrice: money(999), subtotalPriceSet: money(999), totalDiscountsSet: money(0),
          totalShippingPriceSet: money(ship), totalTaxSet: money(0), totalPriceSet: money(999 + ship),
        } } } });
      }
      throw new Error(`unexpected query ${query.slice(0, 60)}`);
    },
  };
  return { admin, calls };
}

const settings = (patch = {}) => sanitizeCodSettings({ enabled: true, shippingMode: 'shopify', shippingFee: 75, codFeeEnabled: true, codFee: 40, ...patch });
const CHENNAI = { pincode: '600004', city: 'Chennai', state: 'Tamil Nadu' };

test('rates → options: cheapest first, one per name, ids the order route accepts', () => {
  const ship = shopifyShipping([
    { title: 'Express (2-3 days)', price: { amount: '120.0' } },
    { title: 'Standard', price: { amount: '60.0' } },
    { title: 'Standard', price: { amount: '80.0' } },
    { title: '', price: { amount: '10' } },
    { title: 'Free over ₹999', price: { amount: '0.0' } },
  ]);
  assert.deepEqual(ship.options.map((o) => [o.name, o.price, o.free]), [['Free over ₹999', 0, true], ['Standard', 60, false], ['Express (2-3 days)', 120, false]]);
  assert.equal(ship.selected.name, 'Free over ₹999', 'the cheapest is picked first');
  for (const o of ship.options) assert.equal(cleanDeliveryChoice({ option: o.id }).option, o.id, `${o.id} survives the order route's check`);
  const picked = shopifyShipping([{ title: 'Standard', price: { amount: '60' } }, { title: 'Express (2-3 days)', price: { amount: '120' } }], { option: 's-express-2-3-days' });
  assert.equal(picked.selected.name, 'Express (2-3 days)');
  const gone = shopifyShipping([{ title: 'Standard', price: { amount: '60' } }], { option: 's-express-2-3-days' });
  assert.equal(gone.choiceError, 'option');
  assert.equal(gone.selected.name, 'Standard');
});

test('rate address: PIN code always; city and state code with Shopify rates', () => {
  assert.deepEqual(rateAddress(CHENNAI), { countryCode: 'IN', zip: '600004' });
  assert.deepEqual(rateAddress(CHENNAI, true), { countryCode: 'IN', zip: '600004', city: 'Chennai', provinceCode: 'TN' });
});

test('quote: Shopify\'s rates for the address as delivery options; the pick + COD fee charged', async () => {
  const { admin, calls } = fakeAdmin();
  const { quote, input } = await quoteCod(admin, { settings: settings(), lines: LINES, surface: 'product', destination: CHENNAI });
  assert.equal(calls[0].withRates, true, 'rates asked for with the address');
  assert.deepEqual(calls[0].input.shippingAddress, { countryCode: 'IN', zip: '600004', city: 'Chennai', provinceCode: 'TN' });
  assert.deepEqual(quote.delivery.options.map((o) => [o.name, o.price]), [['Standard', 60], ['Express (2-3 days)', 120]]);
  assert.equal(quote.delivery.selected, 's-standard');
  assert.equal(quote.shipping, 60, 'Shopify\'s Standard, not the old one-price ₹75');
  assert.equal(quote.codFee, 40);
  assert.equal(Number(input.shippingLine.priceWithCurrency?.amount ?? input.shippingLine.price), 100, 'one shipping line: rate + COD fee');
  assert.match(input.shippingLine.title, /^Standard/);

  const express = await quoteCod(admin, { settings: settings(), lines: LINES, surface: 'product', destination: CHENNAI, delivery: { option: 's-express-2-3-days' } });
  assert.equal(express.quote.shipping, 120);
  assert.equal(express.quote.delivery.selected, 's-express-2-3-days');
});

test('quote: no Shopify rate for the address = COD not offered; a vanished pick on the order = re-check', async () => {
  const { admin } = fakeAdmin();
  await assert.rejects(quoteCod(admin, { settings: settings(), lines: LINES, surface: 'product', destination: { pincode: '744101' } }), { code: 'no_delivery_option' });
  await assert.rejects(quoteCod(admin, {
    settings: settings(), lines: LINES, surface: 'product', destination: { pincode: '110001', city: 'Delhi', state: 'Delhi' },
    delivery: { option: 's-express-2-3-days' }, strictDelivery: true,
  }), { code: 'delivery_changed' });
});

test('before the address: no rates asked, no shipping (never the old one-price setting)', async () => {
  const { admin, calls } = fakeAdmin();
  const { quote } = await quoteCod(admin, { settings: settings(), lines: LINES, surface: 'product' });
  assert.equal(calls.every((c) => !c.withRates), true);
  assert.equal(quote.shipping, 0);
  assert.equal(quote.delivery, null);
  assert.equal(codCharges(settings(), 999).shipping, 0, 'admin previews too');
  assert.equal(codCharges(settings({ shippingMode: 'simple' }), 999).shipping, 75, 'one-price shipping unchanged');
});

test('other modes never ask Shopify for rates', async () => {
  const { admin, calls } = fakeAdmin();
  await quoteCod(admin, { settings: settings({ shippingMode: 'simple' }), lines: LINES, surface: 'product', destination: CHENNAI });
  assert.equal(calls.some((c) => c.withRates), false);
  assert.deepEqual(calls[0].input.shippingAddress, { countryCode: 'IN', zip: '600004' }, 'address as before');
});
