import { useState, useEffect, useCallback, useRef } from "react";
import { aiApi } from "./api";
import { featureStore } from "./featureStore";

function getPageFromPath(pathname) {
  const staticKeys = [
    "/app/cartdrawer", "/app/analytics", "/app/upsell", "/app/fbt",
    "/app/bundles", "/app/coupons", "/app/setup"
  ];
  for (const key of staticKeys) {
    if (pathname.startsWith(key)) return key;
  }
  return "/app";
}

function id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const ACTION_LABELS = {
  cartDrawer: "Cart Drawer", progressBar: "Progress Bar",
  upsells: "Upsells", fbt: "FBT", trustBadges: "Trust Badges",
  styling: "Styling", optimization: "Optimization",
};

function extractActions(text) {
  const lower = text.toLowerCase();
  const actions = [];
  const wantDisable = /disable|turn off|deactiv|remove|stop|hide|close/.test(lower);

  // Theme presets — match before generic drawer/styling patterns
  if (/(?:apply|set|use|enable)?\s*(premium\s*dark|dark\s*(?:theme|preset))/i.test(lower)) {
    actions.push({ module: "styling", action: "applyTemplate", engine: "applyTemplate", settings: { template: "premium" }, label: "Premium Dark Theme" });
    return actions;
  }
  if (/(?:apply|set|use|enable)?\s*(minimal\s*light|light\s*(?:theme|preset))/i.test(lower)) {
    actions.push({ module: "styling", action: "applyTemplate", engine: "applyTemplate", settings: { template: "minimal" }, label: "Minimal Light Theme" });
    return actions;
  }
  if (/(?:apply|set|use|enable)?\s*(luxury\s*gold|gold\s*(?:theme|preset))/i.test(lower)) {
    actions.push({ module: "styling", action: "applyTemplate", engine: "applyTemplate", settings: { template: "luxury" }, label: "Luxury Gold Theme" });
    return actions;
  }

  // Match Theme
  if (/match.?theme|sync.?theme|detect.?theme|auto.?theme|copy.?theme/i.test(lower)) {
    actions.push({ module: "styling", action: "matchTheme", engine: "matchTheme", label: "Match Store Theme" });
    return actions;
  }

  // Optimize Mobile
  if (/optimize.*mobile|mobile.*optimize|responsive/i.test(lower)) {
    actions.push({ module: "optimization", action: "optimizeMobile", engine: "optimizeMobile", label: "Optimize Mobile" });
    return actions;
  }

  // Standard module enable / disable
  if (/cart.*drawer|drawer/.test(lower)) actions.push({ module: "cartDrawer", action: wantDisable ? "disable" : "enable" });
  if (/progress.?bar|goal|free.?shipping|shipping.?progress/i.test(lower)) actions.push({ module: "progressBar", action: wantDisable ? "disable" : "enable" });
  if (/trust.?badge|security|secure|badge/i.test(lower) && !/goal|progress|shipping/.test(lower)) actions.push({ module: "trustBadges", action: wantDisable ? "disable" : "enable" });
  if (/upsell/i.test(lower) && !/fbt|frequently.*bought/i.test(lower)) actions.push({ module: "upsells", action: wantDisable ? "disable" : "enable" });
  if (/fbt|frequently.*bought/i.test(lower)) actions.push({ module: "fbt", action: wantDisable ? "disable" : "enable" });

  return actions;
}

function syncAfterToFeatureStore(after) {
  if (!after) return;
  const cart = after.cart;
  const fbt = after.fbt;
  if (cart) {
    if (cart.drawerEnabled != null) featureStore.set("cart_drawer", cart.drawerEnabled);
    if (cart.upsell?.enabled != null) featureStore.set("upsells", cart.upsell.enabled);
    if (cart.goalBar?.enabled != null) featureStore.set("progress_bar", cart.goalBar.enabled);
    if (cart.trustBadges?.enabled != null) featureStore.set("trust_badges", cart.trustBadges.enabled);
  }
  if (fbt?.widgetEnabled != null) featureStore.set("fbt", fbt.widgetEnabled);
}

function generateTitle(text) {
  let t = text.trim();
  t = t.replace(/\b(please|thanks|thank you|can you|i want to|could you|would you|just|hey|hello|hi|need|want)\b/gi, "");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/[.!?,;:]+$/, "");
  const words = t.split(/\s+/).map((w) => {
    if (["aov", "fbt", "css", "api", "seo", "url", "ui", "ux"].includes(w.toLowerCase())) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  });
  t = words.join(" ");
  return t.length > 60 ? t.slice(0, 57) + "..." : t || "New Chat";
}

const MODULE_TO_ENGINE = {
  cartDrawer: { enable: "enableDrawer", disable: "disableDrawer" },
  progressBar: { enable: "enableGoalBar", disable: "disableGoalBar" },
  upsells: { enable: "enableUpsell", disable: "disableUpsell" },
  fbt: { enable: "enableFBT", disable: "disableFBT" },
  trustBadges: { enable: "enableTrustBadges", disable: "disableTrustBadges" },
};

async function applyActionsViaApi(actions) {
  if (actions.length === 0) return { success: false, error: "No actions to apply" };

  const engineActions = actions.map((a) => a.engine || MODULE_TO_ENGINE[a.module]?.[a.action]).filter(Boolean);
  if (engineActions.length === 0) return { success: false, error: "Unsupported action" };

  const planSettings = actions.reduce((s, a) => {
    if (a.settings) Object.assign(s, a.settings);
    return s;
  }, {});

  try {
    const res = await fetch("/api/ai-agent/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "",
        plan: { summary: "AI command", actions: engineActions, settings: planSettings },
        mode: "apply",
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      return { success: false, error: err.error || `HTTP ${res.status}` };
    }

    const data = await res.json();
    return { success: true, synced: data.synced, before: data.before, after: data.after };
  } catch (e) {
    return { success: false, error: e.message || "Network error" };
  }
}

export default function useAiAgent(location) {
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(null);
  const [typing, setTyping] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [tools, setTools] = useState([]);
  const [error, setError] = useState(null);
  const [initialized, setInitialized] = useState(false);

  const currentPage = getPageFromPath(location?.pathname || "/app");

  useEffect(() => {
    aiApi.getConversations()
      .then((res) => {
        if (res.success) setConversations(res.conversations);
      })
      .catch((e) => console.warn("[useAiAgent] Failed to load conversations:", e))
      .finally(() => setInitialized(true));
  }, []);

  useEffect(() => {
    aiApi.getSuggestions(currentPage)
      .then((res) => {
        if (res.success) setSuggestions(res.suggestions);
      })
      .catch(() => {});
  }, [currentPage]);

  useEffect(() => {
    aiApi.getTools()
      .then((res) => { if (res.success) setTools(res.tools); })
      .catch(() => {});
  }, []);

  const createConversation = useCallback(async (title) => {
    try {
      const res = await aiApi.createConversation(title);
      if (res?.success && res?.conversation) {
        setConversations((prev) => [res.conversation, ...prev]);
        setActiveConvId(res.conversation.id);
        setMessages([]);
        setError(null);
        return res.conversation;
      }
    } catch (e) { /* fall through to local fallback */ }
    const conv = { id: id(), title: title || "New Chat", shopDomain: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    setConversations((prev) => [conv, ...prev]);
    setActiveConvId(conv.id);
    setMessages([]);
    return conv;
  }, []);

  const loadMessages = useCallback(async (convId) => {
    if (!convId) { setMessages([]); return; }
    try {
      const res = await aiApi.getMessages(convId);
      if (res.success) {
        setMessages(res.messages.map((m) => ({
          id: m.id,
          role: m.role === "assistant" ? "agent" : "user",
          text: m.message,
          summary: m.summary,
          actions: m.actions,
          off_topic: m.off_topic,
          insight_mode: m.insight_mode,
          createdAt: m.createdAt,
        })));
      }
    } catch (e) {
      console.warn("[useAiAgent] Failed to load messages:", e);
      setMessages([]);
    }
  }, []);

  const selectConversation = useCallback((convId) => {
    setActiveConvId(convId);
    loadMessages(convId);
  }, [loadMessages]);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim()) return;

    let convId = activeConvId;

    if (!convId) {
      const conv = await createConversation(generateTitle(text));
      if (!conv) return;
      convId = conv.id;
    }

    const userMsg = { id: "u-" + Date.now(), role: "user", text: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setLoading("executing");
    setTyping(true);
    setError(null);

    let reply;

    try {
      // Step 1: Detect intent locally
      const detectedActions = extractActions(text);

      if (detectedActions.length > 0) {
        // Step 2: Execute via real API
        const result = await applyActionsViaApi(detectedActions);

        if (result.success) {
          syncAfterToFeatureStore(result.after);
          const synced = result.synced !== false;
          const labels = detectedActions.map((a) => a.label || ACTION_LABELS[a.module] || a.module).join(", ");
          const statusLine = synced ? "Status: Completed" : "Status: Applied (waiting for store sync)";
          reply = {
            id: "a-" + Date.now(),
            role: "agent",
            text: `Task: ${labels}\n${statusLine}`,
            json: {
              message: `Task: ${labels}\n${statusLine}`,
              actions: detectedActions,
              status: "success",
            },
            executedResults: [{ status: "executed" }],
          };
        } else {
          const labels = detectedActions.map((a) => a.label || ACTION_LABELS[a.module] || a.module).join(", ");
          reply = {
            id: "a-" + Date.now(),
            role: "agent",
            text: `Task: ${labels}\nStatus: Failed\nReason: ${result.error}`,
            json: {
              message: `Task: ${labels}\nStatus: Failed\nReason: ${result.error}`,
              actions: detectedActions,
              status: "failed",
              error: result.error,
            },
          };
        }
      } else {
        // Step 3: No local intent — try the AI chat API for a text response
        try {
          const history = messages.map((m) => ({ role: m.role, text: m.text }));
          const res = await aiApi.sendMessage(convId, text, history);
          if (res.success && res.message) {
            reply = {
              id: "a-" + Date.now(),
              role: "agent",
              text: res.message,
              json: res.actions?.length > 0 ? { message: res.message, actions: res.actions } : null,
            };
          } else {
            throw new Error("No response");
          }
        } catch {
          reply = {
            id: "a-" + Date.now(),
            role: "agent",
            text: "I couldn't process that command. Try something like \"Enable Cart Drawer\" or \"Add Upsells\".",
            json: { message: "I couldn't process that command. Try something like \"Enable Cart Drawer\" or \"Add Upsells\"." },
          };
        }
      }

      setMessages((prev) => [...prev, reply]);
    } catch (e) {
      const errMsg = {
        id: "e-" + Date.now(),
        role: "agent",
        text: "Sorry, something went wrong. Please try again.",
        error: true,
      };
      setMessages((prev) => [...prev, errMsg]);
      setError(e.message);
    } finally {
      setLoading(null);
      setTyping(false);
    }
  }, [activeConvId, messages, createConversation]);

  const deleteConversation = useCallback(async (convId) => {
    setConversations((prev) => prev.filter((c) => c.id !== convId));
    if (activeConvId === convId) {
      setActiveConvId(null);
      setMessages([]);
    }
  }, [activeConvId]);

  const renameConversation = useCallback((convId, title) => {
    setConversations((prev) =>
      prev.map((c) => c.id === convId ? { ...c, title } : c)
    );
  }, []);

  return {
    conversations,
    activeConvId,
    messages,
    loading,
    typing,
    suggestions,
    tools,
    error,
    initialized,
    currentPage,
    createConversation,
    selectConversation,
    sendMessage,
    deleteConversation,
    renameConversation,
    setActiveConvId,
    setMessages,
    setConversations,
  };
}