import { useEffect, useState } from 'react';
import { useFetcher, useLoaderData, useNavigate } from 'react-router';
import { authenticate } from '../shopify.server';
import {
  Page, Card, BlockStack, InlineStack, Text, Badge, Button, Divider, Banner, Icon, Checkbox, Select,
} from '@shopify/polaris';
import { getPriceDisplay, savePriceDisplay } from '../services/price-display.server';
import { ADMIN_LANGUAGE_CHOICES, LANGUAGE_NAMES, getAdminLanguage, saveAdminLanguage } from '../i18n/admin.server';
import { useAdminLocale, useT } from '../i18n/admin';
import { FeatureHeaderBar } from '../components/feature/FeatureHeaderBar';
import BrixBar from '../components/ai-agent/BrixBar';
import { ExternalIcon, CheckCircleIcon, LockIcon } from '@shopify/polaris-icons';
import { getShopPlan } from '../services/plan-permissions.server';
import { PLANS } from '../config/plans';
import { usePlan } from '../components/PlanContext';

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const [planKey, subscriptionId, shopInfo, priceDisplay, language] = await Promise.all([
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
    getAdminLanguage(admin),
  ]);

  return {
    shop, shopInfo, planKey, subscriptionId, priceDisplay,
    language: { value: language, choices: ADMIN_LANGUAGE_CHOICES.map((v) => ({ value: v, name: LANGUAGE_NAMES[v] || '' })) },
  };
};

// Price display (services/price-display.server.js): saved when the box is ticked.
// Language (i18n/admin.server.js): saved when picked; app.jsx reloads the admin texts.
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get('intent');
  if (intent === 'language') {
    try {
      return { ok: true, language: await saveAdminLanguage(admin, String(form.get('language') || '')) };
    } catch (e) {
      console.error('[Account] language save failed:', e);
      return { ok: false, error: 'error.admin.save_failed' };
    }
  }
  if (intent !== 'price-display') return { ok: false, error: 'admin.common.unknown_request' };
  try {
    const saved = await savePriceDisplay(admin, { wholePrices: form.get('wholePrices') === 'true' });
    return { ok: true, priceDisplay: saved };
  } catch (e) {
    console.error('[Account] price display save failed:', e);
    return { ok: false, error: 'error.admin.save_failed' };
  }
};

// Account → Language: the BRIX admin's language. "Same as Shopify admin"
// follows Shopify's own language setting when BRIX has that language.
function LanguageCard({ initial: { value: saved, choices } }) { // eslint-disable-line react/prop-types
  const t = useT();
  const fetcher = useFetcher();
  const [value, setValue] = useState(saved);
  const saving = fetcher.state !== 'idle';
  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return;
    if (fetcher.data.ok) {
      if (typeof shopify !== 'undefined') shopify.toast.show(t('admin.language.saved'));
    } else {
      setValue(saved);
      if (typeof shopify !== 'undefined') shopify.toast.show(t(fetcher.data.error || 'error.admin.save_failed'), { isError: true });
    }
  }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const options = choices.map((c) => ({ value: c.value, label: c.value === 'auto' ? t('admin.language.auto') : c.name })); // eslint-disable-line react/prop-types
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">{t('admin.language.title')}</Text>
        <Divider />
        <Select
          label={t('admin.language.label')}
          options={options}
          value={value}
          disabled={saving}
          helpText={t('admin.language.help')}
          onChange={(v) => {
            setValue(v);
            fetcher.submit({ intent: 'language', language: v }, { method: 'post' });
          }}
        />
      </BlockStack>
    </Card>
  );
}

function PriceDisplayCard({ initial }) {
  const t = useT();
  const fetcher = useFetcher();
  const [whole, setWhole] = useState(Boolean(initial?.wholePrices));
  const saving = fetcher.state !== 'idle';
  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return;
    if (fetcher.data.ok) {
      setWhole(Boolean(fetcher.data.priceDisplay?.wholePrices));
      if (typeof shopify !== 'undefined') shopify.toast.show(t('admin.account.price_saved'));
    } else if (typeof shopify !== 'undefined') {
      shopify.toast.show(t(fetcher.data.error || 'error.admin.save_failed'), { isError: true });
    }
  }, [fetcher.state, fetcher.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">{t('admin.account.price_title')}</Text>
        <Divider />
        <Checkbox
          label={t('admin.account.price_label')}
          helpText={t('admin.account.price_help')}
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
  const { shop, shopInfo, planKey, subscriptionId, priceDisplay, language } = useLoaderData();
  const navigate = useNavigate();
  const { canAccessFeature } = usePlan();
  const t = useT();
  const adminLocale = useAdminLocale();

  const plan = PLANS[planKey] || PLANS.free;
  const isPro = planKey === 'pro' || planKey === 'scale' || planKey === 'enterprise';
  const planName = plan.label;
  const planPrice = plan.price.monthly > 0 ? t('admin.account.per_month', { price: `$${plan.price.monthly}` }) : t('admin.account.free');

  const installedDate = shopInfo?.createdAt
    ? new Date(shopInfo.createdAt).toLocaleDateString(adminLocale === 'en' ? 'en-US' : adminLocale, { month: 'long', day: 'numeric', year: 'numeric' })
    : t('admin.account.not_available');

  return (
    <Page
      title={t('admin.nav.account')}
      subtitle={t('admin.account.subtitle')}
    >
      <BlockStack gap="500">
        <FeatureHeaderBar feature="account" title={t('admin.nav.account')} subtitle={t('admin.account.subtitle_full')} />
        <BrixBar size="md" floating />

        {/* Store Information */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">{t('admin.account.store_info')}</Text>
            <Divider />
            <InfoRow label={t('admin.account.store_name')} value={shopInfo?.name || shop} />
            <InfoRow label={t('admin.account.store_url')} value={shopInfo?.myshopifyDomain || shop} />
            <InfoRow label={t('admin.account.installed')} value={installedDate} />
          </BlockStack>
        </Card>

        {/* Current Plan & Billing */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">{t('admin.account.plan_billing')}</Text>
              <Button variant="plain" onClick={() => navigate('/app/subscribe')}>
                {t('admin.account.change_plan')}
              </Button>
            </InlineStack>
            <Divider />
            <InfoRow
              label={t('admin.account.plan')}
              value={
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone={isPro ? 'success' : undefined}>{planName}</Badge>
                  <Text as="span" variant="bodyMd">{planPrice}</Text>
                </InlineStack>
              }
            />
            <InfoRow label={t('admin.nav.billing')} value={t('admin.account.billing_via')} />
            {plan.orderCap !== null && (
              <Banner tone="info">
                <p>{t('admin.account.plan_note', { orders: plan.orderCap.toLocaleString('en-US') })}</p>
              </Banner>
            )}
          </BlockStack>
        </Card>

        {/* App Embed Status */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">{t('admin.account.embed_title')}</Text>
            <Divider />
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="bodyMd">{t('admin.account.status')}</Text>
                  <Badge tone="attention">{t('admin.account.manual_activation')}</Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t('admin.account.embed_help')}
                </Text>
              </BlockStack>
              <Button
                icon={ExternalIcon}
                onClick={() => window.open(`https://${shop}/admin/themes/current/editor?context=apps`, '_blank')}
              >
                {t('admin.account.open_theme_editor')}
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <LanguageCard initial={language} />

        <PriceDisplayCard initial={priceDisplay} />

        {/* Support */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">{t('admin.account.support')}</Text>
            <Divider />
            <Text as="p" variant="bodyMd" tone="subdued">
              {t('admin.account.support_help')}
            </Text>
            <InlineStack gap="400" align="end" blockAlign="center" wrap>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon source={canAccessFeature('priority_email_support') ? CheckCircleIcon : LockIcon} tone={canAccessFeature('priority_email_support') ? 'success' : 'subdued'} />
                <Text as="span" variant="bodySm" tone={canAccessFeature('priority_email_support') ? undefined : 'subdued'}>
                  {canAccessFeature('priority_email_support') ? t('admin.account.priority_email') : t('admin.account.priority_email_locked')}
                </Text>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon source={canAccessFeature('ai_support_247') ? CheckCircleIcon : LockIcon} tone={canAccessFeature('ai_support_247') ? 'success' : 'subdued'} />
                <Text as="span" variant="bodySm" tone={canAccessFeature('ai_support_247') ? undefined : 'subdued'}>
                  {canAccessFeature('ai_support_247') ? t('admin.account.ai_support') : t('admin.account.ai_support_locked')}
                </Text>
              </div>
            </InlineStack>
            <InlineStack gap="300" wrap>
              <Button
                onClick={() => window.open('mailto:support@thecartninja.com', '_blank')}
              >
                {t('admin.account.contact_support')}
              </Button>
              <Button
                onClick={() => window.open('https://thebrix.io/how-to.html', '_blank')}
              >
                {t('admin.account.documentation')}
              </Button>
              <Button onClick={() => navigate('/app/subscribe')}>
                {t('admin.account.upgrade_plan')}
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>

      {/* Clears the floating BrixBar (--brix-bar-clearance, app/global.css) so it
          doesn't cover the last section when scrolled to the bottom. */}
      <div style={{ height: "var(--brix-bar-clearance, 160px)" }} aria-hidden="true" />
    </Page>
  );
}
