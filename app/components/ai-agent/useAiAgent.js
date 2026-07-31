import { useState, useEffect, useCallback } from 'react';
import { aiApi } from './api';
import { featureStore } from './featureStore';

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

// Only a bare "no"/"cancel" short-circuits locally (no network call needed —
// nothing to execute). A "yes" (or anything else) still has to reach the
// server: only it holds the shop/admin context needed to actually run the
// pending tool, and only it can guarantee the executed args are byte-for-
// byte what the merchant was shown (see api.ai.chat.jsx's confirm handling).
const CONFIRM_NO_RE = /^(__cancel__|n|no|nope|cancel|stop|nevermind|never mind)\.?$/i;

// Applied after any turn that returned a real `after` snapshot (i.e. at
// least one write tool executed) — dispatches the exact shape
// CartEditorContext.jsx's `cartEditorConfigUpdated` listener already expects
// (drawerEnabled/header/checkoutButton/announcement/goalBar/upsell/
// couponSlider/fbt, all flat — no wrapping object), so the live editor
// updates immediately instead of waiting for a reload.
function syncAfterToFeatureStore(after) {
  if (!after) return;
  if (after.drawerEnabled != null) featureStore.set('cart_drawer', after.drawerEnabled);
  if (after.upsell?.enabled != null) featureStore.set('upsells', after.upsell.enabled);
  if (after.goalBar?.enabled != null) featureStore.set('progress_bar', after.goalBar.enabled);
  if (after.fbt?.widgetEnabled != null) featureStore.set('fbt', after.fbt.widgetEnabled);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cartEditorConfigUpdated', { detail: after }));
  }
}

function mergeCredits(prev, incoming) {
  if (!incoming) return prev;
  return { ...prev, ...incoming, used: incoming.limit - incoming.remaining };
}

const LS_CONVS = 'brixbar_convs';
const LS_MSGS = 'brixbar_msgs';

function lsGet(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function lsSet(key, val) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ }
}

export default function useAiAgent(location) {
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
  // The ONLY state carried across a destructive-action confirmation — set
  // whenever a server reply carries needsConfirmation, cleared on any
  // non-yes/no reply. Deliberately tiny compared to the old per-flow
  // pendingAction state machine (no `flow`/`attempts`/status-enum) — the
  // server (api.ai.chat.jsx) does all the real state-tracking via
  // conversation history now, this is just "what to execute if they say yes".
  const [pendingConfirmTool, setPendingConfirmTool] = useState(null);

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
    setPendingConfirmTool(null);
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
    setPendingConfirmTool(null);
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
    // history survives reloads/devices.
    const persist = (msg) => {
      aiApi.saveMessage(convId, msg.role === 'agent' ? 'assistant' : 'user', msg.text || '').catch(() => {});
    };

    const trimmed = text.trim();
    const userMsg = { id: 'u-' + uid(), role: 'user', text: trimmed };
    setMessages(prev => [...prev, userMsg]);
    persist(userMsg);

    setConversations(prev => {
      const idx = prev.findIndex(c => c.id === convId);
      if (idx <= 0) return prev;
      const bumped = { ...prev[idx], updatedAt: new Date().toISOString() };
      return [bumped, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });

    // A bare "no" cancels a pending destructive confirmation with no server
    // round-trip at all — there's nothing to execute.
    if (pendingConfirmTool && CONFIRM_NO_RE.test(trimmed)) {
      setPendingConfirmTool(null);
      const msg = { id: 'a-' + uid(), role: 'agent', text: 'Okay, cancelled.', json: { message: 'Okay, cancelled.' } };
      setMessages(prev => [...prev, msg]);
      persist(msg);
      return;
    }

    setLoading('executing');
    setTyping(true);
    setError(null);

    try {
      const history = messages.map(m => ({ role: m.role, text: m.text }));
      const res = await aiApi.sendMessage(convId, trimmed, history, pendingConfirmTool || null);

      if (res.credits) setCredits(prev => mergeCredits(prev, res.credits));
      if (res.after) syncAfterToFeatureStore(res.after);
      setPendingConfirmTool(res.needsConfirmation ? (res.pendingConfirmTool || null) : null);

      const msgText = res.message || "I couldn't process that. Please try again.";
      const reply = {
        id: 'a-' + uid(), role: 'agent', text: msgText,
        json: { message: msgText, ...(res.choices?.length ? { choices: res.choices } : {}), ...(res.widget ? { widget: res.widget } : {}) },
      };
      setMessages(prev => [...prev, reply]);
      persist(reply);
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
  }, [activeConvId, messages, createConversation, pendingConfirmTool]);

  // Runs a specific tool with specific args immediately, bypassing the LLM —
  // reuses api.ai.chat.jsx's pendingConfirmTool bypass (normally reserved for
  // "yes"/"no" after a destructive-action confirmation) as a generic "execute
  // this exact tool" path. Used by chat widgets (e.g. ThemeColorsWidget's
  // Apply buttons) where the merchant's click IS the confirmation — no typed
  // "yes" needed. Returns {success, message} so the calling widget can show
  // its own inline loading/error state rather than only relying on the chat
  // transcript.
  const applyWidget = useCallback(async (name, args) => {
    if (!activeConvId) return { success: false, message: 'No active conversation.' };
    try {
      const history = messages.map(m => ({ role: m.role, text: m.text }));
      const res = await aiApi.sendMessage(activeConvId, '__confirm__', history, { name, args });

      if (res.credits) setCredits(prev => mergeCredits(prev, res.credits));
      if (res.after) syncAfterToFeatureStore(res.after);

      const msgText = res.message || "I couldn't process that. Please try again.";
      const reply = { id: 'a-' + uid(), role: 'agent', text: msgText, json: { message: msgText } };
      setMessages(prev => [...prev, reply]);
      aiApi.saveMessage(activeConvId, 'assistant', msgText).catch(() => {});

      return { success: !!res.toolSuccess, message: msgText };
    } catch (e) {
      return { success: false, message: e.message || 'Something went wrong. Please try again.' };
    }
  }, [activeConvId, messages]);

  const deleteConversation = useCallback(async (convId) => {
    setConversations(prev => prev.filter(c => c.id !== convId));
    if (activeConvId === convId) { setActiveConvId(null); setMessages([]); }
  }, [activeConvId]);

  const renameConversation = useCallback((convId, title) => {
    setConversations(prev => prev.map(c => c.id === convId ? { ...c, title } : c));
  }, []);

  return {
    conversations, activeConvId, messages, loading, typing, suggestions, tools, error, initialized, currentPage, credits,
    createConversation, selectConversation, sendMessage, applyWidget, deleteConversation, renameConversation,
    setActiveConvId, setMessages, setConversations,
  };
}
