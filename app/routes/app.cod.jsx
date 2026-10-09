/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
// BRIX COD Checkout dashboard: status, setup checklist, overview and orders.
// Customizing COD happens on its own page, /app/cod/customize (app.cod_.customize.jsx).
import { useState } from 'react';
import { useLoaderData, useNavigate, useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import {
  Page, Card, BlockStack, InlineStack, InlineGrid, Text, TextField, Banner, Badge, Button,
  Box, Frame, EmptyState, Icon, IndexTable, Tabs,
} from '@shopify/polaris';
import {
  CartIcon, ProductIcon, CollectionIcon, CheckCircleIcon, AlertTriangleIcon, InfoIcon,
  OrderIcon, ClockIcon, XCircleIcon, CashRupeeIcon, SearchIcon, ExternalIcon, PaintBrushFlatIcon, ChevronRightIcon,
} from '@shopify/polaris-icons';
import { authenticate } from '../shopify.server';
import { getShopPlan } from '../services/plan-permissions.server';
import { getFeatureState } from '../config/plans';
import { getShopCurrency } from '../utils/currency.server';
import { formatMoney } from '../utils/currency.shared';
import { CodError, getCodSettings, getCodSecrets, msg91Creds, syncCodRuntime, listCodOrders, summarizeCodOrders } from '../services/cod.server';
import { smsProviderStatus } from '../services/cod-sms.server';
import CodOrdersChart from '../components/cod/CodOrdersChart';
import { COD_ADMIN_CSS } from '../components/cod/codAdminStyles';

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const [planKey, currency] = await Promise.all([getShopPlan(shop, admin), getShopCurrency(admin, shop)]);
  const scopes = String(session.scope || '').split(',').map((s) => s.trim());
  let settings = null;
  let orders = [];
  let loadError = null;
  let sms = smsProviderStatus();
  try {
    settings = await getCodSettings(shop);
    await syncCodRuntime(shop);
    sms = smsProviderStatus(msg91Creds(await getCodSecrets(shop)));
    orders = await listCodOrders(admin, shop, 50);
  } catch (error) {
    if (error instanceof CodError && error.code === 'storage_missing') {
      loadError = "COD Checkout's files aren't on the BRIX PHP server yet (php_backend/cod_*.php). Upload them, then reload this page.";
    } else {
      loadError = error instanceof CodError ? error.message : 'COD Checkout could not be loaded. Please try again.';
    }
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
    sms,
    hasOrderScope: scopes.includes('write_draft_orders'),
  };
}

const STATUS = {
  pending: { tone: 'attention', label: 'Payment pending' },
  paid: { tone: 'success', label: 'Paid' },
  cancelled: { tone: 'critical', label: 'Cancelled' },
  unknown: { tone: undefined, label: 'Unknown' },
};
const SOURCE = {
  drawer: { label: 'Cart drawer', icon: CartIcon },
  product: { label: 'Product page', icon: ProductIcon },
  combo: { label: 'Combo page', icon: CollectionIcon },
};

// Where a COD order stands after it's placed (Shopify order webhooks → cod_orders.lifecycle).
const LIFECYCLE = {
  placed: { tone: undefined, label: 'Not shipped' },
  shipped: { tone: 'info', label: 'Shipped' },
  delivered: { tone: 'success', label: 'Delivered' },
  paid: { tone: 'success', label: 'Cash collected' },
  rto: { tone: 'warning', label: 'Delivery failed' },
  cancelled: { tone: 'critical', label: 'Cancelled' },
  refunded: { tone: 'critical', label: 'Refunded' },
};

/** Lifecycle from the webhooks; older orders (before webhooks were synced) fall back to Shopify's live fulfillment. */
function deliveryOf(o) {
  if (o.lifecycle && o.lifecycle !== 'placed') return o.lifecycle;
  if (o.status === 'cancelled') return 'cancelled';
  if (['FULFILLED', 'PARTIALLY_FULFILLED'].includes(o.fulfillment)) return 'shipped';
  return 'placed';
}

const SENT = {
  sent: { tone: 'success', label: 'Sent' },
  no_consent: { tone: undefined, label: 'No consent' },
  no_client_id: { tone: undefined, label: 'Browser only' },
  rejected: { tone: 'critical', label: 'Rejected' },
  failed: { tone: 'critical', label: 'Failed' },
};

function ago(iso) {
  if (!iso) return '';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

const AVATAR_TINTS = ['#e0f0ff', '#fde7f3', '#e6f7ec', '#fff1d6', '#efe9ff', '#e3f6f5'];
function Avatar({ name }) {
  const parts = String(name || '?').trim().split(/\s+/);
  const letters = ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  const tint = AVATAR_TINTS[[...String(name)].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_TINTS.length];
  return <span className="cod-av" style={{ background: tint }} aria-hidden="true">{letters}</span>;
}

function Kpi({ label, value, sub, icon, tint, ink }) {
  return (
    <div className="cod-kpi">
      <div className="cod-kpi-h"><span className="cod-kpi-ic" style={{ background: tint, color: ink }}><Icon source={icon} /></span><Text as="span" variant="bodySm" tone="subdued">{label}</Text></div>
      <div className="cod-kpi-v">{value}</div>
      {sub ? <Text as="p" variant="bodySm" tone="subdued">{sub}</Text> : null}
    </div>
  );
}

function CheckItem({ state, title, children, action }) {
  const icon = state === 'done' ? CheckCircleIcon : state === 'todo' ? AlertTriangleIcon : InfoIcon;
  return (
    <div className={`cod-check ${state}`}>
      <span className="cod-check-ic"><Icon source={icon} /></span>
      <div className="cod-check-b">
        <span className="cod-check-title"><Text as="span" variant="bodyMd" fontWeight="semibold">{title}</Text></span>
        {children ? <Text as="p" variant="bodySm" tone="subdued">{children}</Text> : null}
      </div>
      {action}
    </div>
  );
}

const CUSTOMIZE_URL = '/app/cod/customize';

export default function CodCheckoutPage() {
  const data = useLoaderData();
  const navigate = useNavigate();
  const openCustomize = (section) => navigate(section ? `${CUSTOMIZE_URL}?section=${section}` : CUSTOMIZE_URL);
  const [view, setView] = useState('overview');
  const [showChecklist, setShowChecklist] = useState(null);
  const [orderFilter, setOrderFilter] = useState('all');
  const [orderQuery, setOrderQuery] = useState('');
  const money = (n) => formatMoney(n, { currencyCode: data.currencyCode });

  if (!data.settings) {
    return (
      <Page title="COD Checkout">
        <Banner tone="critical" title="COD Checkout couldn't load">{data.loadError}</Banner>
      </Page>
    );
  }
  const s = data.settings;
  const tracking = s.tracking || {};

  /* --- status + checklist --- */
  const surfacesOn = [s.surfaces.drawer !== false && 'the cart drawer', s.surfaces.product !== false && 'product pages', s.surfaces.combo !== false && 'combo pages'].filter(Boolean);
  const planOk = data.planState === 'enabled';
  const required = [planOk, data.hasOrderScope, s.enabled, surfacesOn.length > 0];
  const doneCount = required.filter(Boolean).length;
  const allDone = doneCount === required.length;
  const checklistOpen = showChecklist == null ? !allDone : showChecklist;
  let heroState = 'live';
  if (!s.enabled) heroState = 'off';
  else if (!allDone) heroState = 'warn';
  const heroTitle = {
    live: 'Cash on Delivery is on',
    warn: "Cash on Delivery is on, but shoppers can't see it yet",
    off: 'Cash on Delivery is off',
  }[heroState];
  let heroText;
  if (heroState === 'off') heroText = 'Turn it on in Customize to offer Cash on Delivery next to your normal checkout. Prepaid orders always keep using Shopify checkout.';
  else if (heroState === 'warn') heroText = `${required.length - doneCount} setup ${required.length - doneCount === 1 ? 'step is' : 'steps are'} left before shoppers can see it.`;
  else heroText = `Shoppers can place COD orders from ${surfacesOn.length > 1 ? `${surfacesOn.slice(0, -1).join(', ')} and ${surfacesOn[surfacesOn.length - 1]}` : surfacesOn[0]}.`;

  /* --- orders --- */
  const counts = { all: data.orders.length, pending: 0, paid: 0, cancelled: 0 };
  data.orders.forEach((o) => { if (counts[o.status] != null) counts[o.status] += 1; });
  const q = orderQuery.trim().toLowerCase();
  const shown = data.orders.filter((o) => (orderFilter === 'all' || o.status === orderFilter)
    && (!q || [o.orderName, o.customer, o.phone, o.pincode].some((v) => String(v || '').toLowerCase().includes(q))));
  const ORDER_TABS = [
    { id: 'all', content: 'All' },
    { id: 'pending', content: 'Payment pending' },
    { id: 'paid', content: 'Paid' },
    { id: 'cancelled', content: 'Cancelled' },
  ].map((t) => ({ ...t, badge: String(counts[t.id]) }));
  const trackingOn = Boolean(tracking.ga4Id || tracking.metaPixelId);
  const rowMarkup = shown.map((o, index) => {
    const src = SOURCE[o.source];
    return (
      <IndexTable.Row id={String(o.orderNumericId || o.orderName)} key={o.orderName} position={index}>
        <IndexTable.Cell><Button variant="plain" url={`shopify://admin/orders/${o.orderNumericId}`} target="_top">{o.orderName}</Button></IndexTable.Cell>
        <IndexTable.Cell>{o.customer}</IndexTable.Cell>
        <IndexTable.Cell><InlineStack gap="100" blockAlign="center" wrap={false}><span>{o.phone}</span>{o.phoneVerified ? <Badge tone="success" size="small">OTP</Badge> : null}</InlineStack></IndexTable.Cell>
        <IndexTable.Cell>{o.pincode}</IndexTable.Cell>
        <IndexTable.Cell>{src ? <span className="cod-src"><Icon source={src.icon} />{src.label}</span> : o.source}</IndexTable.Cell>
        <IndexTable.Cell><Text as="span" alignment="end" numeric fontWeight="semibold">{formatMoney(o.total, { currencyCode: o.currency || data.currencyCode })}</Text></IndexTable.Cell>
        <IndexTable.Cell><Badge tone={STATUS[o.status]?.tone} progress={o.status === 'paid' ? 'complete' : o.status === 'pending' ? 'incomplete' : undefined}>{STATUS[o.status]?.label || o.status}</Badge></IndexTable.Cell>
        <IndexTable.Cell><Badge tone={LIFECYCLE[deliveryOf(o)]?.tone}>{LIFECYCLE[deliveryOf(o)]?.label}</Badge></IndexTable.Cell>
        {trackingOn && (
          <IndexTable.Cell>
            <InlineStack gap="100" wrap={false}>
              {[['GA4', o.tracking?.ga4], ['Meta', o.tracking?.meta]].filter(([, v]) => SENT[v]).map(([name, v]) => (
                <span key={name} title={`${name}: ${SENT[v].label}`}><Badge size="small" tone={SENT[v].tone}>{name}</Badge></span>
              ))}
            </InlineStack>
          </IndexTable.Cell>
        )}
        <IndexTable.Cell>{o.createdAt ? new Date(o.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''}</IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  const checklist = [
    {
      key: 'plan', state: planOk ? 'done' : 'todo', title: 'Plan includes COD Checkout',
      text: 'You can set COD up now, but shoppers only see it on the Starter or Pro plan.',
      action: <Button url="/app/billing">See plans</Button>,
    },
    {
      key: 'scope', state: data.hasOrderScope ? 'done' : 'todo', title: 'Permission to create orders',
      text: 'COD orders are created as Shopify orders. Reload BRIX and approve the new permission when Shopify asks. Until then, shoppers who choose COD are asked to pay online.',
    },
    {
      key: 'on', state: s.enabled ? 'done' : 'todo', title: 'Turn on Cash on Delivery',
      text: 'In Customize, use the Active switch at the top, then save.',
      action: <Button variant="primary" onClick={() => openCustomize('status')}>Turn on</Button>,
    },
    {
      key: 'where', state: surfacesOn.length ? 'done' : 'todo', title: 'Choose where it shows',
      text: 'Turn on the cart drawer, product pages or combo pages in Customize.',
      action: <Button onClick={() => openCustomize('position')}>Choose</Button>,
    },
    {
      key: 'embed', state: 'info', title: 'Custom Cart Drawer app embed is on in your theme',
      text: "The COD button and checkout load through this embed, also when the BRIX Cart Drawer itself is off and your theme's own drawer is used. BRIX can't check it from here.",
      action: <Button url="shopify://admin/themes/current/editor?context=apps" target="_top" icon={ExternalIcon}>Open theme editor</Button>,
    },
    {
      key: 'ads', state: tracking.ga4Id || tracking.metaPixelId ? 'done' : 'info', title: 'Ads & analytics (optional)',
      text: "COD orders don't pass through Shopify checkout, so your Google and Meta apps don't see them. Add your GA4 and Meta Pixel IDs to count them.",
      action: <Button onClick={() => openCustomize('tracking')}>Set up</Button>,
    },
    {
      key: 'sms', state: !s.requireOtp ? 'info' : data.sms.configured ? 'done' : 'todo', title: 'Phone verification by SMS (optional)',
      text: !s.requireOtp ? 'OTP is off. Turn it on in Customize, Fraud protection, to cut fake orders.'
        : "OTP is on, but no SMS provider is connected, so shoppers aren't asked for a code yet. Add your MSG91 keys in Customize → OTP SMS (MSG91).",
    },
  ];
  const openItems = checklist.filter((c) => c.state !== 'done');
  const recent = data.orders.slice(0, 5);
  const VIEWS = [
    { id: 'overview', content: 'Overview' },
    { id: 'orders', content: 'Orders', badge: data.orders.length ? String(data.orders.length) : undefined },
  ];

  return (
    <Frame>
      <style>{COD_ADMIN_CSS}</style>
      <Page
        title="COD Checkout"
        titleMetadata={heroState === 'live' ? <Badge tone="success">On</Badge> : heroState === 'warn' ? <Badge tone="attention">Not visible yet</Badge> : <Badge>Off</Badge>}
        primaryAction={{ content: 'Customize', icon: PaintBrushFlatIcon, onAction: () => openCustomize() }}
      >
        <BlockStack gap="400">
          {data.loadError && <Banner tone="critical">{data.loadError}</Banner>}

          {/* Compact status bar: what shoppers get right now */}
          <div className={`cod-status ${heroState}`}>
            <span className="cod-status-ic"><Icon source={CashRupeeIcon} /></span>
            <div className="cod-status-t">
              <InlineStack gap="200" blockAlign="center">
                {heroState === 'live' && <span className="cod-pulse" aria-hidden="true" />}
                <Text as="h2" variant="headingMd">{heroTitle}</Text>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">{heroText}</Text>
            </div>
            <button type="button" className={`cod-steps ${allDone ? 'ok' : 'todo'}`} onClick={() => setShowChecklist(!checklistOpen)} aria-expanded={checklistOpen}>
              {allDone ? <Icon source={CheckCircleIcon} /> : <svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" /><circle cx="18" cy="18" r="15" style={{ strokeDasharray: 94.25, strokeDashoffset: 94.25 * (1 - doneCount / required.length) }} /></svg>}
              <span>{allDone ? 'Setup done' : `${doneCount}/${required.length} setup`}</span>
            </button>
          </div>
          {checklistOpen && (
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingSm">{openItems.length ? 'Still to check' : 'Everything is set up'}</Text>
                  <Button variant="plain" onClick={() => setShowChecklist(false)}>Close</Button>
                </InlineStack>
                <div>
                  {(openItems.length ? openItems : checklist).map((c) => (
                    <CheckItem key={c.key} state={c.state} title={c.title} action={c.state !== 'done' ? c.action : null}>{c.state !== 'done' ? c.text : null}</CheckItem>
                  ))}
                </div>
              </BlockStack>
            </Card>
          )}

          <div className="cod-views">
            <Tabs tabs={VIEWS} selected={VIEWS.findIndex((v) => v.id === view)} onSelect={(i) => setView(VIEWS[i].id)} />
          </div>

          {view === 'overview' && (
            <BlockStack gap="400">
              <InlineGrid columns={{ xs: 2, md: 4 }} gap="300">
                <Kpi label="COD orders" value={data.stats.count} sub={data.stats.count >= 50 ? "Latest 50" : undefined} icon={OrderIcon} tint="#eaf4ff" ink="#00527c" />
                <Kpi label="Cash to collect" value={money(data.stats.toCollect)} sub={`${counts.pending} pending`} icon={ClockIcon} tint="#fff1e3" ink="#8f4700" />
                <Kpi label="Collected" value={money(data.stats.collected)} sub={`${data.stats.paidCount} paid`} icon={CheckCircleIcon} tint="#cdfee1" ink="#0c5132" />
                <Kpi label="Cancelled" value={`${data.stats.cancelRate}%`} sub={`${data.stats.cancelledCount} of ${data.stats.count}${data.stats.rtoCount ? ` · ${data.stats.rtoCount} failed delivery` : ''}`} icon={XCircleIcon} tint="#fee9e8" ink="#8e1f0b" />
              </InlineGrid>
              <InlineGrid columns={{ xs: 1, md: ['twoThirds', 'oneThird'] }} gap="400" alignItems="start">
                <Card>
                  <CodOrdersChart orders={data.orders} money={money} />
                </Card>
                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h3" variant="headingSm">Latest orders</Text>
                      {data.orders.length > 0 && <Button variant="plain" onClick={() => setView('orders')}>View all</Button>}
                    </InlineStack>
                    {recent.length ? (
                      <div className="cod-recent">
                        {recent.map((o) => (
                          <a key={o.orderName} className="cod-recent-row" href={`shopify://admin/orders/${o.orderNumericId}`} target="_top">
                            <Avatar name={o.customer} />
                            <span className="cod-recent-m">
                              <Text as="span" variant="bodySm" fontWeight="semibold" truncate>{o.customer}</Text>
                              <Text as="span" variant="bodySm" tone="subdued">{o.orderName} · {ago(o.createdAt)}</Text>
                            </span>
                            <span className="cod-recent-r">
                              <Text as="span" variant="bodySm" fontWeight="semibold" numeric>{formatMoney(o.total, { currencyCode: o.currency || data.currencyCode })}</Text>
                              <span className={`cod-dot ${o.status}`}>{STATUS[o.status]?.label || o.status}</span>
                            </span>
                          </a>
                        ))}
                      </div>
                    ) : (
                      <div className="cod-empty-mini">
                        <span className="cod-empty-ic"><Icon source={OrderIcon} /></span>
                        <Text as="p" variant="bodySm" tone="subdued">No COD orders yet. They show up here as soon as a shopper places one.</Text>
                      </div>
                    )}
                  </BlockStack>
                </Card>
              </InlineGrid>
              <button type="button" className="cod-cta" onClick={() => openCustomize()}>
                <span className="cod-cta-ic"><Icon source={PaintBrushFlatIcon} /></span>
                <span className="cod-cta-t">
                  <Text as="span" fontWeight="semibold">Customize COD</Text>
                  <Text as="span" variant="bodySm" tone="subdued">Cart drawer position, button, COD fee, rules and the checkout popup, with a live preview.</Text>
                </span>
                <Icon source={ChevronRightIcon} tone="subdued" />
              </button>
            </BlockStack>
          )}

          {view === 'orders' && (
            <Card padding="0">
              <Box padding="400" paddingBlockEnd="200">
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <Text as="h2" variant="headingMd">COD orders</Text>
                  {data.orders.length > 0 && (
                    <div style={{ minWidth: 240, flex: '0 1 320px' }}>
                      <TextField label="Search orders" labelHidden value={orderQuery} onChange={setOrderQuery} prefix={<Icon source={SearchIcon} />} placeholder="Order, customer, phone or PIN" clearButton onClearButtonClick={() => setOrderQuery('')} autoComplete="off" />
                    </div>
                  )}
                </InlineStack>
              </Box>
              {data.orders.length > 0 && <Tabs tabs={ORDER_TABS} selected={ORDER_TABS.findIndex((t) => t.id === orderFilter)} onSelect={(i) => setOrderFilter(ORDER_TABS[i].id)} />}
              {data.orders.length ? (
                shown.length ? (
                  <IndexTable
                    resourceName={{ singular: 'COD order', plural: 'COD orders' }}
                    itemCount={shown.length}
                    selectable={false}
                    headings={[
                      { title: 'Order' }, { title: 'Customer' }, { title: 'Phone' }, { title: 'PIN code' }, { title: 'From' },
                      { title: 'Collect on delivery', alignment: 'end' }, { title: 'Payment' }, { title: 'Delivery' },
                      ...(trackingOn ? [{ title: 'Server events' }] : []), { title: 'Placed' },
                    ]}
                  >
                    {rowMarkup}
                  </IndexTable>
                ) : (
                  <Box padding="600"><Text as="p" alignment="center" tone="subdued">No orders match. Try another filter or search.</Text></Box>
                )
              ) : (
                <EmptyState heading="No COD orders yet" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                  <p>Orders placed with Cash on Delivery appear here, newest first. Mark them paid in Shopify when the courier collects the cash.</p>
                </EmptyState>
              )}
              <Box padding="400" paddingBlockStart="200">
                <Text as="p" variant="bodySm" tone="subdued">Showing the latest 50. Payment status comes live from Shopify; delivery status updates as Shopify sends order changes to BRIX.</Text>
              </Box>
            </Card>
          )}
        </BlockStack>
      </Page>
    </Frame>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
