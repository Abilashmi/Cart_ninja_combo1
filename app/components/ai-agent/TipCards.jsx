import MarkdownMessage from './MarkdownMessage';

const ICON = {
  trend: <path d="M3 17l6-6 4 4 8-8M14 7h7v7" />,
  box: <path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8" />,
  truck: <><path d="M1 6h13v10H1zM14 9h4l3 3v4h-7z" /><circle cx="5.5" cy="18.5" r="1.8" /><circle cx="17.5" cy="18.5" r="1.8" /></>,
  tag: <><path d="M20 12l-8 8-9-9V3h8l9 9z" /><circle cx="7.5" cy="7.5" r="1" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  cart: <><path d="M3 4h2l2.5 11h10l2-8H6.5" /><circle cx="9" cy="19.5" r="1.5" /><circle cx="17" cy="19.5" r="1.5" /></>,
  gift: <path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H8a2.5 2.5 0 110-5c3 0 4 5 4 5zm0 0h4a2.5 2.5 0 100-5c-3 0-4 5-4 5z" />,
  spark: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
};

// [icon, accent, tint] — first keyword match wins, so order matters.
const RULES = [
  [/free ship|shipping|threshold|progress/i, 'truck', '#0e7490', '#e0f7fa'],
  [/bundl|combo|frequently bought|fbt|pack/i, 'box', '#7c3aed', '#f1eafe'],
  [/countdown|urgency|limited|timer|scarcity/i, 'clock', '#c2410c', '#ffedd5'],
  [/discount|coupon|promo|offer|code|deal|sale/i, 'tag', '#be185d', '#fde7f1'],
  [/gift|reward|loyalty/i, 'gift', '#b45309', '#fef3c7'],
  [/checkout|cart|abandon/i, 'cart', '#1d4ed8', '#e3edff'],
  [/upsell|cross-sell|cross sell|recommend|add-on|complement/i, 'trend', '#15803d', '#e2f8e9'],
];
const FALLBACK = ['spark', '#1a1a1a', '#eeeeef'];

// The title says what the tip is about, so it is matched first; the body is
// only a fallback for tips whose title is generic.
function pickStyle(tip) {
  for (const hay of [tip.title, tip.body]) {
    for (const [re, icon, color, tint] of RULES) if (re.test(hay)) return [icon, color, tint];
  }
  return FALLBACK;
}

const CSS = `
.brix-tips{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;width:100%}
.brix-tip{position:relative;display:flex;flex-direction:column;gap:10px;background:#fff;border:1px solid #e8e8ec;border-radius:14px;padding:14px;box-shadow:0 1px 2px rgba(16,24,40,.04);transition:transform .15s ease,box-shadow .15s ease;animation:brixTipIn .28s ease backwards}
.brix-tip:last-child:nth-child(odd){grid-column:1/-1}
.brix-tip:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(16,24,40,.08)}
.brix-tip[role=button]{cursor:pointer}
.brix-tip[role=button]:hover{border-color:#1a9de0}
.brix-tip[role=button]:focus-visible{outline:2px solid #1a9de0;outline-offset:2px}
.brix-tip[aria-disabled=true]{opacity:.55;cursor:default;pointer-events:none}
.brix-tip-cta{margin-top:auto;padding-top:2px;font-size:12px;font-weight:700;color:#1a9de0}
.brix-tip-top{display:flex;align-items:center;justify-content:space-between}
.brix-tip-badge{flex-shrink:0;width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center}
.brix-tip-main{min-width:0}
.brix-tip-title{margin:0 0 4px;font-weight:700;color:#111827;line-height:1.3}
.brix-tip-body{color:#4b5563;line-height:1.5}
.brix-tip-body .bai-md p,.brix-tip-body .bxb-md p{margin:0}
.brix-tip-num{font-size:11px;font-weight:700;letter-spacing:.04em;color:#c4c7cf}
.brix-tips-lg .brix-tip-title{font-size:14.5px}
.brix-tips-lg .brix-tip-body{font-size:13.5px}
.brix-tips-sm{gap:8px}
.brix-tips-sm .brix-tip{padding:11px 12px;gap:8px;border-radius:12px}
.brix-tips-sm .brix-tip-badge{width:32px;height:32px;border-radius:9px}
.brix-tips-sm .brix-tip-title{font-size:13px}
.brix-tips-sm .brix-tip-body{font-size:12.5px}
@media (max-width:640px){.brix-tips{grid-template-columns:minmax(0,1fr)}}
@keyframes brixTipIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@media (prefers-reduced-motion:reduce){.brix-tip{animation:none;transition:none}}
`;

// `onPick(tip)` makes each card clickable ("Set this up"): the merchant picks
// an idea and Brix carries it out, instead of having to retype it.
export default function TipCards({ tips, size = 'lg', onPick, disabled = false }) {
  return (
    <>
      <style>{CSS}</style>
      <div className={`brix-tips brix-tips-${size}`}>
        {tips.map((tip, i) => {
          const [icon, color, tint] = pickStyle(tip);
          return (
            <div
              className="brix-tip"
              key={i}
              style={{ animationDelay: `${i * 0.07}s` }}
              {...(onPick ? {
                role: 'button',
                tabIndex: disabled ? -1 : 0,
                'aria-disabled': disabled,
                'aria-label': `Set up ${tip.title}`,
                onClick: () => { if (!disabled) onPick(tip); },
                onKeyDown: (e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPick(tip); } },
              } : {})}
            >
              <div className="brix-tip-top">
                <span className="brix-tip-badge" style={{ background: tint, color }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {ICON[icon]}
                  </svg>
                </span>
                <span className="brix-tip-num">{String(i + 1).padStart(2, '0')}</span>
              </div>
              <div className="brix-tip-main">
                {tip.title && <p className="brix-tip-title">{tip.title}</p>}
                <div className="brix-tip-body">
                  <MarkdownMessage text={tip.body} variant={size === 'sm' ? 'bxb-md' : 'bai-md'} />
                </div>
              </div>
              {onPick && <span className="brix-tip-cta">Set this up →</span>}
            </div>
          );
        })}
      </div>
    </>
  );
}
