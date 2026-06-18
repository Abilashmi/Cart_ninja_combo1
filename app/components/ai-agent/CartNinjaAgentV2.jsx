import { useCallback, useEffect, useRef, useState } from "react";
import { featureStore } from "./featureStore";
import "./CartNinjaAgentV2.css";

// ─── Constants ────────────────────────────────────────────────────────────────

const ACTION_LABELS = {
  enableDrawer: "Cart Drawer Enabled",
  disableDrawer: "Cart Drawer Disabled",
  configureCartDrawer: "Cart Drawer Configured",
  enableUpsell: "Upsell Recommendations Enabled",
  disableUpsell: "Upsell Recommendations Disabled",
  configureUpsell: "Upsell Recommendations Configured",
  enableFBT: "Frequently Bought Together Enabled",
  disableFBT: "Frequently Bought Together Disabled",
  configureFBT: "Frequently Bought Together Configured",
  enableGoalBar: "Free Shipping Goal Bar Enabled",
  disableGoalBar: "Free Shipping Goal Bar Disabled",
  configureGoalBar: "Free Shipping Goal Bar Configured",
  enableTrustBadges: "Trust Badges Enabled",
  disableTrustBadges: "Trust Badges Disabled",
  enableCouponSlider: "Coupon Slider Enabled",
  disableCouponSlider: "Coupon Slider Disabled",
  configureCouponSlider: "Coupon Slider Configured",
  enableAnnouncement: "Announcement Banner Enabled",
  disableAnnouncement: "Announcement Banner Disabled",
  configureAnnouncement: "Announcement Banner Configured",
  matchTheme: "Theme Colors Matched",
  optimizeMobile: "Mobile Layout Optimized",
  applyTemplate: "Style Template Applied",
  updateStyling: "Cart Styling Updated",
  createBundle: "Bundle Offer Created",
  updateCheckoutStyle: "Checkout Button Style Updated",
};

const MODULE_NAMES = {
  enableDrawer: "cart_drawer", disableDrawer: "cart_drawer", configureCartDrawer: "cart_drawer",
  enableUpsell: "upsells", disableUpsell: "upsells", configureUpsell: "upsells",
  enableFBT: "fbt", disableFBT: "fbt", configureFBT: "fbt",
  enableGoalBar: "progress_bar", disableGoalBar: "progress_bar", configureGoalBar: "progress_bar",
  enableTrustBadges: "trust_badges", disableTrustBadges: "trust_badges",
  enableCouponSlider: "coupon_slider", disableCouponSlider: "coupon_slider", configureCouponSlider: "coupon_slider",
  enableAnnouncement: "announcements", disableAnnouncement: "announcements", configureAnnouncement: "announcements",
  matchTheme: "styling", optimizeMobile: "mobile", applyTemplate: "styling",
  updateStyling: "styling", createBundle: "combo_forge", updateCheckoutStyle: "checkout",
};

const QUICK_ACTIONS = [
  { icon: "bundle", title: "Generate FBT", desc: "AI product bundles", query: "Set up Frequently Bought Together with AI recommendations" },
  { icon: "trend", title: "Create Upsell", desc: "Cart recommendations", query: "Set up upsell offers with modern slider layout" },
  { icon: "reward", title: "Setup Rewards", desc: "Free shipping goal", query: "Configure a free shipping progress bar with ₹999 goal" },
  { icon: "chart", title: "Analyze Store", desc: "Review opportunities", query: "Analyze my cart configuration and suggest improvements" },
  { icon: "cart", title: "Optimize Cart", desc: "Boost conversions", query: "Optimize the cart drawer for maximum conversions" },
  { icon: "coupon", title: "Add Coupons", desc: "Show discounts", query: "Enable the coupon slider to show available discounts" },
];

const STAGES = [
  { id: "thinking", label: "Thinking..." },
  { id: "analyzing", label: "Analyzing your request..." },
  { id: "executing", label: "Executing changes..." },
  { id: "verifying", label: "Verifying results..." },
];
const STAGE_DELAYS = [0, 700, 1700, 2900];
const ANALYTICS_DATA_TERMS = /\b(analytics?|graph|chart|trend|report|dashboard|data|metrics?|stats?|statistics|performance)\b/i;
const ANALYTICS_METRIC_TERMS = /\b(sales?|revenue|aov|conversion|conversions|checkout clicks?|coupon clicks?|upsell clicks?|coupons applied|upsell revenue)\b/i;
const ANALYTICS_ASK_TERMS = /\b(show|view|open|display|see|check|what'?s|what is|how much|how many|tell me|give me|current|today|yesterday|week|month|last)\b/i;
const ACTION_OPTIMIZATION_TERMS = /\b(increase|boost|improve|optimize|grow|setup|set up|enable|create|add|configure|fix|change|make)\b/i;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateTitle(text) {
  return text
    .replace(/\b(please|can you|could you|i want to|need|want|help me|i'd like to)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 52) || "New Chat";
}

function formatTime(ts) {
  if (!ts) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
}

function groupConversations(convs, query) {
  const list = query
    ? convs.filter(c => (c.title || "").toLowerCase().includes(query.toLowerCase()))
    : convs;

  const pinned = list.filter(c => c.pinned);
  const rest = list.filter(c => !c.pinned);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yestStart = todayStart - 86400000;
  const weekStart = todayStart - 7 * 86400000;

  const groups = {};
  if (pinned.length) groups["Pinned"] = pinned;

  const bucket = { Today: [], Yesterday: [], "Last 7 Days": [], Older: [] };
  for (const c of rest) {
    const t = new Date(c.updatedAt).getTime();
    if (t >= todayStart) bucket.Today.push(c);
    else if (t >= yestStart) bucket.Yesterday.push(c);
    else if (t >= weekStart) bucket["Last 7 Days"].push(c);
    else bucket.Older.push(c);
  }
  for (const [k, v] of Object.entries(bucket)) if (v.length) groups[k] = v;

  return groups;
}

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

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

function isAnalyticsQuery(text) {
  const value = text || "";
  if (ANALYTICS_DATA_TERMS.test(value)) return true;
  if (ANALYTICS_METRIC_TERMS.test(value) && ANALYTICS_ASK_TERMS.test(value)) return true;
  if (ANALYTICS_METRIC_TERMS.test(value) && !ACTION_OPTIMIZATION_TERMS.test(value)) return true;
  return false;
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatMoney(value) {
  return `₹${Math.round(Number(value) || 0).toLocaleString("en-IN")}`;
}

function normalizeAnalytics(data = {}) {
  return {
    checkoutClicks: Number(data.checkout_click) || 0,
    couponClicks: Number(data.coupon_click) || 0,
    upsellClicks: Number(data.upsell_click) || 0,
    upsellRevenue: Number(data.upsell_revenue_generated) || 0,
    revenue: Number(data.cartdrawer_total_revenue) || 0,
    couponsApplied: Number(data.cartdrawer_total_coupon_applied) || 0,
  };
}

function makeEmptyAnalyticsPoint(date) {
  return {
    label: date.toLocaleDateString("en-US", { weekday: "short" }),
    revenue: 0,
    upsellRevenue: 0,
    checkoutClicks: 0,
    couponClicks: 0,
    upsellClicks: 0,
  };
}

async function fetchAnalyticsRange(days = 7) {
  const dates = Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const points = await Promise.all(dates.map(async (date) => {
    const dateStr = formatLocalDate(date);
    try {
      const res = await fetch(`/api/analytics?startDate=${dateStr}&endDate=${dateStr}`, {
        headers: { Accept: "application/json" },
      });
      const payload = await res.json();
      if (!res.ok || !payload?.success) return makeEmptyAnalyticsPoint(date);
      const row = normalizeAnalytics(payload.data);
      return {
        ...makeEmptyAnalyticsPoint(date),
        ...row,
      };
    } catch {
      return makeEmptyAnalyticsPoint(date);
    }
  }));

  const totals = points.reduce((acc, point) => ({
    revenue: acc.revenue + point.revenue,
    upsellRevenue: acc.upsellRevenue + point.upsellRevenue,
    checkoutClicks: acc.checkoutClicks + point.checkoutClicks,
    couponClicks: acc.couponClicks + point.couponClicks,
    upsellClicks: acc.upsellClicks + point.upsellClicks,
    couponsApplied: acc.couponsApplied + point.couponsApplied,
  }), {
    revenue: 0,
    upsellRevenue: 0,
    checkoutClicks: 0,
    couponClicks: 0,
    upsellClicks: 0,
    couponsApplied: 0,
  });

  return { points, totals };
}

// ─── Icon ─────────────────────────────────────────────────────────────────────

function Icon({ name, size = 18 }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" };
  const icons = {
    logo:    <><path d="M6 8h3l2 8h6l2-6h-4" /><circle cx="9" cy="19" r="1.3" /><circle cx="17" cy="19" r="1.3" /><path d="M14 8V5a2 2 0 0 0-4 0v3" /></>,
    plus:    <path d="M12 5v14M5 12h14" />,
    close:   <path d="M7 7l10 10M17 7 7 17" />,
    send:    <path d="M4 12 20 5l-6 14-3-6-7-1z" />,
    mic:     <><rect x="9" y="3" width="6" height="10" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></>,
    search:  <><circle cx="11" cy="11" r="6" /><path d="m21 21-4.35-4.35" /></>,
    edit:    <><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13 7l4 4" /></>,
    trash:   <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" /></>,
    pin:     <><line x1="12" y1="17" x2="12" y2="22" /><path d="M5 17h14M16 5v6l2 3H6l2-3V5z" /><path d="M10 5V3h4v2" /></>,
    check:   <path d="M5 12l4 4L19 6" />,
    undo:    <><path d="M4 7v6h6" /><path d="M20 17a8 8 0 0 0-14-5" /></>,
    dots:    <><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></>,
    bundle:  <><rect x="4" y="5" width="7" height="7" rx="2" /><rect x="13" y="12" width="7" height="7" rx="2" /><path d="M11 8h3M10 12l3 3" /></>,
    trend:   <path d="M4 17 10 11l4 4 6-8" />,
    reward:  <><circle cx="12" cy="8" r="4" /><path d="M8.5 11.5 7 21l5-3 5 3-1.5-9.5" /></>,
    chart:   <><path d="M4 19V5" /><path d="M4 19h16" /><rect x="7" y="11" width="3" height="5" /><rect x="12" y="8" width="3" height="8" /><rect x="17" y="5" width="3" height="11" /></>,
    cart:    <><path d="M5 5h2l2 10h8l2-7H8" /><circle cx="10" cy="20" r="1.5" /><circle cx="17" cy="20" r="1.5" /></>,
    coupon:  <><path d="M4 8a2 2 0 0 0 0 4v4h16v-4a2 2 0 0 0 0-4V4H4z" /><path d="M9 8h.01M15 12h.01M10 14l4-8" /></>,
    spinner: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></>,
    warning: <><path d="M10.3 3.5L2 19h20L13.7 3.5a2 2 0 0 0-3.4 0z" /><line x1="12" y1="9" x2="12" y2="13" /><circle cx="12" cy="17" r=".8" fill="currentColor" /></>,
  };
  return <svg {...p}>{icons[name] || null}</svg>;
}

// ─── AgentResultCard ──────────────────────────────────────────────────────────

function AgentResultCard({ executedActions, verification, synced, before, timeTaken, onUndo }) {
  const ok = synced && verification?.verified;
  const changes = (executedActions || []).map(a => ACTION_LABELS[a.action] || a.action);
  const modules = [...new Set((executedActions || []).map(a => MODULE_NAMES[a.action]).filter(Boolean))];
  const taskLabel = changes.join(", ");

  const verifyItems = ok
    ? [{ pass: true, text: "Module Active" }, { pass: true, text: "Configuration Valid" }]
    : (verification?.results || [])
        .filter(r => !r.passed)
        .map(r => ({ pass: false, text: `${ACTION_LABELS[r.action] || r.action}: expected ${String(r.expected)}, got ${String(r.actual)}` }));
  if (!ok && verifyItems.length === 0) verifyItems.push({ pass: false, text: "Verification failed — database save error" });

  return (
    <div className={`cnv4-result ${ok ? "ok" : "fail"}`}>
      <div className="cnv4-result-head">
        <div className="cnv4-result-task-block">
          <span className="cnv4-result-task-label">Task</span>
          <span className="cnv4-result-task-name">{taskLabel}</span>
        </div>
        <span className={`cnv4-result-status ${ok ? "ok" : "fail"}`}>
          {ok ? <><Icon name="check" size={12} /> Completed</> : <><Icon name="close" size={12} /> Failed</>}
        </span>
      </div>

      <div className="cnv4-result-sections">
        <div className="cnv4-result-section">
          <h4>Changes Applied</h4>
          {changes.map((c, i) => (
            <div key={i} className="cnv4-result-row pass"><span className="cnv4-tick">✓</span><span>{c}</span></div>
          ))}
          {ok && <>
            <div className="cnv4-result-row pass"><span className="cnv4-tick">✓</span><span>Settings Saved</span></div>
            <div className="cnv4-result-row pass"><span className="cnv4-tick">✓</span><span>Store Updated</span></div>
          </>}
        </div>

        <div className="cnv4-result-section">
          <h4>Verification</h4>
          {verifyItems.map((v, i) => (
            <div key={i} className={`cnv4-result-row ${v.pass ? "pass" : "fail"}`}>
              <span className="cnv4-tick">{v.pass ? "✓" : "✗"}</span>
              <span>{v.text}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="cnv4-result-footer">
        <div className="cnv4-result-meta">
          {timeTaken && <span><b>Time Taken:</b> {timeTaken}s</span>}
          {modules.length > 0 && <span><b>Affected Modules:</b> {modules.join(", ")}</span>}
          {ok && <span><b>Undo Available:</b> ✓ Yes</span>}
        </div>
        {ok && onUndo && (
          <button className="cnv4-undo-btn" onClick={onUndo}>
            <Icon name="undo" size={13} /> Undo Changes
          </button>
        )}
      </div>
    </div>
  );
}

// ─── StageIndicator ───────────────────────────────────────────────────────────

function StageIndicator({ stage }) {
  const s = STAGES.find(x => x.id === stage) || STAGES[0];
  const idx = STAGES.findIndex(x => x.id === stage);
  return (
    <div className="cnv4-stage">
      <div className="cnv4-stage-steps">
        {STAGES.map((st, i) => (
          <div key={st.id} className={`cnv4-stage-step ${i < idx ? "done" : i === idx ? "active" : ""}`}>
            {i < idx ? <Icon name="check" size={11} /> : <span className="cnv4-stage-dot" />}
            <span>{st.label}</span>
          </div>
        ))}
      </div>
      <div className="cnv4-stage-spinner"><Icon name="spinner" size={14} /></div>
    </div>
  );
}

// ─── AnalyticsPanel ──────────────────────────────────────────────────────────

function AnalyticsPanel({ open, loading, data, error, onClose }) {
  if (!open) return null;

  const points = data?.points || [];
  const totals = data?.totals || {};
  const maxRevenue = Math.max(...points.map(p => p.revenue), 1);
  const aov = totals.checkoutClicks > 0 ? totals.revenue / totals.checkoutClicks : 0;

  return (
    <aside className="cnv4-analytics-panel">
      <div className="cnv4-analytics-head">
        <div>
          <span className="cnv4-analytics-kicker">Live insight</span>
          <h2>Sales Analytics</h2>
        </div>
        <button className="cnv4-icon-btn" onClick={onClose} aria-label="Close analytics">
          <Icon name="close" size={15} />
        </button>
      </div>

      {loading ? (
        <div className="cnv4-analytics-loading">
          <Icon name="spinner" size={18} />
          <span>Loading sales data...</span>
        </div>
      ) : error ? (
        <div className="cnv4-analytics-error">
          Analytics data is unavailable right now.
        </div>
      ) : (
        <>
          <div className="cnv4-analytics-metrics">
            <div className="cnv4-analytics-metric primary">
              <span>Total revenue</span>
              <strong>{formatMoney(totals.revenue)}</strong>
            </div>
            <div className="cnv4-analytics-metric">
              <span>AOV</span>
              <strong>{formatMoney(aov)}</strong>
            </div>
            <div className="cnv4-analytics-metric">
              <span>Checkout clicks</span>
              <strong>{totals.checkoutClicks || 0}</strong>
            </div>
            <div className="cnv4-analytics-metric">
              <span>Coupons applied</span>
              <strong>{totals.couponsApplied || 0}</strong>
            </div>
          </div>

          <div className="cnv4-analytics-card">
            <div className="cnv4-analytics-card-head">
              <h3>Revenue trend</h3>
              <span>Last 7 days</span>
            </div>
            <div className="cnv4-analytics-chart" aria-label="Revenue trend chart">
              {points.map((point) => (
                <div key={point.label} className="cnv4-analytics-bar-wrap">
                  <div
                    className="cnv4-analytics-bar"
                    style={{ height: `${Math.max(6, (point.revenue / maxRevenue) * 100)}%` }}
                    title={`${point.label}: ${formatMoney(point.revenue)}`}
                  />
                  <span>{point.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="cnv4-analytics-card">
            <div className="cnv4-analytics-card-head">
              <h3>Revenue mix</h3>
            </div>
            <div className="cnv4-analytics-source">
              <span>Upsell revenue</span>
              <strong>{formatMoney(totals.upsellRevenue)}</strong>
            </div>
            <div className="cnv4-analytics-source">
              <span>Coupon clicks</span>
              <strong>{totals.couponClicks || 0}</strong>
            </div>
            <div className="cnv4-analytics-source">
              <span>Upsell clicks</span>
              <strong>{totals.upsellClicks || 0}</strong>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}

// ─── ConversationItem ─────────────────────────────────────────────────────────

function ConversationItem({ conv, active, openMenuId, onSelect, onMenuOpen, onRename, onPin, onDelete }) {
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState(conv.title || "New Chat");
  const inputRef = useRef(null);

  const startRename = (e) => {
    e?.stopPropagation();
    setRenameVal(conv.title || "New Chat");
    setRenaming(true);
    onMenuOpen(null);
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  const commitRename = () => {
    const v = renameVal.trim();
    if (v) onRename(conv.id, v);
    setRenaming(false);
  };

  const menuOpen = openMenuId === conv.id;

  return (
    <div
      className={`cnv4-conv-item${active ? " active" : ""}${conv.pinned ? " pinned" : ""}`}
      onClick={() => !renaming && onSelect(conv.id)}
    >
      {renaming ? (
        <input
          ref={inputRef}
          className="cnv4-rename-input"
          value={renameVal}
          onChange={e => setRenameVal(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <>
          {conv.pinned && <span className="cnv4-pin-mark" title="Pinned"><Icon name="pin" size={12} /></span>}
          <span className="cnv4-conv-title">{conv.title || "New Chat"}</span>
          <button
            className="cnv4-conv-dots"
            aria-label="Options"
            onClick={e => { e.stopPropagation(); onMenuOpen(menuOpen ? null : conv.id); }}
          >
            <Icon name="dots" size={14} />
          </button>
          {menuOpen && (
            <div className="cnv4-conv-menu" onClick={e => e.stopPropagation()}>
              <button onClick={startRename}><Icon name="edit" size={13} /> Rename</button>
              <button onClick={() => { onPin(conv.id, conv.pinned); onMenuOpen(null); }}>
                <Icon name="pin" size={13} /> {conv.pinned ? "Unpin" : "Pin"}
              </button>
              <button className="danger" onClick={() => { onDelete(conv.id); onMenuOpen(null); }}>
                <Icon name="trash" size={13} /> Delete
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CartNinjaAgentV2({ initialQuery = "", onClose }) {
  // Conversation list
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [convLoading, setConvLoading] = useState(true);
  const [openMenuId, setOpenMenuId] = useState(null);

  // Chat
  const [input, setInput] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [currentStage, setCurrentStage] = useState(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState(false);
  const [analyticsData, setAnalyticsData] = useState(null);

  // Refs
  const chatEndRef = useRef(null);
  const textareaRef = useRef(null);
  const stageTimersRef = useRef([]);
  const recognitionRef = useRef(null);

  // Load conversations on mount
  useEffect(() => {
    fetch("/api/ai/conversations")
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          const convs = data.conversations || [];
          setConversations(convs);
          if (convs.length > 0) {
            setActiveConvId(convs[0].id);
            loadMessages(convs[0].id);
          }
        }
      })
      .catch(() => {})
      .finally(() => setConvLoading(false));
  }, []);

  useEffect(() => {
    if (initialQuery) {
      setInput(initialQuery);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [initialQuery]);

  useEffect(() => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    setVoiceSupported(Boolean(Recognition));
    return () => {
      recognitionRef.current?.abort?.();
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, currentStage]);

  // Close menus on outside click
  useEffect(() => {
    const handler = () => setOpenMenuId(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  const loadMessages = useCallback(async (convId) => {
    try {
      const res = await fetch(`/api/ai/conversation/${convId}`);
      const data = await res.json();
      if (!data.success) return;
      const parsed = (data.messages || []).map(m => {
        if (m.role === "user") {
          return { type: "user", id: m.id, text: m.message || m.text || "", ts: m.createdAt };
        }
        const hasActions = Array.isArray(m.executedActions) && m.executedActions.length > 0 && m.synced;
        if (hasActions) {
          return {
            type: "agent", subtype: "action",
            id: m.id, ts: m.createdAt,
            executedActions: m.executedActions,
            verification: m.verification,
            synced: m.synced,
            before: m.before,
            after: m.after,
          };
        }
        return {
          type: "agent", subtype: m.off_topic ? "text" : "text",
          id: m.id, ts: m.createdAt,
          text: m.message || m.text || "",
        };
      });
      setMessages(parsed);
    } catch {}
  }, []);

  const startStages = useCallback(() => {
    setCurrentStage("thinking");
    const timers = STAGE_DELAYS.slice(1).map((delay, i) =>
      setTimeout(() => setCurrentStage(STAGES[i + 1]?.id ?? "verifying"), delay)
    );
    stageTimersRef.current = timers;
  }, []);

  const stopStages = useCallback(() => {
    stageTimersRef.current.forEach(clearTimeout);
    stageTimersRef.current = [];
    setCurrentStage(null);
  }, []);

  const openAnalyticsPanel = useCallback(async () => {
    setAnalyticsOpen(true);
    setAnalyticsLoading(true);
    setAnalyticsError(false);
    try {
      const result = await fetchAnalyticsRange(7);
      setAnalyticsData(result);
    } catch {
      setAnalyticsError(true);
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  const handleVoiceInput = useCallback(() => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition || loading) return;

    if (listening) {
      recognitionRef.current?.stop?.();
      setListening(false);
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "en-IN";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognitionRef.current = recognition;

    let finalTranscript = "";
    recognition.onstart = () => setListening(true);
    recognition.onresult = (event) => {
      let interimTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) finalTranscript += transcript;
        else interimTranscript += transcript;
      }
      const nextText = `${finalTranscript || ""}${interimTranscript ? ` ${interimTranscript}` : ""}`.trim();
      setInput(nextText);
      setTimeout(() => textareaRef.current && autoResize(textareaRef.current), 0);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognition.start();
  }, [listening, loading]);

  const handleNewChat = useCallback(() => {
    setActiveConvId(null);
    setMessages([]);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  const selectConversation = useCallback(async (convId) => {
    if (convId === activeConvId) return;
    setActiveConvId(convId);
    setMessages([]);
    await loadMessages(convId);
  }, [activeConvId, loadMessages]);

  const createConversation = useCallback(async (title) => {
    try {
      const res = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const data = await res.json();
      if (data.success) {
        setConversations(prev => [data.conversation, ...prev]);
        return data.conversation;
      }
    } catch {}
    return null;
  }, []);

  const handleDelete = useCallback(async (convId) => {
    await fetch(`/api/ai/conversation/${convId}`, { method: "DELETE" }).catch(() => {});
    setConversations(prev => prev.filter(c => c.id !== convId));
    if (activeConvId === convId) {
      setActiveConvId(null);
      setMessages([]);
    }
  }, [activeConvId]);

  const handlePin = useCallback(async (convId, currentlyPinned) => {
    await fetch(`/api/ai/conversation/${convId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !currentlyPinned }),
    }).catch(() => {});
    setConversations(prev => prev.map(c => c.id === convId ? { ...c, pinned: !currentlyPinned } : c));
  }, []);

  const handleRename = useCallback(async (convId, newTitle) => {
    await fetch(`/api/ai/conversation/${convId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle }),
    }).catch(() => {});
    setConversations(prev => prev.map(c => c.id === convId ? { ...c, title: newTitle } : c));
  }, []);

  const handleUndo = useCallback((beforeState) => {
    if (!beforeState?.cart) return;
    // Sync local UI state back to the pre-action snapshot
    syncAfterToFeatureStore({ cart: beforeState.cart, fbt: beforeState.fbt });
  }, []);

  const sendMessage = useCallback(async (text) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    if (isAnalyticsQuery(trimmed)) {
      openAnalyticsPanel();
    } else {
      setAnalyticsOpen(false);
    }

    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setLoading(true);

    // Ensure active conversation exists
    let convId = activeConvId;
    if (!convId) {
      const conv = await createConversation(generateTitle(trimmed));
      if (!conv) { setLoading(false); return; }
      convId = conv.id;
      setActiveConvId(convId);
    } else if (messages.length === 0) {
      // Update title from first user message
      const title = generateTitle(trimmed);
      handleRename(convId, title);
    }

    // Add user message immediately
    const userMsg = { type: "user", id: `u-${Date.now()}`, text: trimmed, ts: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);

    // Build history for context
    const history = messages.map(m => ({
      role: m.type === "user" ? "user" : "assistant",
      text: m.text || m.message || "",
    }));

    startStages();
    const t0 = Date.now();

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convId, message: trimmed, messages: history }),
      });

      const data = await res.json();
      const timeTaken = ((Date.now() - t0) / 1000).toFixed(1);
      stopStages();

      if (data.after) syncAfterToFeatureStore(data.after);

      const isAction =
        data.success &&
        Array.isArray(data.executedActions) &&
        data.executedActions.length > 0 &&
        data.synced &&
        data.verification?.verified;

      const agentMsg = isAction
        ? {
            type: "agent", subtype: "action",
            id: data.messageId || `a-${Date.now()}`,
            ts: new Date().toISOString(),
            executedActions: data.executedActions,
            verification: data.verification,
            synced: data.synced,
            before: data.before,
            after: data.after,
            timeTaken,
          }
        : {
            type: "agent", subtype: data.success ? "text" : "error",
            id: data.messageId || `a-${Date.now()}`,
            ts: new Date().toISOString(),
            text: data.message || (data.success ? "Done." : "Something went wrong. Please try again."),
          };

      setMessages(prev => [...prev, agentMsg]);

      // Bubble conversation to top
      const nowStr = new Date().toISOString();
      setConversations(prev =>
        prev
          .map(c => c.id === convId ? { ...c, updatedAt: nowStr } : c)
          .sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            return new Date(b.updatedAt) - new Date(a.updatedAt);
          })
      );
    } catch {
      stopStages();
      setMessages(prev => [...prev, {
        type: "agent", subtype: "error",
        id: `e-${Date.now()}`,
        ts: new Date().toISOString(),
        text: "Connection error. Please check your network and try again.",
      }]);
    } finally {
      setLoading(false);
    }
  }, [activeConvId, messages, loading, createConversation, handleRename, startStages, stopStages, openAnalyticsPanel]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  };

  const groups = groupConversations(conversations, searchQuery);
  const activeConv = conversations.find(c => c.id === activeConvId);
  const showWelcome = messages.length === 0 && !currentStage;

  return (
    <div className={`cnv4-root${analyticsOpen ? " has-analytics" : ""}`} onClick={() => setOpenMenuId(null)}>

      {/* ── Sidebar ── */}
      <aside className="cnv4-sidebar" onClick={e => e.stopPropagation()}>
        <div className="cnv4-sidebar-head">
          <div className="cnv4-sidebar-brand">
            <div className="cnv4-sidebar-logo"><Icon name="logo" size={16} /></div>
            <span>Cart Ninja</span>
          </div>
          <button className="cnv4-new-btn" onClick={handleNewChat}>
            <Icon name="plus" size={15} />
            New Chat
          </button>
        </div>

        <div className="cnv4-search-wrap">
          <Icon name="search" size={14} />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="cnv4-search-input"
          />
          {searchQuery && (
            <button className="cnv4-search-clear" onClick={() => setSearchQuery("")}>
              <Icon name="close" size={12} />
            </button>
          )}
        </div>

        <div className="cnv4-conv-list">
          {convLoading ? (
            <div className="cnv4-conv-placeholder">
              <div className="cnv4-conv-skel" />
              <div className="cnv4-conv-skel short" />
              <div className="cnv4-conv-skel" />
            </div>
          ) : Object.keys(groups).length === 0 ? (
            <div className="cnv4-conv-empty">
              {searchQuery ? "No results" : "No conversations yet.\nStart a new chat!"}
            </div>
          ) : (
            Object.entries(groups).map(([groupName, convs]) => (
              <div key={groupName} className="cnv4-conv-group">
                <div className="cnv4-conv-group-label">{groupName}</div>
                {convs.map(conv => (
                  <ConversationItem
                    key={conv.id}
                    conv={conv}
                    active={activeConvId === conv.id}
                    openMenuId={openMenuId}
                    onSelect={selectConversation}
                    onMenuOpen={setOpenMenuId}
                    onRename={handleRename}
                    onPin={handlePin}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="cnv4-main">
        {/* Header */}
        <header className="cnv4-header">
          <div className="cnv4-header-left">
            <h1>{activeConv?.title || "Cart Ninja AI Agent"}</h1>
            <span className="cnv4-connected"><span className="cnv4-dot" />Connected</span>
          </div>
          {onClose && (
            <button className="cnv4-icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="close" size={16} />
            </button>
          )}
        </header>

        {/* Chat */}
        <div className="cnv4-chat-area">
          {showWelcome ? (
            <div className="cnv4-welcome">
              <div className="cnv4-welcome-logo"><Icon name="logo" size={34} /></div>
              <h2>Ready to optimize your cart</h2>
              <p>Choose an action or describe what you'd like to do.</p>
              <div className="cnv4-quick-grid">
                {QUICK_ACTIONS.map(a => (
                  <button
                    key={a.icon}
                    className="cnv4-quick-card"
                    onClick={() => sendMessage(a.query)}
                    disabled={loading}
                  >
                    <span className="cnv4-quick-icon"><Icon name={a.icon} size={18} /></span>
                    <span className="cnv4-quick-title">{a.title}</span>
                    <span className="cnv4-quick-desc">{a.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="cnv4-messages">
              {messages.map(msg => {
                if (msg.type === "user") {
                  return (
                    <div key={msg.id} className="cnv4-msg-row user">
                      <div className="cnv4-bubble user">{msg.text}</div>
                      <time className="cnv4-msg-time">{formatTime(msg.ts)}</time>
                    </div>
                  );
                }
                if (msg.subtype === "action") {
                  return (
                    <div key={msg.id} className="cnv4-msg-row agent">
                      <div className="cnv4-agent-avatar"><Icon name="logo" size={15} /></div>
                      <div className="cnv4-agent-body">
                        <AgentResultCard
                          executedActions={msg.executedActions}
                          verification={msg.verification}
                          synced={msg.synced}
                          before={msg.before}
                          timeTaken={msg.timeTaken}
                          onUndo={() => handleUndo(msg.before)}
                        />
                        <time className="cnv4-msg-time">{formatTime(msg.ts)}</time>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={msg.id} className={`cnv4-msg-row agent${msg.subtype === "error" ? " error" : ""}`}>
                    <div className={`cnv4-agent-avatar${msg.subtype === "error" ? " error" : ""}`}>
                      {msg.subtype === "error" ? <Icon name="warning" size={15} /> : <Icon name="logo" size={15} />}
                    </div>
                    <div className="cnv4-agent-body">
                      <div className={`cnv4-bubble agent${msg.subtype === "error" ? " error" : ""}`}>
                        <pre>{msg.text}</pre>
                      </div>
                      <time className="cnv4-msg-time">{formatTime(msg.ts)}</time>
                    </div>
                  </div>
                );
              })}

              {currentStage && (
                <div className="cnv4-msg-row agent">
                  <div className="cnv4-agent-avatar"><Icon name="logo" size={15} /></div>
                  <div className="cnv4-agent-body">
                    <StageIndicator stage={currentStage} />
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="cnv4-composer-wrap">
          <div className={`cnv4-composer${loading ? " busy" : ""}`}>
            <textarea
              ref={textareaRef}
              rows={1}
              placeholder="Ask the agent to enable features, change colors, analyze your store, create offers..."
              value={input}
              onChange={e => { setInput(e.target.value); autoResize(e.target); }}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <div className="cnv4-composer-actions">
              {voiceSupported && (
                <button
                  className={`cnv4-icon-btn cnv4-mic-btn${listening ? " listening" : ""}`}
                  title={listening ? "Stop voice input" : "Voice input"}
                  onClick={handleVoiceInput}
                  disabled={loading}
                  aria-label={listening ? "Stop voice input" : "Start voice input"}
                  type="button"
                >
                  <Icon name="mic" size={16} />
                </button>
              )}
              <button
                className={`cnv4-send${loading ? " busy" : ""}`}
                disabled={!input.trim() || loading}
                onClick={() => sendMessage(input)}
                aria-label="Send"
              >
                {loading ? <Icon name="spinner" size={16} /> : <Icon name="send" size={16} />}
              </button>
            </div>
          </div>
          <p className="cnv4-hint">Agent executes real store changes · changes are logged and can be undone</p>
        </div>
      </main>

      <AnalyticsPanel
        open={analyticsOpen}
        loading={analyticsLoading}
        data={analyticsData}
        error={analyticsError}
        onClose={() => setAnalyticsOpen(false)}
      />
    </div>
  );
}
