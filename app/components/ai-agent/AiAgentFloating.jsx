import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "react-router";
import { executeActions, undoAction, generateTitle, getTimeGroup, MODULE_MAP } from "./AiAgent";
import { featureStore } from "./featureStore";
import useAiAgent from "./useAiAgent";
import { aiApi } from "./api";
import AILoadingState from "./AILoadingState";
import AIChangesSummary from "./AIChangesSummary";
import AINeedsInputCard from "./AINeedsInputCard";
import "./ai-agent.css";
import {
  BRAND, QUICK_ACTIONS, PAGE_AWARE_PROMPTS, WELCOME_MESSAGE,
  PREDICTIVE_SUGGESTIONS, EXAMPLE_PROMPTS, UNRELATED_RESPONSE
} from "./constants";

const AI_ICON = (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2l2 4 4 2-4 2-2 4-2-4-4-2 4-2 2-4z" />
    <path d="M6 12l-2 4 4 2" />
    <path d="M18 12l2 4-4 2" />
    <path d="M12 18l2 4h-4l2-4z" />
  </svg>
);



const CLOSE_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

const SEND_ICON = (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M2 8l12-4-4 8-3-3-3-3z" />
  </svg>
);

const COPY_ICON = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="6" width="8" height="8" rx="1" />
    <path d="M2 10V3a1 1 0 011-1h7" />
  </svg>
);

const SETTINGS_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="8" cy="8" r="2"/>
    <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/>
  </svg>
);

const CHECK_ICON = (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7l3 3 5-5" />
  </svg>
);

const MONITOR_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <rect x="1" y="3" width="14" height="10" rx="1.5" />
    <path d="M5 13l6 2M8 13v2" />
  </svg>
);

const GEAR_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="8" cy="8" r="2.5"/>
    <path d="M8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.3 3.3l1.06 1.06M11.64 11.64l1.06 1.06M3.3 12.7l1.06-1.06M11.64 4.36l1.06-1.06"/>
  </svg>
);

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

function getModuleState(key) {
  return { enabled: featureStore.get(key), settings: featureStore.getSettings(key) };
}

const MODULE_LABELS = {
  cart_drawer: "Cart Drawer", progress_bar: "Progress Bar", coupon_slider: "Coupon Slider",
  upsells: "Upsells", trust_badges: "Trust Badges", fbt: "FBT",
  coupon_banner: "Coupon Banner", coupon_creator: "Coupon Creator", combo_forge: "Combo Forge"
};

const MODULES = Object.keys(MODULE_LABELS);

const SUGGESTION_CHIPS = [
  "Enable Cart Drawer",
  "Free Shipping Goal",
  "Add Upsells",
  "Apply Premium Dark",
  "Analyze Revenue",
  "Optimize Mobile"
];

const LOADING_STEPS = [
  "Analyzing Store...",
  "Generating Configuration...",
  "Applying Changes...",
  "Verifying Results..."
];

export default function AiAgentFloating() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [pendingContext, setPendingContext] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileTab, setMobileTab] = useState("chat");
  const [showContextMenu, setShowContextMenu] = useState(null);
  const [predictiveSugs, setPredictiveSugs] = useState([]);
  const [notification, setNotification] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [flashModules, setFlashModules] = useState([]);
  const flashTimerRef = useRef(null);

  const location = useLocation();
  const {
    conversations, activeConvId, messages, loading, typing,
    suggestions, tools, initialized, currentPage,
    createConversation, selectConversation, sendMessage,
    deleteConversation, renameConversation,
    setActiveConvId, setMessages, setConversations,
  } = useAiAgent(location);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const pagePrompts = useMemo(() => {
    return PAGE_AWARE_PROMPTS[currentPage] || PAGE_AWARE_PROMPTS["/app"];
  }, [currentPage]);

  const NVIDIA_TO_FEATURE_KEY = {
    enable_cart_drawer: "cart_drawer",
    disable_cart_drawer: "cart_drawer",
    enable_upsell: "upsells",
    disable_upsell: "upsells",
    enable_fbt: "fbt",
    disable_fbt: "fbt",
    enable_goal_bar: "progress_bar",
    disable_goal_bar: "progress_bar",
    enable_trust_badges: "trust_badges",
    disable_trust_badges: "trust_badges",
    enable_announcement: "announcements",
    disable_announcement: "announcements",
  };

  const NVIDIA_TO_BOOL = {
    enable_cart_drawer: true,
    disable_cart_drawer: false,
    enable_upsell: true,
    disable_upsell: false,
    enable_fbt: true,
    disable_fbt: false,
    enable_goal_bar: true,
    disable_goal_bar: false,
    enable_trust_badges: true,
    disable_trust_badges: false,
    enable_announcement: true,
    disable_announcement: false,
  };

  useEffect(() => {
    setMounted(true);
    try { const hasNotif = localStorage.getItem("aia_notification"); if (hasNotif === "true") setNotification(true); } catch {}
  }, []);

  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.executedActions?.length > 0 && lastMsg?.synced) {
      // Prefer syncing from actual DB `after` state — covers configure_* actions too
      const after = lastMsg.after;
      if (after?.cart) {
        if (after.cart.goalBar?.enabled != null) featureStore.set("progress_bar", after.cart.goalBar.enabled);
        if (after.cart.upsell?.enabled != null) featureStore.set("upsells", after.cart.upsell.enabled);
        if (after.cart.drawerEnabled != null) featureStore.set("cart_drawer", after.cart.drawerEnabled);
        if (after.cart.trustBadges?.enabled != null) featureStore.set("trust_badges", after.cart.trustBadges.enabled);
        if (after.cart.announcement?.enabled != null) featureStore.set("announcements", after.cart.announcement.enabled);
        if (after.cart.couponSlider?.enabled != null) featureStore.set("coupon_slider", after.cart.couponSlider.enabled);
        if (after.cart.checkoutButton?.backgroundColor) {
          try {
            const cfgKey = "cartninja_cart_config";
            const raw = localStorage.getItem(cfgKey);
            const cfg = raw ? JSON.parse(raw) : {};
            cfg.checkoutButtonStyle = {
              backgroundColor: after.cart.checkoutButton.backgroundColor,
              textColor: after.cart.checkoutButton.textColor || "#ffffff",
              borderRadius: after.cart.checkoutButton.borderRadius ?? 4,
            };
            localStorage.setItem(cfgKey, JSON.stringify(cfg));
            window.dispatchEvent(new CustomEvent("featureStateChanged", { detail: { key: "checkout_style" } }));
          } catch {}
        }
      }
      if (after?.fbt?.enabled != null) featureStore.set("fbt", after.fbt.enabled);

      // Fallback: use action type map for enable/disable actions without `after`
      if (!after) {
        const conv = conversations.find((c) => c.id === activeConvId);
        if (conv) {
          lastMsg.actions.forEach((act) => {
            const key = NVIDIA_TO_FEATURE_KEY[act.type];
            if (key) featureStore.set(key, NVIDIA_TO_BOOL[act.type]);
          });
        }
      }
    }
  }, [messages, activeConvId, conversations]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    if (open && inputRef.current) setTimeout(() => inputRef.current.focus(), 150);
  }, [open]);

  useEffect(() => {
    function handler(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [open]);

  useEffect(() => {
    if (input.length > 1) {
      const lower = input.toLowerCase();
      const matches = PREDICTIVE_SUGGESTIONS
        .filter((ps) => lower.startsWith(ps.prefix))
        .flatMap((ps) => ps.suggestions);
      const filtered = matches.filter((s) => s.toLowerCase().includes(lower));
      setPredictiveSugs(filtered.length > 0 ? filtered.slice(0, 3) : []);
    } else {
      setPredictiveSugs([]);
    }
  }, [input]);

  useEffect(() => {
    if (showContextMenu) {
      function close() { setShowContextMenu(null); }
      document.addEventListener("click", close);
      return () => document.removeEventListener("click", close);
    }
  }, [showContextMenu]);

  useEffect(() => {
    if (loading) {
      setShowSettings(true);
      const interval = setInterval(() => {
        setLoadingStep((prev) => (prev < 3 ? prev + 1 : 3));
      }, 2000);
      return () => clearInterval(interval);
    } else {
      setLoadingStep(0);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    }
  }, [loading]);

  // Detect affected modules from the last agent message and flash them
  useEffect(() => {
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last?.role === "agent" && last?.json?.actions?.length > 0) {
      const storeKeys = last.json.actions.map((a) => {
        const entry = Object.entries(MODULE_MAP).find(([, v]) => v.name === a.module);
        return entry?.[1]?.store || a.module;
      }).filter(Boolean);
      setFlashModules(storeKeys);
      setShowSettings(true);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => { setFlashModules([]); setShowSettings(false); }, 4000);
    }
  }, [messages]);

  const handleSend = useCallback((text) => {
    if (!text.trim() || loading) return;
    setInput("");
    setPredictiveSugs([]);
    sendMessage(text);
  }, [sendMessage, loading]);

  const handleAnswer = useCallback((answer) => {
    const context = pendingContext;
    setPendingContext(null);
    let fullQuery = answer;
    if (context) {
      const base = context.replace(/\s*(please|thanks|thank you).*$/i, "").trim();
      if (!answer.includes(base)) fullQuery = base + " with " + answer;
    }
    handleSend(fullQuery);
  }, [pendingContext, handleSend]);

  const handleUndo = useCallback(async (action, rawCartBefore, before) => {
    if (rawCartBefore) {
      try {
        await fetch('/app/cartdrawer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intent: 'saveCartConfig', ...rawCartBefore }),
        });
        if (before?.cart) {
          window.dispatchEvent(new CustomEvent('cartEditorConfigUpdated', { detail: before.cart }));
        }
      } catch (err) {
        console.error('[AiAgent] Undo DB restore failed:', err);
      }
    } else {
      undoAction(action);
    }
    setMessages((prev) => [...prev, {
      id: "u-" + Date.now(), role: "agent", type: "json",
      json: { status: "undo", message: "Action undone", action }
    }]);
  }, []);

  const handleNewChat = useCallback(() => {
    createConversation();
    setInput("");
    setPendingContext(null);
    setPredictiveSugs([]);
    setShowSettings(false);
  }, [createConversation]);

  const handleSelectConversation = useCallback((convId) => {
    setInput("");
    setPendingContext(null);
    setShowContextMenu(null);
    setShowSettings(false);
    selectConversation(convId);
  }, [selectConversation]);

  const handleRenameConversation = useCallback((convId) => {
    const newName = prompt("Rename conversation:");
    if (!newName?.trim()) return;
    renameConversation(convId, newName.trim());
    setShowContextMenu(null);
  }, [renameConversation]);

  const handleDeleteConversation = useCallback((convId) => {
    if (!confirm("Delete this conversation?")) return;
    deleteConversation(convId);
    if (activeConvId === convId) {
    }
    setShowContextMenu(null);
  }, [deleteConversation, activeConvId]);

  const handlePinConversation = useCallback((convId) => {
    setConversations((prev) =>
      prev.map((c) => c.id === convId ? { ...c, pinned: !c.pinned } : c)
    );
    setShowContextMenu(null);
  }, []);

  const handleArchiveConversation = useCallback((convId) => {
    setConversations((prev) =>
      prev.map((c) => c.id === convId ? { ...c, archived: true } : c)
    );
    if (activeConvId === convId) {
      setMessages([]);
      setActiveConvId(null);
    }
    setShowContextMenu(null);
  }, [activeConvId]);

  const handleInputKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !loading) handleSend(input);
    }
  };

  const handleCopyMessage = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch { /* ignore */ }
  };

  const handleRegenerate = () => {
    if (messages.length < 2) return;
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMsg) {
      setMessages((prev) => prev.slice(0, -1));
      handleSend(lastUserMsg.text);
    }
  };

  const getConvTs = useCallback((c) => {
    if (c.ts) return c.ts;
    if (c.updatedAt) return new Date(c.updatedAt).getTime();
    return Date.now();
  }, []);

  const groupedConversations = useMemo(() => {
    const pinned = conversations.filter((c) => c.pinned && !c.archived);
    const active = conversations.filter((c) => !c.pinned && !c.archived);
    const today = active.filter((c) => getTimeGroup(getConvTs(c)) === "Today");
    const yesterday = active.filter((c) => getTimeGroup(getConvTs(c)) === "Yesterday");
    const last7 = active.filter((c) => getTimeGroup(getConvTs(c)) === "Last 7 Days");
    const last30 = active.filter((c) => {
      const group = getTimeGroup(getConvTs(c));
      return group === "Last 30 Days" || (group !== "Today" && group !== "Yesterday" && group !== "Last 7 Days" && group !== "Older");
    });
    const older = active.filter((c) => getTimeGroup(getConvTs(c)) === "Older" || getTimeGroup(getConvTs(c)) === "Last 30 Days");
    return { pinned, today, yesterday, last7, last30, older };
  }, [conversations, getConvTs]);

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return groupedConversations;
    const q = searchQuery.toLowerCase();
    const filter = (list) => list.filter((c) => c.title.toLowerCase().includes(q));
    return {
      pinned: filter(groupedConversations.pinned),
      today: filter(groupedConversations.today),
      yesterday: filter(groupedConversations.yesterday),
      last7: filter(groupedConversations.last7),
      last30: filter(groupedConversations.last30),
      older: filter(groupedConversations.older),
    };
  }, [searchQuery, groupedConversations]);

  const showWelcome = !loading && messages.length === 0;

  function renderMessage(msg) {
    const isUser = msg.role === "user";
    const j = msg.json;

    if (isUser) {
      return (
        <div key={msg.id} className="aiff-msg aiff-msg-user">
          <div className="aiff-bubble aiff-bubble-user">{msg.text}</div>
        </div>
      );
    }

    if (msg.type === "scraping") {
      const completedCount = (msg.steps || []).filter(s => s.done).length;
      const totalCount = (msg.steps || []).length;
      const pct = totalCount > 1 ? Math.round((completedCount / (totalCount - 1)) * 100) : 0;
      return (
        <div key={msg.id} className="aiff-msg aiff-msg-agent">
          <div className="aiff-scraping-card">
            <div className="aiff-scraping-header">
              <div className="aiff-scraping-header-left">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                <span className="aiff-scraping-title-text">
                  {msg.isDesign ? "Scanning Storefront" : "Analyzing Request"}
                </span>
              </div>
              <span className="aiff-scraping-live-badge">LIVE</span>
            </div>
            {msg.isDesign && (
              <div className="aiff-scraping-url">
                <span className="aiff-scraping-url-dot" />
                scraping live store data...
              </div>
            )}
            <div className="aiff-scraping-progress-bar">
              <div className="aiff-scraping-progress-fill" style={{ width: pct + "%" }} />
            </div>
            <div className="aiff-scraping-steps">
              {(msg.steps || []).map((step, i) => (
                <div key={i} className={"aiff-scraping-step" + (step.done ? " aiff-scraping-step--done" : step.active ? " aiff-scraping-step--active" : "")}>
                  <span className="aiff-scraping-step-icon">
                    {step.done
                      ? CHECK_ICON
                      : step.active
                      ? <span className="aiff-scraping-spinner" />
                      : <span className="aiff-scraping-dot" />
                    }
                  </span>
                  <span>{step.text}</span>
                  {step.active && <span className="aiff-scraping-ellipsis"><span>.</span><span>.</span><span>.</span></span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (j) {
      if (j.status === "needs_input") {
        return (
          <div key={msg.id} className="aiff-msg aiff-msg-agent">
            <div className="aiff-card aiff-card-input">
              <div className="aiff-card-question">{j.question}</div>
              {j.options && j.options.length > 0 && (
                <div className="aiff-card-options">
                  {j.options.map((opt, i) => (
                    <button key={i} className="aiff-card-opt" onClick={() => handleAnswer(opt)}>{opt}</button>
                  ))}
                </div>
              )}
              <div className="aiff-card-input-row">
                <input className="aiff-card-inp" placeholder="Type your answer..." onKeyDown={(e) => { if (e.key === "Enter" && e.target.value.trim()) { handleAnswer(e.target.value); e.target.value = ""; } }} />
                <button className="aiff-card-submit" onClick={(e) => { const inp = e.target.parentElement.querySelector("input"); if (inp?.value.trim()) { handleAnswer(inp.value); inp.value = ""; } }}>Send</button>
              </div>
            </div>
          </div>
        );
      }
      if (j.status === "undo") {
        return (
          <div key={msg.id} className="aiff-msg aiff-msg-agent">
            <div className="aiff-card aiff-card-simple">{'\u21A9'} Undo successful</div>
          </div>
        );
      }
      if (j.actions) {
        const failed = j.status === "failed";
        const statusLabel = failed ? "Failed" : "Completed";
        const statusClass = failed ? "aiff-card-status-badge--err" : "aiff-card-status-badge--ok";
        const resultLabel = failed ? (j.error || "Failed") : "Completed";
        const resultClass = failed ? "aiff-card-value--err" : "aiff-card-value--success";
        const actionItems = j.actions.map((a, i) => (
          <div key={i} className="aiff-card-change">
            <span className="aiff-card-change-bullet" style={failed ? { color: "#DC2626" } : {}}>{failed ? "\u2716" : CHECK_ICON}</span>
            <span>{a.label || a.module}</span>
            <span className="aiff-card-change-action">{a.action}</span>
          </div>
        ));
        return (
          <div key={msg.id} className="aiff-msg aiff-msg-agent">
            <div className="aiff-card aiff-card-status">
              <div className="aiff-card-header">
                <span className="aiff-card-title">Task</span>
                <span className="aiff-card-value">{j.message || "Execute Action"}</span>
              </div>
              <div className="aiff-card-row">
                <span className="aiff-card-label">Status</span>
                <span className={"aiff-card-status-badge " + statusClass}>{statusLabel}</span>
              </div>
              <div className="aiff-card-row">
                <span className="aiff-card-label">Affected Modules</span>
                <span className="aiff-card-value">{j.actions.length > 0 ? j.actions.map(a => a.module || a.label).filter(Boolean).join(", ") : "—"}</span>
              </div>
              <div className="aiff-card-divider" />
              <div className="aiff-card-section-label">Changes Applied</div>
              {actionItems}
              <div className="aiff-card-divider" />
              <div className="aiff-card-row">
                <span className="aiff-card-label">Result</span>
                <span className={"aiff-card-value " + resultClass}>{resultLabel}</span>
              </div>
              {failed && j.error && (
                <div className="aiff-card-row">
                  <span className="aiff-card-label">Reason</span>
                  <span className="aiff-card-value" style={{ color: "#DC2626", fontSize: 11 }}>{j.error}</span>
                </div>
              )}
              {(msg.executedResults || []).length > 0 && (
                <button className="aiff-card-undo" onClick={() => handleUndo(j.actions[0], j.rawCartBefore, j.before)}>{'\u21A9'} Undo</button>
              )}
            </div>
          </div>
        );
      }
      if (j.message) {
        const lines = j.message.split("\n").filter(Boolean);
        const failed = j.status === "failed";
        const resultLabel = failed ? (j.error || "Failed") : "Completed Successfully";
        const resultClass = failed ? "aiff-card-value--err" : "aiff-card-value--success";
        return (
          <div key={msg.id} className="aiff-msg aiff-msg-agent">
            <div className="aiff-card aiff-card-status">
              {lines.map((line, i) => {
                const isErr = line.startsWith("Reason:") || line.startsWith("Status: Failed");
                const isSucc = line.startsWith("✓") || line.startsWith("✅") || line.startsWith("Status: Completed");
                if (isSucc) {
                  return <div key={i} className="aiff-card-line aiff-card-line--success"><span className="aiff-card-line-icon">{CHECK_ICON}</span>{line.replace(/^[✓✅]\s*/, "")}</div>;
                }
                if (isErr) {
                  return <div key={i} className="aiff-card-line" style={{ color: "#DC2626" }}>{line}</div>;
                }
                return <div key={i} className="aiff-card-line">{line}</div>;
              })}
              <div className="aiff-card-divider" />
              <div className="aiff-card-row">
                <span className="aiff-card-label">Result</span>
                <span className={"aiff-card-value " + resultClass}>{resultLabel}</span>
              </div>
              {failed && j.error && (
                <div className="aiff-card-row">
                  <span className="aiff-card-label">Reason</span>
                  <span className="aiff-card-value" style={{ color: "#DC2626", fontSize: 11 }}>{j.error}</span>
                </div>
              )}
            </div>
          </div>
        );
      }
    }

    if (msg.text && msg.role === "agent") {
      const lines = msg.text.split("\n").filter(Boolean);
      return (
        <div key={msg.id} className="aiff-msg aiff-msg-agent">
          <div className="aiff-card aiff-card-status">
            {lines.map((line, i) => {
              if (line.startsWith("✓") || line.startsWith("✅")) {
                return <div key={i} className="aiff-card-line aiff-card-line--success"><span className="aiff-card-line-icon">{CHECK_ICON}</span>{line.replace(/^[✓✅]\s*/, "")}</div>;
              }
              return <div key={i} className="aiff-card-line">{line}</div>;
            })}
          </div>
          <div className="aiff-card-actions">
            <button className="aiff-card-action-btn" onClick={() => handleCopyMessage(msg.text)} title="Copy">{COPY_ICON}</button>
            <button className="aiff-card-action-btn" onClick={handleRegenerate} title="Regenerate">{'\u21BB'}</button>
          </div>
        </div>
      );
    }

    return null;
  }

  const hasMobileDrawer = isMobile;

  if (!mounted) return null;

  return (
    <>


      {/* Floating Button */}
      <div className="aiff-launcher-shell">
        <button className="aiff-launcher" onClick={() => setOpen((v) => !v)} aria-label={open ? "Close AI" : "Open AI"}>
          {open ? (
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          ) : AI_ICON}
          {!open && notification && <span className="aiff-launcher-badge">1</span>}
        </button>
      </div>

      {/* Modal */}
      {open && (
        <>
          <div className="aiff-backdrop" onClick={() => { setOpen(false); setShowSettings(false); }} />
          <div className="aiff-modal" style={{ position: "relative" }}>
            <div className="aiff-workspace">
              {/* Left Panel - History */}
              <div className="aiff-left">
                <div className="aiff-left-head">
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="5"/><path d="M7 4v3l2 1"/></svg>
                  <span>History</span>
                </div>
                <div className="aiff-left-search">
                  <input
                    type="text"
                    placeholder="Search conversations..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="aiff-left-groups">
                  {conversations.length === 0 && !searchQuery && (
                    <div className="aiff-left-empty">No conversations yet</div>
                  )}
                  {conversations.length === 0 && searchQuery && (
                    <div className="aiff-left-empty">No conversations match your search.</div>
                  )}

                  {filteredConversations.pinned.length > 0 && (
                    <>
                      <div className="aiff-left-group-label">Pinned</div>
                      {filteredConversations.pinned.map((c) => (
                        <div key={c.id} style={{ position: "relative" }}>
                          <button
                            className={`aiff-left-item${c.id === activeConvId ? " active" : ""}`}
                            onClick={() => handleSelectConversation(c.id)}
                          >
                            <span className="aiff-left-item-text">{c.title}</span>
                            <button
                              className="aiff-left-item-more"
                              onClick={(e) => { e.stopPropagation(); setShowContextMenu(showContextMenu === c.id ? null : c.id); }}
                            >
                              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="1" fill="currentColor"/><circle cx="7" cy="3.5" r="1" fill="currentColor"/><circle cx="7" cy="10.5" r="1" fill="currentColor"/></svg>
                            </button>
                          </button>
                          {showContextMenu === c.id && (
                            <div className="aiff-context-menu">
                              <button className="aiff-context-item" onClick={() => handleRenameConversation(c.id)}>Rename</button>
                              <button className="aiff-context-item" onClick={() => handlePinConversation(c.id)}>{c.pinned ? "Unpin" : "Pin"}</button>
                              <button className="aiff-context-item" onClick={() => handleArchiveConversation(c.id)}>Archive</button>
                              <button className="aiff-context-item aiff-context-item--danger" onClick={() => handleDeleteConversation(c.id)}>Delete</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  )}

                  {filteredConversations.today.length > 0 && (
                    <>
                      <div className="aiff-left-group-label">Today</div>
                      {filteredConversations.today.map((c) => (
                        <div key={c.id} style={{ position: "relative" }}>
                          <button className={`aiff-left-item${c.id === activeConvId ? " active" : ""}`} onClick={() => handleSelectConversation(c.id)}>
                            <span className="aiff-left-item-text">{c.title}</span>
                            <button className="aiff-left-item-more" onClick={(e) => { e.stopPropagation(); setShowContextMenu(showContextMenu === c.id ? null : c.id); }}>
                              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="1" fill="currentColor"/><circle cx="7" cy="3.5" r="1" fill="currentColor"/><circle cx="7" cy="10.5" r="1" fill="currentColor"/></svg>
                            </button>
                          </button>
                          {showContextMenu === c.id && (
                            <div className="aiff-context-menu">
<button className="aiff-context-item" onClick={() => handleRenameConversation(c.id)}>Rename</button>
                              <button className="aiff-context-item" onClick={() => handlePinConversation(c.id)}>{c.pinned ? "Unpin" : "Pin"}</button>
                              <button className="aiff-context-item" onClick={() => handleArchiveConversation(c.id)}>Archive</button>
                              <button className="aiff-context-item aiff-context-item--danger" onClick={() => handleDeleteConversation(c.id)}>Delete</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  )}

                  {filteredConversations.yesterday.length > 0 && (
                    <>
                      <div className="aiff-left-group-label">Yesterday</div>
                      {filteredConversations.yesterday.map((c) => (
                        <div key={c.id} style={{ position: "relative" }}>
                          <button className={`aiff-left-item${c.id === activeConvId ? " active" : ""}`} onClick={() => handleSelectConversation(c.id)}>
                            <span className="aiff-left-item-text">{c.title}</span>
                            <button className="aiff-left-item-more" onClick={(e) => { e.stopPropagation(); setShowContextMenu(showContextMenu === c.id ? null : c.id); }}>
                              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="1" fill="currentColor"/><circle cx="7" cy="3.5" r="1" fill="currentColor"/><circle cx="7" cy="10.5" r="1" fill="currentColor"/></svg>
                            </button>
                          </button>
                          {showContextMenu === c.id && (
                            <div className="aiff-context-menu">
<button className="aiff-context-item" onClick={() => handleRenameConversation(c.id)}>Rename</button>
                              <button className="aiff-context-item" onClick={() => handlePinConversation(c.id)}>{c.pinned ? "Unpin" : "Pin"}</button>
                              <button className="aiff-context-item" onClick={() => handleArchiveConversation(c.id)}>Archive</button>
                              <button className="aiff-context-item aiff-context-item--danger" onClick={() => handleDeleteConversation(c.id)}>Delete</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  )}

                  {filteredConversations.last7.length > 0 && (
                    <>
                      <div className="aiff-left-group-label">Last 7 Days</div>
                      {filteredConversations.last7.map((c) => (
                        <div key={c.id} style={{ position: "relative" }}>
                          <button className={`aiff-left-item${c.id === activeConvId ? " active" : ""}`} onClick={() => handleSelectConversation(c.id)}>
                            <span className="aiff-left-item-text">{c.title}</span>
                            <button className="aiff-left-item-more" onClick={(e) => { e.stopPropagation(); setShowContextMenu(showContextMenu === c.id ? null : c.id); }}>
                              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="1" fill="currentColor"/><circle cx="7" cy="3.5" r="1" fill="currentColor"/><circle cx="7" cy="10.5" r="1" fill="currentColor"/></svg>
                            </button>
                          </button>
                          {showContextMenu === c.id && (
                            <div className="aiff-context-menu">
<button className="aiff-context-item" onClick={() => handleRenameConversation(c.id)}>Rename</button>
                              <button className="aiff-context-item" onClick={() => handlePinConversation(c.id)}>{c.pinned ? "Unpin" : "Pin"}</button>
                              <button className="aiff-context-item" onClick={() => handleArchiveConversation(c.id)}>Archive</button>
                              <button className="aiff-context-item aiff-context-item--danger" onClick={() => handleDeleteConversation(c.id)}>Delete</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  )}

                  {filteredConversations.older.length > 0 && (
                    <>
                      <div className="aiff-left-group-label">Last 30 Days</div>
                      {filteredConversations.older.map((c) => (
                        <div key={c.id} style={{ position: "relative" }}>
                          <button className={`aiff-left-item${c.id === activeConvId ? " active" : ""}`} onClick={() => handleSelectConversation(c.id)}>
                            <span className="aiff-left-item-text">{c.title}</span>
                            <button className="aiff-left-item-more" onClick={(e) => { e.stopPropagation(); setShowContextMenu(showContextMenu === c.id ? null : c.id); }}>
                              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="7" cy="7" r="1" fill="currentColor"/><circle cx="7" cy="3.5" r="1" fill="currentColor"/><circle cx="7" cy="10.5" r="1" fill="currentColor"/></svg>
                            </button>
                          </button>
                          {showContextMenu === c.id && (
                            <div className="aiff-context-menu">
<button className="aiff-context-item" onClick={() => handleRenameConversation(c.id)}>Rename</button>
                              <button className="aiff-context-item" onClick={() => handlePinConversation(c.id)}>{c.pinned ? "Unpin" : "Pin"}</button>
                              <button className="aiff-context-item" onClick={() => handleArchiveConversation(c.id)}>Archive</button>
                              <button className="aiff-context-item aiff-context-item--danger" onClick={() => handleDeleteConversation(c.id)}>Delete</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  )}

                  <button className="aiff-left-new" onClick={handleNewChat}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 2v8M2 6h8"/></svg>
                    Start New Conversation
                  </button>
                </div>
              </div>

              {/* Center Panel - Chat (Full Width) */}
              <div className="aiff-center" style={{ position: "relative" }}>
                {/* Header */}
                <div className="aiff-center-head">

                  <div className="aiff-center-head-icon">
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="1.8"><path d="M7 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" /></svg>
                  </div>
                  <span className="aiff-center-head-name">Cart Operations Agent</span>
                  <div className="aiff-center-head-status">
                    <span className="aiff-center-head-dot" />
                    <span>Connected</span>
                  </div>
                  <button className="aiff-center-head-settings" onClick={() => setShowSettings((v) => !v)} title="Settings">
                    {GEAR_ICON}
                  </button>
                  <button className="aiff-center-head-close" onClick={() => { setOpen(false); setShowSettings(false); }} title="Close">
                    {CLOSE_ICON}
                  </button>
                </div>

                {/* Messages / Welcome */}
                {showWelcome ? (
                  <div className="aiff-welcome">
                    <div className="aiff-welcome-divider" />
                    <h2 className="aiff-welcome-title">Cart Ninja AI Agent</h2>
                    <p className="aiff-welcome-sub">
                      <span className="aiff-welcome-dot" />
                      Connected To Store
                    </p>
                    <div className="aiff-welcome-monitor">
                      <div className="aiff-welcome-monitor-label">Monitoring</div>
                      <div className="aiff-welcome-monitor-item">
                        <span className="aiff-welcome-monitor-icon"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="1" y="3" width="10" height="7" rx="1"/><path d="M4 10l4 1.5M6 10v1.5"/></svg></span>
                        Cart Performance
                      </div>
                      <div className="aiff-welcome-monitor-item">
                        <span className="aiff-welcome-monitor-icon"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 9V6"/><path d="M5 9V4"/><path d="M8 9V7"/><path d="M11 9V5"/></svg></span>
                        Revenue Opportunities
                      </div>
                      <div className="aiff-welcome-monitor-item">
                        <span className="aiff-welcome-monitor-icon"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 2l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z"/></svg></span>
                        Upsell Opportunities
                      </div>
                      <div className="aiff-welcome-monitor-item">
                        <span className="aiff-welcome-monitor-icon"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="3" y="1" width="6" height="12" rx="1.5"/><path d="M6 10h.01"/></svg></span>
                        Conversion Optimization
                      </div>
                      <div className="aiff-welcome-status">Status: Awaiting Instructions</div>
                    </div>
                    <div className="aiff-welcome-chips">
                      {SUGGESTION_CHIPS.map((chip, i) => (
                        <button key={i} className="aiff-welcome-chip" onClick={() => handleSend(chip)}>{chip}</button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="aiff-msgs" ref={scrollRef}>
                    {messages.map(renderMessage)}
                    {loading && (
                      <div className="aiff-msg aiff-msg-agent">
                        <div className="aiff-loading">
                          <div className="aiff-loading-spinner" />
                          <span className="aiff-loading-text">{LOADING_STEPS[loadingStep]}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {predictiveSugs.length > 0 && (
                  <div className="aiff-predictive">
                    {predictiveSugs.map((s, i) => (
                      <button key={i} className="aiff-predictive-item" onClick={() => { setInput(s); setPredictiveSugs([]); inputRef.current?.focus(); }}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}

                {/* Input */}
                <div className="aiff-input-wrap">
                  <textarea
                    ref={inputRef}
                    className="aiff-input"
                    rows={1}
                    placeholder="Type a command..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleInputKey}
                    disabled={loading !== null}
                  />
                  <button
                    className="aiff-send"
                    disabled={!input.trim() || loading !== null}
                    onClick={() => { if (input.trim() && !loading) handleSend(input); }}
                    aria-label="Send"
                  >
                    {SEND_ICON}
                  </button>
                </div>

                {/* Operations Panel */}
                {showSettings && (
                  <>
                    <div className="aiff-settings-overlay" onClick={() => setShowSettings(false)} />
                    <div className="aiff-settings-panel">
                      <div className="aiff-settings-head">
                        <span className="aiff-settings-title">{loading ? "Agent Operations" : "Module Status"}</span>
                        <button className="aiff-settings-close" onClick={() => setShowSettings(false)}>
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg>
                        </button>
                      </div>
                      <div className="aiff-settings-body">
                        {/* Execution step tracker */}
                        {loading && (
                          <div className="aiff-ops-tracker">
                            <div className="aiff-ops-step">
                              <span className={"aiff-ops-step-dot" + (loadingStep >= 0 ? " aiff-ops-step-dot--active" : "")} />
                              <span className={"aiff-ops-step-label" + (loadingStep >= 0 ? " aiff-ops-step-label--active" : "")}>Analyze</span>
                            </div>
                            <div className="aiff-ops-step-connector" />
                            <div className="aiff-ops-step">
                              <span className={"aiff-ops-step-dot" + (loadingStep >= 1 ? " aiff-ops-step-dot--active" : "")} />
                              <span className={"aiff-ops-step-label" + (loadingStep >= 1 ? " aiff-ops-step-label--active" : "")}>Configure</span>
                            </div>
                            <div className="aiff-ops-step-connector" />
                            <div className="aiff-ops-step">
                              <span className={"aiff-ops-step-dot" + (loadingStep >= 2 ? " aiff-ops-step-dot--active" : "")} />
                              <span className={"aiff-ops-step-label" + (loadingStep >= 2 ? " aiff-ops-step-label--active" : "")}>Apply</span>
                            </div>
                            <div className="aiff-ops-step-connector" />
                            <div className="aiff-ops-step">
                              <span className={"aiff-ops-step-dot" + (loadingStep >= 3 ? " aiff-ops-step-dot--active" : "")} />
                              <span className={"aiff-ops-step-label" + (loadingStep >= 3 ? " aiff-ops-step-label--active" : "")}>Verify</span>
                            </div>
                          </div>
                        )}
                        {/* Current operation text */}
                        {loading && (
                          <div className="aiff-ops-current">{LOADING_STEPS[loadingStep]}</div>
                        )}
                        {!loading && flashModules.length > 0 && (
                          <div className="aiff-ops-current" style={{ color: "#059669" }}>{"\u2713"} Changes Applied</div>
                        )}
                        <div className="aiff-ops-divider" />
                        {/* Module status list */}
                        <div className="aiff-ops-module-label">Modules</div>
                        {MODULES.map((key) => {
                          const state = getModuleState(key);
                          const isFlashing = flashModules.includes(key);
                          return (
                            <div key={key} className={"aiff-ops-module" + (isFlashing ? " aiff-ops-module--flash" : "")}>
                              <span className="aiff-ops-module-name">{MODULE_LABELS[key]}</span>
                              <span className={"aiff-ops-module-dot" + (state?.enabled ? " aiff-ops-module-dot--on" : " aiff-ops-module-dot--off")} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Mobile Bottom Nav */}
            <div className="aiff-mobile-nav">
              <button className={`aiff-mobile-nav-btn${mobileTab === "history" ? " active" : ""}`} onClick={() => setMobileTab("history")}>
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="10" cy="10" r="8" /><path d="M10 6v4l3 2" /></svg>
                <span>History</span>
              </button>
              <button className={`aiff-mobile-nav-btn${mobileTab === "chat" ? " active" : ""}`} onClick={() => setMobileTab("chat")}>
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 14a2 2 0 01-2 2H5l-3 3V4a2 2 0 012-2h12a2 2 0 012 2v10z" /></svg>
                <span>Chat</span>
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}