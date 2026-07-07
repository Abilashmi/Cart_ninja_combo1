import { authenticate } from '../shopify.server';
import { checkAndConsumeCredit } from '../services/ai-credits.server';

const EXTRACTION_PROMPT = `You are extracting Shopify discount details from a merchant's chat message.
Extract:
- code: the discount code/name (a short word or code, e.g. "SUMMER20")
- percentage: the percent off, as a plain number 0-100 (e.g. 20 for "20% off")
Optionally, ONLY if clearly mentioned:
- minimumAmount: minimum order amount required, as a plain number
- endDate: an ISO 8601 date string if they mention an expiry/end date
- usageLimit: total number of times the code can be used, as an integer
- onePerCustomer: true if they say each customer can only use it once

Reply with ONLY JSON, no prose. Omit any optional field not mentioned.
If you cannot identify a code or a percentage at all, reply {"unclear":true}.`;

function parseJsonReply(text) {
  const stripped = String(text || '').replace(/```json|```/gi, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    return { unclear: true };
  }
}

async function callExtractionLlm(message) {
  const apiKey = process.env.OPENAI_API_KEY || '';
  const isNvidia = apiKey.startsWith('nvapi-');
  const endpoint = isNvidia
    ? 'https://integrate.api.nvidia.com/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const model = isNvidia ? 'meta/llama-3.1-8b-instruct' : 'gpt-4o-mini';

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: message },
      ],
      max_tokens: 150,
      temperature: 0,
    }),
  });

  if (!res.ok) return { unclear: true };
  const data = await res.json();
  return parseJsonReply(data.choices?.[0]?.message?.content);
}

function stillNeeded(code, percentage) {
  if (code && percentage != null) return null;
  return !code ? (percentage == null ? 'both' : 'code') : 'percentage';
}

// Mirrors app.discounts.create.jsx's "amount_off_order" mutation input exactly
// (percent off the whole order, applies to all products, doesn't combine with
// other discounts, starts now) so a chat-created discount is indistinguishable
// from a manually-created one in Shopify and in app.discount.jsx's list.
async function createDiscount(admin, { code, percentage, minimumAmount, endDate, usageLimit, onePerCustomer }) {
  const discountInput = {
    title: code,
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

async function persistLocalCopy(request, shop, { code, percentage, minimumAmount, endDate, usageLimit, onePerCustomer, discountId }) {
  try {
    const apiUrl = new URL('/api/create_coupon-sample', request.url).href;
    await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopDomain: shop,
        shopify_id: discountId,
        code,
        title: code,
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

export async function action({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    const { message, resolvedCode, resolvedPercentage } = await request.json();
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

    if (code && percentage != null) {
      const result = await createDiscount(admin, {
        code, percentage,
        minimumAmount: extracted.minimumAmount,
        endDate: extracted.endDate,
        usageLimit: extracted.usageLimit,
        onePerCustomer: extracted.onePerCustomer,
      });
      if (!result.success) {
        return Response.json({ status: 'clarify', message: `Couldn't create that discount: ${result.error}. Try a different code.`, needFields: 'code', resolvedPercentage: percentage, credits });
      }
      await persistLocalCopy(request, shop, {
        code, percentage,
        minimumAmount: extracted.minimumAmount, endDate: extracted.endDate,
        usageLimit: extracted.usageLimit, onePerCustomer: extracted.onePerCustomer,
        discountId: result.discountId,
      });
      return Response.json({ status: 'saved', code, percentage, credits });
    }

    if (extracted.unclear && !code && percentage == null) {
      return Response.json({
        status: 'clarify',
        message: 'What should the discount code be, and what percentage off? (e.g. "SUMMER20, 20% off")',
        needFields: 'both',
        credits,
      });
    }

    const need = stillNeeded(code, percentage);
    return Response.json({
      status: 'clarify',
      message: need === 'percentage'
        ? `Got it — code is "${code}". What percentage off?`
        : `Got it — ${percentage}% off. What should the discount code be?`,
      needFields: need,
      resolvedCode: code,
      resolvedPercentage: percentage,
      credits,
    });
  } catch (e) {
    console.error('[api.ai-agent.discount-turn]', e);
    return Response.json({ status: 'error', message: 'Something went wrong. Please try again.' });
  }
}
