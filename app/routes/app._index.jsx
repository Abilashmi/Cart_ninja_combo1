import React, { useState, useEffect, useCallback } from 'react';
import { useLoaderData, useRouteError, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Badge,
  Button,
  ProgressBar,
  Banner,
  Icon,
  Divider,
  Box,
} from '@shopify/polaris';
import { CheckCircleIcon, ChevronRightIcon, ExternalIcon } from '@shopify/polaris-icons';
import { authenticate } from "../shopify.server";
import { useCurrency } from "../components/CurrencyContext";
import { formatAmount } from "../utils/currency.shared";

const DEFAULT_ANALYTICS = {
  checkout_click: 0,
  coupon_click: 0,
  upsell_click: 0,
  upsell_revenue_generated: 0,
  cartdrawer_total_revenue: 0,
  cartdrawer_total_coupon_applied: 0,
};

function toCount(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function toAmount(value) {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = typeof value === "number"
    ? value
    : Number.parseFloat(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function normalizeAnalyticsState(payload = {}) {
  return {
    checkout_click: toCount(payload.checkout_click),
    coupon_click: toCount(payload.coupon_click),
    upsell_click: toCount(payload.upsell_click),
    upsell_revenue_generated: toAmount(payload.upsell_revenue_generated),
    cartdrawer_total_revenue: toAmount(payload.cartdrawer_total_revenue),
    cartdrawer_total_coupon_applied: toCount(payload.cartdrawer_total_coupon_applied),
  };
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    fetch("https://int.thecartninja.com/install_shop.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop }),
    }).catch(console.error);
  } catch (error) {
    console.error("Failed to call install_shop.php", error);
  }

  let initialAnalytics = { ...DEFAULT_ANALYTICS };
  let initialAnalyticsError = false;

  try {
    const requestUrl = new URL(request.url);
    const today = new Date().toISOString().split('T')[0];
    const apiUrl = `${requestUrl.origin}/api/analytics?shop=${encodeURIComponent(shop)}&startDate=${today}&endDate=${today}`;
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: { Accept: "application/json", "ngrok-skip-browser-warning": "true" },
    });
    const payload = await response.json();
    if (response.ok && payload?.success) {
      initialAnalytics = normalizeAnalyticsState(payload.data);
    } else {
      initialAnalyticsError = true;
    }
  } catch {
    initialAnalyticsError = true;
  }

  return { shop, initialAnalytics, initialAnalyticsError };
};

const FEATURE_STATUSES = [
  { name: 'Cart Drawer', enabled: true },
  { name: 'Coupon Banner', enabled: false },
  { name: 'Upsell Products', enabled: true },
  { name: 'FBT Widgets', enabled: false },
  { name: 'Coupon Slider', enabled: true },
  { name: 'Coupon Widgets', enabled: false },
];

const ONBOARDING_DEFAULT = {
  appEmbedEnabled: false,
  cartEditorVisited: false,
  firstUpsellCreated: false,
  firstCouponCreated: false,
};

export default function DashboardPage() {
  const { shop, initialAnalytics, initialAnalyticsError } = useLoaderData();
  const { symbol: currencySymbol, code: currencyCode } = useCurrency();
  const navigate = useNavigate();

  const analytics = normalizeAnalyticsState(initialAnalytics);

  const [onboarding, setOnboarding] = useState(ONBOARDING_DEFAULT);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    try {
      const saved = localStorage.getItem('cartNinja_onboarding');
      if (saved) setOnboarding(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  const markComplete = useCallback((key) => {
    setOnboarding(prev => {
      const next = { ...prev, [key]: true };
      try { localStorage.setItem('cartNinja_onboarding', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const completedCount = Object.values(onboarding).filter(Boolean).length;
  const totalSteps = 4;
  const progress = (completedCount / totalSteps) * 100;
  const isComplete = completedCount === totalSteps;

  const onboardingSteps = [
    {
      key: 'appEmbedEnabled',
      title: 'Enable the App Embed',
      description: 'Enable the app embed in your Shopify theme to activate the cart drawer.',
      action: 'Enable App',
      onClick: () => {
        window.open(`https://${shop}/admin/themes/current/editor?context=apps`, '_blank');
        markComplete('appEmbedEnabled');
      },
    },
    {
      key: 'cartEditorVisited',
      title: 'Customize Your Cart Drawer',
      description: 'Open the Cart Editor to design your perfect cart experience.',
      action: 'Open Cart Editor',
      onClick: () => {
        navigate('/app/cartdrawer');
        markComplete('cartEditorVisited');
      },
    },
    {
      key: 'firstUpsellCreated',
      title: 'Set Up Your First Upsell',
      description: 'Add upsell products to increase your average order value.',
      action: 'Configure Upsells',
      onClick: () => {
        navigate('/app/upsell');
        markComplete('firstUpsellCreated');
      },
    },
    {
      key: 'firstCouponCreated',
      title: 'Create Your First Coupon',
      description: 'Set up a discount coupon to drive more conversions from your store.',
      action: 'Create Coupon',
      onClick: () => {
        navigate('/app/coupons');
        markComplete('firstCouponCreated');
      },
    },
  ];

  const metrics = [
    { label: 'Total Cart Revenue', value: formatAmount(analytics.cartdrawer_total_revenue, currencySymbol, currencyCode) },
    { label: 'Upsell Revenue', value: formatAmount(analytics.upsell_revenue_generated, currencySymbol, currencyCode) },
    { label: 'Coupons Applied', value: String(analytics.cartdrawer_total_coupon_applied) },
    { label: 'Checkout Clicks', value: String(analytics.checkout_click) },
    { label: 'Upsell Clicks', value: String(analytics.upsell_click) },
    { label: 'Coupon Clicks', value: String(analytics.coupon_click) },
  ];

  return (
    <Page title="Home">
      <BlockStack gap="600">
        {initialAnalyticsError && (
          <Banner tone="warning">
            <p>Could not load real-time analytics. Check your analytics API connection.</p>
          </Banner>
        )}

        {/* Onboarding section — shown until all steps are done */}
        {isClient && !isComplete && (
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="200">
                <Text as="h2" variant="headingLg">Welcome to The Cart Ninja!</Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Let's get your cart drawer set up in a few simple steps.
                </Text>
              </BlockStack>

              <InlineStack align="space-between" blockAlign="center">
                <Text as="span" variant="bodySm" tone="subdued">
                  {completedCount} of {totalSteps} steps complete
                </Text>
                <Text as="span" variant="bodySm" fontWeight="semibold">
                  {Math.round(progress)}%
                </Text>
              </InlineStack>
              <ProgressBar progress={progress} tone="primary" size="small" />

              <Divider />

              <BlockStack gap="300">
                {onboardingSteps.map((step) => {
                  const done = onboarding[step.key];
                  return (
                    <div
                      key={step.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px',
                        borderRadius: '8px',
                        background: done ? '#f1f8f5' : '#fafbfb',
                        border: `1px solid ${done ? '#b7e5d6' : '#e1e3e5'}`,
                      }}
                    >
                      <div style={{ flexShrink: 0 }}>
                        {done ? (
                          <Icon source={CheckCircleIcon} tone="success" />
                        ) : (
                          <div style={{
                            width: '20px', height: '20px', borderRadius: '50%',
                            border: '2px solid #8c9196',
                          }} />
                        )}
                      </div>
                      <div style={{ flex: 1 }}>
                        <Text as="p" variant="bodyMd" fontWeight="semibold">{step.title}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">{step.description}</Text>
                      </div>
                      {done ? (
                        <Badge tone="success">Complete</Badge>
                      ) : (
                        <Button size="slim" onClick={step.onClick}>
                          {step.action}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </BlockStack>
            </BlockStack>
          </Card>
        )}

        {isClient && isComplete && (
          <Banner title="Setup complete!" tone="success" onDismiss={() => {}}>
            <p>Your Cart Ninja is ready. Start driving more revenue from your cart drawer.</p>
          </Banner>
        )}

        {/* Performance Overview */}
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">Performance Overview (Today)</Text>
            <Button variant="plain" onClick={() => navigate('/app/analytics')} icon={ChevronRightIcon}>
              View Details
            </Button>
          </InlineStack>
          <InlineGrid columns={3} gap="400">
            {metrics.map((metric) => (
              <Card key={metric.label}>
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">{metric.label}</Text>
                  <Text as="p" variant="headingLg">{metric.value}</Text>
                </BlockStack>
              </Card>
            ))}
          </InlineGrid>
        </BlockStack>

        {/* Feature Status */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Feature Status</Text>
            <InlineGrid columns={3} gap="400">
              {FEATURE_STATUSES.map((feature) => (
                <Box
                  key={feature.name}
                  padding="300"
                  borderRadius="200"
                  background="bg-surface-secondary"
                >
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" variant="bodyMd">{feature.name}</Text>
                    <Badge tone={feature.enabled ? 'success' : undefined}>
                      {feature.enabled ? 'ON' : 'OFF'}
                    </Badge>
                  </InlineStack>
                </Box>
              ))}
            </InlineGrid>
          </BlockStack>
        </Card>

        {/* Quick Actions */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Quick Actions</Text>
            <InlineStack gap="300" wrap>
              <Button variant="primary" onClick={() => navigate('/app/cartdrawer')}>
                Open Cart Editor
              </Button>
              <Button onClick={() => navigate('/app/coupons')}>Create Coupon</Button>
              <Button onClick={() => navigate('/app/analytics')}>View Analytics</Button>
              <Button
                icon={ExternalIcon}
                onClick={() => window.open(`https://${shop}/admin/themes/current/editor?context=apps`, '_blank')}
              >
                Theme Customizer
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
