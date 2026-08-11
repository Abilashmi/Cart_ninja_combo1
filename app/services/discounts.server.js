// Shared discount-creation logic, extracted from the old
// api.ai-agent.discount-turn.jsx so the create_discount / delete_discount AI
// tools (ai-agent-tools.server.js) and any future caller share one
// implementation instead of drifting.

// Top-level GraphQL `errors` (bad field/argument, permission/scope denial,
// currency mismatch, etc.) are a DIFFERENT failure mode from a mutation's own
// `userErrors` (a business-rule rejection Shopify still executed the query to
// tell you about) — `data.data` is null/undefined when this happens, so
// blindly reading `data.data?.mutationName` silently produces `undefined`
// instead of a real error. Every mutation below must check this first, or a
// genuine failure (e.g. a bad request) gets swallowed into a confusing
// half-success with no discountId — logged here so it's diagnosable from
// server logs rather than a guess.
function checkGraphQLErrors(data, label) {
  if (data.errors?.length > 0) {
    console.error(`[discounts.server] ${label} GraphQL error:`, JSON.stringify(data.errors));
    return data.errors[0].message || 'Shopify rejected the request.';
  }
  return null;
}

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
  const gqlError = checkGraphQLErrors(data, 'createDiscount');
  if (gqlError) return { success: false, error: gqlError };
  const result = data.data?.discountCodeBasicCreate;
  if (result?.userErrors?.length > 0) {
    return { success: false, error: result.userErrors[0].message };
  }
  return { success: true, discountId: result?.codeDiscountNode?.id };
}

// Automatic discounts (discountAutomatic*Create) have no code/customerSelection/
// appliesOncePerCustomer/usageLimit fields — Shopify applies them to every
// checkout that meets the threshold, with nothing for the customer to enter.
// Used for chat-created promotions ("free shipping above ₹2,000"), which read
// as storewide offers rather than a coupon code — createDiscount above stays
// code-based, for explicit "give me a discount code" requests.
export async function createAutomaticFreeShipping(admin, { title, minimumAmount, currencyCode, countries }) {
  const shippingInput = {
    title,
    startsAt: new Date().toISOString(),
    destinationSelection: (countries && countries.length > 0)
      ? { countries: { add: countries } }
      : { all: true },
    combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: false },
  };
  if (minimumAmount && Number(minimumAmount) > 0) {
    shippingInput.minimumRequirement = {
      subtotal: { greaterThanOrEqualToSubtotal: { amount: Number(minimumAmount), currencyCode } },
    };
  }

  const res = await admin.graphql(
    `#graphql
    mutation discountAutomaticFreeShippingCreate($freeShippingAutomaticDiscount: DiscountAutomaticFreeShippingInput!) {
      discountAutomaticFreeShippingCreate(freeShippingAutomaticDiscount: $freeShippingAutomaticDiscount) {
        automaticDiscountNode {
          id
          automaticDiscount {
            ... on DiscountAutomaticFreeShipping { status startsAt summary }
          }
        }
        userErrors { field message }
      }
    }`,
    { variables: { freeShippingAutomaticDiscount: shippingInput } }
  );
  const data = await res.json();
  const gqlError = checkGraphQLErrors(data, 'createAutomaticFreeShipping');
  if (gqlError) return { success: false, error: gqlError };
  const result = data.data?.discountAutomaticFreeShippingCreate;
  if (result?.userErrors?.length > 0) {
    console.error('[discounts.server] createAutomaticFreeShipping userErrors:', JSON.stringify(result.userErrors));
    return { success: false, error: result.userErrors[0].message };
  }
  const node = result?.automaticDiscountNode;
  return {
    success: true,
    discountId: node?.id,
    // The mutation's own response reflects what Shopify actually persisted —
    // this IS the "read it back and verify" step, no extra round trip needed.
    status: node?.automaticDiscount?.status,
    summary: node?.automaticDiscount?.summary,
  };
}

// Same automatic-vs-code distinction as createAutomaticFreeShipping. Supports
// either percentage OR a fixed amount off (exactly one of the two args),
// mirroring app.discounts.create.jsx's amount_off_order branch.
export async function createAutomaticAmountOff(admin, { title, percentage, amountOff, minimumAmount, currencyCode }) {
  const value = (amountOff != null)
    ? { discountAmount: { amount: Number(amountOff), appliesOnEachItem: false } }
    : { percentage: Number(percentage) / 100 };

  const discountInput = {
    title,
    startsAt: new Date().toISOString(),
    customerGets: { value, items: { all: true } },
    combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: false },
  };
  if (minimumAmount && Number(minimumAmount) > 0) {
    discountInput.minimumRequirement = {
      subtotal: { greaterThanOrEqualToSubtotal: { amount: Number(minimumAmount), currencyCode } },
    };
  }

  const res = await admin.graphql(
    `#graphql
    mutation discountAutomaticBasicCreate($automaticBasicDiscount: DiscountAutomaticBasicInput!) {
      discountAutomaticBasicCreate(automaticBasicDiscount: $automaticBasicDiscount) {
        automaticDiscountNode {
          id
          automaticDiscount {
            ... on DiscountAutomaticBasic { status startsAt summary }
          }
        }
        userErrors { field message }
      }
    }`,
    { variables: { automaticBasicDiscount: discountInput } }
  );
  const data = await res.json();
  const gqlError = checkGraphQLErrors(data, 'createAutomaticAmountOff');
  if (gqlError) return { success: false, error: gqlError };
  const result = data.data?.discountAutomaticBasicCreate;
  if (result?.userErrors?.length > 0) {
    console.error('[discounts.server] createAutomaticAmountOff userErrors:', JSON.stringify(result.userErrors));
    return { success: false, error: result.userErrors[0].message };
  }
  const node = result?.automaticDiscountNode;
  return {
    success: true,
    discountId: node?.id,
    status: node?.automaticDiscount?.status,
    summary: node?.automaticDiscount?.summary,
  };
}

// Lists both code and automatic discounts across all three Shopify discount
// types (Basic/Bxgy/FreeShipping) — the same discountNodes query
// api.shopify-coupons.jsx's admin list page already relies on, extended here
// with minimumRequirement so callers can compare thresholds. Single shared
// implementation so the admin discounts list and BRIX's duplicate-check
// tool can never drift apart.
export async function listActiveDiscounts(admin) {
  const query = `#graphql
    query DiscountDashboardList {
      discountNodes(first: 50, reverse: true) {
        edges {
          node {
            id
            discount {
              __typename
              ... on DiscountCodeBasic {
                title status startsAt endsAt summary asyncUsageCount usageLimit
                codes(first: 1) { edges { node { code } } }
                customerGets { value { ... on DiscountPercentage { percentage } ... on DiscountAmount { amount { amount currencyCode } } } }
                minimumRequirement { ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } } }
              }
              ... on DiscountAutomaticBasic {
                title status startsAt endsAt summary asyncUsageCount
                customerGets { value { ... on DiscountPercentage { percentage } ... on DiscountAmount { amount { amount currencyCode } } } }
                minimumRequirement { ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } } }
              }
              ... on DiscountCodeBxgy {
                title status startsAt endsAt summary asyncUsageCount usageLimit
                codes(first: 1) { edges { node { code } } }
              }
              ... on DiscountAutomaticBxgy { title status startsAt endsAt summary asyncUsageCount }
              ... on DiscountCodeFreeShipping {
                title status startsAt endsAt summary asyncUsageCount usageLimit
                codes(first: 1) { edges { node { code } } }
                minimumRequirement { ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } } }
              }
              ... on DiscountAutomaticFreeShipping {
                title status startsAt endsAt summary asyncUsageCount
                minimumRequirement { ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } } }
              }
            }
          }
        }
      }
    }
  `;
  const res = await admin.graphql(query);
  const data = await res.json();
  if (data.errors) return [];

  return (data.data?.discountNodes?.edges || []).map(({ node }) => {
    const d = node.discount;
    const typename = d.__typename;
    const isAutomatic = typename.startsWith('DiscountAutomatic');
    const code = d.codes?.edges?.[0]?.node?.code || '';

    let discountType = 'fixed';
    let discountValue = 0;
    if (d.customerGets?.value) {
      const val = d.customerGets.value;
      if (val.percentage !== undefined) { discountType = 'percentage'; discountValue = Math.round(val.percentage * 100); }
      else if (val.amount) { discountType = 'fixed'; discountValue = parseFloat(val.amount.amount); }
    }
    if (typename === 'DiscountCodeFreeShipping' || typename === 'DiscountAutomaticFreeShipping') { discountType = 'free_shipping'; discountValue = 0; }
    if (typename === 'DiscountCodeBxgy' || typename === 'DiscountAutomaticBxgy') { discountType = 'bxgy'; discountValue = 0; }

    const mr = d.minimumRequirement?.greaterThanOrEqualToSubtotal;

    return {
      id: node.id,
      typename,
      title: d.title,
      code,
      summary: d.summary || '',
      status: d.status || '',
      isAutomatic,
      discountType,
      discountValue,
      minimumSubtotal: mr ? parseFloat(mr.amount) : null,
      currencyCode: mr?.currencyCode || null,
      startsAt: d.startsAt || '',
      endsAt: d.endsAt || '',
      used: d.asyncUsageCount || 0,
      limit: d.usageLimit || null,
    };
  });
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
  const gqlError = checkGraphQLErrors(data, 'deleteDiscount');
  if (gqlError) return { success: false, error: gqlError };
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
