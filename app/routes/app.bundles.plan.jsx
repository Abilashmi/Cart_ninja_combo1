import { useState, useCallback } from 'react';
import { useLoaderData, useFetcher, useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import {
  Card, BlockStack, InlineGrid, Text, Button, Badge, Modal, Toast, Frame,
} from '@shopify/polaris';
import { authenticate } from '../shopify.server';

const PLANS = [
  {
    id: 'basic',
    name: 'Basic',
    price: 0,
    priceLabel: 'Free Forever',
    interval: null,
    badge: null,
    badgeTone: 'info',
    description: 'Get started with one template — no credit card required',
    color: '#6b7280',
    gradient: 'linear-gradient(135deg, #f9fafb, #f3f4f6)',
    features: [
      { text: '1 Active Template', included: true },
      { text: 'Grid Layout', included: true },
      { text: 'Basic Styling', included: true },
      { text: 'Community Support', included: true },
      { text: 'AI Content Generation', included: false },
      { text: 'Carousel & Editorial Layouts', included: false },
      { text: 'Analytics Dashboard', included: false },
      { text: 'Custom CSS Editor', included: false },
    ],
  },
  {
    id: 'build',
    name: 'Build',
    price: 9.99,
    priceLabel: '$9.99',
    interval: 'EVERY_30_DAYS',
    badge: 'Most Popular',
    badgeTone: 'success',
    description: 'Everything you need to grow bundle revenue with AI and discounts',
    color: '#667eea',
    gradient: 'linear-gradient(135deg, #667eea, #764ba2)',
    features: [
      { text: '10 Active Templates', included: true },
      { text: 'All Layouts (Grid, Carousel, Editorial)', included: true },
      { text: 'Full Styling & Custom CSS', included: true },
      { text: 'AI Content Generation', included: true },
      { text: 'Banner Configuration', included: true },
      { text: 'Priority Email Support', included: true },
      { text: 'Advanced Analytics', included: false },
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 29.99,
    priceLabel: '$29.99',
    interval: 'EVERY_30_DAYS',
    badge: 'Best Value',
    badgeTone: 'attention',
    description: 'Unlimited power for high-volume stores with dedicated support',
    color: '#8b5cf6',
    gradient: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
    features: [
      { text: 'Unlimited Active Templates', included: true },
      { text: 'All Layouts + Custom Bundle Layout', included: true },
      { text: 'Full Styling & Custom CSS', included: true },
      { text: 'AI Content Generation (Unlimited)', included: true },
      { text: 'Multi-Store Support', included: true },
      { text: 'Dedicated Slack Support', included: true },
      { text: 'White-label Option', included: true },
    ],
  },
];

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  let currentSubscription = null;
  let currentPlanId = 'basic';

  try {
    const res = await admin.graphql(`
      query {
        currentAppInstallation {
          activeSubscriptions {
            id name status createdAt
            lineItems {
              plan {
                pricingDetails {
                  ... on AppRecurringPricing {
                    price { amount currencyCode }
                    interval
                  }
                }
              }
            }
          }
        }
      }
    `);
    const json = await res.json();
    const subs = json.data?.currentAppInstallation?.activeSubscriptions || [];
    const active = subs.find(s => s.status === 'ACTIVE');
    if (active) {
      currentSubscription = active;
      const amount = active.lineItems?.[0]?.plan?.pricingDetails?.price?.amount;
      if (parseFloat(amount) >= 29) currentPlanId = 'enterprise';
      else if (parseFloat(amount) >= 9) currentPlanId = 'build';
    }
  } catch (err) {
    console.error('[plans] Failed to fetch subscription:', err);
  }

  return { currentSubscription, currentPlanId };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const body = await request.json();
  const { planId, returnUrl } = body;

  const plan = PLANS.find(p => p.id === planId);
  if (!plan || plan.price === 0) {
    return Response.json({ success: false, error: 'Invalid plan selection' });
  }

  try {
    const baseUrl = returnUrl || 'https://admin.shopify.com';
    const res = await admin.graphql(`
      mutation appSubscriptionCreate(
        $name: String!
        $returnUrl: URL!
        $lineItems: [AppSubscriptionLineItemInput!]!
        $test: Boolean
      ) {
        appSubscriptionCreate(name: $name, returnUrl: $returnUrl, lineItems: $lineItems, test: $test) {
          appSubscription { id status }
          confirmationUrl
          userErrors { field message }
        }
      }
    `, {
      variables: {
        name: `Combo Forge ${plan.name}`,
        returnUrl: `${baseUrl}/app/bundles/plan?upgraded=1`,
        test: true,
        lineItems: [{
          plan: {
            appRecurringPricingDetails: {
              price: { amount: plan.price, currencyCode: 'USD' },
              interval: plan.interval,
            },
          },
        }],
      },
    });

    const json = await res.json();
    const errors = json.data?.appSubscriptionCreate?.userErrors || [];
    if (errors.length > 0) {
      return Response.json({ success: false, errors });
    }

    const confirmationUrl = json.data?.appSubscriptionCreate?.confirmationUrl;
    if (!confirmationUrl) {
      return Response.json({ success: false, error: 'No confirmation URL returned' });
    }

    return Response.json({ success: true, confirmationUrl });
  } catch (err) {
    return Response.json({ success: false, error: err.message });
  }
};

function FeatureRow({ text, included }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 0' }}>
      <div style={{
        width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: included ? '#d1fae5' : '#f3f4f6',
      }}>
        {included ? (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden="true">
            <path d="M1 3.5l2.5 2.5 5.5-5" stroke="#059669" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : (
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
            <path d="M1 1l6 6M7 1L1 7" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        )}
      </div>
      <Text variant="bodySm" as="span" tone={included ? 'base' : 'subdued'}>{text}</Text>
    </div>
  );
}

export default function AppBundlesPlan() {
  const { currentSubscription, currentPlanId } = useLoaderData();
  const fetcher = useFetcher();

  const [confirmModal, setConfirmModal] = useState(null);
  const [toastMsg, setToastMsg] = useState('');
  const [toastActive, setToastActive] = useState(false);

  const showToast = useCallback((msg) => { setToastMsg(msg); setToastActive(true); }, []);

  const handleUpgrade = useCallback((plan) => {
    if (plan.id === 'basic') return;
    if (plan.id === currentPlanId) { showToast('You are already on this plan'); return; }
    setConfirmModal(plan);
  }, [currentPlanId, showToast]);

  const handleConfirmUpgrade = useCallback(() => {
    if (!confirmModal) return;
    fetcher.submit(
      JSON.stringify({ planId: confirmModal.id, returnUrl: window.location.origin }),
      { method: 'POST', encType: 'application/json' }
    );
  }, [confirmModal, fetcher]);

  const isLoading = fetcher.state !== 'idle';

  if (fetcher.data?.confirmationUrl) {
    window.top.location.href = fetcher.data.confirmationUrl;
  }

  return (
    <Frame>
      <BlockStack gap="500">

        {/* Header */}
        <div style={{ textAlign: 'center', padding: '16px 0 8px' }}>
          <Text variant="heading2xl" as="h1">Choose Your Plan</Text>
          <Text variant="bodyLg" as="p" tone="subdued" style={{ marginTop: '6px' }}>
            Scale your bundle revenue with the right plan for your store
          </Text>
          {currentSubscription && (
            <div style={{ marginTop: '12px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <Badge tone="success">Active: {currentSubscription.name}</Badge>
              <Text variant="bodyXs" as="span" tone="subdued">
                Since {new Date(currentSubscription.createdAt).toLocaleDateString()}
              </Text>
            </div>
          )}
        </div>

        {/* Plan cards */}
        <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
          {PLANS.map(plan => {
            const isCurrent = plan.id === currentPlanId;
            const isPaid = plan.price > 0;
            return (
              <div
                key={plan.id}
                style={{
                  borderRadius: '16px', overflow: 'hidden',
                  border: isCurrent ? `2px solid ${plan.color}` : '2px solid #e5e7eb',
                  boxShadow: isCurrent ? `0 8px 32px ${plan.color}25` : '0 2px 8px rgba(0,0,0,0.06)',
                  position: 'relative',
                }}
              >
                {/* Plan header gradient */}
                <div style={{
                  background: isPaid ? plan.gradient : plan.gradient,
                  padding: '24px 20px 20px',
                }}>
                  {plan.badge && (
                    <div style={{ marginBottom: '10px' }}>
                      <Badge tone={plan.badgeTone}>{plan.badge}</Badge>
                    </div>
                  )}
                  <Text variant="headingLg" as="h2" style={{ color: isPaid ? '#fff' : '#374151' }}>
                    {plan.name}
                  </Text>
                  <div style={{ marginTop: '8px', display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                    <Text variant="heading2xl" as="span" fontWeight="bold"
                      style={{ color: isPaid ? '#fff' : '#374151', fontSize: '32px' }}>
                      {plan.priceLabel}
                    </Text>
                    {isPaid && (
                      <Text variant="bodySm" as="span" style={{ color: 'rgba(255,255,255,0.8)' }}>
                        / month
                      </Text>
                    )}
                  </div>
                  <Text variant="bodyXs" as="p"
                    style={{ color: isPaid ? 'rgba(255,255,255,0.75)' : '#6b7280', marginTop: '6px' }}>
                    {plan.description}
                  </Text>
                </div>

                {/* Features */}
                <div style={{ padding: '20px', background: '#fff' }}>
                  <BlockStack gap="0">
                    {plan.features.map(f => <FeatureRow key={f.text} {...f} />)}
                  </BlockStack>

                  <div style={{ marginTop: '20px' }}>
                    {isCurrent ? (
                      <Button fullWidth disabled variant="secondary">
                        ✓ Current Plan
                      </Button>
                    ) : plan.id === 'basic' ? (
                      <Button fullWidth variant="secondary" disabled>
                        Free Forever
                      </Button>
                    ) : (
                      <Button
                        fullWidth
                        variant="primary"
                        onClick={() => handleUpgrade(plan)}
                        loading={isLoading && confirmModal?.id === plan.id}
                        style={{ background: plan.gradient }}
                      >
                        {currentPlanId !== 'basic' ? 'Switch to ' : 'Upgrade to '}{plan.name}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </InlineGrid>

        {/* FAQ / Billing info */}
        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h3">Billing Information</Text>
              <BlockStack gap="200">
                {[
                  ['Billing Cycle', 'Monthly, billed through Shopify'],
                  ['Free Trial', '14-day trial on all paid plans'],
                  ['Cancellation', 'Cancel anytime from your Shopify admin'],
                  ['Refunds', 'Pro-rated refunds within 30 days'],
                  ['Currency', 'Billed in USD via Shopify Payments'],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
                    <Text variant="bodyXs" as="span" tone="subdued">{label}</Text>
                    <Text variant="bodyXs" as="span" fontWeight="semibold">{value}</Text>
                  </div>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h3">Plan Comparison</Text>
              <div style={{
                padding: '12px', borderRadius: '10px',
                background: 'linear-gradient(135deg, rgba(102,126,234,0.08), rgba(118,75,162,0.08))',
                border: '1px solid rgba(102,126,234,0.15)',
              }}>
                <Text variant="bodySm" as="p" tone="subdued">
                  <strong>Build</strong> is perfect for growing stores that want AI-powered bundles and advanced layouts.
                </Text>
              </div>
              <div style={{
                padding: '12px', borderRadius: '10px',
                background: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(236,72,153,0.08))',
                border: '1px solid rgba(139,92,246,0.15)',
              }}>
                <Text variant="bodySm" as="p" tone="subdued">
                  <strong>Enterprise</strong> is built for high-volume merchants who need unlimited templates, advanced analytics, and dedicated support.
                </Text>
              </div>
              <Text variant="bodyXs" as="p" tone="subdued">
                All plans include a 14-day free trial. No credit card required to start.
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

      </BlockStack>

      {/* Confirm upgrade modal */}
      {confirmModal && (
        <Modal
          open
          onClose={() => setConfirmModal(null)}
          title={`Upgrade to ${confirmModal.name}`}
          primaryAction={{
            content: isLoading ? 'Redirecting...' : `Upgrade — ${confirmModal.priceLabel}/mo`,
            onAction: handleConfirmUpgrade,
            loading: isLoading,
          }}
          secondaryActions={[{ content: 'Cancel', onAction: () => setConfirmModal(null) }]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <Text as="p">
                You are about to upgrade to <strong>Combo Forge {confirmModal.name}</strong> at{' '}
                <strong>{confirmModal.priceLabel}/month</strong>.
              </Text>
              <Text as="p" tone="subdued" variant="bodyXs">
                You will be redirected to Shopify to confirm the subscription. Billing is handled securely
                through Shopify Payments. Your first charge will be in 14 days after the free trial ends.
              </Text>
              {fetcher.data?.error && (
                <div style={{ padding: '10px', borderRadius: '6px', background: '#fef2f2', border: '1px solid #fecaca' }}>
                  <Text variant="bodyXs" as="p" tone="critical">{fetcher.data.error}</Text>
                </div>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}

      {toastActive && <Toast content={toastMsg} onDismiss={() => setToastActive(false)} />}
    </Frame>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers = (headersArgs) => boundary.headers(headersArgs);
