/**
 * Frequently Bought Together v2 — where the settings live and the
 * operations on them (admin page app.fbt.jsx, BrixBar's FBT tools).
 *
 * Stored as JSON in fbt_widget.config_v2 (self-healing column). The
 * storefront reads it through php_backend/save_fbt_widget.php's GET, which
 * returns every fbt_widget column, so no PHP change is needed. A shop that
 * never saved v2 still has its pre-v2 rules + template (fbt_widget.condition
 * / temp1..3): loadFbtV2 converts those with fromLegacy, the same way the
 * storefront does, so nothing changes until the merchant saves.
 *
 * The on/off switch stays fbt_widget_settings.is_enabled — that is what the
 * PHP endpoint reads for the storefront (with plan gating).
 */
import { getDb } from './db.server';
import { normalizeConfig, fromLegacy, numericId } from '../utils/fbt-core.shared.js';

let columnReady = false;

async function ensureConfigColumn(db) {
  if (columnReady) return;
  const [rows] = await db.execute(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fbt_widget' AND COLUMN_NAME = 'config_v2'",
  );
  if (!rows?.length) await db.execute('ALTER TABLE fbt_widget ADD COLUMN config_v2 MEDIUMTEXT NULL');
  columnReady = true;
}

function parse(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

/**
 * { config, saved, enabled } — saved: the shop has a v2 config (else it is
 * converted from the pre-v2 settings, or the defaults).
 */
export async function loadFbtV2(shop) {
  const db = getDb();
  await ensureConfigColumn(db);
  const [[rows], [settings]] = await Promise.all([
    db.execute('SELECT * FROM fbt_widget WHERE shopDomain = ? LIMIT 1', [shop]),
    db.execute('SELECT is_enabled, widget_placement FROM fbt_widget_settings WHERE shop_domain = ? LIMIT 1', [shop]),
  ]);
  const row = rows?.[0] || null;
  const enabled = settings?.[0] ? Boolean(Number(settings[0].is_enabled)) : Boolean(row);
  const v2 = parse(row?.config_v2);
  if (v2) return { config: normalizeConfig(v2), saved: true, enabled };
  if (!row) return { config: normalizeConfig({}), saved: false, enabled: false };
  const slot = { fbt1: 'temp1', fbt2: 'temp2', fbt3: 'temp3' }[row.selectedTemp] || 'temp1';
  const tpl = parse(row[slot]) || {};
  if (!tpl.widgetPlacement && settings?.[0]?.widget_placement) tpl.widgetPlacement = settings[0].widget_placement;
  return { config: fromLegacy(parse(row.condition) || [], tpl, row.ai_product_count ?? row.aiProductCount), saved: false, enabled };
}

/**
 * Save the merchant's config. Automatic pairs are computed by the server
 * (buildFbtPairs), so unless `pairs` is passed they are kept as stored.
 * `enabled` (optional) is written to fbt_widget_settings.is_enabled.
 */
export async function saveFbtV2(shop, patch, { enabled, pairs } = {}) {
  const db = getDb();
  const current = await loadFbtV2(shop);
  const next = normalizeConfig({
    ...current.config,
    ...(patch || {}),
    pairs: pairs !== undefined ? pairs : current.config.pairs,
    pairsUpdatedAt: pairs !== undefined ? new Date().toISOString() : current.config.pairsUpdatedAt,
  });
  await db.execute(
    `INSERT INTO fbt_widget (shopDomain, config_v2, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE config_v2 = VALUES(config_v2), updated_at = CURRENT_TIMESTAMP(3)`,
    [shop, JSON.stringify(next)],
  );
  const on = enabled === undefined ? current.enabled : Boolean(enabled);
  await db.execute(
    `INSERT INTO fbt_widget_settings (shop_domain, is_enabled, widget_placement) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), widget_placement = VALUES(widget_placement), updated_at = CURRENT_TIMESTAMP(3)`,
    [shop, on ? 1 : 0, next.placement === 'custom' ? 'custom' : next.placement],
  );
  return { config: next, enabled: on };
}

/* ── BrixBar's FBT tools (create / update / remove / list rules) ─────────── */

// The shape the agent tools were written against (one row of the old
// fbt_rules table): { id, name, trigger_scope, trigger_products,
// trigger_collections, fbt_products }.
function toToolRule(rule) {
  return {
    id: rule.id,
    name: rule.name || null,
    trigger_scope: rule.when.type === 'products' ? 'specific_products' : rule.when.type === 'collections' ? 'specific_collections' : 'all',
    trigger_products: rule.when.products,
    trigger_collections: rule.when.collections,
    fbt_products: rule.show.type === 'products' ? rule.show.products : [],
    show_collection: rule.show.collection,
    enabled: rule.enabled,
  };
}

const productRef = (p) => ({ id: numericId(p?.id), handle: p?.handle || '', title: p?.title || '', ...(p?.image ? { image: p.image } : {}) });

export async function listFbtRulesV2(shop) {
  const { config } = await loadFbtV2(shop);
  return config.rules.filter((r) => r.enabled).map(toToolRule);
}

export async function fetchFbtRuleV2(shop, ruleId) {
  const { config } = await loadFbtV2(shop);
  const rule = config.rules.find((r) => r.id === String(ruleId));
  return rule ? toToolRule(rule) : null;
}

/** Adds a rule (and turns FBT on, like the old tool did). triggerProducts empty = every product page. */
export async function appendFbtRuleV2(shop, { name, triggerProducts = [], offerProducts = [] }) {
  const { config } = await loadFbtV2(shop);
  const id = `a${Date.now().toString(36)}`;
  const rules = [...config.rules, {
    id,
    name: name || '',
    when: triggerProducts.length ? { type: 'products', products: triggerProducts.map(productRef) } : { type: 'all' },
    show: { type: 'products', products: offerProducts.map(productRef) },
  }];
  await saveFbtV2(shop, { rules }, { enabled: true });
  return { id };
}

export async function updateFbtRuleV2(shop, ruleId, { triggerProducts, offerProducts }) {
  const { config } = await loadFbtV2(shop);
  const rules = config.rules.map((r) => (r.id !== String(ruleId) ? r : {
    ...r,
    when: triggerProducts.length ? { type: 'products', products: triggerProducts.map(productRef) } : { type: 'all' },
    show: { type: 'products', products: offerProducts.map(productRef) },
  }));
  await saveFbtV2(shop, { rules });
}

export async function removeFbtRuleV2(shop, ruleId) {
  const { config } = await loadFbtV2(shop);
  const rules = config.rules.filter((r) => r.id !== String(ruleId));
  if (rules.length === config.rules.length) return { removed: false };
  await saveFbtV2(shop, { rules });
  return { removed: true };
}

/** What get_current_config shows the agent about FBT. */
export async function fbtSummaryForAgent(shop) {
  const { config, saved, enabled } = await loadFbtV2(shop);
  return {
    source: saved ? 'v2' : 'converted',
    widget: {
      enabled, style: config.style, title: config.title, placement: config.placement, maxItems: config.maxItems,
      theme: config.theme, automaticPairSources: config.sources,
      productsWithAutomaticPairs: Object.keys(config.pairs).length,
    },
    rules: config.rules.map((r) => ({
      id: r.id,
      name: r.name || null,
      enabled: r.enabled,
      showsOn: r.when.type === 'all' ? 'all product pages' : r.when.type === 'products' ? r.when.products.map((p) => p.title || p.handle) : `products in ${r.when.collections.map((c) => c.title || c.handle).join(', ')}`,
      offers: r.show.type === 'collection' ? `products from collection ${r.show.collection?.title || r.show.collection?.handle}` : r.show.products.map((p) => p.title || p.handle),
      // Kept for update_fbt_rule's complete-list semantics.
      triggerProducts: r.when.products,
      fbtProducts: r.show.products,
    })),
  };
}
