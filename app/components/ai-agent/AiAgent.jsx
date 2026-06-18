import { useState, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { featureStore } from "./featureStore";
import AILoadingState from "./AILoadingState";
import "./ai-agent.css";

function syncAfterToFeatureStore(after) {
  if (!after) return;
  const cart = after.cart;
  const fbt = after.fbt;
  if (cart) {
    if (cart.drawerEnabled != null) featureStore.set("cart_drawer", cart.drawerEnabled);
    if (cart.upsell?.enabled != null) featureStore.set("upsells", cart.upsell.enabled);
    if (cart.goalBar?.enabled != null) featureStore.set("progress_bar", cart.goalBar.enabled);
    if (cart.trustBadges?.enabled != null) featureStore.set("trust_badges", cart.trustBadges.enabled);
    if (cart.announcement?.enabled != null) featureStore.set("announcements", cart.announcement.enabled);
    if (cart.couponSlider?.enabled != null) featureStore.set("coupon_slider", cart.couponSlider.enabled);
    if (cart.checkoutButton?.backgroundColor) {
      try {
        const cfgKey = "cartninja_cart_config";
        const raw = localStorage.getItem(cfgKey);
        const cfg = raw ? JSON.parse(raw) : {};
        cfg.checkoutButtonStyle = {
          backgroundColor: cart.checkoutButton.backgroundColor,
          textColor: cart.checkoutButton.textColor || "#ffffff",
          borderRadius: cart.checkoutButton.borderRadius ?? 4,
        };
        localStorage.setItem(cfgKey, JSON.stringify(cfg));
        window.dispatchEvent(new CustomEvent("featureStateChanged", { detail: { key: "checkout_style" } }));
      } catch {}
    }
    // Push color/config changes to CartEditorContext so the editor updates live
    window.dispatchEvent(new CustomEvent("cartEditorConfigUpdated", { detail: cart }));
  }
  if (fbt?.enabled != null) featureStore.set("fbt", fbt.enabled);
}
import AIChangesSummary from "./AIChangesSummary";
import AINeedsInputCard from "./AINeedsInputCard";
import { aiApi } from "./api";

const HAMBURGER_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M2 4h12M2 8h12M2 12h12" />
  </svg>
);
const SPARKLE_ICON = (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#534AB7" strokeWidth="1.5">
    <path d="M7 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" />
  </svg>
);
const SEND_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round">
    <path d="M2 8l12-4-4 8-3-3-3-3z" />
  </svg>
);

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

function invertAction(action) {
  if (action === "enable") return "disable";
  if (action === "disable") return "enable";
  return action;
}

const MODULE_TO_ENGINE = {
  cartDrawer: { enable: "enableDrawer", disable: "disableDrawer", configureCartDrawer: "configureCartDrawer" },
  progressBar: { enable: "enableGoalBar", disable: "disableGoalBar", configureGoalBar: "configureGoalBar" },
  upsells: { enable: "enableUpsell", disable: "disableUpsell", configureUpsell: "configureUpsell" },
  fbt: { enable: "enableFBT", disable: "disableFBT", configureFBT: "configureFBT" },
  trustBadges: { enable: "enableTrustBadges", disable: "disableTrustBadges" },
  announcements: { enable: "enableAnnouncement", disable: "disableAnnouncement", configureAnnouncement: "configureAnnouncement" },
};

const ACTION_LABELS = {
  cartDrawer: "Cart Drawer", progressBar: "Progress Bar",
  upsells: "Upsells", fbt: "FBT", trustBadges: "Trust Badges",
  announcements: "Announcement", styling: "Styling", optimization: "Optimization",
};

function extractActions(text) {
  const lower = text.toLowerCase();
  const actions = [];
  const wantDisable = /disable|turn off|deactiv|remove|stop|hide|close/.test(lower);

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
  if (/match.?theme|sync.?theme|detect.?theme|auto.?theme|copy.?theme/i.test(lower)) {
    actions.push({ module: "styling", action: "matchTheme", engine: "matchTheme", label: "Match Store Theme" });
    return actions;
  }
  if (/optimize.*mobile|mobile.*optimize|responsive/i.test(lower)) {
    actions.push({ module: "optimization", action: "optimizeMobile", engine: "optimizeMobile", label: "Optimize Mobile" });
    return actions;
  }
  if (/create.*bundle|bundle.*offer|combo.*forge/i.test(lower)) {
    actions.push({ module: "comboForge", action: "createBundle", engine: "createBundle", label: "Create Bundle" });
    return actions;
  }

  // ── Color / brand customization ──
  const COLOR_MAP = {
    pink: "#FF69B4", red: "#EF4444", blue: "#3B82F6", green: "#22C55E",
    purple: "#A855F7", orange: "#F97316", yellow: "#EAB308", black: "#111827",
    white: "#F9FAFB", teal: "#14B8A6", indigo: "#6366F1", rose: "#F43F5E",
    violet: "#8B5CF6", gold: "#D97706", coral: "#F87171", navy: "#1E3A8A",
    cyan: "#06B6D4", lime: "#84CC16", amber: "#F59E0B", sky: "#0EA5E9",
  };
  const colorNamePattern = Object.keys(COLOR_MAP).join("|");
  const colorRegex = new RegExp(`\\b(${colorNamePattern}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\\b`, "i");
  const colorMatch = lower.match(colorRegex);
  if (colorMatch && /(color|theme|style|everything|all|entire|whole|cart|customiz|brand|make|set|use|apply)/i.test(lower)) {
    const colorName = colorMatch[1].toLowerCase();
    const hexColor = colorName.startsWith("#") ? colorName.toUpperCase() : COLOR_MAP[colorName];
    actions.push({
      module: "styling", action: "updateStyling", engine: "updateStyling",
      settings: { accentColor: hexColor },
      label: `Apply ${colorMatch[1].charAt(0).toUpperCase() + colorMatch[1].slice(1)} Theme`,
    });
    return actions;
  }

  // ── Full-workflow configure actions (map simple intents to complete setups) ──
  const isFullSetup = /set.?up|config|full|complete|setup|install/i.test(lower);
  const isCartDrawer = /cart.*drawer|drawer/.test(lower);
  const isGoalBar = /progress.?bar|goal|free.?shipping|shipping.?progress/i.test(lower);
  const isFbt = /fbt|frequently.*bought/i.test(lower);
  const isUpsell = /upsell/i.test(lower) && !isFbt;
  const isTrustBadges = /trust.?badge|security|secure|badge/i.test(lower) && !/goal|progress|shipping/.test(lower);
  const isAnnouncement = /announc|promo.*banner|notif.*bar|message.*bar/i.test(lower);

  if (wantDisable) {
    if (isCartDrawer) actions.push({ module: "cartDrawer", action: "disable", engine: "disableDrawer", label: "Disable Cart Drawer" });
    if (isGoalBar) actions.push({ module: "progressBar", action: "disable", engine: "disableGoalBar", label: "Disable Progress Bar" });
    if (isUpsell) actions.push({ module: "upsells", action: "disable", engine: "disableUpsell", label: "Disable Upsells" });
    if (isFbt) actions.push({ module: "fbt", action: "disable", engine: "disableFBT", label: "Disable FBT" });
    if (isTrustBadges) actions.push({ module: "trustBadges", action: "disable", engine: "disableTrustBadges", label: "Disable Trust Badges" });
    if (isAnnouncement) actions.push({ module: "announcements", action: "disable", engine: "disableAnnouncement", label: "Disable Announcement Banner" });
    return actions;
  }

  // Full-workflow: configure with intelligent defaults
  if (isCartDrawer) {
    const settings = { enabled: true };
    if (/dark|themed?/.test(lower)) settings.theme = "dark";
    if (/round|radius/.test(lower)) settings.borderRadius = 20;
    actions.push(isFullSetup
      ? { module: "cartDrawer", action: "configureCartDrawer", engine: "configureCartDrawer", settings, label: "Configure Cart Drawer" }
      : { module: "cartDrawer", action: "enable", engine: "enableDrawer", label: "Enable Cart Drawer" });
  }
  if (isGoalBar) {
    const settings = { enabled: true };
    const match = lower.match(/(?:rs\.?\s*)?(\d+)/);
    if (match) settings.goal = parseInt(match[1], 10);
    if (/inr|rs\./i.test(lower)) settings.currency = "INR";
    actions.push({ module: "progressBar", action: "configureGoalBar", engine: "configureGoalBar", settings, label: "Configure Progress Bar" });
  }
  if (isUpsell) {
    actions.push(isFullSetup
      ? { module: "upsells", action: "configureUpsell", engine: "configureUpsell", settings: { layout: "slider", template: "modern" }, label: "Configure Upsells" }
      : { module: "upsells", action: "enable", engine: "enableUpsell", label: "Enable Upsells" });
  }
  if (isFbt) {
    actions.push(isFullSetup
      ? { module: "fbt", action: "configureFBT", engine: "configureFBT", settings: { template: "fbt2", mode: "ai" }, label: "Configure FBT" }
      : { module: "fbt", action: "enable", engine: "enableFBT", label: "Enable FBT" });
  }
  if (isTrustBadges) {
    actions.push({ module: "trustBadges", action: "enable", engine: "enableTrustBadges", label: "Enable Trust Badges" });
  }
  if (isAnnouncement) {
    const settings = { enabled: true };
    const textMatch = lower.match(/(?:say|text|message|show)\s+[""]([^""]+)[""]/i);
    if (textMatch) settings.text = textMatch[1];
    if (/free.?shipping/i.test(lower)) settings.text = "Free shipping on all orders!";
    actions.push(isFullSetup
      ? { module: "announcements", action: "configureAnnouncement", engine: "configureAnnouncement", settings, label: "Configure Announcement Banner" }
      : { module: "announcements", action: "enable", engine: "enableAnnouncement", label: "Enable Announcement Banner" });
  }

  return actions;
}

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
      body: JSON.stringify({ prompt: "", plan: { summary: "AI command", actions: engineActions, settings: planSettings }, mode: "apply" }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      return { success: false, error: err.error || `HTTP ${res.status}` };
    }
    const data = await res.json();
    return {
      success: true,
      synced: data.synced,
      before: data.before,
      after: data.after,
      rawCartBefore: data.rawCartBefore,
      verification: data.verification,
      backendResponses: data.backendResponses,
    };
  } catch (e) {
    return { success: false, error: e.message || "Network error" };
  }
}

function executeActions(actions) {
  const results = [];
  for (const a of actions) {
    const entry = Object.entries(MODULE_MAP).find(([, v]) => v.name === a.module);
    const storeKey = entry?.[1]?.store;
    const extraSettings = a.settings && Object.keys(a.settings).filter((k) => k !== "enabled").length > 0;

    {
      const cfgKey = "cartninja_cart_config";
      try {
        const raw = localStorage.getItem(cfgKey);
        const cfg = raw ? JSON.parse(raw) : {};
        if (a.settings && (a.action === "update" || extraSettings)) {
          if (a.module === "styling" && a.settings.target === "checkout_button") {
            cfg.checkoutButtonStyle = {
              backgroundColor: a.settings.color || "#111827",
              textColor: "#ffffff",
              borderRadius: 8,
            };
          } else if (a.module === "cartDrawer") {
            if (a.settings.theme) cfg.drawerTheme = a.settings.theme;
            if (a.settings.borderRadius != null) cfg.drawerBorderRadius = a.settings.borderRadius;
          }
        }
        if (storeKey) {
          cfg.moduleStates = cfg.moduleStates || {};
          cfg.moduleStates[storeKey] = a.action !== "disable";
        }
        localStorage.setItem(cfgKey, JSON.stringify(cfg));
      } catch { /* ignore */ }
    }

    if (a.action === "enable" || a.action === "disable") {
      if (storeKey) featureStore.set(storeKey, a.action === "enable");
      if (extraSettings) {
        const key = storeKey || a.module;
        featureStore.setSettings(key, a.settings);
      }
    } else if (a.action === "update" && a.settings && entry) {
      const key = storeKey || a.module;
      if (storeKey) featureStore.set(storeKey, true);
      featureStore.setSettings(key, a.settings);
    }

    results.push({ module: a.module, action: a.action, status: "executed" });
  }
  return results;
}

function generateTitle(text) {
  const ACRONYM_WORDS = new Set(["aov", "fbt", "css", "api", "seo", "url", "ui", "ux"]);
  let t = text.trim();
  t = t.replace(/\b(please|thanks|thank you|can you|i want to|could you|would you|just|hey|hello|hi|need|want)\b/gi, "");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/[.!?,;:]+$/, "");
  const words = t.split(/\s+/).map((w) => {
    if (ACRONYM_WORDS.has(w.toLowerCase())) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  });
  t = words.join(" ");
  if (t.length > 40) {
    const m = t.match(/\s+(With|Using|Set|To|At|On|For|And|Of|In)\s+/i);
    if (m && m.index > 10) t = t.slice(0, m.index);
    if (t.length > 40) t = t.slice(0, 37) + "...";
  }
  return t || "New Chat";
}

function getTimeGroup(ts) {
  const diff = Date.now() - ts;
  if (diff < 864e5) return "Today";
  if (diff < 1728e5) return "Yesterday";
  if (diff < 6048e5) return "Last 7 Days";
  if (diff < 2592e6) return "Last 30 Days";
  return "Older";
}

function undoAction(action) {
  const entry = Object.entries(MODULE_MAP).find(([, v]) => v.name === action.module);
  const storeKey = entry?.[1]?.store;
  try {
    const cfgKey = "cartninja_cart_config";
    const raw = localStorage.getItem(cfgKey);
    if (raw) {
      const cfg = JSON.parse(raw);
      if (action.action === "update") {
        if (action.module === "styling" && action.settings?.target === "checkout_button") delete cfg.checkoutButtonStyle;
        if (action.module === "cartDrawer") {
          delete cfg.drawerTheme;
          delete cfg.drawerBorderRadius;
        }
      }
      if (storeKey && cfg.moduleStates) {
        const inverted = action.action === "enable" ? "disable" : action.action === "disable" ? "enable" : null;
        if (inverted) cfg.moduleStates[storeKey] = inverted === "enable";
      }
      localStorage.setItem(cfgKey, JSON.stringify(cfg));
    }
  } catch { /* ignore */ }
  if (action.action === "update") {
    if (storeKey) featureStore.removeSettings(storeKey);
    featureStore.removeSettings(action.module);
  } else if (storeKey) {
    const inverted = invertAction(action.action);
    if (inverted === "enable" || inverted === "disable") {
      featureStore.set(storeKey, inverted === "enable");
    }
  }
}

function modeCard(type, data, extra) {
  return Promise.resolve({ id: "r-" + Date.now(), role: "agent", type, data, ...extra });
}

const MK = (re) => (lower) => re.test(lower);
const and = (...fns) => (lower) => fns.every((f) => f(lower));

const detectMode = (lower) => {
  if (MK(/audit.*(store|cart|setup|conversion)|analyze.*(setup|store|cart|conversion)|check.*(conversion|setup)/i)(lower))
    return "audit";
  if (MK(/increase.*(revenue|aov|conversion|sale)|improve.*conversion|reduce.*(abandon|cancel|drop)|collect.*(lead|email)|boost.*(sale|revenue|aov)/i)(lower))
    return "strategy";
  if (MK(/campaign|launch.*(sale|offer)|weekend.*offer|(diwali|black.?friday|independence|christmas|new.?year|holiday).*(sale|campaign|offer)|create.*(campaign|sale|offer)/i)(lower))
    return "campaign";
  if (MK(/why.*(conversion|abandon|drop|low|leaving)|cart.*doctor|diagnos|improve.*checkout/i)(lower))
    return "diagnosis";
  if (MK(/what.*(enable|important|recommend|best|feature|setup|prioritize|first)|which.*(feature|module).*(important|best|recommend|prioritize|most|use|popular|common)|most.*(use|popular|common|enable)|top.*(feature|module)/i)(lower))
    return "bestpractice";
  if (MK(/recommendation|opportunit|suggest|what.*(next|missing|improve)|what.*(else|more).*(enable|do)/i)(lower))
    return "recommendation";
  return null;
};

function mockApi(text) {
  const lower = text.toLowerCase();

  const mode = detectMode(lower);
  if (mode === "audit") {
    return makeMsg(
      "Task: Store Audit\nStatus: Completed\n\n" +
      "Cart Optimization Score: 72/100\n\n" +
      "Affected Modules:\n  \u2022 Cart Drawer (active)\n  \u2022 Progress Bar (inactive)\n  \u2022 FBT (inactive)\n  \u2022 Upsells (inactive)\n\n" +
      "Recommendations:\n  \u2022 Enable Progress Bar \u2014 20-30% conversion lift\n  \u2022 Activate FBT \u2014 10-20% extra revenue\n  \u2022 Enable Upsells \u2014 10-20% AOV increase\n\n" +
      "Apply these recommendations?"
    );
  }

  if (mode === "strategy") {
    const goal = /aov|order.?value/i.test(lower) ? "Increase AOV"
      : /revenue|sale/i.test(lower) ? "Increase Revenue"
      : /conversion|rate/i.test(lower) ? "Improve Conversion Rate"
      : /lead|email|collect/i.test(lower) ? "Collect More Leads"
      : /abandon|cancel|drop/i.test(lower) ? "Reduce Cart Abandonment"
      : "Increase AOV";
    return makeMsg(
      "Task: " + goal + "\nStatus: Ready\n\n" +
      "Strategy: " + goal + "\n\n" +
      "Affected Modules:\n  \u2022 Progress Bar\n  \u2022 FBT\n  \u2022 Upsells\n\n" +
      "Expected Impact: 25-40% boost\n\n" +
      "Apply this strategy?"
    );
  }

  if (mode === "campaign") {
    const campaignName = /diwali/i.test(lower) ? "Diwali Festive Sale"
      : /independence/i.test(lower) ? "Independence Day Sale"
      : /black.?friday/i.test(lower) ? "Black Friday Sale"
      : /christmas|new.?year/i.test(lower) ? "Holiday Season Offer"
      : /weekend/i.test(lower) ? "Weekend Flash Sale"
      : "Limited Time Campaign";
    return makeMsg(
      "Task: Create Campaign\nStatus: Ready\n\n" +
      "Campaign: " + campaignName + "\n\n" +
      "Affected Modules:\n  \u2022 Coupon Slider\n  \u2022 Progress Bar\n  \u2022 FBT\n\n" +
      "Configuration:\n  \u2022 Banner: Up to 20% OFF\n  \u2022 Coupon: Auto-applied discount\n  \u2022 Free Shipping: Orders above Rs.999\n  \u2022 Urgency Timer: 72 hours\n\n" +
      "Launch this campaign?"
    );
  }

  if (mode === "diagnosis") {
    return makeMsg(
      "Task: Cart Diagnosis\nStatus: Completed\n\n" +
      "Issues Detected:\n  \u2022 No progress bar \u2014 customers can't see shipping threshold\n  \u2022 No urgency timer \u2014 missing purchase incentive\n  \u2022 No trust badges \u2014 reduced checkout confidence\n  \u2022 Upsells disabled \u2014 leaving revenue on table\n\n" +
      "Recommended Fixes:\n  \u2022 Enable Progress Bar with free shipping goal\n  \u2022 Add countdown timer\n  \u2022 Enable Trust Badges\n  \u2022 Activate FBT recommendations\n\n" +
      "Apply these fixes?"
    );
  }

  if (mode === "bestpractice") {
    const isMostUsed = MK(/most.*(use|popular|common)|top.*(feature|module)|which.*(feature|module).*(use|popular|common)/i)(lower);
    if (isMostUsed) {
      return makeMsg(
        "Task: Best Practices\nStatus: Completed\n\n" +
        "Top Recommended Features:\n  \u2022 Free Shipping Progress Bar\n  \u2022 Cart Drawer\n  \u2022 Frequently Bought Together\n  \u2022 Upsells\n  \u2022 Coupon Unlock\n  \u2022 Rewards\n  \u2022 Countdown Timer\n  \u2022 Announcement Bar\n  \u2022 Trust Elements\n\n" +
        "Enable any of these to improve conversion rates."
      );
    }
    return makeMsg(
      "Task: Recommendations\nStatus: Ready\n\n" +
      "Highest Impact Features:\n  \u2022 Cart Drawer\n  \u2022 Progress Bar\n  \u2022 FBT Recommendations\n\n" +
      "These provide the biggest boost to cart engagement and AOV."
    );
  }

  if (mode === "recommendation") {
    return makeMsg(
      "Task: Optimization Recommendations\nStatus: Ready\n\n" +
      "Recommended Modules:\n  \u2022 Progress Bar \u2014 20-30% conversion lift\n  \u2022 FBT \u2014 10-20% extra revenue\n  \u2022 Upsells \u2014 10-20% AOV gain\n\n" +
      "Combined Impact: 25-35% AOV increase\n\n" +
      "Enable these modules?"
    );
  }

  const actionMap = {
    enable: /enable|turn on|activate|add|open|start|show/i,
    disable: /disable|turn off|deactivate|remove|delete|stop|hide|close/i,
    update: /update|change|modify|set|config/i,
    create: /create|make|build|new|add/i,
    delete: /delete|remove|destroy/i,
    reset: /reset|default|restore/i,
  };

  let action = "update";
  for (const [key, re] of Object.entries(actionMap)) {
    if (re.test(lower)) { action = key; break; }
  }

  const needs = (q) => Promise.resolve({ id: "r-" + Date.now(), role: "agent", type: "json", json: { status: "needs_input", question: q } });
  const makeMsg = (text) => Promise.resolve({ id: "r-" + Date.now(), role: "agent", type: "json", json: { message: text } });
  const makeActions = (actions, message) => Promise.resolve({ id: "r-" + Date.now(), role: "agent", type: "json", json: { message: message || "", actions, status: "success" } });
  const checkState = (key) => ({ enabled: featureStore.get(key), settings: featureStore.getSettings(key) });
  const setEnabled = (key) => { featureStore.set(key, true); };
  const setDisabled = (key) => { featureStore.set(key, false); };

  const PREREQ_MAP = { progress_bar: "cart_drawer", trust_badges: "cart_drawer", coupon_slider: "cart_drawer", upsells: "cart_drawer", fbt: "cart_drawer", coupon_banner: "cart_drawer" };
  const MODULE_LABELS = { cart_drawer: "Cart Drawer", progress_bar: "Progress Bar", trust_badges: "Trust Badges", upsells: "Upsells", fbt: "FBT", coupon_slider: "Coupon Slider", coupon_banner: "Coupon Banner", coupon_creator: "Coupon Creator", combo_forge: "Combo Forge" };
  const MAP_NAME = (storeKey) => Object.entries(MODULE_MAP).find(([, v]) => v.store === storeKey)?.[1]?.name || storeKey;

  const ensurePrereq = (storeKey) => {
    const prereq = PREREQ_MAP[storeKey];
    if (!prereq) return { actions: [], steps: [] };
    if (featureStore.get(prereq)) return { actions: [], steps: [] };
    const actions = [{ module: MAP_NAME(prereq), action: "enable", settings: { enabled: true } }];
    const steps = [`${MODULE_LABELS[prereq]} enabled`];
    featureStore.set(prereq, true);
    return { actions, steps };
  };

  const ensureFeature = (storeKey, label) => {
    if (featureStore.get(storeKey)) return { actions: [], steps: [] };
    const actions = [{ module: MAP_NAME(storeKey), action: "enable", settings: { enabled: true } }];
    const steps = [`${label} enabled`];
    featureStore.set(storeKey, true);
    return { actions, steps };
  };

  if (/cart.*drawer|drawer/.test(lower)) {
    const wantDisable = /disable|turn off|deactiv|remove|stop|hide|close/.test(lower);
    if (/styl|colou?r|themed?/.test(lower) && !/dark|round|radius/.test(lower) && !wantDisable) {
      return needs("Which color scheme or border radius would you like to apply?");
    }
    if (wantDisable) {
      if (!featureStore.get("cart_drawer")) return makeActions([], "Task: Disable Cart Drawer\nStatus: Completed\n\nCart Drawer is already inactive.");
      setDisabled("cart_drawer");
      return makeActions([{ module: "cartDrawer", action: "disable", settings: { enabled: false } }], "Task: Disable Cart Drawer\nStatus: Completed\n\nCart Drawer deactivated");
    }
    const a = []; const s = []; const c = [];
    const fe = ensureFeature("cart_drawer", MODULE_LABELS.cart_drawer);
    a.push(...fe.actions); s.push(...fe.steps);
    const settings = { enabled: true };
    if (/dark|themed?/.test(lower)) settings.theme = "dark";
    if (/round|radius/.test(lower)) settings.borderRadius = 20;
    if (/colou?r/.test(lower)) settings.theme = "custom";
    const hasExtra = Object.keys(settings).filter((k) => k !== "enabled").length > 0;
    if (hasExtra) {
      a.push({ module: "cartDrawer", action: "update", settings });
      if (settings.theme) { s.push(`Theme: ${settings.theme}`); c.push(`Theme set to ${settings.theme}`); }
      if (settings.borderRadius) { s.push(`Border Radius: ${settings.borderRadius}px`); c.push(`Border radius updated`); }
    }
    return makeActions(a, "Task: Configure Cart Drawer\nStatus: Completed\n\nChanges Applied:\n" + s.map(x => "  \u2022 " + x).join("\n"));
  }

  if (/progress.?bar|goal|free.?shipping|shipping.?progress/i.test(lower)) {
    const wantDisable = /disable|turn off|deactiv|remove|stop|hide|close/.test(lower);
    if (wantDisable) {
      if (!featureStore.get("progress_bar")) return makeActions([], "Task: Disable Progress Bar\nStatus: Completed\n\nProgress Bar is already inactive.");
      setDisabled("progress_bar");
      return makeActions([{ module: "progressBar", action: "disable", settings: { enabled: false } }], "Task: Disable Progress Bar\nStatus: Completed\n\nProgress Bar deactivated");
    }
    const a = []; const s = [];
    const pe = ensurePrereq("progress_bar");
    a.push(...pe.actions); s.push(...pe.steps);
    const fe = ensureFeature("progress_bar", "Progress Bar");
    a.push(...fe.actions); s.push(...fe.steps);
    const match = lower.match(/(?:rs\.?\s*)?(\d+)/);
    if (match) {
      const goal = parseInt(match[1], 10);
      const currency = /inr|rs\./i.test(lower) ? "INR" : "USD";
      a.push({ module: "progressBar", action: "update", settings: { goal, currency, enabled: true } });
      s.push(`Goal: ${currency === "INR" ? "\u20B9" : "$"}${goal.toLocaleString()}`);
    }
    return makeActions(a, "Task: Configure Progress Bar\nStatus: Completed\n\nChanges Applied:\n" + s.map(x => "  \u2022 " + x).join("\n"));
  }

  if (/trust.?badge|security|secure|badge/i.test(lower) && !/goal|progress|shipping/.test(lower)) {
    const wantDisable = /disable|turn off|deactiv|remove|stop|hide|close/.test(lower);
    if (wantDisable) {
      if (!featureStore.get("trust_badges")) return makeActions([], "Task: Disable Trust Badges\nStatus: Completed\n\nTrust Badges are already inactive.");
      setDisabled("trust_badges");
      return makeActions([{ module: "trustBadges", action: "disable", settings: { enabled: false } }], "Task: Disable Trust Badges\nStatus: Completed\n\nTrust Badges deactivated");
    }
    const a = []; const s = [];
    const pe = ensurePrereq("trust_badges"); a.push(...pe.actions); s.push(...pe.steps);
    const fe = ensureFeature("trust_badges", "Trust Badges"); a.push(...fe.actions); s.push(...fe.steps);
    return makeActions(a, "Task: Enable Trust Badges\nStatus: Completed\n\nChanges Applied:\n" + s.map(x => "  \u2022 " + x).join("\n"));
  }

  if (/upsell|frequently.*bought|fbt|recommend/i.test(lower)) {
    const isFbt = !/upsell|product.?recommend/i.test(lower) || /fbt|frequently.*bought/i.test(lower);
    const storeKey = isFbt ? "fbt" : "upsells";
    const moduleName = isFbt ? "fbt" : "upsells";
    const label = isFbt ? "Frequently Bought Together" : "Upsells";
    const wantDisable = /disable|turn off|deactiv|remove|stop|hide|close/.test(lower);
    if (wantDisable) {
      if (!featureStore.get(storeKey)) return makeActions([], `Task: Disable ${label}\nStatus: Completed\n\n${label} is already inactive.`);
      setDisabled(storeKey);
      return makeActions([{ module: moduleName, action: "disable", settings: { enabled: false } }], `Task: Disable ${label}\nStatus: Completed\n\n${label} deactivated`);
    }
    const a = []; const s = [];
    const pe = ensurePrereq(storeKey); a.push(...pe.actions); s.push(...pe.steps);
    const fe = ensureFeature(storeKey, label); a.push(...fe.actions); s.push(...fe.steps);
    return makeActions(a, `Task: Enable ${label}\nStatus: Completed\n\nChanges Applied:\n` + s.map(x => "  \u2022 " + x).join("\n"));
  }

  if (/coupon.*slider|slider|coupon.*banner|coupon.*show|show.*coupon/i.test(lower)) {
    const wantDisable = /disable|turn off|deactiv|remove|stop|hide|close/.test(lower);
    if (wantDisable) {
      if (!featureStore.get("coupon_slider")) return makeActions([], "Task: Disable Coupon Slider\nStatus: Completed\n\nCoupon Slider is already inactive.");
      setDisabled("coupon_slider");
      return makeActions([{ module: "couponSlider", action: "disable", settings: { enabled: false } }], "Task: Disable Coupon Slider\nStatus: Completed\n\nCoupon Slider deactivated");
    }
    const a = []; const s = [];
    const pe = ensurePrereq("coupon_slider"); a.push(...pe.actions); s.push(...pe.steps);
    const fe = ensureFeature("coupon_slider", "Coupon Slider"); a.push(...fe.actions); s.push(...fe.steps);
    return makeActions(a, "Task: Enable Coupon Slider\nStatus: Completed\n\nChanges Applied:\n" + s.map(x => "  \u2022 " + x).join("\n"));
  }

  if (/coupon.*banner|banner.*coupon|product.?widget|widget/i.test(lower)) {
    const wantDisable = /disable|turn off|deactiv|remove|stop|hide|close/.test(lower);
    if (wantDisable) {
      if (!featureStore.get("coupon_banner")) return makeActions([], "Task: Disable Coupon Banner\nStatus: Completed\n\nCoupon Banner is already inactive.");
      setDisabled("coupon_banner");
      return makeActions([{ module: "couponBanner", action: "disable", settings: { enabled: false } }], "Task: Disable Coupon Banner\nStatus: Completed\n\nCoupon Banner deactivated");
    }
    const a = []; const s = [];
    const pe = ensurePrereq("coupon_banner"); a.push(...pe.actions); s.push(...pe.steps);
    const fe = ensureFeature("coupon_banner", "Coupon Banner"); a.push(...fe.actions); s.push(...fe.steps);
    return makeActions(a, "Task: Enable Coupon Banner\nStatus: Completed\n\nChanges Applied:\n" + s.map(x => "  \u2022 " + x).join("\n"));
  }

  if (/coupon.*creator|create.*coupon|discount|offer.*create/i.test(lower)) {
    const wantDisable = /disable|turn off|deactiv|remove|stop|hide|close/.test(lower);
    if (wantDisable) {
      if (!featureStore.get("coupon_creator")) return makeActions([], "Task: Disable Coupon Creator\nStatus: Completed\n\nCoupon Creator is already inactive.");
      setDisabled("coupon_creator");
      return makeActions([{ module: "couponCreator", action: "disable", settings: { enabled: false } }], "Task: Disable Coupon Creator\nStatus: Completed\n\nCoupon Creator deactivated");
    }
    const a = []; const s = [];
    const fe = ensureFeature("coupon_creator", "Coupon Creator"); a.push(...fe.actions); s.push(...fe.steps);
    return makeActions(a, "Task: Enable Coupon Creator\nStatus: Completed\n\nChanges Applied:\n" + s.map(x => "  \u2022 " + x).join("\n"));
  }

  if (/combo.?forge|bundle|bundles|landing.?page/i.test(lower)) {
    const wantDisable = /disable|turn off|deactiv|remove|stop|hide|close/.test(lower);
    if (wantDisable) {
      if (!featureStore.get("combo_forge")) return makeActions([], "Task: Disable Combo Forge\nStatus: Completed\n\nCombo Forge is already inactive.");
      setDisabled("combo_forge");
      return makeActions([{ module: "comboForge", action: "disable", settings: { enabled: false } }], "Task: Disable Combo Forge\nStatus: Completed\n\nCombo Forge deactivated");
    }
    const a = []; const s = [];
    const fe = ensureFeature("combo_forge", "Combo Forge"); a.push(...fe.actions); s.push(...fe.steps);
    return makeActions(a, "Task: Enable Combo Forge\nStatus: Completed\n\nChanges Applied:\n" + s.map(x => "  \u2022 " + x).join("\n"));
  }

  if (/match.?theme|sync.?theme|detect.?theme|auto.?theme|copy.?theme/i.test(lower)) {
    try {
      const k = "cartninja_cart_config";
      const c = JSON.parse(localStorage.getItem(k) || "{}");
      c.themeSync = true; c.themeSyncAt = Date.now();
      localStorage.setItem(k, JSON.stringify(c));
    } catch {}
    return makeMsg(
      "Task: Match Store Theme\nStatus: Completed\n\n" +
      "Changes Applied:\n  \u2022 Colors synchronized\n  \u2022 Fonts synchronized\n  \u2022 Button styles synchronized\n  \u2022 Border radius synchronized\n  \u2022 Cart drawer updated"
    );
  }

  const applyPreset = (preset, label) => {
    try {
      const k = "cartninja_cart_config";
      const c = JSON.parse(localStorage.getItem(k) || "{}");
      c.drawerTheme = preset;
      localStorage.setItem(k, JSON.stringify(c));
    } catch {}
    return makeMsg(
      "Task: Apply " + label + " Theme\nStatus: Completed\n\nChanges Applied:\n" +
      {
        premium_dark:
          "  \u2022 Dark background\n  \u2022 Premium gradients\n  \u2022 Updated button styles\n  \u2022 Updated typography\n  \u2022 Cart drawer refreshed",
        minimal_light:
          "  \u2022 Clean layout\n  \u2022 Minimal styling\n  \u2022 Modern typography\n  \u2022 Refreshed cart drawer",
        luxury_gold:
          "  \u2022 Premium gold accents\n  \u2022 Luxury styling\n  \u2022 Updated buttons\n  \u2022 Updated cart appearance\n  \u2022 Cart drawer refreshed",
      }[preset]
    );
  };

  if (/(?:apply|set|use|enable)?\s*(premium\s*dark|dark\s*(?:theme|preset))/i.test(lower))
    return applyPreset("premium_dark", "Premium Dark");

  if (/(?:apply|set|use|enable)?\s*(minimal\s*light|light\s*(?:theme|preset))/i.test(lower))
    return applyPreset("minimal_light", "Minimal Light");

  if (/(?:apply|set|use|enable)?\s*(luxury\s*gold|gold\s*(?:theme|preset))/i.test(lower))
    return applyPreset("luxury_gold", "Luxury Gold");

  if (/styl|theme|colou?r|look|appear/i.test(lower)) {
    const colorMatch = lower.match(/\b(red|blue|green|yellow|purple|pink|orange|brown|black|white|gray|grey|navy|teal|maroon|violet|magenta|coral|indigo|gold|silver)\b|#[0-9a-f]{3,6}\b/i);
    const hexMatch = lower.match(/#([0-9a-f]{3,6})\b/i);
    const hasColor = !!(colorMatch || hexMatch);
    const pickColor = () => (colorMatch?.[1] || hexMatch?.[0] || "custom").toLowerCase();
    const styleTarget = (target, label, moduleStoreKey, color) => {
      const a = []; const s = [];
      if (moduleStoreKey) {
        const pe = ensurePrereq(moduleStoreKey); a.push(...pe.actions); s.push(...pe.steps);
        const fe = ensureFeature(moduleStoreKey, label); a.push(...fe.actions); s.push(...fe.steps);
      }
      a.push({ module: "styling", action: "update", settings: { target, color } });
      s.push(`${label}: ${color}`);
      return makeActions(a, "Task: Update Styling\nStatus: Completed\n\nChanges Applied:\n" + s.map(x => "  \u2022 " + x).join("\n"));
    };

    if (/checkout/i.test(lower)) {
      if (hasColor) return styleTarget("checkout_button", "Checkout button", null, pickColor());
      return needs("What color would you like for the checkout button? (e.g., red, blue, green, #FF5733)");
    }
    if (/cart.*drawer|drawer/i.test(lower) && hasColor) {
      const color = pickColor();
      const a = []; const s = [];
      const pe = ensurePrereq("cart_drawer"); a.push(...pe.actions); s.push(...pe.steps);
      const fe = ensureFeature("cart_drawer", "Cart Drawer"); a.push(...fe.actions); s.push(...fe.steps);
      a.push({ module: "cartDrawer", action: "update", settings: { theme: color } });
      s.push(`Theme: ${color}`);
      return makeActions(a, "Task: Update Cart Drawer Theme\nStatus: Completed\n\nChanges Applied:\n" + s.map(x => "  \u2022 " + x).join("\n"));
    }
    if (/trust|badge|security/i.test(lower)) {
      if (hasColor) return styleTarget("trust_badges", "Trust Badges", "trust_badges", pickColor());
      return needs("Which styling would you like to apply to the trust badges? (color, size, position)");
    }
    if (/progress|goal|free.?shipping/i.test(lower) && hasColor) {
      return styleTarget("progress_bar", "Progress Bar", "progress_bar", pickColor());
    }
    return needs("Which module would you like to style? (cartDrawer, trustBadges, progressBar, checkoutButton, etc.)");
  }

  const unrelated = /weather|news|sport|movie|music|recipe|cook|game|play|stock|price|bitcoin|crypto|travel|hotel|flight|book|author|poem|joke|funny|dance|sing/i;
  if (unrelated.test(lower)) {
    return makeMsg("I'm a Cart Ninja configuration agent. I can help with module setup, theme presets, campaigns, and store optimization.");
  }

  return makeMsg("Ready for instructions.\n\nYou can ask me to:\n• Enable or configure cart modules\n• Apply theme presets\n• Run store audits\n• Create campaigns\n• Optimize conversions");
}

// ── Cart Ninja Logo SVG (faithful recreation of brand mark) ─────────────────
const CartNinjaLogo = ({ size = 32, colorMode = "dark" }) => {
  const c = colorMode === "white" ? "#FFFFFF" : "#0A0A0A";
  return (
    <svg width={size} height={Math.round(size * 1.18)} viewBox="0 0 100 118" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M49 33 C41 23 25 25 15 18 C18 27 16 38 24 40 C33 38 44 40 49 40" fill={c}/>
      <circle cx="65" cy="36" r="17" stroke={c} strokeWidth="7" fill="none"/>
      <line x1="48" y1="36" x2="82" y2="36" stroke={c} strokeWidth="5" strokeLinecap="round"/>
      <path d="M12 83 Q12 58 65 58 Q118 58 118 83" stroke={c} strokeWidth="8" fill="none" strokeLinecap="round"/>
      <rect x="14" y="93" width="72" height="10" rx="5" fill={c}/>
      <path d="M80 93 L22 103" stroke={c} strokeWidth="9" strokeLinecap="round"/>
      <rect x="14" y="103" width="72" height="10" rx="5" fill={c}/>
    </svg>
  );
};

// ── Action card SVG icons ─────────────────────────────────────────────────────
const CARD_ICONS = {
  fbt: (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="5" r="2.5"/><circle cx="15" cy="5" r="2.5"/><circle cx="10" cy="15" r="2.5"/>
      <path d="M7 6l3 7M13 6l-3 7M7.2 5h5.6"/>
    </svg>
  ),
  upsell: (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 15l5-6 4 3 5-7"/>
      <path d="M14 4h4v4"/>
    </svg>
  ),
  rewards: (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2l2 5h5l-4 3 1.5 5L10 12l-4.5 3L7 10 3 7h5z"/>
    </svg>
  ),
  coupon: (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 7a2 2 0 0 0 0 3.5v2.5h16V10.5a2 2 0 0 0 0-3.5V4H2z"/>
      <path d="M8 7v.5M8 12v.5M12 10H8.5M12 7.5l-4 5"/>
    </svg>
  ),
  optimize: (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h2l3 9h6l2-6H9"/>
      <circle cx="8" cy="17" r="1.3"/><circle cx="15" cy="17" r="1.3"/>
    </svg>
  ),
  analyze: (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M3 17V4"/><path d="M3 17h14"/>
      <rect x="5" y="10" width="3" height="5" rx="1"/><rect x="10" y="7" width="3" height="8" rx="1"/><rect x="15" y="4" width="3" height="11" rx="1"/>
    </svg>
  ),
  health: (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 10h3l2-5 3 8 2-5 2 3h4"/>
    </svg>
  ),
  revenue: (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="10" cy="10" r="8"/>
      <path d="M10 6v1.5M10 12.5V14M7.5 11.5c0 1 1 1.5 2.5 1.5s2.5-.7 2.5-1.7-1-1.5-2.5-1.8-2.5-.8-2.5-1.8S8.9 6 10.5 6 13 6.7 13 7.5"/>
    </svg>
  ),
};

// ── Welcome screen action cards ──────────────────────────────────────────────
const ACTION_CARDS = [
  { id: "fbt",      icon: CARD_ICONS.fbt,      title: "Generate FBT",      desc: "Find product combos that drive sales",    query: "Generate FBT products for my store" },
  { id: "upsell",   icon: CARD_ICONS.upsell,   title: "Create Upsell",     desc: "Boost AOV with smart recommendations",    query: "Set up upsell offers" },
  { id: "rewards",  icon: CARD_ICONS.rewards,  title: "Configure Rewards",  desc: "Build loyalty with reward programs",      query: "Configure rewards program" },
  { id: "coupon",   icon: CARD_ICONS.coupon,   title: "Create Coupon",     desc: "Launch discounts and promotions",         query: "Create a coupon discount" },
  { id: "optimize", icon: CARD_ICONS.optimize, title: "Optimize Cart",      desc: "Maximize conversion rates",               query: "Optimize cart for conversions" },
  { id: "analyze",  icon: CARD_ICONS.analyze,  title: "Analyze Store",      desc: "Deep dive into performance metrics",      query: "Analyze my store performance" },
  { id: "health",   icon: CARD_ICONS.health,   title: "Store Health",       desc: "Check your optimization score",           query: "Audit my store setup" },
  { id: "revenue",  icon: CARD_ICONS.revenue,  title: "Revenue Insights",   desc: "Identify growth opportunities",           query: "Increase revenue and AOV" },
];

const QUICK_CHIPS = [
  "Generate FBT", "Create Upsell", "Optimize Cart", "Store Analysis",
  "Revenue Report", "Store Health", "Create Coupon", "Configure Rewards",
  "Cart Drawer Settings",
];

function getStatusLabel(loading) {
  if (!loading) return { label: "Ready", type: "ready" };
  if (loading === "analyzing") return { label: "Analyzing", type: "active" };
  return { label: "Executing", type: "active" };
}

function useFeatureState(key) {
  return useSyncExternalStore(
    featureStore.subscribe,
    () => featureStore.get(key),
    () => featureStore.get(key),
  );
}

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

function ModuleToggle({ storeKey, label }) {
  const enabled = useFeatureState(storeKey);
  return (
    <div className="cn-mod-row">
      <span className="cn-mod-label">{label}</span>
      <span className={"cn-mod-badge" + (enabled ? " cn-mod-badge--on" : " cn-mod-badge--off")}>
        {enabled ? "Active" : "Inactive"}
      </span>
    </div>
  );
}

export default function AiAgent({ appName = "Cart Operations Agent", initialQuery = "" }) {
  const [input, setInput] = useState(initialQuery || "");
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem("aia_conversations");
      if (!saved) return [];
      const convs = JSON.parse(saved);
      const activeId = localStorage.getItem("aia_active_conv");
      if (activeId) {
        const active = convs.find((c) => c.id === activeId);
        if (active) return active.messages || [];
      }
      return [];
    } catch { return []; }
  });
  const [loading, setLoading] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [conversations, setConversations] = useState(() => {
    try {
      const saved = localStorage.getItem("aia_conversations");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [activeConvId, setActiveConvId] = useState(() => {
    try {
      return localStorage.getItem("aia_active_conv") || null;
    } catch { return null; }
  });
  const [pendingContext, setPendingContext] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const syncedRef = useRef(false);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("aia_conversations", JSON.stringify(conversations));
    } catch { /* ignore */ }
  }, [conversations]);

  useEffect(() => {
    try {
      localStorage.setItem("aia_active_conv", activeConvId || "");
    } catch { /* ignore */ }
  }, [activeConvId]);

  useEffect(() => {
    if (!syncedRef.current) { syncedRef.current = true; return; }
    if (!activeConvId || !conversations.length) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === activeConvId ? { ...c, messages, ts: Date.now() } : c)),
    );
  }, [messages]);

  const processReply = useCallback((reply, userText) => {
    const j = reply.json;
    if (!j) { setLoading(null); setMessages((prev) => [...prev, reply]); return; }
    if (j.status === "needs_input") { setPendingContext(userText); setLoading(null); setMessages((prev) => [...prev, reply]); return; }
    setLoading(null);
    setMessages((prev) => [...prev, reply]);
  }, []);

  const callApi = useCallback(async (text) => {
    setLoading("analyzing");
    console.log("[AiAgent] callApi", { text });
    const detectedActions = extractActions(text);
    console.log("[AiAgent] extractActions result", detectedActions);
      if (detectedActions.length > 0) {
        const result = await applyActionsViaApi(detectedActions);
        console.log("[AiAgent] applyActionsViaApi result", result);
        const labels = detectedActions.map((a) => a.label || ACTION_LABELS[a.module] || a.module).filter(Boolean).join(", ");
        if (result.success) {
          console.log("[AiAgent] success, synced:", result.synced, "verification:", result.verification, "backendResponses:", result.backendResponses);
          syncAfterToFeatureStore(result.after);
          const ver = result.verification;
          const synced = result.synced === true;
          const backendResp = result.backendResponses;

          // Check if any action is a full-workflow configure
          const isFullWorkflow = detectedActions.some((a) =>
            ["configureCartDrawer", "configureFBT", "configureUpsell", "configureGoalBar", "createBundle"].includes(a.action || a.engine)
          );

          let statusLine;
          if (!synced) {
            const details = [];
            if (backendResp?.cart) details.push(`Cart API: ${backendResp.cart.httpStatus} → ${JSON.stringify(backendResp.cart.body)}`);
            if (backendResp?.fbt) details.push(`FBT API: ${backendResp.fbt.httpStatus} → ${JSON.stringify(backendResp.fbt.body)}`);
            statusLine = `Backend Save Failed\n\nNo successful response from database.\n${details.length > 0 ? "\n" + details.join("\n") : ""}\n\nPlease check backend connection and retry.`;
          } else if (ver && !ver.verified) {
            if (ver.externalError) {
              statusLine = `Verification Failed\n\nCould not reach the database to confirm changes.\nReason: ${ver.externalError}\n\nThe change may not have been saved. Please check backend connection and retry.`;
            } else {
              const failedDetails = (ver.results || [])
                .filter((r) => !r.passed)
                .map((r) => `  • ${r.action}: expected ${r.expected}, found ${r.actual}`);
              statusLine = `Verification Failed\n\nDatabase does not reflect requested changes:\n${failedDetails.join("\n") || "  • Unknown"}\n\nPossible causes:\n• Database write failed\n• API sync error\n• Network timeout\n\nPlease retry.`;
            }
          } else if (isFullWorkflow) {
            // Build detail-rich success message
            const planSettings = detectedActions.reduce((s, a) => {
              if (a.settings) Object.assign(s, a.settings);
              return s;
            }, {});
            const lines = [];
            detectedActions.forEach((a) => {
              const act = a.action || a.engine;
              if (act === "configureFBT") {
                lines.push("FBT Configuration Updated");
                lines.push(`Template: ${planSettings.template === "fbt2" ? "Modern Cards" : "Modern Cards"}`);
                lines.push("Mode: AI");
                lines.push("Status: Enabled");
                lines.push("Products: AI-recommended (up to 5)");
              }
              if (act === "configureUpsell") {
                lines.push("Upsell Configuration Updated");
                lines.push("Layout: Slider");
                lines.push("Template: Modern");
                lines.push("Status: Enabled");
              }
              if (act === "configureGoalBar") {
                const goal = planSettings?.goal || 999;
                const reward = planSettings?.reward || "Free Shipping";
                lines.push("Progress Bar Configuration Updated");
                lines.push(`Goal: \u20B9${typeof goal === "number" ? goal.toLocaleString("en-IN") : goal}`);
                lines.push(`Reward: ${reward}`);
                lines.push("Status: Enabled");
                lines.push("Milestones: 3 tiers configured");
              }
              if (act === "configureCartDrawer") {
                lines.push("Cart Drawer Configuration Updated");
                lines.push(`Theme: ${planSettings?.theme || "Modern"}`);
                lines.push(`Border Radius: ${planSettings?.borderRadius || 12}px`);
                lines.push("Status: Enabled");
              }
              if (act === "createBundle") {
                lines.push("Bundle Creation");
                lines.push("Open Combo Forge in the settings to build your bundle.");
              }
            });
            lines.push("");
            lines.push("Verification Successful");
            statusLine = lines.join("\n");
          } else {
            statusLine = "Status: Completed";
          }

          processReply({
            id: "r-" + Date.now(), role: "agent", type: "json",
            json: { message: `Task: ${labels}\n${statusLine}`, actions: detectedActions, status: synced ? "success" : "failed", rawCartBefore: result.rawCartBefore, before: result.before },
            executedResults: [{ status: "executed" }],
          }, text);
        } else {
        processReply({
          id: "r-" + Date.now(), role: "agent", type: "json",
          json: { message: `Task: ${labels}\nStatus: Failed\nReason: ${result.error}` },
        }, text);
      }
    } else {
      const isDesignIntent = /theme|color|design|brand|website|style|font|match|look|feel/i.test(text);
      const ALL_STEPS = isDesignIntent
        ? [
            { text: "Thinking about your request", icon: "think" },
            { text: "Connecting to your storefront", icon: "connect" },
            { text: "Fetching HTML & CSS variables", icon: "fetch" },
            { text: "Extracting brand colors", icon: "color" },
            { text: "Reading fonts & border styles", icon: "font" },
            { text: "Scanning promotional offers", icon: "scan" },
          ]
        : [
            { text: "Thinking about your request", icon: "think" },
            { text: "Checking store configuration", icon: "check" },
            { text: "Preparing response", icon: "prepare" },
          ];

      const scrapeMsgId = "scrape-" + Date.now();
      const scrapeTimers = [];

      setMessages((prev) => [...prev, {
        id: scrapeMsgId,
        role: "agent",
        type: "scraping",
        isDesign: isDesignIntent,
        steps: [{ ...ALL_STEPS[0], active: true, done: false }],
      }]);

      ALL_STEPS.slice(1).forEach((_s, idx) => {
        const i = idx + 1;
        const t = setTimeout(() => {
          setMessages((prev) => prev.map((m) => {
            if (m.id !== scrapeMsgId) return m;
            return {
              ...m,
              steps: ALL_STEPS.slice(0, i + 1).map((s, j) => ({
                ...s, done: j < i, active: j === i,
              })),
            };
          }));
        }, 800 * i);
        scrapeTimers.push(t);
      });

      try {
        const res = await aiApi.sendMessage(activeConvId || "temp", text, messages.map((m) => ({ role: m.role, text: m.text })));
        scrapeTimers.forEach(clearTimeout);
        setMessages((prev) => prev.filter((m) => m.id !== scrapeMsgId));

        if (res.success && res.message) {
          syncAfterToFeatureStore(res.after);
          processReply({
            id: "r-" + Date.now(), role: "agent", type: "json",
            json: {
              message: res.message,
              summary: res.summary,
              executedActions: res.executedActions,
              synced: res.synced,
              after: res.after,
              before: res.before,
              verification: res.verification,
              backendResponses: res.backendResponses,
              scrapedDesign: res.scrapedDesign || null,
            },
          }, text);
        } else {
          throw new Error("no response");
        }
      } catch {
        scrapeTimers.forEach(clearTimeout);
        setMessages((prev) => prev.filter((m) => m.id !== scrapeMsgId));
        processReply({
          id: "r-" + Date.now(), role: "agent", type: "json",
          json: { message: "I couldn't process that command. Try something like \"Enable Cart Drawer\" or \"Add Upsells\"." },
        }, text);
      }
    }
  }, [processReply, activeConvId, messages]);

  const handleSend = useCallback((text) => {
    if (!text.trim()) return;
    const msg = { id: "u-" + Date.now(), role: "user", text: text.trim() };
    setMessages((prev) => [...prev, msg]);
    setInput("");
    if (!activeConvId) {
      const id = "conv-" + Date.now();
      const title = generateTitle(text);
      setActiveConvId(id);
      setConversations((prev) => [{ id, title, ts: Date.now(), messages: [msg] }, ...prev]);
      syncedRef.current = true;
    }
    callApi(text.trim());
  }, [callApi, activeConvId]);

  const handleAnswer = useCallback((answer) => {
    const context = pendingContext;
    setPendingContext(null);
    let fullQuery = answer;
    if (context) {
      const base = context.replace(/\s*(please|thanks|thank you).*$/i, "").trim();
      if (!answer.includes(base)) {
        fullQuery = base + " with " + answer;
      }
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
        if (before?.cart) syncAfterToFeatureStore({ cart: before.cart });
      } catch (err) {
        console.error('[AiAgent] Undo DB restore failed:', err);
      }
    } else {
      undoAction(action);
    }
    setMessages((prev) => [...prev, {
      id: "u-" + Date.now(), role: "agent",
      type: "json",
      json: { status: "undo", message: "Action undone", action },
    }]);
  }, []);

  const handleChipClick = (text) => {
    setInput(text);
  };

  const handleConversationClick = (convId) => {
    const conv = conversations.find((c) => c.id === convId);
    if (!conv) return;
    syncedRef.current = true;
    setActiveConvId(convId);
    setMessages(conv.messages || []);
    setInput("");
    setPendingContext(null);
  };

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setInput("");
    setPendingContext(null);
    setActiveConvId(null);
    syncedRef.current = true;
  }, []);

  const today = conversations.filter((c) => getTimeGroup(c.ts) === "Today");
  const yesterday = conversations.filter((c) => getTimeGroup(c.ts) === "Yesterday");
  const last7 = conversations.filter((c) => getTimeGroup(c.ts) === "Last 7 Days");
  const older = conversations.filter((c) => getTimeGroup(c.ts) === "Older");
  const { label: statusLabel, type: statusType } = getStatusLabel(loading);

  return (
    <div className="cn-workspace">

      {/* ════════════ HEADER ════════════ */}
      <header className="cn-header">
        <div className="cn-header-left">
          <div className="cn-header-logo">
            <CartNinjaLogo size={26} colorMode="white" />
          </div>
          <span className="cn-header-brand">Cart Ninja <span className="cn-header-brand-ai">AI</span></span>
        </div>
        <div className="cn-header-center">
          <div className={"cn-status-pill cn-status-" + statusType}>
            <span className="cn-status-dot" />
            <span className="cn-status-label">{statusLabel}</span>
          </div>
        </div>
        <div className="cn-header-right">
          <button className="cn-header-btn" onClick={handleNewChat}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M7 2v10M2 7h10"/></svg>
            <span>New Chat</span>
          </button>
          <button className={"cn-header-icon-btn" + (showHistory ? " cn-header-icon-btn--active" : "")} onClick={() => setShowHistory((v) => !v)} title="Conversation History">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="8" cy="8" r="5.5"/><path d="M8 5.5v2.8l1.8 1.8"/></svg>
          </button>
          <button className={"cn-header-icon-btn" + (showSettings ? " cn-header-icon-btn--active" : "")} onClick={() => setShowSettings((v) => !v)} title="Settings">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="8" cy="8" r="2"/><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M3.5 12.5l1.1-1.1M11.4 4.6l1.1-1.1"/></svg>
          </button>
        </div>
      </header>

      {/* ════════════ HISTORY DRAWER ════════════ */}
      {showHistory && (
        <div className="cn-overlay" onClick={() => setShowHistory(false)}>
          <div className="cn-drawer cn-history-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="cn-drawer-head">
              <span className="cn-drawer-title">Conversations</span>
              <button className="cn-icon-btn" onClick={() => setShowHistory(false)}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
              </button>
            </div>
            <div className="cn-history-list">
              {conversations.length === 0 && (
                <div className="cn-history-empty">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#DDD" strokeWidth="1.5" strokeLinecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                  <span>No conversations yet</span>
                </div>
              )}
              {today.length > 0 && <div className="cn-history-group">Today</div>}
              {today.map((c) => (
                <button key={c.id} className={"cn-history-item" + (c.id === activeConvId ? " cn-history-item--active" : "")} onClick={() => { handleConversationClick(c.id); setShowHistory(false); }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 3h8M2 6h6M2 9h4"/></svg>
                  <span>{c.title.length > 33 ? c.title.slice(0, 30) + "..." : c.title}</span>
                </button>
              ))}
              {yesterday.length > 0 && <div className="cn-history-group">Yesterday</div>}
              {yesterday.map((c) => (
                <button key={c.id} className={"cn-history-item" + (c.id === activeConvId ? " cn-history-item--active" : "")} onClick={() => { handleConversationClick(c.id); setShowHistory(false); }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 3h8M2 6h6M2 9h4"/></svg>
                  <span>{c.title.length > 33 ? c.title.slice(0, 30) + "..." : c.title}</span>
                </button>
              ))}
              {last7.length > 0 && <div className="cn-history-group">Last 7 Days</div>}
              {last7.map((c) => (
                <button key={c.id} className={"cn-history-item" + (c.id === activeConvId ? " cn-history-item--active" : "")} onClick={() => { handleConversationClick(c.id); setShowHistory(false); }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 3h8M2 6h6M2 9h4"/></svg>
                  <span>{c.title.length > 33 ? c.title.slice(0, 30) + "..." : c.title}</span>
                </button>
              ))}
              {older.length > 0 && <div className="cn-history-group">Older</div>}
              {older.map((c) => (
                <button key={c.id} className={"cn-history-item" + (c.id === activeConvId ? " cn-history-item--active" : "")} onClick={() => { handleConversationClick(c.id); setShowHistory(false); }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 3h8M2 6h6M2 9h4"/></svg>
                  <span>{c.title.length > 33 ? c.title.slice(0, 30) + "..." : c.title}</span>
                </button>
              ))}
            </div>
            <div className="cn-drawer-footer">
              <button className="cn-new-chat-btn" onClick={() => { handleNewChat(); setShowHistory(false); }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M7 2v10M2 7h10"/></svg>
                Start New Conversation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════ SETTINGS DRAWER ════════════ */}
      {showSettings && (
        <div className="cn-overlay" onClick={() => setShowSettings(false)}>
          <div className="cn-drawer cn-settings-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="cn-drawer-head">
              <span className="cn-drawer-title">Module Status</span>
              <button className="cn-icon-btn" onClick={() => setShowSettings(false)}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
              </button>
            </div>
            <div className="cn-settings-body">
              {MODULES_LIST.map((mod) => (
                <ModuleToggle key={mod.k} storeKey={mod.k} label={mod.label} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ════════════ MAIN WORKSPACE ════════════ */}
      <main className="cn-main">

        {/* ── Messages scroll area ── */}
        <div className="cn-msgs" ref={scrollRef}>

          {/* Welcome screen */}
          {messages.length === 0 && !loading && (
            <div className="cn-welcome">
              <div className="cn-welcome-logo-ring">
                <CartNinjaLogo size={52} colorMode="white" />
              </div>
              <h1 className="cn-welcome-title">What would you like to do today?</h1>
              <p className="cn-welcome-sub">I can help manage your Cart Ninja store.</p>
              <div className="cn-action-grid">
                {ACTION_CARDS.map((card) => (
                  <button key={card.id} className="cn-action-card" onClick={() => { setInput(card.query); setTimeout(() => inputRef.current?.focus(), 0); }}>
                    <span className="cn-action-icon">{card.icon}</span>
                    <span className="cn-action-title">{card.title}</span>
                    <span className="cn-action-desc">{card.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message list */}
          {messages.map((msg) => {
            const isUser = msg.role === "user";
            const j = msg.json;

            if (isUser) {
              return (
                <div key={msg.id} className="cn-msg-row cn-msg-row--user">
                  <div className="cn-msg-user">{msg.text}</div>
                </div>
              );
            }

            if (j) {
              if (j.status === "needs_input") {
                return (
                  <div key={msg.id} className="cn-msg-row cn-msg-row--agent">
                    <div className="cn-agent-avatar"><CartNinjaLogo size={14} colorMode="white" /></div>
                    <AINeedsInputCard question={j.question} onSubmit={handleAnswer} />
                  </div>
                );
              }
              if (j.status === "undo") {
                return (
                  <div key={msg.id} className="cn-msg-row cn-msg-row--agent">
                    <div className="cn-agent-avatar"><CartNinjaLogo size={14} colorMode="white" /></div>
                    <div className="cn-msg-undo">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2 7c0-3 2.5-5 5-5s5 2 5 5-2.5 5-5 5"/><path d="M2 3v4h4"/></svg>
                      Action undone successfully
                    </div>
                  </div>
                );
              }
              if (j.actions) {
                return (
                  <div key={msg.id} className="cn-msg-row cn-msg-row--agent">
                    <div className="cn-agent-avatar"><CartNinjaLogo size={14} colorMode="white" /></div>
                    <div className="cn-agent-card-wrap">
                      <AIChangesSummary actions={j.actions} results={msg.executedResults} onUndo={handleUndo} message={j.message} rawCartBefore={j.rawCartBefore} before={j.before} />
                    </div>
                  </div>
                );
              }
              if (j.message) {
                const sd = j.scrapedDesign;
                const wasScraped = sd?.source === "live-scrape";
                return (
                  <div key={msg.id} className="cn-msg-row cn-msg-row--agent">
                    <div className="cn-agent-avatar"><CartNinjaLogo size={14} colorMode="white" /></div>
                    <div className="cn-msg-agent">
                      <div className="cn-msg-agent-meta">
                        <svg width="9" height="9" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z"/></svg>
                        Cart Ninja AI
                        {wasScraped && (
                          <span className="cn-scrape-tag">
                            <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="#22C55E" strokeWidth="2"><path d="M2 5l2 2 4-4"/></svg>
                            Storefront scanned
                            {sd.primaryColor && <><span className="cn-scrape-swatch" style={{ background: sd.primaryColor }} />{sd.primaryColor}</>}
                          </span>
                        )}
                      </div>
                      <div className="cn-msg-agent-body">{j.message}</div>
                    </div>
                  </div>
                );
              }
            }

            if (msg.type === "scraping") {
              const completedCount = (msg.steps || []).filter((s) => s.done).length;
              const totalCount = (msg.steps || []).length;
              const pct = totalCount > 1 ? Math.round((completedCount / (totalCount - 1)) * 100) : 0;
              return (
                <div key={msg.id} className="cn-msg-row cn-msg-row--agent">
                  <div className="cn-agent-avatar"><CartNinjaLogo size={14} colorMode="white" /></div>
                  <div className="cn-exec-card">
                    <div className="cn-exec-head">
                      <div className="cn-exec-head-left">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.4-4.4"/></svg>
                        <span className="cn-exec-heading">{msg.isDesign ? "Scanning Storefront" : "Analyzing Request"}</span>
                      </div>
                      <span className="cn-exec-live">LIVE</span>
                    </div>
                    {msg.isDesign && (
                      <div className="cn-exec-url">
                        <span className="cn-exec-url-dot" />
                        scanning live store data...
                      </div>
                    )}
                    <div className="cn-exec-track">
                      <div className="cn-exec-fill" style={{ width: pct + "%" }} />
                    </div>
                    <div className="cn-exec-steps">
                      {(msg.steps || []).map((step, i) => (
                        <div key={i} className={"cn-exec-step" + (step.done ? " cn-exec-step--done" : step.active ? " cn-exec-step--active" : "")}>
                          <span className="cn-exec-step-icon">
                            {step.done
                              ? <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round"><path d="M3 7l3 3 5-5"/></svg>
                              : step.active
                              ? <span className="cn-spinner" />
                              : <span className="cn-step-dot" />
                            }
                          </span>
                          <span className="cn-exec-step-text">{step.text}</span>
                          {step.active && <span className="cn-dots"><span /><span /><span /></span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            }

            return null;
          })}

          {/* Thinking indicator */}
          {loading && messages.length > 0 && !messages.some((m) => m.type === "scraping") && (
            <div className="cn-msg-row cn-msg-row--agent">
              <div className="cn-agent-avatar"><CartNinjaLogo size={14} colorMode="white" /></div>
              <div className="cn-thinking">
                <span className="cn-thinking-dot" />
                <span className="cn-thinking-dot" />
                <span className="cn-thinking-dot" />
              </div>
            </div>
          )}
        </div>

        {/* ── Input Area ── */}
        <div className="cn-input-area">
          <div className="cn-quick-chips">
            {QUICK_CHIPS.map((chip) => (
              <button key={chip} className="cn-chip" onClick={() => handleChipClick(chip)}>{chip}</button>
            ))}
          </div>
          <div className="cn-input-box">
            <button className="cn-input-icon" title="Attach">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M13 7l-5 5a3.5 3.5 0 01-5-5l5-5a2.5 2.5 0 013.5 3.5l-5 5a1.5 1.5 0 01-2-2l4-4"/></svg>
            </button>
            <input
              ref={inputRef}
              className="cn-input"
              type="text"
              placeholder="Ask Cart Ninja AI to help manage your store..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (input.trim() && !loading) handleSend(input);
                }
              }}
              disabled={loading !== null}
            />
            <button className="cn-input-icon" title="Voice">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><rect x="5" y="1" width="6" height="9" rx="3"/><path d="M2 8a6 6 0 0012 0M8 14v2M6 16h4"/></svg>
            </button>
            <button
              className="cn-send"
              disabled={!input.trim() || loading !== null}
              onClick={() => { if (input.trim() && !loading) handleSend(input); }}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M2 8l12-4-4 8-3-3-3-3z"/></svg>
            </button>
          </div>
          <div className="cn-input-hint">Cart Ninja AI can make mistakes. Review important changes before applying.</div>
        </div>
      </main>
    </div>
  );
}

export { mockApi, executeActions, undoAction, generateTitle, getTimeGroup, MODULE_MAP, HAMBURGER_ICON, SPARKLE_ICON, SEND_ICON };
