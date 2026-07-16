import { useState, useCallback, useEffect } from 'react';
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Page, Card, BlockStack, InlineStack, Text,
  DatePicker, Popover, Button,
  TextField, Icon,
} from '@shopify/polaris';
import {
  CalendarIcon, CheckCircleIcon, ClockIcon, ArrowRightIcon, InfoIcon,
  CashDollarIcon, CartIcon, RewardIcon, AlertCircleIcon, ChartVerticalIcon,
  RefreshIcon,
} from '@shopify/polaris-icons';
import {
  ResponsiveContainer, AreaChart, Area,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { authenticate } from "../shopify.server";
import { useCurrency } from "../components/CurrencyContext";
import { formatAmount } from "../utils/currency.shared";
import { FeatureHeaderBar } from "../components/feature/FeatureHeaderBar";
import { BrowserTabStrip } from "../components/feature/BrowserTabStrip";
import BrixBar from "../components/ai-agent/BrixBar";
import { usePlan, ProUpgradeBanner } from "../components/PlanContext";
import { LockedValue, LockedChartArea } from "../components/plan/PlanGate";

/* ─── helpers ─────────────────────────────────────────── */

const ZERO_TOTALS = {
  revenue: 0, order_count: 0, upsell_revenue: 0, coupon_applied_count: 0,
  checkout_click_count: 0, coupon_click_count: 0, upsell_click_count: 0,
  bundle_revenue: 0, bundle_order_count: 0, visitor_count: 0,
  cart_create_count: 0, cart_update_count: 0, aov: 0, conversion_rate: 0, checkout_rate: 0,
};

function formatLocalDate(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ─── loader (real Shopify auth only — all analytics data is fetched
   client-side from the new /api/analytics/* endpoints) ─────────────── */

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { shop: session.shop };
};

/* ─── sub-components ─────────────────────────────────── */

function ChangeBadge({ change }) {
  if (change === null || change === undefined) return null;
  const pos = change >= 0;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px', background: pos ? '#f1f8f5' : '#fff4f4', color: pos ? '#008060' : '#d82c0d', border: `1px solid ${pos ? '#b5e3d8' : '#fca5a5'}`, whiteSpace: 'nowrap' }}>
      {pos ? '▲' : '▼'} {Math.abs(change)}% <span style={{ fontWeight: 400 }}>vs last period</span>
    </span>
  );
}

function EmptyNote({ message }) {
  return (
    <div style={{ textAlign: 'center', padding: '20px 12px' }}>
      <Text as="span" variant="bodySm" tone="subdued">{message}</Text>
    </div>
  );
}

function StatBlock({ label, value, tone, locked }) {
  return (
    <div style={{ padding: '14px', borderRadius: 10, background: '#f9fafb', border: '1px solid #f3f4f6', textAlign: 'center' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: tone || '#111827', lineHeight: 1 }}>
        <LockedValue locked={locked}>{locked ? '••••' : value}</LockedValue>
      </div>
    </div>
  );
}

function KpiCard({ label, value, change, icon, accent = '#008060', spark, sparkKey, locked }) {
  const gradId = `kpi-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: '20px 20px 14px', border: '1px solid #e1e3e5', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', position: 'relative', overflow: 'hidden', minHeight: 128 }}>
      {!locked && spark && sparkKey && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 76, opacity: 0.13, pointerEvents: 'none' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={accent} stopOpacity={1} />
                  <stop offset="100%" stopColor={accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey={sparkKey} stroke={accent} strokeWidth={2.5} fill={`url(#${gradId})`} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <div style={{ position: 'relative', zIndex: 1 }}>
        <InlineStack align="space-between" blockAlign="start">
          <InlineStack gap="150" blockAlign="center">
            {icon && (
              <span style={{ width: 30, height: 30, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: `${accent}18`, color: accent, flexShrink: 0 }}>
                <span style={{ width: 16, height: 16 }}><Icon source={icon} /></span>
              </span>
            )}
            <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
          </InlineStack>
          {!locked && <ChangeBadge change={change} />}
        </InlineStack>
        <div style={{ marginTop: 16 }}>
          <Text as="p" variant="heading2xl" fontWeight="bold">
            <LockedValue locked={locked}>{locked ? '••••••' : value}</LockedValue>
          </Text>
        </div>
      </div>
    </div>
  );
}

function SectionDivider({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0' }}>
      <div style={{ flex: 1, height: 1, background: '#e1e3e5' }} />
      <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.7px', background: '#f9fafb', padding: '5px 14px', borderRadius: 20, border: '1px solid #e1e3e5', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: '#e1e3e5' }} />
    </div>
  );
}

const SEVERITY_META = {
  critical: { accent: '#dc2626', bg: '#fef2f2', border: '#fecaca', icon: AlertCircleIcon, label: 'Critical' },
  warning:  { accent: '#d97706', bg: '#fffbeb', border: '#fde68a', icon: AlertCircleIcon, label: 'Warning' },
  tip:      { accent: '#1a9de0', bg: '#e8f9fe', border: '#7dd3fc', icon: InfoIcon,        label: 'Tip' },
  win:      { accent: '#059669', bg: '#f0fdf4', border: '#bbf7d0', icon: CheckCircleIcon, label: 'Win' },
};

function InsightCard({ tag, title, description, recommendation, severity }) {
  const meta = SEVERITY_META[severity] || SEVERITY_META.tip;
  return (
    <div style={{ background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: 14, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: `${meta.accent}18`, color: meta.accent, flexShrink: 0 }}>
          <span style={{ width: 18, height: 18 }}><Icon source={meta.icon} /></span>
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: meta.accent, background: `${meta.accent}18`, padding: '2px 8px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{meta.label}</span>
            <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>{tag}</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', lineHeight: 1.4 }}>{title}</div>
        </div>
      </div>
      <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{description}</div>
      <div style={{ padding: '10px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.72)', border: `1px solid ${meta.border}` }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: meta.accent, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Recommendation</div>
        <div style={{ fontSize: 13, color: '#1f2937', lineHeight: 1.5 }}>{recommendation}</div>
      </div>
    </div>
  );
}

function ProductRow({ rank, name, revenue, unitsSold, accentColor, currencySymbol, currencyCode, locked }) {
  const RANK_COLORS = ['#667eea', '#f59e0b', '#10b981', '#2ecc71', '#f97316'];
  const color = accentColor || RANK_COLORS[(rank - 1) % RANK_COLORS.length];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 24, height: 24, borderRadius: 6, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color, flexShrink: 0 }}>{rank}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text as="p" variant="bodySm" fontWeight="semibold">{name}</Text>
        <Text as="span" variant="bodyXs" tone="subdued">
          <LockedValue locked={locked}>{locked ? '•• units sold' : `${(unitsSold || 0).toLocaleString()} units sold`}</LockedValue>
        </Text>
      </div>
      <Text as="span" variant="bodySm" fontWeight="semibold">
        <LockedValue locked={locked}>{locked ? '$•••' : formatAmount(revenue, currencySymbol, currencyCode)}</LockedValue>
      </Text>
    </div>
  );
}

const ANALYTICS_TABS = [
  { id: 'overview',      content: 'Overview' },
  { id: 'combo-builder', content: 'Build A Combo' },
  { id: 'ai-insights',   content: '✦ AI Insights PRO' },
];

const Y_CURRENCY = (sym) => (v) => `${sym}${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`;

// Decorative-only fake series for locked chart placeholders — never real
// data (the backend already refuses to send real numbers to a locked plan).
const PLACEHOLDER_PRODUCT_NAMES = ['Sample Product A', 'Sample Product B', 'Sample Product C'];

// Decorative-only placeholder insight cards shown (blurred) to tease the
// AI Insights Pro tab — never real AI output, since the backend already
// refuses to generate real insights for a locked plan.
const PLACEHOLDER_INSIGHTS = [
  { id: 'placeholder-1', tag: 'Revenue', severity: 'tip', title: 'Sample insight title', description: 'Sample insight description text goes here to show the general shape of an AI recommendation.', recommendation: 'Sample recommended action.' },
  { id: 'placeholder-2', tag: 'Upsell', severity: 'win', title: 'Sample insight title', description: 'Sample insight description text goes here to show the general shape of an AI recommendation.', recommendation: 'Sample recommended action.' },
];

const PLACEHOLDER_CHART_DATA = [
  { date: '1', revenue: 40, store: 30, bundle: 12 },
  { date: '2', revenue: 55, store: 42, bundle: 18 },
  { date: '3', revenue: 48, store: 38, bundle: 15 },
  { date: '4', revenue: 70, store: 50, bundle: 26 },
  { date: '5', revenue: 62, store: 46, bundle: 22 },
  { date: '6', revenue: 80, store: 58, bundle: 30 },
  { date: '7', revenue: 74, store: 55, bundle: 28 },
];

/* ─── main page ─────────────────────────────────────── */

export default function AnalyticsPage() {
  const { shop } = useLoaderData();
  const { symbol: currencySymbol, code: currencyCode } = useCurrency();
  const { canAccessFeature } = usePlan();
  const hasAiAnalyticsAccess = canAccessFeature('ai_analytics');
  const hasFullAnalyticsAccess = canAccessFeature('full_analytics');

  const today     = new Date();
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const last7     = new Date(today); last7.setDate(last7.getDate() - 7);
  const last30    = new Date(today); last30.setDate(last30.getDate() - 30);
  const last90    = new Date(today); last90.setDate(last90.getDate() - 90);

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

  const [summary, setSummary] = useState({ current: null, previous: null, change_pct: null, loading: false, error: false });
  const [chartData, setChartData] = useState([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [topProducts, setTopProducts] = useState({ items: [], loading: false });
  const [bundleAnalytics, setBundleAnalytics] = useState({ data: null, loading: false });
  const [insights, setInsights] = useState({ items: [], loading: false, stale: false, generatedAt: null, reason: null, error: false });

  const A = summary.current || ZERO_TOTALS;
  const changePct = summary.change_pct || {};

  const aovChartData = chartData.map(d => ({ date: d.date, aov: d.aov }));
  const hasRevenue   = chartData.some(d => d.revenue > 0);
  const upsellShare  = A.revenue > 0 ? Math.round((A.upsell_revenue / A.revenue) * 100) : 0;

  const fetchSummary = useCallback(async (start, end) => {
    if (!shop) return;
    setSummary(prev => ({ ...prev, loading: true, error: false }));
    try {
      const res = await fetch(`/api/analytics/summary?startDate=${formatLocalDate(start)}&endDate=${formatLocalDate(end)}`);
      const p = await res.json();
      if (!res.ok || !p?.success) throw new Error();
      setSummary({ current: p.data.current, previous: p.data.previous, change_pct: p.data.change_pct, loading: false, error: false });
    } catch {
      setSummary(prev => ({ ...prev, loading: false, error: true }));
    }
  }, [shop]);

  const fetchChart = useCallback(async (start, end) => {
    if (!shop) return;
    setChartLoading(true);
    try {
      const res = await fetch(`/api/analytics/chart?startDate=${formatLocalDate(start)}&endDate=${formatLocalDate(end)}`);
      const p = await res.json();
      if (!res.ok || !p?.success) throw new Error();
      setChartData(p.data);
    } catch {
      setChartData([]);
    } finally {
      setChartLoading(false);
    }
  }, [shop]);

  const fetchTopProducts = useCallback(async (start, end) => {
    if (!shop) return;
    setTopProducts(prev => ({ ...prev, loading: true }));
    try {
      const res = await fetch(`/api/analytics/top-products?startDate=${formatLocalDate(start)}&endDate=${formatLocalDate(end)}&limit=5`);
      const p = await res.json();
      setTopProducts({ items: (res.ok && p?.success) ? p.data : [], loading: false });
    } catch {
      setTopProducts({ items: [], loading: false });
    }
  }, [shop]);

  const fetchBundleAnalytics = useCallback(async (start, end) => {
    if (!shop) return;
    setBundleAnalytics(prev => ({ ...prev, loading: true }));
    try {
      const res = await fetch(`/api/bundle-analytics?startDate=${formatLocalDate(start)}&endDate=${formatLocalDate(end)}`);
      const p = await res.json();
      setBundleAnalytics({ data: (res.ok && p?.success) ? p.data : null, loading: false });
    } catch {
      setBundleAnalytics({ data: null, loading: false });
    }
  }, [shop]);

  const fetchInsights = useCallback(async (start, end, force = false) => {
    if (!shop) return;
    setInsights(prev => ({ ...prev, loading: true, error: false }));
    try {
      const res = await fetch(`/api/analytics/insights?startDate=${formatLocalDate(start)}&endDate=${formatLocalDate(end)}${force ? '&force=true' : ''}`);
      const p = await res.json();
      if (!res.ok || !p?.success) throw new Error();
      setInsights({
        items: p.data || [], loading: false, error: false,
        stale: Boolean(p.stale), generatedAt: p.generated_at || null, reason: p.reason || null,
      });
    } catch {
      setInsights(prev => ({ ...prev, loading: false, error: true }));
    }
  }, [shop]);

  const runAll = useCallback((start, end) => {
    // Free/Starter plans can't access Full Analytics — the backend already
    // refuses these requests (403), so skip firing them client-side too and
    // just show the blurred placeholder state instead of a false "fetch
    // failed" error.
    if (!hasFullAnalyticsAccess) return;
    fetchSummary(start, end);
    fetchChart(start, end);
    fetchTopProducts(start, end);
    fetchBundleAnalytics(start, end);
  }, [hasFullAnalyticsAccess, fetchSummary, fetchChart, fetchTopProducts, fetchBundleAnalytics]);

  useEffect(() => {
    setIsClient(true);
    if (selectedDates.start && selectedDates.end && shop) runAll(selectedDates.start, selectedDates.end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { setTempDates(selectedDates); }, [selectedDates]);

  useEffect(() => {
    if (selectedTab === 2 && shop && hasAiAnalyticsAccess) fetchInsights(selectedDates.start, selectedDates.end, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTab]);

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
    if (selectedTab === 2 && hasAiAnalyticsAccess) fetchInsights(start, end, false);
  };

  const dateLabel = activePreset || `${selectedDates.start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} – ${selectedDates.end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const overviewKpis = [
    { label: 'Total Revenue',    value: formatAmount(A.revenue, currencySymbol, currencyCode),          change: changePct.revenue ?? null,          icon: CashDollarIcon,    accent: '#008060', spark: chartData,    sparkKey: 'revenue' },
    { label: 'Upsell Revenue',   value: formatAmount(A.upsell_revenue, currencySymbol, currencyCode),    change: changePct.upsell_revenue ?? null,   icon: RewardIcon,        accent: '#2ecc71', spark: chartData,    sparkKey: 'upsell' },
    { label: 'Avg. Order Value', value: formatAmount(A.aov, currencySymbol, currencyCode),                change: changePct.aov ?? null,               icon: CartIcon,          accent: '#1a9de0', spark: aovChartData, sparkKey: 'aov' },
    { label: 'Conversion Rate',  value: `${A.conversion_rate.toFixed(1)}%`,                              change: changePct.conversion_rate ?? null,  icon: ChartVerticalIcon, accent: '#059669', spark: chartData,    sparkKey: 'convRate' },
    { label: 'Checkout Rate',    value: `${A.checkout_rate.toFixed(1)}%`,                                change: changePct.checkout_rate ?? null,    icon: CashDollarIcon,    accent: '#0ea5e9', spark: chartData,    sparkKey: 'checkoutRate' },
  ];

  const bundle = bundleAnalytics.data;
  const bundleRevenue = bundle?.total_revenue || 0;
  const storeRevenue  = A.revenue;
  const bundleShare   = storeRevenue > 0 ? Math.round((bundleRevenue / storeRevenue) * 100) : 0;
  const bundleClickToOrderRate = bundle?.total_clicks > 0 ? Math.round((bundle.total_conversions / bundle.total_clicks) * 100) : 0;
  const bundleChartData = chartData.map(d => ({ date: d.date, store: d.revenue, bundle: d.bundleRevenue }));

  return (
    <Page
      fullWidth
      secondaryActions={[{ content: 'Export Report', disabled: true }]}
      primaryAction={
        <Popover active={popoverActive} activator={<Button icon={CalendarIcon} onClick={togglePopover}>{dateLabel}</Button>} onClose={togglePopover} fluidContent>
          <div style={{ display: 'flex', width: '720px', maxHeight: '520px' }}>
            <div style={{ width: '170px', borderRight: '1px solid #e1e3e5', padding: '8px', overflowY: 'auto' }}>
              <BlockStack gap="050">
                {presets.map((preset) => (
                  <div key={preset.label} onClick={() => handlePresetClick(preset)}
                    style={{ padding: '8px 12px', cursor: 'pointer', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: activePreset === preset.label ? '#f1f1f1' : 'transparent' }}>
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
                  <div style={{ flex: 1 }}><TextField labelHidden label="" value={tempDates.start instanceof Date ? tempDates.start.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''} autoComplete="off" /></div>
                  <Icon source={ArrowRightIcon} tone="base" />
                  <div style={{ flex: 1 }}><TextField labelHidden label="" value={tempDates.end instanceof Date ? tempDates.end.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''} autoComplete="off" /></div>
                  <Icon source={ClockIcon} tone="base" />
                </InlineStack>
              </div>
              <div style={{ display: 'flex', gap: '16px', padding: '0 16px' }}>
                <div style={{ flex: 1 }}><DatePicker month={month} year={year} onChange={setTempDates} onMonthChange={(m, y) => setMonthYear({ month: m, year: y })} selected={tempDates} allowRange /></div>
                <div style={{ flex: 1 }}><DatePicker month={month === 11 ? 0 : month + 1} year={month === 11 ? year + 1 : year} onChange={setTempDates} onMonthChange={() => {}} selected={tempDates} allowRange /></div>
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

        <FeatureHeaderBar feature="analytics" title="Analytics" subtitle="Revenue, conversions and engagement across all your Cart Ninja features" />

        <BrixBar size="md" floating />

        <BrowserTabStrip tabs={ANALYTICS_TABS} selected={selectedTab} onSelect={setSelectedTab} accent="#1a9de0" fitted />

        {!hasFullAnalyticsAccess && selectedTab !== 2 && <ProUpgradeBanner featureKey="full_analytics" />}

        {hasFullAnalyticsAccess && summary.error && (
          <div style={{ padding: '12px 16px', background: '#fff4f4', border: '1px solid #fca5a5', borderRadius: '8px' }}>
            <Text variant="bodySm" tone="critical">Unable to fetch analytics data right now. Please try again shortly.</Text>
          </div>
        )}

        {/* ══ OVERVIEW ══ */}
        {selectedTab === 0 && (
          <BlockStack gap="500">

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
              {overviewKpis.map(kpi => <KpiCard key={kpi.label} {...kpi} locked={!hasFullAnalyticsAccess} />)}
            </div>

            {/* Progress Tiers */}
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="050">
                  <Text as="h3" variant="headingMd">Progress Tiers</Text>
                  <Text as="p" variant="bodySm" tone="subdued">How many sessions reached each spend milestone in the cart drawer</Text>
                </BlockStack>
                <EmptyNote message="Tier-reach tracking isn't available yet — this will populate once milestone-level cart tracking is added." />
              </BlockStack>
            </Card>

            {/* Revenue Trend */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">Revenue Trend</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Total store revenue over the selected period</Text>
                  </BlockStack>
                  {!hasFullAnalyticsAccess ? null : <ChangeBadge change={changePct.revenue ?? null} />}
                </InlineStack>
                <LockedChartArea locked={!hasFullAnalyticsAccess} height={260}>
                  <div style={{ height: 260 }}>
                    {isClient && (hasFullAnalyticsAccess ? chartData.length > 0 : true) && (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={hasFullAnalyticsAccess ? chartData : PLACEHOLDER_CHART_DATA} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="revTrend" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%"  stopColor="#008060" stopOpacity={0.18} />
                              <stop offset="95%" stopColor="#008060" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                          <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} dy={6} />
                          <YAxis fontSize={11} tickLine={false} axisLine={false} width={52} tickFormatter={hasFullAnalyticsAccess ? Y_CURRENCY(currencySymbol) : () => ''} />
                          <Tooltip formatter={(v) => [formatAmount(v, currencySymbol, currencyCode), 'Revenue']} />
                          <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#008060" strokeWidth={2.5} fill="url(#revTrend)" dot={false} activeDot={{ r: 5, fill: '#008060' }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </LockedChartArea>
                {hasFullAnalyticsAccess && !chartLoading && !hasRevenue && <EmptyNote message="No revenue data for this period." />}
              </BlockStack>
            </Card>

            {/* Coupon Activity + Top Products */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">Coupon Activity</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Total coupon banner clicks and applications this period</Text>
                  </BlockStack>
                  {(!hasFullAnalyticsAccess || A.coupon_click_count > 0) ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <StatBlock label="Clicks" value={A.coupon_click_count.toLocaleString()} locked={!hasFullAnalyticsAccess} />
                      <StatBlock label="Applied" value={A.coupon_applied_count.toLocaleString()} tone="#008060" locked={!hasFullAnalyticsAccess} />
                    </div>
                  ) : <EmptyNote message="No coupon activity yet in this period." />}
                  <Text as="p" variant="bodyXs" tone="subdued">Per-coupon-code breakdown isn&apos;t tracked yet — totals cover all coupon banners.</Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">Top Products</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Best selling products by revenue in this period</Text>
                  </BlockStack>
                  <BlockStack gap="250">
                    {!topProducts.items.length
                      ? <EmptyNote message="No product sales yet in this period." />
                      : !hasFullAnalyticsAccess
                        ? PLACEHOLDER_PRODUCT_NAMES.map((name, i) => <ProductRow key={name} rank={i + 1} name={name} revenue={0} unitsSold={0} currencySymbol={currencySymbol} currencyCode={currencyCode} locked />)
                        : topProducts.items.map((p, i) => <ProductRow key={p.product_id || p.name} rank={i + 1} name={p.name} revenue={p.revenue} unitsSold={p.units_sold} currencySymbol={currencySymbol} currencyCode={currencyCode} />)}
                  </BlockStack>
                </BlockStack>
              </Card>
            </div>

            <SectionDivider label="Upsell & FBT Analytics" />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">Upsell & FBT Products</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Per-product upsell/FBT revenue attribution</Text>
                  </BlockStack>
                  <EmptyNote message="Per-product upsell/FBT attribution isn't tracked yet — see the aggregate Upsell Revenue KPI and chart above." />
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">Store Revenue vs Upsell Revenue</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Upsell contribution to your total store revenue</Text>
                  </BlockStack>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <StatBlock label="Store Revenue" value={formatAmount(A.revenue, currencySymbol, currencyCode)} locked={!hasFullAnalyticsAccess} />
                    <div style={{ padding: '14px', borderRadius: 10, background: '#faf5ff', border: '1px solid #ede9fe', textAlign: 'center' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#2ecc71', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Upsell Revenue</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: '#7c3aed', lineHeight: 1 }}>
                        <LockedValue locked={!hasFullAnalyticsAccess}>{!hasFullAnalyticsAccess ? '$•••' : formatAmount(A.upsell_revenue, currencySymbol, currencyCode)}</LockedValue>
                      </div>
                      <div style={{ fontSize: 11, color: '#2ecc71', marginTop: 5 }}>
                        <LockedValue locked={!hasFullAnalyticsAccess}>{!hasFullAnalyticsAccess ? '••% of store revenue' : `${upsellShare}% of store revenue`}</LockedValue>
                      </div>
                    </div>
                  </div>
                  <div>
                    <div style={{ height: 10, borderRadius: 6, background: '#f3f4f6', overflow: 'hidden' }}>
                      <div style={{ width: `${hasFullAnalyticsAccess ? upsellShare : 45}%`, height: '100%', background: 'linear-gradient(90deg, #2ecc71, #7c3aed)', borderRadius: 6, filter: hasFullAnalyticsAccess ? undefined : 'blur(3px)' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                      <Text as="span" variant="bodyXs" tone="subdued">
                        <LockedValue locked={!hasFullAnalyticsAccess}>{!hasFullAnalyticsAccess ? 'Upsell ••%' : `Upsell ${upsellShare}%`}</LockedValue>
                      </Text>
                      <Text as="span" variant="bodyXs" tone="subdued">
                        <LockedValue locked={!hasFullAnalyticsAccess}>{!hasFullAnalyticsAccess ? 'Other ••%' : `Other ${100 - upsellShare}%`}</LockedValue>
                      </Text>
                    </div>
                  </div>
                </BlockStack>
              </Card>
            </div>

          </BlockStack>
        )}

        {/* ══ BUILD A COMBO ══ */}
        {selectedTab === 1 && (
          <BlockStack gap="400">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {[
                { label: 'Bundle Revenue',       value: formatAmount(bundleRevenue, currencySymbol, currencyCode), icon: CashDollarIcon, accent: '#7c3aed' },
                { label: 'Store Revenue',        value: formatAmount(storeRevenue, currencySymbol, currencyCode),  icon: CartIcon,       accent: '#008060' },
                { label: 'Click → Order Rate',   value: `${bundleClickToOrderRate}%`,                              icon: RewardIcon,     accent: '#f59e0b' },
              ].map(kpi => (
                <div key={kpi.label} style={{ background: '#fff', borderRadius: 14, padding: '20px', border: '1px solid #e1e3e5', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                  <InlineStack gap="150" blockAlign="center">
                    <span style={{ width: 30, height: 30, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: `${kpi.accent}18`, color: kpi.accent }}>
                      <span style={{ width: 16, height: 16 }}><Icon source={kpi.icon} /></span>
                    </span>
                    <Text as="p" variant="bodySm" tone="subdued">{kpi.label}</Text>
                  </InlineStack>
                  <div style={{ marginTop: 16 }}>
                    <Text as="p" variant="heading2xl" fontWeight="bold">
                      <LockedValue locked={!hasFullAnalyticsAccess}>{!hasFullAnalyticsAccess ? '••••••' : kpi.value}</LockedValue>
                    </Text>
                  </div>
                </div>
              ))}
            </div>

            {/* Store Revenue vs Bundle Revenue */}
            <Card>
              <BlockStack gap="300">
                <BlockStack gap="050">
                  <Text as="h3" variant="headingMd">Store Revenue vs Bundle Revenue</Text>
                  <Text as="p" variant="bodySm" tone="subdued">How much of your total revenue comes from Build A Combo bundles</Text>
                </BlockStack>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <StatBlock label="Store Revenue" value={formatAmount(storeRevenue, currencySymbol, currencyCode)} locked={!hasFullAnalyticsAccess} />
                  <div style={{ padding: '16px', borderRadius: 10, background: '#edfaf4', border: '1px solid #ddd6fe', textAlign: 'center' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Bundle Revenue</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: '#1a9de0', lineHeight: 1 }}>
                      <LockedValue locked={!hasFullAnalyticsAccess}>{!hasFullAnalyticsAccess ? '$•••' : formatAmount(bundleRevenue, currencySymbol, currencyCode)}</LockedValue>
                    </div>
                    <div style={{ fontSize: 11, color: '#7c3aed', marginTop: 5 }}>
                      <LockedValue locked={!hasFullAnalyticsAccess}>{!hasFullAnalyticsAccess ? '••% of store revenue' : `${bundleShare}% of store revenue`}</LockedValue>
                    </div>
                  </div>
                </div>

                <div>
                  <div style={{ height: 10, borderRadius: 6, background: '#f3f4f6', overflow: 'hidden' }}>
                    <div style={{ width: `${hasFullAnalyticsAccess ? bundleShare : 55}%`, height: '100%', background: 'linear-gradient(90deg, #7c3aed, #1a9de0)', borderRadius: 6, transition: 'width 0.6s ease', filter: hasFullAnalyticsAccess ? undefined : 'blur(3px)' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                    <Text as="span" variant="bodyXs" tone="subdued">
                      <LockedValue locked={!hasFullAnalyticsAccess}>{!hasFullAnalyticsAccess ? 'Bundles ••%' : `Bundles ${bundleShare}%`}</LockedValue>
                    </Text>
                    <Text as="span" variant="bodyXs" tone="subdued">
                      <LockedValue locked={!hasFullAnalyticsAccess}>{!hasFullAnalyticsAccess ? 'Other ••%' : `Other ${100 - bundleShare}%`}</LockedValue>
                    </Text>
                  </div>
                </div>

                <div>
                  <Text as="p" variant="bodyXs" tone="subdued" fontWeight="semibold">Daily bundle revenue vs store revenue</Text>
                  <LockedChartArea locked={!hasFullAnalyticsAccess} height={140}>
                    <div style={{ height: 140, marginTop: 8 }}>
                      {isClient && (hasFullAnalyticsAccess ? bundleChartData.length > 0 : true) && (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={hasFullAnalyticsAccess ? bundleChartData : PLACEHOLDER_CHART_DATA} margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                            <XAxis dataKey="date" fontSize={10} tickLine={false} axisLine={false} />
                            <YAxis fontSize={10} tickLine={false} axisLine={false} width={44} tickFormatter={hasFullAnalyticsAccess ? Y_CURRENCY(currencySymbol) : () => ''} />
                            <Tooltip formatter={(v, name) => [formatAmount(v, currencySymbol, currencyCode), name]} />
                            <Bar dataKey="store"  name="Store Revenue"  fill="#d4f1fe" radius={[3,3,0,0]} maxBarSize={30} />
                            <Bar dataKey="bundle" name="Bundle Revenue" fill="#7c3aed" radius={[3,3,0,0]} maxBarSize={30} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </LockedChartArea>
                </div>
              </BlockStack>
            </Card>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">Top Products</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Best performing products store-wide in this period</Text>
                  </BlockStack>
                  <BlockStack gap="250">
                    {!topProducts.items.length
                      ? <EmptyNote message="No product sales yet in this period." />
                      : !hasFullAnalyticsAccess
                        ? PLACEHOLDER_PRODUCT_NAMES.map((name, i) => <ProductRow key={name} rank={i + 1} name={name} revenue={0} unitsSold={0} accentColor="#7c3aed" currencySymbol={currencySymbol} currencyCode={currencyCode} locked />)
                        : topProducts.items.map((p, i) => <ProductRow key={p.product_id || p.name} rank={i + 1} name={p.name} revenue={p.revenue} unitsSold={p.units_sold} accentColor="#7c3aed" currencySymbol={currencySymbol} currencyCode={currencyCode} />)}
                  </BlockStack>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">Top Bundle Pages</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Pages with the highest bundle interaction and conversion</Text>
                  </BlockStack>
                  <EmptyNote message="Page-level view tracking isn't available yet." />
                </BlockStack>
              </Card>
            </div>

            <Card>
              <BlockStack gap="300">
                <BlockStack gap="050">
                  <Text as="h3" variant="headingMd">Top Bundle Templates</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Most clicked bundle templates and their revenue contribution</Text>
                </BlockStack>
                <BlockStack gap="250">
                  {!hasFullAnalyticsAccess
                    ? PLACEHOLDER_PRODUCT_NAMES.map((name, i) => {
                        const COLORS = ['#7c3aed', '#1a9de0', '#2ecc71'];
                        const color = COLORS[i % COLORS.length];
                        return (
                          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ width: 24, height: 24, borderRadius: 6, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color, flexShrink: 0 }}>{i + 1}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                                <Text as="span" variant="bodySm" fontWeight="semibold">{name}</Text>
                                <Text as="span" variant="bodyXs" tone="subdued"><LockedValue locked>•• clicks</LockedValue></Text>
                              </div>
                              <div style={{ height: 6, borderRadius: 3, background: '#f3f4f6' }}>
                                <div style={{ width: `${70 - i * 15}%`, height: '100%', borderRadius: 3, background: color, filter: 'blur(2px)' }} />
                              </div>
                            </div>
                            <Text as="span" variant="bodySm" fontWeight="semibold"><LockedValue locked>$•••</LockedValue></Text>
                          </div>
                        );
                      })
                    : bundle?.top_templates?.length ? bundle.top_templates.map((tpl, i) => {
                    const maxClicks = bundle.top_templates[0].clicks || 1;
                    const pct = Math.round((tpl.clicks / maxClicks) * 100);
                    const COLORS = ['#7c3aed', '#1a9de0', '#2ecc71', '#a78bfa', '#7dd3fc'];
                    const color = COLORS[i % COLORS.length];
                    return (
                      <div key={tpl.template_id || tpl.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 24, height: 24, borderRadius: 6, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color, flexShrink: 0 }}>{i + 1}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                            <Text as="span" variant="bodySm" fontWeight="semibold">{tpl.name}</Text>
                            <Text as="span" variant="bodyXs" tone="subdued">{tpl.clicks.toLocaleString()} clicks</Text>
                          </div>
                          <div style={{ height: 6, borderRadius: 3, background: '#f3f4f6' }}>
                            <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: color }} />
                          </div>
                        </div>
                        <Text as="span" variant="bodySm" fontWeight="semibold">{formatAmount(tpl.revenue, currencySymbol, currencyCode)}</Text>
                      </div>
                    );
                  }) : <EmptyNote message="No bundle template activity yet in this period." />}
                </BlockStack>
              </BlockStack>
            </Card>
          </BlockStack>
        )}

        {/* ══ AI INSIGHTS PRO ══ */}
        {selectedTab === 2 && (
          <BlockStack gap="400">
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '20px 24px', borderRadius: 14, background: 'linear-gradient(135deg, #1e1b4b, #312e81)', border: '1px solid #4338ca' }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>✦</div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>AI Insights</span>
                  <span style={{ fontSize: 10, fontWeight: 800, background: 'linear-gradient(135deg, #f59e0b, #ef4444)', color: '#fff', padding: '3px 10px', borderRadius: 99, letterSpacing: '0.5px' }}>PRO</span>
                </div>
                <div style={{ fontSize: 13, color: '#a5b4fc' }}>Actionable recommendations generated from your store&apos;s real analytics data</div>
              </div>
              {hasAiAnalyticsAccess && (
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ textAlign: 'right' }}>
                    {insights.loading && <div style={{ fontSize: 11, color: '#a5b4fc' }}>Generating insights…</div>}
                    {!insights.loading && insights.stale && insights.generatedAt && (
                      <div style={{ fontSize: 11, color: '#fbbf24' }}>Showing insights from {new Date(insights.generatedAt).toLocaleString()}</div>
                    )}
                    {!insights.loading && !insights.stale && insights.generatedAt && (
                      <div style={{ fontSize: 11, color: '#a5b4fc' }}>Updated {new Date(insights.generatedAt).toLocaleString()}</div>
                    )}
                  </div>
                  <Button icon={RefreshIcon} onClick={() => fetchInsights(selectedDates.start, selectedDates.end, true)} loading={insights.loading} size="slim">
                    Regenerate
                  </Button>
                </div>
              )}
            </div>

            {!hasAiAnalyticsAccess && <ProUpgradeBanner featureKey="ai_analytics" />}

            {!hasAiAnalyticsAccess && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                {PLACEHOLDER_INSIGHTS.map(insight => (
                  <LockedChartArea key={insight.id} locked height={150}>
                    <InsightCard {...insight} />
                  </LockedChartArea>
                ))}
              </div>
            )}

            {hasAiAnalyticsAccess && insights.loading && insights.items.length === 0 && <EmptyNote message="Generating insights from your real analytics data…" />}

            {hasAiAnalyticsAccess && !insights.loading && insights.items.length === 0 && insights.reason === 'insufficient_data' && (
              <EmptyNote message="Not enough data yet to generate insights — check back after a few more orders." />
            )}

            {hasAiAnalyticsAccess && !insights.loading && insights.items.length === 0 && insights.reason !== 'insufficient_data' && (
              <EmptyNote message={insights.error ? "Couldn't generate insights right now. Try Regenerate." : "No insights available yet."} />
            )}

            {hasAiAnalyticsAccess && insights.items.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                {insights.items.map(insight => <InsightCard key={insight.id} {...insight} />)}
              </div>
            )}
          </BlockStack>
        )}

      </BlockStack>
      <div style={{ height: 100 }} aria-hidden="true" />
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
