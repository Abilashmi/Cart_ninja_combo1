// Guided setup look (GuideShell, GuidePanel, GuideQuestions, GuideSpotlight).
// - The questions: a box in the middle of the screen, answers side by side.
// - The steps panel: a card on the right. Wide screens (≥ 1100px): a column
//   beside the page, never over it; narrower it floats over the right side and
//   folds away; on Home under 700px it sits above the dashboard.
// - Guide closed: a pill at the bottom right, next to the support chat button.
// - The personalized Home (GuideDashboard): setup checklist, impact, feature
//   numbers, tips, plan and tutorials.
// - The spotlight dims the page with one box-shadow and never takes clicks
//   (pointer-events: none), so the page stays usable; the panel sits above the dim.
export const GUIDE_PANEL_WIDTH = 352;

export const GUIDE_CSS = `
.brx-gs.has-panel{display:flex;align-items:flex-start}
.brx-gs.has-panel>.brx-gs-main{flex:1 1 auto;min-width:0}
.brx-gs-aside{flex:0 0 ${GUIDE_PANEL_WIDTH}px;width:${GUIDE_PANEL_WIDTH}px;position:sticky;top:0;height:100vh;box-sizing:border-box;padding:12px 12px 12px 0;z-index:10600;display:flex;align-items:flex-start}
.brx-gs-card{box-sizing:border-box;width:100%;max-height:100%;overflow:auto;overscroll-behavior:contain;background:#fff;border:1px solid #e3e3e3;border-radius:16px;box-shadow:0 8px 28px rgba(15,23,42,.12);display:flex;flex-direction:column;font-size:13px;line-height:1.45;color:#303030}
.brx-gs-hd{display:flex;align-items:center;gap:12px;padding:14px 12px 12px 16px;background:#f4f7fc;border-bottom:1px solid #e8ecf3;flex:none}
.brx-gs-hd-t{min-width:0;flex:1}
.brx-gs-body{display:flex;flex-direction:column;gap:14px;padding:14px 16px 16px}
.brx-gs-ic{width:36px;height:36px;border-radius:10px;background:#eef4ff;color:#1d4ed8;display:inline-flex;align-items:center;justify-content:center;flex:none}
.brx-gs-ic--round{border-radius:50%;background:#fff;border:1.5px solid #c7d7f5}
.brx-gs-ic .Polaris-Icon{width:20px;height:20px;margin:0}
.brx-gs-kicker{font-size:12px;color:#616161;line-height:1.25}
.brx-gs-title{font-size:15px;font-weight:650;color:#111;line-height:1.3}
.brx-gs-iconbtn{width:30px;height:30px;border-radius:8px;border:0;background:transparent;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;color:#4a4a4a;flex:none}
.brx-gs-iconbtn:hover{background:rgba(0,0,0,.06)}
.brx-gs-iconbtn:focus-visible,.brx-gs-btn:focus-visible,.brx-gs-step:focus-visible,.brx-gs-link:focus-visible,.brx-gs-textlink:focus-visible,.brx-gs-seg:focus-visible,.brx-gs-pill:focus-visible,.brx-gs-embed-check:focus-visible{outline:2px solid #005bd3;outline-offset:2px}
.brx-gs-sub{font-size:12.5px;color:#616161;margin:2px 0 0}
.brx-gs-count{display:flex;justify-content:space-between;gap:8px;font-size:13px;color:#303030}
.brx-gs-bar{height:6px;border-radius:999px;background:#e8e8e8;overflow:hidden;margin-top:8px}
.brx-gs-bar>i{display:block;height:100%;background:#111;border-radius:inherit;transition:width .3s ease}
.brx-gs-segs{display:flex;gap:3px;padding:0 16px;margin-top:-1px;background:#f4f7fc;flex:none}
.brx-gs-seg{flex:1;height:3px;border-radius:999px;border:0;padding:0;margin:0 0 8px;background:#dde3ec;cursor:pointer}
.brx-gs-seg.is-done{background:#111}
.brx-gs-seg.is-current{background:#1d4ed8}
.brx-gs-seg.is-skipped{background:#c9c9c9}
.brx-gs-embed{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#fff1f1;border:1px solid #f6caca;border-radius:12px;padding:10px 12px;font-size:12.5px;color:#4a1d1d}
.brx-gs-embed-t{flex:1 1 150px;min-width:0}
.brx-gs-embed-link{display:block;color:#005bd3;margin-top:2px}
.brx-gs-embed-off{background:#fecaca;color:#991b1b;font-weight:700;font-size:11.5px;border-radius:999px;padding:2px 8px}
.brx-gs-embed-check{background:none;border:0;padding:0;color:#005bd3;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;text-align:left}
.brx-gs-embed-check:disabled{color:#8a8a8a;cursor:default}
.brx-gs-steps{display:flex;flex-direction:column;gap:8px;list-style:none;margin:0;padding:0}
.brx-gs-step{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;text-align:left;background:#fff;border:1px solid #e3e3e3;border-radius:10px;padding:10px 12px;cursor:pointer;font:inherit;font-size:13px;color:#303030}
.brx-gs-step:hover{border-color:#bdbdbd}
.brx-gs-step.is-current{border:1.5px solid #111;padding:9.5px 11.5px;font-weight:600;color:#111}
.brx-gs-num{width:24px;height:24px;border-radius:50%;border:1px solid #d4d4d4;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex:none;color:#303030;background:#fff;box-sizing:border-box}
.brx-gs-step.is-done .brx-gs-num{background:#111;border-color:#111;color:#fff}
.brx-gs-num .Polaris-Icon{width:14px;height:14px;margin:0}
.brx-gs-step-t{flex:1;min-width:0}
.brx-gs-video{display:flex;align-items:center;gap:12px;background:#f6f6f7;border-radius:12px;padding:12px}
.brx-gs-play{width:36px;height:36px;border-radius:50%;background:#111;color:#fff;display:inline-flex;align-items:center;justify-content:center;flex:none}
.brx-gs-play .Polaris-Icon{width:16px;height:16px;margin:0}
.brx-gs-video-t{flex:1;min-width:0}
.brx-gs-video-t b{display:block;color:#111;font-size:13px}
.brx-gs-video-t span{color:#616161;font-size:12px}
.brx-gs-row{display:flex;align-items:center;gap:8px}
.brx-gs-row--split{justify-content:space-between;flex-wrap:wrap}
.brx-gs-btn{border:1px solid #d4d4d4;background:#fff;border-radius:8px;padding:7px 14px;font:inherit;font-weight:600;font-size:13px;color:#111;cursor:pointer;line-height:1.3}
.brx-gs-btn:hover{background:#f6f6f6}
.brx-gs-btn--primary{background:#111;border-color:#111;color:#fff}
.brx-gs-btn--primary:hover{background:#2b2b2b}
.brx-gs-btn--wide{flex:1}
.brx-gs-btn:disabled{opacity:.45;cursor:default}
.brx-gs-link{background:none;border:0;padding:0;color:#005bd3;font:inherit;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;align-self:flex-start}
.brx-gs-link .Polaris-Icon{width:16px;height:16px;margin:0}
.brx-gs-textlink{background:none;border:0;padding:0;color:#616161;font:inherit;font-size:12.5px;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.brx-gs-textlink:hover{color:#111}
.brx-gs-radio{width:18px;height:18px;border-radius:50%;border:1.5px solid #c9c9c9;flex:none;box-sizing:border-box}
.is-on>.brx-gs-radio{border:5px solid #111}
.brx-gs-cic{width:32px;height:32px;border-radius:8px;background:#f3f3f3;display:inline-flex;align-items:center;justify-content:center;flex:none;color:#303030}
.brx-gs-cic .Polaris-Icon{width:18px;height:18px;margin:0}
.brx-gs-check{width:18px;height:18px;border-radius:5px;border:1.5px solid #c9c9c9;background:#fff;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;color:#fff}
.is-on>.brx-gs-check{background:#111;border-color:#111}
.brx-gs-check .Polaris-Icon{width:14px;height:14px;margin:0}
.brx-gs-badges{display:flex;gap:6px;flex-wrap:wrap}
.brx-gs-badge{font-size:11.5px;font-weight:600;border-radius:999px;padding:2px 8px;background:#f1f1f1;color:#4a4a4a;white-space:nowrap}
.brx-gs-badge.is-ok{background:#dcfce7;color:#166534}
.brx-gs-badge.is-info{background:#e0f2fe;color:#075985}
.brx-gs-badge.is-done{background:#111;color:#fff}
.brx-gs-badge.is-progress{background:#fef9c3;color:#713f12}
.brx-gs-note{border-radius:10px;padding:10px 12px;font-size:12.5px;line-height:1.45;background:#f6f6f7;color:#303030}
.brx-gs-note.is-warn{background:#fff7ed;color:#7c2d12;border:1px solid #fed7aa}
.brx-gs-note.is-ok{background:#f0fdf4;color:#14532d;border:1px solid #bbf7d0}
.brx-gs-note .brx-gs-row{margin-top:8px}
.brx-gs-mods{display:flex;flex-direction:column;gap:8px;list-style:none;margin:0;padding:0}
.brx-gs-mod{display:flex;align-items:center;gap:10px}
.brx-gs-mod-t{display:block;font-weight:600;color:#111;margin-bottom:2px}
.brx-gs-spin{width:14px;height:14px;border-radius:50%;border:2px solid #d4d4d4;border-top-color:#111;display:inline-block;animation:brx-gs-spin .8s linear infinite;vertical-align:-2px;margin-right:6px}
@keyframes brx-gs-spin{to{transform:rotate(360deg)}}
.brx-gs-pill{position:fixed;right:84px;bottom:calc(var(--brix-sidekick-space,80px) + 6px);z-index:10600;display:inline-flex;align-items:center;gap:8px;background:#111;color:#fff;border:0;border-radius:999px;padding:9px 12px 9px 9px;font:inherit;font-size:13px;font-weight:600;line-height:1.2;box-shadow:0 8px 24px rgba(15,23,42,.25);cursor:pointer}
.brx-gs-pill:hover{background:#2b2b2b}
.brx-gs-pill .Polaris-Icon{width:16px;height:16px;margin:0}
.brx-gs-pill-ic{width:22px;height:22px;border-radius:50%;border:1.5px solid rgba(255,255,255,.7);display:inline-flex;align-items:center;justify-content:center}
.brx-gs-pill-ic .Polaris-Icon{width:13px;height:13px}
.brx-gs-ring{position:fixed;z-index:10500;pointer-events:none;border-radius:12px;box-shadow:0 0 0 2px #fff,0 0 0 4px #111,0 0 0 9999px rgba(15,23,42,.34);transition:top .2s ease,left .2s ease,width .2s ease,height .2s ease}
.brx-gs-tip{position:fixed;z-index:10550;width:300px;box-sizing:border-box;background:#fff;color:#303030;border-radius:12px;box-shadow:0 14px 36px rgba(15,23,42,.3);padding:14px;font-size:13px;line-height:1.45}
.brx-gs-tip-k{display:flex;align-items:center;justify-content:space-between;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#616161}
.brx-gs-tip-k .brx-gs-iconbtn{width:24px;height:24px;margin:-4px -6px -4px 0}
.brx-gs-tip-t{font-size:14px;font-weight:650;color:#111;margin:4px 0 4px}
.brx-gs-tip-a{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.brx-gq-back{position:fixed;inset:0;z-index:10700;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}
.brx-gq-modal{box-sizing:border-box;width:min(1000px,100%);max-height:calc(100vh - 48px);overflow:auto;background:#fff;border-radius:18px;box-shadow:0 24px 60px rgba(15,23,42,.35);padding:22px 28px 20px;display:flex;flex-direction:column;gap:16px;font-size:13px;color:#303030;outline:none}
.brx-gq-head{display:flex;align-items:center;gap:10px}
.brx-gq-logo{width:30px;height:30px;border-radius:8px;background:#111;color:#fff;display:inline-flex;align-items:center;justify-content:center;flex:none}
.brx-gq-logo .Polaris-Icon{width:18px;height:18px;margin:0}
.brx-gq-brand{font-size:14px;font-weight:650;color:#111;flex:1;min-width:0}
.brx-gq-count{font-size:13px;color:#4a4a4a;white-space:nowrap}
.brx-gq-progress{height:6px;border-radius:999px;background:#e8e8e8;overflow:hidden}
.brx-gq-progress>i{display:block;height:100%;background:#303030;border-radius:inherit;transition:width .3s ease}
.brx-gq-q h2{margin:4px 0 0;font-size:26px;line-height:1.25;font-weight:700;color:#111}
.brx-gq-q p{margin:6px 0 0;font-size:13.5px;color:#4a4a4a}
.brx-gq-pay{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.brx-gq-feats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.brx-gq-opt{position:relative;display:flex;align-items:flex-start;gap:12px;box-sizing:border-box;text-align:left;padding:14px 40px 14px 14px;border:1px solid #e3e3e3;border-radius:14px;background:#fff;cursor:pointer;font:inherit;color:#303030;min-height:92px}
.brx-gq-opt:hover{border-color:#bdbdbd}
.brx-gq-opt.is-on{border:2px solid #111;padding:13px 39px 13px 13px;background:#f6f6f6}
.brx-gq-opt-ic{width:34px;height:34px;border-radius:9px;background:#f1f1f1;border:1px solid #e3e3e3;display:inline-flex;align-items:center;justify-content:center;color:#303030;flex:none;box-sizing:border-box}
.brx-gq-opt.is-on .brx-gq-opt-ic{background:#111;border-color:#111;color:#fff}
.brx-gq-opt-ic .Polaris-Icon{width:18px;height:18px;margin:0}
.brx-gq-opt-t{min-width:0}
.brx-gq-opt-t b{display:block;color:#111;font-size:14px;line-height:1.3}
.brx-gq-opt-t small{display:block;color:#4a4a4a;font-size:12.5px;line-height:1.4;margin-top:3px}
.brx-gq-tick{position:absolute;top:12px;right:12px;width:20px;height:20px;border-radius:50%;border:1.5px solid #c9c9c9;background:#fff;display:inline-flex;align-items:center;justify-content:center;color:#fff;box-sizing:border-box}
.brx-gq-opt.is-on .brx-gq-tick{background:#111;border-color:#111}
.brx-gq-tick .Polaris-Icon{width:14px;height:14px;margin:0}
.brx-gq-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid #ebebeb;padding-top:16px;margin-top:4px}
.brx-gq-skip{background:none;border:0;padding:6px 4px;font:inherit;font-size:13px;font-weight:600;color:#303030;cursor:pointer;display:inline-flex;align-items:center;gap:6px;border-radius:6px}
.brx-gq-skip:hover{background:#f3f3f3}
.brx-gq-skip .Polaris-Icon{width:16px;height:16px;margin:0}
.brx-gq-next{padding:9px 18px;border-radius:10px}
.brx-gq-modal:focus{outline:none}
.brx-gq-opt:focus-visible,.brx-gq-skip:focus-visible{outline:2px solid #005bd3;outline-offset:2px}
@media (max-width:900px){.brx-gq-feats{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:640px){.brx-gq-pay{grid-template-columns:minmax(0,1fr)}.brx-gq-opt{min-height:0}.brx-gq-modal{padding:18px 16px 16px}.brx-gq-back{padding:12px}.brx-gq-q h2{font-size:21px}}
@media (max-width:420px){.brx-gq-feats{grid-template-columns:minmax(0,1fr)}}
.brx-gd{display:flex;flex-direction:column;gap:16px}
.brx-gd-card{background:#fff;border:1px solid #e3e5e8;border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:12px;box-shadow:0 1px 2px rgba(15,23,42,.04);font-size:13px;color:#303030;min-width:0}
.brx-gd-head h2{margin:0;font-size:15px;font-weight:650;color:#111}
.brx-gd-head p{margin:2px 0 0;font-size:12.5px;color:#616161}
.brx-gd-head--icon{display:flex;align-items:center;gap:8px}
.brx-gd-ic{width:30px;height:30px;border-radius:8px;background:#f1f5ff;color:#1d4ed8;display:inline-flex;align-items:center;justify-content:center;flex:none}
.brx-gd-ic .Polaris-Icon{width:17px;height:17px;margin:0}
.brx-gd-ic--sm{width:20px;height:20px;border-radius:6px;margin-right:6px}
.brx-gd-ic--sm .Polaris-Icon{width:13px;height:13px}
.brx-gd-ic--tip{background:#fef9c3;color:#a16207}
.brx-gd-setup{padding:6px 18px;gap:0}
.brx-gd-row{border-bottom:1px solid #f0f0f0;padding:10px 0}
.brx-gd-row:last-child{border-bottom:0}
.brx-gd-row-head{display:flex;align-items:center;gap:12px}
.brx-gd-row-title{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:6px;background:none;border:0;padding:0;font:inherit;text-align:left;cursor:pointer;color:inherit}
.brx-gd-row-name{font-weight:650;color:#111;font-size:13.5px;display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap}
.brx-gd-first{font-size:11px;font-weight:700;background:#e0ecff;color:#1d4ed8;border-radius:999px;padding:2px 8px}
.brx-gd-row-bar{display:flex;align-items:center;gap:8px;width:min(260px,100%)}
.brx-gd-row-bar .brx-gs-bar{flex:1;margin:0}
.brx-gd-row-count{font-size:12px;color:#616161}
.brx-gd-steps{margin:10px 0 2px 42px}
.brx-gd-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.brx-gd-tiles--3{grid-template-columns:repeat(3,minmax(0,1fr))}
.brx-gd-tile{background:#f7f7f8;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:4px;min-width:0}
.brx-gd-tile b{font-size:22px;line-height:1.2;color:#111}
.brx-gd-tile small{font-size:12px;color:#616161}
.brx-gd-tile .brx-gs-bar{margin:4px 0 2px}
.brx-gd-tile-k{display:inline-flex;align-items:center;font-size:12.5px;color:#4a4a4a}
.brx-gd-tile-l{font-size:12.5px;color:#303030;font-weight:600}
.brx-gd-change{font-weight:600}
.brx-gd-change.is-good{color:#15803d}
.brx-gd-change.is-bad{color:#b91c1c}
.brx-gd-split{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:16px;align-items:start}
.brx-gd-tip{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:2px}
.brx-gd-tip b{color:#111;font-size:13px}
.brx-gd-tip span{color:#4a4a4a;font-size:12.5px}
.brx-gd-plan b{font-size:20px;color:#111}
.brx-gd-plan span{color:#616161;font-size:12.5px}
.brx-gd-muted{color:#616161;font-size:12.5px}
.brx-gd-tuts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.brx-gd-tut{border:1px solid #ebebeb;border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:6px;min-width:0}
.brx-gd-tut b{color:#111;font-size:13px}
.brx-gd-thumb{position:relative;height:110px;border-radius:9px;background:linear-gradient(180deg,#111 0 6px,#ececec 6px);display:flex;align-items:center;justify-content:center}
.brx-gd-thumb .brx-gs-play{background:#fff;color:#111;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.brx-gd-dur{position:absolute;right:8px;bottom:8px;background:#111;color:#fff;font-size:11px;font-weight:700;border-radius:5px;padding:1px 6px}
.brx-gd-tut-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;flex-wrap:wrap}
@media (max-width:900px){.brx-gd-split{grid-template-columns:minmax(0,1fr)}.brx-gd-tiles--3,.brx-gd-tuts{grid-template-columns:minmax(0,1fr)}}
@media (max-width:560px){.brx-gd-row-head{flex-wrap:wrap}.brx-gd-steps{margin-left:0}}
@media (prefers-reduced-motion:reduce){.brx-gs-ring,.brx-gs-bar>i{transition:none}.brx-gs-spin{animation:none}}
@media (max-width:1099px){
  .brx-gs.has-panel{display:block}
  .brx-gs-aside{position:fixed;top:8px;right:8px;width:min(${GUIDE_PANEL_WIDTH}px,calc(100vw - 16px));height:auto;max-height:calc(100vh - 16px);padding:0}
  .brx-gs-card{max-height:calc(100vh - 16px);box-shadow:0 14px 36px rgba(15,23,42,.24)}
}
@media (max-width:699px){
  .brx-gs.is-home.has-panel{display:flex;flex-direction:column;align-items:stretch}
  .brx-gs.is-home .brx-gs-aside{position:static;order:-1;width:auto;max-height:none;padding:12px 12px 0}
  .brx-gs.is-home .brx-gs-card{max-height:none;box-shadow:0 1px 3px rgba(15,23,42,.07)}
}
@media (max-width:480px){.brx-gs-pill{right:76px}}
`;
