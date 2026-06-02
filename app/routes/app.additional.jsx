import { useLoaderData, useNavigate } from 'react-router';
import { authenticate } from '../shopify.server';
import {
  Page, Card, BlockStack, InlineStack, Text, Badge, Button, ProgressBar, Divider, Banner,
} from '@shopify/polaris';
import { ExternalIcon } from '@shopify/polaris-icons';

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Fetch subscription status
  let isPro = false;
  let subscriptionId = null;
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
    isPro = Boolean(activeSub);
    subscriptionId = activeSub?.id || null;
  } catch (e) {
    console.error('[Account loader] Failed to fetch subscription:', e);
  }

  // Fetch shop info
  let shopInfo = null;
  try {
    const res = await admin.graphql(`
      query {
        shop {
          name
          myshopifyDomain
          plan { displayName }
          createdAt
        }
      }
    `);
    const data = await res.json();
    shopInfo = data.data?.shop || null;
  } catch (e) {
    console.error('[Account loader] Failed to fetch shop info:', e);
  }

  return { shop, shopInfo, isPro, subscriptionId };
};

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

function UsageRow({ label, used, limit }) {
  const percentage = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const isNearLimit = percentage >= 80;
  return (
    <BlockStack gap="200">
      <InlineStack align="space-between" blockAlign="center">
        <Text as="span" variant="bodyMd">{label}</Text>
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {limit === Infinity ? `${used} / Unlimited` : `${used} / ${limit}`}
        </Text>
      </InlineStack>
      <ProgressBar progress={percentage} tone={isNearLimit ? 'critical' : 'primary'} size="small" />
    </BlockStack>
  );
}

export default function AccountPage() {
  const { shop, shopInfo, isPro, subscriptionId } = useLoaderData();
  const navigate = useNavigate();

  const planName = isPro ? 'Pro' : 'Free';
  const planPrice = isPro ? '$29/mo' : 'Free';

  // Usage limits based on plan
  const limits = {
    coupons: { used: 0, limit: isPro ? Infinity : 3 },
    upsellProducts: { used: 0, limit: isPro ? Infinity : 3 },
    progressBarTiers: { used: 1, limit: isPro ? 3 : 1 },
  };

  const installedDate = shopInfo?.createdAt
    ? new Date(shopInfo.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'N/A';

  return (
    <Page
      title="Account"
      subtitle="Manage your store settings, billing, and usage"
    >
      <BlockStack gap="500">
        {/* Store Information */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Store Information</Text>
            <Divider />
            <InfoRow label="Store Name" value={shopInfo?.name || shop} />
            <InfoRow label="Store URL" value={shopInfo?.myshopifyDomain || shop} />
            <InfoRow label="Shopify Plan" value={shopInfo?.plan?.displayName || 'N/A'} />
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
            {!isPro && (
              <Banner tone="info">
                <p>Upgrade to Pro to unlock unlimited coupons, upsell products, and AI recommendations.</p>
              </Banner>
            )}
          </BlockStack>
        </Card>

        {/* Usage This Period */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Usage This Period</Text>
            <Divider />
            <UsageRow label="Active Coupons" used={limits.coupons.used} limit={isPro ? 999 : 3} />
            <UsageRow label="Upsell Products" used={limits.upsellProducts.used} limit={isPro ? 999 : 3} />
            <UsageRow label="Progress Bar Tiers" used={limits.progressBarTiers.used} limit={isPro ? 3 : 1} />
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

        {/* Support */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Support</Text>
            <Divider />
            <Text as="p" variant="bodyMd" tone="subdued">
              Need help? Our team is ready to assist you with setup, configuration, or any issues.
            </Text>
            <InlineStack gap="300" wrap>
              <Button
                onClick={() => window.open('mailto:support@thecartninja.com', '_blank')}
              >
                Contact Support
              </Button>
              <Button
                onClick={() => window.open('https://docs.thecartninja.com', '_blank')}
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
    </Page>
  );
}
