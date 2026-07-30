// Shared discount-creation logic, extracted from the old
// api.ai-agent.discount-turn.jsx so the create_discount / delete_discount AI
// tools (ai-agent-tools.server.js) and any future caller share one
// implementation instead of drifting.

export async function getShopCurrencyCode(admin) {
  const res = await admin.graphql(`query { shop { currencyCode } }`);
  const data = await res.json();
  return data?.data?.shop?.currencyCode || 'USD';
}

// Mirrors app.discounts.create.jsx's "amount_off_order" mutation input
// exactly (percent off the whole order, applies to all products, doesn't
// combine with other discounts, starts now) so a chat-created discount is
// indistinguishable from a manually-created one in Shopify and in
// app.discount.jsx's list.
export async function createDiscount(admin, { code, title, percentage, minimumAmount, endDate, usageLimit, onePerCustomer, currencyCode }) {
  const discountInput = {
    title,
    code,
    startsAt: new Date().toISOString(),
    customerSelection: { all: true },
    customerGets: {
      value: { percentage: percentage / 100 },
      items: { all: true },
    },
    appliesOncePerCustomer: !!onePerCustomer,
    combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: false },
  };

  if (usageLimit && Number(usageLimit) > 0) {
    discountInput.usageLimit = Number(usageLimit);
  }
  if (endDate) {
    const d = new Date(endDate);
    if (!Number.isNaN(d.getTime())) discountInput.endsAt = d.toISOString();
  }
  if (minimumAmount && Number(minimumAmount) > 0) {
    discountInput.minimumRequirement = {
      subtotal: { greaterThanOrEqualToSubtotal: { amount: Number(minimumAmount), currencyCode } },
    };
  }

  const res = await admin.graphql(
    `#graphql
    mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode { id }
        userErrors { field message }
      }
    }`,
    { variables: { basicCodeDiscount: discountInput } }
  );
  const data = await res.json();
  const result = data.data?.discountCodeBasicCreate;
  if (result?.userErrors?.length > 0) {
    return { success: false, error: result.userErrors[0].message };
  }
  return { success: true, discountId: result?.codeDiscountNode?.id };
}

export async function deleteDiscount(admin, discountId) {
  const res = await admin.graphql(
    `#graphql
    mutation discountCodeDelete($id: ID!) {
      discountCodeDelete(id: $id) {
        deletedCodeDiscountId
        userErrors { field message }
      }
    }`,
    { variables: { id: discountId } }
  );
  const data = await res.json();
  const result = data.data?.discountCodeDelete;
  if (result?.userErrors?.length > 0) {
    return { success: false, error: result.userErrors[0].message };
  }
  return { success: true, deletedId: result?.deletedCodeDiscountId };
}

// Mirrors this shop's local `create_coupon-sample` mirror write (a separate
// non-Shopify record this app keeps for its own coupon-slider/analytics
// list) — best-effort, failures are logged but never block the real
// Shopify-side discount creation from succeeding.
export async function persistLocalCopy(requestUrl, shop, { code, title, percentage, minimumAmount, endDate, usageLimit, onePerCustomer, discountId }) {
  try {
    const apiUrl = new URL('/api/create_coupon-sample', requestUrl).href;
    await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopDomain: shop,
        shopify_id: discountId,
        code,
        title,
        type: 'amount_off_order',
        valueType: 'percentage',
        value: percentage,
        startDate: new Date().toISOString(),
        endDate: endDate || null,
        selectionType: 'all',
        minimumRequirementValue: minimumAmount ? 'amount' : 'none',
        minimumPurchaseAmount: minimumAmount || 0,
        limitTotalUses: !!usageLimit,
        totalUsesLimit: usageLimit || 0,
        limitOnePerCustomer: !!onePerCustomer,
        combineProduct: false, combineOrder: false, combineShipping: false,
      }),
    });
  } catch (e) {
    console.error('[discounts.server] local cache write failed:', e.message);
  }
}
