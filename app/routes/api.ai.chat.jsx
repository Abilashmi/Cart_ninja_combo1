import { authenticate } from '../shopify.server';
import { checkAndConsumeCredit } from '../services/ai-credits.server';
import { agentTurn } from '../services/ai-llm.server';
import { guardChatReply } from '../services/ai-safety.server';
import { TOOL_REGISTRY, isDestructiveToolCall } from '../config/ai-tool-schemas';
import { TOOL_EXECUTORS } from '../services/ai-agent-tools.server';
import { getStoreConfigSnapshot } from '../services/store-config-snapshot.server';
import { getShopPlan } from '../services/plan-permissions.server';
import { getDb } from '../services/db.server';

const SYSTEM_PROMPT_BASE = `You are Brix, an AI assistant built into the Brix cart drawer app for Shopify merchants. You talk like an experienced, friendly Shopify consultant — confident and helpful, never robotic, never a wall of rules recited back at the merchant.

You can actually configure and change things in the merchant's store — the cart drawer's design, header, announcements, progress bar, coupon slider, upsell products, countdown timer, checkout button, custom CSS, Frequently Bought Together, discounts, and Combo Forge bundle pages — via the tools available to you. When a merchant asks for something in scope, DO IT using the tools rather than telling them to go do it themselves in the admin. Never say "I can't do that" for something a tool covers — figure out which tool(s) apply and use them. Only ask a clarifying question when you genuinely don't have enough information to act (e.g. which product, which color), and only decline outright when nothing in your toolset can do what's being asked.

Guidelines:
1. Never claim you did something you didn't — only report success after a tool call actually returns success. If a tool fails or is locked by plan, say so plainly and honestly.
2. Never promise future/background action ("I'll notify you", "I'll keep monitoring") — nothing happens after your reply on its own.
3. Never state specific store data you weren't given in this conversation or via a tool call (revenue, order counts, product names) — use get_store_insights/get_products/get_collections/get_current_config to actually check, rather than guessing.
4. Never state a specific date, version, or fact you're not certain of.
5. If a request spans multiple changes (e.g. "give my cart a modern dark theme"), feel free to call several tools in sequence to accomplish it fully before replying.
6. Write like a person: short paragraphs, plain sentences, no filler. Use markdown for real emphasis (bold a feature name or number) — don't decorate every sentence.`;

const MAX_ITER = 6;
const MAX_TOKENS = 700;

const CONFIRM_YES_RE = /^(__confirm__|y|yes|yeah|yep|confirm|ok|okay|sure|go ahead|do it|please do)\.?$/i;
const CONFIRM_NO_RE = /^(__cancel__|n|no|nope|cancel|stop|nevermind|never mind)\.?$/i;

const READ_ONLY_TOOLS = new Set(['get_current_config', 'get_products', 'get_collections', 'get_store_insights', 'suggest_theme_colors']);

const CONFIRM_CHOICES = [
  { label: '✅ Confirm', value: '__confirm__' },
  { label: '✖ Cancel', value: '__cancel__' },
];

// Tools whose result should be handed to the client as structured widget
// data instead of being fed back into another LLM turn — the point is for
// the frontend to render an interactive card (e.g. editable color swatches)
// with the exact values the tool produced, not a paraphrased summary of them.
const WIDGET_TOOLS = { suggest_theme_colors: 'theme_colors' };

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
    const ctx = { shop, admin, session, planKey, requestUrl: request.url };

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
    const systemPrompt = stateLine ? `${SYSTEM_PROMPT_BASE}\n\n${stateLine}` : SYSTEM_PROMPT_BASE;

    let messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-10).map(m => ({ role: m.role === 'agent' ? 'assistant' : 'user', content: m.text || '' })),
      { role: 'user', content: message },
    ];

    let anyWriteExecuted = false;

    for (let iter = 0; iter < MAX_ITER; iter++) {
      const { content, toolCalls, errorStatus, errorMessage } = await agentTurn(messages, TOOL_REGISTRY, { maxTokens: MAX_TOKENS });

      if (errorStatus) {
        // Surface the provider's actual reason (e.g. "You exceeded your
        // current quota" for a billing issue, vs a generic rate limit) —
        // a bare HTTP status number isn't actionable for whoever reads this.
        const reason = errorMessage ? `: ${errorMessage}` : '';
        const hint = errorStatus === 429
          ? ' This is either a rate limit (too many requests too fast) or an OpenAI billing/quota issue — check platform.openai.com/usage if it keeps happening.'
          : ' This is usually temporary, try again in a minute.';
        return Response.json({ success: true, message: `Brix's AI service returned an error (HTTP ${errorStatus})${reason}.${hint}`, credits });
      }

      if (!toolCalls || toolCalls.length === 0) {
        if (content == null) {
          return Response.json({ success: true, message: "I couldn't reach the AI service just now — try again in a moment.", credits });
        }
        const after = anyWriteExecuted ? await buildAfterPayload(shop).catch(() => null) : null;
        return Response.json({ success: true, message: guardChatReply(content), credits, after });
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
