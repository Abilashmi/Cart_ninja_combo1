// BRIX Partial COD: the Shopify checkout of a Partial COD order carries the
// _brix_partial_cod cart attribute (brix_cod.js partialCheckoutUrl). Its
// one-time code leaves only the advance to pay, and that advance must be paid
// online, so Cash on Delivery is hidden there. Every other checkout is left
// exactly as it is.

const NO_CHANGES = { operations: [] };

// Manual "Cash on Delivery (COD)" methods and the usual names stores give them.
// Not "Cashfree" and other online gateways: only "... on delivery" or a whole-word COD.
const COD_NAME = /(cash|collect|pay(ment)?)\s*on\s*delivery|\bc\.?o\.?d\b/i;

export function cartPaymentMethodsTransformRun(input) {
  const marker = input?.cart?.partialCod?.value;
  if (!marker) return NO_CHANGES;
  const operations = (input.paymentMethods || [])
    .filter((method) => COD_NAME.test(String(method?.name || '')))
    .map((method) => ({ paymentMethodHide: { paymentMethodId: method.id } }));
  return { operations };
}
