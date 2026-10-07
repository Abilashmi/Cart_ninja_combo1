// Styles for the COD settings view (app.cod.jsx), CodSettingsCards.jsx and
// CodPreview.jsx's cart drawer. Every selector is a bcod- class, so nothing
// here can reach the rest of the BRIX admin.
export const COD_SETTINGS_CSS = `
/* settings page: the live preview stays in view while the settings scroll */
.bcod-sticky{position:sticky;top:16px}

.bcod-label{font-size:13px;font-weight:600;color:#303030;margin:0 0 8px}
.bcod-help{font-size:12.5px;color:#616161;margin:0;line-height:1.45}
.bcod-off{opacity:.5;pointer-events:none}
.bcod-row{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
@container (min-width:440px){.bcod-row.two{grid-template-columns:repeat(2,minmax(0,1fr))}}
.bcod-note{display:flex;gap:8px;align-items:flex-start;padding:10px 12px;border-radius:10px;background:#f7f7f7;font-size:12.5px;color:#4a4a4a;line-height:1.45}
.bcod-note svg{width:16px;height:16px;fill:#616161;flex:none;margin-top:1px}
.bcod-note b{color:#1a1a1a;font-weight:600}

/* shopper flow, one line of steps */
.bcod-flow{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;align-items:center;gap:6px 0}
.bcod-flow-s{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;color:#303030;padding:4px 10px;border-radius:99px;background:#f1f1f1;white-space:nowrap}
.bcod-flow-s+.bcod-flow-s{margin-left:18px;position:relative}
.bcod-flow-s+.bcod-flow-s:before{content:"";position:absolute;left:-13px;top:50%;width:6px;height:6px;border-top:1.5px solid #a8a8a8;border-right:1.5px solid #a8a8a8;transform:translateY(-50%) rotate(45deg)}
.bcod-flow-s svg{width:14px;height:14px;fill:currentColor}
.bcod-flow-s.is-accent{background:#1a1a1a;color:#fff}
.bcod-flow-s.is-done{background:#e3f8ec;color:#0c5132}
.bcod-flow-s.is-off{background:#fff;color:#8a8a8a;box-shadow:inset 0 0 0 1px #d4d4d4;text-decoration:line-through}

/* switch (black when on) */
.bcod-switch{position:relative;width:44px;height:24px;border-radius:12px;border:0;cursor:pointer;background:#c9cccf;transition:background .2s;flex:none;padding:0}
.bcod-switch[aria-checked="true"]{background:#1a1a1a}
.bcod-switch:after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .2s cubic-bezier(.3,1.4,.5,1)}
.bcod-switch[aria-checked="true"]:after{transform:translateX(20px)}
.bcod-switch:focus-visible{outline:2px solid #005bd3;outline-offset:2px}
.bcod-switch-row{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 14px;border-radius:10px;box-shadow:inset 0 0 0 1px #e3e3e3}
.bcod-switch-row .bcod-switch-t{display:flex;flex-direction:column;gap:2px;min-width:0}
.bcod-switch-row b{font-size:13.5px;font-weight:600;color:#1a1a1a}
.bcod-switch-row span{font-size:12.5px;color:#616161;line-height:1.4}

/* placement options: one per row, picture of the drawer footer on the left */
.bcod-place{display:flex;flex-direction:column;gap:8px}
.bcod-place-o{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:14px;padding:10px 14px 10px 10px;border-radius:12px;background:#fff;box-shadow:inset 0 0 0 1px #dcdcdc;transition:box-shadow .15s,background .15s}
.bcod-place-o:hover:not(:disabled){box-shadow:inset 0 0 0 1px #a8a8a8}
.bcod-place-o.is-on{box-shadow:inset 0 0 0 2px #1a1a1a;background:#fafafa}
.bcod-place-o:focus-visible{outline:2px solid #005bd3;outline-offset:2px}
.bcod-place-o:disabled{cursor:not-allowed;opacity:.55}
.bcod-place-m{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.bcod-place-t{font-size:13.5px;font-weight:650;color:#1a1a1a}
.bcod-place-d{font-size:12.5px;color:#616161;line-height:1.4}
.bcod-place-r{width:18px;height:18px;border-radius:50%;flex:none;box-shadow:inset 0 0 0 1.5px #a8a8a8;transition:box-shadow .15s}
.bcod-place-o.is-on .bcod-place-r{box-shadow:inset 0 0 0 5.5px #1a1a1a}
.bcod-mini{flex:none;width:112px;display:flex;flex-direction:column;gap:5px;padding:8px;border-radius:8px;background:#fff;box-shadow:inset 0 0 0 1px #e6e6e6}
.bcod-mini-sub{display:flex;justify-content:space-between;padding-bottom:4px;border-bottom:1px solid #efefef}
.bcod-mini-sub i{display:block;height:4px;width:34%;border-radius:2px;background:#cfcfcf}
.bcod-mini-sub i+i{width:24%;background:#9e9e9e}
.bcod-mini-btns{display:flex;flex-direction:column;gap:4px}
.bcod-mini-btns b{display:block;font-size:8.5px;font-weight:700;line-height:1;text-align:center;padding:5px 2px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bcod-mini-co{background:#1a1a1a;color:#fff}
.bcod-adv{font-size:12.5px}
.bcod-adv summary{cursor:pointer;color:#303030;font-weight:600;list-style:none;display:inline-flex;align-items:center;gap:6px}
.bcod-adv summary::-webkit-details-marker{display:none}
.bcod-adv summary:before{content:"";width:6px;height:6px;border-right:1.5px solid #616161;border-bottom:1.5px solid #616161;transform:rotate(-45deg);transition:transform .15s}
.bcod-adv[open] summary:before{transform:rotate(45deg)}
.bcod-adv summary:focus-visible{outline:2px solid #005bd3;outline-offset:2px;border-radius:4px}
.bcod-adv-b{margin-top:10px}

/* button style picker */
.bcod-seg{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.bcod-seg-o{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:7px;padding:10px 8px 9px;border-radius:10px;box-shadow:inset 0 0 0 1px #dcdcdc;font-size:12.5px;font-weight:600;color:#303030;transition:box-shadow .15s}
.bcod-seg-o:hover{box-shadow:inset 0 0 0 1px #a8a8a8}
.bcod-seg-o.is-on{box-shadow:inset 0 0 0 2px #1a1a1a;color:#1a1a1a}
.bcod-seg-o:focus-visible{outline:2px solid #005bd3;outline-offset:2px}
.bcod-seg-art{display:block;width:76%;height:16px}

/* fee summary */
.bcod-sum{border-radius:12px;padding:14px;background:#fafafa;box-shadow:inset 0 0 0 1px #ededed;display:flex;flex-direction:column;gap:8px;font-size:13px;color:#303030;font-variant-numeric:tabular-nums}
.bcod-sum-k{font-size:11px;font-weight:650;letter-spacing:.05em;text-transform:uppercase;color:#8a8a8a}
.bcod-sum-r{display:flex;justify-content:space-between;gap:10px}
.bcod-sum-r span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bcod-sum-r.is-fee{color:#1a1a1a;font-weight:600}
.bcod-sum-r.is-tot{border-top:1px dashed #d4d4d4;padding-top:8px;font-weight:750;font-size:14px;color:#1a1a1a}

/* excluded tags */
.bcod-tagin{display:flex;flex-direction:column;gap:10px}
.bcod-tags{display:flex;gap:8px;align-items:flex-start}
.bcod-tags>div{flex:1;min-width:0}
.bcod-chips{display:flex;flex-wrap:wrap;gap:6px}
.bcod-chip{display:inline-flex;align-items:center;gap:4px;padding:4px 4px 4px 10px;border-radius:99px;background:#1a1a1a;color:#fff;font-size:12.5px;font-weight:550}
.bcod-chip.is-bad{background:#fee9e8;color:#8e1f0b;box-shadow:inset 0 0 0 1px #fdb7b2}
.bcod-chip button{all:unset;cursor:pointer;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:14px;line-height:1;color:inherit;opacity:.75}
.bcod-chip button:hover{opacity:1;background:rgba(255,255,255,.18)}
.bcod-chip.is-bad button:hover{background:rgba(0,0,0,.08)}
.bcod-chip button:focus-visible{outline:2px solid #005bd3}
.bcod-empty{font-size:12.5px;color:#8a8a8a;padding:9px 12px;border-radius:10px;border:1px dashed #d4d4d4}

/* one look for the older controls inside the panel: black when on/selected */
.bcod-sticky .cod-switch[aria-checked="true"]{background:#1a1a1a}
.bcod-sticky .cod-place.on{border-color:#1a1a1a;box-shadow:none}
.bcod-sticky .cod-place.on .cod-place-tick{background:#1a1a1a;border-color:#1a1a1a}

/* live cart drawer preview */
.bcod-pv-stage{border-radius:12px;overflow:hidden;background:#e9e9e9}
.bcod-dr-stage{position:relative;display:flex;min-height:500px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#121212}
.bcod-dr-store{position:absolute;inset:0;padding:12px;display:flex;flex-direction:column;gap:10px;background:#f4f4f4}
.bcod-dr-store:after{content:"";position:absolute;inset:0;background:rgba(18,18,18,.42)}
.bcod-dr-store i,.bcod-dr-store-grid i{display:block;border-radius:6px;background:#dcdcdc}
.bcod-dr-store-h{height:20px}
.bcod-dr-store-hero{height:120px}
.bcod-dr-store-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.bcod-dr-store-grid i{height:90px}
.bcod-dr{position:relative;margin-left:auto;width:86%;background:#fff;display:flex;flex-direction:column;box-shadow:-10px 0 28px -12px rgba(0,0,0,.45);animation:bcodIn .3s ease}
@keyframes bcodIn{from{transform:translateX(16px);opacity:.6}}
.bcod-dr-h{display:flex;align-items:center;gap:8px;padding:16px 16px 12px;border-bottom:1px solid #ededed}
.bcod-dr-h b{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
.bcod-dr-count{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#121212;color:#fff;font-size:10.5px;font-weight:700;display:grid;place-items:center}
.bcod-dr-x{margin-left:auto;font-size:13px;color:#616161}
.bcod-dr-items{flex:1;display:flex;flex-direction:column;gap:14px;padding:14px 16px}
.bcod-dr-item{display:flex;gap:10px;align-items:flex-start}
.bcod-dr-thumb{width:54px;height:62px;border-radius:6px;flex:none;box-shadow:inset 0 0 0 1px rgba(0,0,0,.05)}
.bcod-dr-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;font-size:12px;line-height:1.3}
.bcod-dr-meta b{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bcod-dr-meta>span{color:#6b6b6b;font-size:11px}
.bcod-dr-qty{display:inline-flex !important;align-items:center;gap:10px;margin-top:6px;padding:3px 8px;border:1px solid #d4d4d4;border-radius:4px;align-self:flex-start;color:#121212 !important;font-size:11.5px !important}
.bcod-dr-qty i{font-style:normal;color:#6b6b6b}
.bcod-dr-num{font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.bcod-dr-foot{padding:12px 16px 16px;border-top:1px solid #ededed;display:flex;flex-direction:column}
.bcod-dr-sub{display:flex;justify-content:space-between;align-items:baseline;font-size:13px}
.bcod-dr-sub b{font-size:14px;font-variant-numeric:tabular-nums}
.bcod-dr-note{margin:4px 0 12px;font-size:11px;color:#6b6b6b}
.bcod-dr-btns{display:flex;flex-direction:column}
.bcod-dr-checkout{border-radius:4px;padding:14px;text-align:center;font-weight:600;font-size:14px;letter-spacing:.02em;background:#121212;color:#fff}
.bcod-dr-hidden{margin-top:8px;font-size:11px;color:#8a8a8a;text-align:center}
@media (prefers-reduced-motion:reduce){.bcod-dr{animation:none}.bcod-switch:after,.bcod-place-o,.bcod-seg-o{transition:none}}
`;
