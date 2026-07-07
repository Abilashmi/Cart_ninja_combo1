import { authenticate } from '../shopify.server';
import { checkAndConsumeCredit } from '../services/ai-credits.server';
import { getShopPlan, canPublishFeature } from '../services/plan-permissions.server';
import { resolveProductByName, pickFromCandidates, appendUpsellRule } from '../services/upsell-rules.server';

function extractionSystemPrompt(needSide) {
  if (needSide === 'trigger') {
    return `You are extracting a single product name from a Shopify merchant's reply. They already
picked the OFFER product; you only need the TRIGGER product (the product that, when added to
cart, causes the upsell to show). Reply with ONLY JSON, no prose:
- {"trigger":"<product name>"} if they named a product
- {"unclear":true} if you cannot tell`;
  }
  if (needSide === 'offer') {
    return `You are extracting a single product name from a Shopify merchant's reply. They already
picked the TRIGGER product; you only need the OFFER product (what to recommend). Reply with
ONLY JSON, no prose:
- {"offer":"<product name>"} if they named a product
- {"unclear":true} if you cannot tell`;
  }
  return `You are extracting an upsell rule from a Shopify merchant's reply: which product should
TRIGGER the upsell (added to cart first), and which product should be OFFERED as the upsell.
A rule is required — both a trigger and an offer product must be identified before this is done.
Reply with ONLY JSON, no prose:
- {"trigger":"<name>","offer":"<name>"} if both are named
- {"trigger":"<name>"} or {"offer":"<name>"} if only one is named
- {"unclear":true} if you cannot tell`;
}

function parseJsonReply(text) {
  const stripped = String(text || '').replace(/```json|```/gi, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    return { unclear: true };
  }
}

async function callExtractionLlm(message, needSide) {
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
        { role: 'system', content: extractionSystemPrompt(needSide) },
        { role: 'user', content: message },
      ],
      max_tokens: 100,
      temperature: 0,
    }),
  });

  if (!res.ok) return { unclear: true };
  const data = await res.json();
  return parseJsonReply(data.choices?.[0]?.message?.content);
}

function stillNeededSide(trigger, offer) {
  if (trigger && offer) return null;
  return trigger ? 'offer' : (offer ? 'trigger' : 'both');
}

export async function action({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    const {
      message, needSide = 'both', resolvedTrigger, resolvedOffer,
      ambiguousSide, ambiguousCandidates,
    } = await request.json();
    if (!message) return Response.json({ status: 'error', message: 'No message provided' }, { status: 400 });

    const planKey = await getShopPlan(shop);
    if (!canPublishFeature(planKey, 'ai_cart_upsell')) {
      return Response.json({ status: 'locked', message: 'Upsell rules need the Starter plan or above.' });
    }

    const credit = await checkAndConsumeCredit(shop, admin);
    const credits = { remaining: credit.remaining, limit: credit.limit, isOverage: credit.isOverage };

    let trigger = resolvedTrigger || null;
    let offer = resolvedOffer || null;

    // A prior turn asked "which one did you mean?" — try to resolve this
    // reply against that exact candidate list before anything else. Product
    // names never made it into this turn's message ("first one", "the
    // second"), so running it through the LLM extraction prompt below would
    // just come back unclear.
    if (ambiguousSide && Array.isArray(ambiguousCandidates) && ambiguousCandidates.length > 0) {
      const picked = pickFromCandidates(message, ambiguousCandidates);
      if (!picked) {
        return Response.json({
          status: 'clarify',
          message: `I'm not sure which one you mean — reply with the exact name: ${ambiguousCandidates.map(c => c.title).join(', ')}.`,
          needSide, resolvedTrigger: trigger, resolvedOffer: offer,
          ambiguousSide, ambiguousCandidates,
          credits,
        });
      }
      if (ambiguousSide === 'trigger') trigger = picked; else offer = picked;

      if (trigger && offer) {
        await appendUpsellRule(shop, {
          triggerProductId: trigger.id, triggerTitle: trigger.title,
          offerProductId: offer.id, offerTitle: offer.title,
        });
        return Response.json({ status: 'saved', trigger, offer, credits });
      }
      const need = stillNeededSide(trigger, offer);
      return Response.json({
        status: 'clarify',
        message: need === 'offer'
          ? `Got it — trigger is "${trigger.title}". What product should it offer?`
          : `Got it — offer is "${offer.title}". Which product should trigger it?`,
        needSide: need, resolvedTrigger: trigger, resolvedOffer: offer, credits,
      });
    }

    const extracted = await callExtractionLlm(message, needSide);

    const clarifyMsgs = [];
    let newAmbiguous = null;

    if (extracted.trigger && !trigger) {
      const r = await resolveProductByName(admin, extracted.trigger);
      if (r.status === 'found') trigger = { id: r.id, title: r.title };
      else if (r.status === 'ambiguous') {
        newAmbiguous = { side: 'trigger', candidates: r.candidates };
        clarifyMsgs.push(`A few products match "${extracted.trigger}": ${r.candidates.map(c => c.title).join(', ')}. Which one did you mean?`);
      } else {
        clarifyMsgs.push(`I couldn't find a product matching "${extracted.trigger}" — try the exact product title.`);
      }
    }
    // Resolved independently of the trigger above — an ambiguous/unfound
    // trigger must not swallow an offer product named in the same message.
    if (extracted.offer && !offer) {
      const r = await resolveProductByName(admin, extracted.offer);
      if (r.status === 'found') offer = { id: r.id, title: r.title };
      else if (r.status === 'ambiguous') {
        if (!newAmbiguous) newAmbiguous = { side: 'offer', candidates: r.candidates };
        clarifyMsgs.push(`A few products match "${extracted.offer}": ${r.candidates.map(c => c.title).join(', ')}. Which one did you mean?`);
      } else {
        clarifyMsgs.push(`I couldn't find a product matching "${extracted.offer}" — try the exact product title.`);
      }
    }

    if (trigger && offer) {
      await appendUpsellRule(shop, {
        triggerProductId: trigger.id, triggerTitle: trigger.title,
        offerProductId: offer.id, offerTitle: offer.title,
      });
      return Response.json({ status: 'saved', trigger, offer, credits });
    }

    if (clarifyMsgs.length > 0) {
      return Response.json({
        status: 'clarify',
        message: clarifyMsgs.join(' '),
        needSide: stillNeededSide(trigger, offer),
        resolvedTrigger: trigger, resolvedOffer: offer,
        ambiguousSide: newAmbiguous?.side, ambiguousCandidates: newAmbiguous?.candidates,
        credits,
      });
    }

    if (extracted.unclear && !trigger && !offer) {
      return Response.json({
        status: 'clarify',
        message: 'I didn\'t catch two products there — tell me which product triggers the upsell and which one to offer (e.g. "Blue Hoodie triggers Wool Socks").',
        needSide: 'both',
        credits,
      });
    }

    const need = stillNeededSide(trigger, offer);
    return Response.json({
      status: 'clarify',
      message: need === 'offer'
        ? `Got it — trigger is "${trigger.title}". What product should it offer?`
        : `Got it — offer is "${offer.title}". Which product should trigger it?`,
      needSide: need,
      resolvedTrigger: trigger,
      resolvedOffer: offer,
      credits,
    });
  } catch (e) {
    console.error('[api.ai-agent.upsell-rule-turn]', e);
    return Response.json({ status: 'error', message: 'Something went wrong. Please try again.' });
  }
}
