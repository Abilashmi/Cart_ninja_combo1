// Styles for the COD customizer (app.cod_.customize.jsx), laid out like the
// Cart Editor: sidebar of sections on the left, live preview on the right.
// Every selector is a bcz- class.
export const COD_CUSTOMIZE_CSS = `
.bcz{display:flex;width:100%;height:100vh;overflow:hidden;background:#f6f6f7}
.bcz-side{width:clamp(520px,44vw,640px);min-width:520px;height:100vh;display:flex;flex-direction:column;background:#fff;border-right:1px solid #e1e3e5;overflow:hidden}
.bcz-main{flex:1;min-width:0;height:100vh;display:flex;flex-direction:column;background:#f0f1f3;overflow:hidden}
@media (max-width:900px){
  .bcz{flex-direction:column;height:auto;overflow:visible}
  .bcz-side{width:100%;min-width:0;height:auto;border-right:0;border-bottom:1px solid #e1e3e5}
  .bcz-main{flex:none;height:min(760px,92vh)}
}

/* sidebar header */
.bcz-head{flex:none;padding:10px 14px 8px;border-bottom:1px solid #e1e3e5}
.bcz-head-row{display:flex;align-items:center;gap:8px}
.bcz-back{all:unset;cursor:pointer;display:flex;color:#6d7175;border-radius:6px;padding:2px}
.bcz-back:hover{background:#f1f2f3}
.bcz-back:focus-visible{outline:2px solid #005bd3}
.bcz-title{flex:1;font-size:14px;font-weight:700;color:#202223}
.bcz-pill{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:#e4e5e7;color:#6d7175}
.bcz-pill span{width:6px;height:6px;border-radius:50%;background:currentColor}
.bcz-pill.is-on{background:#aee9d1;color:#005e46}
.bcz-pill:focus-visible{outline:2px solid #005bd3;outline-offset:2px}
.bcz-note{margin:6px 0 0;font-size:11.5px;color:#8a6116}

/* sections */
.bcz-list{flex:1;overflow-y:auto;overflow-x:hidden;min-height:0}
.bcz-group{padding:10px 14px 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#8c9196}
.bcz-item{border-bottom:1px solid #f1f2f3}
.bcz-row{all:unset;box-sizing:border-box;cursor:pointer;width:100%;display:flex;align-items:center;gap:8px;padding:8px 14px}
.bcz-row:hover{background:#fafbfb}
.bcz-row:focus-visible{outline:2px solid #005bd3;outline-offset:-2px}
.bcz-row.is-open{background:#f0f7f5}
.bcz-row-ic{width:18px;height:18px;display:flex;flex:none;color:#8c9196}
.bcz-row-ic svg{fill:currentColor}
.bcz-row.is-open .bcz-row-ic{color:#008060}
.bcz-row-l{flex:1;min-width:0;font-size:13px;font-weight:500;color:#202223;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bcz-row.is-open .bcz-row-l{color:#008060}
.bcz-badge{padding:1px 7px;border-radius:10px;font-size:10.5px;font-weight:600;background:#e4e5e7;color:#6d7175;flex:none}
.bcz-badge.is-on{background:#aee9d1;color:#005e46}
.bcz-badge.is-err{background:#fed3d1;color:#8e1f0b}
.bcz-row-chev{width:16px;height:16px;display:flex;flex:none;color:#8c9196;transition:transform .2s ease}
.bcz-row-chev svg{fill:currentColor}
.bcz-row.is-open .bcz-row-chev{transform:rotate(180deg)}
.bcz-body{padding:10px 14px 18px;background:#fafbfb;border-top:1px solid #e1e3e5}

/* preview toolbar */
.bcz-bar{flex:none;display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid #e1e3e5;flex-wrap:nowrap;min-width:0}
@media (max-width:1320px){.bcz-bar-l{display:none}}
.bcz-bar-l{font-size:11px;font-weight:700;color:#6d7175;text-transform:uppercase;letter-spacing:.5px}
.bcz-seg{display:flex;border:1px solid #c9cccf;border-radius:6px;overflow:hidden;background:#fff}
.bcz-seg button{all:unset;cursor:pointer;display:flex;align-items:center;gap:4px;padding:4px 9px;font-size:11.5px;font-weight:500;color:#6d7175;white-space:nowrap}
.bcz-seg button+button{border-left:1px solid #c9cccf}
.bcz-seg button svg{width:16px;height:16px;fill:currentColor}
.bcz-seg button.is-on{background:#202223;color:#fff}
.bcz-seg button:focus-visible{outline:2px solid #005bd3;outline-offset:-2px}
.bcz-actions{margin-left:auto;display:flex;gap:6px}

/* device frame: Cart Editor sizes (360 desktop / 320 phone), as tall as the
   preview area. Nothing inside scrolls: the drawer fills the frame and the
   product page / COD checkout are scaled to fit (useFitToFrame). */
.bcz-stage{flex:1;min-height:0;display:flex;justify-content:center;align-items:stretch;padding:8px 12px 6px;overflow:hidden}
.bcz-frame{display:flex;flex-direction:column;height:100%;overflow:hidden;background:#f9f9f9;box-shadow:0 8px 40px rgba(0,0,0,.18)}
.bcz-frame.is-desktop{width:360px;border-radius:10px;border:1px solid #d0d0d0}
.bcz-frame.is-mobile{width:320px;border-radius:36px;border:3px solid #1a1a1a}
.bcz-chrome{flex:none;height:36px;background:#e8e8e8;display:flex;align-items:center;gap:6px;padding:0 12px;border-bottom:1px solid #d0d0d0}
.bcz-chrome i{width:10px;height:10px;border-radius:50%;background:#ff6f61}
.bcz-chrome i:nth-child(2){background:#ffca55}.bcz-chrome i:nth-child(3){background:#3ddc84}
.bcz-chrome span{flex:1;height:20px;margin-left:8px;background:#fff;border-radius:4px;border:1px solid #ccc}
.bcz-notch{flex:none;height:26px;background:#1a1a1a;margin:0 auto;width:120px;border-radius:0 0 14px 14px}
.bcz-screen{flex:1;min-height:0;position:relative;overflow:hidden;display:flex;flex-direction:column;background:#f6f6f7}
.bcz-screen.is-drawer>.bcod-dr-stage{flex:1;min-height:0}
.bcz-screen.is-drawer .bcod-dr{width:90%}
.bcz-screen.is-drawer .bcod-dr-items{overflow:hidden;min-height:0}
.bcz-frame.is-mobile .bcz-screen.is-drawer .bcod-dr{width:94%}
.bcz-frame.is-mobile .bcz-screen{background:#fff}
.bcz-fit{position:absolute;transform-origin:top center}
.bcz-fit>.cod-scr{max-width:none;width:100%;margin:0 auto}
.bcz-frame.is-mobile .bcz-fit>.cod-scr{border-radius:0;box-shadow:none}

/* COD checkout popup on a plain light background (no dimmed backdrop). */
.bcz-screen.is-sheet .cod-scr{background:transparent;box-shadow:none;overflow:visible;border-radius:0}
.bcz-screen.is-sheet .cod-scr-dim{display:none}
.bcz-screen.is-sheet .cod-pv-panel{margin-top:0;border-radius:18px;box-shadow:0 1px 3px rgba(0,0,0,.06),0 0 0 1px #e6e6e6;padding-top:14px}
.bcz-screen.is-sheet .cod-scr.rad-soft .cod-pv-panel{border-radius:12px}
.bcz-screen.is-sheet .cod-scr.rad-sharp .cod-pv-panel{border-radius:5px}
.bcz-screen.is-sheet .cod-pv-grab{display:none}
.bcz-frame.is-mobile .bcz-screen.is-sheet .cod-pv-panel{border-radius:0;box-shadow:none;padding-top:4px}

/* preview footer */
.bcz-foot{flex:none;display:flex;align-items:center;gap:12px;padding:5px 12px;border-top:1px solid #e1e3e5;background:#fff;flex-wrap:nowrap;min-width:0}
.bcz-caption{flex:1;min-width:0;font-size:12px;color:#616161;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bcz-foot-c{display:flex;align-items:center;gap:12px;flex:none}
.bcz-foot-c{margin-left:auto}
@media (max-width:1250px){.bcz-caption{display:none}}
.bcz-foot-c .Polaris-Choice{white-space:nowrap}
.bcz-cart{display:flex;align-items:center;gap:8px;font-size:12px;color:#616161}
.bcz-cart input{width:110px;accent-color:#202223}
.bcz-cart b{color:#202223;font-variant-numeric:tabular-nums;min-width:72px}
@media (prefers-reduced-motion:reduce){.bcz-row-chev{transition:none}}
`;
