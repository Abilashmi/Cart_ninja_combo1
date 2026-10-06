/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
import { useEffect, useState } from 'react';
import { BlockStack, Box, ButtonGroup, Button, Card, InlineStack, RangeSlider, Text, TextField } from '@shopify/polaris';
import { checkCodRules, codCharges } from '../../utils/cod.shared';

const SURFACES = [
  { id: 'drawer', label: 'Cart drawer' },
  { id: 'product', label: 'Product page' },
  { id: 'sheet', label: 'COD checkout' },
];

function CashIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

// The storefront COD button, drawn the way brix_cod.js draws it.
function CodButton({ settings, label, sub, disabled }) {
  return (
    <div className="cod-pv-btn" style={{ background: settings.buttons.bg, color: settings.buttons.color, opacity: disabled ? 0.5 : 1 }}>
      <span className="cod-pv-btn-l"><CashIcon />{label}</span>
      {sub ? <span className="cod-pv-btn-s">{sub}</span> : null}
    </div>
  );
}

function Hidden({ children }) {
  return <div className="cod-pv-hidden">{children}</div>;
}

// Black or white text, whichever reads better on the colour (same rule as brix_cod.js).
function readableOn(hex) {
  const h = hex.length === 4 ? hex.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3') : hex;
  const c = [1, 3, 5].map((i) => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.4 ? '#111827' : '#ffffff';
}

// Same deal label as the storefront ticket strip (brix_cod.js offerBadge).
function offerBadge(text) {
  const t = String(text || '');
  let m = /(\d{1,3}(?:\.\d+)?)\s?%/.exec(t);
  if (m) return `${m[1]}% OFF`;
  m = /(₹|rs\.?|inr|\$|€|£)\s?([\d,]+(?:\.\d+)?)/i.exec(t);
  if (m) return `${/^(rs|inr)/i.test(m[1]) ? '₹' : m[1]}${m[2].replace(/\.0+$/, '')} OFF`;
  if (/free\s*ship/i.test(t)) return 'FREE SHIP';
  return 'OFFER';
}

function BrixMark({ height }) {
  return <img src="/brix-logo.svg" alt="BRIX" style={{ height, width: 'auto', display: 'block' }} />;
}

function suggestedValue(s) {
  if (s.minOrder > 0) return Math.ceil(s.minOrder * 1.6 / 50) * 50;
  return 999;
}

// Live phone preview + "try a cart value" simulator. Uses the same rule and
// charge functions the server applies to real orders (utils/cod.shared.js).
export default function CodPreview({ settings, money, focus }) {
  const [surface, setSurface] = useState('drawer');
  const [loader, setLoader] = useState(false);
  // Opening the COD checkout replays the BRIX loader first, as shoppers see it.
  const playLoader = () => setLoader(true);
  useEffect(() => {
    if (!loader) return undefined;
    const t = setTimeout(() => setLoader(false), 1100);
    return () => clearTimeout(t);
  }, [loader]);
  const pick = (id) => { setSurface(id); if (id === 'sheet') playLoader(); };
  useEffect(() => { if (focus) pick(focus); }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const [cart, setCart] = useState(() => suggestedValue(settings));
  const [touched, setTouched] = useState(false);

  // Until the merchant moves the slider, keep the example inside their rules.
  useEffect(() => { if (!touched) setCart(suggestedValue(settings)); }, [settings.minOrder, touched]); // eslint-disable-line react-hooks/exhaustive-deps

  const sliderMax = Math.max(5000, Math.ceil(Math.max(settings.maxOrder * 1.3, settings.minOrder * 2, settings.freeShippingAbove * 1.5) / 500) * 500);
  const ruleSurface = surface === 'sheet' ? 'drawer' : surface;
  const rule = checkCodRules({ settings, subtotal: cart, surface: ruleSurface, format: money });
  const charges = codCharges(settings, cart);
  const total = cart + charges.total;
  const surfaceOff = settings.surfaces[ruleSurface] === false;
  const minMaxReason = rule && (rule.code === 'below_min' || rule.code === 'above_max')
    ? (rule.code === 'below_min' ? `Available on orders from ${money(settings.minOrder)}` : `Available on orders up to ${money(settings.maxOrder)}`)
    : '';
  const feeHint = settings.codFee > 0 ? `+${money(settings.codFee)} COD fee` : '';
  const toFreeShipping = settings.shippingFee > 0 && settings.freeShippingAbove > 0 && cart < settings.freeShippingAbove
    ? settings.freeShippingAbove - cart : 0;

  const look = settings.sheet || {};
  const accent = look.accent || settings.buttons.bg;
  const accentFg = look.accent ? readableOn(look.accent) : settings.buttons.color;

  // Sample items that always add up to the cart value being tried.
  const first = Math.round(cart * 0.6);
  const sampleItems = [
    { name: 'Classic Cotton Tee', variant: 'Black / M', tint: 'linear-gradient(135deg,#c7d2fe,#eef2ff)', price: first },
    { name: 'Canvas Tote Bag', variant: 'Natural', tint: 'linear-gradient(135deg,#fde68a,#fffbeb)', price: cart - first },
  ];

  let screen;
  if (surface === 'drawer') {
    screen = (
      <div className="cod-scr">
        <div className="cod-scr-h"><b>Your cart</b><span className="cod-scr-mu">2 items</span><span className="cod-scr-x" aria-hidden="true">✕</span></div>
        <div className="cod-scr-items">
          {sampleItems.map((it) => (
            <div key={it.name} className="cod-scr-item">
              <span className="cod-scr-thumb" style={{ background: it.tint }} />
              <span className="cod-scr-meta"><b>{it.name}</b><span>{it.variant} · Qty 1</span></span>
              <b className="cod-scr-num">{money(it.price)}</b>
            </div>
          ))}
        </div>
        <div className="cod-scr-foot">
          <div className="cod-scr-sub"><span>Subtotal</span><b>{money(cart)}</b></div>
          {!settings.enabled || surfaceOff ? <Hidden>COD button hidden: {settings.enabled ? 'cart drawer is turned off' : 'COD is off'}</Hidden>
            : <CodButton settings={settings} label={settings.buttons.drawerText} sub={minMaxReason || feeHint} disabled={Boolean(minMaxReason)} />}
          <div className="cod-scr-checkout">Checkout</div>
        </div>
      </div>
    );
  } else if (surface === 'product') {
    screen = (
      <div className="cod-scr">
        <div className="cod-scr-img"><span /></div>
        <div className="cod-scr-body">
          <b className="cod-scr-title">Classic Cotton Tee</b>
          <b className="cod-scr-price">{money(cart)}</b>
          <div className="cod-scr-sizes" aria-hidden="true"><span>S</span><span className="on">M</span><span>L</span><span>XL</span></div>
          <div className="cod-scr-atc">Add to cart</div>
          {!settings.enabled || surfaceOff ? <Hidden>COD button hidden: {settings.enabled ? 'product pages are turned off' : 'COD is off'}</Hidden>
            : <CodButton settings={settings} label={settings.buttons.productText} sub={feeHint} />}
        </div>
      </div>
    );
  } else {
    const head = (
      <div className="cod-pv-top">
        {look.logo ? <img className={`cod-pv-logo ${look.logoSize || 'md'}`} src={look.logo} alt="Store logo" /> : <b>Review your order</b>}
        <span className="cod-pv-tag"><CashIcon size={11} />COD</span>
      </div>
    );
    screen = (
      <div className={`cod-scr cod-scr-sheet rad-${look.radius || 'rounded'}`} style={{ '--acc': accent, '--acc-fg': accentFg }}>
        <div className="cod-scr-dim" />
        <div className="cod-pv-panel">
          <div className="cod-pv-grab" />
          {head}
          {loader ? (
            <div className="cod-pv-loader">
              <div className="cod-pv-loader-m"><BrixMark height={30} /></div>
              <div className="cod-pv-loader-bar"><i /></div>
              <span>Checking Cash on Delivery…</span>
            </div>
          ) : (
            <>
              {look.logo && <b className="cod-pv-title">Review your order</b>}
              {rule ? (
                <>
                  <div className="cod-pv-err">{rule.message}</div>
                  <div className="cod-pv-sec">Pay online</div>
                </>
              ) : (
                <>
                  {settings.allowCoupons && look.showCoupon !== false && (
                    look.couponOpen
                      ? <div className="cod-pv-cpn open"><span>Enter coupon code</span><b className="cod-pv-go">APPLY</b></div>
                      : <div className="cod-pv-cpn"><span>{look.couponLabel || 'Have a coupon code?'}</span><b>Add</b></div>
                  )}
                  {settings.allowCoupons && look.showCoupon !== false && (look.offers || []).slice(0, 2).map((o) => (
                    <div key={o.code} className="cod-pv-ofr">
                      <span className="cod-pv-ofr-l"><span>{offerBadge(o.text)}</span></span>
                      <span className="cod-pv-ofr-r"><span className="cod-pv-ofr-h"><b>{o.code}</b><b className="cod-pv-go">APPLY</b></span>{o.text ? <span className="cod-pv-ofr-t">{o.text}</span> : null}</span>
                    </div>
                  ))}
                  <div className="cod-pv-rows">
                    <div><span>Items</span><span>{money(cart)}</span></div>
                    <div><span>Shipping</span><span>{charges.shipping > 0 ? money(charges.shipping) : <b className="cod-pv-free">Free</b>}</span></div>
                    {charges.codFee > 0 && <div><span>COD fee</span><span>{money(charges.codFee)}</span></div>}
                    <div className="cod-pv-tot"><span>Pay on delivery</span><span>{money(total)}</span></div>
                  </div>
                  {settings.prepaidNudgeText ? <div className="cod-pv-nudge">{settings.prepaidNudgeText} <u>Pay online</u></div> : null}
                  <div className="cod-pv-place">Place COD order · {money(total)}</div>
                </>
              )}
            </>
          )}
          <div className="cod-pv-pw">Secured &amp; powered by <BrixMark height={11} /></div>
        </div>
      </div>
    );
  }

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">Live preview</Text>
          <span className="cod-live-dot">Updates as you type</span>
        </InlineStack>
        <ButtonGroup variant="segmented" fullWidth>
          {SURFACES.map((s) => (
            <Button key={s.id} pressed={surface === s.id} onClick={() => pick(s.id)} size="slim">{s.label}</Button>
          ))}
        </ButtonGroup>
        <div className="cod-stage">{screen}</div>
        {surface === 'sheet' && !loader && (
          <InlineStack align="center"><Button variant="plain" onClick={playLoader}>Replay BRIX loader</Button></InlineStack>
        )}

        <Box padding="300" background="bg-surface-secondary" borderRadius="300">
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm">Try a cart value</Text>
            <InlineStack gap="300" blockAlign="center" wrap={false}>
              <div style={{ flex: 1 }}>
                <RangeSlider label="Cart value" labelHidden min={0} max={sliderMax} step={50} value={Math.min(cart, sliderMax)} onChange={(v) => { setTouched(true); setCart(v); }} />
              </div>
              <div style={{ width: 110 }}>
                <TextField label="Cart value" labelHidden type="number" min={0} value={String(cart)} onChange={(v) => { setTouched(true); setCart(Math.max(0, Number(v) || 0)); }} autoComplete="off" />
              </div>
            </InlineStack>
            {rule ? (
              <div className="cod-sim bad"><b>Shopper can&apos;t use COD</b><span>{rule.message}</span></div>
            ) : (
              <div className="cod-sim ok">
                <b>Shopper pays {money(total)} on delivery</b>
                <span>
                  {money(cart)} items
                  {charges.shipping > 0 ? ` + ${money(charges.shipping)} shipping` : ' + free shipping'}
                  {charges.codFee > 0 ? ` + ${money(charges.codFee)} COD fee` : ''}
                </span>
                {toFreeShipping > 0 && <span>{money(toFreeShipping)} more for free shipping.</span>}
              </div>
            )}
            <Text as="p" variant="bodySm" tone="subdued">Before discounts and taxes. Real orders are priced by Shopify.</Text>
          </BlockStack>
        </Box>
      </BlockStack>
    </Card>
  );
}
