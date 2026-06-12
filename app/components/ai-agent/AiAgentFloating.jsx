import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "react-router";
import { executeActions, undoAction, generateTitle, getTimeGroup, MODULE_MAP } from "./AiAgent";
import { featureStore } from "./featureStore";
import useAiAgent from "./useAiAgent";
import { aiApi } from "./api";
import AILoadingState from "./AILoadingState";
import AIChangesSummary from "./AIChangesSummary";
import AINeedsInputCard from "./AINeedsInputCard";
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
  };

  useEffect(() => {
    setMounted(true);
    try { const hasNotif = localStorage.getItem("aia_notification"); if (hasNotif === "true") setNotification(true); } catch {}
  }, []);

  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.executedActions?.length > 0 && lastMsg?.synced) {
      const conv = conversations.find((c) => c.id === activeConvId);
      if (conv) {
        lastMsg.actions.forEach((act) => {
          const key = NVIDIA_TO_FEATURE_KEY[act.type];
          if (key) {
            featureStore.set(key, NVIDIA_TO_BOOL[act.type]);
          }
        });
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
      const interval = setInterval(() => {
        setLoadingStep((prev) => (prev < 3 ? prev + 1 : 3));
      }, 2000);
      return () => clearInterval(interval);
    } else {
      setLoadingStep(0);
    }
  }, [loading]);

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

  const handleUndo = useCallback((action) => {
    undoAction(action);
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
                <button className="aiff-card-undo" onClick={() => handleUndo(j.actions[0])}>{'\u21A9'} Undo</button>
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

  const contextMenuStyle = {
    position: "absolute", right: 8, top: 32,
    background: "#fff", border: "1px solid #E8E8E8",
    borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,.12)",
    zIndex: 100, minWidth: 140, overflow: "hidden",
  };

  return (
    <>
      <style>{`
        /* ── Overlay Reset ── */
        .aiff-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.3); z-index:9999; animation:aiffFade .15s ease; }
        .aiff-modal { position:fixed; top:45%; left:50%; transform:translate(-50%,-50%); width:860px; height:480px; max-width:calc(100vw - 40px); background:#fff; border-radius:16px; box-shadow:0 8px 40px rgba(0,0,0,.18); display:flex; flex-direction:column; z-index:10000; overflow:hidden; animation:aiffSlide .2s ease; }

        /* ── Launcher ── */
        .aiff-launcher-shell { position:fixed; bottom:20px; right:20px; z-index:9998; }
        .aiff-launcher { width:52px; height:52px; border-radius:50%; border:none; background:linear-gradient(135deg,#FF6B00,#FF8A33); color:#fff; display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 4px 16px rgba(255,107,0,.3); transition:all .2s; }
        .aiff-launcher:hover { transform:scale(1.08); box-shadow:0 6px 20px rgba(255,107,0,.4); }
        .aiff-launcher-badge { position:absolute; top:-4px; right:-4px; width:18px; height:18px; border-radius:50%; background:#DC2626; color:#fff; font-size:11px; font-weight:600; display:flex; align-items:center; justify-content:center; }

        /* ── Workspace ── */
        .aiff-workspace { display:flex; flex:1; min-height:0; overflow:hidden; }

        /* ── Left Panel (History) ── */
        .aiff-left { width:200px; min-width:200px; display:flex; flex-direction:column; min-height:0; border-right:1px solid #eee; background:#fafafa; }
        .aiff-left-head { display:flex; align-items:center; gap:6px; padding:6px 12px 4px; font-size:11px; font-weight:600; color:#1a1a1a; }
        .aiff-left-search { padding:0 12px 4px; }
        .aiff-left-search input { width:100%; padding:4px 8px; border:1px solid #e0e0e0; border-radius:6px; font-size:11px; outline:none; box-sizing:border-box; background:#fff; }
        .aiff-left-search input:focus { border-color:#FF6B00; }
        .aiff-left-groups { flex:1; overflow-y:auto; min-height:0; padding:0 12px 4px; }
        .aiff-left-group-label { font-size:9px; text-transform:uppercase; color:#9a9a9a; letter-spacing:.5px; padding:4px 0 2px; font-weight:600; }
        .aiff-left-item { display:flex; align-items:center; justify-content:space-between; width:100%; padding:4px 8px; border:none; background:none; border-radius:6px; cursor:pointer; font-size:11px; color:#333; text-align:left; transition:all .12s; }
        .aiff-left-item:hover { background:#eee; }
        .aiff-left-item.active { background:#FFF3EB; color:#FF6B00; font-weight:500; }
        .aiff-left-item-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; }
        .aiff-left-item-more { flex-shrink:0; background:none; border:none; cursor:pointer; padding:2px; color:#9a9a9a; border-radius:4px; opacity:0; transition:opacity .12s; }
        .aiff-left-item:hover .aiff-left-item-more { opacity:1; }
        .aiff-left-empty { font-size:11px; color:#9a9a9a; padding:12px 0; text-align:center; }
        .aiff-left-new { display:flex; align-items:center; gap:4px; width:100%; padding:5px 8px; margin-top:2px; border:none; background:none; border-radius:6px; cursor:pointer; font-size:11px; color:#FF6B00; font-weight:500; transition:background .12s; }
        .aiff-left-new:hover { background:#FFF3EB; }
        .aiff-left-new svg { flex-shrink:0; }

        /* ── Center Panel (Chat) ── */
        .aiff-center { flex:1; display:flex; flex-direction:column; min-width:0; min-height:0; background:#fff; }

        .aiff-center-head { display:flex; align-items:center; gap:6px; padding:5px 12px; border-bottom:1px solid #f0f0f0; flex-shrink:0; }
        .aiff-center-head-btn { background:none; border:none; cursor:pointer; padding:3px; color:#666; border-radius:4px; display:flex; }
        .aiff-center-head-btn:hover { background:#f0f0f0; }
        .aiff-center-head-icon { width:20px; height:20px; border-radius:5px; background:linear-gradient(135deg,#FF6B00,#FF8A33); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .aiff-center-head-name { font-size:12px; font-weight:600; color:#1a1a1a; }
        .aiff-center-head-status { margin-left:auto; display:flex; align-items:center; gap:4px; font-size:10px; color:#059669; }
        .aiff-center-head-dot { width:5px; height:5px; border-radius:50%; background:#059669; }
        .aiff-center-head-settings { background:none; border:none; cursor:pointer; padding:3px; color:#666; border-radius:4px; display:flex; margin-left:4px; }
        .aiff-center-head-settings:hover { background:#f0f0f0; color:#FF6B00; }
        .aiff-center-head-close { background:none; border:none; cursor:pointer; padding:3px; color:#666; border-radius:4px; display:flex; }
        .aiff-center-head-close:hover { background:#f0f0f0; }

        /* ── Messages ── */
        .aiff-msgs { flex:1; overflow-y:auto; min-height:0; padding:6px 12px 2px; display:flex; flex-direction:column; gap:6px; }

        /* User bubble */
        .aiff-msg { display:flex; }
        .aiff-msg-user { justify-content:flex-end; }
        .aiff-msg-agent { justify-content:flex-start; }
        .aiff-bubble { max-width:75%; padding:6px 10px; border-radius:10px; font-size:12px; line-height:1.4; word-wrap:break-word; }
        .aiff-bubble-user { background:linear-gradient(135deg,#FF6B00,#FF8A33); color:#fff; border-bottom-right-radius:4px; }

        /* Agent cards */
        .aiff-card { max-width:85%; background:#f9f9f9; border:1px solid #e8e8e8; border-radius:10px; padding:10px; font-size:12px; line-height:1.45; color:#1a1a1a; }
        .aiff-card-simple { padding:6px 10px; }
        .aiff-card-input { padding:10px; }
        .aiff-card-question { font-weight:500; margin-bottom:6px; font-size:12px; }
        .aiff-card-options { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:6px; }
        .aiff-card-opt { padding:3px 10px; border:1px solid #ddd; border-radius:5px; background:#fff; cursor:pointer; font-size:11px; transition:all .12s; }
        .aiff-card-opt:hover { border-color:#FF6B00; color:#FF6B00; }
        .aiff-card-input-row { display:flex; gap:4px; }
        .aiff-card-inp { flex:1; padding:4px 8px; border:1px solid #ddd; border-radius:5px; font-size:11px; outline:none; }
        .aiff-card-inp:focus { border-color:#FF6B00; }
        .aiff-card-submit { padding:4px 10px; border:none; border-radius:5px; background:linear-gradient(135deg,#FF6B00,#FF8A33); color:#fff; cursor:pointer; font-size:11px; }
        .aiff-card-submit:hover { opacity:.9; }

        /* Status card */
        .aiff-card-status { }
        .aiff-card-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; }
        .aiff-card-title { font-size:10px; text-transform:uppercase; color:#9a9a9a; letter-spacing:.4px; font-weight:600; }
        .aiff-card-value { font-size:12px; color:#333; font-weight:500; }
        .aiff-card-value--success { color:#059669; }
        .aiff-card-row { display:flex; justify-content:space-between; align-items:center; padding:2px 0; }
        .aiff-card-label { font-size:10px; text-transform:uppercase; color:#9a9a9a; letter-spacing:.4px; font-weight:600; }
        .aiff-card-status-badge { font-size:10px; padding:1px 8px; border-radius:5px; font-weight:500; }
        .aiff-card-status-badge--ok { background:#ECFDF5; color:#065F46; }
        .aiff-card-status-badge--err { background:#FEF2F2; color:#991B1B; }
        .aiff-card-value--err { color:#DC2626; }
        .aiff-card-divider { height:1px; background:#e8e8e8; margin:5px 0; }
        .aiff-card-section-label { font-size:10px; text-transform:uppercase; color:#9a9a9a; letter-spacing:.4px; font-weight:600; margin-bottom:4px; }
        .aiff-card-change { display:flex; align-items:center; gap:4px; padding:2px 0; font-size:12px; }
        .aiff-card-change-bullet { color:#059669; display:flex; flex-shrink:0; }
        .aiff-card-change-action { margin-left:auto; font-size:10px; color:#666; }
        .aiff-card-line { padding:2px 0; display:flex; align-items:center; gap:4px; font-size:12px; }
        .aiff-card-line--success { color:#059669; }
        .aiff-card-line-icon { flex-shrink:0; color:#059669; display:flex; }
        .aiff-card-undo { margin-top:4px; padding:2px 8px; border:1px solid #e0e0e0; border-radius:5px; background:#fff; cursor:pointer; font-size:10px; color:#666; transition:all .12s; }
        .aiff-card-undo:hover { border-color:#DC2626; color:#DC2626; }
        .aiff-card-actions { display:flex; gap:3px; margin-top:2px; padding-left:2px; }
        .aiff-card-action-btn { background:none; border:none; cursor:pointer; padding:2px; color:#9a9a9a; border-radius:4px; display:flex; font-size:11px; }
        .aiff-card-action-btn:hover { background:#f0f0f0; color:#666; }

        /* ── Welcome Screen ── */
        .aiff-welcome { flex:1; display:flex; flex-direction:column; align-items:center; padding:32px 24px 0; text-align:center; }
        .aiff-welcome-divider { width:24px; height:2px; background:linear-gradient(135deg,#FF6B00,#FF8A33); border-radius:2px; margin-bottom:6px; }
        .aiff-welcome-title { font-size:13px; font-weight:600; color:#1a1a1a; margin:0; }
        .aiff-welcome-sub { font-size:11px; color:#666; margin:2px 0 8px; display:flex; align-items:center; gap:4px; }
        .aiff-welcome-dot { width:5px; height:5px; border-radius:50%; background:#059669; display:inline-block; }
        .aiff-welcome-monitor { background:#f9f9f9; border:1px solid #e8e8e8; border-radius:6px; padding:6px 12px; margin-bottom:6px; text-align:left; min-width:220px; }
        .aiff-welcome-monitor-label { font-size:9px; text-transform:uppercase; color:#9a9a9a; letter-spacing:.4px; font-weight:600; margin-bottom:2px; }
        .aiff-welcome-monitor-item { display:flex; align-items:center; gap:3px; padding:1px 0; font-size:11px; color:#555; }
        .aiff-welcome-monitor-icon { color:#059669; display:flex; flex-shrink:0; }
        .aiff-welcome-status { margin-top:4px; padding-top:4px; border-top:1px solid #e8e8e8; font-size:10px; color:#888; }
        .aiff-welcome-chips { display:flex; flex-wrap:wrap; gap:4px; justify-content:center; margin-top:2px; }
        .aiff-welcome-chip { padding:3px 10px; border:1px solid #e0e0e0; border-radius:14px; background:#fff; cursor:pointer; font-size:11px; color:#555; transition:all .15s; white-space:nowrap; }
        .aiff-welcome-chip:hover { border-color:#FF6B00; color:#FF6B00; background:#FFF8F3; }

        /* ── Loading ── */
        .aiff-loading { display:flex; align-items:center; gap:6px; padding:6px 10px; background:#f9f9f9; border:1px solid #e8e8e8; border-radius:10px; max-width:80%; }
        .aiff-loading-spinner { width:12px; height:12px; border:2px solid #e8e8e8; border-top-color:#FF6B00; border-radius:50%; animation:aiffSpin .6s linear infinite; flex-shrink:0; }
        @keyframes aiffSpin { to{transform:rotate(360deg)} }
        .aiff-loading-text { font-size:11px; color:#888; }

        /* ── Predictive ── */
        .aiff-predictive { display:flex; flex-wrap:wrap; gap:3px; padding:2px 12px 0; }
        .aiff-predictive-item { padding:3px 8px; border:1px solid #e8e8e8; border-radius:5px; background:#fff; cursor:pointer; font-size:10px; color:#666; transition:all .12s; }
        .aiff-predictive-item:hover { border-color:#FF6B00; color:#FF6B00; }

        /* ── Input ── */
        .aiff-input-wrap { display:flex; align-items:flex-end; gap:6px; padding:4px 12px; border-top:1px solid #f0f0f0; flex-shrink:0; }
        .aiff-input { flex:1; padding:6px 10px; border:1px solid #e0e0e0; border-radius:8px; font-size:12px; outline:none; resize:none; font-family:inherit; line-height:1.3; min-height:32px; max-height:60px; box-sizing:border-box; }
        .aiff-input:focus { border-color:#FF6B00; }
        .aiff-input::placeholder { color:#bbb; }
        .aiff-send { width:32px; height:32px; border-radius:8px; border:none; background:linear-gradient(135deg,#FF6B00,#FF8A33); color:#fff; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0; transition:all .15s; }
        .aiff-send:hover { transform:scale(1.05); box-shadow:0 2px 8px rgba(255,107,0,.25); }
        .aiff-send:disabled { opacity:.4; cursor:default; transform:none; box-shadow:none; }

        /* ── Settings Panel ── */
        .aiff-settings-overlay { position:absolute; inset:0; z-index:10; background:rgba(0,0,0,.12); border-radius:16px; animation:aiffFade .15s ease; }
        .aiff-settings-panel { position:absolute; top:0; right:0; bottom:0; width:240px; background:#fff; border-left:1px solid #e8e8e8; border-radius:0 16px 16px 0; display:flex; flex-direction:column; animation:aiffSlideIn .2s ease; z-index:11; }
        .aiff-settings-head { display:flex; align-items:center; justify-content:space-between; padding:10px; border-bottom:1px solid #eee; flex-shrink:0; }
        .aiff-settings-title { font-size:12px; font-weight:600; color:#1a1a1a; }
        .aiff-settings-close { background:none; border:none; cursor:pointer; padding:3px; border-radius:5px; color:#9a9a9a; display:flex; }
        .aiff-settings-close:hover { background:#f0f0f0; color:#1a1a1a; }
        .aiff-settings-body { flex:1; overflow-y:auto; min-height:0; padding:6px 10px; }
        .aiff-settings-module { display:flex; align-items:center; justify-content:space-between; padding:5px 8px; background:#fafafa; border-radius:6px; margin-bottom:3px; }
        .aiff-settings-module-label { font-size:11px; color:#1a1a1a; font-weight:500; }
        .aiff-settings-module-badge { font-size:9px; padding:1px 6px; border-radius:5px; font-weight:500; }
        .aiff-settings-module-badge--on { background:#ECFDF5; color:#065F46; }
        .aiff-settings-module-badge--off { background:#FEF2F2; color:#991B1B; }

        /* ── Mobile ── */
        .aiff-mobile-nav { display:none; border-top:1px solid #eee; flex-shrink:0; }
        .aiff-mobile-nav-btn { flex:1; display:flex; flex-direction:column; align-items:center; gap:2px; padding:8px; border:none; background:#fff; cursor:pointer; font-size:10px; color:#9a9a9a; }
        .aiff-mobile-nav-btn.active { color:#FF6B00; }
        .aiff-mobile-overlay { display:none; }

        /* ── Animations ── */
        @keyframes aiffSlide { from{opacity:0;transform:translate(-50%,-50%) scale(.95)} to{opacity:1;transform:translate(-50%,-50%) scale(1)} }
        @keyframes aiffFade { from{opacity:0} to{opacity:1} }
        @keyframes aiffSlideIn { from{transform:translateX(30px);opacity:0} to{transform:translateX(0);opacity:1} }

        @media(max-width:768px){
          .aiff-modal { width:100vw; height:100vh; max-width:100vw; bottom:0; right:0; border-radius:0; }
          .aiff-left { width:100%; min-width:100%; }
          .aiff-center { width:100%; }
          .aiff-mobile-nav { display:flex; }
          .aiff-settings-panel { width:100%; border-radius:0; }
          .aiff-launcher-shell { bottom:16px; right:16px; }
        }
      `}</style>

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
                            <div style={contextMenuStyle}>
                              <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#1a1a1a" }} onClick={() => handleRenameConversation(c.id)}>Rename</button>
                              <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#1a1a1a" }} onClick={() => handlePinConversation(c.id)}>{c.pinned ? "Unpin" : "Pin"}</button>
                              <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#1a1a1a" }} onClick={() => handleArchiveConversation(c.id)}>Archive</button>
                              <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#DC2626" }} onClick={() => handleDeleteConversation(c.id)}>Delete</button>
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
                            <div style={contextMenuStyle}>
                              <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#1a1a1a" }} onClick={() => handleRenameConversation(c.id)}>Rename</button>
                              <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#1a1a1a" }} onClick={() => handlePinConversation(c.id)}>Pin</button>
                              <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#1a1a1a" }} onClick={() => handleArchiveConversation(c.id)}>Archive</button>
                              <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#DC2626" }} onClick={() => handleDeleteConversation(c.id)}>Delete</button>
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
                            <div style={contextMenuStyle}>
                              <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#1a1a1a" }} onClick={() => handleRenameConversation(c.id)}>Rename</button>
                              <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#1a1a1a" }} onClick={() => handlePinConversation(c.id)}>Pin</button>
                              <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#1a1a1a" }} onClick={() => handleArchiveConversation(c.id)}>Archive</button>
                              <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#DC2626" }} onClick={() => handleDeleteConversation(c.id)}>Delete</button>
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
                            <div style={contextMenuStyle}>
                              <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#1a1a1a" }} onClick={() => handleRenameConversation(c.id)}>Rename</button>
                              <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#1a1a1a" }} onClick={() => handlePinConversation(c.id)}>Pin</button>
                              <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#1a1a1a" }} onClick={() => handleArchiveConversation(c.id)}>Archive</button>
                              <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#DC2626" }} onClick={() => handleDeleteConversation(c.id)}>Delete</button>
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
                            <div style={contextMenuStyle}>
                              <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#1a1a1a" }} onClick={() => handleRenameConversation(c.id)}>Rename</button>
                              <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#1a1a1a" }} onClick={() => handlePinConversation(c.id)}>Pin</button>
                              <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#1a1a1a" }} onClick={() => handleArchiveConversation(c.id)}>Archive</button>
                              <button style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#DC2626" }} onClick={() => handleDeleteConversation(c.id)}>Delete</button>
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

                {/* Settings Slide-out */}
                {showSettings && (
                  <>
                    <div className="aiff-settings-overlay" onClick={() => setShowSettings(false)} />
                    <div className="aiff-settings-panel">
                      <div className="aiff-settings-head">
                        <span className="aiff-settings-title">Module Settings</span>
                        <button className="aiff-settings-close" onClick={() => setShowSettings(false)}>
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg>
                        </button>
                      </div>
                      <div className="aiff-settings-body">
                        {MODULES.map((key) => {
                          const state = getModuleState(key);
                          return (
                            <div key={key} className="aiff-settings-module">
                              <span className="aiff-settings-module-label">{MODULE_LABELS[key]}</span>
                              <span className={`aiff-settings-module-badge ${state?.enabled ? "aiff-settings-module-badge--on" : "aiff-settings-module-badge--off"}`}>
                                {state?.enabled ? "On" : "Off"}
                              </span>
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