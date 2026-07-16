import { authenticate } from '../shopify.server';
import { checkAndConsumeCredit } from '../services/ai-credits.server';
import { callLlm, parseJsonReply } from '../services/ai-llm.server';

const EXTRACTION_PROMPT = `You are extracting Shopify discount details from a merchant's chat message.
Extract:
- code: the discount code (a short word or code, e.g. "SUMMER20")
- percentage: the percent off, as a plain number 0-100 (e.g. 20 for "20% off")
- title: the coupon's internal display name/title, ONLY if the merchant clearly gives one separate from the code (e.g. "call it Summer Sale", "name it 10% Off Storewide"). Do NOT copy the code into title — leave it out if no distinct name was given.
Optionally, ONLY if clearly mentioned:
- minimumAmount: minimum order amount required, as a plain number
- endDate: an ISO 8601 date string if they mention an expiry/end date
- usageLimit: total number of times the code can be used, as an integer
- onePerCustomer: true if they say each customer can only use it once

Reply with ONLY JSON, no prose. Omit any optional field not mentioned.
If you cannot identify a code or a percentage at all, reply {"unclear":true}.`;

// Coupon Name/Title must never be left blank — if the merchant never gives one,
// synthesize a meaningful default from the percentage (e.g. "10% Off Storewide")
// rather than falling back to the code as a title.
function defaultTitle(percentage) {
  return `${percentage}% Off Storewide`;
}

async function callExtractionLlm(message) {
  const text = await callLlm([
    { role: 'system', content: EXTRACTION_PROMPT },
    { role: 'user', content: message },
  ], { maxTokens: 150, temperature: 0 });
  return parseJsonReply(text);
}

// Mirrors app.discounts.create.jsx's "amount_off_order" mutation input exactly
// (percent off the whole order, applies to all products, doesn't combine with
// other discounts, starts now) so a chat-created discount is indistinguishable
// from a manually-created one in Shopify and in app.discount.jsx's list.
async function createDiscount(admin, { code, title, percentage, minimumAmount, endDate, usageLimit, onePerCustomer }) {
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
      subtotal: { greaterThanOrEqualToSubtotal: { amount: Number(minimumAmount), currencyCode: 'INR' } },
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

async function persistLocalCopy(request, shop, { code, title, percentage, minimumAmount, endDate, usageLimit, onePerCustomer, discountId }) {
  try {
    const apiUrl = new URL('/api/create_coupon-sample', request.url).href;
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
    console.error('[api.ai-agent.discount-turn] local cache write failed:', e.message);
  }
}

const CONFIRM_CHOICES = [
  { label: '✅ Confirm', value: '__confirm__' },
  { label: '✖ Cancel', value: '__cancel__' },
];

function confirmSummary({ code, title, percentage, minimumAmount, endDate, usageLimit, onePerCustomer }) {
  const extras = [];
  if (minimumAmount) extras.push(`min. order ₹${minimumAmount}`);
  if (endDate) extras.push(`ends ${endDate}`);
  if (usageLimit) extras.push(`limit ${usageLimit} uses`);
  if (onePerCustomer) extras.push('one per customer');
  const extraText = extras.length ? ` (${extras.join(', ')})` : '';
  return `I'll create "${title}" — code "${code}" for ${percentage}% off${extraText}. Shall I create this?`;
}

export async function action({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    const { message, resolvedCode, resolvedTitle, resolvedPercentage, resolvedExtras, finalize } = await request.json();

    if (finalize) {
      const credit = await checkAndConsumeCredit(shop, admin);
      const credits = { remaining: credit.remaining, limit: credit.limit, isOverage: credit.isOverage };
      const extras = resolvedExtras || {};
      const title = resolvedTitle || defaultTitle(resolvedPercentage);
      const result = await createDiscount(admin, { code: resolvedCode, title, percentage: resolvedPercentage, ...extras });
      if (!result.success) {
        return Response.json({ status: 'clarify', message: `Couldn't create that discount: ${result.error}. Try a different code.`, needFields: 'code', resolvedTitle: title, resolvedPercentage, credits });
      }
      await persistLocalCopy(request, shop, {
        code: resolvedCode, title, percentage: resolvedPercentage, ...extras, discountId: result.discountId,
      });
      return Response.json({ status: 'saved', code: resolvedCode, title, percentage: resolvedPercentage, credits });
    }

    if (!message) return Response.json({ status: 'error', message: 'No message provided' }, { status: 400 });

    const credit = await checkAndConsumeCredit(shop, admin);
    const credits = { remaining: credit.remaining, limit: credit.limit, isOverage: credit.isOverage };

    const extracted = await callExtractionLlm(message);

    let code = resolvedCode || null;
    if (extracted.code && !code) code = String(extracted.code).trim().toUpperCase();

    let percentage = resolvedPercentage ?? null;
    if (extracted.percentage != null && percentage == null) {
      const n = Number(extracted.percentage);
      if (Number.isFinite(n) && n > 0 && n <= 100) percentage = n;
    }

    let title = resolvedTitle || null;
    if (extracted.title && !title) title = String(extracted.title).trim();

    const extras = {
      minimumAmount: extracted.minimumAmount, endDate: extracted.endDate,
      usageLimit: extracted.usageLimit, onePerCustomer: extracted.onePerCustomer,
    };

    // Code + percentage known: the Coupon Name is required before creating,
    // but never blocks on it — synthesize a sensible default instead of asking.
    if (code && percentage != null) {
      if (!title) title = defaultTitle(percentage);
      return Response.json({
        status: 'confirm',
        message: confirmSummary({ code, title, percentage, ...extras }),
        choices: CONFIRM_CHOICES,
        resolvedCode: code,
        resolvedTitle: title,
        resolvedPercentage: percentage,
        resolvedExtras: extras,
        credits,
      });
    }

    if (extracted.unclear && !code && percentage == null) {
      return Response.json({
        status: 'clarify',
        message: 'What should the discount code be, and what percentage off? (e.g. "SUMMER20, 20% off")',
        needFields: 'both',
        credits,
      });
    }

    // Percentage given but no code yet: ask for the coupon name/title and the
    // code together, so both are captured before the coupon is ever created.
    if (percentage != null && !code) {
      return Response.json({
        status: 'clarify',
        message: `Got it — ${percentage}% off. What would you like to name this coupon (Coupon Title), and what should the coupon code be?`,
        needFields: 'codeAndTitle',
        resolvedTitle: title,
        resolvedPercentage: percentage,
        credits,
      });
    }

    return Response.json({
      status: 'clarify',
      message: `Got it — code is "${code}". What percentage off?`,
      needFields: 'percentage',
      resolvedCode: code,
      resolvedTitle: title,
      credits,
    });
  } catch (e) {
    console.error('[api.ai-agent.discount-turn]', e);
    return Response.json({ status: 'error', message: 'Something went wrong. Please try again.' });
  }
}
