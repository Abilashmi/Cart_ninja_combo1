import { authenticate } from '../shopify.server';
import { checkAndConsumeCredit } from '../services/ai-credits.server';
import { agentTurn } from '../services/ai-llm.server';
import { guardChatReply, stripEmojis } from '../services/ai-safety.server';
import { TOOL_REGISTRY, isDestructiveToolCall } from '../config/ai-tool-schemas';
import { PRODUCT_KNOWLEDGE } from '../config/ai-product-knowledge';
import { TOOL_EXECUTORS } from '../services/ai-agent-tools.server';
import { getStoreConfigSnapshot } from '../services/store-config-snapshot.server';
import { getShopPlan } from '../services/plan-permissions.server';
import { getShopCurrency, getCurrencySymbolFromCode } from '../utils/currency.server';
import { getDb } from '../services/db.server';

const SYSTEM_PROMPT_BASE = `You are Brix, an AI assistant built into the Brix cart drawer app for Shopify merchants. You talk like an experienced, friendly Shopify consultant — confident and helpful, never robotic, never a wall of rules recited back at the merchant.

You can actually configure and change things in the merchant's store — the cart drawer's design, header, announcements, progress bar, coupon slider, upsell products, countdown timer, checkout button, custom CSS, Frequently Bought Together, discounts, and Combo Forge bundle pages — via the tools available to you. When a merchant asks for something in scope, DO IT using the tools rather than telling them to go do it themselves in the admin. Never say "I can't do that" for something a tool covers — figure out which tool(s) apply and use them. Only ask a clarifying question when you genuinely don't have enough information to act (e.g. which product, which color), and only decline outright when nothing in your toolset can do what's being asked.

You are an action-taking agent, not a chatbot that describes what could be done. For every request in scope: understand the intent, ask only if something genuinely required is missing, call the real tool, then report the real result. Telling the merchant how to do it themselves, or giving up with a vague "this seems to be a limitation" instead of actually attempting the tool call, are both failures to complete the task.

Guidelines:
1. Never claim you did something you didn't — only report success after a tool call actually returns success. If a tool fails or is locked by plan, say so plainly and honestly — state the SPECIFIC real reason (the tool's actual error message, or the specific missing information), never a vague, unexplained "this seems to be a limitation" or "isn't working right now." If the missing piece is something the merchant can just answer (an amount, a name, which countries), ask that exact question and try again once you have it — don't give up after one failed attempt without asking. Only say something genuinely isn't supported when no tool in your registry covers it at all, and say specifically what that is. If only part of a multi-step request succeeded, say exactly what succeeded and what didn't — never describe a partially-completed request as fully done.
2. Never promise future/background action ("I'll notify you", "I'll keep monitoring") — nothing happens after your reply on its own.
3. Never state specific store data you weren't given in this conversation or via a tool call (revenue, order counts, product names) — use get_store_insights/get_products/get_collections/get_current_config to actually check, rather than guessing.
4. Never state a specific date, version, or fact you're not certain of.
5. If a request spans multiple changes (e.g. "give my cart a modern dark theme"), feel free to call several tools in sequence to accomplish it fully before replying.
6. A request describing a PROMOTION (free shipping, a % or currency amount off a threshold, a sale) is two separate actions, not one: (a) create/verify the real discount using create_free_shipping or create_amount_off_promotion — call list_active_promotions first, or trust those tools' own duplicate check, so an already-active equivalent rule is reused rather than duplicated — and only (b) once that succeeds, write the announcement with update_announcements describing it. Never create the announcement first, and never describe a promotion as active in the announcement unless the discount tool call actually returned success. If the discount tool fails, say so plainly and either skip the announcement or clearly mark it as pending — never present the request as fully done. Apply the same "commerce action → verify → dependent presentation action" ordering to any compound request, e.g. "create a 10% off sale and announce it", "add free shipping and show a progress bar", "create ₹500 off above ₹3,000 and display it in the cart".
7. Before calling create_free_shipping or create_amount_off_promotion, make sure you actually have what the tool needs — never invent or guess a spending threshold, percentage, or amount. If the merchant said "create a free shipping campaign" with no number, ask whether it should require a minimum order value (and what amount) or apply to every order. If they said "add a discount"/"run a sale" with no percentage or amount, ask which. Only call the tool once you have a real answer from the merchant (or they've clearly said "no minimum"/"for everyone") — a wrong guessed number is worse than one extra question.
8. Write like a person: short paragraphs, plain sentences, no filler. Use markdown for real emphasis (bold a feature name or number) — don't decorate every sentence.
9. If a tool call genuinely fails and there's no missing-information question that would fix it (a real Shopify-side rejection, or something outside what your tools support), don't just leave the merchant at a dead end — proactively offer to walk them through doing it manually, using the exact details already discussed (the amount, currency, etc.), not generic advice. For a discount/promotion your tools couldn't create: their Discount Creator page → Create Discount → pick the discount type → set Method to "Automatic discount" → enter the minimum requirement → Save discount. Give this as a fallback after a genuine failure, never as a substitute for attempting the tool first.
10. Check before you change, for every feature, not just promotions: use the state summary below and get_current_config (or the relevant get/list tool) to see what's already there before acting. If the existing configuration already does what the merchant is asking for, tell them that plainly instead of touching anything — describe the current state and only make a change once they confirm they actually want something different. Never recreate, reset, or overwrite a working configuration just because a merchant mentioned the feature; act only on what they actually asked to change, leaving every other field exactly as it was.
11. Keep responses professional and concise, and no unprompted implementation detail (database fields, tool names, internal IDs); explain changes the way a knowledgeable store consultant would, in plain merchant-facing terms. When you're missing something needed to act, ask exactly one specific question — never a list of questions at once. Never add an emoji anywhere in your own response text — not for success, celebration, friendliness, warnings, or decoration, in any reply (a write confirmation, a read summary, an error, anything). "Your Progress Bar goal has been updated to ₹1299." is correct; "Your Progress Bar goal has been updated to ₹1299. Great! 🎉" is not. This never means editing a merchant's own saved data — if a stored value you're displaying verbatim (e.g. their saved completion message) already contains an emoji they put there themselves, show that value exactly as saved, emoji included; you're only ever barred from adding one of your own.
12. When the merchant asks to change one specific field of something already configured (e.g. "change my progress bar goal to ₹999", "update the announcement text"), only pass the field(s) they actually asked about to the tool — never fill in other fields with a guessed or default value. The save layer for a feature's settings always keeps its own existing values for anything you don't pass, so leaving a field out is how you correctly preserve it, not something to second-guess. Never ask the merchant to reconfirm a value that's already set and unaffected by their request — only ask when a value is genuinely missing (no existing configuration to fall back on), invalid, incompatible with the change being made, or the request itself inherently requires picking a new one (e.g. they ask to change the reward type itself). Report the result the same way you handled the request: for a single-field change, the final response names ONLY that field and its new value — "Your Progress Bar goal has been updated to ₹999." is correct, "Your Progress Bar goal has been updated to ₹999 for free shipping." is not, even though the tool result does contain rewardType. This is a strict rule, not a style preference: use every field the tool returns for your own reasoning and verification, but state only what the merchant asked about in the reply. The only exceptions are the merchant having explicitly asked about that other field too, or the field being necessary to explain a failure or partial failure — never to "round out" or clarify a successful result. This is purely about what you say — you still check and preserve every unspecified field internally exactly as guided above. When a tool result separates fields into changed and unchanged, only narrate the fields under changed in the merchant-facing success response unless the merchant explicitly asked about an unchanged field.
13. When a successful tool result includes a responseHint field, use that text as the basis for your reply — don't append unchanged fields or other configuration details on top of it unless the merchant explicitly asked about them.
14. When the merchant asks about their Progress Bar in general terms ("what's my progress bar setup", "is it enabled", "what's my goal") after a get_current_config call, answer with a short structured summary of only the functional settings — enabled/disabled, goal (in the store's own currency), reward, mode, placement, show-on-empty-cart, and confetti — one per line, in this shape:

Your Progress Bar is enabled.

Goal: ₹999
Reward: Free shipping
Mode: Amount-based
Placement: Top of the cart drawer
Show on Empty Cart: Yes
Confetti: Enabled

Want me to show the customization settings too?

(Those exact values are illustrative only — always use the real numbers from the tool result, never this example's.) Leave background/foreground/icon colors, border radius, completion text color, and icon preset out of that summary entirely, and close with an offer like the line above inviting the merchant to ask for them. If the merchant explicitly asks for the complete/all/full settings, skip the short form and include every field from the tool result instead, still described in plain language, without inventing or omitting a single one. Always translate raw field names into plain language — never say bar_background_color, show_on_empty, enable_confetti, min_value, or any other database column name out loud. Don't add emojis of your own to this or any reply, but if a saved value (like a completion message) already contains one the merchant added, show it exactly as saved.`;

const MAX_ITER = 6;
const MAX_TOKENS = 700;

const CONFIRM_YES_RE = /^(__confirm__|y|yes|yeah|yep|confirm|ok|okay|sure|go ahead|do it|please do)\.?$/i;
const CONFIRM_NO_RE = /^(__cancel__|n|no|nope|cancel|stop|nevermind|never mind)\.?$/i;

const READ_ONLY_TOOLS = new Set(['get_current_config', 'get_products', 'get_collections', 'get_store_insights', 'suggest_theme_colors', 'list_active_promotions']);

const CONFIRM_CHOICES = [
  { label: '✅ Confirm', value: '__confirm__' },
  { label: '✖ Cancel', value: '__cancel__' },
];

// Tools whose result should be handed to the client as structured widget
// data instead of being fed back into another LLM turn — the point is for
// the frontend to render an interactive card (e.g. editable color swatches)
// with the exact values the tool produced, not a paraphrased summary of them.
const WIDGET_TOOLS = { suggest_theme_colors: 'theme_colors' };

// Deterministic success-message builders for a tool result's `changed`
// fields (see the CHANGED_FIELD_SHORT_CIRCUIT block below) — keyed by field
// name so support for another tool's field is just one more entry here, not
// a change to the short-circuit logic itself. A field with no entry here
// disqualifies that result from the deterministic path entirely (falls
// through to the normal model-composed reply) rather than risk a sentence
// with a raw internal key name or a silently-dropped field in it.
const REWARD_TYPE_LABELS = {
  free_shipping: 'free shipping',
  product: 'a free product',
  discount: 'a discount',
  gift: 'a surprise gift',
};

const CHANGED_FIELD_MESSAGES = {
  // Derives the symbol fresh from ctx.currencyCode via the same canonical
  // map getShopCurrency() itself uses to produce .symbol — rather than
  // trusting the pre-computed ctx.currencySymbol in isolation, this ties
  // the deterministic response to the same authoritative currency code the
  // rest of the request (and the correct model-composed read responses)
  // already rely on. Never hardcoded, never derived from the merchant's
  // own message — only from the store's real currency code.
  goalAmount: (value, ctx) => `Your Progress Bar goal has been updated to ${getCurrencySymbolFromCode(ctx.currencyCode)}${value}.`,
  rewardType: (value) => `Your Progress Bar reward has been updated to ${REWARD_TYPE_LABELS[value] || value}.`,
};

function describeDestructiveCall(name, args) {
  if (name === 'set_cart_drawer_enabled') return 'turn OFF your entire Cart Drawer — customers will see Shopify\'s default cart instead';
  if (name === 'update_custom_css') return 'clear your existing custom CSS';
  if (name === 'remove_upsell_rule') return `remove upsell rule ${args?.ruleId}`;
  if (name === 'remove_fbt_rule') return `remove Frequently Bought Together rule ${args?.ruleId}`;
  if (name === 'delete_discount') return `delete discount ${args?.discountId}`;
  return `run ${name}`;
}

// One cheap read-back after the loop (only if a write tool actually ran) so
// the live cart editor (CartEditorContext's cartEditorConfigUpdated listener)
// updates immediately instead of waiting for a reload — same event shape the
// old ai_agent_apply.php/useAiAgent.js pairing already produced.
async function buildAfterPayload(shop) {
  const db = getDb();
  const [cdcRows] = await db.execute('SELECT * FROM cart_drawer_config WHERE shop_domain = ? LIMIT 1', [shop]);
  const cdc = cdcRows[0];
  const [pbRows] = await db.execute('SELECT * FROM progress_bar_settings WHERE shop_domain = ? LIMIT 1', [shop]);
  const pb = pbRows[0];
  let pbTiers;
  if (pb) {
    const [tierRows] = await db.execute('SELECT * FROM progress_bar_tiers WHERE settings_id = ? ORDER BY sort_order', [pb.id]);
    // Converted to the shape CartEditorContext/CartPreview actually read
    // (defaultTier: minimumSpend/title/description/icon/rewardProducts) —
    // not the normalized table's own column names.
    pbTiers = tierRows.map((t) => {
      let rewardProducts = [];
      try { rewardProducts = t.reward_products ? JSON.parse(t.reward_products) : []; } catch { /* ignore */ }
      return {
        id: `tier-${t.id}`,
        minimumSpend: Number(t.min_value) || 0,
        title: t.description || 'Milestone',
        description: t.description || 'Milestone',
        icon: t.icon_preset || 'gift',
        rewardProducts,
        rewardProductCount: rewardProducts.length,
      };
    });
  }
  const [upRows] = await db.execute('SELECT is_enabled FROM upsell_widget_settings WHERE shop_domain = ? LIMIT 1', [shop]);
  const [csRows] = await db.execute('SELECT is_enabled FROM coupon_slider_settings WHERE shop_domain = ? LIMIT 1', [shop]);
  const [fbtRows] = await db.execute('SELECT is_enabled FROM fbt_widget_settings WHERE shop_domain = ? LIMIT 1', [shop]);

  return {
    drawerEnabled: cdc ? !!cdc.is_enabled : undefined,
    header: cdc ? { bgColor: cdc.header_bg_color, textColor: cdc.header_text_color } : undefined,
    checkoutButton: cdc ? { backgroundColor: cdc.checkout_button_bg_color, textColor: cdc.checkout_button_text_color } : undefined,
    announcement: cdc ? { enabled: !!cdc.announcement_enabled, text: cdc.announcement_text, bgColor: cdc.announcement_bg_color, textColor: cdc.announcement_text_color } : undefined,
    goalBar: pb ? { enabled: !!pb.is_enabled, tiers: pbTiers } : undefined,
    upsell: upRows[0] ? { enabled: !!upRows[0].is_enabled } : undefined,
    couponSlider: csRows[0] ? { enabled: !!csRows[0].is_enabled } : undefined,
    fbt: fbtRows[0] ? { widgetEnabled: !!fbtRows[0].is_enabled } : undefined,
  };
}

export async function action({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;
    const { message, messages: history = [], pendingConfirmTool } = await request.json();
    if (!message) return Response.json({ success: false, error: 'No message provided' }, { status: 400 });

    const credit = await checkAndConsumeCredit(shop, admin);
    const credits = { remaining: credit.remaining, limit: credit.limit, isOverage: credit.isOverage };
    const planKey = await getShopPlan(shop, admin);
    // Fetched once per request and threaded through ctx so every tool
    // executor (and the system prompt below) shares the same real store
    // currency — never a hardcoded USD/$ assumption. See currency.server.js.
    const currency = await getShopCurrency(admin, shop);
    const ctx = {
      shop, admin, session, planKey, requestUrl: request.url,
      currencyCode: currency.code, currencySymbol: currency.symbol, currencyLocale: currency.locale,
    };

    // Deterministic confirm/cancel — bypasses the model entirely so a
    // confirmation can never execute with different args than what the
    // merchant was shown.
    if (pendingConfirmTool) {
      const trimmed = message.trim();
      if (CONFIRM_YES_RE.test(trimmed)) {
        const executor = TOOL_EXECUTORS[pendingConfirmTool.name];
        const result = executor ? await executor(ctx, pendingConfirmTool.args || {}) : { success: false, message: 'Unknown action.' };
        const after = await buildAfterPayload(shop).catch(() => null);
        const text = result.success
          ? `Done — that's been applied.`
          : `I couldn't complete that: ${result.message || 'unknown error'}.`;
        // toolSuccess reflects the ACTUAL tool outcome (result.success), unlike
        // the outer `success` field which just means "the request completed" —
        // callers that need to know whether the action really happened (e.g.
        // a widget card deciding whether to show an error state) should use
        // this instead of string-matching `message`.
        return Response.json({ success: true, message: text, credits, after, toolSuccess: result.success });
      }
      if (CONFIRM_NO_RE.test(trimmed)) {
        return Response.json({ success: true, message: 'Okay, cancelled.', credits });
      }
      // Anything else — fall through and treat as a normal new turn (lets
      // the merchant correct/change their mind instead of being stuck).
    }

    const snapshot = await getStoreConfigSnapshot(shop).catch(() => null);
    const stateLine = snapshot
      ? `Current state — Cart Drawer: ${snapshot.cartDrawer ? 'on' : 'off'}, Progress Bar: ${snapshot.progressBar ? 'on' : 'off'}, Upsells: ${snapshot.upsells ? 'on' : 'off'}, FBT: ${snapshot.fbt ? 'on' : 'off'}, Coupon Slider: ${snapshot.couponSlider ? 'on' : 'off'}.`
      : '';
    // The merchant's plain numbers (thresholds, prices) are always in the
    // store's own currency — this is the fact that stops the model from
    // defaulting to $/USD out of its own training data.
    const currencyLine = `Store currency: ${currency.code} (${currency.symbol}), locale ${currency.locale}. When the merchant gives a plain number for a price or spending threshold, it is in this currency — write it back using the ${currency.symbol} symbol (or the currency's normal formatting), never $ or USD, unless the store currency is actually USD.`;
    const systemPrompt = [SYSTEM_PROMPT_BASE, PRODUCT_KNOWLEDGE, currencyLine, stateLine].filter(Boolean).join('\n\n');

    let messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-10).map(m => ({ role: m.role === 'agent' ? 'assistant' : 'user', content: m.text || '' })),
      { role: 'user', content: message },
    ];

    let anyWriteExecuted = false;

    for (let iter = 0; iter < MAX_ITER; iter++) {
      const { content, toolCalls, errorStatus, errorMessage } = await agentTurn(messages, TOOL_REGISTRY, { maxTokens: MAX_TOKENS });

      if (errorStatus) {
        // The raw reason/hint (e.g. HTTP status, "OpenAI billing/quota")
        // describes THIS APP'S OWN backend provider key — the merchant has
        // no access to platform.openai.com for our key and can't act on
        // that detail at all, so surfacing it to them is actively
        // misleading, not just unfriendly. Logged server-side for our own
        // debugging; the merchant gets a generic, non-alarming message.
        console.error('[api.ai.chat] agentTurn provider error', { errorStatus, errorMessage });
        return Response.json({ success: true, message: 'Sorry, something went wrong. Please try again in a moment.', credits });
      }

      if (!toolCalls || toolCalls.length === 0) {
        if (content == null) {
          return Response.json({ success: true, message: "I couldn't reach the AI service just now — try again in a moment.", credits });
        }
        const after = anyWriteExecuted ? await buildAfterPayload(shop).catch(() => null) : null;
        return Response.json({ success: true, message: guardChatReply(stripEmojis(content)), credits, after });
      }

      // Only ONE destructive tool call is ever allowed to trigger the
      // confirm exception per turn — if the model bundled a destructive call
      // with others, stop and confirm before any of them (including the
      // non-destructive ones in the same batch) run, so nothing executes
      // ahead of a pending confirmation.
      const destructiveCall = toolCalls.find((tc) => isDestructiveToolCall(tc.name, tc.args));
      if (destructiveCall) {
        return Response.json({
          success: true,
          message: `Just to confirm — you want me to ${describeDestructiveCall(destructiveCall.name, destructiveCall.args)}. Shall I go ahead?`,
          choices: CONFIRM_CHOICES,
          credits,
          needsConfirmation: true,
          pendingConfirmTool: { name: destructiveCall.name, args: destructiveCall.args },
        });
      }

      messages = [...messages, { role: 'assistant', content: content || null, tool_calls: toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) } })) }];

      for (const call of toolCalls) {
        const executor = TOOL_EXECUTORS[call.name];
        let result;
        try {
          result = executor ? await executor(ctx, call.args || {}) : { success: false, message: `Unknown tool: ${call.name}` };
        } catch (e) {
          console.error(`[api.ai.chat] tool ${call.name} failed:`, e.message);
          result = { success: false, message: e.message || 'Tool execution failed.' };
        }

        // Widget tools short-circuit here — the frontend needs the exact
        // values the tool produced to render an editable card, not the
        // model's paraphrase of them after another turn.
        if (WIDGET_TOOLS[call.name] && result?.success) {
          return Response.json({
            success: true,
            message: "Here are a few color combos based on your store — click one to apply it.",
            widget: { type: WIDGET_TOOLS[call.name], props: result.palettes },
            credits,
          });
        }

        // Deterministic success response for a `changed`-reporting tool
        // result (e.g. set_progress_bar_goal) — bypasses the model for this
        // reply entirely, built only from result.changed, so nothing from
        // result.unchanged can ever end up in what the merchant reads.
        // Guarded to only the single-tool-call, non-read-only, non-widget
        // case: a compound request (multiple tool calls this turn) still
        // needs the model's own synthesis across all of them, same as
        // today, and WIDGET_TOOLS above already claims its own tools first.
        if (
          toolCalls.length === 1 &&
          !READ_ONLY_TOOLS.has(call.name) &&
          !WIDGET_TOOLS[call.name] &&
          result?.success &&
          result.changed && typeof result.changed === 'object'
        ) {
          const changedEntries = Object.entries(result.changed);
          const fieldMessages = changedEntries.map(([key, value]) => CHANGED_FIELD_MESSAGES[key]?.(value, ctx));
          if (changedEntries.length > 0 && fieldMessages.every(Boolean)) {
            const after = await buildAfterPayload(shop).catch(() => null);
            return Response.json({ success: true, message: fieldMessages.join(' '), credits, after });
          }
          // An unmapped changed field — fall through to the normal
          // model-composed path rather than risk an incomplete message.
        }

        if (!READ_ONLY_TOOLS.has(call.name) && result?.success) anyWriteExecuted = true;
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }

    const after = anyWriteExecuted ? await buildAfterPayload(shop).catch(() => null) : null;
    return Response.json({ success: true, message: "I made some changes but can't summarize further right now — check the Cart Editor to confirm everything looks right.", credits, after });
  } catch (e) {
    console.error('[api.ai.chat]', e);
    return Response.json({ success: true, message: `Something went wrong${e.message ? `: ${e.message}` : ''}. Please try again.` });
  }
}
