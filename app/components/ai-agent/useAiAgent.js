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

function extractActions(text) {
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

  if (/cart.*drawer|drawer|cart.*editor/.test(lower)) actions.push({ module: 'cartDrawer', action: wantDisable ? 'disable' : 'enable' });
  if (/progress.?bar|goal|free.?shipping|shipping.?progress/i.test(lower)) actions.push({ module: 'progressBar', action: wantDisable ? 'disable' : 'enable' });
  if (/trust.?badge|security|secure|badge/i.test(lower) && !/goal|progress|shipping/.test(lower)) actions.push({ module: 'trustBadges', action: wantDisable ? 'disable' : 'enable' });
  if (/upsell/i.test(lower) && !/fbt|frequently.*bought/i.test(lower)) actions.push({ module: 'upsells', action: wantDisable ? 'disable' : 'enable' });
  if (/fbt|frequently.*bought/i.test(lower)) actions.push({ module: 'fbt', action: wantDisable ? 'disable' : 'enable' });

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

  const createConversation = useCallback(async (title) => {
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
    try {
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
              if (engine && result.applied.includes(engine)) lines.push(`${label}: Completed`);
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
      } else {
        try {
          const history = messages.map(m => ({ role: m.role, text: m.text }));
          const res = await aiApi.sendMessage(convId, text, history);
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
      setMessages(prev => [...prev, reply]);
    } catch (e) {
      setMessages(prev => [...prev, { id: 'e-' + Date.now(), role: 'agent', text: 'Sorry, something went wrong. Please try again.', error: true }]);
      setError(e.message);
    } finally {
      setLoading(null);
      setTyping(false);
    }
  }, [activeConvId, messages, createConversation, currencySymbol, currencyCode]);

  const deleteConversation = useCallback(async (convId) => {
    setConversations(prev => prev.filter(c => c.id !== convId));
    if (activeConvId === convId) { setActiveConvId(null); setMessages([]); }
  }, [activeConvId]);

  const renameConversation = useCallback((convId, title) => {
    setConversations(prev => prev.map(c => c.id === convId ? { ...c, title } : c));
  }, []);

  return {
    conversations, activeConvId, messages, loading, typing, suggestions, tools, error, initialized, currentPage,
    createConversation, selectConversation, sendMessage, deleteConversation, renameConversation,
    setActiveConvId, setMessages, setConversations,
  };
}
