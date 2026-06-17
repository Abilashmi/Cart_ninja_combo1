import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { featureStore } from "./featureStore";
import { aiApi } from "./api";
import "./CartNinjaAgentV2.css";

const MODULE_MAP = {
  cart_drawer: { store: "cart_drawer", name: "cartDrawer" },
  progress_bar: { store: "progress_bar", name: "progressBar" },
  coupon_slider: { store: "coupon_slider", name: "couponSlider" },
  upsells: { store: "upsells", name: "upsells" },
  trust_badges: { store: "trust_badges", name: "trustBadges" },
  fbt: { store: "fbt", name: "fbt" },
  coupon_banner: { store: "coupon_banner", name: "couponBanner" },
  coupon_creator: { store: "coupon_creator", name: "couponCreator" },
  combo_forge: { store: "combo_forge", name: "comboForge" },
  styling: { store: null, name: "styling" },
};

const MODULE_TO_ENGINE = {
  cartDrawer: { enable: "enableDrawer", disable: "disableDrawer", configureCartDrawer: "configureCartDrawer" },
  progressBar: { enable: "enableGoalBar", disable: "disableGoalBar", configureGoalBar: "configureGoalBar" },
  upsells: { enable: "enableUpsell", disable: "disableUpsell", configureUpsell: "configureUpsell" },
  fbt: { enable: "enableFBT", disable: "disableFBT", configureFBT: "configureFBT" },
  trustBadges: { enable: "enableTrustBadges", disable: "disableTrustBadges" },
  announcements: { enable: "enableAnnouncement", disable: "disableAnnouncement", configureAnnouncement: "configureAnnouncement" },
};

const ACTION_LABELS = {
  cartDrawer: "Cart Drawer",
  progressBar: "Progress Bar",
  upsells: "Upsells",
  fbt: "FBT",
  trustBadges: "Trust Badges",
  announcements: "Announcement",
  styling: "Styling",
  optimization: "Optimization",
  couponCreator: "Coupon Creator",
  comboForge: "Combo Forge",
};

const COLOR_MAP = {
  pink: "#FF69B4", red: "#EF4444", blue: "#3B82F6", green: "#22C55E",
  purple: "#A855F7", orange: "#F97316", yellow: "#EAB308", black: "#111827",
  white: "#F9FAFB", teal: "#14B8A6", indigo: "#6366F1", rose: "#F43F5E",
  violet: "#8B5CF6", gold: "#D97706", coral: "#F87171", navy: "#1E3A8A",
  cyan: "#06B6D4", lime: "#84CC16", amber: "#F59E0B", sky: "#0EA5E9",
};

const ACTION_CARDS = [
  { id: "fbt", icon: "bundle", title: "Generate FBT", desc: "Build product bundles for higher order value.", query: "Generate FBT products for my store" },
  { id: "upsell", icon: "trend", title: "Create Upsell", desc: "Add relevant cart recommendations.", query: "Set up upsell offers" },
  { id: "rewards", icon: "reward", title: "Configure Rewards", desc: "Set up reward progress and incentives.", query: "Configure rewards program" },
  { id: "coupon", icon: "coupon", title: "Create Coupon", desc: "Prepare a discount campaign.", query: "Create a coupon discount" },
  { id: "analyze", icon: "chart", title: "Analyze Store", desc: "Review conversion opportunities.", query: "Analyze my store performance" },
  { id: "optimize", icon: "cart", title: "Optimize Cart", desc: "Tune the drawer for conversion.", query: "Optimize cart for conversions" },
];

const MODULES_LIST = [
  { k: "cart_drawer", label: "Cart Drawer" },
  { k: "progress_bar", label: "Progress Bar" },
  { k: "coupon_slider", label: "Coupon Slider" },
  { k: "upsells", label: "Upsells" },
  { k: "trust_badges", label: "Trust Badges" },
  { k: "fbt", label: "Frequently Bought Together" },
  { k: "coupon_banner", label: "Coupon Banner" },
  { k: "coupon_creator", label: "Coupon Creator" },
  { k: "combo_forge", label: "Combo Forge" },
];

function syncAfterToFeatureStore(after) {
  if (!after) return;
  const { cart, fbt } = after;
  if (cart) {
    if (cart.drawerEnabled != null) featureStore.set("cart_drawer", cart.drawerEnabled);
    if (cart.upsell?.enabled != null) featureStore.set("upsells", cart.upsell.enabled);
    if (cart.goalBar?.enabled != null) featureStore.set("progress_bar", cart.goalBar.enabled);
    if (cart.trustBadges?.enabled != null) featureStore.set("trust_badges", cart.trustBadges.enabled);
    if (cart.announcement?.enabled != null) featureStore.set("announcements", cart.announcement.enabled);
    if (cart.couponSlider?.enabled != null) featureStore.set("coupon_slider", cart.couponSlider.enabled);
    window.dispatchEvent(new CustomEvent("cartEditorConfigUpdated", { detail: cart }));
  }
  if (fbt?.enabled != null) featureStore.set("fbt", fbt.enabled);
}

function invertAction(action) {
  if (action === "enable") return "disable";
  if (action === "disable") return "enable";
  return action;
}

function undoAction(action) {
  const entry = Object.entries(MODULE_MAP).find(([, v]) => v.name === action.module);
  const storeKey = entry?.[1]?.store;
  try {
    const raw = localStorage.getItem("cartninja_cart_config");
    if (raw) {
      const cfg = JSON.parse(raw);
      if (action.action === "update") {
        if (action.module === "styling" && action.settings?.target === "checkout_button") delete cfg.checkoutButtonStyle;
        if (action.module === "cartDrawer") {
          delete cfg.drawerTheme;
          delete cfg.drawerBorderRadius;
        }
      }
      if (storeKey && cfg.moduleStates) cfg.moduleStates[storeKey] = invertAction(action.action) === "enable";
      localStorage.setItem("cartninja_cart_config", JSON.stringify(cfg));
    }
  } catch {}
  if (action.action === "update") {
    if (storeKey) featureStore.removeSettings(storeKey);
    featureStore.removeSettings(action.module);
  } else if (storeKey) {
    const inverted = invertAction(action.action);
    if (inverted === "enable" || inverted === "disable") featureStore.set(storeKey, inverted === "enable");
  }
}

function extractActions(text) {
  const lower = text.toLowerCase();
  const actions = [];
  const wantDisable = /disable|turn off|deactiv|remove|stop|hide|close/.test(lower);

  if (/(?:apply|set|use|enable)?\s*(premium\s*dark|dark\s*(?:theme|preset))/i.test(lower)) {
    return [{ module: "styling", action: "applyTemplate", engine: "applyTemplate", settings: { template: "premium" }, label: "Premium Dark Theme" }];
  }
  if (/(?:apply|set|use|enable)?\s*(minimal\s*light|light\s*(?:theme|preset))/i.test(lower)) {
    return [{ module: "styling", action: "applyTemplate", engine: "applyTemplate", settings: { template: "minimal" }, label: "Minimal Light Theme" }];
  }
  if (/(?:apply|set|use|enable)?\s*(luxury\s*gold|gold\s*(?:theme|preset))/i.test(lower)) {
    return [{ module: "styling", action: "applyTemplate", engine: "applyTemplate", settings: { template: "luxury" }, label: "Luxury Gold Theme" }];
  }
  if (/match.?theme|sync.?theme|detect.?theme|auto.?theme|copy.?theme/i.test(lower)) {
    return [{ module: "styling", action: "matchTheme", engine: "matchTheme", label: "Match Store Theme" }];
  }
  if (/optimize.*mobile|mobile.*optimize|responsive/i.test(lower)) {
    return [{ module: "optimization", action: "optimizeMobile", engine: "optimizeMobile", label: "Optimize Mobile" }];
  }
  if (/create.*bundle|bundle.*offer|combo.*forge/i.test(lower)) {
    return [{ module: "comboForge", action: "createBundle", engine: "createBundle", label: "Create Bundle" }];
  }

  const colorRx = new RegExp(`\\b(${Object.keys(COLOR_MAP).join("|")}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\\b`, "i");
  const colorMatch = lower.match(colorRx);
  if (colorMatch && /(color|theme|style|everything|all|entire|whole|cart|customiz|brand|make|set|use|apply)/i.test(lower)) {
    const colorName = colorMatch[1].toLowerCase();
    const hex = colorName.startsWith("#") ? colorName.toUpperCase() : COLOR_MAP[colorName];
    return [{ module: "styling", action: "updateStyling", engine: "updateStyling", settings: { accentColor: hex }, label: `Apply ${colorMatch[1]} Theme` }];
  }

  const isFullSetup = /set.?up|config|full|complete|setup|install/i.test(lower);
  const isCartDrawer = /cart.*drawer|drawer/.test(lower);
  const isGoalBar = /progress.?bar|goal|free.?shipping|shipping.?progress|reward/i.test(lower);
  const isFbt = /fbt|frequently.*bought/i.test(lower);
  const isUpsell = /upsell/i.test(lower) && !isFbt;
  const isCoupon = /coupon|discount|offer/i.test(lower);
  const isAnalyze = /audit|analy[sz]e|performance|health|diagnos|opportunit/i.test(lower);
  const isOptimize = /optimi[sz]e|conversion|aov|revenue/i.test(lower);

  if (wantDisable) {
    if (isCartDrawer) actions.push({ module: "cartDrawer", action: "disable", engine: "disableDrawer", label: "Disable Cart Drawer" });
    if (isGoalBar) actions.push({ module: "progressBar", action: "disable", engine: "disableGoalBar", label: "Disable Rewards" });
    if (isUpsell) actions.push({ module: "upsells", action: "disable", engine: "disableUpsell", label: "Disable Upsells" });
    if (isFbt) actions.push({ module: "fbt", action: "disable", engine: "disableFBT", label: "Disable FBT" });
    return actions;
  }

  if (isCartDrawer) actions.push({ module: "cartDrawer", action: isFullSetup ? "configureCartDrawer" : "enable", engine: isFullSetup ? "configureCartDrawer" : "enableDrawer", settings: { enabled: true }, label: isFullSetup ? "Configure Cart Drawer" : "Enable Cart Drawer" });
  if (isGoalBar) actions.push({ module: "progressBar", action: "configureGoalBar", engine: "configureGoalBar", settings: { enabled: true }, label: "Configure Rewards" });
  if (isUpsell) actions.push({ module: "upsells", action: isFullSetup ? "configureUpsell" : "enable", engine: isFullSetup ? "configureUpsell" : "enableUpsell", settings: { enabled: true, layout: "slider", template: "modern" }, label: isFullSetup ? "Configure Upsells" : "Create Upsell" });
  if (isFbt) actions.push({ module: "fbt", action: isFullSetup ? "configureFBT" : "enable", engine: isFullSetup ? "configureFBT" : "enableFBT", settings: { enabled: true, template: "fbt2", mode: "ai" }, label: isFullSetup ? "Configure FBT" : "Generate FBT" });
  if (isCoupon) actions.push({ module: "couponCreator", action: "enable", engine: "enableCouponCreator", settings: { enabled: true }, label: "Create Coupon" });
  if (isAnalyze) actions.push({ module: "optimization", action: "analyzeStore", engine: "analyzeStore", label: "Analyze Store" });
  if (isOptimize && !actions.some(a => a.module === "optimization")) actions.push({ module: "optimization", action: "optimizeCart", engine: "optimizeCart", label: "Optimize Cart" });

  return actions;
}

async function applyActionsViaApi(actions) {
  if (!actions.length) return { success: false, error: "No actions" };
  const supported = actions.filter(a => a.engine || MODULE_TO_ENGINE[a.module]?.[a.action]);
  if (!supported.length) return { success: false, error: "Unsupported action" };
  const engineActions = supported.map(a => a.engine || MODULE_TO_ENGINE[a.module]?.[a.action]);
  const planSettings = supported.reduce((settings, action) => {
    if (action.settings) Object.assign(settings, action.settings);
    return settings;
  }, {});
  try {
    const res = await fetch("/api/ai-agent/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "", plan: { summary: "AI command", actions: engineActions, settings: planSettings }, mode: "apply" }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      return { success: false, error: err.error || `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { success: true, before: data.before, after: data.after, rawCartBefore: data.rawCartBefore, synced: data.synced };
  } catch (error) {
    return { success: false, error: error.message || "Network error" };
  }
}

function useFeatureState(key) {
  return useSyncExternalStore(featureStore.subscribe, () => featureStore.get(key), () => featureStore.get(key));
}

function formatTime(ts) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
}

function generateTitle(text) {
  const clean = text.replace(/\b(please|can you|could you|i want to|need|want)\b/gi, "").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 42) : "New Chat";
}

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

function Icon({ name, size = 18 }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" };
  const paths = {
    logo: <><path d="M6 8h3l2 8h6l2-6h-4" /><circle cx="9" cy="19" r="1.3" /><circle cx="17" cy="19" r="1.3" /><path d="M14 8V5a2 2 0 0 0-4 0v3" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></>,
    close: <path d="M7 7l10 10M17 7 7 17" />,
    send: <path d="M4 12 20 5l-6 14-3-6-7-1z" />,
    mic: <><rect x="9" y="3" width="6" height="10" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></>,
    bundle: <><rect x="4" y="5" width="7" height="7" rx="2" /><rect x="13" y="12" width="7" height="7" rx="2" /><path d="M11 8h3M10 12l3 3" /></>,
    trend: <path d="M4 17 10 11l4 4 6-8" />,
    reward: <><circle cx="12" cy="8" r="4" /><path d="M8.5 11.5 7 21l5-3 5 3-1.5-9.5" /></>,
    coupon: <><path d="M4 8a2 2 0 0 0 0 4v4h16v-4a2 2 0 0 0 0-4V4H4z" /><path d="M9 8h.01M15 12h.01M10 14l4-8" /></>,
    chart: <><path d="M4 19V5" /><path d="M4 19h16" /><rect x="7" y="11" width="3" height="5" /><rect x="12" y="8" width="3" height="8" /><rect x="17" y="5" width="3" height="11" /></>,
    cart: <><path d="M5 5h2l2 10h8l2-7H8" /><circle cx="10" cy="20" r="1.5" /><circle cx="17" cy="20" r="1.5" /></>,
    check: <path d="M5 12l4 4L19 6" />,
    running: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="M5.6 5.6 8.4 8.4M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" /></>,
    failed: <path d="M7 7l10 10M17 7 7 17" />,
    trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" /></>,
    preview: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
    publish: <><path d="M12 19V5M6 11l6-6 6 6" /><path d="M5 21h14" /></>,
    undo: <><path d="M4 7v6h6" /><path d="M20 17a8 8 0 0 0-14-5" /></>,
    edit: <><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13 7l4 4" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function ModuleRow({ storeKey, label }) {
  const enabled = useFeatureState(storeKey);
  return (
    <div className="cnv4-module-row">
      <span>{label}</span>
      <span className={enabled ? "cnv4-mini-badge success" : "cnv4-mini-badge muted"}>{enabled ? "Active" : "Inactive"}</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const normalized = status || "success";
  const icon = normalized === "failed" ? "failed" : normalized === "running" ? "running" : "check";
  const label = normalized === "failed" ? "Failed" : normalized === "running" ? "Running" : "Success";
  return <span className={`cnv4-status ${normalized}`}><Icon name={icon} size={13} />{label}</span>;
}

function EmptyState() {
  return (
    <div className="cnv4-empty">
      <div className="cnv4-empty-mark"><Icon name="logo" size={30} /></div>
      <h2>Ready to optimize your cart</h2>
      <p>Choose an action card or ask the agent to configure, analyze, or improve store features.</p>
    </div>
  );
}

export default function CartNinjaAgentV2({ initialQuery = "", onClose }) {
  const [input, setInput] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activity, setActivity] = useState([]);
  const [pendingChanges, setPendingChanges] = useState([]);
  const [conversation, setConversation] = useState([]);
  const [selectedChangeId, setSelectedChangeId] = useState(null);
  const textareaRef = useRef(null);
  const contentRef = useRef(null);

  const selectedChange = useMemo(
    () => pendingChanges.find(change => change.id === selectedChangeId) || pendingChanges[0] || null,
    [pendingChanges, selectedChangeId],
  );

  useEffect(() => {
    if (initialQuery) {
      setInput(initialQuery);
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [initialQuery]);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [activity.length, pendingChanges.length]);

  const addPendingChange = useCallback((action, result, prompt) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const label = action.label || ACTION_LABELS[action.module] || "Store action";
    const change = {
      id,
      action,
      title: label,
      summary: `${label} prepared from "${prompt}".`,
      timestamp: Date.now(),
      rawCartBefore: result?.rawCartBefore,
      before: result?.before,
    };
    setPendingChanges(prev => [change, ...prev].slice(0, 8));
    setSelectedChangeId(id);
    return change;
  }, []);

  const addActivity = useCallback((item) => {
    setActivity(prev => [{ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, timestamp: Date.now(), ...item }, ...prev].slice(0, 12));
  }, []);

  const handleUndo = useCallback(async (change = selectedChange) => {
    if (!change) return;
    if (change.rawCartBefore) {
      try {
        await fetch("/app/cartdrawer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intent: "saveCartConfig", ...change.rawCartBefore }),
        });
        if (change.before?.cart) syncAfterToFeatureStore({ cart: change.before.cart });
      } catch {}
    } else {
      undoAction(change.action);
    }
    setPendingChanges(prev => prev.filter(item => item.id !== change.id));
    addActivity({ title: `Undid ${change.title}`, detail: "Change removed from the workspace.", status: "success" });
  }, [addActivity, selectedChange]);

  const runPrompt = useCallback(async (prompt) => {
    const text = prompt.trim();
    if (!text || loading) return;

    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setLoading(true);
    setConversation(prev => [...prev, { role: "user", text, timestamp: Date.now() }]);
    addActivity({ title: "Agent started", detail: generateTitle(text), status: "running" });

    const actions = extractActions(text);
    if (actions.length) {
      const result = await applyActionsViaApi(actions);
      if (result.success) {
        syncAfterToFeatureStore(result.after);
        actions.forEach(action => addPendingChange(action, result, text));
        addActivity({
          title: actions.length === 1 ? actions[0].label : `${actions.length} changes prepared`,
          detail: "Review the pending changes before publishing.",
          status: "success",
        });
        setConversation(prev => [...prev, { role: "agent", text: "I prepared the requested store updates. Review them in Pending Changes, then publish when ready.", timestamp: Date.now() }]);
      } else {
        addActivity({ title: "Action failed", detail: result.error || "The action could not be completed.", status: "failed" });
        setConversation(prev => [...prev, { role: "agent", text: result.error || "I could not complete that action.", timestamp: Date.now() }]);
      }
      setLoading(false);
      return;
    }

    try {
      const res = await aiApi.sendMessage("cart-ninja-agent", text, conversation.map(m => ({ role: m.role, text: m.text })));
      if (res.success && res.message) {
        syncAfterToFeatureStore(res.after);
        addActivity({ title: "Analysis completed", detail: res.summary || generateTitle(text), status: "success" });
        setConversation(prev => [...prev, { role: "agent", text: res.message, timestamp: Date.now() }]);
      } else {
        throw new Error("No response");
      }
    } catch {
      addActivity({ title: "Agent response failed", detail: "Try a Cart Ninja setup, campaign, or optimization request.", status: "failed" });
      setConversation(prev => [...prev, { role: "agent", text: "I can help with Cart Ninja modules, campaigns, cart styling, and store optimization.", timestamp: Date.now() }]);
    } finally {
      setLoading(false);
    }
  }, [addActivity, addPendingChange, conversation, loading]);

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      runPrompt(input);
    }
  };

  const handleNewChat = () => {
    setInput("");
    setConversation([]);
    setActivity([]);
    setPendingChanges([]);
    setSelectedChangeId(null);
    setShowSettings(false);
  };

  const handleRemoveChange = (id) => {
    setPendingChanges(prev => prev.filter(change => change.id !== id));
    if (selectedChangeId === id) setSelectedChangeId(null);
  };

  const handlePublish = () => {
    if (!pendingChanges.length) return;
    addActivity({ title: "Published changes", detail: `${pendingChanges.length} change${pendingChanges.length === 1 ? "" : "s"} marked as published.`, status: "success" });
    setPendingChanges([]);
    setSelectedChangeId(null);
  };

  return (
    <div className="cnv4-root">
      <header className="cnv4-header">
        <div className="cnv4-brand-block">
          <div className="cnv4-logo"><Icon name="logo" size={18} /></div>
          <div>
            <h1>Cart Ninja AI Agent</h1>
            <span className="cnv4-connected"><span />Connected</span>
          </div>
        </div>
        <div className="cnv4-header-actions">
          <button className="cnv4-header-btn primary" onClick={handleNewChat}><Icon name="plus" size={15} />New Chat</button>
          <button className="cnv4-icon-btn" onClick={() => setShowSettings(true)} aria-label="Settings" title="Settings"><Icon name="settings" size={16} /></button>
          {onClose && <button className="cnv4-icon-btn" onClick={onClose} aria-label="Close" title="Close"><Icon name="close" size={16} /></button>}
        </div>
      </header>

      <main className="cnv4-workspace">
        <section className="cnv4-content" ref={contentRef}>
          <div className="cnv4-action-grid">
            {ACTION_CARDS.map(card => (
              <button key={card.id} className="cnv4-action-card" onClick={() => runPrompt(card.query)} disabled={loading}>
                <span className="cnv4-action-icon"><Icon name={card.icon} size={20} /></span>
                <span className="cnv4-action-title">{card.title}</span>
                <span className="cnv4-action-desc">{card.desc}</span>
              </button>
            ))}
          </div>

          <div className="cnv4-sections">
            <section className="cnv4-panel cnv4-activity">
              <div className="cnv4-section-head">
                <div>
                  <h2>Agent Activity</h2>
                  <p>Completed tasks and current agent state.</p>
                </div>
                {loading && <StatusBadge status="running" />}
              </div>
              <div className="cnv4-panel-scroll">
                {activity.length === 0 ? (
                  <EmptyState />
                ) : (
                  activity.map(item => (
                    <article key={item.id} className="cnv4-activity-card">
                      <div className="cnv4-activity-icon"><Icon name={item.status === "failed" ? "failed" : item.status === "running" ? "running" : "check"} size={16} /></div>
                      <div className="cnv4-activity-body">
                        <div className="cnv4-activity-top">
                          <h3>{item.title}</h3>
                          <StatusBadge status={item.status} />
                        </div>
                        <p>{item.detail}</p>
                        <time><Icon name="clock" size={12} />{formatTime(item.timestamp)}</time>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>

            <section className="cnv4-panel cnv4-pending">
              <div className="cnv4-section-head">
                <div>
                  <h2>Pending Changes</h2>
                  <p>Review store changes before publishing.</p>
                </div>
                <span className="cnv4-count">{pendingChanges.length}</span>
              </div>
              <div className="cnv4-panel-scroll">
                {pendingChanges.length === 0 ? (
                  <div className="cnv4-pending-empty">
                    <Icon name="edit" size={22} />
                    <span>No pending changes</span>
                  </div>
                ) : (
                  pendingChanges.map(change => (
                    <article key={change.id} className={`cnv4-change-card${selectedChange?.id === change.id ? " selected" : ""}`} onClick={() => setSelectedChangeId(change.id)}>
                      <div>
                        <h3>{change.title}</h3>
                        <p>{change.summary}</p>
                        <time>{formatTime(change.timestamp)}</time>
                      </div>
                      <button className="cnv4-remove" onClick={(event) => { event.stopPropagation(); handleRemoveChange(change.id); }} aria-label={`Remove ${change.title}`}>
                        <Icon name="trash" size={15} />
                      </button>
                    </article>
                  ))
                )}
              </div>
            </section>
          </div>

          {conversation.length > 0 && (
            <section className="cnv4-panel cnv4-conversation">
              <div className="cnv4-section-head">
                <div>
                  <h2>Agent Notes</h2>
                  <p>Clean summaries only, no raw technical logs.</p>
                </div>
              </div>
              <div className="cnv4-note-list">
                {conversation.slice(-4).map((msg, index) => (
                  <div key={`${msg.timestamp}-${index}`} className={`cnv4-note ${msg.role}`}>
                    <span>{msg.role === "user" ? "You" : "Agent"}</span>
                    <p>{msg.text}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </section>

        <section className="cnv4-composer-wrap">
          <div className="cnv4-composer">
            <textarea
              ref={textareaRef}
              value={input}
              rows={1}
              placeholder="Ask the agent to build bundles, create offers, audit your store, or optimize the cart..."
              onChange={(event) => { setInput(event.target.value); autoResize(event.target); }}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <div className="cnv4-composer-actions">
              <button className="cnv4-icon-btn" title="Voice" aria-label="Voice"><Icon name="mic" size={17} /></button>
              <button className="cnv4-send" disabled={!input.trim() || loading} onClick={() => runPrompt(input)} aria-label="Send">
                <Icon name="send" size={17} />
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="cnv4-footer">
        <div className="cnv4-footer-summary">
          <strong>{pendingChanges.length} pending</strong>
          <span>{selectedChange ? selectedChange.title : "No change selected"}</span>
        </div>
        <div className="cnv4-footer-actions">
          <button><Icon name="preview" size={15} />Preview</button>
          <button className="primary" onClick={handlePublish} disabled={!pendingChanges.length}><Icon name="publish" size={15} />Publish</button>
          <button onClick={() => handleUndo()} disabled={!selectedChange}><Icon name="undo" size={15} />Undo</button>
          <button disabled={!selectedChange}><Icon name="edit" size={15} />Edit</button>
        </div>
      </footer>

      {showSettings && (
        <div className="cnv4-drawer-backdrop" onClick={() => setShowSettings(false)}>
          <aside className="cnv4-settings" onClick={(event) => event.stopPropagation()}>
            <div className="cnv4-settings-head">
              <div>
                <h2>Module Status</h2>
                <p>Live Cart Ninja feature state.</p>
              </div>
              <button className="cnv4-icon-btn" onClick={() => setShowSettings(false)} aria-label="Close settings"><Icon name="close" size={16} /></button>
            </div>
            <div className="cnv4-settings-list">
              {MODULES_LIST.map(module => <ModuleRow key={module.k} storeKey={module.k} label={module.label} />)}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
