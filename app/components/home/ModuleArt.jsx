/* eslint-disable react/prop-types */
// Home page feature cards: a small animated window per feature (6 s loop,
// pure SVG + CSS, no GIF files). Each shows what the feature does: a cursor
// taps, the window reacts, then it starts again. Shown until a GIF / video is
// pasted into MODULE_MEDIA (app._index.jsx). It plays while the pointer is on
// the card (.brx-art-host; always on touch screens); otherwise, and with
// "reduce motion", each shows its finished picture (.fo / .fx / .fa / .fsa / .f0).
import { useEffect, useRef } from 'react';
import { useT } from '../../i18n/admin';

// A label that never runs past `max` (viewBox units): longer translations are
// squeezed to fit instead of spilling out of the window.
function FitText({ max, children, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.getComputedTextLength !== 'function') return;
    el.removeAttribute('textLength');
    el.removeAttribute('lengthAdjust');
    try {
      if (el.getComputedTextLength() > max) {
        el.setAttribute('textLength', String(max));
        el.setAttribute('lengthAdjust', 'spacingAndGlyphs');
      }
    } catch { /* not rendered yet */ }
  }, [children, max]);
  return <text ref={ref} dominantBaseline="central" {...rest}>{children}</text>;
}

// The window every card shares: shadow, frame, dark title bar with three dots.
function Win({ id, accent, cursor, children }) {
  return (
    <svg className={`brx-art brx-art-${id}`} viewBox="0 0 200 120" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true" style={{ '--brx-a': accent }}>
      <defs><clipPath id={`brx-art-clip-${id}`}><rect x="24" y="18" width="152" height="96" /></clipPath></defs>
      <rect x="25" y="9" width="152" height="108" rx="8" fill="rgba(15,23,42,.07)" />
      <rect x="24" y="6" width="152" height="108" rx="8" fill="#fff" stroke="rgba(15,23,42,.1)" />
      <path d="M24 14a8 8 0 0 1 8-8h136a8 8 0 0 1 8 8v4H24z" fill="#111" />
      {[33, 39, 45].map((cx) => <circle key={cx} cx={cx} cy="12" r="1.8" fill="#fff" />)}
      <g clipPath={`url(#brx-art-clip-${id})`}>{children}</g>
      {cursor}
    </svg>
  );
}

// Mouse pointer (tip at 0,0), moved by the card's own keyframes.
const Cursor = ({ cls }) => (
  <path className={`a brx-art-cur ${cls}`} d="M0 0v11l2.9-2.7 2 4.3 1.8-.8-2-4.2 4-.2z" fill="#111" stroke="#fff" strokeWidth=".7" strokeLinejoin="round" />
);
// A tap ripple at (cx, cy), `at` seconds into the loop.
const Tap = ({ cx, cy, at, accent }) => (
  <circle className="brx-art-tap" cx={cx} cy={cy} r="7" fill={accent} style={{ animationDelay: `${at}s` }} />
);
const Plus = ({ cx, cy, color = '#fff' }) => <path d={`M${cx - 2.3} ${cy}h4.6M${cx} ${cy - 2.3}v4.6`} stroke={color} strokeWidth="1.3" strokeLinecap="round" />;
const Check = ({ x, y }) => <path d={`M${x - 2.2} ${y}l1.5 1.5 3-3.2`} stroke="#fff" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />;
const Lines = ({ x, y, w = 56 }) => (<><rect x={x} y={y} width={w} height="4" rx="2" fill="#d1d5db" /><rect x={x} y={y + 8} width={w * 0.56} height="4" rx="2" fill="#e5e7eb" /></>);
const bold = { fontWeight: 700, fill: '#111' };

// Cart Editor: an item is added, the progress bar reaches free shipping, Checkout is tapped.
function CartArt({ accent }) {
  const t = useT();
  return (
    <Win id="cart" accent={accent} cursor={<Cursor cls="brx-cart-cur" />}>
      <FitText max={128} className="a st brx-cart-ma fx" x="30" y="28" fontSize="7.5" {...bold}>{t('admin.home.cart_art_away')}</FitText>
      <FitText max={128} className="a st brx-cart-mb fo" x="30" y="28" fontSize="7.5" fontWeight="700" fill={accent}>{t('admin.home.cart_art_unlocked')}</FitText>
      <rect x="30" y="34" width="128" height="5" rx="2.5" fill="#e5e7eb" />
      <rect className="a brx-cart-fill f0" x="30" y="34" width="128" height="5" rx="2.5" fill={accent} />
      <circle className="a brx-cart-gift fa" cx="164" cy="36.5" r="5.5" fill="#d1d5db" />
      <path d="M161.6 36h4.8v3h-4.8zM161.2 34.4h5.6V36h-5.6zM164 34.4v4.6" stroke="#fff" strokeWidth=".8" fill="none" />
      <rect x="30" y="46" width="18" height="18" rx="3" fill={accent} opacity=".3" />
      <Lines x={52} y={49} />
      <text x="170" y="55" textAnchor="end" dominantBaseline="central" fontSize="7.5" {...bold}>₹799</text>
      <g className="a brx-cart-item f0 fo">
        <rect x="30" y="68" width="18" height="18" rx="3" fill="#111" opacity=".75" />
        <Lines x={52} y={71} w={48} />
        <text x="170" y="77" textAnchor="end" dominantBaseline="central" fontSize="7.5" {...bold}>₹599</text>
      </g>
      <g className="brx-art-pulse" style={{ animationDelay: '4.1s' }}>
        <rect x="30" y="91" width="140" height="17" rx="5" fill="#111" />
        <FitText max={130} x="100" y="99.5" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff">{t('admin.home.cart_art_checkout')}</FitText>
      </g>
      <Tap cx={108} cy={99} at={4} accent={accent} />
    </Win>
  );
}

// Build a Combo: three products are added to the box, the offer unlocks step by step.
function ComboArt({ accent }) {
  const t = useT();
  const tiles = [[30, accent, '.3'], [79, '#111', '.7'], [128, '#f59e0b', '.55']];
  return (
    <Win id="combo" accent={accent} cursor={<Cursor cls="brx-combo-cur" />}>
      <FitText max={140} x="30" y="27" fontSize="8" {...bold}>{t('admin.home.combo_art_title')}</FitText>
      {tiles.map(([x, color, op], i) => (
        <g key={x}>
          <rect className={`a brx-combo-t${i + 1} fsa`} x={x} y="33" width="42" height="40" rx="5" fill="#fff" stroke="#e5e7eb" />
          <rect x={x + 5} y="37" width="32" height="20" rx="3" fill={color} opacity={op} />
          <rect x={x + 5} y="62" width="20" height="3.5" rx="1.75" fill="#e5e7eb" />
          <circle cx={x + 34} cy="64" r="5" fill="#111" />
          <Plus cx={x + 34} cy={64} />
          <g className={`a brx-combo-k${i + 1} fo`}>
            <circle cx={x + 34} cy="64" r="5.5" fill={accent} />
            <Check x={x + 34} y={64} />
          </g>
          <Tap cx={x + 34} cy={64} at={[0.6, 1.68, 2.76][i]} accent={accent} />
        </g>
      ))}
      <FitText max={140} className="a st brx-combo-ma fx" x="30" y="84" fontSize="7.5" {...bold}>{t('admin.home.combo_art_offer')}</FitText>
      <FitText max={140} className="a st brx-combo-mb fo" x="30" y="84" fontSize="7.5" fontWeight="700" fill={accent}>{t('admin.home.combo_art_unlocked')}</FitText>
      <rect x="30" y="93" width="136" height="5" rx="2.5" fill="#e5e7eb" />
      <rect className="a brx-combo-fill f0" x="30" y="93" width="136" height="5" rx="2.5" fill={accent} />
      {[75.3, 120.7, 166].map((cx, i) => <circle key={cx} className={`a brx-combo-d${i + 1} fa`} cx={cx} cy="95.5" r="3.4" fill="#d1d5db" />)}
    </Win>
  );
}

// COD: the fee is typed, COD Rules and OTP Verification are switched on.
function CodArt({ accent }) {
  const t = useT();
  const [r1, r2, r3] = [36, 66, 96];
  const label = { x: 54, fontSize: 8.5, fontWeight: 600, fill: '#111' };
  const icon = { fill: 'none', stroke: '#111', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' };
  return (
    <Win id="cod" accent={accent} cursor={<Cursor cls="brx-cod-cur" />}>
      <rect className="a brx-cod-hl" x="30" y="22" width="140" height="28" rx="6" fill="#f3f4f6" />
      <path d="M30 51h140M30 81h140" stroke="#f1f1f1" />
      <g {...icon}><rect x="37" y={r1 - 4} width="10" height="8" rx="1.6" /><path d={`M38.5 ${r1 - 4}l5.5-2.4 1.4 2.4`} /><circle cx="44.6" cy={r1} r=".6" fill="#111" /></g>
      <FitText max={68} {...label} y={r1}>{t('admin.home.cod_art_fee')}</FitText>
      <rect className="a brx-cod-field" x="126" y={r1 - 7} width="40" height="14" rx="3.5" strokeWidth="1" />
      <g fontSize="8.5" fontWeight="600" fill="#111" dominantBaseline="central">
        <text className="a st brx-cod-c1 fo" x="131" y={r1}>₹</text>
        <text className="a st brx-cod-c2 fo" x="136.2" y={r1}>4</text>
        <text className="a st brx-cod-c3 fo" x="141" y={r1}>9</text>
      </g>
      <Tap cx={146} cy={r1} at={0.54} accent={accent} />
      <g {...icon}><path d={`M37 ${r2 - 3}h10M37 ${r2}h10M37 ${r2 + 3}h10`} /><circle cx="40" cy={r2 - 3} r="1.3" fill="#fff" /><circle cx="44.5" cy={r2} r="1.3" fill="#fff" /><circle cx="41" cy={r2 + 3} r="1.3" fill="#fff" /></g>
      <FitText max={90} {...label} y={r2}>{t('admin.home.cod_art_rules')}</FitText>
      <rect className="a brx-cod-tg1 fa" x="148" y={r2 - 5} width="18" height="10" rx="5" />
      <circle className="a brx-cod-kb1" cx="153" cy={r2} r="3.9" fill="#fff" />
      <Tap cx={157} cy={r2} at={2.34} accent={accent} />
      <g {...icon}><path d={`M42 ${r3 - 5.2}l4.4 1.6v3c0 2.9-2 4.6-4.4 5.6-2.4-1-4.4-2.7-4.4-5.6v-3z`} /><path d={`M40.2 ${r3 + 0.2}l1.3 1.3 2.4-2.6`} /></g>
      <FitText max={90} {...label} y={r3}>{t('admin.home.cod_art_otp')}</FitText>
      <rect className="a brx-cod-tg2 fa" x="148" y={r3 - 5} width="18" height="10" rx="5" />
      <circle className="a brx-cod-kb2" cx="153" cy={r3} r="3.9" fill="#fff" />
      <Tap cx={157} cy={r3} at={3.54} accent={accent} />
    </Win>
  );
}

// Packs: Buy 1 → Buy 2 → Buy 3 is picked, then Add to cart.
function PacksArt({ accent }) {
  const t = useT();
  const rows = [[22, 1, null, '₹999'], [46, 2, 10, '₹1,798'], [70, 3, 15, '₹2,547']];
  return (
    <Win id="packs" accent={accent} cursor={<Cursor cls="brx-packs-cur" />}>
      {rows.map(([y]) => (
        <g key={y}>
          <rect x="30" y={y} width="140" height="20" rx="5" fill="#fff" stroke="#e5e7eb" />
          <circle cx="39" cy={y + 10} r="3.6" fill="#fff" stroke="#9ca3af" />
        </g>
      ))}
      <g className="a brx-packs-sel">
        <rect x="30" y="22" width="140" height="20" rx="5" fill={accent} fillOpacity=".07" stroke={accent} strokeWidth="1.3" />
        <circle cx="39" cy="32" r="3.6" fill="#fff" stroke={accent} />
        <circle cx="39" cy="32" r="1.9" fill={accent} />
      </g>
      {rows.map(([y, count, save, price]) => (
        <g key={`t${y}`}>
          <FitText max={32} x="47" y={y + 10} fontSize="8" {...bold}>{t('admin.home.packs_art_buy', { count })}</FitText>
          {save && (<>
            <rect x="82" y={y + 5} width="36" height="10" rx="5" fill={accent} opacity=".14" />
            <FitText max={32} x="100" y={y + 10} textAnchor="middle" fontSize="6.3" fontWeight="700" fill={accent}>{t('admin.home.packs_art_save', { percent: save })}</FitText>
          </>)}
          <text x="166" y={y + 10} textAnchor="end" dominantBaseline="central" fontSize="7.5" {...bold}>{price}</text>
        </g>
      ))}
      <Tap cx={120} cy={56} at={1.08} accent={accent} />
      <Tap cx={120} cy={80} at={2.4} accent={accent} />
      <g className="brx-art-pulse" style={{ animationDelay: '4.25s' }}>
        <rect x="30" y="94" width="140" height="14" rx="5" fill="#111" />
        <FitText max={130} x="100" y="101" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#fff">{t('admin.home.packs_art_add')}</FitText>
      </g>
      <Tap cx={100} cy={101} at={4.2} accent={accent} />
    </Win>
  );
}

// FBT: two more products are ticked, the total goes up, Add all to cart.
function FbtArt({ accent }) {
  const t = useT();
  const tiles = [[30, accent, '.3', '₹999'], [82, '#111', '.7', '₹599'], [134, '#f59e0b', '.55', '₹599']];
  return (
    <Win id="fbt" accent={accent} cursor={<Cursor cls="brx-fbt-cur" />}>
      <FitText max={140} x="30" y="27" fontSize="7.5" {...bold}>{t('admin.home.fbt_art_title')}</FitText>
      {tiles.map(([x, color, op, price], i) => (
        <g key={x} className={i ? `a brx-fbt-o${i + 1} fo` : undefined}>
          <rect x={x} y="33" width="36" height="38" rx="5" fill="#fff" stroke="#e5e7eb" />
          <rect x={x + 5} y="37" width="26" height="20" rx="3" fill={color} opacity={op} />
          <text x={x + 18} y="65" textAnchor="middle" dominantBaseline="central" fontSize="6.5" fontWeight="600" fill="#111">{price}</text>
          <rect x={x + 3} y="35" width="8" height="8" rx="2" fill="#fff" stroke="#9ca3af" />
          <g className={i ? `a brx-fbt-c${i + 1} fo` : undefined}>
            <rect x={x + 3} y="35" width="8" height="8" rx="2" fill={accent} />
            <Check x={x + 7.2} y={39.2} />
          </g>
        </g>
      ))}
      {[74, 126].map((cx) => (<g key={cx}><circle cx={cx} cy="52" r="4.5" fill="#fff" stroke="#e5e7eb" /><Plus cx={cx} cy={52} color="#111" /></g>))}
      <FitText max={90} x="30" y="81" fontSize="7.5" fontWeight="600" fill="#111">{t('admin.home.art_total')}</FitText>
      <text className="a st brx-fbt-p1 fx" x="170" y="81" textAnchor="end" dominantBaseline="central" fontSize="8" {...bold}>₹999</text>
      <text className="a st brx-fbt-p2 fx" x="170" y="81" textAnchor="end" dominantBaseline="central" fontSize="8" {...bold}>₹1,598</text>
      <text className="a st brx-fbt-p3 fo" x="170" y="81" textAnchor="end" dominantBaseline="central" fontSize="8" {...bold}>₹2,197</text>
      <Tap cx={89} cy={39} at={1.2} accent={accent} />
      <Tap cx={141} cy={39} at={2.28} accent={accent} />
      <g className="brx-art-pulse" style={{ animationDelay: '4.1s' }}>
        <rect x="30" y="90" width="140" height="18" rx="5" fill="#111" />
        <FitText max={130} x="100" y="99" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff">{t('admin.home.fbt_art_add')}</FitText>
      </g>
      <Tap cx={100} cy={99} at={4} accent={accent} />
    </Win>
  );
}

// Coupon: the code is applied, the total drops, "You saved" pops in.
function CouponArt({ accent }) {
  const t = useT();
  return (
    <Win id="coupon" accent={accent} cursor={<Cursor cls="brx-coupon-cur" />}>
      <FitText max={140} x="30" y="27" fontSize="7.5" {...bold}>{t('admin.home.coupon_art_title')}</FitText>
      <rect x="30" y="33" width="140" height="38" rx="6" fill={accent} fillOpacity=".07" stroke={accent} strokeOpacity=".45" strokeDasharray="3 2" />
      <path d="M116 37v30" stroke={accent} strokeOpacity=".35" strokeDasharray="2 2" />
      <FitText max={76} x="37" y="46" fontSize="11" fontWeight="800" fill={accent}>{t('admin.home.coupon_art_off')}</FitText>
      <FitText max={76} x="37" y="60" fontSize="6.5" fill="#6b7280">{t('admin.home.coupon_art_code')}</FitText>
      <rect className="a brx-coupon-btn fa" x="121" y="45" width="44" height="15" rx="4" fill="#111" />
      <FitText max={40} className="a st brx-coupon-ap fx" x="143" y="52.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="#fff">{t('admin.home.coupon_art_apply')}</FitText>
      <FitText max={40} className="a st brx-coupon-ad fo" x="143" y="52.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="#fff">{t('admin.home.coupon_art_applied')}</FitText>
      <Tap cx={143} cy={52} at={1.32} accent={accent} />
      <FitText max={80} x="30" y="82" fontSize="7.5" fontWeight="600" fill="#111">{t('admin.home.art_total')}</FitText>
      <text className="a st brx-coupon-pa fx" x="170" y="82" textAnchor="end" dominantBaseline="central" fontSize="8" {...bold}>₹1,000</text>
      <g className="a st brx-coupon-pb fo">
        <text x="141" y="82" textAnchor="end" dominantBaseline="central" fontSize="7" fill="#9ca3af">₹1,000</text>
        <path d="M118.5 82h23" stroke="#9ca3af" strokeWidth=".8" />
        <text x="170" y="82" textAnchor="end" dominantBaseline="central" fontSize="8" {...bold}>₹900</text>
      </g>
      <g className="a brx-coupon-sv fo f0">
        <rect x="30" y="92" width="140" height="15" rx="7.5" fill="#dcfce7" />
        <FitText max={130} x="100" y="99.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="#15803d">{t('admin.home.coupon_art_saved')}</FitText>
      </g>
    </Win>
  );
}

const ARTS = { cart: CartArt, combo: ComboArt, cod: CodArt, packs: PacksArt, fbt: FbtArt, coupon: CouponArt };

export default function ModuleArt({ id, accent }) {
  const Art = ARTS[id];
  return Art ? <Art accent={accent} /> : null;
}

// The finished picture, not moving (fee typed, switches on, offer unlocked,
// no cursor), for every .brx-art under `scope` inside `media`. Used while the
// pointer isn't on the card (screens with a mouse; hovering or focusing the
// card plays it from the start; phones keep it playing) and with
// "reduce motion".
function stillRules(media, scope) {
  const at = (sel) => sel.split(',').map((one) => `${scope} ${one}`.trim()).join(',');
  return `${media}
${at('.brx-art .a,.brx-art-tap,.brx-art-pulse')}{animation:none}
${at('.brx-art-cur,.brx-cod-hl')}{display:none}
${at('.brx-art .fo')}{opacity:1}
${at('.brx-art .fx')}{opacity:0}
${at('.brx-art .fa')}{fill:var(--brx-a)}
${at('.brx-art .fsa')}{stroke:var(--brx-a)}
${at('.brx-art .f0')}{transform:none}
${at('.brx-art .brx-cod-field')}{fill:#fff}
${at('.brx-art .brx-cod-kb1,.brx-art .brx-cod-kb2')}{transform:translateX(8px)}
${at('.brx-art .brx-packs-sel')}{transform:translateY(48px)}
}`;
}

// Keyframes: every card loops in 6 s. Taps and button presses share
// brx-art-tap / brx-art-pulse, started at their moment by animation-delay.
export const MODULE_ART_CSS = `
.brx-art text{font-family:inherit}
.brx-art .a{animation-duration:6s;animation-iteration-count:infinite;animation-timing-function:ease-in-out}
.brx-art .st{animation-timing-function:steps(1,end)}
.brx-art-tap{opacity:0;transform-box:fill-box;transform-origin:center;animation:brx-art-tap 6s ease-out infinite}
.brx-art-pulse{transform-box:fill-box;transform-origin:center;animation:brx-art-pulse 6s ease-in-out infinite}
@keyframes brx-art-tap{0%{opacity:.45;transform:scale(.3)}9%,100%{opacity:0;transform:scale(1.5)}}
@keyframes brx-art-pulse{0%{transform:scale(1)}4%{transform:scale(.94)}9%,100%{transform:scale(1)}}

.brx-cart-cur{animation-name:brx-cart-cur}
.brx-cart-ma{animation-name:brx-art-off40}
.brx-cart-mb{opacity:0;animation-name:brx-art-on40}
.brx-cart-fill{transform-box:fill-box;transform-origin:left center;transform:scaleX(.45);animation-name:brx-cart-fill}
.brx-cart-gift{animation-name:brx-cart-gift}
.brx-cart-item{opacity:0;animation-name:brx-cart-item}
@keyframes brx-cart-cur{0%,52%{transform:translate(196px,124px)}64%,80%{transform:translate(110px,100px)}92%,100%{transform:translate(196px,124px)}}
@keyframes brx-cart-fill{0%,22%{transform:scaleX(.45)}40%,92%{transform:scaleX(1)}98%,100%{transform:scaleX(.45)}}
@keyframes brx-cart-gift{0%,38%{fill:#d1d5db}42%,92%{fill:var(--brx-a)}97%,100%{fill:#d1d5db}}
@keyframes brx-cart-item{0%,10%{opacity:0;transform:translateX(150px)}20%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0;transform:translateX(0)}}
@keyframes brx-art-off40{0%{opacity:1}40%{opacity:0}95%{opacity:1}}
@keyframes brx-art-on40{0%{opacity:0}40%{opacity:1}95%{opacity:0}}

.brx-combo-cur{animation-name:brx-combo-cur}
.brx-combo-t1{animation-name:brx-combo-t1}.brx-combo-t2{animation-name:brx-combo-t2}.brx-combo-t3{animation-name:brx-combo-t3}
.brx-combo-k1{opacity:0;animation-name:brx-combo-k1}.brx-combo-k2{opacity:0;animation-name:brx-combo-k2}.brx-combo-k3{opacity:0;animation-name:brx-combo-k3}
.brx-combo-d1{animation-name:brx-combo-d1}.brx-combo-d2{animation-name:brx-combo-d2}.brx-combo-d3{animation-name:brx-combo-d3}
.brx-combo-fill{transform-box:fill-box;transform-origin:left center;transform:scaleX(0);animation-name:brx-combo-fill}
.brx-combo-ma{animation-name:brx-art-off48}
.brx-combo-mb{opacity:0;animation-name:brx-art-on48}
@keyframes brx-combo-cur{0%{transform:translate(196px,124px)}8%,14%{transform:translate(64px,65px)}24%,32%{transform:translate(113px,65px)}42%,52%{transform:translate(162px,65px)}64%,100%{transform:translate(196px,124px)}}
@keyframes brx-combo-t1{0%,10%{stroke:#e5e7eb}12%,92%{stroke:var(--brx-a)}97%,100%{stroke:#e5e7eb}}
@keyframes brx-combo-t2{0%,28%{stroke:#e5e7eb}30%,92%{stroke:var(--brx-a)}97%,100%{stroke:#e5e7eb}}
@keyframes brx-combo-t3{0%,46%{stroke:#e5e7eb}48%,92%{stroke:var(--brx-a)}97%,100%{stroke:#e5e7eb}}
@keyframes brx-combo-k1{0%,10%{opacity:0}12%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes brx-combo-k2{0%,28%{opacity:0}30%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes brx-combo-k3{0%,46%{opacity:0}48%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes brx-combo-d1{0%,10%{fill:#d1d5db}13%,92%{fill:var(--brx-a)}97%,100%{fill:#d1d5db}}
@keyframes brx-combo-d2{0%,28%{fill:#d1d5db}31%,92%{fill:var(--brx-a)}97%,100%{fill:#d1d5db}}
@keyframes brx-combo-d3{0%,46%{fill:#d1d5db}49%,92%{fill:var(--brx-a)}97%,100%{fill:#d1d5db}}
@keyframes brx-combo-fill{0%,10%{transform:scaleX(0)}13%,28%{transform:scaleX(.333)}31%,46%{transform:scaleX(.667)}49%,92%{transform:scaleX(1)}97%,100%{transform:scaleX(0)}}
@keyframes brx-art-off48{0%{opacity:1}48%{opacity:0}95%{opacity:1}}
@keyframes brx-art-on48{0%{opacity:0}48%{opacity:1}95%{opacity:0}}

.brx-cod-cur{animation-name:brx-cod-cur}
.brx-cod-hl{animation-name:brx-cod-hl}
.brx-cod-field{fill:#f3f4f6;stroke:#e5e7eb;animation-name:brx-cod-field}
.brx-cod-c1{opacity:0;animation-name:brx-cod-c1}
.brx-cod-c2{opacity:0;animation-name:brx-cod-c2}
.brx-cod-c3{opacity:0;animation-name:brx-cod-c3}
.brx-cod-tg1{fill:#d1d5db;animation-name:brx-cod-tg1}
.brx-cod-tg2{fill:#d1d5db;animation-name:brx-cod-tg2}
.brx-cod-kb1{animation-name:brx-cod-kb1}
.brx-cod-kb2{animation-name:brx-cod-kb2}
@keyframes brx-cod-hl{0%,32%{transform:translateY(0)}38%,52%{transform:translateY(30px)}58%,90%{transform:translateY(60px)}96%,100%{transform:translateY(0)}}
@keyframes brx-cod-cur{0%{transform:translate(196px,124px)}8%,30%{transform:translate(146px,38px)}38%,52%{transform:translate(160px,68px)}58%,80%{transform:translate(160px,98px)}90%,100%{transform:translate(196px,124px)}}
@keyframes brx-cod-field{0%,9%{fill:#f3f4f6;stroke:#e5e7eb}11%,30%{fill:#fff;stroke:var(--brx-a)}34%,92%{fill:#fff;stroke:#e5e7eb}96%,100%{fill:#f3f4f6;stroke:#e5e7eb}}
@keyframes brx-cod-c1{0%{opacity:0}12%{opacity:1}94%{opacity:0}}
@keyframes brx-cod-c2{0%{opacity:0}17%{opacity:1}94%{opacity:0}}
@keyframes brx-cod-c3{0%{opacity:0}22%{opacity:1}94%{opacity:0}}
@keyframes brx-cod-tg1{0%,40%{fill:#d1d5db}43%,92%{fill:var(--brx-a)}96%,100%{fill:#d1d5db}}
@keyframes brx-cod-tg2{0%,60%{fill:#d1d5db}63%,92%{fill:var(--brx-a)}96%,100%{fill:#d1d5db}}
@keyframes brx-cod-kb1{0%,40%{transform:translateX(0)}43%,92%{transform:translateX(8px)}96%,100%{transform:translateX(0)}}
@keyframes brx-cod-kb2{0%,60%{transform:translateX(0)}63%,92%{transform:translateX(8px)}96%,100%{transform:translateX(0)}}

.brx-packs-cur{animation-name:brx-packs-cur}
.brx-packs-sel{animation-name:brx-packs-sel}
@keyframes brx-packs-cur{0%{transform:translate(196px,124px)}14%,22%{transform:translate(122px,57px)}34%,44%{transform:translate(122px,81px)}62%,80%{transform:translate(102px,102px)}92%,100%{transform:translate(196px,124px)}}
@keyframes brx-packs-sel{0%,16%{transform:translateY(0)}22%,38%{transform:translateY(24px)}44%,92%{transform:translateY(48px)}97%,100%{transform:translateY(0)}}

.brx-fbt-cur{animation-name:brx-fbt-cur}
.brx-fbt-o2{opacity:.5;animation-name:brx-fbt-o2}.brx-fbt-o3{opacity:.5;animation-name:brx-fbt-o3}
.brx-fbt-c2{opacity:0;animation-name:brx-fbt-c2}.brx-fbt-c3{opacity:0;animation-name:brx-fbt-c3}
.brx-fbt-p1{animation-name:brx-fbt-p1}
.brx-fbt-p2{opacity:0;animation-name:brx-fbt-p2}
.brx-fbt-p3{opacity:0;animation-name:brx-fbt-p3}
@keyframes brx-fbt-cur{0%{transform:translate(196px,124px)}15%,24%{transform:translate(90px,40px)}33%,42%{transform:translate(142px,40px)}60%,78%{transform:translate(102px,100px)}90%,100%{transform:translate(196px,124px)}}
@keyframes brx-fbt-o2{0%,19%{opacity:.5}21%,92%{opacity:1}97%,100%{opacity:.5}}
@keyframes brx-fbt-o3{0%,37%{opacity:.5}39%,92%{opacity:1}97%,100%{opacity:.5}}
@keyframes brx-fbt-c2{0%,19%{opacity:0}21%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes brx-fbt-c3{0%,37%{opacity:0}39%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes brx-fbt-p1{0%{opacity:1}20%{opacity:0}95%{opacity:1}}
@keyframes brx-fbt-p2{0%{opacity:0}20%{opacity:1}38%{opacity:0}}
@keyframes brx-fbt-p3{0%{opacity:0}38%{opacity:1}95%{opacity:0}}

.brx-coupon-cur{animation-name:brx-coupon-cur}
.brx-coupon-btn{animation-name:brx-coupon-btn}
.brx-coupon-ap{animation-name:brx-art-off22}
.brx-coupon-ad{opacity:0;animation-name:brx-art-on22}
.brx-coupon-pa{animation-name:brx-art-off24}
.brx-coupon-pb{opacity:0;animation-name:brx-art-on24}
.brx-coupon-sv{opacity:0;transform-box:fill-box;transform-origin:center;animation-name:brx-coupon-sv}
@keyframes brx-coupon-cur{0%{transform:translate(196px,124px)}16%,30%{transform:translate(145px,54px)}44%,100%{transform:translate(196px,124px)}}
@keyframes brx-coupon-btn{0%,21%{fill:#111}23%,92%{fill:var(--brx-a)}97%,100%{fill:#111}}
@keyframes brx-coupon-sv{0%,26%{opacity:0;transform:scale(.85)}32%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0;transform:scale(.85)}}
@keyframes brx-art-off22{0%{opacity:1}22%{opacity:0}95%{opacity:1}}
@keyframes brx-art-on22{0%{opacity:0}22%{opacity:1}95%{opacity:0}}
@keyframes brx-art-off24{0%{opacity:1}24%{opacity:0}95%{opacity:1}}
@keyframes brx-art-on24{0%{opacity:0}24%{opacity:1}95%{opacity:0}}

${stillRules('@media (hover:hover){', '.brx-art-host:not(:hover):not(:focus-within)')}
${stillRules('@media (prefers-reduced-motion:reduce){', '')}
`;
