import { authenticate } from '../shopify.server';
import { checkAndConsumeCredit } from '../services/ai-credits.server';
import { callLlm, parseJsonReply } from '../services/ai-llm.server';
import { resolveCollectionByName } from '../services/collection-resolver.server';
import { pickFromCandidates } from '../services/upsell-rules.server';
import { checkComboPlanGate, createComboTemplate } from '../services/combo-templates.server';

// This codebase has no distinct "bundle type" field — FBT/Fixed/Mix&Match/
// Volume-Discount language all map onto one of these 3 layouts (the only 3
// in TEMPLATE_CATALOGUE; layout3's hero/countdown variant is excluded from
// v1 chat-driven creation as too complex) plus a collection + discount.
const LAYOUT_CHOICES = [
  { label: 'Guided Architect (step-by-step)', value: 'layout1' },
  { label: 'Velocity Stream (tab switcher)', value: 'layout2' },
  { label: 'Editorial Split (single grid)', value: 'layout4' },
];
const LAYOUT_LABELS = Object.fromEntries(LAYOUT_CHOICES.map(c => [c.value, c.label]));

const DISCOUNT_CHOICES = [
  { label: '10% off', value: '10' },
  { label: '20% off', value: '20' },
  { label: 'No discount', value: 'none' },
];

const CONFIRM_CHOICES = [
  { label: '✅ Confirm', value: '__confirm__' },
  { label: '✖ Cancel', value: '__cancel__' },
];

const EXTRACTION_PROMPT = `You are extracting bundle/combo setup details from a Shopify merchant's chat
reply. Extract any of the following the merchant clearly stated:
- layout: one of "layout1" (step-by-step guided), "layout2" (tab switcher), "layout4" (single grid) — infer from words like "step by step"/"guided" (layout1), "tabs"/"switch" (layout2), "simple"/"single grid"/"editorial" (layout4)
- collectionName: the name of a product collection they mentioned
- discountPercentage: a plain number 0-100 if they mentioned a discount percentage, or 0 if they said no discount
- templateName: a name/title for the bundle page, if given
Reply with ONLY JSON containing whichever fields you found. If you found nothing usable, reply {"unclear":true}.`;

async function extractDetails(message) {
  const text = await callLlm([
    { role: 'system', content: EXTRACTION_PROMPT },
    { role: 'user', content: message },
  ], { maxTokens: 120, temperature: 0 });
  return parseJsonReply(text);
}

function normalizeLayout(v) {
  const s = String(v || '').toLowerCase();
  if (LAYOUT_CHOICES.some(c => c.value === s)) return s;
  if (/step|guided/.test(s)) return 'layout1';
  if (/tab|switch|velocity/.test(s)) return 'layout2';
  if (/grid|simple|editorial|single/.test(s)) return 'layout4';
  return null;
}
function normalizeDiscount(v) {
  const s = String(v ?? '').toLowerCase().trim();
  if (s === 'none' || s === 'no' || s === 'no discount' || s === '0') return 0;
  const n = Number(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

function collectionField(layout) {
  return layout === 'layout1' ? 'step_1_collection' : 'col_1';
}

function confirmSummary(slots) {
  const discountText = slots.discountPercentage > 0 ? `, ${slots.discountPercentage}% off` : '';
  return `I'll create "${slots.templateName}" using the ${LAYOUT_LABELS[slots.layout]} layout with the ${slots.collectionTitle} collection${discountText}. Shall I create this?`;
}

// Which single slot the next question targets — drives both the prompt text
// shown to the merchant and which field a plain free-text reply fills in.
function openSlot(slots) {
  if (!slots.layout) return 'layout';
  if (!slots.collectionId) return 'collection';
  if (slots.discountPercentage == null) return 'discount';
  if (!slots.templateName) return 'templateName';
  return null;
}

function askFor(slot) {
  if (slot === 'layout') return { message: 'What kind of bundle would you like — Guided Architect (step-by-step), Velocity Stream (tab switcher), or Editorial Split (single grid)?', choices: LAYOUT_CHOICES };
  if (slot === 'collection') return { message: 'Which collection should this bundle pull products from? (type the exact collection name)' };
  if (slot === 'discount') return { message: 'Would you like to offer a discount — 10% off, 20% off, or none?', choices: DISCOUNT_CHOICES };
  if (slot === 'templateName') return { message: 'What should I name this bundle page?' };
  return null;
}

export async function action({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    const { message, slots: incomingSlots, finalize, ambiguousCandidates } = await request.json();
    const slots = { ...(incomingSlots || {}) };

    if (finalize) {
      const gateError = await checkComboPlanGate(shop);
      if (gateError) return Response.json({ status: 'locked', message: gateError.error });

      const credit = await checkAndConsumeCredit(shop, admin);
      const credits = { remaining: credit.remaining, limit: credit.limit, isOverage: credit.isOverage };

      const overrides = {
        layout: slots.layout,
        [collectionField(slots.layout)]: slots.collectionHandle,
        collection_title: slots.templateName,
      };
      if (slots.discountPercentage > 0) {
        overrides.has_discount_offer = true;
        overrides.discount_percentage = slots.discountPercentage;
      }

      const newId = await createComboTemplate(shop, {
        name: slots.templateName,
        template_type: slots.layout,
        status: 'draft',
        is_active: 0,
        customization_data: JSON.stringify(overrides),
      });

      return Response.json({ status: 'saved', id: newId, slots, credits });
    }

    if (!message) return Response.json({ status: 'error', message: 'No message provided' }, { status: 400 });

    const credit = await checkAndConsumeCredit(shop, admin);
    const credits = { remaining: credit.remaining, limit: credit.limit, isOverage: credit.isOverage };

    // A prior turn flagged an ambiguous collection match — resolve this
    // reply against that candidate list first, same pattern as upsell-rule-turn.
    if (Array.isArray(ambiguousCandidates) && ambiguousCandidates.length > 0) {
      const picked = pickFromCandidates(message, ambiguousCandidates);
      if (!picked) {
        return Response.json({
          status: 'clarify',
          message: `I'm not sure which one you mean — reply with the exact name: ${ambiguousCandidates.map(c => c.title).join(', ')}.`,
          slots, ambiguousCandidates, credits,
        });
      }
      slots.collectionId = picked.id;
      slots.collectionTitle = picked.title;
      slots.collectionHandle = picked.handle;
    } else {
      const slot = openSlot(slots);

      // Choice-chip clicks send their `value` verbatim — try a direct match
      // against the currently-open closed-set slot before spending an LLM call.
      let handled = false;
      if (slot === 'layout') {
        const direct = normalizeLayout(message);
        if (direct) { slots.layout = direct; handled = true; }
      } else if (slot === 'discount') {
        const direct = normalizeDiscount(message);
        if (direct != null) { slots.discountPercentage = direct; handled = true; }
      }

      if (!handled && slot === 'collection') {
        // Try the raw reply as a collection title directly first — the
        // common case is the merchant just typing the exact name.
        const r = await resolveCollectionByName(admin, message);
        if (r.status === 'found') {
          slots.collectionId = r.id; slots.collectionTitle = r.title; slots.collectionHandle = r.handle;
          handled = true;
        } else if (r.status === 'ambiguous') {
          return Response.json({
            status: 'clarify',
            message: `A few collections match "${message}": ${r.candidates.map(c => c.title).join(', ')}. Which one did you mean?`,
            slots, ambiguousCandidates: r.candidates, credits,
          });
        }
      } else if (!handled && slot === 'templateName') {
        slots.templateName = message.trim().slice(0, 80);
        handled = true;
      }

      if (!handled) {
        const extracted = await extractDetails(message);
        if (!slots.layout && extracted.layout) slots.layout = normalizeLayout(extracted.layout) || slots.layout;
        if (slots.discountPercentage == null && extracted.discountPercentage != null) {
          const d = normalizeDiscount(extracted.discountPercentage);
          if (d != null) slots.discountPercentage = d;
        }
        if (!slots.templateName && extracted.templateName) {
          slots.templateName = String(extracted.templateName).trim().slice(0, 80);
        }
        if (!slots.collectionId && extracted.collectionName) {
          const r = await resolveCollectionByName(admin, extracted.collectionName);
          if (r.status === 'found') {
            slots.collectionId = r.id; slots.collectionTitle = r.title; slots.collectionHandle = r.handle;
          } else if (r.status === 'ambiguous') {
            return Response.json({
              status: 'clarify',
              message: `A few collections match "${extracted.collectionName}": ${r.candidates.map(c => c.title).join(', ')}. Which one did you mean?`,
              slots, ambiguousCandidates: r.candidates, credits,
            });
          } else {
            return Response.json({
              status: 'clarify',
              message: `I couldn't find a collection matching "${extracted.collectionName}" — try the exact collection title.`,
              slots, credits,
            });
          }
        }
      }
    }

    const next = askFor(openSlot(slots));
    if (next) {
      return Response.json({ status: 'ask', message: next.message, choices: next.choices, slots, credits });
    }

    return Response.json({ status: 'confirm', message: confirmSummary(slots), choices: CONFIRM_CHOICES, slots, credits });
  } catch (e) {
    console.error('[api.ai-agent.combo-turn]', e);
    return Response.json({ status: 'error', message: 'Something went wrong. Please try again.' });
  }
}
