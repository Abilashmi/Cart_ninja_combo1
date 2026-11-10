// Client report (Internal → Reports): COD vs paid orders and combo pages for
// one store and date range. Pure functions only, so the numbers can be tested
// without Shopify or MySQL; client-report.server.js loads the data and
// client-report-html.js draws it.

// The app has read_orders, not read_all_orders: Shopify returns only the last
// 60 days of orders, so older days would silently come back empty.
export const ORDER_HISTORY_DAYS = 60;
export const MAX_REPORT_DAYS = 31;

export const CHANNELS = Object.freeze([
  { key: 'paid', label: 'Paid online' },
  { key: 'other_cod', label: 'Other COD' },
  { key: 'brix_cod', label: 'BRIX COD' },
]);

const COD_GATEWAY = /\b(cash on delivery|cod)\b/i;
const BOX_CODE = /^BX[A-Z0-9]{10}$/i;
const ENTRY_LABELS = { drawer: 'Cart drawer', product: 'Product page', combo: 'Combo page' };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 864e5;

export const isDay = (s) => DAY.test(String(s || '')) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

export function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The calendar day (YYYY-MM-DD) an instant falls on in the store's time zone. */
export function localDay(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(instant));
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Minutes the store's time zone is ahead of UTC at that instant (IST = 330). */
export function zoneOffsetMinutes(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(instant));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(new Date(instant).getTime() / 1000) * 1000) / 60000);
}

/**
 * Checks the requested range against what Shopify lets the app read.
 * Returns { from, to, prevFrom, prevTo, days, previousAvailable } or { error }.
 * The previous period (same length, just before) is the comparison baseline;
 * it is dropped when it reaches past the order history Shopify returns.
 */
export function resolveRange(from, to, today) {
  if (!isDay(from) || !isDay(to)) return { error: 'Pick a start and an end date.' };
  if (from > to) return { error: 'The start date is after the end date.' };
  if (to > today) return { error: 'The end date is in the future.' };
  const days = daysBetween(from, to);
  if (days > MAX_REPORT_DAYS) return { error: `Pick at most ${MAX_REPORT_DAYS} days.` };
  const oldest = addDays(today, -(ORDER_HISTORY_DAYS - 1));
  if (from < oldest) return { error: `Shopify only gives this app the last ${ORDER_HISTORY_DAYS} days of orders. Start on ${oldest} or later.` };
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(from, -days);
  return { from, to, prevFrom, prevTo, days, previousAvailable: prevFrom >= oldest };
}

/**
 * One Shopify order → what the report needs. `order` is the Admin GraphQL
 * node: name, createdAt, cancelledAt, displayFinancialStatus, tags,
 * paymentGatewayNames, discountCodes, customAttributes, app { name },
 * totalPriceSet.
 */
export function classifyOrder(order, timeZone) {
  const attrs = Object.fromEntries((order.customAttributes || []).map((a) => [a.key, a.value]));
  const tags = (order.tags || []).map((t) => String(t).toLowerCase());
  const gateways = order.paymentGatewayNames || [];
  const appName = order.app?.name || '';
  const brix = tags.includes('brix-cod') || attrs._brixCod === 'true';
  let channel;
  if (brix) channel = 'brix_cod';
  else if (gateways.some((g) => COD_GATEWAY.test(g))) channel = 'other_cod';
  else if (appName === 'Draft Orders') channel = 'staff';
  else channel = 'paid';
  const srcTag = tags.find((t) => t.startsWith('brix-src-'));
  const entryKey = attrs.brix_cod_source || (srcTag ? srcTag.slice('brix-src-'.length) : '');
  const comboId = attrs.combo_template_id || (attrs.combo_source ? 'unknown' : '');
  const boxCode = (order.discountCodes || []).some((c) => BOX_CODE.test(c));
  return {
    name: order.name,
    day: localDay(order.createdAt, timeZone),
    channel,
    viaApp: channel === 'other_cod' ? appName || 'Unknown checkout' : '',
    total: Number(order.totalPriceSet?.shopMoney?.amount) || 0,
    kept: !order.cancelledAt && order.displayFinancialStatus !== 'VOIDED',
    brixEntry: channel === 'brix_cod' ? ENTRY_LABELS[entryKey] || 'Other' : '',
    comboId: comboId || (boxCode ? 'unknown' : ''),
  };
}

function tally(orders) {
  const kept = orders.filter((o) => o.kept);
  const value = orders.reduce((s, o) => s + o.total, 0);
  return {
    orders: orders.length,
    kept: kept.length,
    cancelled: orders.length - kept.length,
    keptRate: orders.length ? kept.length / orders.length : null,
    value: Math.round(value),
    avgOrder: orders.length ? Math.round(value / orders.length) : null,
  };
}

function channelSummary(orders, days) {
  const counted = orders.filter((o) => o.channel !== 'staff');
  const row = (key, label, list) => ({ key, label, ...tally(list), share: counted.length ? list.length / counted.length : null, perDay: list.length / days });
  return [
    ...CHANNELS.map(({ key, label }) => row(key, label, counted.filter((o) => o.channel === key))),
    row('all_cod', 'All COD', counted.filter((o) => o.channel === 'brix_cod' || o.channel === 'other_cod')),
  ];
}

const countBy = (list, key) => {
  const m = new Map();
  for (const x of list) m.set(x[key], (m.get(x[key]) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
};

/**
 * Everything the report shows.
 * orders: classifyOrder() results covering prevFrom..to (others are ignored).
 * comboEvents: [{ day, templateId, views, presses }] for from..to, days in the store's zone.
 * comboPages: [{ id, name }].
 */
export function buildClientReport({ shop, shopName, currency, timeZone, range, today, generatedAt, orders, comboEvents = [], comboPages = [] }) {
  const { from, to, prevFrom, prevTo, days, previousAvailable } = range;
  const current = orders.filter((o) => o.day >= from && o.day <= to);
  const previous = previousAvailable ? orders.filter((o) => o.day >= prevFrom && o.day <= prevTo) : null;
  const counted = current.filter((o) => o.channel !== 'staff');

  const names = new Map(comboPages.map((p) => [String(p.id), p.name]));
  const comboName = (id) => (id === 'unknown' ? 'Combo page (not named)' : names.get(String(id)) || `Combo page ${id}`);
  const events = comboEvents.filter((e) => e.day >= from && e.day <= to);
  const comboOrders = counted.filter((o) => o.comboId);

  const daily = eachDay(from, to).map((day) => {
    const x = counted.filter((o) => o.day === day);
    const of = (ch) => x.filter((o) => o.channel === ch);
    const paid = of('paid'), other = of('other_cod'), brix = of('brix_cod');
    const ev = events.filter((e) => e.day === day);
    return {
      day,
      paid: paid.length,
      paidValue: Math.round(paid.reduce((s, o) => s + o.total, 0)),
      otherCod: other.length,
      otherCodCancelled: other.filter((o) => !o.kept).length,
      brixCod: brix.length,
      brixCodCancelled: brix.filter((o) => !o.kept).length,
      brixValue: Math.round(brix.reduce((s, o) => s + o.total, 0)),
      codShare: x.length ? (other.length + brix.length) / x.length : null,
      comboViews: ev.reduce((s, e) => s + e.views, 0),
      comboPresses: ev.reduce((s, e) => s + e.presses, 0),
      comboOrders: x.filter((o) => o.comboId).length,
    };
  });

  const pageIds = [...new Set([...comboPages.map((p) => String(p.id)), ...events.map((e) => String(e.templateId)), ...comboOrders.map((o) => String(o.comboId))])];
  const combo = pageIds.map((id) => {
    const ev = events.filter((e) => String(e.templateId) === id);
    const o = comboOrders.filter((x) => String(x.comboId) === id);
    return {
      id, name: comboName(id),
      views: ev.reduce((s, e) => s + e.views, 0),
      presses: ev.reduce((s, e) => s + e.presses, 0),
      paid: o.filter((x) => x.channel === 'paid').length,
      cod: o.filter((x) => x.channel !== 'paid').length,
      ...tally(o),
    };
  }).filter((p) => p.views || p.presses || p.orders).sort((a, b) => b.orders - a.orders || b.views - a.views || a.name.localeCompare(b.name));
  const comboTotal = {
    views: combo.reduce((s, p) => s + p.views, 0),
    presses: combo.reduce((s, p) => s + p.presses, 0),
    paid: combo.reduce((s, p) => s + p.paid, 0),
    cod: combo.reduce((s, p) => s + p.cod, 0),
    ...tally(comboOrders),
  };

  const brixOrders = counted.filter((o) => o.channel === 'brix_cod');
  const brixEntries = countBy(brixOrders, 'brixEntry').map(([entry]) => ({ entry, ...tally(brixOrders.filter((o) => o.brixEntry === entry)) }));
  const otherCodVia = countBy(counted.filter((o) => o.channel === 'other_cod'), 'viaApp').map(([app, n]) => ({ app, orders: n }));

  return {
    shop, shopName: shopName || shop, currency, timeZone, generatedAt, today,
    from, to, days, prevFrom, prevTo, previousAvailable,
    includesToday: to === today,
    summary: channelSummary(current, days),
    previousSummary: previous ? channelSummary(previous, days) : null,
    daily,
    brixEntries,
    otherCodVia,
    staffOrders: current.length - counted.length,
    combo,
    comboTotal,
    comboTracked: comboPages.length > 0 || events.length > 0 || comboOrders.length > 0,
  };
}
