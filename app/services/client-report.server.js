// Loads a client report's data (Internal → Reports): the store's orders from
// Shopify with its stored offline token, and combo page views / button
// presses from combo_analytics. The numbers are worked out by
// utils/client-report.js.
import sessionDb from '../session-db.server';
import { unauthenticated } from '../shopify.server';
import { getDb } from './db.server';
import { addDays, buildClientReport, classifyOrder, localDay, resolveRange, zoneOffsetMinutes } from '../utils/client-report.js';

const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const MAX_ORDER_PAGES = 60; // 15,000 orders
const NAME_CACHE_MS = 6 * 60 * 60 * 1000;

let nameCache = { at: 0, shops: null };

async function shopInfo(shop) {
  const { admin } = await unauthenticated.admin(shop);
  const res = await admin.graphql(`#graphql
    query { shop { name ianaTimezone currencyCode primaryDomain { host } } }`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data.shop;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

/**
 * Stores BRIX holds a working offline token for, named by Shopify:
 * [{ shop, name, host }], sorted by name. Stores whose token no longer works
 * (uninstalled) are left out. Cached for 6 hours; `fresh` skips the cache.
 */
export async function listReportShops({ fresh = false } = {}) {
  if (!fresh && nameCache.shops && Date.now() - nameCache.at < NAME_CACHE_MS) return nameCache.shops;
  const rows = await sessionDb.session.findMany({ where: { isOnline: false }, select: { shop: true } });
  const shops = [...new Set(rows.map((r) => r.shop).filter((s) => SHOP_DOMAIN.test(s)))];
  const named = await mapLimit(shops, 8, async (shop) => {
    try {
      const info = await shopInfo(shop);
      return { shop, name: info.name || shop, host: info.primaryDomain?.host || shop };
    } catch {
      return null;
    }
  });
  const list = named.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  nameCache = { at: Date.now(), shops: list };
  return list;
}

const ORDERS_QUERY = `#graphql
  query ReportOrders($query: String!, $after: String) {
    orders(first: 250, after: $after, query: $query, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name createdAt cancelledAt displayFinancialStatus tags paymentGatewayNames discountCodes
        customAttributes { key value }
        app { name }
        totalPriceSet { shopMoney { amount } }
      }
    }
  }`;

async function loadOrders(admin, from, to, timeZone) {
  // Shopify reads these dates in the store's zone; a day either side, then
  // each order is placed on its own local day.
  const query = `created_at:>=${addDays(from, -1)} created_at:<=${addDays(to, 1)}`;
  const orders = [];
  let after = null;
  for (let page = 0; page < MAX_ORDER_PAGES; page++) {
    const res = await admin.graphql(ORDERS_QUERY, { variables: { query, after } });
    const json = await res.json();
    if (json.errors?.length) throw new Error(`Shopify orders: ${json.errors[0].message}`);
    const conn = json.data.orders;
    for (const node of conn.nodes) orders.push(classifyOrder(node, timeZone));
    if (!conn.pageInfo.hasNextPage) return orders;
    after = conn.pageInfo.endCursor;
  }
  throw new Error('This store has too many orders in that period. Pick fewer days.');
}

const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

async function loadCombo(shop, from, to, timeZone) {
  const db = getDb();
  // recorded_at is UTC; shift by the store's offset so days match the orders.
  const offset = zoneOffsetMinutes(Date.parse(`${to}T12:00:00Z`), timeZone);
  const start = Date.parse(`${from}T00:00:00Z`) - offset * 60000;
  const end = Date.parse(`${addDays(to, 1)}T00:00:00Z`) - offset * 60000;
  const [[events], [pages]] = await Promise.all([
    db.execute(
      `SELECT DATE(DATE_ADD(recorded_at, INTERVAL ${Number(offset)} MINUTE)) AS d, template_id, event_type, COUNT(*) AS n
       FROM combo_analytics
       WHERE shop_domain = ? AND event_type IN ('view', 'click') AND recorded_at >= ? AND recorded_at < ?
       GROUP BY d, template_id, event_type`,
      [shop, sqlTime(start), sqlTime(end)],
    ),
    db.execute('SELECT id, name FROM combo_templates WHERE shop_domain = ?', [shop]),
  ]);
  const byKey = new Map();
  for (const e of events || []) {
    const day = String(e.d).slice(0, 10);
    const key = `${day}|${e.template_id}`;
    const row = byKey.get(key) || { day, templateId: e.template_id == null ? 'unknown' : String(e.template_id), views: 0, presses: 0 };
    if (e.event_type === 'view') row.views += Number(e.n) || 0;
    else row.presses += Number(e.n) || 0;
    byKey.set(key, row);
  }
  return { comboEvents: [...byKey.values()], comboPages: (pages || []).map((p) => ({ id: String(p.id), name: p.name })) };
}

/**
 * Builds the report for one store. Returns { report } or { error } (a
 * message for the person asking; nothing about tokens or internals).
 */
export async function loadClientReport({ shop, from, to, now = Date.now() }) {
  if (!SHOP_DOMAIN.test(String(shop || ''))) return { error: 'Pick a store.' };
  const known = await sessionDb.session.findFirst({ where: { shop, isOnline: false }, select: { shop: true } });
  if (!known) return { error: 'BRIX has no access to that store.' };

  let admin, info;
  try {
    ({ admin } = await unauthenticated.admin(shop));
    info = await shopInfo(shop);
  } catch {
    return { error: 'Shopify refused BRIX\'s access to that store. It may have uninstalled the app.' };
  }
  const timeZone = info.ianaTimezone || 'UTC';
  const today = localDay(now, timeZone);
  const range = resolveRange(from, to, today);
  if (range.error) return { error: range.error };

  const [orders, combo] = await Promise.all([
    loadOrders(admin, range.previousAvailable ? range.prevFrom : range.from, range.to, timeZone),
    loadCombo(shop, range.from, range.to, timeZone),
  ]);
  return {
    report: buildClientReport({
      shop, shopName: info.name, currency: info.currencyCode, timeZone, range, today,
      generatedAt: new Date(now).toISOString(), orders, ...combo,
    }),
  };
}
