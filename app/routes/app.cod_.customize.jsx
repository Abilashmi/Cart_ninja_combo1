/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
// Customize BRIX COD (/app/cod/customize), laid out like the Cart Editor: the
// sections on the left, the live preview of the cart drawer, product page and
// COD checkout on the right. The dashboard and orders stay on /app/cod.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFetcher, useLoaderData, useNavigate, useRouteError, useSearchParams } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import {
  Page, Card, FormLayout, BlockStack, InlineStack, Text, TextField, Banner, Badge, Button, Toast, Frame,
  ButtonGroup, Select, Checkbox, ChoiceList, Icon,
} from '@shopify/polaris';
import {
  ArrowLeftIcon, ChevronDownIcon, DesktopIcon, MobileIcon, CashRupeeIcon, CartIcon, ButtonIcon, CodeIcon, ProductIcon,
  CollectionIcon, ReceiptIcon, DeliveryIcon, FilterIcon, ShieldCheckMarkIcon, PaintBrushFlatIcon, DiscountIcon,
  ChartVerticalIcon, OrderIcon, DeleteIcon, SendIcon,
} from '@shopify/polaris-icons';
import { authenticate } from '../shopify.server';
import { getShopPlan } from '../services/plan-permissions.server';
import { getFeatureState } from '../config/plans';
import { getShopCurrency } from '../utils/currency.server';
import { formatMoney } from '../utils/currency.shared';
import {
  CodError, getCodSettings, saveCodSettings, syncCodRuntime, getCodSecrets, getCodSecretsStatus, saveCodSecrets,
} from '../services/cod.server';
import { sendCodTestEvents } from '../services/cod-tracking.server';
import { smsProviderStatus } from '../services/cod-sms.server';
import { listActiveDiscounts } from '../services/discounts.server';
import { sanitizeCodSettings, DEFAULT_COD_SETTINGS, COD_PRODUCT_BUTTON_LIMITS, COD_FEE_LABEL_DEFAULT } from '../utils/cod.shared';
import LogoUploader from '../components/cod/LogoUploader';
import ChipInput from '../components/cod/ChipInput';
import { buildCodScreen, cartSliderMax, suggestedValue } from '../components/cod/CodPreview';
import { CodFlow, PlacementPicker, FeeSummary, ExcludedTagsInput } from '../components/cod/CodSettingsCards';
import {
  toForm, toSettings, formErrors, secretsPatch, productButtonForm, PB_SIZES, STYLE_PRESETS, HEX, fullHex, contrastRatio, RADII,
} from '../components/cod/codSettingsForm';
import { ColorField } from '../components/sections/ColorField';
import { SliderField } from '../components/shared/SliderField';
import { COD_ADMIN_CSS } from '../components/cod/codAdminStyles';
import { COD_SETTINGS_CSS } from '../components/cod/codSettingsStyles';
import { COD_CUSTOMIZE_CSS } from '../components/cod/codCustomizeStyles';

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const [planKey, currency] = await Promise.all([getShopPlan(shop, admin), getShopCurrency(admin, shop)]);
  let settings = null;
  let couponOptions = [];
  let secretsStatus = null;
  let loadError = null;
  try {
    settings = await getCodSettings(shop);
    await syncCodRuntime(shop);
    // Only "set / last 4" — the GA4 secret and Meta token never reach the browser.
    secretsStatus = await getCodSecretsStatus(shop);
    couponOptions = (await listActiveDiscounts(admin).catch(() => []))
      .filter((d) => !d.isAutomatic && d.code && d.status === 'ACTIVE')
      .map((d) => ({ code: d.code, title: d.title || '', summary: d.summary || '' }));
  } catch (error) {
    if (error instanceof CodError && error.code === 'storage_missing') {
      loadError = "COD Checkout's files aren't on the BRIX PHP server yet (php_backend/cod_*.php). Upload them, then reload this page.";
    } else {
      loadError = error instanceof CodError ? error.message : 'COD settings could not be loaded. Please try again.';
    }
    if (!(error instanceof CodError)) console.error('[app.cod.customize] load failed:', String(error?.message || error).slice(0, 300));
  }
  return {
    settings,
    loadError,
    planState: getFeatureState(planKey, 'cod_checkout'),
    currencyCode: currency.code,
    sms: smsProviderStatus(),
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
    if (!(error instanceof CodError)) console.error('[app.cod.customize] save failed:', String(error?.message || error).slice(0, 300));
    return { success: false, error: message };
  }
}

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


// Sidebar sections, grouped like the Cart Editor's. `preview` = screen the live
// preview switches to when the section opens; `fields` = form fields whose
// errors belong to it; `toggle` = form flag shown as an On/Off badge on the row.
const GROUPS = [
  {
    title: 'Get started',
    items: [{ id: 'status', label: 'How COD works', icon: CashRupeeIcon, preview: 'drawer', fields: [] }],
  },
  {
    title: 'Cart drawer',
    items: [
      { id: 'position', label: 'Position', icon: CartIcon, preview: 'drawer', fields: [], toggle: 'drawer' },
      { id: 'button', label: 'COD button', icon: ButtonIcon, preview: 'drawer', fields: ['drawerText', 'bg', 'color'] },
      { id: 'theme', label: 'Theme compatibility', icon: CodeIcon, preview: 'drawer', fields: ['drawerSelector'] },
    ],
  },
  {
    title: 'Other pages',
    items: [
      { id: 'product', label: 'Product page', icon: ProductIcon, preview: 'product', fields: ['productText'], toggle: 'product' },
      { id: 'combo', label: 'Combo pages', icon: CollectionIcon, preview: 'drawer', fields: [], toggle: 'combo' },
    ],
  },
  {
    title: 'Charges & rules',
    items: [
      { id: 'fee', label: 'COD fee', icon: ReceiptIcon, preview: 'sheet', fields: ['codFee', 'codFeeLabel'], toggle: 'codFeeEnabled' },
      { id: 'shipping', label: 'Shipping', icon: DeliveryIcon, preview: 'sheet', fields: ['shippingFee', 'freeShippingAbove'] },
      { id: 'eligibility', label: 'Eligibility', icon: FilterIcon, preview: 'drawer', fields: ['minOrder', 'maxOrder'] },
      { id: 'fraud', label: 'Fraud protection', icon: ShieldCheckMarkIcon, preview: 'sheet', fields: ['dailyLimitPerPhone', 'blockedPincodes'] },
    ],
  },
  {
    title: 'Checkout popup',
    items: [
      { id: 'popup', label: 'Popup design', icon: PaintBrushFlatIcon, preview: 'sheet', fields: ['sheetLogo', 'sheetAccent'] },
      { id: 'coupons', label: 'Coupons', icon: DiscountIcon, preview: 'sheet', fields: [], toggle: 'allowCoupons' },
    ],
  },
  {
    title: 'Advanced',
    items: [
      { id: 'tracking', label: 'Ads & analytics', icon: ChartVerticalIcon, preview: null, fields: ['ga4Id', 'metaPixelId', 'ga4ApiSecret', 'metaCapiToken', 'metaTestCode'] },
      { id: 'orders', label: 'Order settings', icon: OrderIcon, preview: null, fields: [] },
    ],
  },
];
const SECTIONS = GROUPS.flatMap((g) => g.items);
const SURFACES = [['drawer', 'Cart drawer'], ['product', 'Product page'], ['sheet', 'COD checkout']];

// useLayoutEffect warns during server rendering; it only matters in the browser.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Fits the product page / COD checkout preview inside the device frame, like
 * the Cart Editor's preview: the whole screen is always visible, never
 * scrolled. When it's taller than the frame it's scaled down to fit.
 */
function useFitToFrame(outerRef, innerRef, pad, centre, deps) {
  const [fit, setFit] = useState({ scale: 1, top: pad });
  useIsoLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return undefined;
    const measure = () => {
      const needH = inner.offsetHeight; // unaffected by the transform
      const availH = outer.clientHeight - pad * 2;
      const scale = needH > 0 && availH > 0 ? Math.min(1, availH / needH) : 1;
      const top = centre ? Math.max(pad, (outer.clientHeight - needH * scale) / 2) : pad;
      setFit((f) => (Math.abs(f.scale - scale) < 0.002 && Math.abs(f.top - top) < 0.5 ? f : { scale, top }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return fit;
}
const BUTTON_STYLES = [['filled', 'Filled'], ['outline', 'Outline'], ['minimal', 'Minimal']];

export default function CodCustomizePage() {
  const data = useLoaderData();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const testFetcher = useFetcher();
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState(() => (data.settings ? toForm(data.settings) : null));
  const [saved, setSaved] = useState(() => (data.settings ? toForm(data.settings) : null));
  const [toast, setToast] = useState(null);
  const [open, setOpen] = useState(() => (SECTIONS.some((s) => s.id === searchParams.get('section')) ? searchParams.get('section') : 'position'));
  const [surface, setSurface] = useState(() => SECTIONS.find((s) => s.id === open)?.preview || 'drawer');
  const [device, setDevice] = useState('desktop');
  const [loader, setLoader] = useState(false);
  const [excludedOn, setExcludedOn] = useState(false);
  const [cart, setCart] = useState(() => (data.settings ? suggestedValue(data.settings) : 1299));
  const [offerDraft, setOfferDraft] = useState('');
  const [offerProblem, setOfferProblem] = useState('');
  const money = (n) => formatMoney(n, { currencyCode: data.currencyCode });
  const screenRef = useRef(null);
  const fitRef = useRef(null);
  const fitPad = device === 'desktop' ? 14 : 0;
  // Centred in the desktop frame; from the top of the screen on a phone.
  const fit = useFitToFrame(screenRef, fitRef, fitPad, device === 'desktop', [surface, device, Boolean(form)]);

  const saving = fetcher.state !== 'idle';
  const errors = useMemo(() => (form ? formErrors(form) : {}), [form]);
  const dirty = Boolean(form && saved && JSON.stringify(form) !== JSON.stringify(saved));
  // What shoppers would get with the settings on screen (same sanitising as the server).
  const preview = useMemo(() => (form ? sanitizeCodSettings(toSettings(form)) : null), [form]);

  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return;
    if (fetcher.data.success) {
      const next = toForm(fetcher.data.settings);
      setForm(next);
      setSaved(next);
      setToast({ content: 'Saved' });
    } else {
      setToast({ content: fetcher.data.error || 'Save failed', error: true });
    }
  }, [fetcher.state, fetcher.data]);

  // Opening the COD checkout replays the BRIX loader, as shoppers see it.
  useEffect(() => {
    if (!loader) return undefined;
    const t = setTimeout(() => setLoader(false), 1100);
    return () => clearTimeout(t);
  }, [loader]);
  const showSurface = (id) => { setSurface(id); if (id === 'sheet') setLoader(true); };

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
  const toggleSection = (id) => {
    const next = open === id ? null : id;
    setOpen(next);
    const sec = SECTIONS.find((s) => s.id === next);
    if (sec?.preview && sec.preview !== surface) showSurface(sec.preview);
  };
  const save = () => {
    const bad = Object.keys(errors);
    if (bad.length) {
      const first = SECTIONS.find((s) => s.fields.some((f) => bad.includes(f)));
      if (first) setOpen(first.id);
      setToast({ content: 'Fix the highlighted fields first', error: true });
      return;
    }
    fetcher.submit(JSON.stringify({ settings: toSettings(form), secrets: secretsPatch(form) }), { method: 'post', encType: 'application/json' });
  };
  const discard = () => setForm(saved);
  const goBack = () => {
    // eslint-disable-next-line no-alert
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    navigate('/app/cod');
  };
  const testing = testFetcher.state !== 'idle';
  const testResult = testFetcher.data?.intent === 'test_tracking' ? testFetcher.data.result : null;
  const sendTest = () => testFetcher.submit(JSON.stringify({ intent: 'test_tracking' }), { method: 'post', encType: 'application/json' });

  if (!form) {
    return (
      <Page backAction={{ content: 'COD Checkout', onAction: () => navigate('/app/cod') }} title="Customize COD">
        <Banner tone="critical" title="COD couldn't load">{data.loadError}</Banner>
      </Page>
    );
  }

  const textOnWhite = form.btnStyle !== 'filled';
  const ratio = textOnWhite ? contrastRatio(form.bg, '#ffffff') : contrastRatio(form.bg, form.color);
  const otpOn = form.requireOtp && data.sms.configured;

  /* --- section contents (only the open one is built) --- */
  function sectionBody(id) {
    if (id === 'status') {
      return (
        <BlockStack gap="400">
          <Text as="p" tone="subdued">Shoppers pay in cash when the order arrives. Prepaid orders always keep using your normal Shopify checkout.</Text>
          <Card>
            <FormLayout>
              <Checkbox label="Offer Cash on Delivery" helpText="Same as the Active / Inactive switch at the top." checked={form.enabled} onChange={set('enabled')} />
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">What shoppers go through</Text>
                <CodFlow otpOn={otpOn} />
                {!otpOn && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    {form.requireOtp ? 'Phone verification starts once an SMS provider is connected on the BRIX server.' : 'Phone verification is off (Fraud protection).'}
                  </Text>
                )}
              </BlockStack>
            </FormLayout>
          </Card>
          <Banner tone="info" action={{ content: 'Open theme editor', url: 'shopify://admin/themes/current/editor?context=apps', target: '_top' }}>
            COD works in your theme&apos;s own cart drawer or the BRIX Cart Drawer. Keep the &quot;Custom Cart Drawer&quot; app embed on in your theme.
          </Banner>
        </BlockStack>
      );
    }
    if (id === 'position') {
      return (
        <BlockStack gap="400">
          <Text as="p" tone="subdued">Where the COD button goes in your store&apos;s cart drawer, next to its Checkout button.</Text>
          <Card>
            <FormLayout>
              <Checkbox label="Show COD in the cart drawer" checked={form.drawer} onChange={set('drawer')} />
              {form.drawer && <PlacementPicker value={form.drawerPlacement} onChange={set('drawerPlacement')} buttons={preview.buttons} />}
              {form.drawer && form.drawerPlacement === 'replace' && (
                <Text as="p" variant="bodySm" tone="subdued">Checkout is only hidden while COD can be used. For a cart that can&apos;t use COD, your Checkout button stays.</Text>
              )}
            </FormLayout>
          </Card>
        </BlockStack>
      );
    }
    if (id === 'button') {
      return (
        <BlockStack gap="400">
          <Text as="p" tone="subdued">How the Cash on Delivery button looks. Also used for the product page button.</Text>
          <Card>
            <FormLayout>
              <TextField label="Button text" value={form.drawerText} onChange={set('drawerText')} error={errors.drawerText} maxLength={60} autoComplete="off" />
              <BlockStack gap="100">
                <Text as="p">Button style</Text>
                <ButtonGroup variant="segmented" fullWidth>
                  {BUTTON_STYLES.map(([s, label]) => (
                    <Button key={s} pressed={form.btnStyle === s} onClick={() => set('btnStyle')(s)}>{label}</Button>
                  ))}
                </ButtonGroup>
              </BlockStack>
            </FormLayout>
          </Card>
          <Card>
            <FormLayout>
              <Text as="h3" variant="headingMd">Colours</Text>
              <InlineStack gap="400" wrap={false}>
                <ColorField label="Button colour" value={form.bg} onChange={set('bg')} />
                {textOnWhite ? (
                  <div style={{ flex: 1 }}><TextField label="Text colour" value="Button colour" disabled autoComplete="off" /></div>
                ) : (
                  <ColorField label="Text colour" value={form.color} onChange={set('color')} />
                )}
              </InlineStack>
              {(errors.bg || errors.color) && <Text as="p" tone="critical" variant="bodySm">{errors.bg || errors.color}</Text>}
              <div className="cod-swatches" aria-label="Colour presets">
                {STYLE_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    title={p.name}
                    aria-label={`Use ${p.name}`}
                    className={`cod-swatch${fullHex(form.bg) === p.bg && fullHex(form.color) === p.color ? ' on' : ''}`}
                    style={{ background: `linear-gradient(135deg, ${p.bg} 60%, ${p.color} 60%)` }}
                    onClick={() => setForm((f) => ({ ...f, bg: p.bg, color: p.color }))}
                  />
                ))}
              </div>
              {HEX.test(form.bg) && HEX.test(form.color) && ratio < 4.5 && (
                <InlineStack gap="200" blockAlign="center">
                  <Badge tone="warning">{`Hard to read · ${ratio.toFixed(1)}:1`}</Badge>
                  {!textOnWhite && <Button variant="plain" onClick={() => set('color')(contrastRatio(form.bg, '#ffffff') >= contrastRatio(form.bg, '#111827') ? '#ffffff' : '#111827')}>Fix text colour</Button>}
                </InlineStack>
              )}
              <SliderField label="Border radius" value={Number(form.btnRadius) || 0} min={0} max={40} suffix="px" onChange={set('btnRadius')} />
            </FormLayout>
          </Card>
        </BlockStack>
      );
    }
    if (id === 'theme') {
      return (
        <BlockStack gap="400">
          <Text as="p" tone="subdued">BRIX finds the Checkout button in most themes&apos; cart drawers by itself. Use this only if COD doesn&apos;t show in yours.</Text>
          <Card>
            <TextField
              label="Checkout button selector (optional)"
              value={form.drawerSelector}
              onChange={set('drawerSelector')}
              placeholder="#CartDrawer-Checkout"
              error={errors.drawerSelector}
              helpText="A CSS selector for your drawer's Checkout button. Leave empty to detect it automatically."
              autoComplete="off"
              monospaced
            />
          </Card>
        </BlockStack>
      );
    }
    if (id === 'product') {
      return (
        <BlockStack gap="400">
          <Text as="p" tone="subdued">A COD button on product pages that buys just that product.</Text>
          <Card>
            <FormLayout>
              <Checkbox label="Show COD on product pages" checked={form.product} onChange={set('product')} />
              {form.product && (
                <>
                  <Checkbox
                    label="Replace the Buy it now button"
                    helpText={form.pbReplaceBuyNow ? "Shopify's Buy it now is hidden and COD takes its place." : 'Buy it now stays; COD goes between Add to Cart and Buy it now.'}
                    checked={form.pbReplaceBuyNow}
                    onChange={set('pbReplaceBuyNow')}
                  />
                  <TextField label="Button text" value={form.productText} onChange={set('productText')} error={errors.productText} maxLength={60} autoComplete="off" helpText="Style and colours come from COD button." />
                </>
              )}
            </FormLayout>
          </Card>
          {form.product && (
            <Card>
              <FormLayout>
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingMd">Size and spacing</Text>
                  {!PB_SIZES.every(({ key, field }) => form[field] === DEFAULT_COD_SETTINGS.productButton[key]) && (
                    <Button variant="plain" onClick={() => setForm((f) => ({ ...f, ...productButtonForm({ replaceBuyNow: f.pbReplaceBuyNow }) }))}>Reset</Button>
                  )}
                </InlineStack>
                {PB_SIZES.map(({ key, field, label }) => {
                  const [min, max] = COD_PRODUCT_BUTTON_LIMITS[key];
                  return <SliderField key={key} label={label} value={form[field]} min={min} max={max} suffix="px" onChange={set(field)} />;
                })}
              </FormLayout>
            </Card>
          )}
        </BlockStack>
      );
    }
    if (id === 'combo') {
      return (
        <BlockStack gap="400">
          <Text as="p" tone="subdued">A COD button next to Checkout on Build a Combo pages.</Text>
          <Card>
            <Checkbox label="Show COD on combo pages" helpText="Each combo template can still hide or style it in the combo builder." checked={form.combo} onChange={set('combo')} />
          </Card>
        </BlockStack>
      );
    }
    if (id === 'fee') {
      return (
        <BlockStack gap="400">
          <Text as="p" tone="subdued">An extra charge for paying in cash, added to COD orders only.</Text>
          <Card>
            <FormLayout>
              <Checkbox label="Charge a COD fee" checked={form.codFeeEnabled} onChange={set('codFeeEnabled')} />
              {form.codFeeEnabled && (
                <>
                  <FormLayout.Group>
                    <TextField label="Fee amount" type="number" min={0} value={form.codFee} onChange={set('codFee')} placeholder="40" prefix={data.currencyCode} error={errors.codFee} autoComplete="off" />
                    <TextField label="Fee title" value={form.codFeeLabel} onChange={set('codFeeLabel')} placeholder={COD_FEE_LABEL_DEFAULT} maxLength={40} error={errors.codFeeLabel} autoComplete="off" />
                  </FormLayout.Group>
                  <Checkbox
                    label="Show fee to customers"
                    helpText={form.showCodFee ? 'Its own line in the order summary, and under the COD button.' : 'Still charged, but shown inside one "Delivery charges" line, and not on the COD button.'}
                    checked={form.showCodFee}
                    onChange={set('showCodFee')}
                  />
                </>
              )}
            </FormLayout>
          </Card>
          {form.codFeeEnabled && <FeeSummary settings={preview} money={money} />}
        </BlockStack>
      );
    }
    if (id === 'shipping') {
      return (
        <BlockStack gap="400">
          <Text as="p" tone="subdued">Shipping charged on COD orders, shown to shoppers before they order.</Text>
          <Card>
            <FormLayout>
              <TextField label="Shipping" type="number" min={0} value={form.shippingFee} onChange={set('shippingFee')} placeholder="Free" prefix={data.currencyCode} error={errors.shippingFee} helpText="Leave empty for free shipping" autoComplete="off" />
              <TextField label="Free shipping from" type="number" min={0} value={form.freeShippingAbove} onChange={set('freeShippingAbove')} placeholder="Never" prefix={data.currencyCode} error={errors.freeShippingAbove} helpText="Order value after discounts" autoComplete="off" />
            </FormLayout>
          </Card>
        </BlockStack>
      );
    }
    if (id === 'eligibility') {
      return (
        <BlockStack gap="400">
          <Text as="p" tone="subdued">Which carts can use Cash on Delivery. Checked again on our server for every order.</Text>
          <Card>
            <FormLayout>
              <ExcludedTagsInput value={form.excludedProductTags} onChange={set('excludedProductTags')} />
              <ChoiceList
                title="When a cart contains an excluded product"
                choices={[
                  { label: 'Show COD as unavailable', value: 'unavailable', helpText: 'Greyed out, with "Not available for some items in your cart".' },
                  { label: 'Hide COD completely', value: 'hide', helpText: 'No COD button for that cart or product page.' },
                ]}
                selected={[form.excludedBehavior]}
                onChange={([v]) => set('excludedBehavior')(v)}
              />
            </FormLayout>
          </Card>
          <Card>
            <FormLayout>
              <Text as="h3" variant="headingMd">Order value</Text>
              <FormLayout.Group>
                <TextField label="Minimum order" type="number" min={0} value={form.minOrder} onChange={set('minOrder')} placeholder="No minimum" prefix={data.currencyCode} error={errors.minOrder} autoComplete="off" />
                <TextField label="Maximum order" type="number" min={0} value={form.maxOrder} onChange={set('maxOrder')} placeholder="No maximum" prefix={data.currencyCode} error={errors.maxOrder} autoComplete="off" />
              </FormLayout.Group>
            </FormLayout>
          </Card>
        </BlockStack>
      );
    }
    if (id === 'fraud') {
      return (
        <BlockStack gap="400">
          <Text as="p" tone="subdued">Stop fake and risky COD orders. Checked on our server for every order.</Text>
          <Card>
            <FormLayout>
              <Checkbox
                label="Verify phone with an SMS code (OTP)"
                helpText={data.sms.configured ? 'Each code is one SMS from your SMS provider.' : 'Starts once an SMS provider (MSG91) is connected on the BRIX server.'}
                checked={form.requireOtp}
                onChange={set('requireOtp')}
              />
              <SliderField label="COD orders per phone, per day" value={Number(form.dailyLimitPerPhone) || 1} min={1} max={50} onChange={(v) => set('dailyLimitPerPhone')(String(v))} helpText={errors.dailyLimitPerPhone} />
              <ChipInput
                label="Blocked PIN codes"
                value={form.blockedPincodes}
                onChange={set('blockedPincodes')}
                placeholder="Type or paste PIN codes, e.g. 744101"
                helpText="No COD for these areas. Paste a whole list at once."
                error={errors.blockedPincodes}
                isValid={(pin) => /^[1-9]\d{5}$/.test(pin)}
                splitOnSpace
              />
            </FormLayout>
          </Card>
        </BlockStack>
      );
    }
    if (id === 'popup') {
      const accent = form.sheetUseButton ? form.bg : form.sheetAccent;
      return (
        <BlockStack gap="400">
          <Text as="p" tone="subdued">How the Cash on Delivery checkout popup looks to shoppers.</Text>
          <Card>
            <FormLayout>
              <Text as="h3" variant="headingMd">Store logo</Text>
              <LogoUploader value={form.sheetLogo} onChange={set('sheetLogo')} error={errors.sheetLogo} />
              {form.sheetLogo && (
                <ButtonGroup variant="segmented">
                  {[['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']].map(([s, label]) => (
                    <Button key={s} size="slim" pressed={form.sheetLogoSize === s} onClick={() => set('sheetLogoSize')(s)}>{label}</Button>
                  ))}
                </ButtonGroup>
              )}
            </FormLayout>
          </Card>
          <Card>
            <FormLayout>
              <Text as="h3" variant="headingMd">Style</Text>
              <Checkbox label="Use my COD button colour" checked={form.sheetUseButton} onChange={set('sheetUseButton')} />
              {!form.sheetUseButton && <ColorField label="Popup colour" value={form.sheetAccent} onChange={set('sheetAccent')} />}
              {errors.sheetAccent && <Text as="p" tone="critical" variant="bodySm">{errors.sheetAccent}</Text>}
              <div className="cod-radius">
                {RADII.map((o) => (
                  <RadiusCard key={o.id} option={o} accent={HEX.test(accent) ? accent : '#111827'} active={form.sheetRadius === o.id} onPick={() => set('sheetRadius')(o.id)} />
                ))}
              </div>
              <Checkbox label="Show an order summary" checked={form.sheetSummary} onChange={set('sheetSummary')} />
              <Checkbox label="Show trust badges" checked={form.sheetTrust} onChange={set('sheetTrust')} />
              <TextField label="Thank-you message" value={form.sheetThanks} onChange={set('sheetThanks')} maxLength={120} placeholder="Thank you for shopping with us!" helpText="Shown when the order is placed." autoComplete="off" />
            </FormLayout>
          </Card>
        </BlockStack>
      );
    }
    if (id === 'coupons') {
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
      return (
        <BlockStack gap="400">
          <Text as="p" tone="subdued">Discount codes on COD orders. Shopify checks every code before the order is placed.</Text>
          <Card>
            <FormLayout>
              <Checkbox label="Allow discount codes on COD orders" checked={form.allowCoupons} onChange={set('allowCoupons')} />
              {form.allowCoupons && <Checkbox label="Show a coupon field in the popup" checked={form.sheetCoupon} onChange={set('sheetCoupon')} />}
              {form.allowCoupons && form.sheetCoupon && (
                <>
                  <TextField label="Field text" value={form.sheetCouponLabel} onChange={set('sheetCouponLabel')} maxLength={40} placeholder="Have a coupon code?" autoComplete="off" />
                  <Checkbox label="Show the code box open" checked={form.sheetCouponOpen} onChange={set('sheetCouponOpen')} />
                </>
              )}
            </FormLayout>
          </Card>
          {form.allowCoupons && form.sheetCoupon && (
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between"><Text as="h3" variant="headingMd">Suggested offers</Text><Text as="span" tone="subdued">{offers.length} of 5</Text></InlineStack>
                {offers.map((o, i) => (
                  <div key={o.code} className="cod-offer">
                    <span className="cod-offer-code">{o.code}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <TextField label={`Offer text for ${o.code}`} labelHidden value={o.text} onChange={(v) => set('sheetOffers')(offers.map((x, j) => (j === i ? { ...x, text: v } : x)))} maxLength={80} placeholder="What the shopper gets" autoComplete="off" />
                    </div>
                    <Button icon={DeleteIcon} variant="plain" tone="critical" accessibilityLabel={`Remove ${o.code}`} onClick={() => set('sheetOffers')(offers.filter((_, j) => j !== i))} />
                  </div>
                ))}
                {offers.length < 5 && (
                  <>
                    {choices.length > 0 && (
                      <Select
                        label="Add one of your Shopify codes"
                        options={[{ label: 'Choose a code…', value: '' }, ...choices.map((o) => ({ label: `${o.code} · ${o.title}`, value: o.code }))]}
                        value=""
                        onChange={(code) => code && addOffer(code)}
                      />
                    )}
                    <TextField
                      label="Or type a code"
                      value={offerDraft}
                      onChange={(v) => { setOfferDraft(v); setOfferProblem(''); }}
                      placeholder="e.g. WELCOME10"
                      error={offerProblem || undefined}
                      autoComplete="off"
                      connectedRight={<Button onClick={() => addOffer(offerDraft)} disabled={!offerDraft.trim()}>Add</Button>}
                    />
                  </>
                )}
              </BlockStack>
            </Card>
          )}
        </BlockStack>
      );
    }
    if (id === 'tracking') {
      const st = data.secretsStatus || {};
      const savedTracking = data.settings?.tracking || {};
      const canTest = (savedTracking.ga4Id && st.ga4ApiSecret?.set) || (savedTracking.metaPixelId && st.metaCapiToken?.set);
      return (
        <BlockStack gap="400">
          <Text as="p" tone="subdued">COD orders skip Shopify checkout, so your Google and Meta apps don&apos;t see them. BRIX sends each step and every purchase.</Text>
          <Card>
            <FormLayout>
              <Text as="h3" variant="headingMd">Google Analytics 4</Text>
              <TextField label="Measurement ID" value={form.ga4Id} onChange={set('ga4Id')} error={errors.ga4Id} placeholder="G-XXXXXXXXXX" autoComplete="off" />
              <SecretField label="Measurement Protocol API secret" value={form.ga4ApiSecret} status={st.ga4ApiSecret} onChange={set('ga4ApiSecret')} error={errors.ga4ApiSecret} helpText="Recommended: sends purchases from the server, so ad blockers can't hide them." />
            </FormLayout>
          </Card>
          <Card>
            <FormLayout>
              <Text as="h3" variant="headingMd">Meta Pixel</Text>
              <TextField label="Pixel ID" value={form.metaPixelId} onChange={set('metaPixelId')} error={errors.metaPixelId} placeholder="123456789012345" autoComplete="off" inputMode="numeric" />
              <SecretField label="Conversions API access token" value={form.metaCapiToken} status={st.metaCapiToken} onChange={set('metaCapiToken')} error={errors.metaCapiToken} helpText="Recommended: sends purchases from the server." />
              <SecretField label="Test event code" value={form.metaTestCode} status={st.metaTestCode} onChange={set('metaTestCode')} error={errors.metaTestCode} placeholder="TEST12345" helpText="Only while testing. Remove it when you're done." />
            </FormLayout>
          </Card>
          <Card>
            <FormLayout>
              <Select
                label="Product IDs sent with events"
                options={[{ label: 'Shopify catalog IDs', value: 'shopify' }, { label: 'Variant ID', value: 'variant' }, { label: 'SKU', value: 'sku' }]}
                value={form.metaContentId}
                onChange={set('metaContentId')}
              />
              <Checkbox label="Also send events to Google Tag Manager" checked={form.dataLayer} onChange={set('dataLayer')} />
              <InlineStack gap="200" blockAlign="center">
                <Button icon={SendIcon} onClick={sendTest} loading={testing} disabled={!canTest || dirty}>Send test events</Button>
                <Text as="span" variant="bodySm" tone="subdued">{dirty ? 'Save first, then test.' : canTest ? '' : 'Save an ID and its key to test.'}</Text>
              </InlineStack>
              {testResult && [['Google Analytics', testResult.ga4], ['Meta', testResult.meta]].map(([name, r]) => (
                <Banner key={name} tone={r.status === 'sent' ? 'success' : r.status === 'off' ? 'info' : 'critical'} title={name}>{r.message}</Banner>
              ))}
            </FormLayout>
          </Card>
        </BlockStack>
      );
    }
    // orders
    return (
      <BlockStack gap="400">
        <Text as="p" tone="subdued">Every COD order is tagged COD and BRIX-COD in Shopify, with its payment marked as pending.</Text>
        <Card>
          <FormLayout>
            <ChipInput label="Extra order tags" value={form.orderTags} onChange={set('orderTags')} placeholder="e.g. cod-verify" helpText="Press Enter or type a comma to add." isValid={(t) => /^[\w\- .:/]{1,40}$/.test(t)} />
            <TextField label="Message encouraging online payment" value={form.prepaidNudgeText} onChange={set('prepaidNudgeText')} maxLength={140} placeholder="Pay online for faster dispatch." helpText="Shown on the COD review step with a Pay online button." autoComplete="off" />
          </FormLayout>
        </Card>
      </BlockStack>
    );
  }

  const isActive = form.enabled;
  const built = buildCodScreen({ settings: preview, money, surface, cart, excludedOn, loader });
  const isDesktop = device === 'desktop';
  const sliderMax = cartSliderMax(preview);

  return (
    <Frame>
      <style>{COD_ADMIN_CSS + COD_SETTINGS_CSS + COD_CUSTOMIZE_CSS}</style>
      {toast && <Toast content={toast.content} error={toast.error} onDismiss={() => setToast(null)} />}
      <div className="bcz">
        {/* ── Sidebar ── */}
        <div className="bcz-side">
          <div className="bcz-head">
            <div className="bcz-head-row">
              <button type="button" className="bcz-back" onClick={goBack} aria-label="Back to COD Checkout"><Icon source={ArrowLeftIcon} /></button>
              <span className="bcz-title">Customize COD</span>
              <button type="button" className={`bcz-pill${isActive ? ' is-on' : ''}`} onClick={() => set('enabled')(!isActive)} aria-pressed={isActive} title={isActive ? 'Click to turn COD off' : 'Click to turn COD on'}>
                <span />{isActive ? 'Active' : 'Inactive'}
              </button>
            </div>
            {data.planState !== 'enabled' && <p className="bcz-note">Shoppers see COD on the Starter or Pro plan.</p>}
          </div>
          <div className="bcz-list">
            {GROUPS.map((g) => (
              <div key={g.title}>
                <div className="bcz-group">{g.title}</div>
                {g.items.map((item) => {
                  const isOpen = open === item.id;
                  const n = item.fields.filter((f) => errors[f]).length;
                  return (
                    <div key={item.id} className="bcz-item">
                      <button type="button" className={`bcz-row${isOpen ? ' is-open' : ''}`} aria-expanded={isOpen} onClick={() => toggleSection(item.id)}>
                        <span className="bcz-row-ic"><Icon source={item.icon} /></span>
                        <span className="bcz-row-l">{item.label}</span>
                        {n ? <span className="bcz-badge is-err">{n === 1 ? '1 error' : `${n} errors`}</span>
                          : item.toggle ? <span className={`bcz-badge${form[item.toggle] ? ' is-on' : ''}`}>{form[item.toggle] ? 'On' : 'Off'}</span> : null}
                        <span className="bcz-row-chev"><Icon source={ChevronDownIcon} /></span>
                      </button>
                      {isOpen && <div className="bcz-body">{sectionBody(item.id)}</div>}
                    </div>
                  );
                })}
              </div>
            ))}
            <div style={{ height: 32 }} />
          </div>
        </div>

        {/* ── Live preview ── */}
        <div className="bcz-main">
          <div className="bcz-bar">
            <span className="bcz-bar-l">Live preview</span>
            <div className="bcz-seg" role="tablist" aria-label="Preview screen">
              {SURFACES.map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={surface === id} className={surface === id ? 'is-on' : ''} onClick={() => showSurface(id)}>{label}</button>
              ))}
            </div>
            <div className="bcz-seg" aria-label="Device">
              {[['desktop', DesktopIcon, 'Desktop'], ['mobile', MobileIcon, 'Mobile']].map(([id, icon, label]) => (
                <button key={id} type="button" aria-pressed={device === id} aria-label={label} title={label} className={device === id ? 'is-on' : ''} onClick={() => setDevice(id)}><Icon source={icon} /></button>
              ))}
            </div>
            <div className="bcz-actions">
              <Button size="slim" onClick={discard} disabled={!dirty || saving}>Discard</Button>
              <Button size="slim" variant="primary" onClick={save} loading={saving} disabled={!dirty}>Save</Button>
            </div>
          </div>
          <div className="bcz-stage">
            <div className={`bcz-frame ${isDesktop ? 'is-desktop' : 'is-mobile'}`}>
              {isDesktop ? <div className="bcz-chrome"><i /><i /><i /><span /></div> : <div className="bcz-notch" />}
              <div ref={screenRef} className={`bcz-screen is-${surface}`}>
                {surface === 'drawer' ? built.screen : (
                  <div
                    ref={fitRef}
                    className="bcz-fit"
                    style={{ top: fit.top, left: fitPad, right: fitPad, transform: `scale(${fit.scale})` }}
                  >
                    {built.screen}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="bcz-foot">
            {(() => {
              const note = built.caption || (built.rule ? built.rule.message : `Shopper pays ${money(built.total)} on delivery.`);
              return <span className="bcz-caption" title={note}>{note}</span>;
            })()}
            <div className="bcz-foot-c">
              {built.hasTags && surface !== 'sheet' && (
                <Checkbox label="Excluded product in cart" checked={excludedOn} onChange={setExcludedOn} />
              )}
              <div className="bcz-cart">
                <span>Cart value</span>
                <input type="range" min={0} max={sliderMax} step={50} value={Math.min(cart, sliderMax)} onChange={(e) => setCart(Number(e.target.value))} aria-label="Cart value" />
                <b>{money(cart)}</b>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
