// Styles for the Coupon Banner editor (app.productwidget.jsx): one simple page
// of numbered cards on the left (coupons, design, where it shows, timer, then
// "More options"), live product-page preview on the right. Every selector is a
// cbz- class (or [data-pick] in the preview).
export const COUPON_BANNER_CSS = `
.cbz-body{flex:1;display:grid;grid-template-columns:minmax(0,11fr) minmax(0,9fr);min-height:0;overflow:hidden}
.cbz-side{overflow-y:auto;border-right:1px solid #e1e3e5;padding-bottom:var(--brix-bar-clearance,160px);min-width:0}
.cbz-main{overflow-y:auto;padding:12px 12px var(--brix-bar-clearance,160px);min-width:0}
@media (max-width:900px){
  .cbz-body{grid-template-columns:1fr;overflow-y:auto}
  .cbz-side,.cbz-main{overflow:visible}
  .cbz-side{padding-bottom:0;border-right:0}
}
.cbz-alert{padding:12px 12px 0}

/* the page's cards */
.cbz-stack{display:flex;flex-direction:column;gap:12px;padding:12px}
.cbz-sec{background:#fff;border:1px solid #e1e3e5;border-radius:12px;padding:16px}
.cbz-sec-h{display:flex;align-items:center;gap:8px;margin:0 0 4px;font-size:15px;font-weight:650;color:#202223}
.cbz-sec-d{margin:0 0 12px;font-size:13px;color:#6d7175;line-height:1.45}
.cbz-step{width:22px;height:22px;border-radius:50%;background:#202223;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:12px;flex:none}
.cbz-opt{font-size:11px;font-weight:600;color:#6d7175;background:#f1f2f3;border-radius:10px;padding:1px 8px}
.cbz-more{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;padding:11px;border:1.5px dashed #c9cccf;border-radius:12px;font-size:13.5px;font-weight:600;color:#303030;background:#fff}
.cbz-more:hover{border-color:#8c9196}
.cbz-more:focus-visible{outline:2px solid #005bd3;outline-offset:2px}
.cbz-more-d{font-weight:400;color:#6d7175}
.cbz-chev{width:16px;height:16px;display:flex;flex:none;color:#8c9196;transition:transform .2s ease}
.cbz-chev svg{fill:currentColor}
.cbz-more[aria-expanded="true"] .cbz-chev,.cbz-fold.is-open .cbz-chev,.cbz-sec--fold.is-open .cbz-chev{transform:rotate(180deg)}
/* a card of More options: closed = title, description and what's set; click to open */
.cbz-sec--fold{padding:0}
.cbz-sec--fold .cbz-sec-h{margin:0}
.cbz-sec-btn{all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;align-items:center;gap:10px;padding:14px 16px;border-radius:12px}
.cbz-sec-btn:hover{background:#fafbfb}
.cbz-sec-btn:focus-visible{outline:2px solid #005bd3;outline-offset:-2px}
.cbz-sec--fold.is-open .cbz-sec-btn{border-radius:12px 12px 0 0}
.cbz-sec-tt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.cbz-sec-t{font-size:15px;font-weight:650;color:#202223}
.cbz-sec-bd{font-size:13px;font-weight:400;color:#6d7175;line-height:1.45}
.cbz-sum{flex:none;max-width:42%;font-size:12px;font-weight:500;color:#303030;background:#f1f2f3;border-radius:10px;padding:2px 9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cbz-sec-b{padding:4px 16px 16px}

/* 1. coupons to show */
.cbz-clist{border:1px solid #e1e3e5;border-radius:10px;max-height:330px;overflow-y:auto;background:#fff}
.cbz-clist-none{padding:14px;text-align:center;font-size:13px;color:#6d7175}
.cbz-crow{display:flex;align-items:center;gap:8px;padding:8px 10px 8px 12px;min-height:40px}
.cbz-crow+.cbz-crow{border-top:1px solid #f1f2f3}
.cbz-crow.is-on{background:#f1f8f5}
.cbz-crow-main{flex:1;min-width:0;display:flex;align-items:center;gap:10px;cursor:pointer}
.cbz-crow-main input{width:16px;height:16px;margin:0;flex:none;accent-color:#008060;cursor:pointer}
.cbz-crow-txt{min-width:0;display:flex;flex-direction:column}
.cbz-crow-t{font-size:13.5px;font-weight:600;color:#202223;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cbz-crow-s{font-size:12px;color:#6d7175;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cbz-empty{padding:16px 14px;text-align:center;border:1.5px dashed #c9cccf;border-radius:10px;background:#fff;font-size:13px;color:#6d7175;line-height:1.5}

/* field label + help for the custom controls below */
.cbz-label{display:block;font-size:13px;color:#303030;margin-bottom:6px}
.cbz-help{font-size:12px;color:#6d7175;margin-top:6px;line-height:1.45}
.cbz-sub{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6d7175}

/* segmented control (one choice) */
.cbz-seg{display:flex;border:1px solid #c9cccf;border-radius:8px;overflow:hidden;background:#fff}
.cbz-seg button{all:unset;box-sizing:border-box;cursor:pointer;flex:1;text-align:center;padding:6px 8px;font-size:12.5px;font-weight:500;color:#4a4a4a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cbz-seg button+button{border-left:1px solid #c9cccf}
.cbz-seg button:hover{background:#f6f6f7}
.cbz-seg button.is-on{background:#202223;color:#fff}
.cbz-seg button:focus-visible{outline:2px solid #005bd3;outline-offset:-2px}

/* picture tiles (one choice, or actions) */
.cbz-tiles{display:grid;gap:8px}
.cbz-tile{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;gap:6px;padding:10px;border:1.5px solid #e1e3e5;border-radius:10px;background:#fff;position:relative;min-width:0}
.cbz-tile:hover{border-color:#8c9196}
.cbz-tile:focus-visible{outline:2px solid #005bd3;outline-offset:2px}
.cbz-tile.is-on{border-color:#008060;background:#f1f8f5;box-shadow:inset 0 0 0 1px #008060}
.cbz-tile-art{height:58px;border-radius:6px;background:#f1f2f3;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:6px;box-sizing:border-box}
.cbz-tile-l{font-size:13px;font-weight:600;color:#202223}
.cbz-tile-d{font-size:11.5px;color:#6d7175;line-height:1.4}
.cbz-tile-check{position:absolute;top:6px;right:6px;width:18px;height:18px;border-radius:50%;background:#008060;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;line-height:1}
/* "Add a text offer / offer ladder": picture on the left, words on the right */
.cbz-tile--row{flex-direction:row;align-items:center;gap:10px;border-style:dashed}
.cbz-tile--row .cbz-tile-art{width:58px;height:42px;flex:none}
.cbz-tile--row .cbz-tile-txt{display:flex;flex-direction:column;gap:2px;min-width:0}

/* folded settings (popup) */
.cbz-fold{border:1px solid #e1e3e5;border-radius:10px;background:#fff}
.cbz-fold-h{all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-radius:10px}
.cbz-fold-h:hover{background:#fafbfb}
.cbz-fold-h:focus-visible{outline:2px solid #005bd3;outline-offset:-2px}
.cbz-fold-t{display:block;font-size:13.5px;font-weight:600;color:#202223}
.cbz-fold-d{display:block;font-size:12px;color:#6d7175}
.cbz-fold-b{padding:12px;border-top:1px solid #f1f2f3}
.cbz-modal-pv{position:sticky;top:-16px;z-index:2;margin:-16px -16px 16px;padding:14px 16px;background:#f6f6f7;border-bottom:1px solid #e1e3e5}
.cbz-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.cbz-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
@media (max-width:1150px){.cbz-grid3{grid-template-columns:repeat(2,minmax(0,1fr))}}
.cbz-card{border:1px solid #e1e3e5;border-radius:10px;background:#fff;padding:12px}
.cbz-card-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.cbz-card-h b{font-size:13px;color:#202223}
.cbz-where{font-size:11px;color:#6d7175;background:#f1f2f3;border-radius:10px;padding:1px 8px;white-space:nowrap}

/* preview */
.cbz-pv{background:#fff;border:1px solid #e1e3e5;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.06)}
.cbz-pv-bar{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #e1e3e5}
.cbz-pv-bar b{font-size:13px;color:#202223}
.cbz-pv-bar span{font-size:12px;color:#6d7175;margin-left:auto}
.cbz-pv-chrome{height:28px;background:#f1f2f3;border-bottom:1px solid #e1e3e5;display:flex;align-items:center;gap:5px;padding:0 10px}
.cbz-pv-chrome i{width:8px;height:8px;border-radius:50%;background:#d0d3d6}
.cbz-pv-chrome span{flex:1;height:14px;margin-left:8px;background:#fff;border-radius:4px;border:1px solid #e1e3e5}
.cbz-pv-page{padding:18px;background:#fff;display:flex;flex-direction:column;gap:12px}
.cbz-skel{display:flex;flex-direction:column;gap:7px}
.cbz-skel i{display:block;height:9px;border-radius:5px;background:#eceef0}
.cbz-pv-note{font-size:12px;color:#6d7175;line-height:1.5;padding:10px 14px;border-top:1px solid #f1f2f3;background:#fafbfb}
.cbz-pv-sample>.pw-banner{opacity:.45;filter:grayscale(.3);pointer-events:none}
.cbz-pv-cta{margin-top:10px;padding:8px 12px;border-radius:8px;background:#f1f8f5;border:1px solid #b5e3d8;font-size:12.5px;color:#303030;font-weight:500}
.cbz-standin{height:46px;border-radius:6px;border:1.5px dashed #9ca3af;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:#6b7280;background:#fff;width:78%;box-sizing:border-box}

/* click a coupon in the preview to edit it */
.cbz-pv [data-pick]{position:relative;cursor:pointer;border-radius:8px;outline:2px dashed transparent;outline-offset:3px;transition:outline-color .12s}
.cbz-pv [data-pick]:hover{outline-color:#62b89a}
.cbz-pv [data-pick]::after{content:'Edit';position:absolute;top:-10px;right:10px;z-index:2;background:#008060;color:#fff;font:600 10.5px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:0 7px;border-radius:10px;opacity:0;transition:opacity .12s;pointer-events:none}
.cbz-pv [data-pick]:hover::after{opacity:1}
@media (prefers-reduced-motion:reduce){.cbz-chev,.cbz-pv [data-pick],.cbz-pv [data-pick]::after{transition:none}}
`;
