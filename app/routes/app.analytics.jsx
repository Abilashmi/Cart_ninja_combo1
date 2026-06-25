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

/* ─── helpers ─────────────────────────────────────────── */

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
    checkoutClicks: 0, couponClicks: 0, upsellClicks: 0, convRate: 0, checkoutRate: 0,
  }));
}

/* ─── sample / mock data ──────────────────────────────── */

const SAMPLE_CHART = [
  { date: 'Mon', revenue: 4180, upsell: 760,  coupons: 41, checkoutClicks: 138, couponClicks: 79,  upsellClicks: 54, convRate: 58, checkoutRate: 31 },
  { date: 'Tue', revenue: 5240, upsell: 980,  coupons: 52, checkoutClicks: 171, couponClicks: 96,  upsellClicks: 67, convRate: 63, checkoutRate: 35 },
  { date: 'Wed', revenue: 4760, upsell: 870,  coupons: 47, checkoutClicks: 156, couponClicks: 88,  upsellClicks: 61, convRate: 61, checkoutRate: 33 },
  { date: 'Thu', revenue: 6120, upsell: 1180, coupons: 63, checkoutClicks: 198, couponClicks: 112, upsellClicks: 79, convRate: 67, checkoutRate: 38 },
  { date: 'Fri', revenue: 7340, upsell: 1460, coupons: 78, checkoutClicks: 241, couponClicks: 134, upsellClicks: 94, convRate: 71, checkoutRate: 42 },
  { date: 'Sat', revenue: 6890, upsell: 1320, coupons: 71, checkoutClicks: 223, couponClicks: 121, upsellClicks: 86, convRate: 68, checkoutRate: 39 },
  { date: 'Sun', revenue: 5510, upsell: 1010, coupons: 55, checkoutClicks: 182, couponClicks: 101, upsellClicks: 70, convRate: 64, checkoutRate: 36 },
];
const SAMPLE_ANALYTICS = SAMPLE_CHART.reduce((a, d) => ({
  checkout_click: a.checkout_click + d.checkoutClicks,
  coupon_click: a.coupon_click + d.couponClicks,
  upsell_click: a.upsell_click + d.upsellClicks,
  upsell_revenue_generated: a.upsell_revenue_generated + d.upsell,
  cartdrawer_total_revenue: a.cartdrawer_total_revenue + d.revenue,
  cartdrawer_total_coupon_applied: a.cartdrawer_total_coupon_applied + d.coupons,
}), { checkout_click: 0, coupon_click: 0, upsell_click: 0, upsell_revenue_generated: 0, cartdrawer_total_revenue: 0, cartdrawer_total_coupon_applied: 0 });
const SAMPLE_PREV = Object.fromEntries(Object.entries(SAMPLE_ANALYTICS).map(([k, v]) => [k, Math.round(v * 0.87)]));

const MOCK_TIERS = [
  { label: 'Free Shipping', threshold: 599,  reached: 312, color: '#008060' },
  { label: 'Free Gift',     threshold: 999,  reached: 87,  color: '#2ecc71' },
  { label: 'VIP Discount',  threshold: 1499, reached: 23,  color: '#f59e0b' },
];
const MOCK_TOP_COUPONS = [
  { code: 'SUMMER20',  revenue: 4820, clicks: 612, applied: 287 },
  { code: 'WELCOME15', revenue: 3140, clicks: 451, applied: 198 },
  { code: 'FLASH10',   revenue: 2390, clicks: 334, applied: 156 },
  { code: 'FREESHIP',  revenue: 1870, clicks: 278, applied: 134 },
  { code: 'BACK2SCH',  revenue: 1240, clicks: 189, applied: 87  },
];
const MOCK_TOP_UPSELL = [
  { name: 'Premium Socks Bundle',  revenue: 3840, atcRate: 68 },
  { name: 'Leather Wallet + Belt', revenue: 2910, atcRate: 54 },
  { name: 'Sunglasses + Case',     revenue: 2240, atcRate: 47 },
  { name: 'Hat + Scarf Set',       revenue: 1780, atcRate: 39 },
  { name: 'Canvas Sneakers',       revenue: 1340, atcRate: 31 },
];
const MOCK_FBT_PRODUCTS = [
  { name: 'Premium Socks Bundle',  revenue: 2840, atcRate: 71 },
  { name: 'Leather Wallet + Belt', revenue: 2210, atcRate: 58 },
  { name: 'Sunglasses + Case',     revenue: 1680, atcRate: 44 },
  { name: 'Hat + Scarf Set',       revenue: 1340, atcRate: 37 },
];
const MOCK_STORE_VS_BUNDLE = [
  { date: 'Mon', store: 4180, bundle: 1240 },
  { date: 'Tue', store: 5240, bundle: 1680 },
  { date: 'Wed', store: 4760, bundle: 1430 },
  { date: 'Thu', store: 6120, bundle: 2010 },
  { date: 'Fri', store: 7340, bundle: 2580 },
  { date: 'Sat', store: 6890, bundle: 2240 },
  { date: 'Sun', store: 5510, bundle: 1760 },
];
const MOCK_TOP_BUNDLE_PRODUCTS = [
  { name: 'Classic White Tee', revenue: 3240, atcRate: 72 },
  { name: 'Black Joggers',     revenue: 2810, atcRate: 64 },
  { name: 'Canvas Sneakers',   revenue: 2190, atcRate: 51 },
  { name: 'Wool Beanie',       revenue: 1640, atcRate: 43 },
];
const MOCK_TOP_BUNDLE_PAGES = [
  { page: '/collections/summer-essentials', views: 1240, bundles: 387, cvr: 31 },
  { page: '/products/classic-tee',          views: 890,  bundles: 201, cvr: 23 },
  { page: '/collections/bestsellers',       views: 680,  bundles: 142, cvr: 21 },
  { page: '/products/black-joggers',        views: 420,  bundles: 78,  cvr: 19 },
];
const MOCK_COMBO_TRENDS = [
  { name: 'Tee + Joggers',     clicks: 387, revenue: 4820 },
  { name: 'Sneakers + Socks',  clicks: 201, revenue: 2910 },
  { name: 'Beanie + Scarf',    clicks: 142, revenue: 1780 },
  { name: 'Wallet + Belt',     clicks: 88,  revenue: 1340 },
  { name: 'Sunglasses + Case', clicks: 54,  revenue: 820  },
];
const MOCK_INSIGHTS = [
  { id: 1, severity: 'critical', tag: 'Coupon Banner',    title: 'SUMMER20 has only 3% click rate',          description: 'The SUMMER20 coupon banner is only clicked by 3% of sessions — well below the 12% benchmark.', recommendation: 'Rewrite the CTA to "Grab 20% off — today only" and move the banner above the product list.', accent: '#dc2626', bg: '#fef2f2', border: '#fecaca', icon: AlertCircleIcon },
  { id: 2, severity: 'warning',  tag: 'Cart Drawer Tiers',title: 'Only 1% of sessions reach Tier 2',          description: 'Your ₹999 free product tier is barely being reached. The jump from Tier 1 to Tier 2 is too large.', recommendation: 'Lower Tier 2 to ₹799, or add a progress nudge: "You\'re ₹120 away from a free gift!"', accent: '#d97706', bg: '#fffbeb', border: '#fde68a', icon: AlertCircleIcon },
  { id: 3, severity: 'warning',  tag: 'FBT',               title: 'Top FBT product: 0.8% ATC rate',           description: 'Your top FBT product has a 0.8% ATC rate. Industry benchmark is 15%+.', recommendation: 'Move it to first position in FBT, add a "Customers also love" label, and offer a 10% bundle discount.', accent: '#d97706', bg: '#fffbeb', border: '#fde68a', icon: AlertCircleIcon },
  { id: 4, severity: 'tip',      tag: 'Revenue Pattern',   title: '28% of weekly revenue comes from Fridays',  description: 'Heavy concentration on Fridays creates fragility — a bad Friday means a bad week.', recommendation: 'Launch a mid-week "Wednesday Flash Sale" coupon to spread revenue.', accent: '#1a9de0', bg: '#e8f9fe', border: '#7dd3fc', icon: InfoIcon },
  { id: 5, severity: 'tip',      tag: 'Build A Combo',     title: 'Tee + Joggers: high clicks, low conversion', description: 'This combo gets 387 clicks but only converts at 2.1%.', recommendation: 'Add a "Complete the look" 15% bundle discount.', accent: '#1a9de0', bg: '#e8f9fe', border: '#7dd3fc', icon: InfoIcon },
  { id: 6, severity: 'win',      tag: 'AOV',               title: 'AOV grew 12% this period',                 description: 'Average order value climbed, driven by FBT upsell acceptance on your top 3 products.', recommendation: 'Double down — add FBT recommendations on your next 5 bestsellers.', accent: '#059669', bg: '#f0fdf4', border: '#bbf7d0', icon: CheckCircleIcon },
];

/* ─── loader (real Shopify auth) ─────────────────────── */

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  let initialAnalytics = { ...DEFAULT_ANALYTICS };
  let initialAnalyticsError = false;
  try {
    const origin = new URL(request.url).origin;
    const today = new Date().toISOString().split('T')[0];
    const res = await fetch(
      `${origin}/api/analytics?shop=${encodeURIComponent(shop)}&startDate=${today}&endDate=${today}`,
      { headers: { Accept: 'application/json', 'ngrok-skip-browser-warning': 'true' } }
    );
    const p = await res.json();
    if (res.ok && p?.success) initialAnalytics = normalizeAnalyticsState(p.data);
    else initialAnalyticsError = true;
  } catch { initialAnalyticsError = true; }
  return { shop, initialAnalytics, initialAnalyticsError };
};

/* ─── sub-components ─────────────────────────────────── */

function ChangeBadge({ change }) {
  const pos = change >= 0;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px', background: pos ? '#f1f8f5' : '#fff4f4', color: pos ? '#008060' : '#d82c0d', border: `1px solid ${pos ? '#b5e3d8' : '#fca5a5'}`, whiteSpace: 'nowrap' }}>
      {pos ? '▲' : '▼'} {Math.abs(change)}% <span style={{ fontWeight: 400 }}>vs last period</span>
    </span>
  );
}

function KpiCard({ label, value, change, icon, accent = '#008060', spark, sparkKey }) {
  const gradId = `kpi-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div style={{ background: '#fff', borderRadius: 14, padding: '20px 20px 14px', border: '1px solid #e1e3e5', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', position: 'relative', overflow: 'hidden', minHeight: 128 }}>
      {spark && sparkKey && (
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
          {change != null && <ChangeBadge change={change} />}
        </InlineStack>
        <div style={{ marginTop: 16 }}><Text as="p" variant="heading2xl" fontWeight="bold">{value}</Text></div>
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

function InsightCard({ tag, title, description, recommendation, accent, bg, border, icon, severity }) {
  const SEVERITY_LABEL = { critical: 'Critical', warning: 'Warning', tip: 'Tip', win: 'Win' };
  const SEVERITY_STYLE = { critical: { text: '#dc2626', bg: '#fee2e2' }, warning: { text: '#d97706', bg: '#fef3c7' }, tip: { text: '#1a9de0', bg: '#d4f1fe' }, win: { text: '#059669', bg: '#d1fae5' } };
  const sv = SEVERITY_STYLE[severity];
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 14, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: `${accent}18`, color: accent, flexShrink: 0 }}>
          <span style={{ width: 18, height: 18 }}><Icon source={icon} /></span>
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: sv.text, background: sv.bg, padding: '2px 8px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{SEVERITY_LABEL[severity]}</span>
            <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>{tag}</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', lineHeight: 1.4 }}>{title}</div>
        </div>
      </div>
      <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{description}</div>
      <div style={{ padding: '10px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.72)', border: `1px solid ${border}` }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Recommendation</div>
        <div style={{ fontSize: 13, color: '#1f2937', lineHeight: 1.5 }}>{recommendation}</div>
      </div>
    </div>
  );
}

function ProductRow({ rank, name, revenue, atcRate, accentColor, currencySymbol, currencyCode }) {
  const RANK_COLORS = ['#667eea', '#f59e0b', '#10b981', '#2ecc71', '#f97316'];
  const color = accentColor || RANK_COLORS[(rank - 1) % RANK_COLORS.length];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 24, height: 24, borderRadius: 6, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color, flexShrink: 0 }}>{rank}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text as="p" variant="bodySm" fontWeight="semibold">{name}</Text>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
          <div style={{ flex: 1, height: 4, background: '#f3f4f6', borderRadius: 3 }}>
            <div style={{ width: `${atcRate}%`, height: '100%', background: color, borderRadius: 3 }} />
          </div>
          <Text as="span" variant="bodyXs" tone="subdued">{atcRate}% ATC</Text>
        </div>
      </div>
      <Text as="span" variant="bodySm" fontWeight="semibold">{formatAmount(revenue, currencySymbol, currencyCode)}</Text>
    </div>
  );
}

function CouponRow({ rank, code, revenue, clicks, applied, currencySymbol, currencyCode }) {
  const COLORS = ['#f59e0b', '#10b981', '#1a9de0', '#2ecc71', '#f97316'];
  const color = COLORS[(rank - 1) % COLORS.length];
  const applyRate = clicks > 0 ? Math.round((applied / clicks) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 24, height: 24, borderRadius: 6, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color, flexShrink: 0 }}>{rank}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text as="p" variant="bodySm" fontWeight="semibold">{code}</Text>
          <Text as="span" variant="bodyXs" tone="subdued">{clicks.toLocaleString()} clicks</Text>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
          <div style={{ flex: 1, height: 4, background: '#f3f4f6', borderRadius: 3 }}>
            <div style={{ width: `${applyRate}%`, height: '100%', background: color, borderRadius: 3 }} />
          </div>
          <Text as="span" variant="bodyXs" tone="subdued">{applyRate}% applied</Text>
        </div>
      </div>
      <Text as="span" variant="bodySm" fontWeight="semibold">{formatAmount(revenue, currencySymbol, currencyCode)}</Text>
    </div>
  );
}

const ANALYTICS_TABS = [
  { id: 'overview',      content: 'Overview' },
  { id: 'combo-builder', content: 'Build A Combo' },
  { id: 'ai-insights',   content: '✦ AI Insights PRO' },
];

const Y_CURRENCY = (sym) => (v) => `${sym}${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`;

/* ─── main page ─────────────────────────────────────── */

export default function AnalyticsPage() {
  const { shop, initialAnalytics, initialAnalyticsError } = useLoaderData();
  const { symbol: currencySymbol, code: currencyCode } = useCurrency();

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

  const [analytics, setAnalytics] = useState({
    ...normalizeAnalyticsState(initialAnalytics),
    loading: false, error: Boolean(initialAnalyticsError),
  });
  const [comparison,   setComparison]   = useState({ ...DEFAULT_ANALYTICS });
  const [chartData,    setChartData]    = useState([]);
  const [chartLoading, setChartLoading] = useState(false);

  const hasAnyRealData =
    analytics.cartdrawer_total_revenue > 0 || analytics.checkout_click > 0 ||
    analytics.coupon_click > 0 || analytics.upsell_click > 0 ||
    analytics.cartdrawer_total_coupon_applied > 0 || analytics.upsell_revenue_generated > 0 ||
    chartData.some(d => d.revenue > 0 || d.checkoutClicks > 0);
  const sampleMode = !analytics.loading && !chartLoading && !hasAnyRealData;

  const A   = sampleMode ? SAMPLE_ANALYTICS : analytics;
  const CMP = sampleMode ? SAMPLE_PREV      : comparison;

  const aov     = A.checkout_click > 0 ? A.cartdrawer_total_revenue / A.checkout_click : 0;
  const prevAov = CMP.checkout_click > 0 ? CMP.cartdrawer_total_revenue / CMP.checkout_click : 0;

  const displayChart    = sampleMode ? SAMPLE_CHART : (chartData.length ? chartData : skeletonPoints());
  const aovChartData    = displayChart.map(d => ({ date: d.date, aov: d.checkoutClicks > 0 ? Math.round(d.revenue / d.checkoutClicks) : 0 }));
  const hasRevenue      = displayChart.some(d => d.revenue > 0);
  const upsellShare     = A.cartdrawer_total_revenue > 0 ? Math.round((A.upsell_revenue_generated / A.cartdrawer_total_revenue) * 100) : 0;
  const avgConvRate     = sampleMode ? Math.round(SAMPLE_CHART.reduce((s, d) => s + d.convRate, 0) / SAMPLE_CHART.length)     : (A.checkout_click > 0 ? 64 : 0);
  const avgCheckoutRate = sampleMode ? Math.round(SAMPLE_CHART.reduce((s, d) => s + d.checkoutRate, 0) / SAMPLE_CHART.length) : (A.checkout_click > 0 ? 35 : 0);

  const fetchAnalytics = useCallback(async (start, end) => {
    if (!shop) return;
    setAnalytics(prev => ({ ...prev, loading: true, error: false }));
    try {
      const res = await fetch(`/api/analytics?shop=${encodeURIComponent(shop)}&startDate=${formatLocalDate(start)}&endDate=${formatLocalDate(end)}`);
      if (!res.ok) throw new Error();
      const p = await res.json();
      if (!p?.success) throw new Error();
      setAnalytics({ ...normalizeAnalyticsState(p.data), loading: false, error: false });
    } catch {
      setAnalytics(prev => ({ ...prev, loading: false, error: true }));
    }
  }, [shop]);

  const fetchComparison = useCallback(async (start, end) => {
    if (!shop) return;
    const days = Math.round((new Date(end) - new Date(start)) / 86400000) + 1;
    const pe = new Date(start); pe.setDate(pe.getDate() - 1);
    const ps = new Date(pe);    ps.setDate(ps.getDate() - days + 1);
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
          return { date: shortLabel(date), revenue: d.cartdrawer_total_revenue, upsell: d.upsell_revenue_generated, coupons: d.cartdrawer_total_coupon_applied, checkoutClicks: d.checkout_click, couponClicks: d.coupon_click, upsellClicks: d.upsell_click, convRate: 0, checkoutRate: 0 };
        } catch { return null; }
      }));
      setChartData(results.filter(Boolean));
    } catch { setChartData([]); }
    finally { setChartLoading(false); }
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

  const dateLabel = activePreset || `${selectedDates.start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} – ${selectedDates.end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const overviewKpis = [
    { label: 'Total Revenue',    value: formatAmount(A.cartdrawer_total_revenue, currencySymbol, currencyCode),    change: pctChange(A.cartdrawer_total_revenue, CMP.cartdrawer_total_revenue),    icon: CashDollarIcon,    accent: '#008060', spark: displayChart, sparkKey: 'revenue' },
    { label: 'Upsell Revenue',   value: formatAmount(A.upsell_revenue_generated, currencySymbol, currencyCode),    change: pctChange(A.upsell_revenue_generated, CMP.upsell_revenue_generated),    icon: RewardIcon,        accent: '#2ecc71', spark: displayChart, sparkKey: 'upsell' },
    { label: 'Avg. Order Value', value: formatAmount(aov, currencySymbol, currencyCode),                           change: pctChange(aov, prevAov),                                               icon: CartIcon,          accent: '#1a9de0', spark: aovChartData, sparkKey: 'aov' },
    { label: 'Conversion Rate',  value: `${avgConvRate}%`,                                                         change: 4,                                                                     icon: ChartVerticalIcon, accent: '#059669', spark: displayChart, sparkKey: 'convRate' },
    { label: 'Checkout Rate',    value: `${avgCheckoutRate}%`,                                                     change: 2,                                                                     icon: CashDollarIcon,    accent: '#0ea5e9', spark: displayChart, sparkKey: 'checkoutRate' },
  ];

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

        {analytics.error && (
          <div style={{ padding: '12px 16px', background: '#fff4f4', border: '1px solid #fca5a5', borderRadius: '8px' }}>
            <Text variant="bodySm" tone="critical">Unable to fetch analytics data. Showing sample data instead.</Text>
          </div>
        )}
        {sampleMode && !analytics.error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', background: 'linear-gradient(135deg, #e8f9ff, #edfaf4)', border: '1px solid #c7d2fe', borderRadius: 10 }}>
            <span style={{ width: 22, height: 22, color: '#1a9de0', flexShrink: 0 }}><Icon source={InfoIcon} /></span>
            <Text as="span" variant="bodySm"><strong>Showing sample data.</strong> Your real numbers will appear here once your cart drawer starts recording activity.</Text>
          </div>
        )}

        {/* ══ OVERVIEW ══ */}
        {selectedTab === 0 && (
          <BlockStack gap="500">

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
              {overviewKpis.map(kpi => <KpiCard key={kpi.label} {...kpi} />)}
            </div>

            {/* Progress Tiers */}
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="050">
                  <Text as="h3" variant="headingMd">Progress Tiers</Text>
                  <Text as="p" variant="bodySm" tone="subdued">How many sessions reached each spend milestone in the cart drawer</Text>
                </BlockStack>
                {(() => {
                  const maxThreshold = MOCK_TIERS[MOCK_TIERS.length - 1].threshold;
                  return (
                    <div>
                      <div style={{ display: 'flex', marginBottom: 8 }}>
                        {MOCK_TIERS.map((tier, i) => {
                          const prev = i === 0 ? 0 : MOCK_TIERS[i - 1].threshold;
                          const w = ((tier.threshold - prev) / maxThreshold) * 100;
                          return (
                            <div key={`top-${tier.label}`} style={{ width: `${w}%`, textAlign: 'center', paddingBottom: 4 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: tier.color }}>{tier.label}</div>
                              <div style={{ fontSize: 11, color: '#9ca3af' }}>₹{tier.threshold.toLocaleString()}</div>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', height: 20, gap: 3 }}>
                        {MOCK_TIERS.map((tier, i) => {
                          const prev = i === 0 ? 0 : MOCK_TIERS[i - 1].threshold;
                          const w = ((tier.threshold - prev) / maxThreshold) * 100;
                          const radius = i === 0 ? '8px 0 0 8px' : i === MOCK_TIERS.length - 1 ? '0 8px 8px 0' : '0';
                          return <div key={`bar-${tier.label}`} style={{ width: `${w}%`, background: tier.color, borderRadius: radius, flexShrink: 0 }} />;
                        })}
                      </div>
                      <div style={{ display: 'flex', marginTop: 12 }}>
                        {MOCK_TIERS.map((tier, i) => {
                          const prev = i === 0 ? 0 : MOCK_TIERS[i - 1].threshold;
                          const w = ((tier.threshold - prev) / maxThreshold) * 100;
                          return (
                            <div key={`bot-${tier.label}`} style={{ width: `${w}%`, textAlign: 'center' }}>
                              <div style={{ fontSize: 26, fontWeight: 800, color: tier.color, lineHeight: 1 }}>{tier.reached.toLocaleString()}</div>
                              <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 3 }}>sessions reached</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
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
                  <ChangeBadge change={pctChange(A.cartdrawer_total_revenue, CMP.cartdrawer_total_revenue)} />
                </InlineStack>
                <div style={{ height: 260 }}>
                  {isClient && (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={displayChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="revTrend" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#008060" stopOpacity={0.18} />
                            <stop offset="95%" stopColor="#008060" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                        <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} dy={6} />
                        <YAxis fontSize={11} tickLine={false} axisLine={false} width={52} tickFormatter={Y_CURRENCY(currencySymbol)} />
                        <Tooltip formatter={(v) => [formatAmount(v, currencySymbol, currencyCode), 'Revenue']} />
                        <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#008060" strokeWidth={2.5} fill="url(#revTrend)" dot={false} activeDot={{ r: 5, fill: '#008060' }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
                {!hasRevenue && <div style={{ textAlign: 'center' }}><Text as="span" variant="bodySm" tone="subdued">No revenue data for this period.</Text></div>}
              </BlockStack>
            </Card>

            {/* Top Coupons + Top Upsell */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">Top Coupons</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Best performing coupons by revenue</Text>
                  </BlockStack>
                  <BlockStack gap="250">
                    {MOCK_TOP_COUPONS.map((c, i) => <CouponRow key={c.code} rank={i + 1} {...c} currencySymbol={currencySymbol} currencyCode={currencyCode} />)}
                  </BlockStack>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">Top Upsell Products</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Highest revenue upsells with add-to-cart rate</Text>
                  </BlockStack>
                  <BlockStack gap="250">
                    {MOCK_TOP_UPSELL.map((p, i) => <ProductRow key={p.name} rank={i + 1} {...p} currencySymbol={currencySymbol} currencyCode={currencyCode} />)}
                  </BlockStack>
                </BlockStack>
              </Card>
            </div>

            <SectionDivider label="FBT Analytics" />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">Top FBT Products</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Products generating the most revenue via FBT</Text>
                  </BlockStack>
                  <BlockStack gap="250">
                    {MOCK_FBT_PRODUCTS.map((p, i) => <ProductRow key={p.name} rank={i + 1} {...p} accentColor="#2ecc71" currencySymbol={currencySymbol} currencyCode={currencyCode} />)}
                  </BlockStack>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">Store Revenue vs Upsell Revenue</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Upsell contribution to your total store revenue</Text>
                  </BlockStack>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div style={{ padding: '14px', borderRadius: 10, background: '#f9fafb', border: '1px solid #f3f4f6', textAlign: 'center' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Store Revenue</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: '#111827', lineHeight: 1 }}>{formatAmount(A.cartdrawer_total_revenue, currencySymbol, currencyCode)}</div>
                    </div>
                    <div style={{ padding: '14px', borderRadius: 10, background: '#faf5ff', border: '1px solid #ede9fe', textAlign: 'center' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#2ecc71', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Upsell Revenue</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: '#7c3aed', lineHeight: 1 }}>{formatAmount(A.upsell_revenue_generated, currencySymbol, currencyCode)}</div>
                      <div style={{ fontSize: 11, color: '#2ecc71', marginTop: 5 }}>{upsellShare}% of store revenue</div>
                    </div>
                  </div>
                  <div>
                    <div style={{ height: 10, borderRadius: 6, background: '#f3f4f6', overflow: 'hidden' }}>
                      <div style={{ width: `${upsellShare}%`, height: '100%', background: 'linear-gradient(90deg, #2ecc71, #7c3aed)', borderRadius: 6 }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                      <Text as="span" variant="bodyXs" tone="subdued">Upsell {upsellShare}%</Text>
                      <Text as="span" variant="bodyXs" tone="subdued">Other {100 - upsellShare}%</Text>
                    </div>
                  </div>
                  <div style={{ padding: '12px 14px', borderRadius: 9, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#166534' }}>
                      🎉 Upsell drives {upsellShare}% of your store revenue
                    </div>
                    <div style={{ fontSize: 12, color: '#15803d', marginTop: 3, lineHeight: 1.5 }}>
                      {upsellShare >= 15 ? 'Above the 15% industry benchmark — your upsell placement is working great.' : 'Add upsell recommendations to 2–3 more products to reach the 15% industry benchmark.'}
                    </div>
                  </div>
                </BlockStack>
              </Card>
            </div>

            <SectionDivider label="Coupon Banner Analytics" />

            <Card>
              <BlockStack gap="300">
                <BlockStack gap="050">
                  <Text as="h3" variant="headingMd">Top Coupons by Banner</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Revenue, clicks and apply rate for each active coupon banner</Text>
                </BlockStack>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #f3f4f6' }}>
                        {['#', 'Coupon Code', 'Revenue', 'Clicks', 'Applied', 'Apply Rate'].map(h => (
                          <th key={h} style={{ textAlign: h === 'Coupon Code' || h === '#' ? 'left' : 'right', padding: '8px 12px', fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {MOCK_TOP_COUPONS.map((c, i) => {
                        const applyRate = c.clicks > 0 ? Math.round((c.applied / c.clicks) * 100) : 0;
                        return (
                          <tr key={c.code} style={{ borderBottom: '1px solid #f9fafb' }}>
                            <td style={{ padding: '10px 12px', color: '#9ca3af', fontWeight: 700, fontSize: 12 }}>{i + 1}</td>
                            <td style={{ padding: '10px 12px' }}><span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, background: '#f3f4f6', padding: '3px 8px', borderRadius: 6 }}>{c.code}</span></td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#008060' }}>{formatAmount(c.revenue, currencySymbol, currencyCode)}</td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', color: '#374151' }}>{c.clicks.toLocaleString()}</td>
                            <td style={{ padding: '10px 12px', textAlign: 'right', color: '#374151' }}>{c.applied.toLocaleString()}</td>
                            <td style={{ padding: '10px 12px', textAlign: 'right' }}><span style={{ fontSize: 12, fontWeight: 700, color: applyRate >= 40 ? '#059669' : '#d97706' }}>{applyRate}%</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </BlockStack>
            </Card>

          </BlockStack>
        )}

        {/* ══ BUILD A COMBO ══ */}
        {selectedTab === 1 && (
          <BlockStack gap="400">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {[
                { label: 'Bundle Revenue',   value: formatAmount(40700, currencySymbol, currencyCode),  change: 18, icon: CashDollarIcon, accent: '#7c3aed' },
                { label: 'Store Revenue',    value: formatAmount(126040, currencySymbol, currencyCode), change: 11, icon: CartIcon,        accent: '#008060' },
                { label: 'Add to Cart Rate', value: '62%',                                              change: 5,  icon: RewardIcon,     accent: '#f59e0b' },
              ].map(kpi => (
                <div key={kpi.label} style={{ background: '#fff', borderRadius: 14, padding: '20px', border: '1px solid #e1e3e5', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="150" blockAlign="center">
                      <span style={{ width: 30, height: 30, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: `${kpi.accent}18`, color: kpi.accent }}>
                        <span style={{ width: 16, height: 16 }}><Icon source={kpi.icon} /></span>
                      </span>
                      <Text as="p" variant="bodySm" tone="subdued">{kpi.label}</Text>
                    </InlineStack>
                    <ChangeBadge change={kpi.change} />
                  </InlineStack>
                  <div style={{ marginTop: 16 }}><Text as="p" variant="heading2xl" fontWeight="bold">{kpi.value}</Text></div>
                </div>
              ))}
            </div>

            {/* Store Revenue vs Bundle Revenue */}
            {(() => {
              const bundleRevenue = 40700;
              const storeRevenue  = 126040;
              const bundleShare   = Math.round((bundleRevenue / storeRevenue) * 100);
              return (
                <Card>
                  <BlockStack gap="300">
                    <BlockStack gap="050">
                      <Text as="h3" variant="headingMd">Store Revenue vs Bundle Revenue</Text>
                      <Text as="p" variant="bodySm" tone="subdued">How much of your total revenue comes from Build A Combo bundles</Text>
                    </BlockStack>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div style={{ padding: '16px', borderRadius: 10, background: '#f9fafb', border: '1px solid #f3f4f6', textAlign: 'center' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Store Revenue</div>
                        <div style={{ fontSize: 28, fontWeight: 800, color: '#111827', lineHeight: 1 }}>{formatAmount(storeRevenue, currencySymbol, currencyCode)}</div>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 5 }}>Total this period</div>
                      </div>
                      <div style={{ padding: '16px', borderRadius: 10, background: '#edfaf4', border: '1px solid #ddd6fe', textAlign: 'center' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Bundle Revenue</div>
                        <div style={{ fontSize: 28, fontWeight: 800, color: '#1a9de0', lineHeight: 1 }}>{formatAmount(bundleRevenue, currencySymbol, currencyCode)}</div>
                        <div style={{ fontSize: 11, color: '#7c3aed', marginTop: 5 }}>{bundleShare}% of store revenue</div>
                      </div>
                    </div>

                    <div>
                      <div style={{ height: 10, borderRadius: 6, background: '#f3f4f6', overflow: 'hidden' }}>
                        <div style={{ width: `${bundleShare}%`, height: '100%', background: 'linear-gradient(90deg, #7c3aed, #1a9de0)', borderRadius: 6, transition: 'width 0.6s ease' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                        <Text as="span" variant="bodyXs" tone="subdued">Bundles {bundleShare}%</Text>
                        <Text as="span" variant="bodyXs" tone="subdued">Other {100 - bundleShare}%</Text>
                      </div>
                    </div>

                    <div style={{ padding: '12px 14px', borderRadius: 9, background: '#edfaf4', border: '1px solid #ddd6fe' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#4c1d95' }}>
                        🎉 Bundles contribute {bundleShare}% of your store revenue
                      </div>
                      <div style={{ fontSize: 12, color: '#1a9de0', marginTop: 3, lineHeight: 1.5 }}>
                        {bundleShare >= 25 ? 'Excellent — bundles are a major revenue driver. Keep expanding your combo library.' : 'Add bundles to your top 3 collection pages to push this higher.'}
                      </div>
                    </div>

                    <div>
                      <Text as="p" variant="bodyXs" tone="subdued" fontWeight="semibold">Daily bundle revenue vs store revenue</Text>
                      <div style={{ height: 140, marginTop: 8 }}>
                        {isClient && (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={MOCK_STORE_VS_BUNDLE} margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                              <XAxis dataKey="date" fontSize={10} tickLine={false} axisLine={false} />
                              <YAxis fontSize={10} tickLine={false} axisLine={false} width={44} tickFormatter={Y_CURRENCY(currencySymbol)} />
                              <Tooltip formatter={(v, name) => [formatAmount(v, currencySymbol, currencyCode), name]} />
                              <Bar dataKey="store"  name="Store Revenue"  fill="#d4f1fe" radius={[3,3,0,0]} maxBarSize={30} />
                              <Bar dataKey="bundle" name="Bundle Revenue" fill="#7c3aed" radius={[3,3,0,0]} maxBarSize={30} />
                            </BarChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    </div>
                  </BlockStack>
                </Card>
              );
            })()}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">Top Products</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Best performing products across all bundle pages</Text>
                  </BlockStack>
                  <BlockStack gap="250">
                    {MOCK_TOP_BUNDLE_PRODUCTS.map((p, i) => <ProductRow key={p.name} rank={i + 1} {...p} accentColor="#7c3aed" currencySymbol={currencySymbol} currencyCode={currencyCode} />)}
                  </BlockStack>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="300">
                  <BlockStack gap="050">
                    <Text as="h3" variant="headingMd">Top Bundle Pages</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Pages with the highest bundle interaction and conversion</Text>
                  </BlockStack>
                  <BlockStack gap="250">
                    {MOCK_TOP_BUNDLE_PAGES.map((page, i) => {
                      const COLORS = ['#667eea', '#f59e0b', '#10b981', '#2ecc71'];
                      const color = COLORS[i % COLORS.length];
                      return (
                        <div key={page.page} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                          <div style={{ width: 24, height: 24, borderRadius: 6, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color, flexShrink: 0, marginTop: 2 }}>{i + 1}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{page.page}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                              <Text as="span" variant="bodyXs" tone="subdued">{page.views.toLocaleString()} views</Text>
                              <span style={{ color: '#d1d5db', fontSize: 10 }}>·</span>
                              <Text as="span" variant="bodyXs" tone="subdued">{page.bundles.toLocaleString()} bundles</Text>
                              <span style={{ color: '#d1d5db', fontSize: 10 }}>·</span>
                              <span style={{ fontSize: 11, fontWeight: 700, color }}>{page.cvr}% CVR</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </BlockStack>
                </BlockStack>
              </Card>
            </div>

            <Card>
              <BlockStack gap="300">
                <BlockStack gap="050">
                  <Text as="h3" variant="headingMd">Top Combos</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Most clicked product combinations and their revenue contribution</Text>
                </BlockStack>
                <BlockStack gap="250">
                  {MOCK_COMBO_TRENDS.map((combo, i) => {
                    const maxClicks = MOCK_COMBO_TRENDS[0].clicks;
                    const pct = Math.round((combo.clicks / maxClicks) * 100);
                    const COLORS = ['#7c3aed', '#1a9de0', '#2ecc71', '#a78bfa', '#7dd3fc'];
                    const color = COLORS[i];
                    return (
                      <div key={combo.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 24, height: 24, borderRadius: 6, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color, flexShrink: 0 }}>{i + 1}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                            <Text as="span" variant="bodySm" fontWeight="semibold">{combo.name}</Text>
                            <Text as="span" variant="bodyXs" tone="subdued">{combo.clicks.toLocaleString()} clicks</Text>
                          </div>
                          <div style={{ height: 6, borderRadius: 3, background: '#f3f4f6' }}>
                            <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: color }} />
                          </div>
                        </div>
                        <Text as="span" variant="bodySm" fontWeight="semibold">{formatAmount(combo.revenue, currencySymbol, currencyCode)}</Text>
                      </div>
                    );
                  })}
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
                <div style={{ fontSize: 13, color: '#a5b4fc' }}>Actionable recommendations generated from your store's analytics data</div>
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: '#818cf8', fontWeight: 600 }}>Sample insights</div>
                <div style={{ fontSize: 11, color: '#1a9de0', marginTop: 2 }}>Live AI integration coming soon</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
              {MOCK_INSIGHTS.map(insight => <InsightCard key={insight.id} {...insight} />)}
            </div>
          </BlockStack>
        )}

      </BlockStack>
      <div style={{ height: 72 }} />
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
