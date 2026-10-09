/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
import { useEffect, useState } from 'react';
import { BlockStack, Box, ButtonGroup, Button, Card, Checkbox, InlineStack, RangeSlider, Text, TextField } from '@shopify/polaris';
import { checkCodRules, codButtonLook, codCharges, codFeeOf, codPriceValues, DEFAULT_COD_SETTINGS, fillPriceTags, showsCodFee } from '../../utils/cod.shared';
import { tagMoney } from '../../utils/price-tags.shared.js';
import { codButtonColors, codButtonType, codDrawerLayout, codDrawerSize, codFeeHint, codFeeLabel } from './codButtonLook';
import { PaymentOptionsScreen } from './PaymentOptionsPreview';

const SURFACES = [
  { id: 'drawer', label: 'Cart drawer' },
  { id: 'product', label: 'Product page' },
  { id: 'sheet', label: 'COD checkout' },
];

// A COD button's text with its price tags filled in for `price`, as the storefront does.
function codText(settings, text, price, money) {
  return fillPriceTags(text, codPriceValues(price, codFeeOf(settings)), tagMoney(money));
}

const COMBO_PLACEMENT_NOTE = {
  replace: 'Checkout is hidden and COD takes its place. Shoppers can still pay online from the COD popup.',
  above: 'Cash on Delivery comes before the combo\'s Checkout button.',
  below: 'Cash on Delivery comes after the combo\'s Checkout button.',
};

const PLACEMENT_NOTE = {
  replace: 'Checkout is hidden while Cash on Delivery can be used. Shoppers can still pay online from the COD popup, and Checkout comes back for carts that can\'t use COD.',
  above: 'Cash on Delivery sits above your drawer\'s Checkout button.',
  below: 'Cash on Delivery sits below your drawer\'s Checkout button.',
};

function CashIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

// The product page mock is a ~360px phone shown at 80%, so storefront px
// sizes (brix_cod.js buttonHtml) are drawn at this scale. The cart drawer
// preview is drawn at real size.
const PHONE_SCALE = 0.8;

// The storefront COD button, drawn the way brix_cod.js draws it, in the look
// of its place (`look`, from codButtonLook; default the cart drawer's). With
// `size` it uses the storefront's exact sizes, at `scale`.
export function CodButton({ settings, look: placeLook, label, sub, disabled, size, scale = PHONE_SCALE }) {
  const look = placeLook || codButtonLook(settings, 'drawer');
  const px = (n) => `${Math.round(n * scale * 10) / 10}px`;
  const sized = size ? {
    margin: `${px(size.marginTop)} 0 ${px(size.marginBottom)}`,
    padding: `${px(size.paddingY)} ${px(size.paddingX)}`,
    borderRadius: px(size.radius),
  } : null;
  return (
    <div className="cod-pv-btn" style={{ ...codButtonColors(look), ...codButtonType(look, size ? scale : 1), opacity: disabled ? 0.5 : 1, ...sized }}>
      <span className="cod-pv-btn-l">{look.icon !== false && <CashIcon size={size ? 18 * scale : 16} />}{label}</span>
      {sub ? <span className="cod-pv-btn-s" style={{ textTransform: 'none', letterSpacing: 'normal', ...(size ? { fontSize: px(11.5) } : null) }}>{sub}</span> : null}
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
  return <img src="/brix-logo.png" alt="BRIX" style={{ height, width: 'auto', display: 'block' }} />;
}

// Example cart value: ₹1,299 (the order summary's example), unless that's outside the merchant's limits.
export function suggestedValue(s) {
  let v = 1299;
  if (s.minOrder > 0 && v < s.minOrder) v = Math.ceil(s.minOrder * 1.6 / 50) * 50;
  if (s.maxOrder > 0 && v > s.maxOrder) v = Math.floor(s.maxOrder / 50) * 50;
  return v;
}

// Two sample items that always add up to the cart value being tried.
function sampleItems(cart) {
  const second = cart >= 600 ? 300 : Math.round(cart * 0.4);
  return [
    { name: 'Classic Cotton Tee', variant: 'Black / M', tint: 'linear-gradient(135deg,#c7d2fe,#eef2ff)', price: cart - second },
    { name: 'Canvas Tote Bag', variant: 'Natural', tint: 'linear-gradient(135deg,#fde68a,#fffbeb)', price: second },
  ];
}

// A theme cart drawer (Dawn-like) sliding over the storefront, with the COD
// button where the merchant put it.
function DrawerScreen({ settings, money, cart, codState, hiddenWhy }) {
  const placement = settings.drawerPlacement || 'above';
  const { where, showCheckout, codFirst } = codDrawerLayout(placement, codState);
  const cod = codState ? (
    <CodButton
      key="cod"
      settings={settings}
      label={codText(settings, settings.buttons.drawerText, cart, money)}
      sub={codState.reason || (showsCodFee(settings.buttons.drawerText) ? '' : codState.sub)}
      disabled={Boolean(codState.reason)}
      size={codDrawerSize(settings, where)}
      scale={1}
    />
  ) : null;
  const checkoutText = settings.drawerCheckoutText ? codText(settings, settings.drawerCheckoutText, cart, money) : 'Check out';
  const checkout = showCheckout ? <div key="co" className="bcod-dr-checkout">{checkoutText}</div> : null;
  const items = sampleItems(cart);
  return (
    <div className="bcod-dr-stage" data-placement={placement}>
      <div className="bcod-dr-store" aria-hidden="true">
        <i className="bcod-dr-store-h" />
        <i className="bcod-dr-store-hero" />
        <span className="bcod-dr-store-grid"><i /><i /></span>
      </div>
      <div className="bcod-dr" role="img" aria-label={`Cart drawer preview, Cash on Delivery ${codState ? (placement === 'replace' && showCheckout ? 'above Checkout' : `${placement} Checkout`) : 'hidden'}`}>
        <div className="bcod-dr-h">
          <b>Your cart</b>
          <span className="bcod-dr-count">2</span>
          <span className="bcod-dr-x" aria-hidden="true">✕</span>
        </div>
        <div className="bcod-dr-items">
          {items.map((it) => (
            <div key={it.name} className="bcod-dr-item">
              <span className="bcod-dr-thumb" style={{ background: it.tint }} />
              <span className="bcod-dr-meta">
                <b>{it.name}</b>
                <span>{it.variant}</span>
                <span className="bcod-dr-qty" aria-hidden="true"><i>−</i>1<i>+</i></span>
              </span>
              <b className="bcod-dr-num">{money(it.price)}</b>
            </div>
          ))}
        </div>
        <div className="bcod-dr-foot">
          <div className="bcod-dr-sub"><span>Subtotal</span><b>{money(cart)}</b></div>
          <p className="bcod-dr-note">Taxes and shipping calculated at checkout</p>
          <div className="bcod-dr-btns">{codFirst ? [cod, checkout] : [checkout, cod]}</div>
          {!codState && hiddenWhy ? <span className="bcod-dr-hidden">COD hidden · {hiddenWhy}</span> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The preview screen for one surface (drawer | product | sheet), plus what the
 * simulator needs. Plain function so the COD customizer can frame it its own way.
 */
export function buildCodScreen({ settings, money, surface, cart, excludedOn = false, loader = false, device = 'desktop' }) {
  const hasTags = settings.excludedProductTags.length > 0;
  const excluded = hasTags && excludedOn;
  // The popup opens from every place, so its preview isn't tied to one
  // place's on/off switch (turning the cart drawer off must not make the
  // popup, or the charges and rules shown in it, look off).
  const ruleSurface = surface === 'sheet' ? undefined : surface;
  const anywhere = Object.values(settings.surfaces || {}).some((on) => on !== false);
  const rule = surface === 'sheet' && settings.enabled && !anywhere
    ? { code: 'cod_disabled', message: 'COD is turned off on the cart drawer, product pages and combo pages, so shoppers can’t open this.' }
    : excluded
    ? checkCodRules({ settings, subtotal: cart, surface: ruleSurface, format: money, productTags: [settings.excludedProductTags[0]] })
    : checkCodRules({ settings, subtotal: cart, surface: ruleSurface, format: money });
  const charges = codCharges(settings, cart);
  const total = cart + charges.total;
  const surfaceOff = settings.surfaces[ruleSurface] === false;
  const minMaxReason = rule && (rule.code === 'below_min' || rule.code === 'above_max')
    ? (rule.code === 'below_min' ? `Available on orders from ${money(settings.minOrder)}` : `Available on orders up to ${money(settings.maxOrder)}`)
    : '';
  const feeHint = codFeeHint(settings, money);
  const feeShown = settings.showCodFee !== false;
  const toFreeShipping = settings.shippingFee > 0 && settings.freeShippingAbove > 0 && cart < settings.freeShippingAbove
    ? settings.freeShippingAbove - cart : 0;

  const look = settings.sheet || {};
  const accent = look.accent || settings.buttons.bg;
  const accentFg = look.accent ? readableOn(look.accent) : settings.buttons.color;

  let screen;
  let caption = null;
  if (surface === 'drawer') {
    let codState = null;
    let hiddenWhy = '';
    if (!settings.enabled) hiddenWhy = 'COD is off';
    else if (surfaceOff) hiddenWhy = 'cart drawer is turned off';
    else if (excluded && settings.excludedBehavior === 'hide') hiddenWhy = 'cart has an excluded product';
    else if (excluded) codState = { reason: 'Not available for some items in your cart' };
    else if (minMaxReason) codState = { reason: minMaxReason };
    else codState = { sub: feeHint };
    screen = <DrawerScreen settings={settings} money={money} cart={cart} codState={codState} hiddenWhy={hiddenWhy} />;
    caption = codState ? PLACEMENT_NOTE[settings.drawerPlacement || 'above'] : null;
    if (codState?.reason && settings.drawerPlacement === 'replace') caption = 'COD can\'t be used for this cart, so Checkout stays and COD shows as unavailable above it.';
  } else if (surface === 'product' && settings.productPayment?.enabled) {
    // Payment options on: they replace the plain product page COD button.
    screen = <PaymentOptionsScreen settings={settings} money={money} phone={device === 'mobile'} />;
    caption = 'Sample product. Click a card, size or quantity to try it. Shoppers see the prepaid offer only once the discount is active in Shopify.';
  } else if (surface === 'product') {
    const pb = { ...DEFAULT_COD_SETTINGS.productButton, ...(settings.productButton || {}) };
    const hideForTag = excluded && settings.excludedBehavior === 'hide';
    const codHidden = !settings.enabled || surfaceOff || hideForTag;
    let why = settings.enabled ? 'product pages are turned off' : 'COD is off';
    if (settings.enabled && !surfaceOff && hideForTag) why = 'excluded product';
    screen = (
      <div className="cod-scr">
        <div className="cod-scr-img"><span /></div>
        <div className="cod-scr-body">
          <b className="cod-scr-title">Classic Cotton Tee</b>
          <b className="cod-scr-price">{money(cart)}</b>
          <div className="cod-scr-sizes" aria-hidden="true"><span>S</span><span className="on">M</span><span>L</span><span>XL</span></div>
          <div className="cod-scr-buys">
            <div className="cod-scr-atc">Add to cart</div>
            {codHidden ? <Hidden>COD button hidden: {why}</Hidden>
              : <CodButton settings={settings} look={codButtonLook(settings, 'product')} label={codText(settings, settings.buttons.productText, cart, money)} sub={excluded ? 'Not available for this product' : showsCodFee(settings.buttons.productText) ? '' : feeHint} disabled={excluded} size={pb} />}
            {/* Buy it now is only hidden while a usable COD button shows, as on the storefront. */}
            {(codHidden || excluded || !pb.replaceBuyNow) && (
              <div className="cod-scr-bin">
                {pb.buyNowText ? fillPriceTags(pb.buyNowText, { ...codPriceValues(cart, codFeeOf(settings)), prepaid_price: cart }, tagMoney(money)) : 'Buy it now'}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  } else if (surface === 'combo') {
    // A combo page's bottom bar: Checkout plus the COD button in its own look
    // (combo-page.js draws it the same way, from BrixCod.comboButton()).
    const comboLook = codButtonLook(settings, 'combo');
    const codHidden = !settings.enabled || surfaceOff;
    // Where COD sits next to the combo's Checkout (COD → Customize → Combo page).
    const comboPlace = settings.comboPlacement || 'below';
    const comboCheckout = codHidden || comboPlace !== 'replace' ? <div key="co" className="cod-scr-combo-co">Checkout</div> : null;
    const comboCod = codHidden
      ? <Hidden key="cod">COD button hidden: {settings.enabled ? 'combo pages are turned off' : 'COD is off'}</Hidden>
      : <CodButton key="cod" settings={settings} look={comboLook} label={codText(settings, settings.buttons.comboText || 'Cash on Delivery', cart, money)} size={{ marginTop: 0, marginBottom: 0, paddingY: 12, paddingX: 18, radius: comboLook.radius }} />;
    screen = (
      <div className="cod-scr cod-scr-combo">
        <div className="cod-scr-combo-h"><b>Build your combo</b><span>Pick 3 and save</span></div>
        <div className="cod-scr-combo-grid" aria-hidden="true">
          {['#c7d2fe', '#fde68a', '#bbf7d0'].map((c) => <span key={c} style={{ background: `linear-gradient(135deg, ${c}, #fff)` }}><i /></span>)}
        </div>
        <div className="cod-scr-combo-bar">
          <div className="cod-scr-combo-total"><span>Final</span><b>{money(cart)}</b></div>
          <div className="cod-scr-combo-btns">
            {comboPlace === 'below' ? [comboCheckout, comboCod] : [comboCod, comboCheckout]}
          </div>
        </div>
      </div>
    );
    caption = codHidden ? null : COMBO_PLACEMENT_NOTE[comboPlace];
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
                    {!feeShown && charges.codFee > 0 ? (
                      <div><span>Delivery charges</span><span>{money(charges.total)}</span></div>
                    ) : (
                      <>
                        <div><span>Shipping</span><span>{charges.shipping > 0 ? money(charges.shipping) : <b className="cod-pv-free">Free</b>}</span></div>
                        {charges.codFee > 0 && <div><span>{codFeeLabel(settings)}</span><span>{money(charges.codFee)}</span></div>}
                      </>
                    )}
                    <div className="cod-pv-tot"><span>Pay on delivery</span><span>{money(total)}</span></div>
                  </div>
                  {settings.prepaidNudgeText ? <div className="cod-pv-nudge">{settings.prepaidNudgeText} <u>Pay online</u></div> : null}
                  <div className="cod-pv-agr"><span className="cod-pv-box" aria-hidden="true">✓</span>I agree to the {/^https:\/\//.test(look.termsUrl || '') ? <a href={look.termsUrl} target="_blank" rel="noopener noreferrer">Terms and conditions</a> : <u>Terms and conditions</u>}</div>
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

  return { screen, caption, rule, charges, total, toFreeShipping, hasTags };
}

export function cartSliderMax(settings) {
  return Math.max(5000, Math.ceil(Math.max(settings.maxOrder * 1.3, settings.minOrder * 2, settings.freeShippingAbove * 1.5) / 500) * 500);
}

// Live preview + "try a cart value" simulator. Uses the same rule and
// charge functions the server applies to real orders (utils/cod.shared.js).
export default function CodPreview({ settings, money, focus }) {
  const [surface, setSurface] = useState('drawer');
  const [loader, setLoader] = useState(false);
  const [excludedOn, setExcludedOn] = useState(false);
  // Opening the COD checkout replays the BRIX loader first, as shoppers see it.
  const playLoader = () => setLoader(true);
  useEffect(() => {
    if (!loader) return undefined;
    const t = setTimeout(() => setLoader(false), 1100);
    return () => clearTimeout(t);
  }, [loader]);
  const pick = (id) => { setSurface(id); if (id === 'sheet') playLoader(); };
  // focus: { surface, n } from the settings page; a new n switches the screen again.
  useEffect(() => { if (focus?.surface) pick(focus.surface); }, [focus?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const [cart, setCart] = useState(() => suggestedValue(settings));
  const [touched, setTouched] = useState(false);

  // Until the merchant moves the slider, keep the example inside their rules.
  useEffect(() => { if (!touched) setCart(suggestedValue(settings)); }, [settings.minOrder, touched]); // eslint-disable-line react-hooks/exhaustive-deps

  const { screen, caption, rule, charges, total, toFreeShipping, hasTags } = buildCodScreen({ settings, money, surface, cart, excludedOn, loader });
  const sliderMax = cartSliderMax(settings);

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">Live preview</Text>
          <span className="cod-live-dot">Updates as you type</span>
        </InlineStack>
        <ButtonGroup variant="segmented" fullWidth>
          {SURFACES.map((s) => (
            <Button key={s.id} pressed={surface === s.id} onClick={() => pick(s.id)} size="slim">{s.label}</Button>
          ))}
        </ButtonGroup>
        <div className={surface === 'drawer' ? 'bcod-pv-stage' : 'cod-stage'}>{screen}</div>
        {caption ? <Text as="p" variant="bodySm" tone="subdued">{caption}</Text> : null}
        {surface === 'sheet' && !loader && (
          <InlineStack align="center"><Button variant="plain" onClick={playLoader}>Replay BRIX loader</Button></InlineStack>
        )}
        {surface !== 'sheet' && hasTags && (
          <Checkbox
            label="Cart has an excluded product"
            helpText={`Preview a cart with a product tagged ${settings.excludedProductTags[0]}.`}
            checked={excludedOn}
            onChange={setExcludedOn}
          />
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
                  {charges.codFee > 0 ? ` + ${money(charges.codFee)} ${codFeeLabel(settings)}` : ''}
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
