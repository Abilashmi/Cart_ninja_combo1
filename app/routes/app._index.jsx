import { useState } from 'react';
import { useLoaderData, useRouteError, useNavigate, useSearchParams, redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Page, Text, Icon, Modal, BlockStack } from '@shopify/polaris';
import {
  CartIcon, DiscountCodeIcon, RewardIcon, CashDollarIcon, CollectionIcon,
  ChartCohortIcon, ProductIcon, OrderIcon,
} from '@shopify/polaris-icons';
import { authenticate } from "../shopify.server";
import { getAnalyticsData } from "../services/analytics.server";
import { BASE_PHP_URL } from "../utils/api-helpers";
import { getAgencyStoreStatus } from "../utils/agency-dashboard.server";
import { useCurrency } from "../components/CurrencyContext";
import { cartDrawerEmbedEditorUrl } from '../config/theme-extension';
import { useAppEmbedStatus } from '../components/shared/useAppEmbedStatus';
import { formatAmount } from '../utils/currency.shared';
import { useT } from '../i18n/admin';
import { resolveCodRange } from '../utils/cod-dates.shared';
import DateRangePicker from '../components/shared/DateRangePicker';
import ModuleArt, { MODULE_ART_CSS } from '../components/home/ModuleArt';

/* ─── Loader: keep real Shopify auth + today's analytics ─── */

const DEFAULT_ANALYTICS = {
  checkout_click: 0,
  coupon_click: 0,
  upsell_click: 0,
  upsell_revenue_generated: 0,
  cartdrawer_total_revenue: 0,
  cartdrawer_total_coupon_applied: 0,
  avg_order_value: 0,
  conversion_rate: 0,
  order_count: 0,
};

function toCount(v) { const n = parseInt(v, 10); return isFinite(n) ? Math.max(0, n) : 0; }
function toAmount(v) {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return isFinite(n) ? Math.max(0, n) : 0;
}
function normalizeAnalytics(p = {}) {
  return {
    checkout_click: toCount(p.checkout_click),
    coupon_click: toCount(p.coupon_click),
    upsell_click: toCount(p.upsell_click),
    upsell_revenue_generated: toAmount(p.upsell_revenue_generated),
    cartdrawer_total_revenue: toAmount(p.cartdrawer_total_revenue),
    cartdrawer_total_coupon_applied: toCount(p.cartdrawer_total_coupon_applied),
    avg_order_value: toAmount(p.avg_order_value),
    conversion_rate: toAmount(p.conversion_rate),
    order_count: toCount(p.order_count),
  };
}

// The stats period picked at the top of Home: ?range=<preset id> (today, yesterday, last7, last30,
// last90, thisMonth, lastMonth) or ?from=YYYY-MM-DD&to=YYYY-MM-DD; none = last 30 days.
// Older links used 7d / 30d / 90d.
const LEGACY_RANGES = { '7d': 'last7', '30d': 'last30', '90d': 'last90' };
const RANGE_LABELS = {
  today: 'admin.home.range_today', last7: 'admin.home.range_7', last30: 'admin.home.range_30', last90: 'admin.home.range_90',
};

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const params = new URL(request.url).searchParams;
  const rangeParam = params.get('range');
  const resolved = resolveCodRange({ range: LEGACY_RANGES[rangeParam] || rangeParam, from: params.get('from'), to: params.get('to') });
  const range = { preset: resolved.preset, label: resolved.label, from: resolved.from, to: resolved.to, today: resolved.today };
  const shop = session.shop;

  // A merchant landing here right after installing BRIX (or reopening it
  // with an agency authorization/activation still pending) should be sent
  // straight into the agency-connect screen instead of ordinary Home.
  // Fails open to Home for every other stage (COMPLETE, NOT_INSTALLED,
  // ERROR, no relationship at all) — the vast majority of merchants have
  // no agency relationship and must never be gated here.
  const agencyStatus = await getAgencyStoreStatus(shop);
  const needsAgencyConnect = ["AUTHORIZATION_REQUIRED", "ACTIVATION_REQUIRED"].includes(agencyStatus.stage);
  // eslint-disable-next-line no-undef
  console.log(`[BRIX AGENCY DEBUG] shop=${shop} stage=${agencyStatus.stage} redirect=${needsAgencyConnect ? "/app/agency-connect" : "none"}`);
  if (needsAgencyConnect) {
    return redirect("/app/agency-connect");
  }

  try {
    fetch(`${BASE_PHP_URL}/install_shop.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop }),
    }).catch(console.error);
  } catch {}

  let initialAnalytics = { ...DEFAULT_ANALYTICS };
  try {
    // Calls the analytics loader logic directly in-process instead of
    // fetching this app's own /api/analytics route over HTTP — a self-fetch
    // would round-trip out through the public tunnel URL and back on every
    // home-page load.
    const data = await getAnalyticsData(shop, range.from, range.to);
    if (data?.success) initialAnalytics = normalizeAnalytics(data.data);
  } catch {}

  return { shop, initialAnalytics, range };
};

/* ─── The six modules on Home ─── */

// Paste a GIF, MP4/WebM or image link (https, or a file in /public like '/home/cart.gif') for each
// module card. Empty = the icon placeholder. GIFs and images show as pictures; .mp4 / .webm /
// .mov play muted on a loop.
const MODULE_MEDIA = {
  cart: '',
  combo: '',
  cod: '',
  packs: '',
  fbt: '',
  coupon: '',
};

// Switching a module on opens its page (every switch starts off).
const MODULES = [
  { id: 'cart',   title: 'admin.home.mod_cart_title',   desc: 'admin.home.mod_cart_desc',   to: '/app/cartdrawer',    icon: CartIcon,         tint: '#e0f2fe', accent: '#0284c7' },
  { id: 'combo',  title: 'admin.home.mod_combo_title',  desc: 'admin.home.mod_combo_desc',  to: '/app/bundles',       icon: CollectionIcon,   tint: '#dcfce7', accent: '#16a34a' },
  { id: 'cod',    title: 'admin.home.mod_cod_title',    desc: 'admin.home.mod_cod_desc',    to: '/app/cod',           icon: CashDollarIcon,   tint: '#fef3c7', accent: '#d97706' },
  { id: 'packs',  title: 'admin.home.mod_packs_title',  desc: 'admin.home.mod_packs_desc',  to: '/app/packs',         icon: ProductIcon,      tint: '#ede9fe', accent: '#7c3aed' },
  { id: 'fbt',    title: 'admin.home.mod_fbt_title',    desc: 'admin.home.mod_fbt_desc',    to: '/app/fbt',           icon: RewardIcon,       tint: '#fce7f3', accent: '#db2777' },
  { id: 'coupon', title: 'admin.home.mod_coupon_title', desc: 'admin.home.mod_coupon_desc', to: '/app/productwidget', icon: DiscountCodeIcon, tint: '#ffedd5', accent: '#ea580c' },
];

const HOME_STYLES = `
.brx-home-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.brx-home-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
@media (max-width:900px){.brx-home-grid,.brx-home-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:560px){.brx-home-grid,.brx-home-kpis{grid-template-columns:minmax(0,1fr)}}
.brx-home-card{background:#fff;border:1px solid #e3e5e8;border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.brx-home-media{height:160px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.brx-home-media img,.brx-home-media video{width:100%;height:100%;object-fit:cover;display:block}
.brx-home-switch{position:relative;width:40px;height:24px;border-radius:999px;border:none;background:#c9cccf;cursor:pointer;padding:0;flex:none;transition:background .15s}
.brx-home-switch::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .15s}
.brx-home-switch[aria-checked="true"]{background:#111}
.brx-home-switch[aria-checked="true"]::after{transform:translateX(16px)}
.brx-home-banner{position:relative;overflow:hidden;border-radius:18px;padding:30px 32px;display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;color:#fff;background:#000;box-shadow:0 8px 28px rgba(0,0,0,.25)}
.brx-home-banner-text,.brx-home-banner-actions{position:relative;z-index:1}
.brx-home-title{margin:0;font-size:30px;line-height:1.15;font-weight:800;letter-spacing:-.01em;animation:brx-home-rise .7s ease both}
.brx-home-sub{margin:6px 0 0;font-size:14px;color:rgba(255,255,255,.82);animation:brx-home-rise .7s .12s ease both}
.brx-home-toolbar{display:flex;justify-content:flex-end}
.brx-home-banner-actions{display:flex;align-items:center;gap:10px;animation:brx-home-rise .7s .22s ease both}
.brx-home-banner-actions .Polaris-Select__SelectedOption,.brx-home-banner-actions .Polaris-Select__Content{color:#202223}
.brx-home-orb{position:absolute;border-radius:50%;filter:blur(2px);opacity:.55;pointer-events:none}
.brx-home-orb--a{width:180px;height:180px;right:12%;top:-70px;background:radial-gradient(circle at 30% 30%,#60a5fa,transparent 70%);animation:brx-home-float 9s ease-in-out infinite}
.brx-home-orb--b{width:120px;height:120px;left:38%;bottom:-50px;background:radial-gradient(circle at 30% 30%,#c084fc,transparent 70%);animation:brx-home-float 11s -3s ease-in-out infinite}
.brx-home-orb--c{width:80px;height:80px;left:6%;top:-30px;background:radial-gradient(circle at 30% 30%,#34d399,transparent 70%);animation:brx-home-float 8s -5s ease-in-out infinite}
@keyframes brx-home-flow{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
@keyframes brx-home-float{0%,100%{transform:translateY(0) translateX(0)}50%{transform:translateY(16px) translateX(-10px)}}
@keyframes brx-home-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.brx-home-card{animation:brx-home-rise .55s ease both}
.brx-home-card:hover{box-shadow:0 8px 22px rgba(15,23,42,.1);transform:translateY(-2px);transition:box-shadow .2s,transform .2s}
@media (prefers-reduced-motion:reduce){.brx-home-banner,.brx-home-orb,.brx-home-title,.brx-home-sub,.brx-home-banner-actions,.brx-home-card{animation:none}.brx-home-card:hover{transform:none}}
.brx-home-switch:focus-visible{outline:2px solid #2c6ecb;outline-offset:2px}
`;

function ModuleMedia({ id, tint, accent }) { // eslint-disable-line react/prop-types
  const url = MODULE_MEDIA[id];
  const isVideo = /\.(mp4|webm|mov)(\?|#|$)/i.test(url || '');
  return (
    <div className="brx-home-media" style={{ background: tint }}>
      {url && isVideo && <video src={url} autoPlay loop muted playsInline aria-hidden="true" />}
      {url && !isVideo && <img src={url} alt="" loading="lazy" />}
      {!url && <ModuleArt id={id} accent={accent} />}
    </div>
  );
}

export default function DashboardPage() {
  const { shop, initialAnalytics, range } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();
  // Real app embed status from App Bridge (it used to always say "active").
  const embedStatus = useAppEmbedStatus();
  const { symbol: currencySymbol, code: currencyCode } = useCurrency();
  const navigate = useNavigate();
  const t = useT();
  const analytics = normalizeAnalytics(initialAnalytics);

  // Every module switch starts off; turning one on opens that module's page.
  const [enabling, setEnabling] = useState(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const enableModule = (module) => {
    if (enabling) return;
    setEnabling(module.id);
    setTimeout(() => navigate(module.to), 180);
  };

  const [fbkRating, setFbkRating] = useState(0);
  const [fbkHovered, setFbkHovered] = useState(0);
  const [fbkNote, setFbkNote] = useState('');
  const [fbkSubmitted, setFbkSubmitted] = useState(false);
  const [fbkSubmitting, setFbkSubmitting] = useState(false);
  const [fbkError, setFbkError] = useState('');

  const submitFeedback = async () => {
    if (!fbkRating || fbkSubmitting) return;
    setFbkSubmitting(true);
    setFbkError('');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: fbkRating, note: fbkNote }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || t('admin.home.feedback_failed'));
      setFbkSubmitted(true);
    } catch (e) {
      setFbkError(e.message || t('admin.common.generic_error'));
    } finally {
      setFbkSubmitting(false);
    }
  };

  const kpis = [
    { label: t('admin.home.kpi_orders'), value: String(analytics.order_count), icon: OrderIcon, accent: '#0284c7' },
    { label: t('admin.home.kpi_revenue_generated'), value: formatAmount(analytics.cartdrawer_total_revenue, currencySymbol, currencyCode), icon: CashDollarIcon, accent: '#16a34a' },
    { label: t('admin.home.kpi_conversion'), value: `${analytics.conversion_rate.toFixed(1).replace(/\.0$/, '')}%`, icon: ChartCohortIcon, accent: '#7c3aed' },
  ];

  return (
    <Page fullWidth>
      <style>{HOME_STYLES + MODULE_ART_CSS}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Period picker and a blinking "How to set up", which opens the video tutorials on the Account page */}
        <div className="brx-home-toolbar">
          <div className="brx-home-banner-actions">
            <DateRangePicker
              range={range}
              presetLabel={(p) => (RANGE_LABELS[p.id] ? t(RANGE_LABELS[p.id]) : p.label)}
              onApply={(pick) => {
                const next = new URLSearchParams(searchParams);
                ['range', 'from', 'to'].forEach((k) => next.delete(k));
                if (pick.preset) next.set('range', pick.preset);
                else { next.set('from', pick.from); next.set('to', pick.to); }
                setSearchParams(next);
              }} />
            <s-button icon="question-circle" accessibilityLabel={t('admin.home.help_label')} onClick={() => setSetupOpen(true)}>How to set up</s-button>
            <Modal
              open={setupOpen}
              onClose={() => setSetupOpen(false)}
              title="How to set up BRIX"
              primaryAction={{ content: 'Watch video tutorials', onAction: () => { setSetupOpen(false); navigate('/app/additional#tutorials'); } }}
              secondaryActions={[{ content: 'Close', onAction: () => setSetupOpen(false) }]}
            >
              <Modal.Section>
                <BlockStack gap="300">
                  <Text as="p"><b>1. Turn on the app embed.</b> In your theme editor, switch on &ldquo;Custom Cart Drawer&rdquo; so BRIX shows on your store.</Text>
                  <Text as="p"><b>2. Design your cart drawer.</b> Open Cart Drawer and set colours, header, progress bar, coupons and upsells.</Text>
                  <Text as="p"><b>3. Add offers.</b> Create coupons, upsells, frequently bought together and bundles from the menu.</Text>
                  <Text as="p"><b>4. Check your store.</b> Add a product to the cart on your storefront and see the drawer.</Text>
                </BlockStack>
              </Modal.Section>
            </Modal>
          </div>
        </div>

        {/* KPI strip */}
        <div className="brx-home-kpis">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="brx-home-card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ display: 'inline-flex', width: 40, height: 40, borderRadius: 10, background: '#f4f6f8', color: kpi.accent, alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                <span style={{ display: 'inline-flex', width: 22, height: 22 }}><Icon source={kpi.icon} tone="inherit" /></span>
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#111', lineHeight: 1.2 }}>{kpi.value}</div>
                <Text as="p" variant="bodySm" tone="subdued">{kpi.label}</Text>
              </div>
            </div>
          ))}
        </div>

        {/* Module cards: each switch starts off and opens its module when turned on */}
        <div className="brx-home-grid">
          {MODULES.map((module) => {
            const name = t(module.title);
            return (
              <div key={module.id} className="brx-home-card">
                <ModuleMedia id={module.id} tint={module.tint} accent={module.accent} />
                <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <Text as="h2" variant="headingSm" fontWeight="semibold">{name}</Text>
                    <div style={{ marginTop: 2 }}><Text as="p" variant="bodySm" tone="subdued">{t(module.desc)}</Text></div>
                  </div>
                  <button type="button" role="switch" className="brx-home-switch" aria-checked={enabling === module.id ? 'true' : 'false'} aria-label={t('admin.home.mod_toggle', { name })}
                    onClick={() => enableModule(module)} />
                </div>
              </div>
            );
          })}
        </div>

                {/* Feedback */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '20px 24px' }}>
          {fbkSubmitted ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '16px 0' }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#f0fdf4', border: '1.5px solid #86efac', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <Text as="p" variant="headingSm" fontWeight="bold" alignment="center">{t('admin.home.feedback_thanks')}</Text>
              <Text as="p" variant="bodyXs" tone="subdued" alignment="center">{t('admin.home.feedback_helps')}</Text>
              <button onClick={() => { setFbkSubmitted(false); setFbkRating(0); setFbkNote(''); setFbkError(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 12 }}>{t('admin.home.rate_again')}</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'start', gap: 24 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text as="p" variant="headingSm" fontWeight="bold">{t('admin.home.feedback')}</Text>
                </div>
                <div style={{ marginTop: 4 }}><Text as="p" variant="bodyXs" tone="subdued">{t('admin.home.feedback_sub')}</Text></div>
                <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
                  {[1,2,3,4,5].map(s => (
                    <button key={s} onClick={() => setFbkRating(s)} onMouseEnter={() => setFbkHovered(s)} onMouseLeave={() => setFbkHovered(0)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', transition: 'transform .12s', transform: fbkHovered >= s || fbkRating >= s ? 'scale(1.15)' : 'scale(1)' }}>
                      <svg width="26" height="26" viewBox="0 0 24 24" fill={fbkRating >= s || fbkHovered >= s ? '#1a1a1a' : 'none'} stroke={fbkRating >= s || fbkHovered >= s ? '#1a1a1a' : '#d1d5db'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'stretch' }}>
                <textarea value={fbkNote} onChange={e => setFbkNote(e.target.value)} placeholder={t('admin.home.feedback_placeholder')} rows={3}
                  style={{ width: '100%', padding: '10px 13px', border: '1px solid #e5e7eb', borderRadius: 9, fontSize: 12, color: '#1a1a1a', background: '#fafafa', resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5, boxSizing: 'border-box' }}
                  onFocus={e => { e.target.style.borderColor = '#9ca3af'; e.target.style.background = '#fff'; }}
                  onBlur={e => { e.target.style.borderColor = '#e5e7eb'; e.target.style.background = '#fafafa'; }}
                />
                {fbkError && <Text as="p" variant="bodyXs" tone="critical">{fbkError}</Text>}
              </div>
              <button onClick={submitFeedback} disabled={!fbkRating || fbkSubmitting}
                style={{ padding: '10px 22px', background: fbkRating ? '#1a1a1a' : '#f3f4f6', color: fbkRating ? '#fff' : '#9ca3af', border: 'none', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: fbkRating && !fbkSubmitting ? 'pointer' : 'default', whiteSpace: 'nowrap', alignSelf: 'stretch', opacity: fbkSubmitting ? 0.7 : 1 }}>
                {fbkSubmitting ? t('admin.home.sending') : t('admin.home.send_feedback')}
              </button>
            </div>
          )}
        </div>

                {/* App embed status (shopify.app.extensions()) + a link that turns it on */}
        <div style={{ background: embedStatus === 'off' ? '#fffbeb' : '#f9fafb', border: `1px solid ${embedStatus === 'off' ? '#fcd34d' : '#e5e7eb'}`, borderRadius: 12, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <Text as="p" variant="bodySm" fontWeight="semibold">
              {embedStatus === 'active' ? t('admin.home.embed_live') : embedStatus === 'off' ? t('admin.home.embed_turn_on_title') : t('admin.home.embed')}
            </Text>
            <div style={{ marginTop: 2 }}>
              <Text as="p" variant="bodyXs" tone="subdued">
                {embedStatus === 'active'
                  ? t('admin.home.embed_live_help')
                  : embedStatus === 'off'
                    ? t('admin.home.embed_off_help')
                    : t('admin.home.embed_help')}
              </Text>
            </div>
          </div>
          <button onClick={() => window.open(embedStatus === 'active' ? `https://${shop}/admin/themes/current/editor?context=apps` : cartDrawerEmbedEditorUrl(shop), '_blank')}
            style={{ padding: '8px 18px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            {embedStatus === 'active' ? t('admin.home.open_theme_editor') : t('admin.home.turn_on_embed')}
          </button>
        </div>

        <div style={{ height: 72 }} />
      </div>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
