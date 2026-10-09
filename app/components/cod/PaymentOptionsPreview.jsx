/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
// Live preview of the product page payment options (Pay Online / Cash on
// Delivery) for the COD customizer. Sample product data only — never the
// store's products. Drawn like brix_cod.js's Pay module (same class names and
// rules, PAY_PREVIEW_CSS mirrors its stylesheet) and priced with the same
// shared helpers (utils/product-payment.shared.js), so what the merchant sees
// here is what shoppers get.
import { codPriceValues, fillPriceTags, tagMoney } from '../../utils/price-tags.shared.js';
import { useState } from 'react';
import {
  productPaymentPricing, fillPaymentText, onlineButtonLabel, visiblePaymentMethods, initialPaymentMethod, PAY_SPACING_PX,
} from '../../utils/product-payment.shared';
import { checkCodRules, codButtonLook, DEFAULT_COD_SETTINGS } from '../../utils/cod.shared';
import { codButtonColors, codButtonType, codFeeLabel } from './codButtonLook';

export const SAMPLE_PRODUCT = Object.freeze({
  title: 'Classic Cotton Tee',
  variants: [{ id: 'm', label: 'M', price: 1100 }, { id: 'l', label: 'L', price: 1500 }],
});

const SCALE = 0.8; // the phone mock is drawn at 80%, like the COD button preview

function readableOn(hex) {
  const h = hex.length === 4 ? hex.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3') : hex;
  const c = [1, 3, 5].map((i) => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.4 ? '#111827' : '#ffffff';
}

function Svg({ name, size }) {
  const paths = {
    card: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>,
    cash: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></>,
    tag: <><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z" /><circle cx="7" cy="7" r="1.5" /></>,
    check: <path d="M20 6 9 17l-5-5" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

// Same rules as brix_cod.js's stylesheet for the payment options (scoped to .bxpv).
export const PAY_PREVIEW_CSS = `
.bxpv .bxpay{display:block;width:100%;margin:10px 0;text-align:left;line-height:1.4}
.bxpv .bxpay *{box-sizing:border-box}
.bxpv .bxpay-h{display:block;margin:0 0 6px;font-size:12px;font-weight:600;color:#111827}
.bxpv .bxpay-banner{display:flex;align-items:flex-start;gap:8px;margin:0 0 8px;padding:8px 10px;border-radius:var(--bxpay-r);background:var(--bxpay-sel-bg);color:var(--bxpay-sel-fg);border:1px solid var(--bxpay-online)}
.bxpv .bxpay-banner svg{flex:none;color:var(--bxpay-online);margin-top:1px}
.bxpv .bxpay-banner b{display:block;font-size:12px;font-weight:700}
.bxpv .bxpay-banner span{display:block;font-size:11px;opacity:.85}
.bxpv .bxpay-cards{display:grid;gap:var(--bxpay-gap);grid-template-columns:minmax(0,1fr)}
.bxpv .bxpay-cards.is-h{grid-template-columns:repeat(2,minmax(0,1fr))}
.bxpv.is-phone .bxpay-cards.is-h{grid-template-columns:minmax(0,1fr)}
.bxpv .bxpay-card{position:relative;display:flex;align-items:flex-start;gap:8px;min-width:0;padding:var(--bxpay-pad);border-radius:var(--bxpay-r);background:var(--bxpay-bg);color:var(--bxpay-fg);border:1px solid var(--bxpay-border);cursor:pointer;font:inherit;text-align:left;width:100%;transition:border-color .15s,background-color .15s,box-shadow .15s}
.bxpv .bxpay.cs-filled .bxpay-card{background:var(--bxpay-fill);border-color:transparent}
.bxpv .bxpay.cs-minimal .bxpay-card{background:transparent;color:#111827;border-color:transparent}
.bxpv .bxpay-card:focus-visible{outline:2px solid var(--c);outline-offset:2px}
.bxpv .bxpay-card[aria-checked="true"]{border-color:var(--c);box-shadow:inset 0 0 0 1px var(--c)}
.bxpv .bxpay.ss-background .bxpay-card[aria-checked="true"]{background:var(--bxpay-sel-bg);color:var(--bxpay-sel-fg);box-shadow:none}
.bxpv .bxpay-card[aria-disabled="true"]{cursor:not-allowed;opacity:.6}
.bxpv .bxpay-radio{flex:none;display:grid;place-items:center;width:14px;height:14px;margin-top:2px;border-radius:50%;border:2px solid var(--bxpay-border);background:#fff}
.bxpv .bxpay-card[aria-checked="true"] .bxpay-radio{border-color:var(--c)}
.bxpv .bxpay-card[aria-checked="true"] .bxpay-radio:after{content:"";width:6px;height:6px;border-radius:50%;background:var(--c)}
.bxpv .bxpay-tick{position:absolute;top:6px;right:6px;display:none;width:14px;height:14px;border-radius:50%;background:var(--c);color:#fff;place-items:center}
.bxpv .bxpay.no-radio .bxpay-card[aria-checked="true"] .bxpay-tick{display:grid}
.bxpv .bxpay-ic{flex:none;display:inline-flex;margin-top:1px;color:var(--c)}
.bxpv .bxpay-main{flex:1;min-width:0;overflow-wrap:anywhere}
.bxpv .bxpay.no-radio .bxpay-main{padding-right:16px}
.bxpv .bxpay-top{display:flex;flex-wrap:wrap;align-items:center;gap:3px 6px}
.bxpv .bxpay-l{font-size:12px;font-weight:700;line-height:1.3}
.bxpv .bxpay-badge{display:inline-block;padding:1px 6px;border-radius:999px;background:var(--bxpay-badge-bg);color:var(--bxpay-badge-fg);font-size:9.5px;font-weight:700;line-height:1.5;white-space:nowrap}
.bxpv .bxpay-d,.bxpv .bxpay-p,.bxpv .bxpay-o,.bxpv .bxpay-why{display:block;margin-top:2px}
.bxpv .bxpay-d{font-size:10.5px;opacity:.75}
.bxpv .bxpay-p{font-size:11px}
.bxpv .bxpay-p s{margin-left:5px;opacity:.6}
.bxpv .bxpay-save{color:var(--c);font-weight:600;white-space:nowrap}
.bxpv .bxpay-o{font-size:10.5px;font-weight:600;color:var(--bxpay-online)}
.bxpv .bxpay-why{font-size:10px;font-weight:600}
.bxpv-chips{display:flex;gap:6px;margin:6px 0}
.bxpv-chips button{min-width:34px;padding:4px 8px;border:1px solid #d1d5db;border-radius:999px;background:#fff;font-size:11px;cursor:pointer}
.bxpv-chips button[aria-pressed="true"]{border-color:#111827;background:#111827;color:#fff}
.bxpv-qty{display:inline-flex;align-items:center;border:1px solid #d1d5db;border-radius:6px;margin:4px 0 2px}
.bxpv-qty button{width:26px;height:26px;border:0;background:transparent;cursor:pointer;font-size:13px}
.bxpv-qty span{min-width:22px;text-align:center;font-size:12px}
.bxpv-lab{display:block;font-size:10px;color:#6b7280;margin-top:6px}
.bxpv-bin{margin-top:8px;padding:10px;border-radius:6px;background:#5a31f4;color:#fff;text-align:center;font-size:12px;font-weight:700}
.bxpv-pbanner{margin:6px 0 2px}
`;

function cssVars(pp) {
  const a = pp.appearance;
  const gap = PAY_SPACING_PX[pp.layout.spacing] || 12;
  const s = (n) => `${Math.round(n * SCALE * 10) / 10}px`;
  return {
    '--bxpay-online': a.onlineColor,
    '--bxpay-bg': a.cardBackground,
    '--bxpay-fg': readableOn(a.cardBackground),
    '--bxpay-fill': `color-mix(in srgb, ${a.borderColor} 30%, ${a.cardBackground})`,
    '--bxpay-border': a.borderColor,
    '--bxpay-sel-bg': a.selectedBackground,
    '--bxpay-sel-fg': readableOn(a.selectedBackground),
    '--bxpay-badge-bg': a.badgeBackground,
    '--bxpay-badge-fg': a.badgeText,
    '--bxpay-r': s(pp.layout.radius),
    '--bxpay-gap': s(gap),
    '--bxpay-pad': `${s(gap + 2)} ${s(gap + 2)}`,
  };
}

/**
 * Product page mock with the payment options, interactive: pick a card, a
 * size and a quantity. `settings` = sanitized COD settings on screen.
 */
export function PaymentOptionsScreen({ settings, money, phone }) {
  const pp = settings.productPayment;
  const [variant, setVariant] = useState(SAMPLE_PRODUCT.variants[0].id);
  const [qty, setQty] = useState(1);
  const [picked, setPicked] = useState(null);

  const unit = SAMPLE_PRODUCT.variants.find((v) => v.id === variant).price;
  const codFee = settings.codFeeEnabled !== false && settings.codFee > 0 ? settings.codFee : 0;
  const codOn = settings.enabled && settings.surfaces.product !== false;
  const prepaid = pp.online.enabled && pp.prepaid.enabled ? pp.prepaid : null;
  const pr = productPaymentPricing({ unitPrice: unit, quantity: qty, prepaid, codFee });
  const shown = visiblePaymentMethods(pp, { codAvailable: codOn });
  const rule = codOn ? checkCodRules({ settings, subtotal: pr.subtotal, surface: 'product', format: money }) : null;
  const codReason = rule && (rule.code === 'below_min' || rule.code === 'above_max')
    ? (rule.code === 'below_min' ? `Available on orders from ${money(settings.minOrder)}` : `Available on orders up to ${money(settings.maxOrder)}`)
    : '';
  let method = picked && shown[picked] && !(picked === 'cod' && codReason && shown.online) ? picked : initialPaymentMethod(pp, shown);
  if (method === 'cod' && codReason && shown.online) method = 'online';

  const vars = { percent: pr.percent, amount: pr.savings > 0 ? money(pr.savings) : '', min: money(prepaid?.minSubtotal || 0), price: money(pr.online) };
  let line = null;
  if (prepaid && pp.layout.showBanner) {
    if (pr.qualifies) line = { title: fillPaymentText(prepaid.offerTitle, vars), sub: prepaid.offerDescription ? fillPaymentText(prepaid.offerDescription, vars) : '' };
    else if (pr.minMissing && prepaid.minNotMetText) line = { title: fillPaymentText(prepaid.minNotMetText, vars), sub: '' };
  }
  const banner = (l) => (
    <div className="bxpay-banner" data-pv-banner>
      <Svg name="tag" size={14} />
      <div><b>{l.title}</b>{l.sub ? <span>{l.sub}</span> : null}</div>
    </div>
  );
  const where = pp.layout.bannerPlacement;
  const layout = pp.layout;

  const card = (m) => {
    const online = m === 'online';
    const conf = online ? pp.online : pp.cod;
    const disabled = !online && Boolean(codReason);
    const on = method === m;
    const fee = codFee > 0 && settings.showCodFee !== false ? ` + ${money(codFee)} ${codFeeLabel(settings)}` : '';
    return (
      <div
        key={m}
        className="bxpay-card"
        role="radio"
        aria-checked={on}
        aria-disabled={disabled || undefined}
        tabIndex={on ? 0 : -1}
        style={{ '--c': online ? pp.appearance.onlineColor : pp.appearance.codColor }}
        onClick={() => !disabled && setPicked(m)}
        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!disabled) setPicked(m); } }}
      >
        {layout.showRadio && <span className="bxpay-radio" aria-hidden="true" />}
        {layout.showIcons && conf.showIcon && <span className="bxpay-ic"><Svg name={online ? 'card' : 'cash'} size={18} /></span>}
        <span className="bxpay-main">
          <span className="bxpay-top">
            <b className="bxpay-l">{conf.label}</b>
            {online && pr.qualifies && prepaid?.showBadge && <span className="bxpay-badge">{`Save ${Number(pr.percent)}%`}</span>}
          </span>
          {conf.description && <span className="bxpay-d">{conf.description}</span>}
          {online && line && where === 'in_online_card' && <span className="bxpay-o">{line.title}</span>}
          {online && (pr.qualifies && pr.savings > 0 ? (
            <span className="bxpay-p">Get it for <b>{money(pr.online)}</b><s>{money(pr.subtotal)}</s>{prepaid.showSavingsAmount && <> <span className="bxpay-save">{`(save ${money(pr.savings)})`}</span></>}</span>
          ) : <span className="bxpay-p">Pay <b>{money(pr.subtotal)}</b></span>)}
          {!online && (disabled ? <span className="bxpay-why">{codReason}</span> : <span className="bxpay-p">Pay <b>{money(pr.cod)}</b>{fee}</span>)}
        </span>
        <span className="bxpay-tick" aria-hidden="true"><Svg name="check" size={10} /></span>
      </div>
    );
  };

  const selector = shown.online || shown.cod ? (
    <div className={`bxpay cs-${layout.cardStyle} ss-${layout.selectedStyle === 'background' ? 'background' : 'border'}${layout.showRadio ? '' : ' no-radio'}`} style={cssVars(pp)} data-pv-selector>
      {line && where === 'above_selector' && banner(line)}
      {pp.heading && <span className="bxpay-h">{pp.heading}</span>}
      <div className={`bxpay-cards${layout.cardLayout === 'horizontal' ? ' is-h' : ''}`} role="radiogroup" aria-label={pp.heading || 'Payment method'}>
        {shown.online && card('online')}
        {shown.cod && card('cod')}
      </div>
    </div>
  ) : <div className="cod-pv-hidden">Payment options hidden: both Pay Online and Cash on Delivery are off{!codOn && pp.cod.enabled ? ' (COD is off or hidden on product pages)' : ''}</div>;

  const pbLook = { ...DEFAULT_COD_SETTINGS.productButton, ...(settings.productButton || {}) };
  const px = (n) => `${Math.round(n * SCALE * 10) / 10}px`;
  const ctaStyle = { margin: `${px(pbLook.marginTop)} 0 ${px(pbLook.marginBottom)}`, padding: `${px(pbLook.paddingY)} ${px(pbLook.paddingX)}`, borderRadius: px(pbLook.radius), fontSize: px(15) };
  let cta = null;
  if (method === 'cod') {
    const look = codButtonLook(settings, 'product');
    cta = (
      <div className="cod-pv-btn" data-pv-cta="cod" style={{ ...codButtonColors(look), opacity: codReason ? 0.5 : 1, ...ctaStyle, ...codButtonType(look, SCALE) }}>
        <span className="cod-pv-btn-l">{look.icon !== false && <Svg name="cash" size={14} />}{fillPriceTags(settings.buttons.productText, codPriceValues(pr.subtotal, codFee), tagMoney(money))}</span>
      </div>
    );
  } else if (method === 'online') {
    const label = pp.relabelBuyNow ? onlineButtonLabel(pp.online.buttonText, pr, prepaid, tagMoney(money)) : 'Buy it now';
    cta = <div className="bxpv-bin" data-pv-cta="online">{label}</div>;
  }

  const priceBlock = (
    <>
      <b className="cod-scr-price">{money(unit)}</b>
      {line && where === 'below_price' && <div className="bxpay bxpv-pbanner" style={cssVars(pp)}>{banner(line)}</div>}
    </>
  );
  const variants = (
    <>
      <span className="bxpv-lab">Size</span>
      <div className="bxpv-chips">
        {SAMPLE_PRODUCT.variants.map((v) => (
          <button key={v.id} type="button" aria-pressed={variant === v.id} onClick={() => setVariant(v.id)}>{v.label}</button>
        ))}
      </div>
    </>
  );
  const quantity = (
    <>
      <span className="bxpv-lab">Quantity</span>
      <div className="bxpv-qty">
        <button type="button" aria-label="Decrease quantity" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
        <span>{qty}</span>
        <button type="button" aria-label="Increase quantity" onClick={() => setQty((q) => Math.min(10, q + 1))}>+</button>
      </div>
    </>
  );
  const atc = <div className="cod-scr-atc">Add to cart</div>;
  const placement = layout.placement === 'app_block' ? 'before_purchase_buttons' : layout.placement;
  const at = (p) => (placement === p ? selector : null);

  return (
    <div className={`cod-scr bxpv${phone ? ' is-phone' : ''}`}>
      <div className="cod-scr-img"><span /></div>
      <div className="cod-scr-body">
        <b className="cod-scr-title">{SAMPLE_PRODUCT.title}</b>
        {priceBlock}
        {at('below_price')}
        {variants}
        {at('below_variants')}
        {quantity}
        {at('below_quantity')}
        <div className="cod-scr-buys">
          {at('before_purchase_buttons')}
          {atc}
          {at('below_add_to_cart')}
          {at('above_buy_now')}
          {cta}
        </div>
      </div>
    </div>
  );
}
