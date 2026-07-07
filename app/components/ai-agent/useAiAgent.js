import { useState, useEffect, useCallback } from 'react';
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

// Pulls a spending goal amount and/or a completion message out of a progress
// bar message (e.g. "enable progress bar, free shipping at $50, message
// 'Almost there!'"). Only ever sets the FIRST/primary goal — multi-tier
// setup still requires the manual Progress Bar panel.
function extractProgressBarSettings(text) {
  const settings = {};
  const numMatch = text.match(/[$₹]?\s*(\d+(?:\.\d{1,2})?)/);
  if (numMatch) {
    const n = parseFloat(numMatch[1]);
    if (Number.isFinite(n) && n > 0) settings.goalAmount = n;
  }
  const quoteMatch = text.match(/["']([^"']{3,80})["']/);
  if (quoteMatch) settings.goalMessage = quoteMatch[1];
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

function extractActions(text) {
  if (looksLikeQuestion(text)) return [];
  const lower = text.toLowerCase();
  const actions = [];
  const wantDisable = /disable|turn off|deactiv|remove|stop|hide|close/.test(lower);

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
  if (/progress.?bar|goal|free.?shipping|shipping.?progress/i.test(lower)) actions.push({ module: 'progressBar', action: wantDisable ? 'disable' : 'enable', settings: extractProgressBarSettings(text) });
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

// One turn of the conversational upsell-rule flow — posts the merchant's
// reply plus whatever's already been resolved to api.ai-agent.upsell-rule-turn.
async function upsellRuleTurnViaApi(message, pending) {
  try {
    const res = await fetch('/api/ai-agent/upsell-rule-turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        needSide: pending?.needSide || 'both',
        resolvedTrigger: pending?.resolvedTrigger,
        resolvedOffer: pending?.resolvedOffer,
        ambiguousSide: pending?.ambiguousSide,
        ambiguousCandidates: pending?.ambiguousCandidates,
      }),
    });
    return await res.json();
  } catch (e) {
    return { status: 'error', message: e.message || 'Network error' };
  }
}

// One turn of the conversational discount-creation flow — posts the
// merchant's reply plus whatever code/percentage is already resolved.
async function discountTurnViaApi(message, pending) {
  try {
    const res = await fetch('/api/ai-agent/discount-turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        resolvedCode: pending?.resolvedCode,
        resolvedPercentage: pending?.resolvedPercentage,
      }),
    });
    return await res.json();
  } catch (e) {
    return { status: 'error', message: e.message || 'Network error' };
  }
}

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
  const [pendingUpsellRule, setPendingUpsellRule] = useState(null);
  // Same in-memory-only treatment and same reason as pendingUpsellRule above.
  const [pendingDiscount, setPendingDiscount] = useState(null);

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
    setPendingUpsellRule(null);
    setPendingDiscount(null);
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
          createdAt: m.createdAt,
        })));
      }
    } catch { setMessages([]); }
  }, []);

  const selectConversation = useCallback((convId) => {
    setPendingUpsellRule(null);
    setPendingDiscount(null);
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
    const userMsg = { id: 'u-' + Date.now(), role: 'user', text: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setLoading('executing');
    setTyping(true);
    setError(null);
    let reply;
    let followUpReply = null;
    try {
      if (pendingUpsellRule) {
        if ((pendingUpsellRule.attempts || 0) >= 3) {
          const t = 'Let\'s finish this in the Cart Editor\'s Upsell settings instead — you can add the rule there directly.';
          reply = { id: 'a-' + Date.now(), role: 'agent', text: t, json: { message: t } };
          setPendingUpsellRule(null);
          setMessages(prev => [...prev, reply]);
          return;
        }

        const result = await upsellRuleTurnViaApi(text, pendingUpsellRule);
        if (result.credits) setCredits(prev => mergeCredits(prev, result.credits));

        if (result.status === 'saved') {
          const t = `✓ New upsell rule added: when a customer adds "${result.trigger.title}", recommend "${result.offer.title}".`;
          reply = { id: 'a-' + Date.now(), role: 'agent', text: t, json: { message: t } };
          setPendingUpsellRule(null);
        } else if (result.status === 'clarify') {
          reply = { id: 'a-' + Date.now(), role: 'agent', text: result.message, json: { message: result.message } };
          setPendingUpsellRule({
            needSide: result.needSide,
            resolvedTrigger: result.resolvedTrigger,
            resolvedOffer: result.resolvedOffer,
            ambiguousSide: result.ambiguousSide,
            ambiguousCandidates: result.ambiguousCandidates,
            attempts: (pendingUpsellRule.attempts || 0) + 1,
          });
        } else {
          const t = result.message || 'Something went wrong setting up that rule. Please try again.';
          reply = { id: 'a-' + Date.now(), role: 'agent', text: t, json: { message: t } };
          if (result.status === 'locked') setPendingUpsellRule(null);
          else setPendingUpsellRule({ ...pendingUpsellRule, attempts: (pendingUpsellRule.attempts || 0) + 1 });
        }
        setMessages(prev => [...prev, reply]);
        return;
      }

      if (pendingDiscount || looksLikeDiscountIntent(text)) {
        const pending = pendingDiscount || { attempts: 0 };
        if ((pending.attempts || 0) >= 3) {
          const t = 'Let\'s finish this in Discounts instead — you can create the code there directly.';
          reply = { id: 'a-' + Date.now(), role: 'agent', text: t, json: { message: t } };
          setPendingDiscount(null);
          setMessages(prev => [...prev, reply]);
          return;
        }

        const result = await discountTurnViaApi(text, pending);
        if (result.credits) setCredits(prev => mergeCredits(prev, result.credits));

        if (result.status === 'saved') {
          const t = `✓ Discount created: "${result.code}" — ${result.percentage}% off.`;
          reply = { id: 'a-' + Date.now(), role: 'agent', text: t, json: { message: t } };
          setPendingDiscount(null);
        } else if (result.status === 'clarify') {
          reply = { id: 'a-' + Date.now(), role: 'agent', text: result.message, json: { message: result.message } };
          setPendingDiscount({
            resolvedCode: result.resolvedCode,
            resolvedPercentage: result.resolvedPercentage,
            attempts: (pending.attempts || 0) + 1,
          });
        } else {
          const t = result.message || 'Something went wrong creating that discount. Please try again.';
          reply = { id: 'a-' + Date.now(), role: 'agent', text: t, json: { message: t } };
          setPendingDiscount({ ...pending, attempts: (pending.attempts || 0) + 1 });
        }
        setMessages(prev => [...prev, reply]);
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
        reply = { id: 'a-' + Date.now(), role: 'agent', text: replyText, json: { message: replyText } };
        setMessages(prev => [...prev, reply]);
        return;
      }
      const detectedActions = extractActions(text);
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
            otherActions.forEach(a => lines.push(`${a.label || ACTION_LABELS[a.module] || a.module}: Failed (${result.error})`));
          } else {
            mergedAfter = result.after;
            // Report each action's real outcome instead of one blanket status —
            // PHP silently ignores actions it has no handler for (trust badges,
            // optimizeMobile, applyTemplate), so trust `applied`/`unsupported`
            // from the server, not "the request didn't error".
            otherActions.forEach(a => {
              const label = a.label || ACTION_LABELS[a.module] || a.module;
              const engine = engineFor(a);
              const isUpsellEnable = a.module === 'upsells' && a.action === 'enable';
              const isFbtEnable = a.module === 'fbt' && a.action === 'enable';
              const isProgressBarEnable = a.module === 'progressBar' && a.action === 'enable';
              const isCartDrawerEnable = a.module === 'cartDrawer' && a.action === 'enable';
              if (engine && result.applied.includes(engine)) {
                if (isUpsellEnable) {
                  lines.push(`${label}: Enabled — set up a trigger below`);
                } else if (isFbtEnable && (a.settings?.fbtTemplate || a.settings?.fbtMode)) {
                  const parts = [];
                  if (a.settings.fbtTemplate) parts.push(`template set to ${FBT_TEMPLATE_LABELS[a.settings.fbtTemplate] || a.settings.fbtTemplate}`);
                  if (a.settings.fbtMode) parts.push(`mode set to ${a.settings.fbtMode === 'ai' ? 'AI recommended' : 'Manual'}`);
                  lines.push(`${label}: Enabled — ${parts.join(', ')}`);
                } else if (isProgressBarEnable && (a.settings?.goalAmount || a.settings?.goalMessage)) {
                  const parts = [];
                  if (a.settings.goalAmount) parts.push(`goal set to ${a.settings.goalAmount}`);
                  if (a.settings.goalMessage) parts.push(`message set to "${a.settings.goalMessage}"`);
                  lines.push(`${label}: Enabled — ${parts.join(', ')}`);
                } else if (isCartDrawerEnable && a.settings?.cartDrawerPosition) {
                  lines.push(`${label}: Enabled — opens on the ${a.settings.cartDrawerPosition}`);
                } else {
                  lines.push(`${label}: Completed`);
                }
              }
              else if (engine && result.unsupported.includes(engine)) { lines.push(`${label}: Not supported yet (no backend handler)`); anyFailed = true; }
              else { lines.push(`${label}: Unknown (no response for this action)`); anyFailed = true; }
            });
          }
        }

        if (themeAction) {
          const themeResult = await matchThemeViaApi();
          if (themeResult.error) {
            anyFailed = true;
            lines.push(`Match Store Theme: Failed (${themeResult.error})`);
          } else {
            mergedAfter = themeResult.after || mergedAfter;
            const t = themeResult.theme || {};
            lines.push(`Match Store Theme: Completed — applied ${t.headerBgColor} background / ${t.checkoutBgColor} button color detected from your live theme`);
          }
        }

        if (mergedAfter) syncAfterToFeatureStore(mergedAfter);
        const labels = detectedActions.map(a => a.label || ACTION_LABELS[a.module] || a.module).join(', ');
        const text2 = `Task: ${labels}\n${lines.join('\n')}`;
        reply = { id: 'a-' + Date.now(), role: 'agent', text: text2, json: { message: text2, actions: detectedActions, status: anyFailed ? 'partial' : 'success' } };

        const upsellEnable = otherActions.find(a => a.module === 'upsells' && a.action === 'enable');
        if (upsellEnable && !anyFailed) {
          // Try resolving trigger/offer straight from this same message first
          // (e.g. "Add Upsells, trigger Blue Hoodie offer Wool Socks") before
          // falling back to asking — don't ask for information already given.
          const ruleResult = await upsellRuleTurnViaApi(text, null);
          if (ruleResult.credits) setCredits(prev => mergeCredits(prev, ruleResult.credits));

          if (ruleResult.status === 'saved') {
            const t = `✓ New upsell rule added: when a customer adds "${ruleResult.trigger.title}", recommend "${ruleResult.offer.title}".`;
            followUpReply = { id: 'a-' + Date.now() + '-followup', role: 'agent', text: t, json: { message: t } };
          } else if (ruleResult.status === 'locked') {
            followUpReply = { id: 'a-' + Date.now() + '-followup', role: 'agent', text: ruleResult.message, json: { message: ruleResult.message } };
          } else if (ruleResult.status === 'clarify' && (ruleResult.resolvedTrigger || ruleResult.resolvedOffer)) {
            // Partially resolved from the original message — ask only for
            // whatever's still missing, don't restart from scratch.
            followUpReply = { id: 'a-' + Date.now() + '-followup', role: 'agent', text: ruleResult.message, json: { message: ruleResult.message } };
            setPendingUpsellRule({
              needSide: ruleResult.needSide,
              resolvedTrigger: ruleResult.resolvedTrigger,
              resolvedOffer: ruleResult.resolvedOffer,
              attempts: 1,
            });
          } else {
            const sample = await fetchSampleProductNames();
            const example = sample ? `${sample[0]} triggers ${sample[1]}` : 'Blue Hoodie triggers Wool Socks';
            const followUpText = `Which product should trigger this upsell, and what should it offer? (e.g. "${example}")`;
            followUpReply = { id: 'a-' + Date.now() + '-followup', role: 'agent', text: followUpText, json: { message: followUpText } };
            setPendingUpsellRule({ needSide: 'both', attempts: 0 });
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
            reply = { id: 'a-' + Date.now(), role: 'agent', text: msgText, json: msgActions.length > 0 ? { message: msgText, actions: msgActions } : null };
          } else throw new Error('No response');
        } catch {
          reply = { id: 'a-' + Date.now(), role: 'agent', text: 'I couldn\'t process that. Try "Enable Cart Drawer", "Add Upsells", or "Enable Progress Bar".', json: { message: 'I couldn\'t process that. Try "Enable Cart Drawer", "Add Upsells", or "Enable Progress Bar".' } };
        }
      }
      setMessages(prev => [...prev, reply, ...(followUpReply ? [followUpReply] : [])]);
    } catch (e) {
      setMessages(prev => [...prev, { id: 'e-' + Date.now(), role: 'agent', text: 'Sorry, something went wrong. Please try again.', error: true }]);
      setError(e.message);
    } finally {
      setLoading(null);
      setTyping(false);
    }
  }, [activeConvId, messages, createConversation, currencySymbol, currencyCode, pendingUpsellRule, pendingDiscount]);

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
