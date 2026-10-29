import { useEffect, useState } from 'react';
import { useFetcher, useLoaderData, useNavigate } from 'react-router';
import { authenticate } from '../shopify.server';
import {
  Page, Card, BlockStack, InlineStack, Text, Badge, Button, Divider, Banner, Icon, Checkbox,
} from '@shopify/polaris';
import { getPriceDisplay, savePriceDisplay } from '../services/price-display.server';
import { FeatureHeaderBar } from '../components/feature/FeatureHeaderBar';
import BrixBar from '../components/ai-agent/BrixBar';
import { ExternalIcon, CheckCircleIcon, LockIcon } from '@shopify/polaris-icons';
import { getShopPlan } from '../services/plan-permissions.server';
import { PLANS } from '../config/plans';
import { usePlan } from '../components/PlanContext';

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const [planKey, subscriptionId, shopInfo, priceDisplay] = await Promise.all([
    getShopPlan(shop),
    (async () => {
      try {
        const res = await admin.graphql(`
          query {
            currentAppInstallation {
              activeSubscriptions { id status name }
            }
          }
        `);
        const data = await res.json();
        const subs = data.data?.currentAppInstallation?.activeSubscriptions || [];
        const activeSub = subs.find(s => s.status === 'ACTIVE');
        return activeSub?.id || null;
      } catch (e) {
        console.error('[Account loader] Failed to fetch subscription:', e);
        return null;
      }
    })(),
    (async () => {
      try {
        const res = await admin.graphql(`
          query {
            shop {
              name
              myshopifyDomain
              createdAt
            }
          }
        `);
        const data = await res.json();
        return data.data?.shop || null;
      } catch (e) {
        console.error('[Account loader] Failed to fetch shop info:', e);
        return null;
      }
    })(),
    getPriceDisplay(admin),
  ]);

  return { shop, shopInfo, planKey, subscriptionId, priceDisplay };
};

// Price display (services/price-display.server.js): saved when the box is ticked.
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get('intent') !== 'price-display') return { ok: false, error: 'Unknown request.' };
  try {
    const saved = await savePriceDisplay(admin, { wholePrices: form.get('wholePrices') === 'true' });
    return { ok: true, priceDisplay: saved };
  } catch (e) {
    console.error('[Account] price display save failed:', e);
    return { ok: false, error: 'Could not save. Please try again.' };
  }
};

function PriceDisplayCard({ initial }) {
  const fetcher = useFetcher();
  const [whole, setWhole] = useState(Boolean(initial?.wholePrices));
  const saving = fetcher.state !== 'idle';
  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return;
    if (fetcher.data.ok) {
      setWhole(Boolean(fetcher.data.priceDisplay?.wholePrices));
      if (typeof shopify !== 'undefined') shopify.toast.show('Price display saved');
    } else if (typeof shopify !== 'undefined') {
      shopify.toast.show(fetcher.data.error || 'Could not save', { isError: true });
    }
  }, [fetcher.state, fetcher.data]);
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">Price display</Text>
        <Divider />
        <Checkbox
          label="Hide decimals in prices"
          helpText="Everywhere BRIX shows a price on your store: cart drawer, upsells, COD buttons and payment options, Frequently Bought Together, Packs and combo pages (₹595 instead of ₹594.70). Display only: checkout charges the exact price, and the COD checkout's bill keeps the exact amount to pay."
          checked={whole}
          disabled={saving}
          onChange={(v) => {
            setWhole(v);
            fetcher.submit({ intent: 'price-display', wholePrices: String(v) }, { method: 'post' });
          }}
        />
      </BlockStack>
    </Card>
  );
}

function InfoRow({ label, value }) {
  return (
    <InlineStack align="space-between" blockAlign="center">
      <Text as="span" variant="bodyMd" tone="subdued">{label}</Text>
      {typeof value === 'string' ? (
        <Text as="span" variant="bodyMd" fontWeight="semibold">{value}</Text>
      ) : (
        value
      )}
    </InlineStack>
  );
}

export default function AccountPage() {
  const { shop, shopInfo, planKey, subscriptionId, priceDisplay } = useLoaderData();
  const navigate = useNavigate();
  const { canAccessFeature } = usePlan();

  const plan = PLANS[planKey] || PLANS.free;
  const isPro = planKey === 'pro' || planKey === 'scale' || planKey === 'enterprise';
  const planName = plan.label;
  const planPrice = plan.price.monthly > 0 ? `$${plan.price.monthly}/mo` : 'Free';

  const installedDate = shopInfo?.createdAt
    ? new Date(shopInfo.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'N/A';

  return (
    <Page
      title="Account"
      subtitle="Manage your store settings, billing, and usage"
    >
      <BlockStack gap="500">
        <FeatureHeaderBar feature="account" title="Account" subtitle="Manage your store settings, billing, and usage." />
        <BrixBar size="md" floating />

        {/* Store Information */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Store Information</Text>
            <Divider />
            <InfoRow label="Store Name" value={shopInfo?.name || shop} />
            <InfoRow label="Store URL" value={shopInfo?.myshopifyDomain || shop} />
            <InfoRow label="App Installed" value={installedDate} />
          </BlockStack>
        </Card>

        {/* Current Plan & Billing */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Current Plan & Billing</Text>
              <Button variant="plain" onClick={() => navigate('/app/subscribe')}>
                Change Plan
              </Button>
            </InlineStack>
            <Divider />
            <InfoRow
              label="Plan"
              value={
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone={isPro ? 'success' : undefined}>{planName}</Badge>
                  <Text as="span" variant="bodyMd">{planPrice}</Text>
                </InlineStack>
              }
            />
            <InfoRow label="Billing" value="Through Shopify billing" />
            {plan.orderCap !== null && (
              <Banner tone="info">
                <p>Every plan has every feature. Your plan includes {plan.orderCap.toLocaleString('en-US')} orders a month; upgrade for more orders and AI BRIX credits.</p>
              </Banner>
            )}
          </BlockStack>
        </Card>

        {/* App Embed Status */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">App Embed Status</Text>
            <Divider />
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="bodyMd">Status:</Text>
                  <Badge tone="attention">Manual Activation Required</Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Enable the Cart Ninja app embed in your Shopify theme to activate all features.
                </Text>
              </BlockStack>
              <Button
                icon={ExternalIcon}
                onClick={() => window.open(`https://${shop}/admin/themes/current/editor?context=apps`, '_blank')}
              >
                Open Theme Editor
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <PriceDisplayCard initial={priceDisplay} />

        {/* Support */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Support</Text>
            <Divider />
            <Text as="p" variant="bodyMd" tone="subdued">
              Need help? Our team is ready to assist you with setup, configuration, or any issues.
            </Text>
            <InlineStack gap="400" align="end" blockAlign="center" wrap>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon source={canAccessFeature('priority_email_support') ? CheckCircleIcon : LockIcon} tone={canAccessFeature('priority_email_support') ? 'success' : 'subdued'} />
                <Text as="span" variant="bodySm" tone={canAccessFeature('priority_email_support') ? undefined : 'subdued'}>
                  Priority Email Support{!canAccessFeature('priority_email_support') ? ' — requires Starter' : ''}
                </Text>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon source={canAccessFeature('ai_support_247') ? CheckCircleIcon : LockIcon} tone={canAccessFeature('ai_support_247') ? 'success' : 'subdued'} />
                <Text as="span" variant="bodySm" tone={canAccessFeature('ai_support_247') ? undefined : 'subdued'}>
                  24/7 AI Support{!canAccessFeature('ai_support_247') ? ' — requires Starter' : ''}
                </Text>
              </div>
            </InlineStack>
            <InlineStack gap="300" wrap>
              <Button
                onClick={() => window.open('mailto:support@thecartninja.com', '_blank')}
              >
                Contact Support
              </Button>
              <Button
                onClick={() => window.open('https://thebrix.io/how-to.html', '_blank')}
              >
                Documentation
              </Button>
              <Button onClick={() => navigate('/app/subscribe')}>
                Upgrade Plan
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>

      {/* Clears the floating BrixBar (position: fixed, bottom: 20) so it
          doesn't cover the last section when scrolled to the bottom. */}
      <div style={{ height: 100 }} aria-hidden="true" />
    </Page>
  );
}
