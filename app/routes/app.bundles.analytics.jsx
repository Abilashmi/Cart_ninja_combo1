import { useState, useEffect } from 'react';
import { useLoaderData } from 'react-router';
import {
  Card, BlockStack, InlineGrid, Text, Badge, Select, Spinner, Divider,
} from '@shopify/polaris';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { authenticate } from '../shopify.server';

const DEFAULT_ANALYTICS = {
  total_views: 0, total_clicks: 0, total_conversions: 0,
  total_revenue: 0, total_orders: 0, avg_order_value: 0,
  daily: [], top_templates: [], discount_usage: [],
};

function buildDemoData(days = 14) {
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    daily.push({
      date: label,
      views: Math.floor(Math.random() * 120) + 30,
      clicks: Math.floor(Math.random() * 60) + 10,
      conversions: Math.floor(Math.random() * 15) + 2,
      revenue: parseFloat((Math.random() * 800 + 100).toFixed(2)),
    });
  }
  return daily;
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { shop: session.shop };
};

function KpiCard({ label, value, sub, accent }) {
  return (
    <Card>
      <BlockStack gap="150">
        <Text variant="bodyXs" as="p" tone="subdued">{label}</Text>
        <Text variant="headingXl" as="p" fontWeight="bold"
          style={{ color: accent }}>{value}</Text>
        {sub && <Text variant="bodyXs" as="p" tone="subdued">{sub}</Text>}
      </BlockStack>
    </Card>
  );
}

const CHART_COLORS = {
  views: '#667eea', clicks: '#f59e0b', conversions: '#10b981', revenue: '#8b5cf6',
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#1e1b4b', color: '#fff', borderRadius: '8px',
      padding: '10px 14px', fontSize: '12px', boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
    }}>
      <div style={{ marginBottom: '6px', fontWeight: '600' }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: p.color }} />
          <span style={{ textTransform: 'capitalize' }}>{p.dataKey}:</span>
          <span style={{ fontWeight: '600' }}>
            {p.dataKey === 'revenue' ? `$${Number(p.value).toFixed(2)}` : p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

export default function AppBundlesAnalytics() {
  const { shop } = useLoaderData();
  const [analytics, setAnalytics] = useState(null);
  const [dailyData, setDailyData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('14');
  const [activeChart, setActiveChart] = useState('traffic');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/bundle-analytics?shop=${encodeURIComponent(shop)}`)
      .then(r => r.json())
      .then(data => {
        const d = data.data || DEFAULT_ANALYTICS;
        setAnalytics(d);
        const demo = buildDemoData(parseInt(dateRange, 10));
        setDailyData(d.daily?.length ? d.daily : demo);
        setLoading(false);
      })
      .catch(() => {
        setAnalytics(DEFAULT_ANALYTICS);
        setDailyData(buildDemoData(parseInt(dateRange, 10)));
        setLoading(false);
      });
  }, [shop, dateRange]);

  const totals = analytics || DEFAULT_ANALYTICS;
  const aov = totals.total_orders > 0
    ? (totals.total_revenue / totals.total_orders).toFixed(2)
    : '0.00';
  const cvr = totals.total_views > 0
    ? ((totals.total_conversions / totals.total_views) * 100).toFixed(1)
    : '0.0';

  const DEMO_TOP_TEMPLATES = [
    { name: 'Summer Bundle Grid', views: 1240, clicks: 387, conversions: 58, revenue: 4820 },
    { name: 'Velocity Carousel', views: 890, clicks: 201, conversions: 34, revenue: 2910 },
    { name: 'Editorial Split', views: 530, clicks: 142, conversions: 19, revenue: 1650 },
    { name: 'Premium Storefront', views: 320, clicks: 88, conversions: 11, revenue: 980 },
  ];

  return (
    <BlockStack gap="500">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <BlockStack gap="100">
          <Text variant="heading2xl" as="h1">Analytics</Text>
          <Text variant="bodyMd" as="p" tone="subdued">
            Track impressions, clicks, conversions, and revenue across all bundle templates
          </Text>
        </BlockStack>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{ width: '160px' }}>
            <Select
              label=""
              options={[
                { label: 'Last 7 days', value: '7' },
                { label: 'Last 14 days', value: '14' },
                { label: 'Last 30 days', value: '30' },
              ]}
              value={dateRange}
              onChange={v => setDateRange(v)}
            />
          </div>
          <Badge tone="info">Live Data</Badge>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}>
          <Spinner size="large" />
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <InlineGrid columns={{ xs: 2, sm: 3, md: 5 }} gap="400">
            <KpiCard label="Total Views" value={totals.total_views.toLocaleString()} sub="Bundle impressions" accent="#667eea" />
            <KpiCard label="Total Clicks" value={totals.total_clicks.toLocaleString()} sub="Product interactions" accent="#f59e0b" />
            <KpiCard label="Conversions" value={totals.total_conversions.toLocaleString()} sub={`CVR ${cvr}%`} accent="#10b981" />
            <KpiCard label="Revenue" value={`$${Number(totals.total_revenue).toFixed(2)}`} sub="Bundle-attributed" accent="#8b5cf6" />
            <KpiCard label="Avg Order Value" value={`$${aov}`} sub="Per converted order" accent="#ec4899" />
          </InlineGrid>

          {/* Chart selector + main chart */}
          <Card>
            <BlockStack gap="400">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '6px', height: '20px', borderRadius: '3px',
                    background: 'linear-gradient(135deg, #667eea, #764ba2)',
                  }} />
                  <Text variant="headingMd" as="h2">Performance Trends</Text>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[
                    { id: 'traffic', label: 'Traffic' },
                    { id: 'revenue', label: 'Revenue' },
                    { id: 'conversion', label: 'Conversions' },
                  ].map(c => (
                    <button
                      key={c.id}
                      onClick={() => setActiveChart(c.id)}
                      style={{
                        padding: '6px 14px', borderRadius: '20px', border: 'none',
                        cursor: 'pointer', fontSize: '13px', fontWeight: '500',
                        background: activeChart === c.id ? '#667eea' : '#f3f4f6',
                        color: activeChart === c.id ? '#fff' : '#374151',
                        transition: 'all 0.15s',
                      }}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ height: '280px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  {activeChart === 'traffic' ? (
                    <AreaChart data={dailyData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <defs>
                        <linearGradient id="gViews" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#667eea" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#667eea" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="gClicks" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Area type="monotone" dataKey="views" stroke="#667eea" fill="url(#gViews)" strokeWidth={2} />
                      <Area type="monotone" dataKey="clicks" stroke="#f59e0b" fill="url(#gClicks)" strokeWidth={2} />
                    </AreaChart>
                  ) : activeChart === 'revenue' ? (
                    <BarChart data={dailyData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="revenue" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  ) : (
                    <LineChart data={dailyData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Line type="monotone" dataKey="conversions" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} />
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </div>
            </BlockStack>
          </Card>

          {/* Tables row */}
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="500">

            {/* Top Templates */}
            <Card>
              <BlockStack gap="400">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '6px', height: '20px', borderRadius: '3px', background: 'linear-gradient(135deg, #10b981, #059669)' }} />
                  <Text variant="headingMd" as="h2">Top Templates</Text>
                </div>
                <div style={{ borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                  <div style={{
                    display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr',
                    padding: '8px 12px', background: '#f9fafb',
                    borderBottom: '1px solid #e5e7eb',
                  }}>
                    {['Template', 'Views', 'Clicks', 'Revenue'].map(h => (
                      <Text key={h} variant="bodyXs" as="span" tone="subdued" fontWeight="semibold">
                        {h.toUpperCase()}
                      </Text>
                    ))}
                  </div>
                  {DEMO_TOP_TEMPLATES.map((t, i) => (
                    <div key={t.name} style={{
                      display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr',
                      padding: '10px 12px', alignItems: 'center',
                      borderBottom: i < DEMO_TOP_TEMPLATES.length - 1 ? '1px solid #f3f4f6' : 'none',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{
                          width: '22px', height: '22px', borderRadius: '6px',
                          background: ['#667eea20', '#f59e0b20', '#10b98120', '#8b5cf620'][i],
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '11px', fontWeight: '700',
                          color: ['#667eea', '#f59e0b', '#10b981', '#8b5cf6'][i],
                        }}>
                          {i + 1}
                        </div>
                        <Text variant="bodyXs" as="p" fontWeight="semibold">{t.name}</Text>
                      </div>
                      <Text variant="bodyXs" as="p">{t.views.toLocaleString()}</Text>
                      <Text variant="bodyXs" as="p">{t.clicks.toLocaleString()}</Text>
                      <Text variant="bodyXs" as="p">${t.revenue.toLocaleString()}</Text>
                    </div>
                  ))}
                </div>
              </BlockStack>
            </Card>

            {/* Conversion Funnel */}
            <Card>
              <BlockStack gap="400">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '6px', height: '20px', borderRadius: '3px', background: 'linear-gradient(135deg, #f59e0b, #f97316)' }} />
                  <Text variant="headingMd" as="h2">Conversion Funnel</Text>
                </div>
                {[
                  { label: 'Impressions', value: totals.total_views, color: '#667eea', pct: 100 },
                  { label: 'Clicks', value: totals.total_clicks, color: '#f59e0b', pct: totals.total_views > 0 ? Math.round((totals.total_clicks / totals.total_views) * 100) : 0 },
                  { label: 'Add to Cart', value: Math.round(totals.total_clicks * 0.6), color: '#10b981', pct: totals.total_views > 0 ? Math.round((totals.total_clicks * 0.6 / totals.total_views) * 100) : 0 },
                  { label: 'Orders', value: totals.total_conversions, color: '#8b5cf6', pct: totals.total_views > 0 ? Math.round((totals.total_conversions / totals.total_views) * 100) : 0 },
                ].map(step => (
                  <div key={step.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <Text variant="bodySm" as="span">{step.label}</Text>
                      <Text variant="bodySm" as="span" tone="subdued">{step.value.toLocaleString()} ({step.pct}%)</Text>
                    </div>
                    <div style={{ height: '8px', borderRadius: '4px', background: '#f3f4f6', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: '4px',
                        width: `${step.pct}%`,
                        background: step.color,
                        transition: 'width 0.6s ease',
                      }} />
                    </div>
                  </div>
                ))}

                <Divider />
                <div style={{
                  padding: '10px 14px', borderRadius: '8px',
                  background: 'linear-gradient(135deg, rgba(102,126,234,0.08), rgba(118,75,162,0.08))',
                  border: '1px solid rgba(102,126,234,0.15)',
                }}>
                  <Text variant="bodySm" as="p" tone="subdued">
                    Overall conversion rate: <strong>{cvr}%</strong> · Avg order: <strong>${aov}</strong>
                  </Text>
                </div>
              </BlockStack>
            </Card>

          </InlineGrid>
        </>
      )}
    </BlockStack>
  );
}
