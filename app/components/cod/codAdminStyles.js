// Styles for the COD Checkout admin page (app.cod.jsx) and its components.
// Everything is prefixed cod- so nothing leaks into the rest of the admin.
export const COD_ADMIN_CSS = `
.cod-pulse{display:inline-block;width:8px;height:8px;border-radius:50%;background:#14a35a;margin-right:6px;box-shadow:0 0 0 0 rgba(20,163,90,.6);animation:codPulse 1.8s infinite}
@keyframes codPulse{70%{box-shadow:0 0 0 8px rgba(20,163,90,0)}100%{box-shadow:0 0 0 0 rgba(20,163,90,0)}}

.cod-switch{position:relative;width:56px;height:32px;border-radius:16px;border:0;cursor:pointer;background:#c9cccf;transition:background .2s;flex:none;padding:0}
.cod-switch[aria-checked="true"]{background:#0c7a43}
.cod-switch:after{content:"";position:absolute;top:3px;left:3px;width:26px;height:26px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .22s cubic-bezier(.3,1.4,.5,1)}
.cod-switch[aria-checked="true"]:after{transform:translateX(24px)}
.cod-switch:focus-visible{outline:2px solid #005bd3;outline-offset:2px}
.cod-switch.sm{width:44px;height:24px}
.cod-switch.sm:after{width:18px;height:18px}
.cod-switch.sm[aria-checked="true"]:after{transform:translateX(20px)}

.cod-status{display:flex;gap:14px;align-items:center;padding:14px 16px;border-radius:14px;background:#fff;box-shadow:0 1px 0 rgba(26,26,26,.07),inset 0 0 0 1px #ebebeb;position:relative;overflow:hidden}
.cod-status:before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px}
.cod-status.live:before{background:#14a35a}.cod-status.warn:before{background:#e8a200}.cod-status.off:before{background:#b5b5b5}
.cod-status-ic{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;flex:none}
.cod-status.live .cod-status-ic{background:#e3f8ec;color:#0c7a43}
.cod-status.warn .cod-status-ic{background:#fff4dc;color:#946200}
.cod-status.off .cod-status-ic{background:#f1f1f1;color:#616161}
.cod-status-ic svg{fill:currentColor;width:22px;height:22px}
.cod-status-t{flex:1;min-width:0}
.cod-steps{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:8px;padding:5px 12px 5px 6px;border-radius:99px;font-size:12.5px;font-weight:600;white-space:nowrap;transition:background .15s}
.cod-steps.ok{background:#e3f8ec;color:#0c5132}.cod-steps.todo{background:#fff4dc;color:#5e3c00}
.cod-steps:hover{filter:brightness(.97)}
.cod-steps:focus-visible{outline:2px solid #005bd3;outline-offset:2px}
.cod-steps svg{width:24px;height:24px;transform:rotate(-90deg)}
.cod-steps.ok svg{transform:none;fill:currentColor;width:20px;height:20px}
.cod-steps circle{fill:none;stroke-width:4;stroke:rgba(0,0,0,.08)}
.cod-steps circle+circle{stroke:currentColor;stroke-linecap:round;transition:stroke-dashoffset .5s ease}
@media (max-width:560px){.cod-status{flex-wrap:wrap}.cod-status-t{flex-basis:calc(100% - 60px)}.cod-steps{margin-left:56px}}

.cod-views{margin:-4px 0 -6px}

.cod-kpi{padding:14px 16px;border-radius:12px;background:#fff;box-shadow:0 1px 0 rgba(26,26,26,.07),inset 0 0 0 1px #ebebeb;min-width:0}
.cod-kpi-h{display:flex;align-items:center;gap:8px}
.cod-kpi-ic{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;flex:none}
.cod-kpi-ic svg{width:16px;height:16px;fill:currentColor}
.cod-kpi-v{font-size:22px;font-weight:700;letter-spacing:-.02em;margin:8px 0 2px;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.cod-recent{display:flex;flex-direction:column;margin:0 -8px}
.cod-recent-row{display:flex;align-items:center;gap:10px;padding:8px;border-radius:10px;text-decoration:none;color:inherit;transition:background .12s}
.cod-recent-row:hover{background:#f6f6f7}
.cod-recent-row:focus-visible{outline:2px solid #005bd3}
.cod-recent-m{flex:1;min-width:0;display:flex;flex-direction:column}
.cod-recent-r{display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.cod-av{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;color:#303030;flex:none}
.cod-dot{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:#616161;white-space:nowrap}
.cod-dot:before{content:"";width:7px;height:7px;border-radius:50%;background:#b5b5b5}
.cod-dot.pending:before{background:#e8a200}.cod-dot.paid:before{background:#14a35a}.cod-dot.cancelled:before{background:#e22c38}
.cod-empty-mini{display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;padding:18px 8px}
.cod-empty-ic{width:40px;height:40px;border-radius:12px;background:#f1f1f1;display:grid;place-items:center}
.cod-empty-ic svg{fill:#8a8a8a}

.cod-cta{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:14px;background:linear-gradient(110deg,#f3f0ff 0%,#eef6ff 55%,#fff 100%);box-shadow:inset 0 0 0 1px #e4e0f5;transition:transform .15s,box-shadow .15s}
.cod-cta:hover{transform:translateY(-1px);box-shadow:inset 0 0 0 1px #cfc7f0,0 6px 16px -10px rgba(80,60,160,.5)}
.cod-cta:focus-visible{outline:2px solid #005bd3;outline-offset:2px}
.cod-cta-ic{width:38px;height:38px;border-radius:11px;background:#6b4ce6;display:grid;place-items:center;flex:none}
.cod-cta-ic svg{fill:#fff}
.cod-cta-t{flex:1;display:flex;flex-direction:column}

.cod-secnav{display:flex;flex-wrap:wrap;gap:4px;padding:10px;border-bottom:1px solid #ebebeb}
.cod-secnav::-webkit-scrollbar{display:none}
.cod-sec{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:5px;padding:7px 10px 7px 8px;border-radius:9px;font-size:12.5px;font-weight:550;color:#4a4a4a;white-space:nowrap;transition:background .12s,color .12s}
.cod-sec svg{width:18px;height:18px;fill:#8a8a8a}
.cod-sec:hover{background:#f6f6f7;color:#1a1a1a}
.cod-sec.on{background:#1a1a1a;color:#fff}
.cod-sec.on svg{fill:#fff}
.cod-sec:focus-visible{outline:2px solid #005bd3;outline-offset:1px}
.cod-sec-err{min-width:18px;height:18px;border-radius:9px;background:#e22c38;color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center;padding:0 5px}

.cod-check{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid #f1f1f1}
.cod-check:first-child{border-top:0}
.cod-check-ic{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;flex:none;margin-top:1px}
.cod-check-ic svg{width:16px;height:16px;fill:currentColor}
.cod-check.done .cod-check-ic{background:#cdfee1;color:#0c5132}
.cod-check.todo .cod-check-ic{background:#fff1e3;color:#8f4700}
.cod-check.info .cod-check-ic{background:#eaf4ff;color:#00527c}
.cod-check-b{flex:1;min-width:0}
.cod-check.done .cod-check-title{color:#616161}


.cod-chart{position:relative;padding-left:22px}
.cod-chart-max{position:absolute;left:0;top:-6px;font-size:11px;color:#8a8a8a}
.cod-chart-plot{height:110px;display:flex;align-items:flex-end;gap:2px;border-bottom:1px solid #e3e3e3;background:linear-gradient(#f1f1f1,#f1f1f1) 0 0/100% 1px no-repeat}
.cod-bar{all:unset;flex:1;height:100%;display:flex;align-items:flex-end;justify-content:center;position:relative;cursor:default}
.cod-bar:focus-visible{outline:2px solid #005bd3;outline-offset:1px;border-radius:4px}
.cod-bar-fill{width:62%;max-width:22px;background:#2c6ecb;border-radius:4px 4px 0 0;transition:height .4s ease,background .15s}
.cod-bar.on .cod-bar-fill{background:#1f5199}
.cod-tip{position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:#1a1a1a;color:#fff;font-size:12px;line-height:1.35;padding:6px 9px;border-radius:8px;white-space:nowrap;display:flex;flex-direction:column;z-index:2;pointer-events:none}
.cod-tip.left{left:auto;right:0;transform:none}
.cod-chart-x{display:flex;justify-content:space-between;font-size:11px;color:#8a8a8a;margin-top:6px}

.cod-place{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:12px;border:1.5px solid #e3e3e3;background:#fff;transition:border-color .15s,box-shadow .15s,transform .15s;position:relative}
.cod-place:hover{border-color:#b5b5b5;transform:translateY(-1px)}
.cod-place:focus-visible{outline:2px solid #005bd3;outline-offset:2px}
.cod-place.on{border-color:#0c7a43;box-shadow:0 0 0 3px rgba(12,122,67,.12)}
.cod-place-art{height:74px;border-radius:8px;background:#f6f6f7;position:relative;overflow:hidden}
.cod-place-art i{position:absolute;display:block;border-radius:4px;background:#e1e3e5}
.cod-place-art .b{background:var(--cod-bg,#111827)}
.cod-place-tick{z-index:1;box-shadow:0 1px 2px rgba(0,0,0,.15);position:absolute;top:10px;right:10px;width:22px;height:22px;border-radius:50%;border:1.5px solid #c9cccf;display:grid;place-items:center;background:#fff;color:#fff;font-size:13px;font-weight:700}
.cod-place.on .cod-place-tick{background:#0c7a43;border-color:#0c7a43}

.cod-toggle-row{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;padding:12px 14px;border:1px solid #ebebeb;border-radius:12px}
.cod-toggle-row .cod-tr-ic{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:#f1f1f1;flex:none}
.cod-toggle-row .cod-tr-ic svg{width:18px;height:18px;fill:#4a4a4a}

.cod-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.cod-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 4px 3px 10px;border-radius:99px;background:#f1f1f1;font-size:13px;font-variant-numeric:tabular-nums;animation:codChip .18s ease}
.cod-chip.bad{background:#fee9e8;color:#8e1f0b;box-shadow:inset 0 0 0 1px #fdb7b2}
.cod-chip button{all:unset;cursor:pointer;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:14px;line-height:1;color:#616161}
.cod-chip button:hover{background:rgba(0,0,0,.08)}
@keyframes codChip{from{transform:scale(.85);opacity:0}}

.cod-presets{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.cod-preset{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:12px;background:#fff;box-shadow:inset 0 0 0 1px #e3e3e3;transition:box-shadow .15s,transform .15s}
.cod-preset:hover{transform:translateY(-1px);box-shadow:inset 0 0 0 1px #b5b5b5,0 4px 12px -8px rgba(0,0,0,.3)}
.cod-preset.on{box-shadow:inset 0 0 0 2px #005bd3}
.cod-preset:focus-visible{outline:2px solid #005bd3;outline-offset:2px}
.cod-preset-btn{display:flex;align-items:center;justify-content:center;gap:5px;height:32px;padding:0 8px;border-radius:8px;font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden}
.cod-preset-btn span{overflow:hidden;text-overflow:ellipsis}
.cod-preset-n{font-size:12px;font-weight:600;color:#303030;text-align:center}
.cod-preset.on .cod-preset-n{color:#005bd3}
.cod-cpill{display:flex;gap:10px;align-items:flex-end}
.cod-cpill-sw{position:relative;width:36px;height:36px;border-radius:10px;flex:none;box-shadow:inset 0 0 0 1px rgba(0,0,0,.15),0 1px 2px rgba(0,0,0,.08);cursor:pointer;overflow:hidden}
.cod-cpill-sw input{position:absolute;inset:-8px;width:calc(100% + 16px);height:calc(100% + 16px);opacity:0;cursor:pointer;border:0;padding:0}
.cod-cpill-sw:focus-within{outline:2px solid #005bd3;outline-offset:2px}
.cod-swatches{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.cod-swatch{all:unset;cursor:pointer;width:28px;height:28px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.12);transition:transform .12s;position:relative}
.cod-swatch:hover{transform:scale(1.1)}
.cod-swatch.on:after{content:"";position:absolute;inset:-4px;border-radius:50%;border:2px solid #005bd3}
.cod-swatch:focus-visible{outline:2px solid #005bd3;outline-offset:3px}
.cod-color{display:flex;gap:8px;align-items:flex-end}
.cod-color input[type=color]{width:40px;height:36px;border:1px solid #c9cccf;border-radius:8px;padding:2px;background:#fff;cursor:pointer;flex:none}
.cod-contrast{display:inline-flex;gap:6px;align-items:center;font-size:12px;font-weight:600;padding:3px 9px;border-radius:99px}
.cod-contrast.ok{background:#cdfee1;color:#0c5132}
.cod-contrast.bad{background:#fff1e3;color:#8f4700}
.cod-suggest{all:unset;cursor:pointer;font-size:12.5px;padding:5px 10px;border-radius:99px;border:1px dashed #b5b5b5;color:#303030}
.cod-suggest:hover{border-style:solid;background:#f6f6f7}
.cod-suggest:focus-visible{outline:2px solid #005bd3;outline-offset:2px}

.cod-sticky{position:sticky;top:12px}
.cod-live-dot{font-size:12px;color:#616161;display:inline-flex;align-items:center;gap:6px}
.cod-live-dot:before{content:"";width:7px;height:7px;border-radius:50%;background:#14a35a;animation:codPulse 1.8s infinite}

.cod-stage{border-radius:14px;padding:18px 14px;background:radial-gradient(120% 90% at 0% 0%,#eef2ff 0%,transparent 60%),radial-gradient(120% 90% at 100% 100%,#ecfdf5 0%,transparent 55%),#f6f6f7;display:flex;justify-content:center}
.cod-scr{width:100%;max-width:290px;background:#fff;border-radius:16px;box-shadow:0 1px 2px rgba(0,0,0,.06),0 12px 28px -14px rgba(15,23,42,.35);overflow:hidden;font-size:12px;color:#111827;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;animation:codIn .25s ease}
@keyframes codIn{from{opacity:.4;transform:translateY(6px)}}
.cod-scr-h{display:flex;align-items:baseline;gap:6px;padding:12px 14px;border-bottom:1px solid #f1f2f4;font-size:13px}
.cod-scr-mu{color:#6b7280;font-size:11px;flex:1}
.cod-scr-x{color:#6b7280}
.cod-scr-items{padding:10px 14px;display:flex;flex-direction:column;gap:10px}
.cod-scr-item{display:flex;align-items:center;gap:10px}
.cod-scr-thumb{width:40px;height:40px;border-radius:9px;flex:none;box-shadow:inset 0 0 0 1px rgba(0,0,0,.05)}
.cod-scr-meta{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.3}
.cod-scr-meta b{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cod-scr-meta span{color:#6b7280;font-size:10.5px}
.cod-scr-num{font-variant-numeric:tabular-nums;white-space:nowrap}
.cod-scr-foot{padding:10px 14px 14px;border-top:1px solid #f1f2f4;display:flex;flex-direction:column;gap:8px}
.cod-scr-sub{display:flex;justify-content:space-between;font-size:12.5px}
.cod-scr-checkout{border-radius:10px;padding:10px;text-align:center;font-weight:700;background:#111827;color:#fff}
.cod-scr-img{height:118px;background:linear-gradient(135deg,#e0e7ff,#f5f3ff);display:grid;place-items:center}
.cod-scr-img span{width:64px;height:70px;border-radius:14px 14px 10px 10px;background:linear-gradient(160deg,#6366f1,#4338ca);box-shadow:0 10px 18px -8px rgba(67,56,202,.6)}
.cod-scr-body{padding:12px 14px 14px;display:flex;flex-direction:column;gap:8px}
.cod-scr-title{font-size:13px}
.cod-scr-price{font-size:14px;font-variant-numeric:tabular-nums}
.cod-scr-sizes{display:flex;gap:5px}
.cod-scr-sizes span{min-width:26px;height:22px;padding:0 6px;border-radius:6px;border:1px solid #e5e7eb;display:grid;place-items:center;font-size:10.5px;font-weight:600}
.cod-scr-sizes span.on{border-color:#111827;background:#111827;color:#fff}
.cod-scr-atc{border:1.5px solid #111827;border-radius:10px;padding:9px;text-align:center;font-weight:700}
.cod-scr-buys{display:flex;flex-direction:column}
.cod-scr-buys .cod-pv-hidden,.cod-scr-bin{margin-top:8px}
.cod-scr-bin{border-radius:10px;padding:10px;text-align:center;font-weight:700;background:#111827;color:#fff}
.cod-scr-sheet{background:#f3f4f6;display:flex;flex-direction:column}
.cod-scr-dim{height:46px;background:rgba(15,23,42,.45)}
.cod-scr-sheet .cod-pv-panel{position:static;border-radius:16px 16px 0 0;margin-top:-14px}
.cod-pv-top{display:flex;justify-content:space-between;align-items:center;font-size:13px;padding:2px 0}

.cod-pv-btn{border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;align-items:center;gap:2px;font-weight:700;font-size:12.5px;line-height:1.25;transition:background .2s,color .2s,opacity .2s}
.cod-pv-btn-l{display:inline-flex;align-items:center;gap:6px}
.cod-pv-btn-s{font-size:10px;font-weight:500;opacity:.85}
.cod-pv-hidden{border:1.5px dashed #c9cccf;border-radius:10px;padding:10px;text-align:center;color:#6b7280;font-size:11px}
.cod-pv-panel{background:#fff;border-radius:18px 18px 0 0;padding:0 14px 16px;display:flex;flex-direction:column;gap:10px;animation:codUp .35s ease}
@keyframes codUp{from{transform:translateY(30px);opacity:.4}}
.cod-pv-grab{width:32px;height:4px;border-radius:4px;background:#d1d5db;margin:8px auto 0}
.cod-pv-panel .cod-pv-top{padding:2px 0}
.cod-pv-tag{display:inline-flex;align-items:center;gap:3px;font-size:9.5px;font-weight:700;background:#ecfdf3;color:#067647;padding:2px 7px;border-radius:99px}
.cod-pv-rows{display:flex;flex-direction:column;gap:6px;background:#fafafa;border-radius:10px;padding:10px}
.cod-pv-rows div{display:flex;justify-content:space-between}
.cod-pv-tot{font-weight:800;font-size:13px;border-top:1px dashed #d1d5db;padding-top:7px}
.cod-pv-free{color:#067647}
.cod-pv-nudge{background:linear-gradient(135deg,#eff6ff,#f5f3ff);color:#1e3a8a;border-radius:10px;padding:9px 10px;font-size:11px}
.cod-pv-place{border-radius:11px;padding:11px;text-align:center;font-weight:700}
.cod-pv-err{background:#fef3f2;color:#b42318;border-radius:10px;padding:10px;font-size:11.5px}
.cod-pv-sec{border:1.5px solid #e5e7eb;border-radius:11px;padding:10px;text-align:center;font-weight:700}

.cod-pv-logo{display:block;max-width:130px;object-fit:contain;object-position:left center}
.cod-pv-logo.sm{height:16px}.cod-pv-logo.md{height:22px}.cod-pv-logo.lg{height:28px}
.cod-pv-title{font-size:14px}
.cod-scr-sheet .cod-pv-place{background:var(--acc);color:var(--acc-fg)}
.cod-pv-pw{display:flex;align-items:center;justify-content:center;gap:4px;font-size:9.5px;color:#9ca3af;margin-top:-2px}
.cod-pv-loader{display:flex;flex-direction:column;align-items:center;gap:12px;padding:26px 0 22px;color:#6b7280;font-size:11.5px}
.cod-pv-loader-m{padding:10px 14px;border-radius:14px;background:radial-gradient(closest-side,rgba(99,102,241,.16),transparent);animation:codPulseLogo 1.4s ease-in-out infinite}
.cod-pv-loader-bar{width:110px;height:3px;border-radius:3px;background:#eef0f3;overflow:hidden}
.cod-pv-loader-bar i{display:block;width:40%;height:100%;border-radius:3px;background:var(--acc);animation:codBar 1s ease-in-out infinite}
@keyframes codPulseLogo{50%{transform:scale(1.06)}}
@keyframes codBar{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
.rad-soft .cod-pv-panel{border-radius:10px 10px 0 0}.rad-sharp .cod-pv-panel{border-radius:4px 4px 0 0}
.rad-soft .cod-pv-rows,.rad-soft .cod-pv-place,.rad-soft .cod-pv-nudge,.rad-soft .cod-pv-err,.rad-soft .cod-pv-sec{border-radius:6px}
.rad-sharp .cod-pv-rows,.rad-sharp .cod-pv-place,.rad-sharp .cod-pv-nudge,.rad-sharp .cod-pv-err,.rad-sharp .cod-pv-sec{border-radius:2px}
.cod-radius{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;max-width:460px}
.cod-rad-art{display:flex;flex-direction:column;gap:5px;padding:10px 10px 8px;background:#f6f6f7;height:64px;justify-content:flex-end;box-shadow:inset 0 0 0 1px #ebebeb}
.cod-rad-art i{display:block;height:8px;background:#e1e3e5}
.cod-rad-art b{display:block;height:14px}
.cod-logo-box{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:12px;border-radius:12px;box-shadow:inset 0 0 0 1px #e3e3e3}
.cod-logo-img{height:56px;min-width:120px;max-width:220px;padding:8px 12px;border-radius:8px;display:grid;place-items:center;background-color:#fff;background-image:linear-gradient(45deg,#f1f1f1 25%,transparent 25%,transparent 75%,#f1f1f1 75%),linear-gradient(45deg,#f1f1f1 25%,transparent 25%,transparent 75%,#f1f1f1 75%);background-size:12px 12px;background-position:0 0,6px 6px}
.cod-logo-img img{max-height:40px;max-width:196px;object-fit:contain;display:block}
.cod-logo-drop .Polaris-DropZone{min-height:96px}
.cod-brixnote{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;background:#f6f6f7}
.cod-brixnote img{height:16px;width:auto;flex:none}

.cod-pv-cpn{display:flex;justify-content:space-between;align-items:center;border:1.5px dashed #d1d5db;border-radius:10px;padding:8px 10px;font-size:11px;color:#374151}
.cod-pv-cpn b{color:var(--acc)}
.rad-soft .cod-pv-cpn{border-radius:6px}.rad-sharp .cod-pv-cpn{border-radius:2px}
.cod-pv-cpn.open{border-style:solid;color:#9ca3af}
.cod-pv-go{color:var(--acc) !important;font-weight:800;letter-spacing:.05em;font-size:10px}
.cod-pv-ofr{display:flex;border-radius:8px;box-shadow:0 0 0 1px #eef0f3;overflow:hidden;font-size:10px}
.cod-pv-ofr-l{flex:none;width:22px;background:var(--acc);color:var(--acc-fg);display:flex;align-items:center;justify-content:center;position:relative}
.cod-pv-ofr-l>span{writing-mode:vertical-rl;transform:rotate(180deg);font-size:7.5px;font-weight:800;letter-spacing:.06em;white-space:nowrap;padding:6px 0}
.cod-pv-ofr-l:before,.cod-pv-ofr-l:after{content:"";position:absolute;right:-4px;width:8px;height:8px;border-radius:50%;background:#fff}
.cod-pv-ofr-l:before{top:-4px}.cod-pv-ofr-l:after{bottom:-4px}
.cod-pv-ofr-r{flex:1;min-width:0;padding:6px 8px 6px 10px;display:flex;flex-direction:column}
.cod-pv-ofr-h{display:flex;justify-content:space-between;align-items:center;gap:6px}
.cod-pv-ofr-h b:first-child{font-weight:800;letter-spacing:.04em;font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cod-pv-ofr-t{margin-top:4px;padding-top:4px;border-top:1px dashed #e5e7eb;color:#4b5563;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cod-offer{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;box-shadow:inset 0 0 0 1px #e3e3e3;background:#fff}
.cod-offer-code{flex:none;font-weight:700;font-size:13px;letter-spacing:.03em;padding:4px 9px;border-radius:7px;border:1.5px dashed #8a8a8a;background:#f6f6f7}
.cod-sim{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:10px;font-size:13px}
.cod-sim b{font-size:14px}
.cod-sim.ok{background:#cdfee1;color:#0c5132}
.cod-sim.bad{background:#fff1e3;color:#5e2f00}

.cod-src{display:inline-flex;align-items:center;gap:6px}
.cod-src svg{width:16px;height:16px;fill:#616161}

.cod-secret{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:10px 14px;border:1px solid #ebebeb;border-radius:12px}
.cod-events{display:flex;flex-direction:column;border:1px solid #ebebeb;border-radius:12px;overflow:hidden;font-size:13px}
.cod-events>div{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:8px;padding:8px 12px;align-items:center}
.cod-events>div+div{border-top:1px solid #f1f1f1}
.cod-events code{font-size:12px;background:#f6f6f7;border-radius:6px;padding:2px 6px;justify-self:start;overflow-wrap:anywhere}
@media (prefers-reduced-motion:reduce){.cod-pv-loader-m,.cod-pv-loader-bar i{animation:none}.cod-scr{animation:none}.cod-cta,.cod-steps circle+circle{transition:none}.cod-pulse,.cod-live-dot:before,.cod-chip,.cod-pv-panel{animation:none}.cod-switch:after,.cod-place,.cod-bar-fill{transition:none}}
`;
