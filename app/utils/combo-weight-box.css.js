// Styles of "The Weight Box" combo template (layout5). One copy, used by the
// storefront script (combo-page[.]js.jsx renderLayout5, injected as text) and
// the builder's live preview (app.bundles.customize.jsx renderWeightBox), so
// what the merchant designs is what shoppers get. Colours come from the
// --bxw-* variables set on .bxw from the merchant's config; sizes are fixed
// so theme CSS can't squash the layout.
export const WEIGHT_BOX_CSS = `
.bxw{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:28px;max-width:1240px;margin:24px auto;padding:0 20px 24px;box-sizing:border-box;color:var(--bxw-text);font-family:inherit;}
.bxw *{box-sizing:border-box;}
.bxw--mobile{grid-template-columns:1fr;gap:16px;margin:12px auto;padding:0 14px 96px;}
.bxw-main{min-width:0;}
.bxw-hero{background:var(--bxw-bg);border-radius:20px;padding:28px 28px 22px;margin-bottom:18px;}
.bxw--mobile .bxw-hero{padding:20px 18px 16px;border-radius:16px;}
.bxw-eyebrow{font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--bxw-accent);opacity:.8;}
.bxw-title{margin:6px 0 0;font-size:32px;line-height:1.15;font-weight:800;color:var(--bxw-text);}
.bxw--mobile .bxw-title{font-size:24px;}
.bxw-desc{margin:8px 0 0;font-size:15px;line-height:1.55;opacity:.75;max-width:62ch;}
.bxw-ladder{list-style:none;margin:18px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:10px;}
.bxw-rung{display:flex;flex-direction:column;gap:2px;padding:10px 14px;border-radius:12px;background:#fff;border:1.5px solid rgba(0,0,0,.08);min-width:116px;}
.bxw-rung-w{font-size:18px;font-weight:800;}
.bxw-rung-o{font-size:12.5px;font-weight:600;opacity:.75;}
.bxw-rung.is-next{border-color:var(--bxw-accent);}
.bxw-rung.is-hit{background:var(--bxw-good);border-color:var(--bxw-good);color:#fff;}
.bxw-rung.is-hit .bxw-rung-o{opacity:.95;}
.bxw-pills{display:flex;gap:8px;overflow-x:auto;padding:2px 0 14px;scrollbar-width:none;}
.bxw-pills::-webkit-scrollbar{display:none;}
.bxw-pill{flex:0 0 auto;border:1.5px solid rgba(0,0,0,.12);background:#fff;color:var(--bxw-text);border-radius:999px;padding:8px 16px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;}
.bxw-pill.is-on{background:var(--bxw-accent);border-color:var(--bxw-accent);color:#fff;}
.bxw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px;}
.bxw--mobile .bxw-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
.bxw-card{background:#fff;border:1.5px solid rgba(0,0,0,.08);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;transition:border-color .2s,box-shadow .2s;}
.bxw-card.is-in{border-color:var(--bxw-good);box-shadow:0 0 0 3px rgba(21,128,61,.12);}
.bxw-media{position:relative;aspect-ratio:3/4;background:var(--bxw-bg);cursor:pointer;display:flex;align-items:center;justify-content:center;}
.bxw-media img{width:100%;height:100%;object-fit:cover;display:block;}
.bxw-tick{position:absolute;top:10px;right:10px;width:26px;height:26px;border-radius:50%;background:var(--bxw-good);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;}
.bxw-info{padding:12px;display:flex;flex-direction:column;gap:8px;flex:1;}
.bxw-name{font-size:14.5px;font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.bxw-select{width:100%;font:inherit;font-size:13px;padding:6px 8px;border:1px solid rgba(0,0,0,.15);border-radius:8px;background:#fff;color:inherit;}
.bxw-meta{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:auto;}
.bxw-price{font-size:15px;font-weight:700;}
.bxw-chip{font-size:11.5px;font-weight:700;padding:3px 8px;border-radius:999px;background:var(--bxw-bg);white-space:nowrap;}
.bxw-chip.is-off{background:#fef3c7;color:#92400e;}
.bxw-add{width:100%;border:0;border-radius:10px;padding:10px 12px;background:var(--bxw-accent);color:#fff;font:inherit;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap;}
.bxw-stepper{display:flex;align-items:center;justify-content:space-between;border:1.5px solid var(--bxw-good);border-radius:10px;overflow:hidden;}
.bxw-stepper button,.bxw-mini button{border:0;background:transparent;color:inherit;font:inherit;font-size:18px;font-weight:700;width:38px;height:38px;cursor:pointer;line-height:1;}
.bxw-stepper span{font-size:13px;font-weight:700;color:var(--bxw-good);}
.bxw-aside{position:relative;}
.bxw-panel{position:sticky;top:20px;background:#fff;border:1.5px solid rgba(0,0,0,.08);border-radius:20px;padding:20px;box-shadow:0 12px 32px rgba(0,0,0,.06);display:flex;flex-direction:column;gap:12px;}
.bxw-panel.is-sheet{position:static;border:0;border-radius:20px 20px 0 0;box-shadow:none;max-height:82vh;overflow-y:auto;}
.bxw-panel-head{display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;}
.bxw-count{font-size:12px;font-weight:600;letter-spacing:0;text-transform:none;opacity:.6;}
.bxw-close{border:0;background:transparent;font-size:18px;cursor:pointer;color:inherit;padding:4px;}
.bxw-scale{display:flex;align-items:baseline;gap:8px;}
.bxw-kg{font-size:34px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;}
.bxw-of{font-size:13px;opacity:.6;}
.bxw-track{position:relative;height:12px;border-radius:12px;background:#ece7df;overflow:visible;}
.bxw-fill{height:100%;border-radius:12px;background:var(--bxw-bar);transition:width .4s ease,background .3s;}
.bxw-track.is-good .bxw-fill{background:var(--bxw-good);}
.bxw-track.is-over .bxw-fill{background:#dc2626;}
.bxw-mark{position:absolute;top:-3px;width:3px;height:18px;border-radius:2px;background:rgba(0,0,0,.25);transform:translateX(-1px);}
.bxw-mark.is-hit{background:var(--bxw-good);}
.bxw-msg{margin:0;font-size:13.5px;font-weight:600;line-height:1.45;}
.bxw-msg.is-success{color:var(--bxw-good);}
.bxw-msg.is-error{color:#b91c1c;}
.bxw-items{display:flex;flex-direction:column;gap:10px;max-height:300px;overflow-y:auto;border-top:1px solid rgba(0,0,0,.07);padding-top:12px;}
.bxw-panel.is-sheet .bxw-items{max-height:none;}
.bxw-empty{font-size:13.5px;opacity:.65;padding:6px 0;}
.bxw-item{display:flex;align-items:center;gap:10px;}
.bxw-item img,.bxw-item .bxw-noimg{width:44px;height:44px;border-radius:10px;object-fit:cover;flex:0 0 auto;background:var(--bxw-bg);}
.bxw-item-main{flex:1;min-width:0;}
.bxw-item-name{font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bxw-item-sub{font-size:12px;opacity:.65;}
.bxw-mini{display:flex;align-items:center;border:1px solid rgba(0,0,0,.12);border-radius:8px;}
.bxw-mini button{width:28px;height:28px;font-size:15px;}
.bxw-mini span{min-width:18px;text-align:center;font-size:13px;font-weight:700;}
.bxw-totals{display:flex;flex-direction:column;gap:6px;border-top:1px solid rgba(0,0,0,.07);padding-top:12px;font-size:14px;}
.bxw-totals div{display:flex;justify-content:space-between;}
.bxw-totals .is-good{color:var(--bxw-good);font-weight:600;}
.bxw-total{font-size:18px;font-weight:800;}
.bxw-checkout,.bxw-cod{width:100%;border-radius:12px;padding:14px 16px;font:inherit;font-size:15px;font-weight:800;cursor:pointer;}
.bxw-checkout{border:0;background:var(--bxw-accent);color:#fff;}
.bxw-cod{border:1.5px solid var(--bxw-accent);background:#fff;color:var(--bxw-accent);}
.bxw-checkout:disabled,.bxw-cod:disabled{opacity:.45;cursor:not-allowed;}
.bxw-clear{border:0;background:transparent;color:inherit;opacity:.6;font:inherit;font-size:13px;text-decoration:underline;cursor:pointer;align-self:center;}
.bxw-bar{position:fixed;left:12px;right:12px;bottom:12px;z-index:9990;display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--bxw-accent);color:#fff;border-radius:16px;padding:12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.25);}
.bxw-bar.is-preview{position:sticky;left:auto;right:auto;bottom:8px;}
.bxw-bar-info{display:flex;flex-direction:column;line-height:1.2;}
.bxw-bar-info b{font-size:18px;}
.bxw-bar-info span{font-size:12.5px;opacity:.85;}
.bxw-bar-btn{border:0;border-radius:10px;background:#fff;color:var(--bxw-accent);font:inherit;font-size:14px;font-weight:800;padding:10px 16px;cursor:pointer;}
.bxw-scrim{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9991;}
.bxw-sheet{position:fixed;left:0;right:0;bottom:0;z-index:9992;background:#fff;border-radius:20px 20px 0 0;box-shadow:0 -10px 30px rgba(0,0,0,.2);animation:bxw-up .25s ease-out;}
@keyframes bxw-up{from{transform:translateY(40px);opacity:0;}to{transform:none;opacity:1;}}
@media (prefers-reduced-motion: reduce){.bxw-sheet{animation:none;}.bxw-fill{transition:none;}}
`;

/** CSS custom properties for .bxw from a combo config (merchant colours). */
export function weightBoxVars(config = {}) {
  return {
    '--bxw-accent': config.primary_color || '#1f3a2e',
    '--bxw-good': config.progress_success_color || '#15803d',
    '--bxw-bg': config.bg_color || '#faf7f2',
    '--bxw-text': config.text_color || '#1c1917',
    '--bxw-bar': config.progress_bar_color || '#1f3a2e',
  };
}

/** "10% off" / "₹100 off" / "Box for ₹1700" — a tier's offer in the ladder. */
export function tierOfferText(tier, symbol) {
  if (tier.type === 'percentage') return `${tier.value}% off`;
  if (tier.type === 'fixed_amount') return `${symbol}${tier.value} off`;
  return `Box for ${symbol}${tier.value}`;
}
