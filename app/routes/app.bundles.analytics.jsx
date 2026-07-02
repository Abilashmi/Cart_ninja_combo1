import { useState, useEffect, useCallback } from 'react';
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

function dateRangeToDates(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days + 1);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { startDate: fmt(start), endDate: fmt(end) };
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

function EmptyNote({ message }) {
  return (
    <div style={{ textAlign: 'center', padding: '24px 12px' }}>
      <Text as="span" variant="bodySm" tone="subdued">{message}</Text>
    </div>
  );
}

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
  const [funnel, setFunnel] = useState({ cart_creates: 0, loading: false });

  const fetchFunnel = useCallback(async (days) => {
    if (!shop) return;
    setFunnel(prev => ({ ...prev, loading: true }));
    try {
      const { startDate, endDate } = dateRangeToDates(parseInt(days, 10));
      const res = await fetch(`/api/analytics/funnel?startDate=${startDate}&endDate=${endDate}`);
      const p = await res.json();
      setFunnel({ cart_creates: (res.ok && p?.success) ? p.data.cart_creates : 0, loading: false });
    } catch {
      setFunnel({ cart_creates: 0, loading: false });
    }
  }, [shop]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/bundle-analytics?days=${dateRange}`)
      .then(r => r.json())
      .then(data => {
        const d = data.data || DEFAULT_ANALYTICS;
        setAnalytics(d);
        setDailyData(d.daily || []);
        setLoading(false);
      })
      .catch(() => {
        setAnalytics(DEFAULT_ANALYTICS);
        setDailyData([]);
        setLoading(false);
      });
    fetchFunnel(dateRange);
  }, [dateRange, fetchFunnel]);

  const totals = analytics || DEFAULT_ANALYTICS;
  const aov = totals.total_orders > 0
    ? (totals.total_revenue / totals.total_orders).toFixed(2)
    : '0.00';
  const cvr = totals.total_views > 0
    ? ((totals.total_conversions / totals.total_views) * 100).toFixed(1)
    : '0.0';

  const topTemplates = totals.top_templates || [];

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
                {dailyData.length > 0 ? (
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
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                    <EmptyNote message="No activity in this range yet." />
                  </div>
                )}
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
                {topTemplates.length > 0 ? (
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
                    {topTemplates.map((t, i) => (
                      <div key={t.template_id || t.name || i} style={{
                        display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr',
                        padding: '10px 12px', alignItems: 'center',
                        borderBottom: i < topTemplates.length - 1 ? '1px solid #f3f4f6' : 'none',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div style={{
                            width: '22px', height: '22px', borderRadius: '6px',
                            background: ['#667eea20', '#f59e0b20', '#10b98120', '#8b5cf620'][i % 4],
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '11px', fontWeight: '700',
                            color: ['#667eea', '#f59e0b', '#10b981', '#8b5cf6'][i % 4],
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
                ) : <EmptyNote message="No template activity yet in this range." />}
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
                  { label: 'Add to Cart', value: funnel.cart_creates, color: '#10b981', pct: totals.total_views > 0 ? Math.round((funnel.cart_creates / totals.total_views) * 100) : 0 },
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
                <Text as="p" variant="bodyXs" tone="subdued">&quot;Add to Cart&quot; reflects storefront cart activity signals, which may under-report on some stores — treat as directional.</Text>

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
