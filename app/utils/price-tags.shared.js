/**
 * Price tags in the COD and Buy it now button texts — pure, so cod.shared.js
 * and product-payment.shared.js can both use it (partial-cod.shared.js has no
 * imports of its own).
 */
import { partialCodTagAmount } from './partial-cod.shared.js';

// Price tags merchants can put in a COD or Buy it now button's text, filled in
// for the shopper with the live price ({{tag}} works too):
//   {price}          the product, cart or combo price
//   {cod_fee}        the COD fee
//   {cod_price}      price + COD fee
//   {prepaid_price}  price after the prepaid discount
//   {saving}         what the prepaid discount saves
//   {partial_cod_amount}  what Partial COD takes now (partialCodTagAmount;
//                    the whole amount when part payment isn't offered)
// Mirrored by extensions/cart-drawer/assets/brix_cod.js priceTags().
export const COD_PRICE_TAGS = ['price', 'cod_fee', 'cod_price', 'prepaid_price', 'saving', 'partial_cod_amount'];
const PRICE_TAG = /\{\{?\s*(price|cod_fee|cod_price|prepaid_price|saving|partial_cod_amount)\s*\}?\}/g;

export function hasPriceTags(template) {
  return new RegExp(PRICE_TAG.source).test(String(template || ''));
}

/** The text already shows the COD fee ({cod_fee} or {cod_price}), so the "+₹40 COD fee" line under the button is left out. */
export function showsCodFee(template) {
  return /\{\{?\s*(cod_fee|cod_price)\s*\}?\}/.test(String(template || ''));
}

/**
 * Fill the price tags in `template`. `values` = { price, cod_fee, cod_price,
 * prepaid_price, saving } (numbers; a missing one becomes empty), `format`
 * turns a number into money text.
 */
export function fillPriceTags(template, values, format) {
  return String(template || '')
    .replace(PRICE_TAG, (all, key) => {
      const n = values?.[key];
      return n == null || !Number.isFinite(Number(n)) ? '' : format(Number(n));
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The tag values for a COD button: `price` (number or null) and the fee
 * actually charged. With the COD `settings`, {partial_cod_amount} is the
 * Partial COD advance; without them it is the COD price.
 */
export function codPriceValues(price, codFee, settings = null) {
  if (price == null || !Number.isFinite(Number(price))) return { cod_fee: codFee };
  const p = Number(price);
  const fee = Number(codFee) || 0;
  const codPrice = Math.round((p + fee) * 100) / 100;
  return { price: p, cod_fee: fee, cod_price: codPrice, partial_cod_amount: settings ? partialCodTagAmount(settings, p, fee) : codPrice };
}

/** The tag values for a Buy it now button, from productPaymentPricing(): every tag, {saving} only when there is one. */
export function paymentPriceValues(pricing) {
  if (!pricing || pricing.subtotal == null) return {};
  return {
    price: pricing.subtotal,
    prepaid_price: pricing.online,
    saving: pricing.savings > 0 ? pricing.savings : null,
    cod_fee: pricing.codFee,
    cod_price: pricing.codTotal,
    partial_cod_amount: pricing.codTotal,
  };
}

/** `format` without ".00" on whole amounts (₹1,299, not ₹1,299.00), as the storefront shows tags. */
export function tagMoney(format) {
  return (n) => (Math.round(Number(n) * 100) % 100 === 0 ? format(n).replace(/[.,]00(?=\D*$)/, '') : format(n));
}
