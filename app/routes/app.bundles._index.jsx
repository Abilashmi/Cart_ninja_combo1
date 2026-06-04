import { useState, useCallback } from 'react';
import { useLoaderData, useNavigate } from 'react-router';
import {
  Card, BlockStack, Text, Button, Badge, Icon,
  InlineGrid, ProgressBar, Divider,
} from '@shopify/polaris';
import {
  MagicIcon, PaintBrushFlatIcon, ProductIcon, DiscountIcon,
  ChartVerticalIcon, CheckCircleIcon,
} from '@shopify/polaris-icons';
import { authenticate } from '../shopify.server';

const ONBOARDING_STEPS = [
  { id: 'template',  title: 'Choose a Template',  description: 'Pick Guided Architect, Grid, Carousel, or Editorial Split',  icon: PaintBrushFlatIcon, href: '/app/bundles/templates'      },
  { id: 'products',  title: 'Pick Collections',   description: 'Select which product collections to display in your bundle', icon: ProductIcon,        href: '/app/bundles/customize'      },
  { id: 'content',   title: 'Customize Content',  description: 'Add titles, subtitles, CTAs and AI-generated copy',          icon: MagicIcon,          href: '/app/bundles/customize'      },
  { id: 'style',     title: 'Style Your Bundle',  description: 'Adjust colors, fonts, banners, and spacing',                 icon: PaintBrushFlatIcon, href: '/app/bundles/customize'      },
  { id: 'discount',  title: 'Add Discounts',      description: 'Set up bundle pricing rules and discount codes',              icon: DiscountIcon,       href: '/app/bundles/discountengine' },
  { id: 'publish',   title: 'Save & Publish',     description: 'Publish your bundle as a Shopify page — no embed needed',    icon: CheckCircleIcon,    href: '/app/bundles/customize'      },
];

const QUICK_NAV_ITEMS = [
  { label: 'Template Library',  description: 'Browse preset & saved templates',   href: '/app/bundles/templates',      icon: PaintBrushFlatIcon, color: '#667eea' },
  { label: 'Customize Builder', description: 'Design your bundle page layout',     href: '/app/bundles/customize',      icon: MagicIcon,          color: '#8b5cf6' },
  { label: 'Discount Engine',   description: 'Create bundle discount codes',       href: '/app/bundles/discountengine', icon: DiscountIcon,       color: '#f59e0b' },
  { label: 'Analytics',         description: 'View impressions, clicks & revenue', href: '/app/bundles/analytics',      icon: ChartVerticalIcon,  color: '#10b981' },
];

const RECENT_ACTIVITY = [
  { message: 'Template "Summer Bundle" published',    time: '2 hours ago', tone: 'success' },
  { message: 'New bundle order — $124.00',            time: '4 hours ago', tone: 'success' },
  { message: 'Discount code BUNDLE20 created',        time: '1 day ago',   tone: 'info'    },
  { message: '47 new bundle impressions today',       time: '1 day ago',   tone: 'info'    },
  { message: 'Template "Winter Sale" saved as draft', time: '2 days ago',  tone: 'warning' },
];

function KpiCard({ label, value, trend, trendLabel }) {
  const positive = trend >= 0;
  return (
    <Card>
      <BlockStack gap="150">
        <Text variant="bodySm" as="p" tone="subdued">{label}</Text>
        <Text variant="headingXl" as="p" fontWeight="bold">{value}</Text>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ fontSize: '12px', color: positive ? '#10b981' : '#ef4444', fontWeight: '600' }}>
            {positive ? '+' : '-'}{Math.abs(trend)}%
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
  let publishedCount = 0;
  let publishedPages = [];

  try {
    const { default: prisma } = await import('../db.server');

    const countRows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) as count FROM combo_templates WHERE shop_domain = ? AND is_active = 1`,
      shop
    ).catch(() => [{ count: 0 }]);
    templateCount = Number(countRows[0]?.count ?? 0);

    const pubRows = await prisma.$queryRawUnsafe(
      `SELECT name, page_handle, page_url, updated_at FROM combo_templates
       WHERE shop_domain = ? AND page_url IS NOT NULL AND page_url != ''
       ORDER BY updated_at DESC LIMIT 5`,
      shop
    ).catch(() => []);
    publishedPages = Array.isArray(pubRows) ? pubRows : [];
    publishedCount = publishedPages.length;
  } catch { /* table may not exist yet */ }

  return { templateCount, publishedCount, publishedPages };
};

// SVG checkmark for completed steps
function CheckSvg() {
  return (
    <svg width="11" height="9" viewBox="0 0 11 9" fill="none" aria-hidden="true">
      <path d="M1 4l3 3 6-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// SVG eye icon for page links
function EyeSvg() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 4C5.5 4 2 10 2 10s3.5 6 8 6 8-6 8-6-3.5-6-8-6z" stroke="#059669" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="2.5" stroke="#059669" strokeWidth="1.5" />
    </svg>
  );
}

export default function AppBundlesIndex() {
  const { templateCount, publishedCount, publishedPages } = useLoaderData();
  const navigate = useNavigate();

  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState([]);

  const toggleStepComplete = useCallback((stepId) => {
    setCompletedSteps(prev =>
      prev.includes(stepId) ? prev.filter(s => s !== stepId) : [...prev, stepId]
    );
  }, []);

  const progress = Math.round((completedSteps.length / ONBOARDING_STEPS.length) * 100);

  return (
    <BlockStack gap="500">

      {/* KPI Row */}
      <InlineGrid columns={{ xs: 2, sm: 2, md: 4 }} gap="400">
        <KpiCard label="Active Templates" value={templateCount}  trend={12} trendLabel="this week"  />
        <KpiCard label="Published Pages"  value={publishedCount} trend={0}  trendLabel="total"      />
        <KpiCard label="Conversions"      value="0"              trend={0}  trendLabel="this week"  />
        <KpiCard label="Bundle Revenue"   value="$0.00"          trend={0}  trendLabel="this month" />
      </InlineGrid>

      <InlineGrid columns={{ xs: 1, md: '2fr 1fr' }} gap="500">

        {/* ── Left column ── */}
        <BlockStack gap="400">

          {/* Published Pages */}
          <Card>
            <BlockStack gap="400">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <BlockStack gap="50">
                  <Text variant="headingMd" as="h2">Published Bundle Pages</Text>
                  <Text variant="bodyMd" as="p" tone="subdued">
                    Combo Forge creates standalone Shopify pages. Cart Ninja handles all storefront integration.
                  </Text>
                </BlockStack>
                <Badge tone="success">Active via Cart Ninja</Badge>
              </div>

              {publishedPages.length > 0 ? (
                <BlockStack gap="200">
                  {publishedPages.map((p, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 12px', borderRadius: '8px',
                      background: '#f9fafb', border: '1px solid #e5e7eb',
                    }}>
                      <div>
                        <Text variant="bodySm" as="p" fontWeight="semibold">{p.name}</Text>
                        <Text variant="bodyXs" as="p" tone="subdued">/pages/{p.page_handle}</Text>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <Badge tone="success">Live</Badge>
                        {p.page_url && (
                          <a href={p.page_url} target="_blank" rel="noreferrer" title="View page"
                            style={{
                              width: '30px', height: '30px', borderRadius: '6px',
                              background: '#f0fdf4', border: '1px solid #bbf7d0',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              textDecoration: 'none',
                            }}
                          >
                            <EyeSvg />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </BlockStack>
              ) : (
                <div style={{
                  padding: '20px', borderRadius: '10px', textAlign: 'center',
                  background: 'linear-gradient(135deg,rgba(102,126,234,.06),rgba(118,75,162,.06))',
                  border: '1px dashed rgba(102,126,234,.3)',
                }}>
                  <Text variant="bodyMd" as="p" tone="subdued">
                    No bundle pages yet. Create a template and click <strong>Save &amp; Publish</strong> to go live instantly.
                  </Text>
                  <div style={{ marginTop: '12px' }}>
                    <Button onClick={() => navigate('/app/bundles/customize')} variant="primary">
                      Create Your First Bundle
                    </Button>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px' }}>
                <Button onClick={() => navigate('/app/bundles/templates')} variant="secondary">
                  Manage Templates
                </Button>
                <Button onClick={() => navigate('/app/bundles/customize')}>
                  + New Bundle
                </Button>
              </div>
            </BlockStack>
          </Card>

          {/* Onboarding Checklist */}
          <Card>
            <BlockStack gap="400">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <BlockStack gap="50">
                  <Text variant="headingMd" as="h2">Getting Started</Text>
                  <Text variant="bodyXs" as="p" tone="subdued">
                    {completedSteps.length} of {ONBOARDING_STEPS.length} steps completed
                  </Text>
                </BlockStack>
                <div style={{ width: '120px' }}>
                  <ProgressBar progress={progress} size="small" tone="primary" />
                </div>
              </div>

              <BlockStack gap="100">
                {ONBOARDING_STEPS.map((s, i) => {
                  const done = completedSteps.includes(s.id);
                  const isCurrent = i === currentStep && !done;
                  return (
                    <div
                      key={s.id}
                      onClick={() => setCurrentStep(i)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '12px',
                        padding: '10px 12px', borderRadius: '8px', cursor: 'pointer',
                        background: isCurrent ? 'rgba(102,126,234,.06)' : done ? 'rgba(16,185,129,.04)' : 'transparent',
                        border: isCurrent ? '1px solid rgba(102,126,234,.2)' : '1px solid transparent',
                        transition: 'all 0.15s',
                      }}
                    >
                      {/* Step checkbox */}
                      <div
                        onClick={e => { e.stopPropagation(); toggleStepComplete(s.id); }}
                        style={{
                          width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
                          border: done ? 'none' : '2px solid #d1d5db',
                          background: done ? '#10b981' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                        }}
                      >
                        {done && <CheckSvg />}
                      </div>

                      {/* Step text */}
                      <div style={{ flex: 1 }}>
                        <Text
                          variant="bodySm" as="span"
                          fontWeight={isCurrent ? 'semibold' : 'regular'}
                          tone={done ? 'subdued' : 'base'}
                        >
                          <span style={{ textDecoration: done ? 'line-through' : 'none' }}>{s.title}</span>
                        </Text>
                        {isCurrent && (
                          <Text variant="bodyXs" as="p" tone="subdued">{s.description}</Text>
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

        {/* ── Right column ── */}
        <BlockStack gap="400">

          {/* Quick Actions */}
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h2">Quick Actions</Text>
              <BlockStack gap="150">
                {QUICK_NAV_ITEMS.map(item => (
                  <div
                    key={item.label}
                    onClick={() => navigate(item.href)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '10px 12px', borderRadius: '8px', cursor: 'pointer',
                      border: '1px solid #e5e7eb', transition: 'all 0.15s',
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
                      background: `${item.color}15`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
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
              <BlockStack gap="0">
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
                            : activity.tone === 'warning' ? '#f59e0b' : '#667eea',
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
                background: 'linear-gradient(135deg,rgba(102,126,234,.08),rgba(118,75,162,.08))',
                border: '1px solid rgba(102,126,234,.2)',
              }}>
                <Text variant="bodyMd" as="p" tone="subdued">
                  Upgrade to <strong>Pro</strong> for unlimited templates, AI recommendations, and advanced analytics.
                </Text>
              </div>
              <Button onClick={() => navigate('/app/bundles/plan')} variant="primary">
                View Plans &amp; Upgrade
              </Button>
            </BlockStack>
          </Card>

        </BlockStack>

      </InlineGrid>

    </BlockStack>
  );
}
