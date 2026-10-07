/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
import { useEffect, useMemo, useState } from 'react';
import { useFetcher, useLoaderData, useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import {
  Page, Card, BlockStack, InlineStack, InlineGrid, Text, TextField, Banner, Badge, Button,
  Box, Toast, Frame, EmptyState, Icon, IndexTable, RangeSlider, Tabs, ButtonGroup, Select, Checkbox, Link,
} from '@shopify/polaris';
import {
  CartIcon, ProductIcon, CollectionIcon, PhoneIcon, DiscountIcon, CheckCircleIcon, AlertTriangleIcon, InfoIcon,
  OrderIcon, ClockIcon, XCircleIcon, CashRupeeIcon, SearchIcon, ExternalIcon,
  LayoutBlockIcon, ShieldCheckMarkIcon, PaintBrushFlatIcon, ChevronRightIcon, MobileIcon, DeleteIcon,
  ChartVerticalIcon, SendIcon,
} from '@shopify/polaris-icons';
import { authenticate } from '../shopify.server';
import { getShopPlan } from '../services/plan-permissions.server';
import { getFeatureState } from '../config/plans';
import { getShopCurrency } from '../utils/currency.server';
import { formatMoney } from '../utils/currency.shared';
import {
  CodError, getCodSettings, saveCodSettings, syncCodRuntime, listCodOrders, summarizeCodOrders,
  getCodSecrets, getCodSecretsStatus, saveCodSecrets,
} from '../services/cod.server';
import { sendCodTestEvents } from '../services/cod-tracking.server';
import { smsProviderStatus } from '../services/cod-sms.server';
import { listActiveDiscounts } from '../services/discounts.server';
import {
  sanitizeCodSettings, isValidCodLogo, DEFAULT_COD_SETTINGS, COD_PRODUCT_BUTTON_LIMITS, GA4_ID_RE, META_PIXEL_RE,
} from '../utils/cod.shared';
import LogoUploader from '../components/cod/LogoUploader';
import ChipInput from '../components/cod/ChipInput';
import CodPreview from '../components/cod/CodPreview';
import CodOrdersChart from '../components/cod/CodOrdersChart';
import { COD_ADMIN_CSS } from '../components/cod/codAdminStyles';

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const [planKey, currency] = await Promise.all([getShopPlan(shop, admin), getShopCurrency(admin, shop)]);
  const scopes = String(session.scope || '').split(',').map((s) => s.trim());
  let settings = null;
  let orders = [];
  let couponOptions = [];
  let secretsStatus = null;
  let loadError = null;
  try {
    settings = await getCodSettings(shop);
    await syncCodRuntime(shop);
    // Only "set / last 4" — the GA4 secret and Meta token never reach the browser.
    secretsStatus = await getCodSecretsStatus(shop);
    orders = await listCodOrders(admin, shop, 50);
    couponOptions = (await listActiveDiscounts(admin).catch(() => []))
      .filter((d) => !d.isAutomatic && d.code && d.status === 'ACTIVE')
      .map((d) => ({ code: d.code, title: d.title || '', summary: d.summary || '' }));
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
    sms: smsProviderStatus(),
    hasOrderScope: scopes.includes('write_draft_orders'),
    couponOptions,
    secretsStatus,
  };
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  try {
    const body = await request.json();
    if (body.intent === 'test_tracking') {
      // Uses the saved IDs and keys (the page asks to save first).
      const [settings, secrets] = await Promise.all([getCodSettings(session.shop), getCodSecrets(session.shop)]);
      return { success: true, intent: 'test_tracking', result: await sendCodTestEvents({ settings, secrets }) };
    }
    if (body.secrets && typeof body.secrets === 'object') await saveCodSecrets(session.shop, body.secrets);
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

function sheetForm(sheet) {
  const sh = { ...DEFAULT_COD_SETTINGS.sheet, ...(sheet || {}) };
  return {
    sheetLogo: sh.logo,
    sheetLogoSize: sh.logoSize,
    sheetUseButton: !sh.accent,
    sheetAccent: sh.accent || '#4f46e5',
    sheetRadius: sh.radius,
    sheetSummary: sh.showSummary,
    sheetTrust: sh.showTrust,
    sheetThanks: sh.thankYouText,
    sheetCoupon: sh.showCoupon,
    sheetCouponLabel: sh.couponLabel,
    sheetCouponOpen: sh.couponOpen,
    sheetOffers: (sh.offers || []).map((o) => ({ code: o.code, text: o.text })),
  };
}

function productButtonForm(pb) {
  const b = { ...DEFAULT_COD_SETTINGS.productButton, ...(pb || {}) };
  return {
    pbReplaceBuyNow: b.replaceBuyNow,
    pbMarginTop: b.marginTop,
    pbMarginBottom: b.marginBottom,
    pbPaddingY: b.paddingY,
    pbPaddingX: b.paddingX,
    pbRadius: b.radius,
  };
}

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
    ...productButtonForm(s.productButton),
    ...sheetForm(s.sheet),
    ga4Id: s.tracking?.ga4Id || '',
    metaPixelId: s.tracking?.metaPixelId || '',
    metaContentId: s.tracking?.metaContentId || 'shopify',
    dataLayer: s.tracking?.dataLayer !== false,
    // Write-only keys: '' = keep what's saved, a value = replace, null = remove.
    ga4ApiSecret: '',
    metaCapiToken: '',
    metaTestCode: '',
  };
}

const SECRET_FIELDS = ['ga4ApiSecret', 'metaCapiToken', 'metaTestCode'];

/** Only the keys the merchant typed or removed; the rest keep their saved value. */
function secretsPatch(f) {
  const patch = {};
  for (const key of SECRET_FIELDS) if (f[key] === null || f[key].trim()) patch[key] = f[key] === null ? null : f[key].trim();
  return patch;
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
    productButton: {
      replaceBuyNow: f.pbReplaceBuyNow,
      marginTop: f.pbMarginTop,
      marginBottom: f.pbMarginBottom,
      paddingY: f.pbPaddingY,
      paddingX: f.pbPaddingX,
      radius: f.pbRadius,
    },
    sheet: {
      logo: f.sheetLogo,
      logoSize: f.sheetLogoSize,
      accent: f.sheetUseButton ? '' : f.sheetAccent,
      radius: f.sheetRadius,
      showSummary: f.sheetSummary,
      showTrust: f.sheetTrust,
      thankYouText: f.sheetThanks,
      showCoupon: f.sheetCoupon,
      couponLabel: f.sheetCouponLabel,
      couponOpen: f.sheetCouponOpen,
      offers: f.sheetOffers,
    },
    tracking: {
      ga4Id: f.ga4Id.trim().toUpperCase(),
      metaPixelId: f.metaPixelId.trim(),
      metaContentId: f.metaContentId,
      dataLayer: f.dataLayer,
    },
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
  if (f.sheetLogo && !isValidCodLogo(f.sheetLogo)) e.sheetLogo = 'Use an image link that starts with https://, or upload a logo.';
  if (!f.sheetUseButton && !hex.test(f.sheetAccent)) e.sheetAccent = 'Use a hex colour like #4f46e5.';
  if (f.ga4Id.trim() && !GA4_ID_RE.test(f.ga4Id.trim().toUpperCase())) e.ga4Id = 'A Measurement ID looks like G-ABC123XYZ.';
  if (f.metaPixelId.trim() && !META_PIXEL_RE.test(f.metaPixelId.trim())) e.metaPixelId = 'A Pixel ID is a 10 to 20 digit number.';
  for (const key of SECRET_FIELDS) {
    if (typeof f[key] === 'string' && f[key].trim() && !/^[A-Za-z0-9_-]{1,512}$/.test(f[key].trim())) e[key] = 'Paste it again without spaces.';
  }
  return e;
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

const TABS = [
  { id: 'placement', content: 'Placement', icon: LayoutBlockIcon, fields: [] },
  { id: 'charges', content: 'Charges', icon: CashRupeeIcon, fields: ['codFee', 'shippingFee', 'freeShippingAbove'] },
  { id: 'rules', content: 'Rules & safety', icon: ShieldCheckMarkIcon, fields: ['minOrder', 'maxOrder', 'dailyLimitPerPhone', 'blockedPincodes'] },
  { id: 'coupons', content: 'Coupons', icon: DiscountIcon, fields: [] },
  { id: 'look', content: 'Button style', icon: PaintBrushFlatIcon, fields: ['drawerText', 'productText', 'bg', 'color'] },
  { id: 'popup', content: 'Checkout popup', icon: MobileIcon, fields: ['sheetLogo', 'sheetAccent'] },
  { id: 'orders', content: 'Order settings', icon: OrderIcon, fields: [] },
  { id: 'tracking', content: 'Ads & analytics', icon: ChartVerticalIcon, fields: ['ga4Id', 'metaPixelId', 'ga4ApiSecret', 'metaCapiToken', 'metaTestCode'] },
];

// Preview screen to show while a settings tab is open.
const PREVIEW_FOCUS = { popup: 'sheet', coupons: 'sheet', look: 'product' };

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

// Ready-made button colour pairs, all readable (contrast 4.5:1 or more).
// Product page button sizes (settings.productButton), in the order they're shown.
const PB_SIZES = [
  { key: 'marginTop', field: 'pbMarginTop', label: 'Space above', help: 'Gap between Add to Cart and the COD button.' },
  { key: 'marginBottom', field: 'pbMarginBottom', label: 'Space below', help: 'Gap under the COD button.' },
  { key: 'paddingY', field: 'pbPaddingY', label: 'Padding top and bottom', help: 'Makes the button taller or shorter.' },
  { key: 'paddingX', field: 'pbPaddingX', label: 'Padding left and right', help: 'Room beside the text on narrow screens.' },
  { key: 'radius', field: 'pbRadius', label: 'Corner rounding', help: '0 for square corners.' },
];

const STYLE_PRESETS = [
  { name: 'Midnight', bg: '#111827', color: '#ffffff' },
  { name: 'Forest', bg: '#0c7a43', color: '#ffffff' },
  { name: 'Ocean', bg: '#1d4ed8', color: '#ffffff' },
  { name: 'Grape', bg: '#6d28d9', color: '#ffffff' },
  { name: 'Rose', bg: '#be185d', color: '#ffffff' },
  { name: 'Sunset', bg: '#c2410c', color: '#ffffff' },
  { name: 'Mint', bg: '#d1fae5', color: '#065f46' },
  { name: 'Sand', bg: '#fdf0d5', color: '#5c3d00' },
];
const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

function fullHex(hex) {
  if (!HEX.test(hex)) return '#000000';
  return hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex.toLowerCase();
}

// WCAG contrast ratio between two hex colours.
function contrastRatio(a, b) {
  const lum = (hex) => {
    const h = fullHex(hex);
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(h.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

function Switch({ checked, onChange, label, small }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`cod-switch${small ? ' sm' : ''}`} onClick={() => onChange(!checked)} />
  );
}

function ToggleRow({ icon, title, description, checked, onChange, badge }) {
  return (
    <div className="cod-toggle-row">
      <InlineStack gap="300" blockAlign="start" wrap={false}>
        <span className="cod-tr-ic"><Icon source={icon} /></span>
        <BlockStack gap="050">
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" variant="bodyMd" fontWeight="semibold">{title}</Text>
            {badge}
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued">{description}</Text>
        </BlockStack>
      </InlineStack>
      <Switch checked={checked} onChange={onChange} label={title} small />
    </div>
  );
}

// Mini drawings of where the button sits on each surface.
const PLACE_ART = {
  drawer: [
    { left: '42%', top: 0, width: '58%', height: '100%', background: '#fff' },
    { left: '48%', top: 10, width: '22%', height: 14 }, { left: '74%', top: 10, width: '20%', height: 6 },
    { left: '48%', top: 30, width: '22%', height: 14 }, { left: '74%', top: 30, width: '14%', height: 6 },
    { left: '48%', top: 50, width: '46%', height: 8, b: true }, { left: '48%', top: 62, width: '46%', height: 6, background: '#303030' },
  ],
  product: [
    { left: '6%', top: 8, width: '40%', height: 58 },
    { left: '52%', top: 10, width: '40%', height: 7 }, { left: '52%', top: 22, width: '22%', height: 6 },
    { left: '52%', top: 38, width: '42%', height: 9, background: '#fff', boxShadow: 'inset 0 0 0 1.5px #303030' },
    { left: '52%', top: 52, width: '42%', height: 9, b: true },
  ],
  combo: [
    { left: '6%', top: 8, width: '26%', height: 30 }, { left: '37%', top: 8, width: '26%', height: 30 }, { left: '68%', top: 8, width: '26%', height: 30 },
    { left: '6%', top: 46, width: '42%', height: 18, b: true }, { left: '52%', top: 46, width: '42%', height: 18, background: '#303030' },
  ],
};

function PlaceTile({ id, title, description, checked, onChange, bg }) {
  return (
    <button type="button" className={`cod-place${checked ? ' on' : ''}`} aria-pressed={checked} onClick={() => onChange(!checked)}>
      <span className="cod-place-tick" aria-hidden="true">{checked ? '✓' : ''}</span>
      <div className="cod-place-art" style={{ '--cod-bg': bg }} aria-hidden="true">
        {PLACE_ART[id].map(({ b, ...style }, i) => <i key={i} className={b ? 'b' : undefined} style={style} />)}
      </div>
      <BlockStack gap="050">
        <Text as="span" variant="bodyMd" fontWeight="semibold">{title}</Text>
        <Text as="span" variant="bodySm" tone="subdued">{description}</Text>
      </BlockStack>
    </button>
  );
}

function ColorPill({ label, value, onChange, error }) {
  return (
    <div className="cod-cpill">
      <span className="cod-cpill-sw" style={{ background: HEX.test(value) ? value : '#fff' }}>
        <input type="color" aria-label={`${label} picker`} value={fullHex(value)} onChange={(e) => onChange(e.target.value)} />
      </span>
      <div style={{ flex: 1 }}>
        <TextField label={label} value={value} onChange={onChange} error={error} autoComplete="off" maxLength={7} />
      </div>
    </div>
  );
}

function PresetCard({ preset, active, label, onPick }) {
  return (
    <button type="button" className={`cod-preset${active ? ' on' : ''}`} aria-pressed={active} onClick={onPick}>
      <span className="cod-preset-btn" style={{ background: preset.bg, color: preset.color }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></svg>
        <span>{label}</span>
      </span>
      <span className="cod-preset-n">{preset.name}{active ? ' ✓' : ''}</span>
    </button>
  );
}

const RADII = [
  { id: 'rounded', label: 'Rounded', r: 14 },
  { id: 'soft', label: 'Soft', r: 7 },
  { id: 'sharp', label: 'Sharp', r: 2 },
];

function RadiusCard({ option, active, accent, onPick }) {
  return (
    <button type="button" className={`cod-preset${active ? ' on' : ''}`} aria-pressed={active} onClick={onPick}>
      <span className="cod-rad-art" style={{ borderRadius: `${option.r + 4}px ${option.r + 4}px 0 0` }}>
        <i style={{ borderRadius: option.r }} />
        <i style={{ borderRadius: option.r, width: '70%' }} />
        <b style={{ borderRadius: option.r, background: accent }} />
      </span>
      <span className="cod-preset-n">{option.label}{active ? ' ✓' : ''}</span>
    </button>
  );
}

// A key the browser never gets back: shows "Saved ••••1234" with Replace / Remove.
function SecretField({ label, value, status, onChange, helpText, error, placeholder }) {
  const [editing, setEditing] = useState(false);
  const saved = Boolean(status?.set);
  if (value === null) {
    return (
      <div className="cod-secret">
        <BlockStack gap="050">
          <Text as="span" variant="bodyMd">{label}</Text>
          <Text as="span" variant="bodySm" tone="critical">Will be removed when you save.</Text>
        </BlockStack>
        <Button variant="plain" onClick={() => onChange('')}>Undo</Button>
      </div>
    );
  }
  if (saved && !editing && !value) {
    return (
      <div className="cod-secret">
        <BlockStack gap="050">
          <Text as="span" variant="bodyMd">{label}</Text>
          <InlineStack gap="150" blockAlign="center">
            <Badge tone="success" size="small">Saved</Badge>
            <Text as="span" variant="bodySm" tone="subdued">{`•••• ${status.last4}`}</Text>
          </InlineStack>
        </BlockStack>
        <ButtonGroup>
          <Button size="slim" onClick={() => setEditing(true)}>Replace</Button>
          <Button size="slim" tone="critical" variant="plain" onClick={() => onChange(null)}>Remove</Button>
        </ButtonGroup>
      </div>
    );
  }
  return (
    <TextField
      label={label}
      type="password"
      value={value || ''}
      onChange={onChange}
      helpText={helpText}
      error={error}
      placeholder={placeholder}
      autoComplete="off"
      connectedRight={saved ? <Button onClick={() => { onChange(''); setEditing(false); }}>Cancel</Button> : undefined}
    />
  );
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

export default function CodCheckoutPage() {
  const data = useLoaderData();
  const fetcher = useFetcher();
  const testFetcher = useFetcher();
  const [form, setForm] = useState(() => (data.settings ? toForm(data.settings) : null));
  const [saved, setSaved] = useState(() => (data.settings ? toForm(data.settings) : null));
  const [toast, setToast] = useState(null);
  const [tab, setTab] = useState(0);
  const [view, setView] = useState('overview');
  const [offerDraft, setOfferDraft] = useState('');
  const [offerProblem, setOfferProblem] = useState('');
  const [showChecklist, setShowChecklist] = useState(null);
  const [orderFilter, setOrderFilter] = useState('all');
  const [orderQuery, setOrderQuery] = useState('');
  const money = (n) => formatMoney(n, { currencyCode: data.currencyCode });

  const saving = fetcher.state !== 'idle';
  const errors = useMemo(() => (form ? formErrors(form) : {}), [form]);
  const dirty = form && saved && JSON.stringify(form) !== JSON.stringify(saved);
  // What shoppers would get with the settings on screen (same sanitising as the server).
  const preview = useMemo(() => (form ? sanitizeCodSettings(toSettings(form)) : null), [form]);

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
    const bad = Object.keys(errors);
    if (bad.length) {
      const first = TABS.findIndex((t) => t.fields.some((f) => bad.includes(f)));
      if (first !== -1) setTab(first);
      setView('settings');
      setToast({ content: 'Fix the highlighted fields first', error: true });
      return;
    }
    fetcher.submit(JSON.stringify({ settings: toSettings(form), secrets: secretsPatch(form) }), { method: 'post', encType: 'application/json' });
  };
  const testing = testFetcher.state !== 'idle';
  const testResult = testFetcher.data?.intent === 'test_tracking' ? testFetcher.data.result : null;
  const sendTest = () => testFetcher.submit(JSON.stringify({ intent: 'test_tracking' }), { method: 'post', encType: 'application/json' });

  if (!form) {
    return (
      <Page title="COD Checkout">
        <Banner tone="critical" title="COD Checkout couldn't load">{data.loadError}</Banner>
      </Page>
    );
  }

  /* --- status + checklist --- */
  const surfacesOn = [form.drawer && 'the cart drawer', form.product && 'product pages', form.combo && 'combo pages'].filter(Boolean);
  const planOk = data.planState === 'enabled';
  const required = [planOk, data.hasOrderScope, form.enabled, surfacesOn.length > 0];
  const doneCount = required.filter(Boolean).length;
  const allDone = doneCount === required.length;
  const checklistOpen = showChecklist == null ? !allDone : showChecklist;
  let heroState = 'live';
  if (!form.enabled) heroState = 'off';
  else if (!allDone) heroState = 'warn';
  const heroTitle = {
    live: 'Cash on Delivery is on',
    warn: "Cash on Delivery is on, but shoppers can't see it yet",
    off: 'Cash on Delivery is off',
  }[heroState];
  let heroText;
  if (heroState === 'off') heroText = 'Turn it on to offer Cash on Delivery next to your normal checkout. Prepaid orders always keep using Shopify checkout.';
  else if (heroState === 'warn') heroText = `${required.length - doneCount} setup ${required.length - doneCount === 1 ? 'step is' : 'steps are'} left before shoppers can see it.`;
  else heroText = `Shoppers can place COD orders from ${surfacesOn.length > 1 ? `${surfacesOn.slice(0, -1).join(', ')} and ${surfacesOn[surfacesOn.length - 1]}` : surfacesOn[0]}.`;

  /* --- tabs --- */
  const tabs = TABS.map((t) => ({ ...t, errors: t.fields.filter((f) => errors[f]).length }));
  const errorCount = tabs.reduce((n, t) => n + t.errors, 0);
  const ratio = contrastRatio(form.bg, form.color);
  const nudgeIdeas = [
    'Pay online for faster dispatch.',
    Number(form.codFee) > 0 ? `Pay online and skip the ${money(form.codFee)} COD fee.` : null,
    'Pay online and get 5% off with code PREPAID5.',
  ].filter(Boolean);

  let tabBody;
  const tabId = TABS[tab].id;
  if (tabId === 'placement') {
    tabBody = (
      <BlockStack gap="400">
        <Text as="p" tone="subdued">Choose where shoppers see the Cash on Delivery button. Pay online always goes to your normal checkout.</Text>
        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
          <PlaceTile id="drawer" title="Cart drawer" description="Above the checkout button in the BRIX cart drawer." checked={form.drawer} onChange={set('drawer')} bg={form.bg} />
          <PlaceTile id="product" title="Product pages" description={form.pbReplaceBuyNow ? 'In place of Buy it now. Buys just that product.' : 'Under Add to Cart. Buys just that product.'} checked={form.product} onChange={set('product')} bg={form.bg} />
          <PlaceTile id="combo" title="Combo pages" description="Next to Checkout on Build a Combo pages." checked={form.combo} onChange={set('combo')} bg={form.bg} />
        </InlineGrid>
        {!surfacesOn.length && <Banner tone="warning">Pick at least one place, or shoppers won&apos;t see Cash on Delivery anywhere.</Banner>}
        {form.product && (
          <ToggleRow
            icon={ProductIcon}
            title="Replace the Buy it now button"
            description={form.pbReplaceBuyNow
              ? "On product pages, Shopify's Buy it now button is hidden and the COD button takes its place. Themes without Buy it now get the COD button under Add to Cart."
              : 'Buy it now stays, and the COD button goes between Add to Cart and Buy it now.'}
            checked={form.pbReplaceBuyNow}
            onChange={set('pbReplaceBuyNow')}
          />
        )}
        <Text as="p" variant="bodySm" tone="subdued">Combo templates can each hide the button in the combo builder. Everything here needs the Custom Cart Drawer app embed turned on in your theme.</Text>
      </BlockStack>
    );
  } else if (tabId === 'charges') {
    tabBody = (
      <BlockStack gap="400">
        <Text as="p" tone="subdued">Added to COD orders as one shipping line called &quot;Cash on Delivery&quot;. Shoppers see each part separately before they order.</Text>
        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
          <TextField label="COD fee" type="number" min={0} value={form.codFee} onChange={set('codFee')} placeholder="0" prefix={data.currencyCode} error={errors.codFee} helpText="Extra charge for paying cash" autoComplete="off" />
          <TextField label="Shipping" type="number" min={0} value={form.shippingFee} onChange={set('shippingFee')} placeholder="Free" prefix={data.currencyCode} error={errors.shippingFee} helpText="Leave empty for free shipping" autoComplete="off" />
          <TextField label="Free shipping from" type="number" min={0} value={form.freeShippingAbove} onChange={set('freeShippingAbove')} placeholder="Never" prefix={data.currencyCode} error={errors.freeShippingAbove} helpText="Order value after discounts" autoComplete="off" />
        </InlineGrid>
        <Box padding="300" background="bg-surface-secondary" borderRadius="200">
          <Text as="p" variant="bodySm">
            {Number(form.codFee) > 0 || Number(form.shippingFee) > 0
              ? <>COD shoppers pay {Number(form.shippingFee) > 0 ? <b>{money(form.shippingFee)} shipping{Number(form.freeShippingAbove) > 0 ? ` (free from ${money(form.freeShippingAbove)})` : ''}</b> : <b>no shipping</b>}{Number(form.codFee) > 0 ? <> plus a <b>{money(form.codFee)} COD fee</b></> : ''}. Use &quot;Try a cart value&quot; in the preview to check any order.</>
              : <>COD orders have <b>no extra charges</b> right now: free shipping and no COD fee.</>}
          </Text>
        </Box>
      </BlockStack>
    );
  } else if (tabId === 'rules') {
    tabBody = (
      <BlockStack gap="400">
        <Text as="p" tone="subdued">Checked on our server for every order, so they can&apos;t be skipped from the browser.</Text>
        <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
          <TextField label="Minimum order" type="number" min={0} value={form.minOrder} onChange={set('minOrder')} placeholder="No minimum" prefix={data.currencyCode} error={errors.minOrder} autoComplete="off" />
          <TextField label="Maximum order" type="number" min={0} value={form.maxOrder} onChange={set('maxOrder')} placeholder="No maximum" prefix={data.currencyCode} error={errors.maxOrder} autoComplete="off" />
        </InlineGrid>
        <RangeSlider
          label="COD orders per phone number, per day"
          min={1}
          max={50}
          output
          value={Math.min(50, Math.max(1, Number(form.dailyLimitPerPhone) || 1))}
          onChange={(v) => set('dailyLimitPerPhone')(String(v))}
          helpText="Stops repeated fake orders from one number."
          error={errors.dailyLimitPerPhone}
          suffix={<div style={{ minWidth: 28, textAlign: 'right' }}><Text as="span" fontWeight="semibold">{form.dailyLimitPerPhone}</Text></div>}
        />
        <ChipInput
          label="Blocked PIN codes"
          value={form.blockedPincodes}
          onChange={set('blockedPincodes')}
          placeholder="Type or paste PIN codes, e.g. 744101"
          helpText="No COD for these areas, for example where many orders come back undelivered. Paste a whole list at once."
          error={errors.blockedPincodes}
          isValid={(p) => /^[1-9]\d{5}$/.test(p)}
          splitOnSpace
          emptyText="No blocked PIN codes. COD works everywhere you ship."
        />
        <ChipInput
          label="Products tagged with these can't use COD"
          value={form.excludedProductTags}
          onChange={set('excludedProductTags')}
          placeholder="e.g. no-cod, pre-order"
          helpText="Shopify product tags. Press Enter or type a comma to add."
          isValid={(t) => /^[\w\- .:/]{1,40}$/.test(t)}
        />
        <ToggleRow
          icon={PhoneIcon}
          title="Verify phone with an SMS code (OTP)"
          description={data.sms.configured ? 'Cuts fake orders. Each code is one SMS from your SMS provider.' : 'Takes effect once an SMS provider (MSG91) is connected on the BRIX server. Orders still work without it.'}
          checked={form.requireOtp}
          onChange={set('requireOtp')}
          badge={data.sms.configured ? <Badge tone="success" size="small">SMS connected</Badge> : <Badge tone="attention" size="small">No SMS provider</Badge>}
        />
      </BlockStack>
    );
  } else if (tabId === 'look') {
    tabBody = (
      <BlockStack gap="500">
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">Colour presets</Text>
          <div className="cod-presets">
            {STYLE_PRESETS.map((p) => (
              <PresetCard
                key={p.name}
                preset={p}
                label={form.drawerText || 'Cash on Delivery'}
                active={fullHex(form.bg) === p.bg && fullHex(form.color) === p.color}
                onPick={() => setForm((f) => ({ ...f, bg: p.bg, color: p.color }))}
              />
            ))}
          </div>
        </BlockStack>
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center" gap="200">
            <Text as="h3" variant="headingSm">Custom colours</Text>
            {HEX.test(form.bg) && HEX.test(form.color) && (
              <InlineStack gap="200" blockAlign="center">
                <span className={`cod-contrast ${ratio >= 4.5 ? 'ok' : 'bad'}`}>{ratio >= 4.5 ? 'Easy to read' : 'Hard to read'} · {ratio.toFixed(1)}:1</span>
                {ratio < 4.5 && <Button variant="plain" onClick={() => set('color')(contrastRatio(form.bg, '#ffffff') >= contrastRatio(form.bg, '#111827') ? '#ffffff' : '#111827')}>Fix text colour</Button>}
              </InlineStack>
            )}
          </InlineStack>
          <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
            <ColorPill label="Button colour" value={form.bg} onChange={set('bg')} error={errors.bg} />
            <ColorPill label="Text colour" value={form.color} onChange={set('color')} error={errors.color} />
          </InlineGrid>
        </BlockStack>
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">Button text</Text>
          <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
            <TextField label="Cart drawer" value={form.drawerText} onChange={set('drawerText')} error={errors.drawerText} maxLength={60} showCharacterCount autoComplete="off" />
            <TextField label="Product page" value={form.productText} onChange={set('productText')} error={errors.productText} maxLength={60} showCharacterCount autoComplete="off" />
          </InlineGrid>
        </BlockStack>
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center" gap="200">
            <Text as="h3" variant="headingSm">Product page button size and spacing</Text>
            {!PB_SIZES.every(({ key, field }) => form[field] === DEFAULT_COD_SETTINGS.productButton[key]) && (
              <Button variant="plain" onClick={() => setForm((f) => ({ ...f, ...productButtonForm({ replaceBuyNow: f.pbReplaceBuyNow }) }))}>Reset</Button>
            )}
          </InlineStack>
          <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
            {PB_SIZES.map(({ key, field, label, help }) => {
              const [min, max] = COD_PRODUCT_BUTTON_LIMITS[key];
              return (
                <RangeSlider
                  key={key}
                  label={label}
                  helpText={help}
                  min={min}
                  max={max}
                  value={form[field]}
                  onChange={(v) => set(field)(v)}
                  suffix={<div style={{ minWidth: 40, textAlign: 'right' }}><Text as="span" fontWeight="semibold">{form[field]} px</Text></div>}
                />
              );
            })}
          </InlineGrid>
          <Text as="p" variant="bodySm" tone="subdued">If you placed the COD button block in your theme, its own &quot;Space above&quot; adds to the space above set here.</Text>
        </BlockStack>
        <Text as="p" variant="bodySm" tone="subdued">These colours are also used in the COD checkout sheet. Combo page buttons are styled per template in the combo builder.</Text>
      </BlockStack>
    );
  } else if (tabId === 'coupons') {
    const offers = form.sheetOffers;
    const added = new Set(offers.map((o) => o.code.toLowerCase()));
    const known = new Map(data.couponOptions.map((o) => [o.code.toLowerCase(), o]));
    const choices = data.couponOptions.filter((o) => !added.has(o.code.toLowerCase()));
    const addOffer = (rawCode) => {
      const code = String(rawCode || '').trim();
      if (!/^[\w-]{1,60}$/.test(code)) { setOfferProblem('Codes use letters, numbers, - and _ only.'); return; }
      if (added.has(code.toLowerCase())) { setOfferProblem(`${code} is already in the list.`); return; }
      const match = known.get(code.toLowerCase());
      set('sheetOffers')([...offers, { code: match ? match.code : code, text: (match?.summary || match?.title || '').slice(0, 80) }]);
      setOfferDraft('');
      setOfferProblem('');
    };
    const editOffer = (i, text) => set('sheetOffers')(offers.map((o, j) => (j === i ? { ...o, text } : o)));
    const removeOffer = (i) => set('sheetOffers')(offers.filter((_, j) => j !== i));
    tabBody = (
      <BlockStack gap="500">
        <Text as="p" tone="subdued">Let shoppers use discount codes on Cash on Delivery orders. Shopify checks every code before an order is placed, so only real, active codes give a discount.</Text>
        <ToggleRow
          icon={DiscountIcon}
          title="Allow discount codes on COD orders"
          description="Also covers codes applied in the cart drawer or on combo pages."
          checked={form.allowCoupons}
          onChange={set('allowCoupons')}
        />
        {!form.allowCoupons ? (
          <Banner tone="info">Discount codes are off for COD orders, so the popup has no coupon field and codes from the cart drawer are ignored.</Banner>
        ) : (
          <>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">Coupon field in the popup</Text>
              <ToggleRow
                icon={MobileIcon}
                title="Show a coupon field"
                description="On the review step. Shoppers type a code, or tap Paste and it's applied straight away."
                checked={form.sheetCoupon}
                onChange={set('sheetCoupon')}
              />
              {form.sheetCoupon && (
                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300" alignItems="center">
                  <TextField label="Field text" value={form.sheetCouponLabel} onChange={set('sheetCouponLabel')} maxLength={40} showCharacterCount placeholder="Have a coupon code?" autoComplete="off" />
                  <Checkbox label="Show the code box open" helpText={'Instead of a "Have a coupon code? Add" row.'} checked={form.sheetCouponOpen} onChange={set('sheetCouponOpen')} />
                </InlineGrid>
              )}
            </BlockStack>
            {form.sheetCoupon && (
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingSm">Suggested offers</Text>
                  <Text as="span" variant="bodySm" tone="subdued">{offers.length} of 5</Text>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">Shown under the coupon field as cards shoppers tap to apply. Keep the text short, like &quot;10% off on orders above ₹999&quot;.</Text>
                {offers.map((o, i) => (
                  <div key={o.code} className="cod-offer">
                    <span className="cod-offer-code">{o.code}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <TextField label={`Offer text for ${o.code}`} labelHidden value={o.text} onChange={(v) => editOffer(i, v)} maxLength={80} placeholder="What the shopper gets" autoComplete="off" />
                    </div>
                    {!known.has(o.code.toLowerCase()) && <Badge tone="attention" size="small">Not in active codes</Badge>}
                    <Button icon={DeleteIcon} variant="plain" tone="critical" accessibilityLabel={`Remove ${o.code}`} onClick={() => removeOffer(i)} />
                  </div>
                ))}
                {offers.length < 5 && (
                  <Box padding="300" background="bg-surface-secondary" borderRadius="300">
                    <BlockStack gap="300">
                      {choices.length ? (
                        <Select
                          label="Add one of your Shopify codes"
                          options={[{ label: 'Choose a code…', value: '' }, ...choices.map((o) => ({ label: `${o.code} · ${o.title}`, value: o.code }))]}
                          value=""
                          onChange={(code) => code && addOffer(code)}
                        />
                      ) : (
                        <Text as="p" variant="bodySm" tone="subdued">
                          {data.couponOptions.length ? 'All your active codes are added.' : 'No active discount codes found in Shopify. '}
                          {!data.couponOptions.length && <Link url="/app/discounts/create">Create a discount code</Link>}
                        </Text>
                      )}
                      <InlineStack gap="200" blockAlign="end" wrap={false}>
                        <div style={{ flex: 1 }}>
                          <TextField label="Or type a code" value={offerDraft} onChange={(v) => { setOfferDraft(v); setOfferProblem(''); }} placeholder="e.g. WELCOME10" error={offerProblem || undefined} autoComplete="off" />
                        </div>
                        <Button onClick={() => addOffer(offerDraft)} disabled={!offerDraft.trim()}>Add</Button>
                      </InlineStack>
                    </BlockStack>
                  </Box>
                )}
              </BlockStack>
            )}
          </>
        )}
      </BlockStack>
    );
  } else if (tabId === 'popup') {
    const accent = form.sheetUseButton ? form.bg : form.sheetAccent;
    tabBody = (
      <BlockStack gap="500">
        <Text as="p" tone="subdued">How the Cash on Delivery checkout looks to your shoppers. The preview switches to it while you edit.</Text>
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">Store logo</Text>
          <LogoUploader value={form.sheetLogo} onChange={set('sheetLogo')} error={errors.sheetLogo} />
          {form.sheetLogo && (
            <InlineStack gap="300" blockAlign="center">
              <Text as="span" variant="bodySm">Logo size</Text>
              <ButtonGroup variant="segmented">
                {[['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']].map(([id, label]) => (
                  <Button key={id} size="slim" pressed={form.sheetLogoSize === id} onClick={() => set('sheetLogoSize')(id)}>{label}</Button>
                ))}
              </ButtonGroup>
            </InlineStack>
          )}
        </BlockStack>
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">Popup colour</Text>
          <ToggleRow
            icon={PaintBrushFlatIcon}
            title="Use my COD button colour"
            description="Buttons, steps and highlights in the popup match your Cash on Delivery button."
            checked={form.sheetUseButton}
            onChange={set('sheetUseButton')}
          />
          {!form.sheetUseButton && (
            <BlockStack gap="200">
              <div className="cod-swatches">
                {STYLE_PRESETS.filter((p) => p.color === '#ffffff').map((p) => (
                  <button key={p.bg} type="button" className={`cod-swatch${fullHex(form.sheetAccent) === p.bg ? ' on' : ''}`} style={{ background: p.bg }} aria-label={`Use ${p.name}`} onClick={() => set('sheetAccent')(p.bg)} />
                ))}
              </div>
              <ColorPill label="Popup accent colour" value={form.sheetAccent} onChange={set('sheetAccent')} error={errors.sheetAccent} />
              <Text as="p" variant="bodySm" tone="subdued">Text on this colour is set to black or white automatically, so it always stays readable.</Text>
            </BlockStack>
          )}
        </BlockStack>
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">Corners</Text>
          <div className="cod-radius">
            {RADII.map((o) => (
              <RadiusCard key={o.id} option={o} accent={HEX.test(accent) ? accent : '#111827'} active={form.sheetRadius === o.id} onPick={() => set('sheetRadius')(o.id)} />
            ))}
          </div>
        </BlockStack>
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">Show in the popup</Text>
          <ToggleRow icon={OrderIcon} title="Order summary" description="Product photos and subtotal at the top of the phone and address steps." checked={form.sheetSummary} onChange={set('sheetSummary')} />
          <ToggleRow icon={ShieldCheckMarkIcon} title="Trust badges" description="No advance payment · Pay at your doorstep · Verified by OTP, on the phone step." checked={form.sheetTrust} onChange={set('sheetTrust')} />
        </BlockStack>
        <TextField
          label="Thank-you message (optional)"
          value={form.sheetThanks}
          onChange={set('sheetThanks')}
          maxLength={120}
          showCharacterCount
          placeholder="Thank you for shopping with us!"
          helpText="Shown on the Order confirmed screen."
          autoComplete="off"
        />
        <div className="cod-brixnote">
          <img src="/brix-logo.png" alt="BRIX" />
          <Text as="p" variant="bodySm" tone="subdued">The popup opens with the BRIX loader and ends with &quot;Secured &amp; powered by BRIX&quot;.</Text>
        </div>
      </BlockStack>
    );
  } else if (tabId === 'tracking') {
    const st = data.secretsStatus || {};
    const savedTracking = data.settings?.tracking || {};
    const canTest = (savedTracking.ga4Id && st.ga4ApiSecret?.set) || (savedTracking.metaPixelId && st.metaCapiToken?.set);
    tabBody = (
      <BlockStack gap="500">
        <Text as="p" tone="subdued">
          COD orders are placed by BRIX, not through Shopify checkout, so the Google and Meta apps on your store don&apos;t see them.
          Add your IDs here and BRIX sends each checkout step and every COD purchase to Google Analytics and your Meta Pixel.
        </Text>
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">Google Analytics 4</Text>
          <TextField
            label="Measurement ID"
            value={form.ga4Id}
            onChange={set('ga4Id')}
            error={errors.ga4Id}
            placeholder="G-XXXXXXXXXX"
            helpText="In GA4: Admin, Data streams, then your web stream."
            autoComplete="off"
          />
          <SecretField
            label="Measurement Protocol API secret (recommended)"
            value={form.ga4ApiSecret}
            status={st.ga4ApiSecret}
            onChange={set('ga4ApiSecret')}
            error={errors.ga4ApiSecret}
            helpText="Lets BRIX also send each purchase from its server, so ad blockers can't hide it. In GA4: Admin, Data streams, your stream, Measurement Protocol API secrets, Create."
          />
        </BlockStack>
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">Meta Pixel</Text>
          <TextField
            label="Pixel ID"
            value={form.metaPixelId}
            onChange={set('metaPixelId')}
            error={errors.metaPixelId}
            placeholder="123456789012345"
            helpText="In Meta Events Manager: Data sources, then your pixel."
            autoComplete="off"
            inputMode="numeric"
          />
          <SecretField
            label="Conversions API access token (recommended)"
            value={form.metaCapiToken}
            status={st.metaCapiToken}
            onChange={set('metaCapiToken')}
            error={errors.metaCapiToken}
            helpText="Lets BRIX also send each purchase from its server, so iOS and ad blockers can't hide it. In Events Manager: your pixel, Settings, Conversions API, Generate access token."
          />
          <SecretField
            label="Test event code (only while testing)"
            value={form.metaTestCode}
            status={st.metaTestCode}
            onChange={set('metaTestCode')}
            error={errors.metaTestCode}
            placeholder="TEST12345"
            helpText="From Events Manager, Test events. While it's saved, server events show under Test events only. Remove it when you're done."
          />
        </BlockStack>
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm">Options</Text>
          <Select
            label="Product IDs sent with events"
            options={[
              { label: 'Shopify catalog IDs (shopify_IN_product_variant)', value: 'shopify' },
              { label: 'Variant ID', value: 'variant' },
              { label: 'SKU', value: 'sku' },
            ]}
            value={form.metaContentId}
            onChange={set('metaContentId')}
            helpText="Use Shopify catalog IDs if your products sync to Meta or Google through Shopify's sales channels, so the IDs match your catalog."
          />
          <ToggleRow
            icon={ChartVerticalIcon}
            title="Google Tag Manager"
            description="Also push brix_cod_begin_checkout … brix_cod_purchase events to your GTM dataLayer, when your theme has one."
            checked={form.dataLayer}
            onChange={set('dataLayer')}
          />
        </BlockStack>
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm">What gets sent</Text>
          <div className="cod-events">
            {[
              ['Popup opens', 'begin_checkout', 'InitiateCheckout'],
              ['Phone verified', 'cod_otp_verified', 'CodOtpVerified'],
              ['Address added', 'add_shipping_info', 'CodAddressAdded'],
              ['Review shown', 'add_payment_info', 'AddPaymentInfo'],
              ['Order placed', 'purchase', 'Purchase'],
            ].map(([step, ga, meta]) => (
              <div key={step}><span>{step}</span><code>{ga}</code><code>{meta}</code></div>
            ))}
          </div>
          <Text as="p" variant="bodySm" tone="subdued">
            Events follow your store&apos;s cookie banner (Shopify customer privacy): Google needs analytics consent, Meta needs marketing consent.
            Browser and server purchases share one order ID, so each order counts once. When Shopify cancels or refunds a COD order, Google Analytics gets a refund.
          </Text>
        </BlockStack>
        <BlockStack gap="200">
          <InlineStack gap="300" blockAlign="center">
            <Button icon={SendIcon} onClick={sendTest} loading={testing} disabled={!canTest || dirty}>Send test events</Button>
            <Text as="span" variant="bodySm" tone="subdued">
              {dirty ? 'Save first, then test.' : canTest ? 'Sends one test purchase to check your IDs and keys.' : 'Save an ID and its key or token to test.'}
            </Text>
          </InlineStack>
          {testResult && (
            <BlockStack gap="200">
              {[['Google Analytics', testResult.ga4], ['Meta', testResult.meta]].map(([name, r]) => (
                <Banner key={name} tone={r.status === 'sent' ? 'success' : r.status === 'off' ? 'info' : 'critical'} title={name}>{r.message}</Banner>
              ))}
            </BlockStack>
          )}
        </BlockStack>
      </BlockStack>
    );
  } else {
    tabBody = (
      <BlockStack gap="400">
        <Text as="p" tone="subdued">Every COD order is tagged COD and BRIX-COD in Shopify, with its payment marked as pending.</Text>
        <ChipInput
          label="Extra order tags"
          value={form.orderTags}
          onChange={set('orderTags')}
          placeholder="e.g. cod-verify"
          helpText="Press Enter or type a comma to add."
          isValid={(t) => /^[\w\- .:/]{1,40}$/.test(t)}
        />
        <BlockStack gap="200">
          <TextField label="Message encouraging online payment (optional)" value={form.prepaidNudgeText} onChange={set('prepaidNudgeText')} maxLength={140} showCharacterCount helpText="Shown on the COD review step with a Pay online button. If you mention a code, create that discount in Shopify first; BRIX doesn't create it for you." autoComplete="off" />
          <InlineStack gap="200" blockAlign="center">
            <Text as="span" variant="bodySm" tone="subdued">Ideas:</Text>
            {nudgeIdeas.map((idea) => (
              <button key={idea} type="button" className="cod-suggest" onClick={() => set('prepaidNudgeText')(idea)}>{idea}</button>
            ))}
          </InlineStack>
        </BlockStack>
      </BlockStack>
    );
  }

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
  const trackingOn = Boolean(data.settings?.tracking?.ga4Id || data.settings?.tracking?.metaPixelId);
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
      key: 'on', state: form.enabled ? 'done' : 'todo', title: 'Turn on Cash on Delivery',
      text: 'Use the switch above, then save.',
      action: <Button variant="primary" onClick={() => set('enabled')(true)}>Turn on</Button>,
    },
    {
      key: 'where', state: surfacesOn.length ? 'done' : 'todo', title: 'Choose where it shows',
      text: 'Pick at least one place in Settings, Placement.',
      action: <Button onClick={() => { setView('settings'); setTab(0); }}>Choose</Button>,
    },
    {
      key: 'embed', state: 'info', title: 'Custom Cart Drawer app embed is on in your theme',
      text: "The COD button and checkout load through this embed. BRIX can't check it from here.",
      action: <Button url="shopify://admin/themes/current/editor?context=apps" target="_top" icon={ExternalIcon}>Open theme editor</Button>,
    },
    {
      key: 'ads', state: form.ga4Id || form.metaPixelId ? 'done' : 'info', title: 'Ads & analytics (optional)',
      text: "COD orders don't pass through Shopify checkout, so your Google and Meta apps don't see them. Add your GA4 and Meta Pixel IDs to count them.",
      action: <Button onClick={() => { setView('settings'); setTab(TABS.findIndex((t) => t.id === 'tracking')); }}>Set up</Button>,
    },
    {
      key: 'sms', state: !form.requireOtp ? 'info' : data.sms.configured ? 'done' : 'todo', title: 'Phone verification by SMS (optional)',
      text: !form.requireOtp ? 'OTP is off. Turn it on in Rules & safety to cut fake orders.'
        : "OTP is on, but no SMS provider (MSG91) is connected on the BRIX server, so shoppers aren't asked for a code yet.",
    },
  ];
  const openItems = checklist.filter((c) => c.state !== 'done');
  const recent = data.orders.slice(0, 5);
  const VIEWS = [
    { id: 'overview', content: 'Overview' },
    { id: 'settings', content: 'Settings', badge: errorCount ? String(errorCount) : undefined },
    { id: 'orders', content: 'Orders', badge: data.orders.length ? String(data.orders.length) : undefined },
  ];

  return (
    <Frame>
      <style>{COD_ADMIN_CSS}</style>
      <Page
        title="COD Checkout"
        titleMetadata={heroState === 'live' ? <Badge tone="success">On</Badge> : heroState === 'warn' ? <Badge tone="attention">Not visible yet</Badge> : <Badge>Off</Badge>}
        primaryAction={{ content: 'Save', onAction: save, loading: saving, disabled: !dirty }}
        secondaryActions={dirty ? [{ content: 'Discard', onAction: () => setForm(saved), disabled: saving }] : []}
      >
        <BlockStack gap="400">
          {data.loadError && <Banner tone="critical">{data.loadError}</Banner>}

          {/* Compact status bar: what shoppers get right now, plus the main switch */}
          <div className={`cod-status ${heroState}`}>
            <span className="cod-status-ic"><Icon source={CashRupeeIcon} /></span>
            <div className="cod-status-t">
              <InlineStack gap="200" blockAlign="center">
                {heroState === 'live' && <span className="cod-pulse" aria-hidden="true" />}
                <Text as="h2" variant="headingMd">{heroTitle}</Text>
                {dirty && <Badge tone="info" size="small">Unsaved</Badge>}
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">{heroText}</Text>
            </div>
            <button type="button" className={`cod-steps ${allDone ? 'ok' : 'todo'}`} onClick={() => setShowChecklist(!checklistOpen)} aria-expanded={checklistOpen}>
              {allDone ? <Icon source={CheckCircleIcon} /> : <svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" /><circle cx="18" cy="18" r="15" style={{ strokeDasharray: 94.25, strokeDashoffset: 94.25 * (1 - doneCount / required.length) }} /></svg>}
              <span>{allDone ? 'Setup done' : `${doneCount}/${required.length} setup`}</span>
            </button>
            <Switch checked={form.enabled} onChange={set('enabled')} label="Cash on Delivery" />
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
              <button type="button" className="cod-cta" onClick={() => setView('settings')}>
                <span className="cod-cta-ic"><Icon source={PaintBrushFlatIcon} /></span>
                <span className="cod-cta-t">
                  <Text as="span" fontWeight="semibold">Customise COD</Text>
                  <Text as="span" variant="bodySm" tone="subdued">Placement, charges, rules and button style, with a live preview.</Text>
                </span>
                <Icon source={ChevronRightIcon} tone="subdued" />
              </button>
            </BlockStack>
          )}

          {view === 'settings' && (
            <InlineGrid columns={{ xs: 1, lg: ['twoThirds', 'oneThird'] }} gap="400" alignItems="start">
              <Card padding="0">
                <div className="cod-secnav" role="tablist" aria-label="COD settings sections">
                  {tabs.map((t, i) => (
                    <button key={t.id} type="button" role="tab" aria-selected={tab === i} className={`cod-sec${tab === i ? ' on' : ''}`} onClick={() => setTab(i)}>
                      <Icon source={t.icon} />
                      <span>{t.content}</span>
                      {t.errors ? <span className="cod-sec-err">{t.errors}</span> : null}
                    </button>
                  ))}
                </div>
                <Box padding="400">{tabBody}</Box>
              </Card>
              <div className="cod-sticky">
                <CodPreview settings={preview} money={money} focus={PREVIEW_FOCUS[TABS[tab].id] || null} />
              </div>
            </InlineGrid>
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
        {toast && <Toast content={toast.content} error={toast.error} onDismiss={() => setToast(null)} />}
      </Page>
    </Frame>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
