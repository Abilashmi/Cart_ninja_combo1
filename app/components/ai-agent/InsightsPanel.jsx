import { useMemo } from "react";

const BRAND = { primary: "#FF6B00", secondary: "#FF8A33", lightBg: "#FFF3EB" };

const MODULES = [
  { key: "cart_drawer", label: "Cart Drawer" },
  { key: "progress_bar", label: "Progress Bar" },
  { key: "coupon_slider", label: "Coupon Slider" },
  { key: "upsells", label: "Upsells" },
  { key: "trust_badges", label: "Trust Badges" },
  { key: "fbt", label: "Frequently Bought Together" },
  { key: "coupon_banner", label: "Coupon Banner" },
  { key: "coupon_creator", label: "Coupon Creator" },
  { key: "combo_forge", label: "Combo Forge" },
];

function getModuleState(key) {
  try {
    const raw = localStorage.getItem("cartninja_feature_state");
    const state = raw ? JSON.parse(raw) : {};
    const defaults = {
      cart_drawer: true, progress_bar: false, coupon_slider: false,
      upsells: false, trust_badges: false, fbt: true,
      coupon_banner: true, coupon_creator: true, combo_forge: true,
    };
    return (state[key] ?? defaults[key]) ? "on" : "off";
  } catch {
    return "on";
  }
}

const WEEKLY_DATA = [
  { label: "Mon", value: 40 },
  { label: "Tue", value: 30 },
  { label: "Wed", value: 55 },
  { label: "Thu", value: 70 },
  { label: "Fri", value: 45 },
  { label: "Sat", value: 85 },
  { label: "Sun", value: 65 },
];

export default function InsightsPanel({ mode, onModeChange, onAction }) {
  const content = useMemo(() => {
    switch (mode) {
      case "analytics":
        return <AnalyticsMode />;
      case "recommendation":
        return <RecommendationMode onAction={onAction} />;
      case "configuration":
        return <ConfigurationMode />;
      case "design":
        return <DesignMode onAction={onAction} />;
      default:
        return <ModulesMode />;
    }
  }, [mode, onAction]);

  return (
    <div className="ai-insights-panel">
      <div className="ai-insights-inner">
        <div className="ai-fright-header">
          <span className="ai-fright-title">
            {mode === "analytics" ? "Analytics" :
             mode === "recommendation" ? "Recommendations" :
             mode === "configuration" ? "Configuration" :
             mode === "design" ? "Design" : "Modules"}
          </span>
          <div className="ai-fright-tabs">
            {["analytics", "recommendation", "configuration", "design"].map((m) => (
              <button
                key={m}
                className={`ai-fright-tab${mode === m ? " active" : ""}`}
                onClick={() => onModeChange(m)}
              >
                {m === "analytics" ? "A" : m === "recommendation" ? "R" : m === "configuration" ? "C" : "D"}
              </button>
            ))}
          </div>
        </div>
        <div className="ai-fright-body">{content}</div>
      </div>
    </div>
  );
}

function AnalyticsMode() {
  return (
    <div>
      <MetricCard label="Conversion Rate" value="3.8%" delta="+12%" trend="up" />
      <MetricCard label="Average Order Value" value="$54.20" delta="+8%" trend="up" />
      <div className="ai-fanalytics-chart">
        {WEEKLY_DATA.map((d, i) => (
          <div
            key={i}
            className="ai-fanalytics-bar"
            style={{
              height: `${d.value}%`,
              background: i === WEEKLY_DATA.length - 1 ? BRAND.primary : "#FFD4B3",
            }}
          >
            <span className="ai-fanalytics-bar-label">{d.label}</span>
          </div>
        ))}
      </div>
      <MetricCard label="Cart Abandonment" value="68%" delta="+5%" trend="down" />
    </div>
  );
}

function MetricCard({ label, value, delta, trend }) {
  return (
    <div className="ai-fanalytics-metric">
      <div className="ai-fanalytics-metric-label">{label}</div>
      <div className="ai-fanalytics-metric-value">{value}</div>
      <div className={`ai-fanalytics-metric-delta ${trend === "up" ? "up" : "down"}`}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          {trend === "up" ? <path d="M6 10V2M2 6l4-4 4 4" /> : <path d="M6 2v8M2 6l4 4 4-4" />}
        </svg>
        <span>{delta} vs last month</span>
      </div>
    </div>
  );
}

function RecommendationMode({ onAction }) {
  const items = [
    {
      title: "Free Shipping Goal",
      desc: "Your goal is set at $50. Most stores in your category use $79.",
      impact: "Potential AOV Increase: +18%",
      action: "Apply Recommendation",
    },
    {
      title: "Enable Trust Badges",
      desc: "Adding trust badges can improve conversion by 8-12%.",
      impact: "Potential Conversion Lift: +12%",
      action: "Enable Now",
    },
    {
      title: "Upsell Campaign",
      desc: "Generate an upsell campaign to boost AOV by 15-20%.",
      impact: "Potential AOV Increase: +20%",
      action: "Generate",
    },
  ];

  return (
    <div className="ai-frecommend">
      {items.map((item, i) => (
        <div key={i} className="ai-frecommend-item">
          <div className="ai-frecommend-item-title">{item.title}</div>
          <div className="ai-frecommend-item-desc">{item.desc}</div>
          <div className="ai-frecommend-item-impact">{item.impact}</div>
          <div className="ai-frecommend-item-actions">
            <button className="ai-frecommend-item-btn primary" onClick={() => onAction?.(item.action)}>{item.action}</button>
            <button className="ai-frecommend-item-btn">Preview</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ConfigurationMode() {
  return (
    <div className="ai-fconfig-section">
      <div className="ai-fconfig-section-title">Current Settings</div>
      <ConfigItem label="Cart Drawer" value="Enabled" />
      <ConfigItem label="Progress Bar" value="₹500 goal" />
      <ConfigItem label="FBT" value="Enabled" />
      <div className="ai-fconfig-section-title" style={{ marginTop: 16 }}>Pending Changes</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "var(--aibg, #FAFAFA)", borderRadius: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 13 }}>Enable Upsells</span>
        <span className="ai-fconfig-badge pending">Pending</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "var(--aibg, #FAFAFA)", borderRadius: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 13 }}>Trust Badges</span>
        <span className="ai-fconfig-badge pending">Pending</span>
      </div>
      <div className="ai-fconfig-section-title" style={{ marginTop: 16 }}>Applied Changes</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "var(--aibg, #FAFAFA)", borderRadius: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 13 }}>Cart Drawer Theme</span>
        <span className="ai-fconfig-badge applied">Applied</span>
      </div>
    </div>
  );
}

function ConfigItem({ label, value }) {
  return (
    <div className="ai-fconfig-item">
      <span className="ai-fconfig-item-label">{label}</span>
      <span className="ai-fconfig-item-value">{value}</span>
    </div>
  );
}

function DesignMode({ onAction }) {
  return (
    <div className="ai-fdesign-section">
      <div className="ai-fdesign-section-title">Theme Suggestions</div>
      <div className="ai-fdesign-swatch" style={{ background: "linear-gradient(135deg, #FF6B00, #FF8A33)" }} />
      <DesignItem
        bg="#1A1A1A"
        title="Premium Dark"
        desc="Modern dark theme with gradient accents"
        onClick={() => onAction?.("Apply premium theme")}
      />
      <DesignItem
        bg="#FFFFFF"
        border="1px solid #E8E8E8"
        iconColor="#1A1A1A"
        title="Minimal Light"
        desc="Clean, minimalist design for modern stores"
        onClick={() => onAction?.("Apply minimal theme")}
      />
      <DesignItem
        bg="linear-gradient(135deg, #B8860B, #FFD700)"
        title="Luxury Gold"
        desc="Premium gold accents for high-end stores"
        onClick={() => onAction?.("Apply luxury theme")}
      />
      <div className="ai-fdesign-section-title" style={{ marginTop: 16 }}>Layout Recommendations</div>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
          background: "var(--aibg, #FAFAFA)", borderRadius: 6, marginBottom: 6,
        }}
      >
        <div style={{ width: 32, height: 32, borderRadius: 8, background: "#FFF3EB", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#FF6B00" strokeWidth="1.5"><rect x="2" y="2" width="12" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#1A1A1A" }}>Optimize Mobile Layout</div>
          <div style={{ fontSize: 11, color: "#6B6B6B" }}>Single column, larger tap targets, sticky CTA</div>
        </div>
      </div>
    </div>
  );
}

function DesignItem({ bg, border, iconColor, title, desc, onClick }) {
  return (
    <div className="ai-fdesign-item" onClick={onClick}>
      <div className="ai-fdesign-item-icon" style={{ background: bg, border: border || "none" }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={iconColor || "#fff"} strokeWidth="1.5"><rect x="2" y="2" width="12" height="12" rx="2" /></svg>
      </div>
      <div className="ai-fdesign-item-text">
        <div className="ai-fdesign-item-title">{title}</div>
        <div className="ai-fdesign-item-desc">{desc}</div>
      </div>
    </div>
  );
}

function ModulesMode() {
  return (
    <div className="ai-fmodules">
      {MODULES.map((m) => {
        const state = getModuleState(m.key);
        return (
          <div key={m.key} className="ai-fmodule-item">
            <span className="ai-fmodule-label">{m.label}</span>
            <span className={`ai-fmodule-badge ${state}`}>
              {state === "on" ? "Active" : "Inactive"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
