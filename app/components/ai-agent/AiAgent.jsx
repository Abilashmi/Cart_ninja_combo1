import { useState, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { featureStore } from "./featureStore";
import AILoadingState from "./AILoadingState";

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
  cartDrawer: { enable: "enableDrawer", disable: "disableDrawer" },
  progressBar: { enable: "enableGoalBar", disable: "disableGoalBar" },
  upsells: { enable: "enableUpsell", disable: "disableUpsell" },
  fbt: { enable: "enableFBT", disable: "disableFBT" },
  trustBadges: { enable: "enableTrustBadges", disable: "disableTrustBadges" },
};

const ACTION_LABELS = {
  cartDrawer: "Cart Drawer", progressBar: "Progress Bar",
  upsells: "Upsells", fbt: "FBT", trustBadges: "Trust Badges",
  styling: "Styling", optimization: "Optimization",
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

  if (/cart.*drawer|drawer/.test(lower)) actions.push({ module: "cartDrawer", action: wantDisable ? "disable" : "enable" });
  if (/progress.?bar|goal|free.?shipping|shipping.?progress/i.test(lower)) actions.push({ module: "progressBar", action: wantDisable ? "disable" : "enable" });
  if (/trust.?badge|security|secure|badge/i.test(lower) && !/goal|progress|shipping/.test(lower)) actions.push({ module: "trustBadges", action: wantDisable ? "disable" : "enable" });
  if (/upsell/i.test(lower) && !/fbt|frequently.*bought/i.test(lower)) actions.push({ module: "upsells", action: wantDisable ? "disable" : "enable" });
  if (/fbt|frequently.*bought/i.test(lower)) actions.push({ module: "fbt", action: wantDisable ? "disable" : "enable" });

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
    return { success: true, synced: data.synced, before: data.before, after: data.after };
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
    <div className="aia-settings-module">
      <span className="aia-settings-module-label">{label}</span>
      <span className={"aia-settings-module-badge" + (enabled ? " aia-settings-module-badge--on" : " aia-settings-module-badge--off")}>
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
  const [showHistory, setShowHistory] = useState(true);
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
    const detectedActions = extractActions(text);
    if (detectedActions.length > 0) {
      const result = await applyActionsViaApi(detectedActions);
      const labels = detectedActions.map((a) => a.label || ACTION_LABELS[a.module] || a.module).filter(Boolean).join(", ");
      if (result.success) {
        syncAfterToFeatureStore(result.after);
        const synced = result.synced !== false;
        const statusLine = synced ? "Status: Completed" : "Status: Applied (waiting for store sync)";
        processReply({
          id: "r-" + Date.now(), role: "agent", type: "json",
          json: { message: `Task: ${labels}\n${statusLine}`, actions: detectedActions, status: "success" },
          executedResults: [{ status: "executed" }],
        }, text);
      } else {
        processReply({
          id: "r-" + Date.now(), role: "agent", type: "json",
          json: { message: `Task: ${labels}\nStatus: Failed\nReason: ${result.error}` },
        }, text);
      }
    } else {
      try {
        const res = await aiApi.sendMessage(activeConvId || "temp", text, messages.map((m) => ({ role: m.role, text: m.text })));
        if (res.success && res.message) {
          processReply({
            id: "r-" + Date.now(), role: "agent", type: "json",
            json: { message: res.message },
          }, text);
        } else {
          throw new Error("no response");
        }
      } catch {
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

  const handleUndo = useCallback((action) => {
    undoAction(action);
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

  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const showInsight = lastMsg && lastMsg.role === "agent" && lastMsg.insight;
  const showChips = !loading && messages.length === 0;

  const maxVal = showInsight
    ? Math.max(...lastMsg.insight.series.map((s) => s.value))
    : 1;

  const WELCOME_CHIPS = [
    { id: "w1", text: "Enable Cart Drawer" },
    { id: "w2", text: "Free Shipping Goal" },
    { id: "w3", text: "Add Upsells" },
    { id: "w4", text: "Apply Premium Dark" },
    { id: "w5", text: "Analyze Revenue" },
    { id: "w6", text: "Optimize Mobile" },
  ];

  const today = conversations.filter((c) => getTimeGroup(c.ts) === "Today");
  const yesterday = conversations.filter((c) => getTimeGroup(c.ts) === "Yesterday");
  const last7 = conversations.filter((c) => getTimeGroup(c.ts) === "Last 7 Days");
  const older = conversations.filter((c) => getTimeGroup(c.ts) === "Older");

  return (
    <>
      <style>{`
.aia-wrap { height:100%; display:flex; flex-direction:column; gap:0; overflow:hidden; }
.aia-card { flex:1; border:1px solid #e8e8e8; border-radius:14px; background:#fff; overflow:hidden; display:flex; min-height:0; box-shadow:0 2px 8px rgba(0,0,0,.06); position:relative; }

/* ── History Sidebar ── */
.aia-sidebar { width:220px; flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid #e8e8e8; transition:width .2s ease; overflow:hidden; background:#fafafa; }
.aia-sidebar--closed { width:0; border-right-color:transparent; }
.aia-sidebar-inner { width:220px; display:flex; flex-direction:column; min-height:0; }
.aia-sidebar-head { display:flex; align-items:center; justify-content:space-between; padding:16px 14px 10px; font-size:12px; font-weight:600; color:#6d6d6d; text-transform:uppercase; letter-spacing:.4px; flex-shrink:0; }
.aia-sidebar-new { background:none; border:none; cursor:pointer; color:#FF6B00; font-size:11px; font-weight:600; padding:4px 8px; border-radius:6px; transition:background .12s; }
.aia-sidebar-new:hover { background:#FFF3EB; }
.aia-sidebar-list { padding:0 10px 12px; display:flex; flex-direction:column; gap:2px; flex:1; overflow-y:auto; min-height:0; }
.aia-sb-btn { display:block; width:100%; text-align:left; background:none; border:none; border-radius:6px; padding:8px 10px; font-size:13px; color:#1a1a1a; cursor:pointer; transition:all .12s; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.aia-sb-btn:hover { background:#f0f0f0; }
.aia-sb-btn--active { background:#FFF3EB; color:#FF6B00; font-weight:500; }
.aia-history-label { font-size:10px; font-weight:600; color:#9a9a9a; padding:12px 10px 4px; text-transform:uppercase; letter-spacing:.5px; }
.aia-history-empty { font-size:12px; color:#9a9a9a; padding:24px 14px; text-align:center; }

/* ── Chat ── */
.aia-chat { flex:1; display:flex; flex-direction:column; min-width:0; min-height:0; }
.aia-chat-head { display:flex; align-items:center; gap:10px; padding:12px 16px; border-bottom:1px solid #eee; flex-shrink:0; }
.aia-chat-head-btn { background:none; border:none; cursor:pointer; color:#9a9a9a; padding:4px; display:flex; border-radius:6px; transition:all .12s; }
.aia-chat-head-btn:hover { background:#f0f0f0; color:#1a1a1a; }
.aia-avatar { width:30px; height:30px; border-radius:8px; background:linear-gradient(135deg,#FF6B00,#FF8A33); display:flex; align-items:center; justify-content:center; flex-shrink:0; color:#fff; }
.aia-name { font-size:14px; font-weight:600; color:#1a1a1a; }
.aia-status-badge-header { font-size:11px; color:#059669; background:#ECFDF5; border-radius:6px; padding:2px 10px; margin-left:auto; }
.aia-settings-btn { background:none; border:1px solid #e8e8e8; border-radius:6px; cursor:pointer; color:#9a9a9a; padding:5px; display:flex; transition:all .12s; flex-shrink:0; }
.aia-settings-btn:hover { border-color:#FF6B00; color:#FF6B00; background:#FFF3EB; }

/* ── Messages ── */
.aia-msgs { flex:1; overflow-y:auto; min-height:0; padding:20px; display:flex; flex-direction:column; gap:16px; background:#fafafa; }
.aia-msg-row { max-width:80%; display:flex; flex-direction:column; }
.aia-msg-row--user { align-self:flex-end; }
.aia-msg-row--agent { align-self:flex-start; }
.aia-msg-label { margin-bottom:4px; padding-left:4px; font-size:10px; font-weight:600; color:#FF6B00; letter-spacing:.3px; text-transform:uppercase; display:flex; align-items:center; gap:4px; }
.aia-msg-bubble { padding:12px 18px; font-size:14px; line-height:1.6; white-space:pre-wrap; overflow-wrap:break-word; }
.aia-msg-bubble--user { background:linear-gradient(135deg,#FF6B00,#FF8A33); color:#fff; border-radius:16px 16px 4px 16px; }
.aia-msg-bubble--agent { background:#fff; color:#1a1a1a; border:1px solid #e8e8e8; border-radius:16px 16px 16px 4px; box-shadow:0 1px 3px rgba(0,0,0,.04); }

/* ── Agent Status (Welcome) ── */
.aia-status-card { background:#fff; border:1px solid #e8e8e8; border-radius:12px; padding:20px; box-shadow:0 1px 3px rgba(0,0,0,.04); width:100%; }
.aia-status-connected { display:flex; align-items:center; gap:8px; font-size:13px; color:#059669; font-weight:500; margin-bottom:16px; }
.aia-status-connected-dot { width:8px; height:8px; border-radius:50%; background:#10B981; }
.aia-status-monitoring { font-size:11px; font-weight:600; color:#9a9a9a; text-transform:uppercase; letter-spacing:.4px; margin-bottom:8px; }
.aia-status-items { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:16px; }
.aia-status-item { font-size:12px; color:#1a1a1a; background:#f5f5f5; padding:4px 12px; border-radius:6px; }
.aia-status-ready { font-size:13px; color:#9a9a9a; }

/* ── Chips ── */
.aia-chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.aia-chip { padding:5px 14px; border-radius:6px; border:1px solid #e8e8e8; background:#fff; font-size:12px; color:#555; cursor:pointer; transition:all .12s; }
.aia-chip:hover { border-color:#FF6B00; color:#FF6B00; background:#FFF3EB; }

/* ── Input ── */
.aia-input-wrap { display:flex; align-items:center; gap:8px; padding:12px 16px; border-top:1px solid #eee; flex-shrink:0; background:#fff; }
.aia-input { flex:1; height:40px; padding:0 14px; border:1px solid #e8e8e8; border-radius:10px; font-size:14px; outline:none; box-sizing:border-box; transition:border-color .15s; background:#fafafa; }
.aia-input:focus { border-color:#FF6B00; background:#fff; box-shadow:0 0 0 3px rgba(255,107,0,.1); }
.aia-send { width:40px; height:40px; border-radius:10px; border:none; background:linear-gradient(135deg,#FF6B00,#FF8A33); color:#fff; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0; transition:all .15s; }
.aia-send:hover { transform:scale(1.05); box-shadow:0 2px 8px rgba(255,107,0,.25); }
.aia-send:disabled { opacity:.4; cursor:default; transform:none; box-shadow:none; }

/* ── Settings Panel ── */
.aia-settings-overlay { position:absolute; inset:0; z-index:10; background:rgba(0,0,0,.15); border-radius:14px; animation:aiaFadeIn .15s ease; }
.aia-settings-panel { position:absolute; top:0; right:0; bottom:0; width:280px; background:#fff; border-left:1px solid #e8e8e8; border-radius:0 14px 14px 0; display:flex; flex-direction:column; animation:aiaSlideIn .2s ease; z-index:11; }
.aia-settings-head { display:flex; align-items:center; justify-content:space-between; padding:16px; border-bottom:1px solid #eee; flex-shrink:0; }
.aia-settings-title { font-size:14px; font-weight:600; color:#1a1a1a; }
.aia-settings-close { background:none; border:none; cursor:pointer; color:#9a9a9a; padding:4px; border-radius:6px; transition:all .12s; }
.aia-settings-close:hover { background:#f0f0f0; color:#1a1a1a; }
.aia-settings-body { flex:1; overflow-y:auto; min-height:0; padding:12px 16px; }
.aia-settings-module { display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:#fafafa; border-radius:8px; margin-bottom:6px; }
.aia-settings-module-label { font-size:13px; color:#1a1a1a; font-weight:500; }
.aia-settings-module-badge { font-size:11px; padding:2px 10px; border-radius:6px; font-weight:500; }
.aia-settings-module-badge--on { background:#ECFDF5; color:#065F46; }
.aia-settings-module-badge--off { background:#FEF2F2; color:#991B1B; }

/* ── Loading ── */
.aia-loading-wrap { max-width:80%; align-self:flex-start; }
.aia-loading { display:flex; align-items:center; gap:8px; padding:12px 18px; background:#fff; border-radius:16px 16px 16px 4px; border:1px solid #e8e8e8; }
.aia-loading-spinner { display:inline-block; width:14px; height:14px; border:2px solid #e8e8e8; border-top-color:#FF6B00; border-radius:50%; animation:aiaSpin .6s linear infinite; }
@keyframes aiaSpin { to{transform:rotate(360deg)} }

.aia-slide-in { animation:aiaSlideUp .28s ease; }
@keyframes aiaSlideUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
@keyframes aiaFadeIn { from{opacity:0} to{opacity:1} }
@keyframes aiaSlideIn { from{transform:translateX(40px);opacity:0} to{transform:translateX(0);opacity:1} }

@media(max-width:768px){ .aia-sidebar{display:none} .aia-settings-panel{width:100%; border-radius:0;} }
      `}</style>

      <div className="aia-wrap">
        <div className="aia-card">
          {/* ── History Panel ── */}
          <div className={"aia-sidebar" + (showHistory ? "" : " aia-sidebar--closed")}>
            <div className="aia-sidebar-inner">
              <div className="aia-sidebar-head">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="5"/><path d="M7 4v3l2 1"/></svg>
                <span>History</span>
              </div>
              <div className="aia-sidebar-list">
                {conversations.length === 0 && (
                  <div className="aia-history-empty">No conversations yet</div>
                )}
                {today.length > 0 && <div className="aia-history-label">Today</div>}
                {today.map((c) => (
                  <button key={c.id} className={"aia-sb-btn" + (c.id === activeConvId ? " aia-sb-btn--active" : "")} onClick={() => handleConversationClick(c.id)}>
                    {c.title.length > 32 ? c.title.slice(0, 29) + "..." : c.title}
                  </button>
                ))}
                {yesterday.length > 0 && <div className="aia-history-label">Yesterday</div>}
                {yesterday.map((c) => (
                  <button key={c.id} className={"aia-sb-btn" + (c.id === activeConvId ? " aia-sb-btn--active" : "")} onClick={() => handleConversationClick(c.id)}>
                    {c.title.length > 32 ? c.title.slice(0, 29) + "..." : c.title}
                  </button>
                ))}
                {last7.length > 0 && <div className="aia-history-label">Last 7 Days</div>}
                {last7.map((c) => (
                  <button key={c.id} className={"aia-sb-btn" + (c.id === activeConvId ? " aia-sb-btn--active" : "")} onClick={() => handleConversationClick(c.id)}>
                    {c.title.length > 32 ? c.title.slice(0, 29) + "..." : c.title}
                  </button>
                ))}
                {older.length > 0 && <div className="aia-history-label">Older</div>}
                {older.map((c) => (
                  <button key={c.id} className={"aia-sb-btn" + (c.id === activeConvId ? " aia-sb-btn--active" : "")} onClick={() => handleConversationClick(c.id)}>
                    {c.title.length > 32 ? c.title.slice(0, 29) + "..." : c.title}
                  </button>
                ))}
                <div style={{ borderTop: "1px solid #eee", marginTop: 8, paddingTop: 8 }}>
                  <button className="aia-sb-btn" onClick={handleNewChat} style={{ color: "#FF6B00", fontWeight: 500 }}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ marginRight: 6, verticalAlign: "middle" }}><path d="M6 2v8M2 6h8"/></svg>
                    Start New Conversation
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Chat ── */}
          <div className="aia-chat">
            <div className="aia-chat-head">
              <button className="aia-chat-head-btn" onClick={() => setShowHistory((v) => !v)} aria-label={showHistory ? "Hide history" : "Show history"}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 4h12M2 8h12M2 12h12" /></svg>
              </button>
              <div className="aia-avatar">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="1.5"><path d="M7 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" /></svg>
              </div>
              <span className="aia-name">{appName}</span>
              <span className="aia-status-badge-header">Connected</span>
              <button className="aia-settings-btn" onClick={() => setShowSettings((v) => !v)} title="Settings">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/></svg>
              </button>
            </div>

            <div className="aia-msgs" ref={scrollRef}>
              {messages.length === 0 && !loading && (
                <>
                  <div className="aia-status-card">
                    <div className="aia-status-connected">
                      <span className="aia-status-connected-dot" />
                      Connected to Store
                    </div>
                    <div className="aia-status-monitoring">Monitoring</div>
                    <div className="aia-status-items">
                      <span className="aia-status-item">Cart Drawer</span>
                      <span className="aia-status-item">Conversion Opportunities</span>
                      <span className="aia-status-item">Revenue Optimization</span>
                      <span className="aia-status-item">Customer Experience</span>
                    </div>
                    <div className="aia-status-ready">Awaiting Instructions</div>
                  </div>
                  <div className="aia-chips">
                    {WELCOME_CHIPS.map((chip) => (
                      <button key={chip.id} className="aia-chip" onClick={() => handleChipClick(chip.text)}>
                        {chip.text}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {messages.map((msg) => {
                const isUser = msg.role === "user";
                const j = msg.json;

                if (isUser) {
                  return (
                    <div key={msg.id} className="aia-msg-row aia-msg-row--user">
                      <div className="aia-msg-bubble aia-msg-bubble--user">{msg.text}</div>
                    </div>
                  );
                }

                if (j) {
                  if (j.status === "needs_input") {
                    return (
                      <div key={msg.id} className="aia-msg-row aia-msg-row--agent">
                        <AINeedsInputCard question={j.question} onSubmit={handleAnswer} />
                      </div>
                    );
                  }
                  if (j.status === "undo") {
                    return (
                      <div key={msg.id} className="aia-msg-row aia-msg-row--agent">
                        <div className="aia-msg-bubble aia-msg-bubble--agent" style={{ background:"#FFF4E5", color:"#594430", border:"1px solid #FFD9A8" }}>
                          {"\u21A9"} Undo successful
                        </div>
                      </div>
                    );
                  }
                  if (j.actions) {
                    return (
                      <div key={msg.id} style={{ maxWidth:"100%", alignSelf:"flex-start", width:"100%" }}>
                        <AIChangesSummary actions={j.actions} results={msg.executedResults} onUndo={handleUndo} message={j.message} />
                      </div>
                    );
                  }
                  if (j.message) {
                    return (
                      <div key={msg.id} className="aia-msg-row aia-msg-row--agent">
                        <div className="aia-msg-label">
                          <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="#FF6B00" strokeWidth="1.8"><path d="M7 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" /></svg>
                          Agent
                        </div>
                        <div className="aia-msg-bubble aia-msg-bubble--agent">{j.message}</div>
                      </div>
                    );
                  }
                }

                return null;
              })}

              {loading && (
                <div className="aia-loading-wrap">
                  <div className="aia-loading">
                    <span className="aia-loading-spinner" />
                    <span style={{ fontSize:13, color:"#999" }}>Executing...</span>
                  </div>
                </div>
              )}
            </div>

            <div className="aia-input-wrap">
              <input
                ref={inputRef}
                className="aia-input"
                type="text"
                placeholder="Type a command..."
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
              <button
                className="aia-send"
                disabled={!input.trim() || loading !== null}
                onClick={() => { if (input.trim() && !loading) handleSend(input); }}
                aria-label="Send message"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2 8l12-4-4 8-3-3-3-3z"/></svg>
              </button>
            </div>
          </div>

          {/* ── Settings Panel ── */}
          {showSettings && (
            <>
              <div className="aia-settings-overlay" onClick={() => setShowSettings(false)} />
              <div className="aia-settings-panel">
                <div className="aia-settings-head">
                  <span className="aia-settings-title">Modules</span>
                  <button className="aia-settings-close" onClick={() => setShowSettings(false)}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
                  </button>
                </div>
                <div className="aia-settings-body">
                  {MODULES_LIST.map((mod) => (
                    <ModuleToggle key={mod.k} storeKey={mod.k} label={mod.label} />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export { mockApi, executeActions, undoAction, generateTitle, getTimeGroup, MODULE_MAP, HAMBURGER_ICON, SPARKLE_ICON, SEND_ICON };
