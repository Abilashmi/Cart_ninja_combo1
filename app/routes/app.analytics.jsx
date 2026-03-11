import React, { useState, useCallback, useEffect } from 'react';
import { Outlet, useLoaderData, useRouteError, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  DatePicker,
  Popover,
  IndexTable,
  Badge,
  Box,
  Button,
  Tabs,
  ProgressBar,
  Banner,
  Select,
  Divider,
  Grid,
  Thumbnail,
  TextField,
  Icon,
} from '@shopify/polaris';
import { CalendarIcon, CheckCircleIcon, PlayIcon, ExternalIcon, ClockIcon, ArrowRightIcon } from '@shopify/polaris-icons';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  BarChart,
  Bar,
  ComposedChart,
  Line
} from 'recharts';
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return { shop: session.shop };
};

// More granular mock data for professional feel
const FEATURE_DATA = [
  { name: 'Feb 01', revenue: 240, clicks: 120, ctr: 5.2 },
  { name: 'Feb 02', revenue: 380, clicks: 190, ctr: 6.8 },
  { name: 'Feb 03', revenue: 300, clicks: 150, ctr: 5.9 },
  { name: 'Feb 04', revenue: 520, clicks: 260, ctr: 8.4 },
  { name: 'Feb 05', revenue: 460, clicks: 230, ctr: 7.2 },
  { name: 'Feb 06', revenue: 820, clicks: 410, ctr: 12.5 },
  { name: 'Feb 07', revenue: 740, clicks: 370, trend: '+11.2%' },
];

const PROGRESS_BAR_DATA = [
  { name: 'Abandoned', value: 30 }, { name: 'Completed', value: 70 },
];

const COLORS = ['#008060', '#005ea2', '#9c6ade', '#e29100'];

export default function AppAnalytics() {
  const { shop } = useLoaderData();

  const navigate = useNavigate();
  const [selectedTab, setSelectedTab] = useState(0);
  const [popoverActive, setPopoverActive] = useState(false);
  const [{ month, year }, setMonth] = useState({ month: 2, year: 2026 });
  const [selectedDates, setSelectedDates] = useState({
    start: new Date('2026-03-04'),
    end: new Date('2026-03-04'),
  });

  // Advanced Date Picker State
  const [tempDates, setTempDates] = useState(selectedDates);
  const [activePreset, setActivePreset] = useState('Today');
  const [selectionMode, setSelectionMode] = useState(0); // 0 for Fixed, 1 for Rolling

  const presets = [
    { label: 'Today', range: { start: new Date('2026-03-04'), end: new Date('2026-03-04') } },
    { label: 'Yesterday', range: { start: new Date('2026-03-03'), end: new Date('2026-03-03') } },
    { label: 'Last 7 days', range: { start: new Date('2026-02-26'), end: new Date('2026-03-04') } },
    { label: 'Last 30 days', range: { start: new Date('2026-02-02'), end: new Date('2026-03-04') } },
    { label: 'Last 90 days', range: { start: new Date('2025-12-04'), end: new Date('2026-03-04') } },
    { label: 'Last 12 months', range: { start: new Date('2025-03-04'), end: new Date('2026-03-04') } },
  ];

  const [isClient, setIsClient] = useState(false);

  const [analytics, setAnalytics] = useState({
    checkout_click: 0,
    coupon_click: 0,
    upsell_click: 0,
    loading: true,
    error: false
  });

  const fetchAnalytics = useCallback(async () => {
    setAnalytics(prev => ({ ...prev, loading: true, error: false }));
    try {
      const response = await fetch(`https://7d56-103-130-91-50.ngrok-free.ap/analytics.php?shop=${shop}`);
      if (!response.ok) throw new Error("Fetch failed");
      const data = await response.json();
      setAnalytics({
        ...data,
        loading: false,
        error: false
      });
    } catch (err) {
      console.error("Client-side fetch error:", err);
      setAnalytics(prev => ({ ...prev, loading: false, error: true }));
    }
  }, []);

  useEffect(() => {
    setIsClient(true);
    fetchAnalytics();
  }, [fetchAnalytics]);

  const [setupSteps, setSetupSteps] = useState([
    { id: 1, title: 'Step 1: Create Coupon', icon: '🎫', content: 'Add coupons to your slide-out drawer to boost conversions.', completed: false, target: '/app/coupons' },
    { id: 2, title: 'Step 2: Configure Product Widget', icon: '🛍️', content: 'Setup Frequently Bought Together and Upsell widgets.', completed: false, target: '/app/productwidget' },
    { id: 3, title: 'Step 3: Configure Cart Drawer', icon: '🛒', content: 'Customize and enable your high-converting cart drawer.', completed: false, target: '/app/cartdrawer' },
  ]);

  const togglePopoverActive = useCallback(() => setPopoverActive((active) => !active), []);
  const handleMonthChange = useCallback((month, year) => setMonth({ month, year }), []);
  const handleTabChange = useCallback((selectedTabIndex) => setSelectedTab(selectedTabIndex), []);

  const handlePresetClick = (preset) => {
    setActivePreset(preset.label);
    setTempDates(preset.range);
    setMonth({ month: preset.range.start.getMonth(), year: preset.range.start.getFullYear() });
  };

  const handleApply = () => {
    setSelectedDates(tempDates);
    setPopoverActive(false);
  };

  const handleCancel = () => {
    setTempDates(selectedDates);
    setPopoverActive(false);
  };

  const handleStepComplete = (id) => {
    setSetupSteps(setupSteps.map(step => step.id === id ? { ...step, completed: !step.completed } : step));
  };

  const completedSteps = setupSteps.filter(step => step.completed).length;
  const progress = (completedSteps / setupSteps.length) * 100;

  const dateValue = activePreset || `${selectedDates.start.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} - ${selectedDates.end.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;

  const tabs = [
    { id: 'analytics', content: 'Analytics' },
    { id: 'setup', content: 'Setup Checklist' },
    { id: 'guide', content: 'How To Use' },
  ];

  const renderFeatureSection = (title, color, kpis) => (
    <BlockStack gap="400">
      <Box paddingBlockStart="500">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingLg" fontWeight="bold">{title}</Text>
          <Badge tone="success">Active</Badge>
        </InlineStack>
      </Box>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' }}>
        {kpis.map((kpi, index) => (
          <Card key={index} padding="400">
            <BlockStack gap="100">
              <Text variant="bodySm" tone="subdued" fontWeight="medium">{kpi.title}</Text>
              <Text variant="headingXl" fontWeight="bold">{kpi.value}</Text>
              <InlineStack gap="100" blockAlign="center">
                <Text variant="bodySm" tone={kpi.trend.startsWith('+') ? 'success' : 'critical'}>
                  {kpi.trend}
                </Text>
                <Text variant="bodySm" tone="subdued">vs previous period</Text>
              </InlineStack>
            </BlockStack>
          </Card>
        ))}
      </div>
      <Card padding="500">
        <BlockStack gap="400">
          <InlineStack align="space-between">
            <Text variant="headingMd" fontWeight="bold">Performance Breakdown</Text>
            <InlineStack gap="200">
              <Badge tone="info">Revenue (Bar)</Badge>
              <Badge tone="attention">CTR (Line)</Badge>
            </InlineStack>
          </InlineStack>
          <div style={{ width: '100%', height: 350 }}>
            {isClient && (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={FEATURE_DATA}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E1E3E5" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6D7175' }} />
                  <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6D7175' }} label={{ value: 'Revenue (₹)', angle: -90, position: 'insideLeft', fill: '#6D7175' }} />
                  <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6D7175' }} label={{ value: 'CTR %', angle: 90, position: 'insideRight', fill: '#6D7175' }} />
                  <Tooltip
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                    cursor={{ fill: '#F6F6F7' }}
                  />
                  <Bar yAxisId="left" dataKey="revenue" barSize={40} fill={color} radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="left" dataKey="clicks" barSize={40} fill={color} radius={[4, 4, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="ctr" stroke="#e29100" strokeWidth={3} dot={{ r: 4, fill: '#e29100' }} activeDot={{ r: 6 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </BlockStack>
      </Card>
      <Divider />
    </BlockStack>
  );

  const renderShippingSection = () => (
    <BlockStack gap="400">
      <Box paddingBlockStart="500">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingLg" fontWeight="bold">Progress Bar Analytics</Text>
          <Badge tone="info">Optimization</Badge>
        </InlineStack>
      </Box>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
        <Card padding="400">
          <BlockStack gap="100">
            <Text variant="bodySm" tone="subdued">Average Order Value Lift</Text>
            <Text variant="headingXl" fontWeight="bold">₹850.40</Text>
            <Text variant="bodySm" tone="success">+18.2% boost</Text>
          </BlockStack>
        </Card>
        <Card padding="400">
          <BlockStack gap="100">
            <Text variant="bodySm" tone="subdued">Goal Completion Rate</Text>
            <Text variant="headingXl" fontWeight="bold">72.4%</Text>
            <Text variant="bodySm" tone="success">+4.5% improvement</Text>
          </BlockStack>
        </Card>
      </div>
      <Layout>
        <Layout.Section>
          <Card padding="500">
            <BlockStack gap="400">
              <Text variant="headingMd" fontWeight="bold">Conversion Impact by Threshold</Text>
              <div style={{ width: '100%', height: 300 }}>
                {isClient && (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={FEATURE_DATA}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E1E3E5" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} />
                      <YAxis axisLine={false} tickLine={false} />
                      <Tooltip cursor={{ fill: '#F6F6F7' }} />
                      <Bar dataKey="revenue" fill="#e29100" radius={[4, 4, 0, 0]} barSize={30} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <Card padding="500">
            <BlockStack gap="400">
              <Text variant="headingMd" fontWeight="bold">Customer Progress</Text>
              <div style={{ width: '100%', height: 200 }}>
                {isClient && (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={PROGRESS_BAR_DATA}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        dataKey="value"
                        paddingAngle={5}
                      >
                        {PROGRESS_BAR_DATA.map((entry, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                      <Legend verticalAlign="bottom" height={36} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              <Box paddingBlockStart="400">
                <Text variant="bodySm" tone="subdued">
                  70% of customers who see the progress bar reach the free shipping threshold.
                </Text>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </BlockStack>
  );

  const renderSetup = () => {
    // Correct URL for app embed in customizer
    const customizerUrl = `https://${shop}/admin/themes/current/editor?context=apps`;

    return (
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd" fontWeight="bold">Step-by-Step Installation Guide</Text>
            <Box padding="200" background="bg-surface-secondary" borderRadius="200">
              <div style={{ position: 'relative', paddingTop: '56.25%', borderRadius: '8px', overflow: 'hidden' }}>
                <iframe
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
                  src="https://www.youtube.com/embed/dQw4w9WgXcQ"
                  title="App Setup Tutorial"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </Box>
            <BlockStack gap="200">
              <Text variant="bodyMd">
                To start using the app, you need to enable the <b>App Embed</b> in your Shopify Theme Customizer. This allows the cart drawer and upsell widgets to appear on your store.
              </Text>
              <InlineStack align="start">
                <Button
                  variant="primary"
                  size="large"
                  icon={ExternalIcon}
                  onClick={() => window.open(customizerUrl, '_blank')}
                >
                  Start Setup & Enable App
                </Button>
              </InlineStack>
            </BlockStack>
          </BlockStack>
        </Card>


        <Grid>
          {setupSteps.map((step) => (
            <Grid.Cell key={step.id} columnSpan={{ xs: 6, sm: 6, md: 3, lg: 4, xl: 4 }}>
              <div
                style={{
                  background: 'white',
                  borderRadius: '16px',
                  padding: '24px',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                  border: '1px solid #f1f5f9',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                  cursor: 'default'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-4px)';
                  e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)';
                }}
              >
                <div style={{
                  fontSize: '32px',
                  background: '#f8fafc',
                  width: '64px',
                  height: '64px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0'
                }}>
                  {step.icon}
                </div>

                <BlockStack gap="200">
                  <Text variant="headingMd" fontWeight="bold">{step.title}</Text>
                  <Text variant="bodyMd" tone="subdued">{step.content}</Text>
                </BlockStack>

                <div style={{ marginTop: 'auto', paddingTop: '16px' }}>
                  <Button
                    variant="primary"
                    fullWidth
                    size="large"
                    onClick={() => {
                      if (step.external) {
                        window.open(step.target, '_blank');
                      } else {
                        navigate(step.target);
                      }
                    }}
                  >
                    Set Up Now
                  </Button>
                </div>
              </div>
            </Grid.Cell>
          ))}
        </Grid>
      </BlockStack>
    );
  };

  const renderGuide = () => {
    const tutorials = [
      { id: 1, title: 'Creating Coupons', thumb: 'https://cdn.shopify.com/s/files/1/0070/7032/files/Shopify_Blog_Header_6_550x.jpg', desc: 'Learn how to create and manage attractive discount slides.' },
      { id: 2, title: 'Adding Product Widgets', thumb: 'https://cdn.shopify.com/s/files/1/0070/7032/files/how-to-sell-online-with-shopify-6_550x.jpg', desc: 'Setup Grid and Carousel upsell widgets on your cart page.' },
      { id: 3, title: 'Enable Cart Drawer', thumb: 'https://cdn.shopify.com/s/files/1/0070/7032/files/shopify-store-examples-6_550x.jpg', desc: 'Quick guide to activating your high-converting cart drawer.' },
      { id: 4, title: 'Drawer Customization', thumb: 'https://cdn.shopify.com/s/files/1/0070/7032/files/shopify-dropshipping_550x.jpg', desc: 'Deep dive into styling your cart drawer and upsells.' },
    ];

    return (
      <BlockStack gap="600">
        <Banner title="Video Learning Center" tone="info">
          <p>Master the app in minutes with these short, focused video tutorials.</p>
        </Banner>

        <Grid>
          {tutorials.map((video) => (
            <Grid.Cell key={video.id} columnSpan={{ xs: 6, sm: 6, md: 6, lg: 6, xl: 6 }}>
              <Card padding="0">
                <div style={{ display: 'flex' }}>
                  <div style={{ width: '200px', height: '140px', position: 'relative', flexShrink: 0 }}>
                    <img
                      src={video.thumb}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      alt={video.title}
                    />
                    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(0,0,0,0.6)', borderRadius: '50%', padding: '8px', cursor: 'pointer' }}>
                      <Box color="icon-on-interactive">
                        <PlayIcon style={{ width: '24px', height: '24px', fill: 'white' }} />
                      </Box>
                    </div>
                  </div>
                  <Box padding="400">
                    <BlockStack gap="200">
                      <Text variant="headingMd" fontWeight="bold">{video.title}</Text>
                      <Text variant="bodyMd" tone="subdued">{video.desc}</Text>
                      <InlineStack align="start">
                        <Button plain icon={PlayIcon}>Watch Video</Button>
                      </InlineStack>
                    </BlockStack>
                  </Box>
                </div>
              </Card>
            </Grid.Cell>
          ))}
        </Grid>

        <Divider />

        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd" fontWeight="bold">Optimization Strategies</Text>
            <Grid>
              <Grid.Cell columnSpan={{ md: 3, lg: 6 }}>
                <Box padding="400" border="divider" borderRadius="200">
                  <BlockStack gap="200">
                    <Text variant="headingSm" fontWeight="bold">Coupon Slider & Progress Bar</Text>
                    <Text variant="bodyMd" tone="subdued">Drive urgency by showing real-time discounts and shipping status. Use the progress bar to show exactly how much more a customer needs to spend.</Text>
                  </BlockStack>
                </Box>
              </Grid.Cell>
              <Grid.Cell columnSpan={{ md: 3, lg: 6 }}>
                <Box padding="400" border="divider" borderRadius="200">
                  <BlockStack gap="200">
                    <Text variant="headingSm" fontWeight="bold">FBT & Upsells</Text>
                    <Text variant="bodyMd" tone="subdued">Automatically suggest matching products using FBT (Frequently Bought Together) or manual Upsell products in Grid/Carousel layouts.</Text>
                  </BlockStack>
                </Box>
              </Grid.Cell>
            </Grid>
          </BlockStack>
        </Card>
      </BlockStack>
    );
  };

  return (
    <Page
      title="Analytics Dashboard"
      primaryAction={
        <Popover
          active={popoverActive}
          activator={<Button icon={CalendarIcon} onClick={togglePopoverActive}>{dateValue}</Button>}
          onClose={togglePopoverActive}
          fluidContent
        >
          <div style={{ display: 'flex', width: '750px', maxHeight: '550px' }}>
            {/* Sidebar Presets */}
            <div style={{ width: '180px', borderRight: '1px solid #e1e3e5', padding: '8px' }}>
              <div style={{ overflowY: 'auto', height: '100%', paddingRight: '4px' }}>
                <BlockStack gap="050">
                  {presets.map((preset) => (
                    <div
                      key={preset.label}
                      onClick={() => handlePresetClick(preset)}
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        borderRadius: '6px',
                        background: activePreset === preset.label ? '#f1f1f1' : 'transparent',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <Text variant="bodyMd" fontWeight={activePreset === preset.label ? 'bold' : 'regular'}>{preset.label}</Text>
                      {activePreset === preset.label && <Icon source={CheckCircleIcon} tone="success" />}
                    </div>
                  ))}
                  <div style={{ margin: '8px 0', borderTop: '1px solid #f1f1f1' }} />
                  {['Last week', 'Last month', 'Last quarter', 'Last year'].map(item => (
                    <div key={item} style={{ padding: '8px 12px', cursor: 'pointer', borderRadius: '6px' }}>
                      <Text variant="bodyMd" tone="subdued">{item}</Text>
                    </div>
                  ))}
                </BlockStack>
              </div>
            </div>

            {/* Main Content Area */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              {/* Header Toggles */}
              <div style={{ padding: '16px', borderBottom: '1px solid #e1e3e5' }}>
                <InlineStack align="start" gap="400">
                  <div
                    onClick={() => setSelectionMode(0)}
                    style={{
                      padding: '4px 12px',
                      background: selectionMode === 0 ? '#ebebed' : 'transparent',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    <Text variant="bodyMd" fontWeight="semibold">Fixed</Text>
                  </div>
                  <div
                    onClick={() => setSelectionMode(1)}
                    style={{
                      padding: '4px 12px',
                      background: selectionMode === 1 ? '#ebebed' : 'transparent',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    <Text variant="bodyMd" fontWeight="semibold">Rolling</Text>
                  </div>
                </InlineStack>
              </div>

              {/* Selection Detail & Inputs */}
              <div style={{ padding: '16px' }}>
                <InlineStack align="space-between" blockAlign="center" gap="400">
                  <div style={{ flex: 1 }}>
                    <TextField
                      labelHidden
                      value={tempDates.start.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                      autoComplete="off"
                    />
                  </div>
                  <Icon source={ArrowRightIcon} tone="base" />
                  <div style={{ flex: 1 }}>
                    <TextField
                      labelHidden
                      value={tempDates.end.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                      autoComplete="off"
                    />
                  </div>
                  <Icon source={ClockIcon} tone="base" />
                </InlineStack>
              </div>

              {/* Dual Calendars Container */}
              <div style={{ display: 'flex', gap: '24px', padding: '0 16px' }}>
                <div style={{ flex: 1 }}>
                  <DatePicker
                    month={month}
                    year={year}
                    onChange={setTempDates}
                    onMonthChange={handleMonthChange}
                    selected={tempDates}
                    allowRange
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <DatePicker
                    month={month === 11 ? 0 : month + 1}
                    year={month === 11 ? year + 1 : year}
                    onChange={setTempDates}
                    onMonthChange={() => { }}
                    selected={tempDates}
                    allowRange
                  />
                </div>
              </div>

              {/* Footer Actions */}
              <div style={{ marginTop: 'auto', padding: '16px', borderTop: '1px solid #e1e3e5', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <Button onClick={handleCancel}>Cancel</Button>
                <Button variant="primary" onClick={handleApply}>Apply</Button>
              </div>
            </div>
          </div>
        </Popover>
      }
    >
      <Tabs tabs={tabs} selected={selectedTab} onSelect={handleTabChange}>
        <Box paddingBlockStart="400">
          {selectedTab === 0 && (
            <BlockStack gap="600">
              {analytics.error && (
                <Banner tone="critical">
                  <p>Unable to fetch real-time analytics from <b>{`https://7d56-103-130-91-50.ngrok-free.ap`}</b>. Please check your server and CORS settings.</p>
                </Banner>
              )}
              {analytics.loading && (
                <Box padding="400">
                  <ProgressBar progress={50} />
                  <Text variant="bodySm" tone="subdued">Fetching real-time data...</Text>
                </Box>
              )}
              <Banner tone="info">
                <InlineStack align="space-between" blockAlign="center">
                  <p>Overall performance is up <b>15%</b> compared to last week. Your <b>Upsell Products</b> are leading with highest conversion.</p>
                  <Button variant="secondary" onClick={fetchAnalytics} loading={analytics.loading}>Refresh Stats</Button>
                </InlineStack>
              </Banner>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                <Card padding="400">
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Checkout Clicks (Total)</Text>
                    <Text variant="headingXl" fontWeight="bold">{analytics.checkout_click}</Text>
                    <Text variant="bodySm" tone="success">Real-time status</Text>
                  </BlockStack>
                </Card>
                <Card padding="400">
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Coupon Clicks</Text>
                    <Text variant="headingXl" fontWeight="bold">{analytics.coupon_click}</Text>
                    <Text variant="bodySm" tone="success">Real-time status</Text>
                  </BlockStack>
                </Card>
                <Card padding="400">
                  <BlockStack gap="100">
                    <Text variant="bodySm" tone="subdued">Upsell Clicks</Text>
                    <Text variant="headingXl" fontWeight="bold">{analytics.upsell_click}</Text>
                    <Text variant="bodySm" tone="success">Real-time status</Text>
                  </BlockStack>
                </Card>
              </div>

              {renderFeatureSection('Coupon Slider', '#008060', [
                { title: 'Revenue Generated', value: '₹4,500.00', trend: '+12.4%' },
                { title: 'Coupons Applied', value: analytics.coupon_click.toString(), trend: '+8.1%' },
                { title: 'Avg. Order Value', value: '₹1,240', trend: '+2.3%' },
              ])}

              {renderFeatureSection('FBT (Bought Together)', '#005ea2', [
                { title: 'Revenue Generated', value: '₹3,240.50', trend: '+15.2%' },
                { title: 'Bundles Added', value: '128', trend: '+10.4%' },
                { title: 'Bundle Conv. Rate', value: '6.8%', trend: '+1.2%' },
              ])}

              {renderFeatureSection('Upsell Products', '#9c6ade', [
                { title: 'Revenue Generated', value: '₹5,820.00', trend: '+20.5%' },
                { title: 'Add to Carts', value: analytics.upsell_click.toString(), trend: '+18.2%' },
                { title: 'Upsell CTR', value: '7.4%', trend: '+3.1%' },
              ])}

              {renderShippingSection()}
            </BlockStack>
          )}
          {selectedTab === 1 && renderSetup()}
          {selectedTab === 2 && renderGuide()}
        </Box >
      </Tabs >
    </Page >
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
