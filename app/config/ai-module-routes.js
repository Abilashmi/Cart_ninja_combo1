// Which AI-enabled module page a merchant's request belongs to, used by the
// global Brix AI page to hand the request off to that module's existing
// BrixBar chat (see app/utils/ai-handoff.js). Plain data + pure functions, no
// server or React imports — safe to load from client components and node tests.
//
// This does NOT decide *what* to do with a request — the module chat runs it
// through the same /api/ai/chat tool loop as any other message. It only
// decides *where* the request should be shown and run.

// `paths` are the app route prefixes that host that module's BrixBar chat.
// `route` is where the global page navigates to.
export const AI_MODULE_ROUTES = {
  cart_editor: { route: '/app/cartdrawer', label: 'Cart Editor', paths: ['/app/cartdrawer'] },
  fbt: { route: '/app/fbt', label: 'Frequently Bought Together', paths: ['/app/fbt'] },
  build_combo: { route: '/app/bundles', label: 'Build a Combo', paths: ['/app/bundles'] },
  coupon_banner: { route: '/app/productwidget', label: 'Coupon Banner', paths: ['/app/productwidget'] },
};

// Cart Editor is one page with one chat and many features. A feature is only
// context for that chat: `sectionId` is the existing accordion id in
// CartEditorSidebar / SECTION_GROUPS (cartEditorTypes.js) that the sidebar can
// open so the merchant sees the setting being changed.
export const CART_EDITOR_FEATURES = {
  // /announc/ also catches "announce" and the common typo "announcment".
  announcement: { sectionId: 'announcements', label: 'Announcement', patterns: [/\bannounc\w*/i, /top[\s-]*bar\b/i] },
  progress_bar: {
    sectionId: 'progressBar',
    label: 'Progress Bar',
    // Milestones/tiers, free-shipping thresholds and free-gift rewards are all
    // configured on the Progress Bar, however the merchant words it.
    patterns: [
      /progress[\s-]*bars?\b/i, /goal[\s-]*bars?\b/i, /reward[\s-]*bars?\b/i,
      /shipping[\s-]*(?:goal|bar|progress|threshold|milestone)/i,
      /\bmilestones?\b/i, /(?:reward|progress)[\s-]*tiers?\b/i, /free[\s-]*(?:gift|product)s?\b/i,
    ],
  },
  coupon_slider: { sectionId: 'couponSlider', label: 'Coupon Slider', patterns: [/coupon[\s-]*(?:slider|carousel)/i] },
  upsell: { sectionId: 'upsellProducts', label: 'Upsell Products', patterns: [/\bup-?sell(?:s|ing)?\b/i, /\bcross[\s-]*sell(?:s|ing)?\b/i] },
  countdown_timer: { sectionId: 'countdownTimer', label: 'Countdown Timer', patterns: [/count[\s-]*down/i, /\btimers?\b/i] },
  empty_cart: { sectionId: 'emptyCart', label: 'Empty Cart', patterns: [/empty[\s-]*cart/i] },
  checkout_button: { sectionId: 'checkoutButton', label: 'Checkout Button', patterns: [/check[\s-]*out[\s-]*(?:button|btn)/i] },
  custom_css: { sectionId: 'customCSS', label: 'Custom CSS', patterns: [/custom[\s-]*css/i, /\bcss\b/i] },
  header: { sectionId: 'header', label: 'Header Style', patterns: [/(?:cart|drawer)[\s-]*header/i, /header[\s-]*(?:style|colou?r|background)/i] },
  design: { sectionId: 'design', label: 'Design', patterns: [/(?:cart|drawer)[\s-]*(?:design|theme|colou?rs?)/i] },
};

// Mentions that place a request in a module without naming a specific feature.
const MODULE_PATTERNS = {
  cart_editor: [/cart[\s-]*drawer/i, /cart[\s-]*editor/i],
  fbt: [/\bfbt\b/i, /frequently[\s-]+bought[\s-]+together/i, /bought[\s-]+together/i],
  build_combo: [/\bcombos?\b/i, /combo[\s-]*forge/i, /\bbundl(?:e|es|ing)\b/i],
  // The product-page "Coupon Banner" module — not the cart drawer's Coupon Slider.
  coupon_banner: [/coupon[\s-]*banners?\b/i],
};

const matchIndex = (patterns, text) => {
  let best = -1;
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && (best === -1 || m.index < best)) best = m.index;
  }
  return best;
};

export function getModuleForPath(pathname) {
  const path = String(pathname || '').replace(/\/+$/, '');
  for (const [key, cfg] of Object.entries(AI_MODULE_ROUTES)) {
    if (cfg.paths.some((p) => path === p || path.startsWith(`${p}/`))) return key;
  }
  return null;
}

// Returns { module, features } or null. Deliberately conservative: a request
// only maps to a module when EXACTLY ONE module is mentioned. Anything that
// names no module, or names several ("change my FBT template and my progress
// bar"), returns null so the merchant stays in the current chat, which can
// already run every tool — never a guess and never a random redirect.
export function detectAiModule(message) {
  const text = String(message || '');
  if (!text.trim()) return null;

  const featureHits = Object.entries(CART_EDITOR_FEATURES)
    .map(([key, cfg]) => ({ key, index: matchIndex(cfg.patterns, text) }))
    .filter((h) => h.index !== -1)
    .sort((a, b) => a.index - b.index);

  const modules = new Set();
  if (featureHits.length > 0 || matchIndex(MODULE_PATTERNS.cart_editor, text) !== -1) modules.add('cart_editor');
  for (const key of ['fbt', 'build_combo', 'coupon_banner']) {
    if (matchIndex(MODULE_PATTERNS[key], text) !== -1) modules.add(key);
  }

  if (modules.size !== 1) return null;
  const [module] = modules;
  return { module, features: module === 'cart_editor' ? featureHits.map((h) => h.key) : [] };
}

// Only a request to CHANGE something belongs on a module page (that is where
// the setting is edited and the live preview is). Questions and reports —
// "what's my progress bar setup?", "how much did upsells earn?", "show my
// sales", "how do I add an upsell?" — are answered right here in the chat, so
// they never redirect. A leading "how/what/is/can I ..." makes it a question
// unless it is a polite request ("can you change ...", "please ...").
const CHANGE_VERB_RE = /\b(?:change|update|set|turn\s+(?:on|off)|enable|disable|switch|make|create|add|remove|delete|edit|modify|apply|customi[sz]e|rename|replace|start|stop|activate|deactivate|build|generate|write|hide|reset|configure|setup|set\s*up|install|put|move|increase\s+the|decrease\s+the)\b/i;
const QUESTION_START_RE = /^\s*(?:how|what|whats|what's|why|when|where|which|who|is|are|does|do|did|was|were|can\s+i|could\s+i|should\s+i|may\s+i|tell\s+me|explain|show|display|give\s+me|list)\b/i;
const POLITE_REQUEST_RE = /^\s*(?:please|kindly|can\s+you|could\s+you|would\s+you|will\s+you|i\s+(?:want|need|would\s+like)\s+(?:you\s+)?to)\b/i;

const READ_TOPIC_RE = /\b(?:revenue|sales|analytics?|reports?|orders?|aov|conversions?|visitors?|traffic|performance|performing|stats?|statistics|metrics?|insights?|clicks?|earn(?:ed|ings)?|status)\b/i;

export function isChangeRequest(message) {
  const text = String(message || '').trim();
  if (!text) return false;
  const polite = POLITE_REQUEST_RE.test(text);
  if (!polite && (QUESTION_START_RE.test(text) || /\?\s*$/.test(text))) return false;
  if (CHANGE_VERB_RE.test(text)) return true;
  // No recognised verb ("ceate milestone above 3000 free shipping" — a typo — or
  // a terse "announcement red"): treat it as a change unless it is clearly
  // asking about numbers.
  return !READ_TOPIC_RE.test(text);
}

// The one entry point the global page uses. Returns null when the request
// should simply be handled where the merchant already is: not a change
// request, no confident module, or they're already on that module's page.
export function resolveHandoffTarget(message, currentPath) {
  if (!isChangeRequest(message)) return null;
  const detected = detectAiModule(message);
  if (!detected) return null;
  if (getModuleForPath(currentPath) === detected.module) return null;
  const cfg = AI_MODULE_ROUTES[detected.module];
  return {
    module: detected.module,
    features: detected.features,
    feature: detected.features[0] || null,
    route: cfg.route,
    label: cfg.label,
  };
}
