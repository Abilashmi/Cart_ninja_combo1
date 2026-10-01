/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
import { useEffect, useMemo, useState } from 'react';
import { useFetcher, useLoaderData, useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import {
  Page, Layout, Card, BlockStack, InlineStack, InlineGrid, Text, TextField, Checkbox, Banner, Badge, Button,
  DataTable, Divider, Box, Toast, Frame, EmptyState,
} from '@shopify/polaris';
import { authenticate } from '../shopify.server';
import { getShopPlan } from '../services/plan-permissions.server';
import { getFeatureState } from '../config/plans';
import { getShopCurrency } from '../utils/currency.server';
import { formatMoney } from '../utils/currency.shared';
import { CodError, getCodSettings, saveCodSettings, listCodOrders, summarizeCodOrders } from '../services/cod.server';
import { smsProviderStatus } from '../services/cod-sms.server';

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const [planKey, currency] = await Promise.all([getShopPlan(shop, admin), getShopCurrency(admin, shop)]);
  const scopes = String(session.scope || '').split(',').map((s) => s.trim());
  let settings = null;
  let orders = [];
  let loadError = null;
  try {
    settings = await getCodSettings(shop);
    orders = await listCodOrders(admin, shop, 50);
  } catch (error) {
    loadError = error instanceof CodError ? error.message : 'COD Checkout could not be loaded. Please try again.';
    if (!(error instanceof CodError)) console.error('[app.cod] load failed:', String(error?.message || error).slice(0, 300));
  }
  return {
    shop,
    settings,
    orders,
    stats: summarizeCodOrders(orders),
    loadError,
    planState: getFeatureState(planKey, 'cod_checkout'),
    currencyCode: currency.code,
    sms: smsProviderStatus(),
    hasOrderScope: scopes.includes('write_draft_orders'),
  };
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  try {
    const body = await request.json();
    const settings = await saveCodSettings(session.shop, body.settings || {});
    return { success: true, settings };
  } catch (error) {
    const message = error instanceof CodError ? error.message : 'Settings could not be saved. Please try again.';
    if (!(error instanceof CodError)) console.error('[app.cod] save failed:', String(error?.message || error).slice(0, 300));
    return { success: false, error: message };
  }
}

/* ---------- form state <-> settings ---------- */

const numText = (n) => (n ? String(n) : '');

function toForm(s) {
  return {
    enabled: s.enabled,
    drawer: s.surfaces.drawer !== false,
    product: s.surfaces.product !== false,
    combo: s.surfaces.combo !== false,
    codFee: numText(s.codFee),
    shippingFee: numText(s.shippingFee),
    freeShippingAbove: numText(s.freeShippingAbove),
    minOrder: numText(s.minOrder),
    maxOrder: numText(s.maxOrder),
    requireOtp: s.requireOtp,
    dailyLimitPerPhone: String(s.dailyLimitPerPhone),
    blockedPincodes: s.blockedPincodes.join(', '),
    excludedProductTags: s.excludedProductTags.join(', '),
    allowCoupons: s.allowCoupons,
    prepaidNudgeText: s.prepaidNudgeText,
    orderTags: s.orderTags.join(', '),
    drawerText: s.buttons.drawerText,
    productText: s.buttons.productText,
    bg: s.buttons.bg,
    color: s.buttons.color,
  };
}

function toSettings(f) {
  return {
    enabled: f.enabled,
    surfaces: { drawer: f.drawer, product: f.product, combo: f.combo },
    codFee: Number(f.codFee) || 0,
    shippingFee: Number(f.shippingFee) || 0,
    freeShippingAbove: Number(f.freeShippingAbove) || 0,
    minOrder: Number(f.minOrder) || 0,
    maxOrder: Number(f.maxOrder) || 0,
    requireOtp: f.requireOtp,
    dailyLimitPerPhone: Number(f.dailyLimitPerPhone) || 3,
    blockedPincodes: f.blockedPincodes,
    excludedProductTags: f.excludedProductTags,
    allowCoupons: f.allowCoupons,
    prepaidNudgeText: f.prepaidNudgeText,
    orderTags: f.orderTags,
    buttons: { drawerText: f.drawerText, productText: f.productText, bg: f.bg, color: f.color },
  };
}

function formErrors(f) {
  const e = {};
  const money = (key) => { if (f[key] !== '' && !(Number(f[key]) >= 0)) e[key] = 'Enter an amount of 0 or more.'; };
  ['codFee', 'shippingFee', 'freeShippingAbove', 'minOrder', 'maxOrder'].forEach(money);
  if (!e.maxOrder && Number(f.maxOrder) > 0 && Number(f.minOrder) > Number(f.maxOrder)) e.maxOrder = 'Maximum must be more than the minimum.';
  const limit = Number(f.dailyLimitPerPhone);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) e.dailyLimitPerPhone = 'Enter a whole number from 1 to 50.';
  const badPins = f.blockedPincodes.split(/[,\n\s]+/).filter(Boolean).filter((p) => !/^[1-9]\d{5}$/.test(p));
  if (badPins.length) e.blockedPincodes = `These aren't 6-digit PIN codes: ${badPins.slice(0, 5).join(', ')}`;
  const hex = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
  if (!hex.test(f.bg)) e.bg = 'Use a hex colour like #111827.';
  if (!hex.test(f.color)) e.color = 'Use a hex colour like #ffffff.';
  if (!f.drawerText.trim()) e.drawerText = 'Enter the button text.';
  if (!f.productText.trim()) e.productText = 'Enter the button text.';
  return e;
}

function ColorField({ label, value, onChange, error }) {
  return (
    <TextField
      label={label}
      value={value}
      onChange={onChange}
      error={error}
      autoComplete="off"
      prefix={<span style={{ display: 'inline-block', width: 16, height: 16, borderRadius: 4, border: '1px solid #c9cccf', background: /^#[0-9a-f]{3,6}$/i.test(value) ? value : 'transparent' }} />}
    />
  );
}

const STATUS = {
  pending: { tone: 'attention', label: 'Payment pending' },
  paid: { tone: 'success', label: 'Paid' },
  cancelled: { tone: 'critical', label: 'Cancelled' },
  unknown: { tone: undefined, label: 'Unknown' },
};
const SOURCE = { drawer: 'Cart drawer', product: 'Product page', combo: 'Combo page' };

export default function CodCheckoutPage() {
  const data = useLoaderData();
  const fetcher = useFetcher();
  const [form, setForm] = useState(() => (data.settings ? toForm(data.settings) : null));
  const [saved, setSaved] = useState(() => (data.settings ? toForm(data.settings) : null));
  const [toast, setToast] = useState(null);
  const money = (n) => formatMoney(n, { currencyCode: data.currencyCode });

  const saving = fetcher.state !== 'idle';
  const errors = useMemo(() => (form ? formErrors(form) : {}), [form]);
  const dirty = form && saved && JSON.stringify(form) !== JSON.stringify(saved);

  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return;
    if (fetcher.data.success) {
      const next = toForm(fetcher.data.settings);
      setForm(next);
      setSaved(next);
      setToast({ content: 'Settings saved' });
    } else {
      setToast({ content: fetcher.data.error || 'Settings could not be saved', error: true });
    }
  }, [fetcher.state, fetcher.data]);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const save = () => {
    if (Object.keys(errors).length) {
      setToast({ content: 'Fix the highlighted fields first', error: true });
      return;
    }
    fetcher.submit(JSON.stringify({ settings: toSettings(form) }), { method: 'post', encType: 'application/json' });
  };

  if (!form) {
    return (
      <Page title="COD Checkout">
        <Banner tone="critical" title="COD Checkout couldn't load">{data.loadError}</Banner>
      </Page>
    );
  }

  const otpWithoutSms = form.requireOtp && !data.sms.configured;
  const rows = data.orders.map((o) => [
    <Button key="o" variant="plain" url={`shopify://admin/orders/${o.orderNumericId}`} target="_top">{o.orderName}</Button>,
    o.customer,
    <InlineStack key="p" gap="100" blockAlign="center"><span>{o.phone}</span>{o.phoneVerified ? <Badge tone="success" size="small">OTP</Badge> : null}</InlineStack>,
    o.pincode,
    SOURCE[o.source] || o.source,
    formatMoney(o.total, { currencyCode: o.currency || data.currencyCode }),
    <Badge key="s" tone={STATUS[o.status]?.tone}>{STATUS[o.status]?.label || o.status}</Badge>,
    o.createdAt ? new Date(o.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '',
  ]);

  return (
    <Frame>
      <Page
        title="COD Checkout"
        subtitle="Cash on Delivery orders are placed through BRIX. Prepaid orders keep using Shopify checkout."
        primaryAction={{ content: 'Save', onAction: save, loading: saving, disabled: !dirty }}
        secondaryActions={dirty ? [{ content: 'Discard', onAction: () => setForm(saved), disabled: saving }] : []}
      >
        <BlockStack gap="400">
          {data.planState !== 'enabled' && (
            <Banner tone="warning" title="COD isn't shown on your store on your current plan">
              You can set COD up here, but shoppers won&apos;t see it until you move to the Starter or Pro plan.
            </Banner>
          )}
          {!data.hasOrderScope && (
            <Banner tone="warning" title="BRIX needs permission to create orders">
              Cash on Delivery orders are created as Shopify orders, which needs a new permission. Reload BRIX and approve it when Shopify asks. Until then, shoppers who choose COD are asked to pay online.
            </Banner>
          )}
          {otpWithoutSms && (
            <Banner tone="info" title="Phone OTP is on, but no SMS provider is connected">
              Shoppers aren&apos;t asked for a code until an SMS provider (MSG91) is set up on the BRIX server. Orders still work, without phone verification.
            </Banner>
          )}
          {data.loadError && <Banner tone="critical">{data.loadError}</Banner>}

          <Layout>
            <Layout.AnnotatedSection title="Cash on Delivery" description="Where shoppers see the Cash on Delivery button. Pay online always goes to your normal checkout.">
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <Text as="h3" variant="headingSm">COD Checkout</Text>
                      <Text as="p" tone="subdued">{form.enabled ? 'On. Shoppers can place COD orders.' : 'Off. Shoppers only see your normal checkout.'}</Text>
                    </BlockStack>
                    <Button variant={form.enabled ? 'secondary' : 'primary'} onClick={() => set('enabled')(!form.enabled)}>
                      {form.enabled ? 'Turn off' : 'Turn on'}
                    </Button>
                  </InlineStack>
                  <Divider />
                  <Checkbox label="Cart drawer" helpText="Above the checkout button in the BRIX cart drawer." checked={form.drawer} onChange={set('drawer')} />
                  <Checkbox label="Product pages" helpText="Under Add to Cart. Buys only that product, without touching the cart." checked={form.product} onChange={set('product')} />
                  <Checkbox label="Combo pages" helpText="Next to Checkout on Build a Combo pages. Each template can hide it in the builder." checked={form.combo} onChange={set('combo')} />
                  <Text as="p" tone="subdued" variant="bodySm">Needs the Custom Cart Drawer app embed turned on in your theme.</Text>
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>

            <Layout.AnnotatedSection title="Charges" description="Added to COD orders as one shipping line called Cash on Delivery. Shoppers see each part separately before ordering.">
              <Card>
                <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
                  <TextField label="COD fee" type="number" min={0} value={form.codFee} onChange={set('codFee')} placeholder="0" prefix={data.currencyCode} error={errors.codFee} autoComplete="off" />
                  <TextField label="Shipping" type="number" min={0} value={form.shippingFee} onChange={set('shippingFee')} placeholder="Free" prefix={data.currencyCode} error={errors.shippingFee} autoComplete="off" />
                  <TextField label="Free shipping from" type="number" min={0} value={form.freeShippingAbove} onChange={set('freeShippingAbove')} placeholder="Never" prefix={data.currencyCode} error={errors.freeShippingAbove} helpText="Order value after discounts" autoComplete="off" />
                </InlineGrid>
              </Card>
            </Layout.AnnotatedSection>

            <Layout.AnnotatedSection title="Who can order with COD" description="These rules are checked on our server for every order, so they can't be skipped from the browser.">
              <Card>
                <BlockStack gap="300">
                  <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                    <TextField label="Minimum order" type="number" min={0} value={form.minOrder} onChange={set('minOrder')} placeholder="No minimum" prefix={data.currencyCode} error={errors.minOrder} autoComplete="off" />
                    <TextField label="Maximum order" type="number" min={0} value={form.maxOrder} onChange={set('maxOrder')} placeholder="No maximum" prefix={data.currencyCode} error={errors.maxOrder} autoComplete="off" />
                  </InlineGrid>
                  <TextField label="COD orders per phone number, per day" type="number" min={1} max={50} value={form.dailyLimitPerPhone} onChange={set('dailyLimitPerPhone')} error={errors.dailyLimitPerPhone} helpText="Stops repeated fake orders from one number." autoComplete="off" />
                  <TextField label="Blocked PIN codes" value={form.blockedPincodes} onChange={set('blockedPincodes')} multiline={2} error={errors.blockedPincodes} helpText="No COD for these areas, for example where many orders come back undelivered. Separate with commas." autoComplete="off" />
                  <TextField label="Products tagged with these can't use COD" value={form.excludedProductTags} onChange={set('excludedProductTags')} helpText="Shopify product tags, separated with commas. For example: no-cod, pre-order" autoComplete="off" />
                  <Checkbox
                    label="Verify the phone number with an SMS code (OTP)"
                    helpText={data.sms.configured ? 'Cuts fake orders. Each code is one SMS from your SMS provider.' : 'Takes effect once an SMS provider is connected on the BRIX server.'}
                    checked={form.requireOtp}
                    onChange={set('requireOtp')}
                  />
                  <Checkbox label="Allow discount codes on COD orders" helpText="Codes applied in the cart drawer or on combo pages are checked by Shopify before the order is placed." checked={form.allowCoupons} onChange={set('allowCoupons')} />
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>

            <Layout.AnnotatedSection title="Buttons" description="Combo page buttons are styled per template in the combo builder.">
              <Card>
                <BlockStack gap="300">
                  <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                    <TextField label="Cart drawer button" value={form.drawerText} onChange={set('drawerText')} error={errors.drawerText} maxLength={60} autoComplete="off" />
                    <TextField label="Product page button" value={form.productText} onChange={set('productText')} error={errors.productText} maxLength={60} autoComplete="off" />
                    <ColorField label="Button colour" value={form.bg} onChange={set('bg')} error={errors.bg} />
                    <ColorField label="Text colour" value={form.color} onChange={set('color')} error={errors.color} />
                  </InlineGrid>
                  <Box>
                    <Text as="p" variant="bodySm" tone="subdued">Preview</Text>
                    <div style={{ marginTop: 6, maxWidth: 360, padding: '13px 16px', borderRadius: 12, background: form.bg, color: form.color, fontWeight: 700, textAlign: 'center', lineHeight: 1.25 }}>
                      {form.drawerText || 'Cash on Delivery'}
                      {Number(form.codFee) > 0 && <div style={{ fontSize: 11.5, fontWeight: 500, opacity: 0.85 }}>+{money(form.codFee)} COD fee</div>}
                    </div>
                  </Box>
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>

            <Layout.AnnotatedSection title="Orders" description="Every COD order is tagged COD and BRIX-COD in Shopify, with its payment marked as pending.">
              <Card>
                <BlockStack gap="300">
                  <TextField label="Extra order tags" value={form.orderTags} onChange={set('orderTags')} helpText="Separate with commas." autoComplete="off" />
                  <TextField label="Message encouraging online payment (optional)" value={form.prepaidNudgeText} onChange={set('prepaidNudgeText')} maxLength={140} showCharacterCount helpText="Shown on the COD review step with a Pay online link, for example: Pay online and get 5% off with code PREPAID5. BRIX doesn't create that discount for you." autoComplete="off" />
                </BlockStack>
              </Card>
            </Layout.AnnotatedSection>
          </Layout>

          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">COD orders</Text>
              <InlineGrid columns={{ xs: 2, md: 4 }} gap="300">
                <Stat label="COD orders" value={data.stats.count} />
                <Stat label="Cash to collect" value={money(data.stats.toCollect)} />
                <Stat label="Collected" value={money(data.stats.collected)} />
                <Stat label="Cancelled" value={`${data.stats.cancelRate}%`} />
              </InlineGrid>
              {rows.length ? (
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'text', 'text', 'numeric', 'text', 'text']}
                  headings={['Order', 'Customer', 'Phone', 'PIN code', 'From', 'Collect on delivery', 'Payment', 'Placed']}
                  rows={rows}
                />
              ) : (
                <EmptyState heading="No COD orders yet" image="">
                  <p>Orders placed with Cash on Delivery appear here, newest first. Mark them paid in Shopify when the courier collects the cash.</p>
                </EmptyState>
              )}
              <Text as="p" variant="bodySm" tone="subdued">Showing the latest 50. Payment status comes live from Shopify.</Text>
            </BlockStack>
          </Card>
        </BlockStack>
        {toast && <Toast content={toast.content} error={toast.error} onDismiss={() => setToast(null)} />}
      </Page>
    </Frame>
  );
}

function Stat({ label, value }) {
  return (
    <Box padding="300" background="bg-surface-secondary" borderRadius="200">
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
        <Text as="p" variant="headingLg">{value}</Text>
      </BlockStack>
    </Box>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
