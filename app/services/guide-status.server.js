/**
 * What each guided-setup feature really has, read from where the feature
 * keeps its own settings (never from the guide's progress):
 *   configured = its settings were saved at least once
 *     cod       saved COD settings (cod_settings row)
 *     cart      a cart_drawer record (the Cart Editor's save)
 *     fbt       an fbt_widget_settings row with AI mode or an active rule
 *     combo     any combo template
 *     packs     any Pack (draft, inactive or active)
 *     coupon    the Coupon Banner's own row (coupon_slider_widget) with a coupon picked
 *     discounts any discount in Shopify
 *     brix_ai   any BRIX AI conversation
 *   active = switched on for shoppers: the Home card switches (loadModuleStatus);
 *     discounts = an active Shopify discount; BRIX AI has no on/off (null).
 * `existing` = the store already set something up, so it isn't shown the
 * onboarding questions by itself (it can still start the guide from Home).
 *
 * Read-only. Never throws: a source that fails or is slow is null (unknown).
 * Every source can be replaced (`sources`) for the tests.
 */
import { getDb } from './db.server';
import { fetchCartDrawerRecord } from './cart-drawer-record.server';
import { getCodSettingsState } from './cod.server';
import { listActivePacks, listPacks } from './packs.server';
import { loadModuleStatus } from './home-status.server';
import { BASE_PHP_URL } from '../utils/api-helpers';
import { internalAuthHeaders } from '../utils/internal-auth';
import { GUIDE_MODULE_IDS } from '../utils/guide.shared.js';

const TIME_LIMIT_MS = 3000;

function settle(promise, ms = TIME_LIMIT_MS) {
  let timer;
  return Promise.race([
    Promise.resolve().then(() => promise).catch(() => null),
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// One call per request, however many checks ask for it.
function once(fn) {
  let promise = null;
  return () => { if (!promise) promise = Promise.resolve().then(fn); return promise; };
}

async function firstRow(sql, params) {
  const [rows] = await getDb().execute(sql, params);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function shopifyDiscounts(admin) {
  if (!admin) return null;
  const res = await admin.graphql(`#graphql
    query BrixGuideDiscounts {
      any: discountNodes(first: 1) { edges { node { id } } }
      live: discountNodes(first: 1, query: "status:active") { edges { node { id } } }
    }`);
  const json = await res.json();
  if (json?.errors) throw new Error('discounts query failed');
  return { any: (json.data?.any?.edges || []).length > 0, live: (json.data?.live?.edges || []).length > 0 };
}

async function aiConversations(shop) {
  const res = await fetch(`${BASE_PHP_URL}/ai_conversations.php?shop=${encodeURIComponent(shop)}`, { headers: { ...internalAuthHeaders() } });
  const json = await res.json();
  return Array.isArray(json?.conversations) ? json.conversations.length : 0;
}

// The Coupon Banner keeps its picked coupons as a JSON list (or one id in older rows).
function hasPickedCoupons(value) {
  if (Array.isArray(value)) return value.some((v) => typeof v === 'string' && v.trim());
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.some((v) => typeof v === 'string' && v.trim());
    return Boolean(parsed);
  } catch { return true; }
}

function buildSources(shop, admin, sources) {
  const query = sources.query || firstRow;
  return {
    cartRecord: once(sources.cartRecord ? () => sources.cartRecord(shop) : () => fetchCartDrawerRecord(shop)),
    codState: once(sources.codState ? () => sources.codState(shop) : () => getCodSettingsState(shop)),
    allPacks: once(sources.allPacks ? () => sources.allPacks(shop) : () => listPacks(shop)),
    activePacks: sources.activePacks || listActivePacks,
    discounts: once(sources.discounts ? () => sources.discounts(admin) : () => shopifyDiscounts(admin)),
    conversations: once(sources.conversations ? () => sources.conversations(shop) : () => aiConversations(shop)),
    query,
  };
}

// The "configured" check of one feature (null = couldn't tell).
const CONFIGURED = {
  cod: async (shop, src) => (await src.codState()).saved === true,
  cart: async (shop, src) => (await src.cartRecord()) != null,
  fbt: async (shop, src) => {
    const row = await src.query('SELECT mode FROM fbt_widget_settings WHERE shop_domain = ? LIMIT 1', [shop]);
    if (!row) return false;
    if (String(row.mode || '').toLowerCase() === 'ai') return true;
    const rules = await src.query('SELECT COUNT(*) AS n FROM fbt_rules WHERE shop_domain = ? AND is_active = 1', [shop]);
    return Number(rules?.n) > 0;
  },
  combo: async (shop, src) => {
    const row = await src.query('SELECT COUNT(*) AS n FROM combo_templates WHERE shop_domain = ?', [shop]);
    return Number(row?.n) > 0;
  },
  packs: async (shop, src) => (await src.allPacks()).length > 0,
  coupon: async (shop, src) => {
    const row = await src.query('SELECT selectedTemplateCoupon FROM coupon_slider_widget WHERE shopDomain = ? LIMIT 1', [shop]);
    return row ? hasPickedCoupons(row.selectedTemplateCoupon) : false;
  },
  discounts: async (shop, src) => {
    const d = await src.discounts();
    return d ? d.any : null;
  },
  brix_ai: async (shop, src) => (await src.conversations()) > 0,
};

/** Is this feature's setup saved? true / false, or null when it couldn't be read. */
export async function isModuleConfigured(shop, moduleId, { admin = null, sources = {}, timeLimitMs = 8000 } = {}) {
  const check = CONFIGURED[moduleId];
  if (!check) return null;
  const value = await settle(check(shop, buildSources(shop, admin, sources)), timeLimitMs);
  return typeof value === 'boolean' ? value : null;
}

/**
 * { moduleStatus, existing, modules }:
 *   moduleStatus = Home's card switches (same as loadModuleStatus)
 *   existing     = the store already has something set up
 *   modules      = { [feature]: { configured, active } }, only with `full`
 *                  (stores using the guide; others skip the extra reads)
 */
export async function loadGuideStatus(shop, { admin = null, full = true, sources = {} } = {}) {
  const src = buildSources(shop, admin, sources);
  // Rows the card switches read, remembered so "existing" needs no second query.
  const rowsSeen = {};
  const watchQuery = async (sql, params) => {
    const row = await src.query(sql, params);
    if (sql.includes('fbt_widget_settings')) rowsSeen.fbt = row != null;
    if (sql.includes('coupon_slider_settings')) rowsSeen.coupon = row != null;
    return row;
  };
  const moduleStatusPromise = loadModuleStatus(shop, {
    cartRecord: () => src.cartRecord(),
    codSettings: async () => (await src.codState())?.settings,
    activePacks: src.activePacks,
    query: watchQuery,
  });

  const configuredPromise = full
    ? Promise.all(GUIDE_MODULE_IDS.map((id) => settle(CONFIGURED[id](shop, src)).then((v) => [id, typeof v === 'boolean' ? v : null])))
    : Promise.resolve(null);
  const discountsPromise = full ? settle(src.discounts()) : Promise.resolve(null);

  const [moduleStatus, configuredList, discounts, cartRecord, codState] = await Promise.all([
    moduleStatusPromise,
    configuredPromise,
    discountsPromise,
    settle(src.cartRecord()),
    settle(src.codState()),
  ]);

  const existing = Boolean(
    cartRecord || codState?.saved || moduleStatus.combo || moduleStatus.packs || rowsSeen.fbt || rowsSeen.coupon,
  );

  let modules = null;
  if (configuredList) {
    const configured = Object.fromEntries(configuredList);
    const active = {
      ...moduleStatus,
      discounts: discounts ? discounts.live : null,
      brix_ai: null,
    };
    modules = Object.fromEntries(GUIDE_MODULE_IDS.map((id) => [id, {
      configured: configured[id],
      active: typeof active[id] === 'boolean' ? active[id] : null,
    }]));
  }
  return { moduleStatus, existing, modules };
}
