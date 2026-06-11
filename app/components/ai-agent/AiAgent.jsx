import { useState, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { featureStore } from "./featureStore";
import AILoadingState from "./AILoadingState";
import AIChangesSummary from "./AIChangesSummary";
import AINeedsInputCard from "./AINeedsInputCard";

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
  if (MK(/what.*(enable|important|recommend|best|feature|setup|prioritize)|which.*(feature|module).*(important|best|recommend|prioritize)/i)(lower))
    return "bestpractice";
  if (MK(/recommendation|opportunit|suggest|what.*(next|missing|improve)|what.*(else|more).*(enable|do)/i)(lower))
    return "recommendation";
  return null;
};

function mockApi(text) {
  const lower = text.toLowerCase();

  const mode = detectMode(lower);
  if (mode === "audit") {
    return modeCard("mode_audit", {
      score: 72, items: [
        { name: "Cart Drawer", status: "good", detail: "Enabled" },
        { name: "Progress Bar", status: "missing", detail: "Not enabled — add to boost conversions" },
        { name: "FBT", status: "missing", detail: "Not enabled — drives 10-20% extra revenue" },
        { name: "Upsells", status: "off", detail: "Disabled — reactivate for AOV lift" },
        { name: "Coupon Slider", status: "off", detail: "Disabled — helps conversion" },
        { name: "Trust Badges", status: "off", detail: "Disabled — builds checkout trust" },
      ], issues: ["No progress bar", "FBT disabled", "Upsells inactive"],
      opportunities: ["Enable progress bar → 20-30% conversion lift", "Activate FBT → 15% AOV increase", "Turn on upsells → 10-20% revenue gain"],
      quickWins: ["Enable Progress Bar (takes 1 click)", "Activate FBT recommendations"],
      cta: "Apply Recommended Fixes"
    });
  }

  if (mode === "strategy") {
    const goal = /aov|order.?value/i.test(lower) ? "Increase AOV"
      : /revenue|sale/i.test(lower) ? "Increase Revenue"
      : /conversion|rate/i.test(lower) ? "Improve Conversion Rate"
      : /lead|email|collect/i.test(lower) ? "Collect More Leads"
      : /abandon|cancel|drop/i.test(lower) ? "Reduce Cart Abandonment"
      : "Increase AOV";
    return modeCard("mode_strategy", {
      goal, actions: [
        { module: "Progress Bar", action: "enable" },
        { module: "FBT", action: "enable" },
        { module: "Upsells", action: "enable" },
      ], impact: "Expected impact: 25-40% boost in target metric",
      cta: "Apply Strategy"
    });
  }

  if (mode === "campaign") {
    const campaignName = /diwali/i.test(lower) ? "Diwali Festive Sale"
      : /independence/i.test(lower) ? "Independence Day Sale"
      : /black.?friday/i.test(lower) ? "Black Friday Sale"
      : /christmas|new.?year/i.test(lower) ? "Holiday Season Offer"
      : /weekend/i.test(lower) ? "Weekend Flash Sale"
      : "Limited Time Campaign";
    return modeCard("mode_campaign", {
      name: campaignName, elements: [
        { type: "Banner", detail: `${campaignName} — Up to 20% OFF` },
        { type: "Coupon", detail: "Auto-applied discount on checkout" },
        { type: "Countdown Timer", detail: "72-hour urgency timer" },
        { type: "Progress Bar", detail: "Free shipping on orders above Rs.999" },
        { type: "Upsell Strategy", detail: "FBT + product recommendations" },
      ], cta: "Launch Campaign"
    });
  }

  if (mode === "diagnosis") {
    return modeCard("mode_diagnosis", {
      diagnosis: "Your cart is missing urgency signals and purchase incentives", findings: [
        "No progress bar — customers don't see shipping threshold",
        "No countdown timer — no urgency to complete purchase",
        "No trust badges — reduced checkout confidence",
        "Upsells disabled — leaving revenue on the table"
      ], fixes: [
        "Enable progress bar with free shipping goal",
        "Add countdown timer for time-limited offers",
        "Enable trust badges near checkout button",
        "Activate FBT recommendations for cross-sells"
      ], cta: "Apply Fixes"
    });
  }

  if (mode === "bestpractice") {
    return modeCard("mode_bestpractice", {
      ranking: [
        { rank: 1, name: "Progress Bar", impact: "20-30% conversion lift", priority: "critical" },
        { rank: 2, name: "Cart Drawer", impact: "15-25% AOV increase", priority: "critical" },
        { rank: 3, name: "FBT", impact: "10-20% extra revenue", priority: "high" },
        { rank: 4, name: "Upsells", impact: "10-20% revenue gain", priority: "high" },
        { rank: 5, name: "Coupon Slider", impact: "12-18% conversion lift", priority: "medium" },
        { rank: 6, name: "Trust Badges", impact: "5-10% checkout trust", priority: "medium" },
        { rank: 7, name: "Countdown Timer", impact: "8-15% urgency boost", priority: "low" },
      ], recommendation: "Start with Progress Bar and Cart Drawer — they deliver the highest ROI for most stores",
      cta: "Enable Recommended Features"
    });
  }

  if (mode === "recommendation") {
    return modeCard("mode_recommendation", {
      current: ["Cart Drawer", "Trust Badges"], missing: ["Progress Bar", "FBT", "Upsells", "Coupon Slider"],
      opportunity: "Enable Progress Bar and FBT to increase AOV by 25-35%",
      cta: "Enable Recommendations"
    });
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
  const successMsg = (...lines) => lines.map(l => "\u2713 " + l).join("\n");
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
      if (!featureStore.get("cart_drawer")) return makeActions([], "Cart Drawer is already inactive.");
      setDisabled("cart_drawer");
      return makeActions([{ module: "cartDrawer", action: "disable", settings: { enabled: false } }], successMsg("Cart Drawer deactivated"));
    }
    const a = []; const s = [];
    const fe = ensureFeature("cart_drawer", MODULE_LABELS.cart_drawer);
    a.push(...fe.actions); s.push(...fe.steps);
    const settings = { enabled: true };
    if (/dark|themed?/.test(lower)) settings.theme = "dark";
    if (/round|radius/.test(lower)) settings.borderRadius = 20;
    if (/colou?r/.test(lower)) settings.theme = "custom";
    const hasExtra = Object.keys(settings).filter((k) => k !== "enabled").length > 0;
    if (hasExtra) {
      a.push({ module: "cartDrawer", action: "update", settings });
      if (settings.theme) s.push(`Theme set to ${settings.theme}`);
      if (settings.borderRadius) s.push(`Border radius set to ${settings.borderRadius}px`);
    }
    return makeActions(a, successMsg(...s));
  }

  if (/progress.?bar|goal|free.?shipping|shipping.?progress/i.test(lower)) {
    const wantDisable = /disable|turn off|deactiv|remove|stop|hide|close/.test(lower);
    if (wantDisable) {
      if (!featureStore.get("progress_bar")) return makeActions([], "Progress Bar is already inactive.");
      setDisabled("progress_bar");
      return makeActions([{ module: "progressBar", action: "disable", settings: { enabled: false } }], successMsg("Progress Bar deactivated"));
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
      s.push(`Goal ${currency === "INR" ? "\u20B9" : "$"}${goal.toLocaleString()}`);
    }
    return makeActions(a, successMsg(...s));
  }

  if (/trust.?badge|security|secure|badge/i.test(lower) && !/goal|progress|shipping/.test(lower)) {
    const wantDisable = /disable|turn off|deactiv|remove|stop|hide|close/.test(lower);
    if (wantDisable) {
      if (!featureStore.get("trust_badges")) return makeActions([], "Trust Badges are already inactive.");
      setDisabled("trust_badges");
      return makeActions([{ module: "trustBadges", action: "disable", settings: { enabled: false } }], successMsg("Trust Badges deactivated"));
    }
    const a = []; const s = [];
    const pe = ensurePrereq("trust_badges"); a.push(...pe.actions); s.push(...pe.steps);
    const fe = ensureFeature("trust_badges", "Trust Badges"); a.push(...fe.actions); s.push(...fe.steps);
    return makeActions(a, successMsg(...s));
  }

  if (/upsell|frequently.*bought|fbt|recommend/i.test(lower)) {
    const isFbt = !/upsell|product.?recommend/i.test(lower) || /fbt|frequently.*bought/i.test(lower);
    const storeKey = isFbt ? "fbt" : "upsells";
    const moduleName = isFbt ? "fbt" : "upsells";
    const label = isFbt ? "Frequently Bought Together" : "Upsells";
    const wantDisable = /disable|turn off|deactiv|remove|stop|hide|close/.test(lower);
    if (wantDisable) {
      if (!featureStore.get(storeKey)) return makeActions([], `${label} is already inactive.`);
      setDisabled(storeKey);
      return makeActions([{ module: moduleName, action: "disable", settings: { enabled: false } }], successMsg(`${label} deactivated`));
    }
    const a = []; const s = [];
    const pe = ensurePrereq(storeKey); a.push(...pe.actions); s.push(...pe.steps);
    const fe = ensureFeature(storeKey, label); a.push(...fe.actions); s.push(...fe.steps);
    return makeActions(a, successMsg(...s));
  }

  if (/coupon.*slider|slider|coupon.*banner|coupon.*show|show.*coupon/i.test(lower)) {
    const wantDisable = /disable|turn off|deactiv|remove|stop|hide|close/.test(lower);
    if (wantDisable) {
      if (!featureStore.get("coupon_slider")) return makeActions([], "Coupon Slider is already inactive.");
      setDisabled("coupon_slider");
      return makeActions([{ module: "couponSlider", action: "disable", settings: { enabled: false } }], successMsg("Coupon Slider deactivated"));
    }
    const a = []; const s = [];
    const pe = ensurePrereq("coupon_slider"); a.push(...pe.actions); s.push(...pe.steps);
    const fe = ensureFeature("coupon_slider", "Coupon Slider"); a.push(...fe.actions); s.push(...fe.steps);
    return makeActions(a, successMsg(...s));
  }

  if (/coupon.*banner|banner.*coupon|product.?widget|widget/i.test(lower)) {
    const wantDisable = /disable|turn off|deactiv|remove|stop|hide|close/.test(lower);
    if (wantDisable) {
      if (!featureStore.get("coupon_banner")) return makeActions([], "Coupon Banner is already inactive.");
      setDisabled("coupon_banner");
      return makeActions([{ module: "couponBanner", action: "disable", settings: { enabled: false } }], successMsg("Coupon Banner deactivated"));
    }
    const a = []; const s = [];
    const pe = ensurePrereq("coupon_banner"); a.push(...pe.actions); s.push(...pe.steps);
    const fe = ensureFeature("coupon_banner", "Coupon Banner"); a.push(...fe.actions); s.push(...fe.steps);
    return makeActions(a, successMsg(...s));
  }

  if (/coupon.*creator|create.*coupon|discount|offer.*create/i.test(lower)) {
    const wantDisable = /disable|turn off|deactiv|remove|stop|hide|close/.test(lower);
    if (wantDisable) {
      if (!featureStore.get("coupon_creator")) return makeActions([], "Coupon Creator is already inactive.");
      setDisabled("coupon_creator");
      return makeActions([{ module: "couponCreator", action: "disable", settings: { enabled: false } }], successMsg("Coupon Creator deactivated"));
    }
    const a = []; const s = [];
    const fe = ensureFeature("coupon_creator", "Coupon Creator"); a.push(...fe.actions); s.push(...fe.steps);
    return makeActions(a, successMsg(...s));
  }

  if (/combo.?forge|bundle|bundles|landing.?page/i.test(lower)) {
    const wantDisable = /disable|turn off|deactiv|remove|stop|hide|close/.test(lower);
    if (wantDisable) {
      if (!featureStore.get("combo_forge")) return makeActions([], "Combo Forge is already inactive.");
      setDisabled("combo_forge");
      return makeActions([{ module: "comboForge", action: "disable", settings: { enabled: false } }], successMsg("Combo Forge deactivated"));
    }
    const a = []; const s = [];
    const fe = ensureFeature("combo_forge", "Combo Forge"); a.push(...fe.actions); s.push(...fe.steps);
    return makeActions(a, successMsg(...s));
  }

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
      s.push(`${label} color → ${color}`);
      return makeActions(a, successMsg(...s));
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
      s.push(`Theme → ${color}`);
      return makeActions(a, successMsg(...s));
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
    return Promise.resolve({ id: "r-" + Date.now(), role: "agent", type: "json", json: {
      status: "needs_input",
      question: "Sorry, that's not related to Cart Ninja. I can only help you optimize your Shopify cart for more revenue."
    }});
  }

  return Promise.resolve({ id: "r-" + Date.now(), role: "agent", type: "json", json: {
    status: "needs_input",
    question: "I'm your Cart Ninja Conversion Agent. I can audit your store, recommend features, create campaigns, or configure settings. Try: 'audit my store', 'increase AOV', 'create a campaign', or 'enable cart drawer'."
  }});
}

function useFeatureState(key) {
  return useSyncExternalStore(
    featureStore.subscribe,
    () => featureStore.get(key),
    () => featureStore.get(key),
  );
}

function useFeatureSettings(key) {
  const [settings, setSettings] = useState(() => featureStore.getSettings(key));
  useEffect(() => {
    const handler = () => setSettings(featureStore.getSettings(key));
    return featureStore.subscribe(handler);
  }, [key]);
  return settings;
}

function FeatureStatus() {
  const features = [
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

  return (
    <div className="aia-status">
      <div className="aia-status-head">Module Status</div>
      <div className="aia-status-body">
        {features.map((f) => <FeatureRow key={f.k} storeKey={f.k} label={f.label} />)}
      </div>
    </div>
  );
}

function FeatureRow({ storeKey, label }) {
  const enabled = useFeatureState(storeKey);
  const settings = useFeatureSettings(storeKey);
  const settingsBadge = settings ? Object.entries(settings).filter(([,v]) => v).map(([k,v]) => `${k}:${v}`).join(" ") : null;
  return (
    <div className="aia-status-row">
      <span className="aia-status-label">{label}</span>
      <div style={{ display:"flex", gap:4, alignItems:"center" }}>
        {settingsBadge && <span style={{ fontSize:10, color:"#534AB7", background:"#EEEDFE", padding:"2px 6px", borderRadius:4 }}>{settingsBadge}</span>}
        <span className={"aia-status-badge" + (enabled ? " aia-status-on" : " aia-status-off")}>
          {enabled ? "Active" : "Inactive"}
        </span>
      </div>
    </div>
  );
}

export default function AiAgent({ appName = "Cart Ninja AI", initialQuery = "" }) {
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

    if (!j) {
      setLoading(null);
      setMessages((prev) => [...prev, reply]);
      return;
    }

    if (j.status === "needs_input") {
      setPendingContext(userText);
      setLoading(null);
      setMessages((prev) => [...prev, reply]);
      return;
    }

    if (j.actions && j.actions.length > 0) {
      try {
        const results = executeActions(j.actions);
        const executedReply = { ...reply, executedResults: results };
        setLoading(null);
        setMessages((prev) => [...prev, executedReply]);
      } catch {
        setLoading(null);
        setMessages((prev) => [...prev, { ...reply, json: { ...reply.json, message: "Error applying changes. Please try again." } }]);
      }
      return;
    }

    setLoading(null);
    setMessages((prev) => [...prev, reply]);
  }, []);

  const callApi = useCallback((text) => {
    setLoading("analyzing");
    mockApi(text).then((reply) => {
      processReply(reply, text);
    });
  }, [processReply]);

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
    { id: "w1", text: "Activate cart drawer" },
    { id: "w2", text: "Enable progress bar with Rs.500 goal" },
    { id: "w3", text: "Deactivate upsells" },
    { id: "w4", text: "Activate FBT recommendations" },
  ];

  const today = conversations.filter((c) => getTimeGroup(c.ts) === "Today");
  const yesterday = conversations.filter((c) => getTimeGroup(c.ts) === "Yesterday");
  const last7 = conversations.filter((c) => getTimeGroup(c.ts) === "Last 7 Days");
  const older = conversations.filter((c) => getTimeGroup(c.ts) === "Older");

  return (
    <>
      <style>{`
.aia-wrap { height:100%; display:flex; flex-direction:column; gap:0; overflow:hidden; }
.aia-header { display:flex; align-items:center; gap:12px; padding:16px 0 12px; flex-shrink:0; }
.aia-header-icon { width:40px; height:40px; border-radius:10px; background:#534AB7; display:flex; align-items:center; justify-content:center; color:#fff; flex-shrink:0; }
.aia-header h1 { margin:0; font-size:20px; font-weight:650; color:#1a1a1a; }
.aia-header p { margin:2px 0 0; font-size:13px; color:#6d6d6d; }
.aia-card { flex:1; border:1px solid #e8e8e8; border-radius:14px; background:#fff; overflow:hidden; display:flex; min-height:0; box-shadow:0 2px 8px rgba(0,0,0,.06); }
.aia-sidebar { width:210px; flex-shrink:0; display:flex; flex-direction:column; border-right:1px solid #e8e8e8; transition:width .2s ease; overflow:hidden; }
.aia-sidebar--closed { width:0; border-right-color:transparent; }
.aia-sidebar-inner { width:210px; height:100%; display:flex; flex-direction:column; }
.aia-sidebar-head { display:flex; align-items:center; gap:6px; padding:14px 14px 10px; font-size:13px; color:#6d6d6d; flex-shrink:0; }
.aia-sidebar-list { padding:0 12px 12px; display:flex; flex-direction:column; gap:4px; flex:1; overflow-y:auto; }
.aia-sb-btn { display:block; width:100%; text-align:left; background:none; border:1px solid #e8e8e8; border-radius:8px; padding:8px 10px; font-size:13px; color:#1a1a1a; cursor:pointer; transition:background .12s; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.aia-sb-btn:hover { background:#f6f6f7; }
.aia-sb-btn--active { background:#EEEDFE; border-color:#534AB7; color:#26215C; font-weight:500; }
.aia-sidebar-foot { padding:8px 14px 12px; font-size:12px; color:#9a9a9a; border-top:1px solid #eee; flex-shrink:0; }
.aia-chat { flex:1; display:flex; flex-direction:column; min-width:0; }
.aia-chat-head { display:flex; align-items:center; gap:8px; padding:10px 14px; border-bottom:1px solid #eee; flex-shrink:0; }
.aia-chat-head-btn { background:none; border:none; cursor:pointer; color:#6d6d6d; padding:2px; display:flex; }
.aia-avatar { width:28px; height:28px; border-radius:50%; background:#EEEDFE; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.aia-name { font-size:14px; font-weight:600; color:#1a1a1a; flex:1; }
.aia-online { font-size:12px; color:#085041; background:#E1F5EE; border-radius:10px; padding:2px 10px; flex-shrink:0; }
.aia-newchat-btn { background:none; border:1px solid #e3e3e3; border-radius:6px; cursor:pointer; color:#6d6d6d; display:flex; align-items:center; gap:3px; padding:3px 8px; font-size:12px; transition:background .12s; flex-shrink:0; }
.aia-newchat-btn:hover { background:#f6f6f7; }
.aia-msgs { flex:1; overflow-y:auto; padding:14px; display:flex; flex-direction:column; gap:10px; }
.aia-bubble { padding:10px 14px; border-radius:10px; font-size:14px; line-height:1.55; white-space:pre-wrap; overflow-wrap:break-word; }
.aia-input-wrap { display:flex; align-items:center; gap:8px; padding:10px 14px; border-top:1px solid #eee; flex-shrink:0; }
.aia-input { flex:1; height:36px; padding:0 12px; border:1px solid #e3e3e3; border-radius:8px; font-size:14px; outline:none; box-sizing:border-box; }
.aia-input:focus { border-color:#534AB7; box-shadow:0 0 0 2px #EEEDFE; }
.aia-send { width:36px; height:36px; border-radius:8px; border:none; background:#534AB7; color:#fff; display:flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0; transition:background .12s; }
.aia-send:hover { background:#453ea3; }
.aia-send:disabled { opacity:.45; cursor:default; }
.aia-chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:4px; }
.aia-chip { padding:5px 14px; border-radius:16px; border:1px solid #e3e3e3; background:#fff; font-size:12px; color:#1a1a1a; cursor:pointer; transition:background .12s; }
.aia-chip:hover { background:#f6f6f7; }
.aia-right-panel { width:210px; flex-shrink:0; display:flex; flex-direction:column; border-left:1px solid #e8e8e8; }
.aia-right-panel .aia-insights { width:auto; border-left:none; }
.aia-status { display:flex; flex-direction:column; padding:0; height:100%; }
.aia-status-head { padding:12px 12px 8px; font-size:13px; font-weight:600; color:#1a1a1a; border-bottom:1px solid #eee; }
.aia-status-body { padding:8px 12px 12px; display:flex; flex-direction:column; gap:4px; flex:1; overflow-y:auto; }
.aia-status-row { display:flex; align-items:center; justify-content:space-between; padding:6px 8px; border:1px solid #e8e8e8; border-radius:6px; }
.aia-status-label { font-size:11px; color:#1a1a1a; font-weight:500; }
.aia-status-badge { font-size:10px; padding:2px 8px; border-radius:8px; font-weight:500; }
.aia-status-on { background:#E1F5EE; color:#085041; }
.aia-status-off { background:#fce8e6; color:#a12b22; }

.aia-loading { padding:14px; }
.aia-loading-spinner { display:inline-block; width:16px; height:16px; border:2px solid #e3e3e3; border-top-color:#534AB7; border-radius:50%; animation:aiaSpin .6s linear infinite; }
@keyframes aiaSpin { to{transform:rotate(360deg)} }

.aia-changes-summary { max-width:100%; }
.aia-changes-summary .Polaris-Card { border-radius:10px; }
.aia-action-item { padding:4px 0; }
.aia-action-icon { display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:50%; font-size:12px; font-weight:bold; flex-shrink:0; }
.aia-action-icon--ok { background:#E1F5EE; color:#085041; }
.aia-action-icon--err { background:#fce8e6; color:#a12b22; }

.aia-needs-input { max-width:100%; }
.aia-needs-input .Polaris-Card { border-radius:10px; }
.aia-option-grid { display:flex; flex-wrap:wrap; gap:8px; }

.aia-slide-in { animation:aiaSlideUp .28s ease; }
@keyframes aiaSlideUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }

.aia-history-label { font-size:11px; font-weight:600; color:#9a9a9a; padding:8px 14px 4px; text-transform:uppercase; letter-spacing:.5px; }
.aia-history-empty { font-size:12px; color:#9a9a9a; padding:8px 14px; text-align:center; }

@media(max-width:768px){ .aia-sidebar{display:none} .aia-right-panel{display:none} }
      `}</style>

      <div className="aia-wrap">
        <div className="aia-card">
          <div className={"aia-sidebar" + (showHistory ? "" : " aia-sidebar--closed")}>
            <div className="aia-sidebar-inner">
              <div className="aia-sidebar-head">
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="6.5" cy="6.5" r="5" /><path d="M6.5 4v3l2 1.5" />
                </svg>
                <span>History</span>
              </div>
              <div className="aia-sidebar-list" style={{ paddingBottom: 0 }}>
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
              </div>
            </div>
          </div>

          <div className="aia-chat">
            <div className="aia-chat-head">
              <button
                className="aia-chat-head-btn"
                onClick={() => setShowHistory((v) => !v)}
                aria-label={showHistory ? "Hide history" : "Show history"}
              >
                {HAMBURGER_ICON}
              </button>
              <div className="aia-avatar">{SPARKLE_ICON}</div>
              <span className="aia-name">{appName}</span>
              <span className="aia-online">Online</span>
              <button className="aia-newchat-btn" onClick={handleNewChat} aria-label="New chat" title="New chat">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 2v8M2 6h8" /></svg>
                New
              </button>
            </div>

            <div className="aia-msgs" ref={scrollRef}>
              {messages.length === 0 && !loading && (
                <>
                  <div style={{ maxWidth: "90%", alignSelf: "flex-start" }}>
                    <div className="aia-bubble" style={{ background: "#f1f1f2" }}>
                      How can I help you with your cart today?
                    </div>
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
                    <div key={msg.id} style={{ maxWidth: "90%", alignSelf: "flex-end" }}>
                      <div className="aia-bubble" style={{ background: "#EEEDFE", color: "#26215C" }}>
                        {msg.text}
                      </div>
                    </div>
                  );
                }

                if (j) {
                  if (j.status === "needs_input") {
                    return (
                      <div key={msg.id} style={{ maxWidth: "90%", alignSelf: "flex-start" }}>
                        <AINeedsInputCard question={j.question} onSubmit={handleAnswer} />
                      </div>
                    );
                  }
                  if (j.status === "undo") {
                    return (
                      <div key={msg.id} style={{ maxWidth: "90%", alignSelf: "flex-start" }}>
                        <div className="aia-bubble aia-slide-in" style={{ background: "#FFF4E5", color: "#594430", border: "1px solid #FFD9A8" }}>
                          {"\u21A9"} Undo successful
                        </div>
                      </div>
                    );
                  }
                  if (j.actions) {
                    return (
                      <div key={msg.id} style={{ maxWidth: "100%", alignSelf: "flex-start", width: "100%" }}>
                        <AIChangesSummary actions={j.actions} results={msg.executedResults} onUndo={handleUndo} message={j.message} />
                      </div>
                    );
                  }
                  if (j.message) {
                    return (
                      <div key={msg.id} style={{ maxWidth: "90%", alignSelf: "flex-start" }}>
                        <div className="aia-bubble" style={{ background: "#f1f1f2" }}>
                          {j.message}
                        </div>
                      </div>
                    );
                  }
                }

                return null;
              })}

              {loading && (
                <div style={{ maxWidth: "90%", alignSelf: "flex-start", width: "100%" }}>
                  <AILoadingState />
                </div>
              )}
            </div>

            <div className="aia-input-wrap">
              <input
                ref={inputRef}
                className="aia-input"
                type="text"
                placeholder="Describe what you want to do..."
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
                {SEND_ICON}
              </button>
            </div>
          </div>

          <div className="aia-right-panel">
            {showInsight ? (
              <div className="aia-insights">
                <div className="aia-insights-head">
                  <span>Insights</span>
                  <button
                    className="aia-insights-close"
                    onClick={() => {
                      setMessages((prev) => {
                        const copy = [...prev];
                        copy[copy.length - 1] = { ...copy[copy.length - 1], insight: null };
                        return copy;
                      });
                    }}
                    aria-label="Close insights"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                  </button>
                </div>
                <div className="aia-insights-body">
                  <div className="aia-metric">
                    <p className="aia-metric-label">{lastMsg.insight.metric}</p>
                    <p className="aia-metric-val">{lastMsg.insight.value}</p>
                    <div className="aia-metric-delta">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#0F6E56" strokeWidth="1.5" strokeLinecap="round"><path d="M6 10V2M2 6l4-4 4 4" /></svg>
                      <span>{lastMsg.insight.delta}</span>
                    </div>
                  </div>
                  <div className="aia-chart">
                    {lastMsg.insight.series.map((s, i) => {
                      const isLast = i === lastMsg.insight.series.length - 1;
                      const barH = Math.max(4, (s.value / maxVal) * 90);
                      return (
                        <div key={s.label} className="aia-bar-wrap">
                          <div className="aia-bar" style={{ height: barH + "px", background: isLast ? "#534AB7" : "#AFA9EC" }} />
                          <span className="aia-bar-label">{s.label}</span>
                        </div>
                      );
                    })}
                  </div>
                  <button className="aia-follow" onClick={() => handleSend(lastMsg.insight.followUp)}>
                    {lastMsg.insight.followUp} {"\u2197"}
                  </button>
                </div>
              </div>
            ) : (
              <FeatureStatus />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
