import { useState, useCallback, useEffect } from 'react';
import { useLoaderData, useNavigate } from 'react-router';
import {
  Card, BlockStack, Text, Button, Badge, Icon, Spinner,
  Toast, Frame, InlineGrid, ProgressBar, Divider,
} from '@shopify/polaris';
import {
  MagicIcon, PaintBrushFlatIcon, ProductIcon, DiscountIcon,
  ChartVerticalIcon, CheckCircleIcon,
} from '@shopify/polaris-icons';
import { authenticate } from '../shopify.server';
import { getBundleEmbedStatus, setBundleEmbedStatus } from '../utils/bundle-api-helpers';

const ONBOARDING_STEPS = [
  { id: 'template', title: 'Choose a Template', description: 'Pick Grid, Carousel, or Premium Storefront as your starting layout', icon: PaintBrushFlatIcon, href: '/app/bundles/templates' },
  { id: 'collections', title: 'Pick Collections', description: 'Select which product collections to display in your bundle', icon: ProductIcon, href: '/app/bundles/customize' },
  { id: 'content', title: 'Customize Content', description: 'Add titles, subtitles, CTAs and AI-generated copy', icon: MagicIcon, href: '/app/bundles/customize' },
  { id: 'style', title: 'Style Your Bundle', description: 'Adjust colors, fonts, banners, and visual settings', icon: PaintBrushFlatIcon, href: '/app/bundles/customize' },
  { id: 'discount', title: 'Configure Discounts', description: 'Set up bundle pricing rules and discount codes', icon: DiscountIcon, href: '/app/bundles/discountengine' },
  { id: 'preview', title: 'Preview & Test', description: 'See how your bundle looks on desktop and mobile', icon: ChartVerticalIcon, href: '/app/bundles/customize' },
  { id: 'publish', title: 'Publish', description: 'Create your Shopify page and go live with one click', icon: CheckCircleIcon, href: '/app/bundles/templates' },
];

const QUICK_NAV_ITEMS = [
  { label: 'Template Library', description: 'Browse preset & saved templates', href: '/app/bundles/templates', icon: PaintBrushFlatIcon, color: '#667eea' },
  { label: 'Customize Builder', description: 'Design your bundle page layout', href: '/app/bundles/customize', icon: MagicIcon, color: '#8b5cf6' },
  { label: 'Discount Engine', description: 'Create bundle discount codes', href: '/app/bundles/discountengine', icon: DiscountIcon, color: '#f59e0b' },
  { label: 'Analytics', description: 'View impressions, clicks & revenue', href: '/app/bundles/analytics', icon: ChartVerticalIcon, color: '#10b981' },
];

const RECENT_ACTIVITY = [
  { type: 'template', message: 'Template "Summer Bundle" activated', time: '2 hours ago', tone: 'success' },
  { type: 'order', message: 'New bundle order — $124.00', time: '4 hours ago', tone: 'success' },
  { type: 'discount', message: 'Discount code BUNDLE20 created', time: '1 day ago', tone: 'info' },
  { type: 'analytics', message: '47 new bundle impressions today', time: '1 day ago', tone: 'info' },
  { type: 'template', message: 'Template "Winter Sale" saved as draft', time: '2 days ago', tone: 'warning' },
];

function KpiCard({ label, value, trend, trendLabel }) {
  const isPositive = trend >= 0;
  return (
    <Card>
      <BlockStack gap="200">
        <Text variant="bodySm" as="p" tone="subdued">{label}</Text>
        <Text variant="headingXl" as="p" fontWeight="bold">{value}</Text>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ fontSize: '12px', color: isPositive ? '#10b981' : '#ef4444', fontWeight: '600' }}>
            {isPositive ? '↑' : '↓'} {Math.abs(trend)}%
          </span>
          <Text variant="bodyXs" as="span" tone="subdued">{trendLabel}</Text>
        </div>
      </BlockStack>
    </Card>
  );
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let templateCount = 0;
  try {
    const { default: prisma } = await import('../db.server');
    const rows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) as count FROM combo_templates WHERE shop_domain = ? AND is_active = 1`,
      shop
    ).catch(() => [{ count: 0 }]);
    templateCount = Number(rows[0]?.count ?? 0);
  } catch { /* table may not exist yet */ }

  return { shop, templateCount };
};

export default function AppBundlesIndex() {
  const { shop, templateCount } = useLoaderData();
  const navigate = useNavigate();

  const [embedStatus, setEmbedStatus] = useState(null);
  const [embedLoading, setEmbedLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState([]);
  const [toastActive, setToastActive] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  const showToast = useCallback((msg) => { setToastMsg(msg); setToastActive(true); }, []);

  useEffect(() => {
    getBundleEmbedStatus(shop)
      .then(data => { setEmbedStatus(data?.embedded || false); setEmbedLoading(false); })
      .catch(() => { setEmbedStatus(false); setEmbedLoading(false); });
  }, [shop]);

  const handleEmbedToggle = useCallback(async () => {
    setToggling(true);
    try {
      const next = !embedStatus;
      await setBundleEmbedStatus(shop, next);
      setEmbedStatus(next);
      showToast(next ? 'Bundle embedded on your storefront!' : 'Bundle removed from storefront');
    } catch {
      showToast('Failed to update embed status — check connection');
    } finally {
      setToggling(false);
    }
  }, [shop, embedStatus, showToast]);

  const toggleStepComplete = useCallback((stepId) => {
    setCompletedSteps(prev =>
      prev.includes(stepId) ? prev.filter(s => s !== stepId) : [...prev, stepId]
    );
  }, []);

  const progress = Math.round((completedSteps.length / ONBOARDING_STEPS.length) * 100);

  return (
    <Frame>
      <BlockStack gap="500">

        {/* KPI Row */}
        <InlineGrid columns={{ xs: 2, sm: 2, md: 4 }} gap="400">
          <KpiCard label="Active Templates" value={templateCount} trend={12} trendLabel="this week" color="#667eea" />
          <KpiCard label="Bundle Revenue" value="$0.00" trend={0} trendLabel="this month" color="#10b981" />
          <KpiCard label="Conversions" value="0" trend={0} trendLabel="this week" color="#f59e0b" />
          <KpiCard label="Avg Order Value" value="$0.00" trend={0} trendLabel="this month" color="#8b5cf6" />
        </InlineGrid>

        <InlineGrid columns={{ xs: 1, md: '2fr 1fr' }} gap="500">
          {/* Left column */}
          <BlockStack gap="400">

            {/* Embed Status Card */}
            <Card>
              <BlockStack gap="400">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <BlockStack gap="100">
                    <Text variant="headingMd" as="h2">Storefront Status</Text>
                    <Text variant="bodyMd" as="p" tone="subdued">
                      {embedLoading
                        ? 'Checking connection...'
                        : embedStatus
                          ? 'Your bundle is live and visible to shoppers'
                          : 'Bundle is hidden — embed it to start selling'}
                    </Text>
                  </BlockStack>
                  {embedLoading
                    ? <Spinner size="small" />
                    : <Badge tone={embedStatus ? 'success' : 'warning'} size="large">
                        {embedStatus ? '● Live' : '○ Offline'}
                      </Badge>
                  }
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <Button
                    onClick={handleEmbedToggle}
                    loading={toggling || embedLoading}
                    variant={embedStatus ? 'secondary' : 'primary'}
                    tone={embedStatus ? 'critical' : undefined}
                  >
                    {embedStatus ? 'Unembed Bundle' : 'Embed Bundle on Store'}
                  </Button>
                  <Button onClick={() => navigate('/app/bundles/templates')} variant="secondary">
                    Manage Templates
                  </Button>
                </div>
              </BlockStack>
            </Card>

            {/* Onboarding Checklist */}
            <Card>
              <BlockStack gap="400">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <BlockStack gap="50">
                    <Text variant="headingMd" as="h2">Getting Started Guide</Text>
                    <Text variant="bodyXs" as="p" tone="subdued">{completedSteps.length} of {ONBOARDING_STEPS.length} steps completed</Text>
                  </BlockStack>
                  <div style={{ width: '120px' }}>
                    <ProgressBar progress={progress} size="small" tone="primary" />
                  </div>
                </div>

                <BlockStack gap="200">
                  {ONBOARDING_STEPS.map((s, i) => {
                    const done = completedSteps.includes(s.id);
                    const isCurrent = i === currentStep && !done;
                    return (
                      <div key={s.id} style={{
                        display: 'flex', alignItems: 'center', gap: '12px',
                        padding: '10px 12px', borderRadius: '8px',
                        background: isCurrent ? 'rgba(102,126,234,0.06)' : done ? 'rgba(16,185,129,0.04)' : 'transparent',
                        border: isCurrent ? '1px solid rgba(102,126,234,0.2)' : '1px solid transparent',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }} onClick={() => { setCurrentStep(i); }}>
                        <div
                          onClick={e => { e.stopPropagation(); toggleStepComplete(s.id); }}
                          style={{
                            width: '20px', height: '20px', borderRadius: '50%',
                            border: done ? 'none' : '2px solid #d1d5db',
                            background: done ? '#10b981' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0, cursor: 'pointer',
                          }}
                        >
                          {done && <span style={{ color: 'white', fontSize: '11px', fontWeight: '700' }}>✓</span>}
                        </div>
                        <div style={{ flex: 1 }}>
                          <Text variant="bodySm" as="span" fontWeight={isCurrent ? 'semibold' : 'regular'}
                            tone={done ? 'subdued' : 'base'}>
                            <span style={{ textDecoration: done ? 'line-through' : 'none' }}>{s.title}</span>
                          </Text>
                          {isCurrent && (
                            <div>
                              <Text variant="bodyXs" as="p" tone="subdued">{s.description}</Text>
                            </div>
                          )}
                        </div>
                        {isCurrent && (
                          <Button size="slim" onClick={() => navigate(s.href)} variant="primary">Go</Button>
                        )}
                      </div>
                    );
                  })}
                </BlockStack>
              </BlockStack>
            </Card>

          </BlockStack>

          {/* Right column */}
          <BlockStack gap="400">

            {/* Quick Navigation */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Quick Actions</Text>
                <BlockStack gap="200">
                  {QUICK_NAV_ITEMS.map(item => (
                    <div
                      key={item.label}
                      onClick={() => navigate(item.href)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '12px',
                        padding: '10px 12px', borderRadius: '8px', cursor: 'pointer',
                        border: '1px solid #e5e7eb',
                        transition: 'border-color 0.15s, box-shadow 0.15s',
                      }}
                      onMouseOver={e => {
                        e.currentTarget.style.borderColor = item.color;
                        e.currentTarget.style.boxShadow = `0 2px 8px ${item.color}20`;
                      }}
                      onMouseOut={e => {
                        e.currentTarget.style.borderColor = '#e5e7eb';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <div style={{
                        width: '36px', height: '36px', borderRadius: '8px', flexShrink: 0,
                        background: `${item.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Icon source={item.icon} tone="base" />
                      </div>
                      <div>
                        <Text variant="bodySm" as="p" fontWeight="semibold">{item.label}</Text>
                        <Text variant="bodyXs" as="p" tone="subdued">{item.description}</Text>
                      </div>
                    </div>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>

            {/* Recent Activity */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">Recent Activity</Text>
                <BlockStack gap="100">
                  {RECENT_ACTIVITY.map((activity, i) => (
                    <div key={i}>
                      <div style={{
                        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                        padding: '8px 0', gap: '8px',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                          <div style={{
                            width: '6px', height: '6px', borderRadius: '50%', marginTop: '5px', flexShrink: 0,
                            background: activity.tone === 'success' ? '#10b981'
                              : activity.tone === 'warning' ? '#f59e0b'
                              : '#667eea',
                          }} />
                          <Text variant="bodyXs" as="p">{activity.message}</Text>
                        </div>
                        <Text variant="bodyXs" as="span" tone="subdued" style={{ whiteSpace: 'nowrap' }}>
                          {activity.time}
                        </Text>
                      </div>
                      {i < RECENT_ACTIVITY.length - 1 && <Divider />}
                    </div>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>

            {/* Plan Status */}
            <Card>
              <BlockStack gap="300">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text variant="headingMd" as="h2">Current Plan</Text>
                  <Badge tone="info">Free Trial</Badge>
                </div>
                <div style={{
                  padding: '12px', borderRadius: '8px',
                  background: 'linear-gradient(135deg, rgba(102,126,234,0.08), rgba(118,75,162,0.08))',
                  border: '1px solid rgba(102,126,234,0.2)',
                }}>
                  <BlockStack gap="100">
                    <Text variant="bodyMd" as="p" tone="subdued">
                      Upgrade to <strong>Pro</strong> for unlimited templates, AI recommendations, and advanced analytics.
                    </Text>
                  </BlockStack>
                </div>
                <Button onClick={() => navigate('/app/bundles/plan')} variant="primary">
                  View Plans & Upgrade
                </Button>
              </BlockStack>
            </Card>

          </BlockStack>
        </InlineGrid>
      </BlockStack>

      {toastActive && (
        <Toast content={toastMsg} onDismiss={() => setToastActive(false)} />
      )}
    </Frame>
  );
}
