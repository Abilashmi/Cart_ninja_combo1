import { useState, useEffect, useCallback } from 'react';
import { useOutletContext } from 'react-router';
import { aiApi } from './api';
import { featureStore } from './featureStore';
import { useCurrency } from '../CurrencyContext';
import { formatAmount } from '../../utils/currency.shared';

function getPageFromPath(pathname) {
  const staticKeys = [
    '/app/cartdrawer', '/app/analytics', '/app/upsell', '/app/fbt',
    '/app/bundles', '/app/coupons', '/app/setup',
  ];
  for (const key of staticKeys) {
    if (pathname.startsWith(key)) return key;
  }
  return '/app';
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const ACTION_LABELS = {
  cartDrawer: 'Cart Drawer', progressBar: 'Progress Bar',
  upsells: 'Upsells', fbt: 'FBT', trustBadges: 'Trust Badges',
  styling: 'Styling', optimization: 'Optimization',
};

// Natural, markdown-formatted sentence for one action the backend actually
// confirmed applied — only called after result.applied.includes(engine).
// Never used for actions that failed/are unsupported (see failureLine below).
function successLine(a, label) {
  const isUpsellEnable = a.module === 'upsells' && a.action === 'enable';
  const isFbtEnable = a.module === 'fbt' && a.action === 'enable';

  if (a.module === 'cartDrawer') {
    if (a.action === 'enable') {
      const side = a.settings?.cartDrawerPosition ? ` It opens on the **${a.settings.cartDrawerPosition}** side of the screen.` : '';
      return `I've enabled your **Cart Drawer** successfully. Customers will now see your customized cart drawer instead of Shopify's default cart.${side} Refresh your storefront and add a product to verify the change.`;
    }
    return `I've disabled your **Cart Drawer**. Customers will now use Shopify's default cart.`;
  }
  if (a.module === 'progressBar') {
    return a.action === 'enable'
      ? `I've enabled your **Progress Bar**. Customers will now see spending milestones inside the Cart Drawer to encourage larger purchases.`
      : `I've disabled the **Progress Bar**.`;
  }
  if (a.module === 'upsells') {
    return isUpsellEnable
      ? `I've enabled **Upsells** — let's set up a trigger below so Brix knows which products to recommend.`
      : `I've disabled **Upsells**.`;
  }
  if (a.module === 'fbt') {
    if (isFbtEnable) {
      const parts = [];
      if (a.settings?.fbtTemplate) parts.push(`the **${FBT_TEMPLATE_LABELS[a.settings.fbtTemplate] || a.settings.fbtTemplate}** template`);
      if (a.settings?.fbtMode) parts.push(`**${a.settings.fbtMode === 'ai' ? 'AI recommended' : 'Manual'}** mode`);
      const detail = parts.length ? `, using ${parts.join(' and ')}` : '';
      return `I've enabled **Frequently Bought Together**${detail}.`;
    }
    return `I've disabled **Frequently Bought Together**.`;
  }
  return `I've applied **${label}** successfully.`;
}

function failureLine(label, reason) {
  if (reason === 'unsupported') return `**${label}** isn't available yet — there's no backend for that action.`;
  if (reason === 'unknown') return `I couldn't confirm whether **${label}** was applied — the backend didn't return a result for it.`;
  return `I couldn't apply **${label}** because the backend returned an error${reason ? ` (${reason})` : ''}.`;
}

// FBT admin template picker (app/routes/app.fbt.jsx) maps these labels to
// fbt_widget_settings.selected_template's enum('fbt1','fbt2','fbt3').
const FBT_TEMPLATE_MAP = [
  { re: /classic\s*grid/i, value: 'fbt1', label: 'Classic Grid' },
  { re: /modern\s*cards?/i, value: 'fbt2', label: 'Modern Cards' },
  { re: /vertical\s*list/i, value: 'fbt3', label: 'Vertical List' },
];
const FBT_TEMPLATE_LABELS = Object.fromEntries(FBT_TEMPLATE_MAP.map(t => [t.value, t.label]));

// Pulls an explicit template/mode choice out of an FBT-related message, if
// present, so "classic grid ... ai recommended" actually configures the
// widget instead of just flipping is_enabled.
function extractFbtSettings(lower) {
  const settings = {};
  const template = FBT_TEMPLATE_MAP.find(t => t.re.test(lower));
  if (template) settings.fbtTemplate = template.value;

  if (/\bai\b[\s\S]{0,20}(recommend|mode|config)|\b(recommend|mode|config)[\s\S]{0,20}\bai\b/i.test(lower)) {
    settings.fbtMode = 'ai';
  } else if (/\bmanual\b[\s\S]{0,20}(mode|config)/i.test(lower)) {
    settings.fbtMode = 'manual';
  }
  return settings;
}

// Pulls a left/right side preference out of a cart drawer message.
function extractCartDrawerSettings(lower) {
  const settings = {};
  if (/\bleft\b/i.test(lower)) settings.cartDrawerPosition = 'left';
  else if (/\bright\b/i.test(lower)) settings.cartDrawerPosition = 'right';
  return settings;
}

// Distinguishes a command ("Add Upsells", "enable the cart drawer") from an
// inquiry about existing state ("is there anything already set in the upsell
// rule", "do I have upsells enabled") — both can contain the exact same
// module keyword, but only the former should fire an action. Base-form verbs
// ("enable", "add") signal a command; questions about state tend to start
// with an interrogative and use past-participle phrasing ("enabled", "set
// up") that this intentionally does NOT match.
const QUESTION_STARTERS = /^\s*(is|are|does|do|did|what|how|why|has|have)\b/i;
const COMMAND_VERBS = /\b(enable|disable|add|remove|delete|activate|deactivate|create|configure|show|hide|stop|start|turn ?on|turn ?off|set ?up|apply|use)\b/i;
function looksLikeQuestion(text) {
  return QUESTION_STARTERS.test(text) && !COMMAND_VERBS.test(text);
}

// "create/add/make a discount/coupon ..." — deliberately narrow (verb + noun
// within a short span) so it doesn't fire on unrelated mentions of the word
// "discount" the way the old unscoped upsell regex used to.
const DISCOUNT_INTENT = /\b(create|add|make|set ?up|generate)\b[\s\S]{0,30}\b(discount|coupon)\b|\b(discount|coupon)\b[\s\S]{0,30}\b(create|add|make|set ?up|generate)\b/i;
function looksLikeDiscountIntent(text) {
  return !looksLikeQuestion(text) && DISCOUNT_INTENT.test(text);
}

// "create/build a bundle/combo ..." — same narrow verb+noun shape as discount
// intent, for the same reason (avoid firing on any unrelated mention).
const COMBO_INTENT = /\b(create|add|make|build|set ?up|start)\b[\s\S]{0,20}\b(bundle|combo)\b|\b(bundle|combo)\b[\s\S]{0,20}\b(create|add|make|build|set ?up|start)\b/i;
function looksLikeComboIntent(text) {
  return !looksLikeQuestion(text) && COMBO_INTENT.test(text);
}

const PROGRESS_BAR_RE = /progress.?bar|goal|free.?shipping|shipping.?progress/i;
const WANT_DISABLE_RE = /disable|turn off|deactiv|remove|stop|hide|close/i;
// "enable progress bar"/"set up a goal bar" etc — the setup flow asks for
// reward type/goal/placement instead of blindly toggling it on. Disabling
// needs no such clarification, so it's excluded here and stays an instant
// toggle in extractActions below.
function looksLikeProgressBarIntent(text) {
  if (looksLikeQuestion(text)) return false;
  const lower = text.toLowerCase();
  return !WANT_DISABLE_RE.test(lower) && PROGRESS_BAR_RE.test(lower);
}

function looksLikeAovQuery(text) {
  return /\b(increase|improve|boost|grow|raise)\b[\s\S]{0,25}\b(aov|average order value|revenue|sales|conversion)\b|how (do|can) i (sell more|increase (revenue|sales|aov))|grow (my )?revenue|make more (money|sales)/i.test(text);
}

// Autonomy rules: "choose the best upsell / recommend products / optimize my
// cart / increase AOV" etc. skip the trigger/offer question entirely — Brix
// analyzes real sales data (getBestUpsellPair) and picks a pair itself.
// Checked BEFORE looksLikeAovQuery, which used to claim overlapping phrasing
// ("increase AOV") for its own read-only insights report — these action
// phrases mean "decide and do it for me", not "just show me a report".
const AUTO_UPSELL_RE = new RegExp([
  'best[\\s\\S]{0,15}upsell',
  '(recommend|suggest)[\\s\\S]{0,15}(products?|bundles?)',
  'smart[\\s\\S]{0,15}recommendation',
  '(configure|set ?up)[\\s\\S]{0,15}ai[\\s\\S]{0,10}upsell',
  'generate[\\s\\S]{0,15}recommendation',
  '(optimi[sz]e|improve)[\\s\\S]{0,15}(my )?cart',
  'increase[\\s\\S]{0,15}(aov|average order value)',
].join('|'), 'i');
function looksLikeAutoUpsellIntent(text) {
  return !looksLikeQuestion(text) && AUTO_UPSELL_RE.test(text);
}

function extractActions(text) {
  if (looksLikeQuestion(text)) return [];
  const lower = text.toLowerCase();
  const actions = [];
  const wantDisable = WANT_DISABLE_RE.test(lower);

  if (/(?:apply|set|use|enable)?\s*(premium\s*dark|dark\s*(?:theme|preset))/i.test(lower)) {
    actions.push({ module: 'styling', action: 'applyTemplate', engine: 'applyTemplate', settings: { template: 'premium' }, label: 'Premium Dark Theme' });
    return actions;
  }
  if (/(?:apply|set|use|enable)?\s*(minimal\s*light|light\s*(?:theme|preset))/i.test(lower)) {
    actions.push({ module: 'styling', action: 'applyTemplate', engine: 'applyTemplate', settings: { template: 'minimal' }, label: 'Minimal Light Theme' });
    return actions;
  }
  if (/(?:apply|set|use|enable)?\s*(luxury\s*gold|gold\s*(?:theme|preset))/i.test(lower)) {
    actions.push({ module: 'styling', action: 'applyTemplate', engine: 'applyTemplate', settings: { template: 'luxury' }, label: 'Luxury Gold Theme' });
    return actions;
  }
  // Deliberately not an early return here (unlike the applyTemplate/optimizeMobile
  // cases above) — "enable cart editor and match my theme" should produce both
  // a cartDrawer action and a matchTheme action from one message.
  // Also fires for phrasing that references the live storefront instead of
  // the word "theme" directly (e.g. "change my cart by seeing my website") —
  // scraping the live site's CSS is exactly what matchTheme does.
  const mentionsLiveSite = /(see|view|check|look at|visit|browse|scan).{0,20}(website|site|store)\b|\b(website|site|store)\b.{0,20}(see|view|check|look at|visit|browse|scan)/i.test(lower);
  const wantsVisualChange = /cart|colou?r|theme|design|style|look/i.test(lower);
  if (
    /match.?theme|sync.?theme|detect.?theme|auto.?theme|copy.?theme|(colou?r|palette).{0,25}\btheme\b|\btheme\b.{0,25}(colou?r|palette)/i.test(lower)
    || (mentionsLiveSite && wantsVisualChange)
  ) {
    actions.push({ module: 'styling', action: 'matchTheme', engine: 'matchTheme', label: 'Match Store Theme' });
  }
  if (/optimize.*mobile|mobile.*optimize|responsive/i.test(lower)) {
    actions.push({ module: 'optimization', action: 'optimizeMobile', engine: 'optimizeMobile', label: 'Optimize Mobile' });
    return actions;
  }

  if (/cart.*drawer|drawer|cart.*editor/.test(lower)) actions.push({ module: 'cartDrawer', action: wantDisable ? 'disable' : 'enable', settings: extractCartDrawerSettings(lower) });
  // Enabling the progress bar now goes through the conversational setup flow
  // (looksLikeProgressBarIntent, checked earlier in sendMessage) — only
  // disabling it stays an instant toggle here, since that needs no follow-up.
  if (PROGRESS_BAR_RE.test(lower) && wantDisable) actions.push({ module: 'progressBar', action: 'disable' });
  if (/trust.?badge|security|secure|badge/i.test(lower) && !/goal|progress|shipping/.test(lower)) actions.push({ module: 'trustBadges', action: wantDisable ? 'disable' : 'enable' });
  if (/upsell/i.test(lower) && !/fbt|frequently.*bought/i.test(lower)) actions.push({ module: 'upsells', action: wantDisable ? 'disable' : 'enable' });
  if (/fbt|frequently.*bought/i.test(lower)) actions.push({ module: 'fbt', action: wantDisable ? 'disable' : 'enable', settings: extractFbtSettings(lower) });

  return actions;
}

function isRevenueQuery(text) {
  return /revenue|how much (did|do|have) we (made?|earn(ed)?)|total sales|sales (this|so far)|earnings/i.test(text);
}

// "This month" range in the merchant's local time, matching the Analytics
// page's own month-to-date default.
function monthToDateRange() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const startDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  const endDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return { startDate, endDate };
}

async function fetchRevenueSummary() {
  const { startDate, endDate } = monthToDateRange();
  try {
    const res = await fetch(`/api/analytics/summary?startDate=${startDate}&endDate=${endDate}&compare=false`);
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 || data.locked) {
      return { locked: true, error: data.error || 'Full Analytics requires the Starter plan or above.' };
    }
    if (!res.ok || !data.success) {
      return { error: data.error || `HTTP ${res.status}` };
    }
    return { current: data.data?.current || null };
  } catch (e) {
    return { error: e.message || 'Network error' };
  }
}

// Picks the most recent real updated_at out of whatever sections `after`
// touched — never fabricated; returns null if the backend didn't include one.
function pickEvidenceTimestamp(after) {
  const candidates = [after?.cart?.updatedAt, after?.cart?.goalBar?.updatedAt, after?.cart?.upsell?.updatedAt, after?.fbt?.updatedAt].filter(Boolean);
  if (!candidates.length) return null;
  return candidates.map(d => new Date(d)).sort((a, b) => b - a)[0];
}

function syncAfterToFeatureStore(after) {
  if (!after) return;
  const cart = after.cart;
  const fbt = after.fbt;
  if (cart) {
    if (cart.drawerEnabled != null) featureStore.set('cart_drawer', cart.drawerEnabled);
    if (cart.upsell?.enabled != null) featureStore.set('upsells', cart.upsell.enabled);
    if (cart.goalBar?.enabled != null) featureStore.set('progress_bar', cart.goalBar.enabled);
    if (cart.trustBadges?.enabled != null) featureStore.set('trust_badges', cart.trustBadges.enabled);
    // CartEditorContext listens for this event to update its live state
    // (e.g. the drawer on/off status) without requiring a page reload.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cartEditorConfigUpdated', { detail: cart }));
    }
  }
  if (fbt?.widgetEnabled != null) featureStore.set('fbt', fbt.widgetEnabled);
}

function generateTitle(text) {
  let t = text.trim()
    .replace(/\b(please|thanks|thank you|can you|i want to|could you|would you|just|hey|hello|hi|need|want)\b/gi, '')
    .replace(/\s+/g, ' ').trim()
    .replace(/[.!?,;:]+$/, '');
  const words = t.split(/\s+/).map(w => {
    if (['aov', 'fbt', 'css', 'api', 'seo', 'url', 'ui', 'ux'].includes(w.toLowerCase())) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  });
  t = words.join(' ');
  return t.length > 60 ? t.slice(0, 57) + '...' : t || 'New Chat';
}

const MODULE_TO_ENGINE = {
  cartDrawer:  { enable: 'enableDrawer',      disable: 'disableDrawer'     },
  progressBar: { enable: 'enableGoalBar',     disable: 'disableGoalBar'    },
  upsells:     { enable: 'enableUpsell',      disable: 'disableUpsell'     },
  fbt:         { enable: 'enableFBT',         disable: 'disableFBT'        },
  trustBadges: { enable: 'enableTrustBadges', disable: 'disableTrustBadges'},
};

async function applyActionsViaApi(actions) {
  if (actions.length === 0) return { success: false, error: 'No actions to apply' };
  const engineActions = actions.map(a => a.engine || MODULE_TO_ENGINE[a.module]?.[a.action]).filter(Boolean);
  if (engineActions.length === 0) return { success: false, error: 'Unsupported action' };
  const planSettings = actions.reduce((s, a) => { if (a.settings) Object.assign(s, a.settings); return s; }, {});
  try {
    const res = await fetch('/api/ai-agent/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '', plan: { summary: 'AI command', actions: engineActions, settings: planSettings }, mode: 'apply' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      return { success: false, error: err.error || `HTTP ${res.status}` };
    }
    const data = await res.json();
    return {
      success: data.success,
      synced: data.synced,
      before: data.before,
      after: data.after,
      applied: data.applied || [],
      unsupported: data.unsupported || [],
    };
  } catch (e) {
    return { success: false, error: e.message || 'Network error' };
  }
}

// matchTheme can't go through applyActionsViaApi/ai_agent_apply.php — it needs
// a live admin session (to resolve the storefront URL) and an outbound fetch
// of the storefront's CSS, which only the Node route can do.
async function matchThemeViaApi() {
  try {
    const res = await fetch('/api/ai-agent/match-theme', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!data.success) return { error: data.error || `HTTP ${res.status}` };
    return { theme: data.theme, after: data.after };
  } catch (e) {
    return { error: e.message || 'Network error' };
  }
}

// Pulls two real product titles from the shop's catalog to use as a concrete
// example in the upsell follow-up question, instead of a generic placeholder
// the merchant might mistake for required product names.
async function fetchSampleProductNames() {
  try {
    const res = await fetch('/api/upsell');
    const data = await res.json().catch(() => ({}));
    // "Gift Card" is Shopify's default product on every store and never a
    // sensible upsell-trigger example; skip it so the sample pair reads
    // naturally instead of picking whatever happens to be first/second.
    const products = (data?.data?.allProducts || []).filter(p => p.title !== 'Gift Card');
    if (products.length >= 2) return [products[0].title, products[1].title];
  } catch { /* fall through to the generic placeholder */ }
  return null;
}

// ── Generalized "pending action" turn dispatch ──────────────────────────────
// One in-memory (never persisted — see below) state machine drives all four
// multi-turn flows. Each flow still has its own server route (mirrors the
// existing discount-turn/upsell-rule-turn convention) but the client-side
// ask -> confirm -> execute -> verify handling is shared.

const FLOW_ENDPOINTS = {
  upsellRule: '/api/ai-agent/upsell-rule-turn',
  discount: '/api/ai-agent/discount-turn',
  progressBar: '/api/ai-agent/progress-bar-turn',
  combo: '/api/ai-agent/combo-turn',
};

const BAIL_TEXT = {
  upsellRule: 'Let\'s finish this in the Cart Editor\'s Upsell settings instead — you can add the rule there directly.',
  discount: 'Let\'s finish this in Discounts instead — you can create the code there directly.',
  progressBar: 'Let\'s finish this in the Cart Editor\'s Progress Bar settings instead — you can configure it there directly.',
  combo: 'Let\'s finish this in Build a Combo instead — you can create the bundle there directly.',
};

const REWARD_TYPE_DISPLAY = { free_shipping: 'Free Shipping', free_gift: 'Free Gift', discount: 'Discount', custom: 'Custom' };

function buildTurnPayload(flow, message, pending) {
  const p = pending || {};
  switch (flow) {
    case 'upsellRule':
      return { message, needSide: p.needSide || 'both', resolvedTrigger: p.resolvedTrigger, resolvedOffer: p.resolvedOffer, ambiguousSide: p.ambiguousSide, ambiguousCandidates: p.ambiguousCandidates };
    case 'discount':
      return { message, resolvedCode: p.resolvedCode, resolvedTitle: p.resolvedTitle, resolvedPercentage: p.resolvedPercentage, resolvedExtras: p.resolvedExtras };
    case 'progressBar':
      return { message, slots: p.slots };
    case 'combo':
      return { message, slots: p.slots, ambiguousCandidates: p.ambiguousCandidates };
    default:
      return { message };
  }
}

function buildFinalizePayload(flow, pending) {
  const p = pending || {};
  switch (flow) {
    case 'upsellRule':
      return { finalize: true, resolvedTrigger: p.resolvedTrigger, resolvedOffer: p.resolvedOffer };
    case 'discount':
      return { finalize: true, resolvedCode: p.resolvedCode, resolvedTitle: p.resolvedTitle, resolvedPercentage: p.resolvedPercentage, resolvedExtras: p.resolvedExtras };
    case 'progressBar':
      return { finalize: true, slots: p.slots };
    case 'combo':
      return { finalize: true, slots: p.slots };
    default:
      return { finalize: true };
  }
}

async function postFlow(endpoint, body) {
  try {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await res.json();
  } catch (e) {
    return { status: 'error', message: e.message || 'Network error' };
  }
}

async function runFlowTurn(flow, message, pending) {
  return postFlow(FLOW_ENDPOINTS[flow], buildTurnPayload(flow, message, pending));
}
async function finalizeFlow(flow, pending) {
  return postFlow(FLOW_ENDPOINTS[flow], buildFinalizePayload(flow, pending));
}
async function storeInsightsViaApi() {
  return postFlow('/api/ai-agent/store-insights', {});
}

async function autoUpsellViaApi() {
  return postFlow('/api/ai-agent/auto-upsell', {});
}

// Natural, markdown-formatted confirmations — only ever shown after the
// corresponding turn route returns 'saved', i.e. after a real DB write
// succeeded (see the confirm-before-execute framework this generalizes).
// Never rephrase these to imply something happened before that write.
function savedMessage(flow, result) {
  switch (flow) {
    case 'upsellRule':
      return `I've added a new upsell rule. When a customer adds **${result.trigger.title}** to their cart, they'll now be recommended **${result.offer.title}**.`;
    case 'discount':
      return `I've created your discount, **${result.title}** (code **${result.code}**), giving customers **${result.percentage}% off** at checkout.`;
    case 'progressBar': {
      const s = result.slots || {};
      const reward = REWARD_TYPE_DISPLAY[s.rewardType] || s.rewardType;
      const placement = s.placement === 'top' ? 'top' : 'bottom';
      return `I've enabled your **Progress Bar**. Customers will now see spending milestones toward **${reward}** at ₹${s.goalAmount}, shown at the ${placement} of the cart.`;
    }
    case 'combo':
      return `I've created your bundle **"${result.slots?.templateName || ''}"** as a draft. Open **Build a Combo** to review and publish it.`;
    default:
      return "That's been applied successfully.";
  }
}

// Everything a route returns beyond status/message/credits/choices is
// flow-specific turn state (slots, resolvedTrigger, ambiguousCandidates,
// etc.) — carry all of it forward into the next pendingAction untouched.
function restFields(result) {
  const rest = { ...result };
  delete rest.status;
  delete rest.message;
  delete rest.credits;
  delete rest.choices;
  return rest;
}

const CONFIRM_YES_RE = /^(__confirm__|y|yes|yeah|yep|confirm|ok|okay|sure|go ahead|do it|please do)\.?$/i;
const CONFIRM_NO_RE = /^(__cancel__|n|no|nope|cancel|stop|nevermind|never mind)\.?$/i;

function mergeCredits(prev, incoming) {
  if (!incoming) return prev;
  return { ...prev, ...incoming, used: incoming.limit - incoming.remaining };
}

const LS_CONVS = 'brixbar_convs';
const LS_MSGS  = 'brixbar_msgs';

function lsGet(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function lsSet(key, val) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
}

export default function useAiAgent(location) {
  const { symbol: currencySymbol, code: currencyCode } = useCurrency();
  // BrixBar/BrixAiPage are always rendered inside app.jsx's <Outlet>
  // subtree, which passes `shop` via context — no extra network request.
  const { shop } = useOutletContext() || {};
  const [conversations, setConversations] = useState(() => lsGet(LS_CONVS, []));
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(null);
  const [typing, setTyping] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [tools, setTools] = useState([]);
  const [error, setError] = useState(null);
  const [initialized, setInitialized] = useState(false);
  const [credits, setCredits] = useState(null);
  // In-memory only, deliberately not persisted to localStorage — a persisted
  // pending clarification would otherwise survive a reload/navigation and
  // could hijack a much later, completely unrelated message (e.g. a fresh
  // "Add Upsells" click getting misread as the answer to a stale question).
  // One state machine drives all four conversational flows (upsellRule,
  // discount, progressBar, combo) — see the "pending action" helpers above.
  const [pendingAction, setPendingAction] = useState(null);

  const currentPage = getPageFromPath(location?.pathname || '/app');

  useEffect(() => { lsSet(LS_CONVS, conversations); }, [conversations]);
  useEffect(() => {
    if (!activeConvId) return;
    const saved = lsGet(LS_MSGS, {});
    saved[activeConvId] = messages;
    lsSet(LS_MSGS, saved);
  }, [messages, activeConvId]);

  useEffect(() => {
    aiApi.getConversations()
      .then(res => { if (res.success && res.conversations?.length > 0) setConversations(res.conversations); })
      .catch(e => console.warn('[useAiAgent] conversations:', e))
      .finally(() => setInitialized(true));
  }, []);

  useEffect(() => {
    aiApi.getSuggestions(currentPage)
      .then(res => { if (res.success) setSuggestions(res.suggestions); })
      .catch(() => {});
  }, [currentPage]);

  useEffect(() => {
    aiApi.getTools()
      .then(res => { if (res.success) setTools(res.tools); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    aiApi.getCredits()
      .then(res => { if (res.success) setCredits(res.credits); })
      .catch(() => {});
  }, []);

  const createConversation = useCallback(async (title) => {
    setPendingAction(null);
    try {
      const res = await aiApi.createConversation(title);
      if (res?.success && res?.conversation) {
        setConversations(prev => [res.conversation, ...prev]);
        setActiveConvId(res.conversation.id);
        setMessages([]);
        setError(null);
        return res.conversation;
      }
    } catch { /* fall through */ }
    const conv = { id: uid(), title: title || 'New Chat', shopDomain: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    setConversations(prev => [conv, ...prev]);
    setActiveConvId(conv.id);
    setMessages([]);
    return conv;
  }, []);

  const loadMessages = useCallback(async (convId) => {
    if (!convId) { setMessages([]); return; }
    try {
      const res = await aiApi.getMessages(convId);
      if (res.success) {
        setMessages(res.messages.map(m => ({
          id: m.id, role: m.role === 'assistant' ? 'agent' : 'user',
          text: m.message, summary: m.summary, actions: m.actions,
          createdAt: m.created_at,
        })));
      }
    } catch { setMessages([]); }
  }, []);

  const selectConversation = useCallback((convId) => {
    setPendingAction(null);
    setActiveConvId(convId);
    const saved = lsGet(LS_MSGS, {});
    if (saved[convId]?.length > 0) setMessages(saved[convId]);
    else loadMessages(convId);
  }, [loadMessages]);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim()) return;
    let convId = activeConvId;
    if (!convId) {
      const conv = await createConversation(generateTitle(text));
      if (!conv) return;
      convId = conv.id;
    }
    // Fire-and-forget persistence to MySQL (ai_messages table) so chat
    // history survives reloads/devices — mirrors the localStorage cache but
    // is the only copy that outlives this browser. Failures are swallowed;
    // the UI already has its own source of truth in `messages` state.
    const persist = (msg) => {
      aiApi.saveMessage(convId, msg.role === 'agent' ? 'assistant' : 'user', msg.text || '').catch(() => {});
    };

    const userMsg = { id: 'u-' + uid(), role: 'user', text: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    persist(userMsg);

    // A new conversation is already prepended by createConversation above,
    // but continuing an EXISTING one never moved it in the list before —
    // it stayed pinned at its original creation-time position no matter how
    // recently it was actually used. Bump it to the top here too, so the
    // history list reflects "most recently active", not just "most recently
    // created" (matches the ORDER BY updated_at DESC the server already uses).
    setConversations(prev => {
      const idx = prev.findIndex(c => c.id === convId);
      if (idx <= 0) return prev;
      const bumped = { ...prev[idx], updatedAt: new Date().toISOString() };
      return [bumped, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });

    setLoading('executing');
    setTyping(true);
    setError(null);

    const agentMsg = (t, choices) => ({
      id: 'a-' + uid(), role: 'agent', text: t,
      json: choices?.length ? { message: t, choices } : { message: t },
    });

    // Applies a flow turn/finalize result identically regardless of which
    // flow produced it or whether it was a fresh start or a follow-up reply.
    const handleFlowResult = (flow, result, prevPending) => {
      if (result.credits) setCredits(prev => mergeCredits(prev, result.credits));
      if (result.status === 'saved') {
        const msg = agentMsg(savedMessage(flow, result));
        setMessages(prev => [...prev, msg]);
        persist(msg);
        setPendingAction(null);
      } else if (result.status === 'confirm') {
        const msg = agentMsg(result.message, result.choices);
        setMessages(prev => [...prev, msg]);
        persist(msg);
        setPendingAction({ flow, awaitingConfirm: true, attempts: 0, ...restFields(result) });
      } else if (result.status === 'ask') {
        // A normal next-question step in a multi-slot wizard (progressBar/
        // combo) — healthy forward progress, not a failure, so it must NOT
        // count toward the 3-attempt cap (a flow with 3-4 required slots
        // would otherwise hit the cap right as it's about to finish).
        const msg = agentMsg(result.message, result.choices);
        setMessages(prev => [...prev, msg]);
        persist(msg);
        setPendingAction({ flow, awaitingConfirm: false, attempts: 0, ...restFields(result) });
      } else if (result.status === 'clarify') {
        // A genuinely unresolved/ambiguous reply (bad product/collection
        // name, unclear extraction) — this DOES count toward the cap.
        const msg = agentMsg(result.message, result.choices);
        setMessages(prev => [...prev, msg]);
        persist(msg);
        setPendingAction({ flow, awaitingConfirm: false, attempts: (prevPending?.attempts || 0) + 1, ...restFields(result) });
      } else if (result.status === 'locked') {
        const msg = agentMsg(result.message);
        setMessages(prev => [...prev, msg]);
        persist(msg);
        setPendingAction(null);
      } else {
        const msg = agentMsg(result.message || 'Something went wrong. Please try again.');
        setMessages(prev => [...prev, msg]);
        persist(msg);
        // Preserve whatever was already resolved (flow, slots, awaitingConfirm)
        // untouched — a generic error shouldn't discard prior turn progress —
        // and just count the failed attempt toward the 3-try cap.
        setPendingAction(prevPending ? { ...prevPending, attempts: (prevPending.attempts || 0) + 1 } : { flow, awaitingConfirm: false, attempts: 1 });
      }
    };

    try {
      if (pendingAction) {
        if (pendingAction.awaitingConfirm) {
          if (CONFIRM_YES_RE.test(text.trim())) {
            const result = await finalizeFlow(pendingAction.flow, pendingAction);
            handleFlowResult(pendingAction.flow, result, pendingAction);
            return;
          }
          if (CONFIRM_NO_RE.test(text.trim())) {
            setPendingAction(null);
            const msg = agentMsg('Okay, cancelled.');
            setMessages(prev => [...prev, msg]);
            persist(msg);
            return;
          }
          // Not a yes/no reply — fall through and forward it as another turn
          // below so the merchant can correct an earlier answer instead of
          // being forced to confirm or cancel.
        }

        if ((pendingAction.attempts || 0) >= 3) {
          setPendingAction(null);
          const msg = agentMsg(BAIL_TEXT[pendingAction.flow] || 'Let\'s finish this manually instead.');
          setMessages(prev => [...prev, msg]);
          persist(msg);
          return;
        }

        const result = await runFlowTurn(pendingAction.flow, text, pendingAction);
        handleFlowResult(pendingAction.flow, result, pendingAction);
        return;
      }

      if (looksLikeAutoUpsellIntent(text)) {
        const result = await autoUpsellViaApi();
        if (result.credits) setCredits(prev => mergeCredits(prev, result.credits));
        let replyText;
        if (result.status === 'saved') {
          replyText = `I've analyzed your store and selected the best AI-powered upsell recommendation based on your sales history — when a customer adds **${result.trigger.title}** to their cart, they'll now see **${result.offer.title}** recommended. This is now active in your Cart Drawer.`;
        } else {
          // 'insufficient' | 'locked' | 'error' — each route response already
          // carries an honest, specific message; never override it with a
          // generic success-sounding line.
          replyText = result.message || "Something went wrong while generating a recommendation. Please try again.";
        }
        const msg = agentMsg(replyText);
        setMessages(prev => [...prev, msg]);
        persist(msg);
        return;
      }

      if (looksLikeAovQuery(text)) {
        const result = await storeInsightsViaApi();
        const msg = agentMsg(result.message, result.choices);
        setMessages(prev => [...prev, msg]);
        persist(msg);
        return;
      }

      if (looksLikeComboIntent(text)) {
        const result = await runFlowTurn('combo', text, null);
        handleFlowResult('combo', result, null);
        return;
      }

      if (looksLikeProgressBarIntent(text)) {
        const result = await runFlowTurn('progressBar', text, null);
        handleFlowResult('progressBar', result, null);
        return;
      }

      if (looksLikeDiscountIntent(text)) {
        const result = await runFlowTurn('discount', text, null);
        handleFlowResult('discount', result, null);
        return;
      }

      if (isRevenueQuery(text)) {
        const summary = await fetchRevenueSummary();
        let replyText;
        if (summary.locked) {
          replyText = `Revenue data isn't available on your current plan.\n${summary.error}`;
        } else if (summary.error) {
          replyText = `Couldn't fetch revenue right now.\nReason: ${summary.error}`;
        } else {
          const c = summary.current || {};
          const revenueStr = formatAmount(c.revenue || 0, currencySymbol, currencyCode);
          const aovStr = formatAmount(c.aov || 0, currencySymbol, currencyCode);
          replyText = `Revenue this month: ${revenueStr} across ${c.order_count || 0} orders (AOV ${aovStr}).`;
        }
        const msg = agentMsg(replyText);
        setMessages(prev => [...prev, msg]);
        persist(msg);
        return;
      }

      const detectedActions = extractActions(text);
      let reply, followUpReply;
      if (detectedActions.length > 0) {
        const engineFor = (a) => a.engine || MODULE_TO_ENGINE[a.module]?.[a.action];
        const themeAction = detectedActions.find(a => engineFor(a) === 'matchTheme');
        const otherActions = detectedActions.filter(a => engineFor(a) !== 'matchTheme');

        const lines = [];
        let mergedAfter = null;
        let anyFailed = false;

        if (otherActions.length > 0) {
          const result = await applyActionsViaApi(otherActions);
          if (result.error) {
            anyFailed = true;
            otherActions.forEach(a => lines.push(failureLine(a.label || ACTION_LABELS[a.module] || a.module, result.error)));
          } else {
            mergedAfter = result.after;
            // Report each action's real outcome instead of one blanket status —
            // PHP silently ignores actions it has no handler for (trust badges,
            // optimizeMobile, applyTemplate), so trust `applied`/`unsupported`
            // from the server, not "the request didn't error".
            otherActions.forEach(a => {
              const label = a.label || ACTION_LABELS[a.module] || a.module;
              const engine = engineFor(a);
              if (engine && result.applied.includes(engine)) {
                lines.push(successLine(a, label));
              }
              else if (engine && result.unsupported.includes(engine)) { lines.push(failureLine(label, 'unsupported')); anyFailed = true; }
              else { lines.push(failureLine(label, 'unknown')); anyFailed = true; }
            });
          }
        }

        if (themeAction) {
          const themeResult = await matchThemeViaApi();
          if (themeResult.error) {
            anyFailed = true;
            lines.push(failureLine('Match Store Theme', themeResult.error));
          } else {
            mergedAfter = themeResult.after || mergedAfter;
            const t = themeResult.theme || {};
            lines.push(`I've matched your Cart Drawer's colors to your live theme — applied a **${t.headerBgColor}** background and **${t.checkoutBgColor}** button color.`);
          }
        }

        if (mergedAfter) syncAfterToFeatureStore(mergedAfter);
        // A single action reads as its own natural sentence; multiple actions
        // in one message get a short intro plus a bulleted rundown (Markdown
        // list — rendered for real by MarkdownMessage, not raw ** characters).
        const text2 = lines.length > 1
          ? `${anyFailed ? "Here's what happened:" : "I've made the following updates:"}\n\n${lines.map(l => `- ${l}`).join('\n')}`
          : lines[0];
        // Real evidence only — shop domain from the authenticated session,
        // timestamp only if the backend actually returned one. Never shown
        // if neither is available (no fabricated evidence).
        const evidenceTs = pickEvidenceTimestamp(mergedAfter);
        const evidence = (shop || evidenceTs) ? { shop, updatedAt: evidenceTs?.toISOString() } : undefined;
        reply = { id: 'a-' + uid(), role: 'agent', text: text2, json: { message: text2, actions: detectedActions, status: anyFailed ? 'partial' : 'success', evidence } };

        const upsellEnable = otherActions.find(a => a.module === 'upsells' && a.action === 'enable');
        if (upsellEnable && !anyFailed) {
          // Try resolving trigger/offer straight from this same message first
          // (e.g. "Add Upsells, trigger Blue Hoodie offer Wool Socks") before
          // falling back to asking — don't ask for information already given.
          const ruleResult = await runFlowTurn('upsellRule', text, null);
          if (ruleResult.credits) setCredits(prev => mergeCredits(prev, ruleResult.credits));

          if (ruleResult.status === 'confirm') {
            followUpReply = agentMsg(ruleResult.message, ruleResult.choices);
            setPendingAction({ flow: 'upsellRule', awaitingConfirm: true, attempts: 0, ...restFields(ruleResult) });
          } else if (ruleResult.status === 'locked') {
            followUpReply = agentMsg(ruleResult.message);
          } else if (ruleResult.status === 'clarify' && (ruleResult.resolvedTrigger || ruleResult.resolvedOffer)) {
            // Partially resolved from the original message — ask only for
            // whatever's still missing, don't restart from scratch.
            followUpReply = agentMsg(ruleResult.message, ruleResult.choices);
            setPendingAction({ flow: 'upsellRule', awaitingConfirm: false, attempts: 1, ...restFields(ruleResult) });
          } else {
            const sample = await fetchSampleProductNames();
            const example = sample ? `${sample[0]} triggers ${sample[1]}` : 'Blue Hoodie triggers Wool Socks';
            const followUpText = `Which product should trigger this upsell, and what should it offer? (e.g. "${example}")`;
            followUpReply = agentMsg(followUpText);
            setPendingAction({ flow: 'upsellRule', awaitingConfirm: false, attempts: 0, needSide: 'both' });
          }
        }
      } else {
        try {
          const history = messages.map(m => ({ role: m.role, text: m.text }));
          const res = await aiApi.sendMessage(convId, text, history);
          if (res.credits) setCredits(prev => mergeCredits(prev, res.credits));
          if (res.success && res.message) {
            const msgObj = res.message;
            const msgText = typeof msgObj === 'string' ? msgObj : (msgObj.text || msgObj.summary || msgObj.message || '');
            const msgActions = (typeof msgObj === 'object' ? msgObj.actions : null) || res.actions || [];
            reply = { id: 'a-' + uid(), role: 'agent', text: msgText, json: msgActions.length > 0 ? { message: msgText, actions: msgActions } : null };
          } else throw new Error('No response');
        } catch {
          reply = agentMsg('I couldn\'t process that. Try "Enable Cart Drawer", "Add Upsells", or "Enable Progress Bar".');
        }
      }
      setMessages(prev => [...prev, reply, ...(followUpReply ? [followUpReply] : [])]);
      persist(reply);
      if (followUpReply) persist(followUpReply);
    } catch (e) {
      const errMsg = {
        id: 'e-' + uid(), role: 'agent', error: true,
        text: `Sorry, something went wrong${e.message ? `: ${e.message}` : ''}. Please try again — if it keeps failing, the backend may be unavailable right now.`,
      };
      setMessages(prev => [...prev, errMsg]);
      persist(errMsg);
      setError(e.message);
    } finally {
      setLoading(null);
      setTyping(false);
    }
  }, [activeConvId, messages, createConversation, currencySymbol, currencyCode, pendingAction, shop]);

  const deleteConversation = useCallback(async (convId) => {
    setConversations(prev => prev.filter(c => c.id !== convId));
    if (activeConvId === convId) { setActiveConvId(null); setMessages([]); }
  }, [activeConvId]);

  const renameConversation = useCallback((convId, title) => {
    setConversations(prev => prev.map(c => c.id === convId ? { ...c, title } : c));
  }, []);

  return {
    conversations, activeConvId, messages, loading, typing, suggestions, tools, error, initialized, currentPage, credits,
    createConversation, selectConversation, sendMessage, deleteConversation, renameConversation,
    setActiveConvId, setMessages, setConversations,
  };
}
