import { authenticate } from '../shopify.server';
import { checkAndConsumeCredit } from '../services/ai-credits.server';
import { callLlmWithMeta } from '../services/ai-llm.server';
import { guardChatReply } from '../services/ai-safety.server';

const SYSTEM_PROMPT = `You are Brix, an AI assistant built into the Brix cart drawer app for Shopify merchants. You talk like an experienced, friendly Shopify consultant — confident and helpful, never robotic, never a wall of rules recited back at the merchant.

You help with questions about the cart drawer, upsells, progress bars, discounts, bundles, and analytics. But in this conversation you can only write a reply — you have no ability to change any setting or create anything here, and nothing you say is executed against the merchant's store. Keep that boundary honest no matter how the request is phrased:

1. Never say or imply you enabled, created, configured, updated, applied, fixed, or turned on/off anything — you did not and cannot. If asked to do something, say plainly you can't perform actions here, and point to the exact next step (e.g. "try sending 'Enable Upsells' as its own message" or "open Cart Editor > Upsells").
2. Never promise future action ("I'll set this up", "I'll notify you", "I'll keep monitoring", "I'll follow up"). Nothing happens after this reply on its own.
3. Never state specific store data you were not given in this conversation — revenue, order counts, product/customer names, installed apps, or which features are currently on. You have no live access to the store. Say you don't have that information and suggest where to check (e.g. the Analytics page).
4. Never state a specific date, version, or "as of" fact you're not certain of, including your own knowledge cutoff or today's date. If unsure, say you don't know.
5. If a request is missing details needed to act on it (e.g. "create a campaign" — which collection, discount, schedule, audience?), ask a short clarifying question. Never guess and never claim it's done.
6. Match your confidence to your wording: state things plainly only when sure; say "based on the available information" when partly sure; say you're not confident enough when you're not.
7. Write like a person, not a report: short paragraphs, plain sentences, no filler, no repeating the question back. Reach for a bullet list only when the content is genuinely a list.
8. Use markdown for real emphasis — **bold** a feature name or key number, use headings/lists when they aid scanning — but don't decorate every sentence.`;

const MAX_TOKENS = 600;
const MAX_CONTINUATIONS = 1; // one automatic follow-up call, not real token streaming

// Handles the small model's output cap on a single user request: if the
// reply is cut off mid-way (finish_reason "length"), automatically ask the
// model to continue instead of handing back a truncated sentence. Bounded
// to MAX_CONTINUATIONS so one user message can never trigger unbounded
// LLM calls.
async function getFullReply(chatMessages) {
  const convo = [...chatMessages];
  let { content, finishReason, errorStatus } = await callLlmWithMeta(convo, { maxTokens: MAX_TOKENS, temperature: 0.7 });
  if (content == null) return { text: null, errorStatus };

  let fullText = content;
  let continuations = 0;
  while (finishReason === 'length' && continuations < MAX_CONTINUATIONS) {
    continuations++;
    convo.push({ role: 'assistant', content });
    convo.push({ role: 'user', content: 'Continue exactly where you left off. Do not repeat anything already said.' });
    const next = await callLlmWithMeta(convo, { maxTokens: MAX_TOKENS, temperature: 0.7 });
    if (next.content == null) break;
    content = next.content;
    finishReason = next.finishReason;
    fullText += `\n\n**(continued)**\n${content}`;
  }
  // Still truncated after the one allowed continuation — say so rather than
  // silently handing back text that stops mid-word.
  if (finishReason === 'length') fullText += '\n\n_(Reply was cut short — ask "continue" for more.)_';

  return { text: fullText, errorStatus: null };
}

export async function action({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const { message, messages: history = [] } = await request.json();
    if (!message) return Response.json({ success: false, error: 'No message provided' }, { status: 400 });

    const credit = await checkAndConsumeCredit(session.shop, admin);
    const credits = { remaining: credit.remaining, limit: credit.limit, isOverage: credit.isOverage };

    const chatMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.slice(-6).map(m => ({ role: m.role === 'agent' ? 'assistant' : 'user', content: m.text })),
      { role: 'user', content: message },
    ];

    const { text, errorStatus } = await getFullReply(chatMessages);
    if (text == null) {
      const message = errorStatus
        ? `Brix's AI service returned an error (HTTP ${errorStatus}) — this is usually temporary, try again in a minute.`
        : 'I couldn\'t reach the AI service just now — try again in a moment.';
      return Response.json({ success: true, message, credits });
    }

    return Response.json({ success: true, message: guardChatReply(text), credits });
  } catch (e) {
    console.error('[api.ai.chat]', e);
    return Response.json({ success: true, message: `Something went wrong${e.message ? `: ${e.message}` : ''}. Please try again.` });
  }
}
