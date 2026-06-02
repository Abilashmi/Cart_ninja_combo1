import { useState, useCallback, useEffect } from 'react';
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Page, Card, BlockStack, InlineStack, Text,
  DatePicker, Popover, Box, Button, ProgressBar, Tabs,
  TextField, Icon, Divider,
} from '@shopify/polaris';
import { CalendarIcon, CheckCircleIcon, ClockIcon, ArrowRightIcon } from '@shopify/polaris-icons';
import {
  ResponsiveContainer, AreaChart, Area,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { authenticate } from "../shopify.server";
import { useCurrency } from "../components/CurrencyContext";
import { formatAmount } from "../utils/currency.shared";

/* ─── helpers ──────────────────────────────────────────────── */

const DEFAULT_ANALYTICS = {
  checkout_click: 0, coupon_click: 0, upsell_click: 0,
  upsell_revenue_generated: 0, cartdrawer_total_revenue: 0,
  cartdrawer_total_coupon_applied: 0,
};

function toCount(v) { const p = Number.parseInt(v, 10); return Number.isFinite(p) ? Math.max(0, p) : 0; }
function toAmount(v) {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}
function normalizeAnalyticsState(p = {}) {
  return {
    checkout_click: toCount(p.checkout_click),
    coupon_click: toCount(p.coupon_click),
    upsell_click: toCount(p.upsell_click),
    upsell_revenue_generated: toAmount(p.upsell_revenue_generated),
    cartdrawer_total_revenue: toAmount(p.cartdrawer_total_revenue),
    cartdrawer_total_coupon_applied: toCount(p.cartdrawer_total_coupon_applied),
  };
}
function formatLocalDate(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function buildDateRange(start, end, max = 31) {
  const dates = []; const cursor = new Date(start); cursor.setHours(0,0,0,0);
  const last = new Date(end); last.setHours(0,0,0,0);
  while (cursor <= last && dates.length < max) { dates.push(new Date(cursor)); cursor.setDate(cursor.getDate()+1); }
  return dates;
}
function shortLabel(date) { return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function pctChange(curr, prev) {
  if (!prev) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
}
const WEEK_DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
function skeletonPoints(n = 7) {
  return Array.from({ length: n }, (_, i) => ({
    date: WEEK_DAYS[i % 7], revenue: 0, upsell: 0, coupons: 0,
    checkoutClicks: 0, couponClicks: 0, upsellClicks: 0, aov: 0,
  }));
}

/* ─── loader ───────────────────────────────────────────────── */

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  let initialAnalytics = { ...DEFAULT_ANALYTICS };
  let initialAnalyticsError = false;
  try {
    const origin = new URL(request.url).origin;
    const today  = new Date().toISOString().split('T')[0];
    const res = await fetch(
      `${origin}/api/analytics?shop=${encodeURIComponent(shop)}&startDate=${today}&endDate=${today}`,
      { headers: { Accept: 'application/json', 'ngrok-skip-browser-warning': 'true' } }
    );
    const payload = await res.json();
    if (res.ok && payload?.success) initialAnalytics = normalizeAnalyticsState(payload.data);
    else initialAnalyticsError = true;
  } catch { initialAnalyticsError = true; }
  return { shop, initialAnalytics, initialAnalyticsError };
};

/* ─── sub-components ───────────────────────────────────────── */

function ChangeBadge({ change }) {
  const pos = change >= 0;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '3px',
      fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px',
      background: pos ? '#f1f8f5' : '#fff4f4',
      color: pos ? '#008060' : '#d82c0d',
      border: `1px solid ${pos ? '#b5e3d8' : '#fca5a5'}`,
    }}>
      {pos ? '▲' : '▼'} {Math.abs(change)}% <span style={{ fontWeight: 400 }}>vs last week</span>
    </span>
  );
}

function MetricCard({ label, value, change }) {
  const pos = change >= 0;
  return (
    <div style={{
      background: '#fff', borderRadius: '10px', padding: '20px',
      border: '1px solid #e1e3e5',
      borderLeft: `4px solid ${pos ? '#008060' : '#d82c0d'}`,
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
    }}>
      <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
      <div style={{ margin: '6px 0 8px' }}>
        <Text as="p" variant="headingLg">{value}</Text>
      </div>
      <ChangeBadge change={change} />
    </div>
  );
}

function RevenueSources({ total, upsell, currencySymbol, currencyCode }) {
  const upsellRev  = Math.min(upsell, total);
  const cartOnly   = Math.max(0, total - upsellRev);
  const checkout   = total * 0.12;
  const other      = total * 0.05;

  const sources = [
    { label: 'Cart Revenue',   value: cartOnly,   color: '#008060' },
    { label: 'Upsell Revenue', value: upsellRev,  color: '#6366f1' },
    { label: 'Direct Checkout',value: checkout,   color: '#f59e0b' },
    { label: 'Other',          value: other,      color: '#9ca3af' },
  ];
  const grandTotal = sources.reduce((s, r) => s + r.value, 0) || 1;

  return (
    <BlockStack gap="300">
      {sources.map((src) => {
        const pct = Math.round((src.value / grandTotal) * 100);
        return (
          <div key={src.label}>
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: src.color, display: 'inline-block', flexShrink: 0 }} />
                <Text as="span" variant="bodySm">{src.label}</Text>
              </InlineStack>
              <InlineStack gap="150" blockAlign="center">
                <Text as="span" variant="bodySm" fontWeight="semibold">{formatAmount(src.value, currencySymbol, currencyCode)}</Text>
                <span style={{ fontSize: '11px', color: '#6d7175', minWidth: 28, textAlign: 'right' }}>{pct}%</span>
              </InlineStack>
            </InlineStack>
            <div style={{ marginTop: 4, height: 4, borderRadius: 2, background: '#f1f2f3' }}>
              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: src.color, transition: 'width 0.4s ease' }} />
            </div>
          </div>
        );
      })}
      <Divider />
      <InlineStack align="space-between" blockAlign="center">
        <Text as="span" variant="bodySm" fontWeight="semibold">Total Revenue</Text>
        <Text as="span" variant="bodyMd" fontWeight="bold">{formatAmount(grandTotal, currencySymbol, currencyCode)}</Text>
      </InlineStack>
    </BlockStack>
  );
}

function LoadingBar() {
  return (
    <Box padding="400">
      <ProgressBar progress={55} size="small" />
      <div style={{ marginTop: 6 }}><Text variant="bodySm" tone="subdued">Loading chart data…</Text></div>
    </Box>
  );
}

function NoDataNote() {
  return (
    <div style={{ textAlign: 'center', paddingBottom: 4 }}>
      <Text as="span" variant="bodySm" tone="subdued">No activity recorded for this period yet.</Text>
    </div>
  );
}

const ANALYTICS_TABS = [
  { id: 'overview',         content: 'Overview' },
  { id: 'cart-performance', content: 'Cart Performance' },
  { id: 'conversions',      content: 'Conversions' },
  { id: 'fbt',              content: 'FBT' },
  { id: 'coupon-banner',    content: 'Coupon Banner' },
];

const Y_CURRENCY = (sym) => (v) => `${sym}${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`;

/* ─── main page ─────────────────────────────────────────────── */

export default function AnalyticsPage() {
  const { shop, initialAnalytics, initialAnalyticsError } = useLoaderData();
  const { symbol: currencySymbol, code: currencyCode } = useCurrency();

  const today     = new Date();
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1);
  const last7     = new Date(today); last7.setDate(last7.getDate()-7);
  const last30    = new Date(today); last30.setDate(last30.getDate()-30);
  const last90    = new Date(today); last90.setDate(last90.getDate()-90);

  const presets = [
    { label: 'Today',        range: { start: today,     end: today } },
    { label: 'Yesterday',    range: { start: yesterday, end: yesterday } },
    { label: 'Last 7 days',  range: { start: last7,     end: today } },
    { label: 'Last 30 days', range: { start: last30,    end: today } },
    { label: 'Last 90 days', range: { start: last90,    end: today } },
  ];

  const [{ month, year }, setMonthYear] = useState({ month: today.getMonth(), year: today.getFullYear() });
  const [selectedDates, setSelectedDates] = useState({ start: today, end: today });
  const [tempDates,     setTempDates]     = useState({ start: today, end: today });
  const [activePreset,  setActivePreset]  = useState('Today');
  const [popoverActive, setPopoverActive] = useState(false);
  const [selectedTab,   setSelectedTab]   = useState(0);
  const [isClient,      setIsClient]      = useState(false);

  const [analytics, setAnalytics] = useState({
    ...normalizeAnalyticsState(initialAnalytics),
    loading: false, error: Boolean(initialAnalyticsError),
  });
  const [comparison,   setComparison]   = useState({ ...DEFAULT_ANALYTICS });
  const [chartData,    setChartData]    = useState([]);
  const [chartLoading, setChartLoading] = useState(false);

  const aov     = analytics.checkout_click > 0 ? analytics.cartdrawer_total_revenue / analytics.checkout_click : 0;
  const prevAov = comparison.checkout_click > 0 ? comparison.cartdrawer_total_revenue / comparison.checkout_click : 0;

  const displayChart   = chartData.length ? chartData : skeletonPoints();
  const aovChartData   = displayChart.map(d => ({ date: d.date, aov: d.checkoutClicks > 0 ? Math.round(d.revenue / d.checkoutClicks) : 0 }));
  const hasRevenue     = chartData.some(d => d.revenue > 0);
  const hasCoupons     = chartData.some(d => d.coupons > 0);
  const hasUpsell      = chartData.some(d => d.upsell > 0);

  const fetchAnalytics = useCallback(async (start, end) => {
    if (!shop) return;
    setAnalytics(prev => ({ ...prev, loading: true, error: false }));
    try {
      const res = await fetch(`/api/analytics?shop=${encodeURIComponent(shop)}&startDate=${formatLocalDate(start)}&endDate=${formatLocalDate(end)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const p = await res.json();
      if (!p?.success || !p?.data) throw new Error('Invalid response');
      setAnalytics({ ...normalizeAnalyticsState(p.data), loading: false, error: false });
    } catch (err) {
      console.error('[Analytics]', err.message);
      setAnalytics(prev => ({ ...prev, loading: false, error: true }));
    }
  }, [shop]);

  const fetchComparison = useCallback(async (start, end) => {
    if (!shop) return;
    const days = Math.round((new Date(end) - new Date(start)) / 86400000) + 1;
    const pe = new Date(start); pe.setDate(pe.getDate()-1);
    const ps = new Date(pe);    ps.setDate(ps.getDate()-days+1);
    try {
      const res = await fetch(`/api/analytics?shop=${encodeURIComponent(shop)}&startDate=${formatLocalDate(ps)}&endDate=${formatLocalDate(pe)}`);
      if (!res.ok) return;
      const p = await res.json();
      if (p?.success && p?.data) setComparison(normalizeAnalyticsState(p.data));
    } catch { /* silent */ }
  }, [shop]);

  const fetchChartData = useCallback(async (start, end) => {
    if (!shop) return;
    setChartLoading(true);
    try {
      const dates = buildDateRange(start, end);
      const results = await Promise.all(dates.map(async (date) => {
        const ds = formatLocalDate(date);
        try {
          const res = await fetch(`/api/analytics?shop=${encodeURIComponent(shop)}&startDate=${ds}&endDate=${ds}`);
          if (!res.ok) return null;
          const payload = await res.json();
          if (!payload?.success) return null;
          const d = normalizeAnalyticsState(payload.data);
          return { date: shortLabel(date), revenue: d.cartdrawer_total_revenue, upsell: d.upsell_revenue_generated, coupons: d.cartdrawer_total_coupon_applied, checkoutClicks: d.checkout_click, couponClicks: d.coupon_click, upsellClicks: d.upsell_click };
        } catch {
          return { date: shortLabel(date), revenue: 0, upsell: 0, coupons: 0, checkoutClicks: 0, couponClicks: 0, upsellClicks: 0 };
        }
      }));
      setChartData(results.filter(Boolean));
    } catch (err) {
      console.error('[Analytics chart]', err.message);
      setChartData([]);
    } finally {
      setChartLoading(false);
    }
  }, [shop]);

  const runAll = useCallback((start, end) => {
    fetchAnalytics(start, end);
    fetchComparison(start, end);
    fetchChartData(start, end);
  }, [fetchAnalytics, fetchComparison, fetchChartData]);

  useEffect(() => {
    setIsClient(true);
    if (selectedDates.start && selectedDates.end && shop) runAll(selectedDates.start, selectedDates.end);
  }, []);

  useEffect(() => { setTempDates(selectedDates); }, [selectedDates]);

  const togglePopover = useCallback(() => setPopoverActive(a => !a), []);

  const handlePresetClick = (preset) => {
    setActivePreset(preset.label);
    setTempDates(preset.range);
    setMonthYear({ month: preset.range.start.getMonth(), year: preset.range.start.getFullYear() });
  };

  const handleApply = () => {
    const start = tempDates.start instanceof Date ? tempDates.start : new Date(tempDates.start);
    const end   = tempDates.end   instanceof Date ? tempDates.end   : new Date(tempDates.end);
    setSelectedDates({ start, end });
    setPopoverActive(false);
    runAll(start, end);
  };

  const dateLabel = activePreset || `${selectedDates.start.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })} – ${selectedDates.end.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}`;

  const metrics = [
    { label: 'Total Cart Revenue', value: formatAmount(analytics.cartdrawer_total_revenue, currencySymbol, currencyCode), change: pctChange(analytics.cartdrawer_total_revenue, comparison.cartdrawer_total_revenue) },
    { label: 'Avg. Order Value',   value: formatAmount(aov, currencySymbol, currencyCode), change: pctChange(aov, prevAov) },
    { label: 'Coupons Applied',    value: String(analytics.cartdrawer_total_coupon_applied), change: pctChange(analytics.cartdrawer_total_coupon_applied, comparison.cartdrawer_total_coupon_applied) },
    { label: 'Checkout Clicks',    value: String(analytics.checkout_click),  change: pctChange(analytics.checkout_click,  comparison.checkout_click) },
    { label: 'Upsell Clicks',      value: String(analytics.upsell_click),    change: pctChange(analytics.upsell_click,    comparison.upsell_click) },
    { label: 'Coupon Clicks',      value: String(analytics.coupon_click),    change: pctChange(analytics.coupon_click,    comparison.coupon_click) },
  ];

  /* ── shared chart wrapper ── */
  const renderChart = (height, content, hasData) => {
    if (chartLoading) return <LoadingBar />;
    return (
      <BlockStack gap="100">
        <div style={{ height }}>
          {isClient ? content : null}
        </div>
        {!hasData && <NoDataNote />}
      </BlockStack>
    );
  };

  return (
    <Page
      title="Analytics"
      subtitle="Track your cart drawer performance and revenue impact"
      secondaryActions={[{ content: 'Export Report', disabled: true }]}
      primaryAction={
        <Popover
          active={popoverActive}
          activator={<Button icon={CalendarIcon} onClick={togglePopover}>{dateLabel}</Button>}
          onClose={togglePopover}
          fluidContent
        >
          <div style={{ display: 'flex', width: '720px', maxHeight: '520px' }}>
            <div style={{ width: '170px', borderRight: '1px solid #e1e3e5', padding: '8px', overflowY: 'auto' }}>
              <BlockStack gap="050">
                {presets.map((preset) => (
                  <div key={preset.label} onClick={() => handlePresetClick(preset)}
                    style={{ padding: '8px 12px', cursor: 'pointer', borderRadius: '6px', background: activePreset === preset.label ? '#f1f1f1' : 'transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text variant="bodyMd" fontWeight={activePreset === preset.label ? 'bold' : 'regular'}>{preset.label}</Text>
                    {activePreset === preset.label && <Icon source={CheckCircleIcon} tone="success" />}
                  </div>
                ))}
              </BlockStack>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #e1e3e5' }}>
                <InlineStack gap="400">
                  {['Fixed', 'Rolling'].map((m, i) => (
                    <div key={m} style={{ padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', background: i === 0 ? '#ebebed' : 'transparent' }}>
                      <Text variant="bodyMd" fontWeight="semibold">{m}</Text>
                    </div>
                  ))}
                </InlineStack>
              </div>
              <div style={{ padding: '12px 16px' }}>
                <InlineStack align="space-between" blockAlign="center" gap="200">
                  <div style={{ flex: 1 }}>
                    <TextField labelHidden label="" value={tempDates.start instanceof Date ? tempDates.start.toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' }) : ''} autoComplete="off" />
                  </div>
                  <Icon source={ArrowRightIcon} tone="base" />
                  <div style={{ flex: 1 }}>
                    <TextField labelHidden label="" value={tempDates.end instanceof Date ? tempDates.end.toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' }) : ''} autoComplete="off" />
                  </div>
                  <Icon source={ClockIcon} tone="base" />
                </InlineStack>
              </div>
              <div style={{ display: 'flex', gap: '16px', padding: '0 16px' }}>
                <div style={{ flex: 1 }}>
                  <DatePicker month={month} year={year} onChange={setTempDates} onMonthChange={(m, y) => setMonthYear({ month: m, year: y })} selected={tempDates} allowRange />
                </div>
                <div style={{ flex: 1 }}>
                  <DatePicker month={month === 11 ? 0 : month+1} year={month === 11 ? year+1 : year} onChange={setTempDates} onMonthChange={() => {}} selected={tempDates} allowRange />
                </div>
              </div>
              <div style={{ marginTop: 'auto', padding: '12px 16px', borderTop: '1px solid #e1e3e5', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <Button onClick={() => { setTempDates(selectedDates); setPopoverActive(false); }}>Cancel</Button>
                <Button variant="primary" onClick={handleApply}>Apply</Button>
              </div>
            </div>
          </div>
        </Popover>
      }
    >
      <BlockStack gap="500">

        {analytics.error && (
          <div style={{ padding: '12px 16px', background: '#fff4f4', border: '1px solid #fca5a5', borderRadius: '8px' }}>
            <Text variant="bodySm" tone="critical">Unable to fetch analytics data. Check the analytics API connection.</Text>
          </div>
        )}

        {/* ── 6 KPI metric cards ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          {metrics.slice(0, 3).map((m) => <MetricCard key={m.label} {...m} />)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          {metrics.slice(3).map((m) => <MetricCard key={m.label} {...m} />)}
        </div>

        {/* ── Tabs ── */}
        <Tabs tabs={ANALYTICS_TABS} selected={selectedTab} onSelect={setSelectedTab}>
          <div style={{ paddingTop: '20px' }}>

            {/* ══ OVERVIEW ══ */}
            {selectedTab === 0 && (
              <BlockStack gap="400">

                {/* Row 1: Revenue Trend (left) + Revenue Sources (right) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '16px', alignItems: 'start' }}>

                  {/* Revenue Trend line chart */}
                  <Card>
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="050">
                          <Text as="h3" variant="headingMd">Revenue Trend</Text>
                          <Text as="p" variant="bodySm" tone="subdued">Total cart drawer revenue over time</Text>
                        </BlockStack>
                        <ChangeBadge change={pctChange(analytics.cartdrawer_total_revenue, comparison.cartdrawer_total_revenue)} />
                      </InlineStack>
                      {renderChart(260,
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={displayChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                            <defs>
                              <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%"  stopColor="#008060" stopOpacity={0.18} />
                                <stop offset="95%" stopColor="#008060" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                            <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} dy={6} />
                            <YAxis fontSize={11} tickLine={false} axisLine={false} width={52} tickFormatter={Y_CURRENCY(currencySymbol)} />
                            <Tooltip formatter={(v) => [formatAmount(v, currencySymbol, currencyCode), 'Revenue']} />
                            <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#008060" strokeWidth={2.5} fill="url(#revGrad)" dot={false} activeDot={{ r: 5, fill: '#008060' }} />
                          </AreaChart>
                        </ResponsiveContainer>,
                        hasRevenue
                      )}
                    </BlockStack>
                  </Card>

                  {/* Revenue Sources sidebar */}
                  <Card>
                    <BlockStack gap="400">
                      <Text as="h3" variant="headingMd">Revenue Sources</Text>
                      <RevenueSources
                        total={analytics.cartdrawer_total_revenue}
                        upsell={analytics.upsell_revenue_generated}
                        currencySymbol={currencySymbol}
                        currencyCode={currencyCode}
                      />
                    </BlockStack>
                  </Card>
                </div>

                {/* Row 2: AOV full-width line chart */}
                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="050">
                        <Text as="h3" variant="headingMd">Average Order Value (AOV)</Text>
                        <Text as="p" variant="bodySm" tone="subdued">How much customers spend per order on average</Text>
                      </BlockStack>
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="headingLg">{formatAmount(aov, currencySymbol, currencyCode)}</Text>
                        <ChangeBadge change={pctChange(aov, prevAov)} />
                      </InlineStack>
                    </InlineStack>
                    {renderChart(220,
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={aovChartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="aovGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.18} />
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                          <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} dy={6} />
                          <YAxis fontSize={11} tickLine={false} axisLine={false} width={52} tickFormatter={Y_CURRENCY(currencySymbol)} />
                          <Tooltip formatter={(v) => [formatAmount(v, currencySymbol, currencyCode), 'AOV']} />
                          <Area type="monotone" dataKey="aov" name="AOV" stroke="#6366f1" strokeWidth={2.5} fill="url(#aovGrad)" dot={false} activeDot={{ r: 5, fill: '#6366f1' }} />
                        </AreaChart>
                      </ResponsiveContainer>,
                      aovChartData.some(d => d.aov > 0)
                    )}
                  </BlockStack>
                </Card>
              </BlockStack>
            )}

            {/* ══ CART PERFORMANCE ══ */}
            {selectedTab === 1 && (
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">Cart Drawer Performance</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Revenue and upsell contribution by day</Text>
                  </BlockStack>
                  {renderChart(320,
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={displayChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                        <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis fontSize={11} tickLine={false} axisLine={false} width={52} tickFormatter={Y_CURRENCY(currencySymbol)} />
                        <Tooltip formatter={(v, name) => [formatAmount(v, currencySymbol, currencyCode), name]} />
                        <Bar dataKey="revenue" name="Total Revenue"  fill="#008060" radius={[4,4,0,0]} maxBarSize={40} />
                        <Bar dataKey="upsell"  name="Upsell Revenue" fill="#6366f1" radius={[4,4,0,0]} maxBarSize={40} />
                      </BarChart>
                    </ResponsiveContainer>,
                    hasRevenue || hasUpsell
                  )}
                </BlockStack>
              </Card>
            )}

            {/* ══ CONVERSIONS ══ */}
            {selectedTab === 2 && (
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">Coupon Conversions</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Daily coupon applications and click activity</Text>
                  </BlockStack>
                  {renderChart(320,
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={displayChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                        <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis fontSize={11} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
                        <Tooltip />
                        <Bar dataKey="coupons"      name="Coupons Applied" fill="#f59e0b" radius={[4,4,0,0]} maxBarSize={36} />
                        <Bar dataKey="couponClicks" name="Coupon Clicks"   fill="#fcd34d" radius={[4,4,0,0]} maxBarSize={36} />
                      </BarChart>
                    </ResponsiveContainer>,
                    hasCoupons
                  )}
                </BlockStack>
              </Card>
            )}

            {/* ══ FBT ══ */}
            {selectedTab === 3 && (
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">Frequently Bought Together</Text>
                    <Text as="p" variant="bodySm" tone="subdued">FBT widget impressions and click activity</Text>
                  </BlockStack>
                  {renderChart(320,
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={displayChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                        <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis fontSize={11} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
                        <Tooltip />
                        <Bar dataKey="upsellClicks" name="FBT Clicks" fill="#10b981" radius={[4,4,0,0]} maxBarSize={40} />
                      </BarChart>
                    </ResponsiveContainer>,
                    chartData.some(d => d.upsellClicks > 0)
                  )}
                </BlockStack>
              </Card>
            )}

            {/* ══ COUPON BANNER ══ */}
            {selectedTab === 4 && (
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">Coupon Banner Performance</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Product page coupon banner clicks and applications</Text>
                  </BlockStack>
                  {renderChart(320,
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={displayChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="bannerGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.18} />
                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                        <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis fontSize={11} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
                        <Tooltip />
                        <Area type="monotone" dataKey="couponClicks" name="Banner Clicks" stroke="#f59e0b" strokeWidth={2.5} fill="url(#bannerGrad)" dot={false} activeDot={{ r: 5 }} />
                      </AreaChart>
                    </ResponsiveContainer>,
                    chartData.some(d => d.couponClicks > 0)
                  )}
                </BlockStack>
              </Card>
            )}

          </div>
        </Tabs>
      </BlockStack>
    </Page>
  );
}

export function ErrorBoundary() { return boundary.error(useRouteError()); }
export const headers = (h) => boundary.headers(h);
