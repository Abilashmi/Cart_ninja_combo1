// Builds the payload behind BRIX's visual sales report (the `sales_report`
// chat widget): period totals with a previous-period comparison, a daily
// series for the charts, top products and the visitor → order funnel. All
// numbers come straight from the analytics rollup tables — nothing is
// estimated or invented here.
import { getPeriodTotals, getDailyChart, getTopProducts, getFunnel } from './analytics-query.server';
import { pctChange } from '../utils/analytics.shared';
import { formatMoney } from '../utils/currency.shared';

export const REPORT_PERIODS = ['today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month', 'last_month'];

const pad = (n) => String(n).padStart(2, '0');
// Local calendar date (not toISOString, which would shift the day in any
// timezone ahead of UTC).
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };

export function resolveReportPeriod(period, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case 'today': return { key: 'today', label: 'Today', start: today, end: today };
    case 'yesterday': { const y = addDays(today, -1); return { key: 'yesterday', label: 'Yesterday', start: y, end: y }; }
    case 'last_7_days': return { key: 'last_7_days', label: 'Last 7 days', start: addDays(today, -6), end: today };
    case 'this_month': return { key: 'this_month', label: 'This month', start: new Date(today.getFullYear(), today.getMonth(), 1), end: today };
    case 'last_month': {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { key: 'last_month', label: 'Last month', start, end };
    }
    case 'last_30_days':
    default: return { key: 'last_30_days', label: 'Last 30 days', start: addDays(today, -29), end: today };
  }
}

function previousRange(start, end) {
  const days = Math.round((end - start) / 86400000) + 1;
  const prevEnd = addDays(start, -1);
  return { start: addDays(prevEnd, -(days - 1)), end: prevEnd };
}

const pickTotals = (t) => ({
  revenue: t.revenue,
  orders: t.order_count,
  aov: t.aov,
  visitors: t.visitor_count,
  conversionRate: t.conversion_rate,
  upsellRevenue: t.upsell_revenue,
});

async function safe(label, fn, fallback) {
  try { return await fn(); } catch (e) {
    console.error(`[sales-report] ${label} failed:`, e.message);
    return fallback;
  }
}

export async function buildSalesReport(shop, period, currency) {
  const range = resolveReportPeriod(period);
  const prev = previousRange(range.start, range.end);
  const [startDate, endDate] = [ymd(range.start), ymd(range.end)];
  const [prevStart, prevEnd] = [ymd(prev.start), ymd(prev.end)];

  const [totals, prevTotals, daily, topProducts, funnel] = await Promise.all([
    getPeriodTotals(shop, startDate, endDate),
    safe('previous totals', () => getPeriodTotals(shop, prevStart, prevEnd), null),
    safe('daily chart', () => getDailyChart(shop, startDate, endDate), []),
    safe('top products', () => getTopProducts(shop, startDate, endDate, 5), []),
    safe('funnel', () => getFunnel(shop, startDate, endDate), null),
  ]);

  const current = pickTotals(totals);
  const previous = prevTotals ? pickTotals(prevTotals) : null;
  const empty = current.orders === 0 && current.visitors === 0 && current.revenue === 0;

  const report = {
    period: range.key,
    label: range.label,
    startDate,
    endDate,
    currency: { code: currency.code, symbol: currency.symbol, locale: currency.locale },
    empty,
    totals: current,
    previous,
    daily: daily.map((d) => ({ date: d.date, revenue: d.revenue, orders: d.orders, aov: d.aov, visitors: d.visitors })),
    topProducts,
    funnel: funnel
      ? { visitors: funnel.visitors, carts: funnel.cart_creates, checkouts: funnel.checkout_clicks, orders: funnel.orders }
      : null,
  };

  const money = (v) => formatMoney(v, { currencyCode: currency.code, locale: currency.locale });
  let summary;
  if (empty) {
    summary = `There is no sales data recorded for ${range.label.toLowerCase()} yet.`;
  } else {
    const change = previous && previous.revenue > 0 ? pctChange(current.revenue, previous.revenue) : null;
    const changeText = change === null ? '' : ` (${change >= 0 ? 'up' : 'down'} ${Math.abs(change)}% on the previous period)`;
    summary = `Here's your sales report for ${range.label.toLowerCase()}: ${money(current.revenue)} in revenue from ${current.orders} order${current.orders === 1 ? '' : 's'}${changeText}.`;
  }

  return { report, summary };
}
