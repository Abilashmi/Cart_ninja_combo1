/**
 * Lightweight CSS mock-up of each bundle layout, shown in the template chooser.
 * Self-contained (no image assets) so a preview always renders.
 */
export function TemplatePreviewThumb({ kind = 'steps', accent = '#1a9de0', compact = false }) {
  return (
    <div className={`tpt-wrap${compact ? ' tpt-compact' : ''}`} style={{ '--tpt-accent': accent }}>
      <style>{`
.tpt-wrap{height:280px;background:linear-gradient(180deg,#f7f8fb 0%,#eef1f6 100%);display:flex;align-items:center;justify-content:center;padding:22px}
.tpt-card{width:230px;background:#fff;border-radius:12px;box-shadow:0 10px 26px rgba(16,24,40,.12);padding:14px;display:flex;flex-direction:column;gap:10px}
.tpt-compact{height:200px;padding:18px}
.tpt-compact .tpt-card{width:190px;padding:12px;gap:9px;border-radius:10px;box-shadow:0 8px 20px rgba(16,24,40,.1)}
.tpt-compact .tpt-banner{height:30px}
.tpt-compact .tpt-hero{height:60px}
.tpt-compact .tpt-tile.h{height:30px}
.tpt-compact .tpt-tile.tall{height:40px}
.tpt-banner{height:34px;border-radius:7px;background:linear-gradient(110deg,var(--tpt-accent),#a855f7);opacity:.92}
.tpt-line{height:7px;border-radius:4px;background:#e7e9ee}
.tpt-line.sm{width:55%}
.tpt-steps{display:flex;align-items:center;gap:6px;margin:2px 0}
.tpt-dot{width:16px;height:16px;border-radius:50%;background:var(--tpt-accent);color:#fff;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center}
.tpt-dot.off{background:#d8dbe2;color:#fff}
.tpt-bar{flex:1;height:4px;border-radius:3px;background:#e2e4ea}
.tpt-tabs{display:flex;gap:6px}
.tpt-tab{height:16px;border-radius:9px;flex:1;background:#eceef3}
.tpt-tab.on{background:var(--tpt-accent)}
.tpt-grid{display:grid;gap:7px}
.tpt-grid.g3{grid-template-columns:repeat(3,1fr)}
.tpt-grid.g2{grid-template-columns:repeat(2,1fr)}
.tpt-tile{border-radius:7px;background:#f1f2f6;border:1px solid #e7e9ee}
.tpt-tile.h{height:34px}
.tpt-tile.tall{height:46px}
.tpt-hero{height:74px;border-radius:9px;background:linear-gradient(135deg,var(--tpt-accent),#c084fc);display:flex;align-items:flex-end;padding:8px}
.tpt-hero .tpt-pill{width:60px;height:12px;border-radius:6px;background:rgba(255,255,255,.85)}
.tpt-foot{display:flex;justify-content:space-between;align-items:center;margin-top:2px}
.tpt-btn{height:14px;width:70px;border-radius:7px;background:var(--tpt-accent)}
.tpt-price{height:8px;width:40px;border-radius:4px;background:#cfd3db}
      `}</style>
      <div className="tpt-card">
        {kind === 'steps' && (
          <>
            <div className="tpt-banner" />
            <div className="tpt-steps">
              <span className="tpt-dot">1</span>
              <span className="tpt-bar" />
              <span className="tpt-dot">2</span>
              <span className="tpt-bar" />
              <span className="tpt-dot off">3</span>
            </div>
            <div className="tpt-line sm" />
            <div className="tpt-grid g3">
              <div className="tpt-tile h" /><div className="tpt-tile h" /><div className="tpt-tile h" />
            </div>
            <div className="tpt-foot"><span className="tpt-price" /><span className="tpt-btn" /></div>
          </>
        )}
        {kind === 'tabs' && (
          <>
            <div className="tpt-banner" />
            <div className="tpt-tabs">
              <span className="tpt-tab on" /><span className="tpt-tab" /><span className="tpt-tab" /><span className="tpt-tab" />
            </div>
            <div className="tpt-grid g3">
              <div className="tpt-tile h" /><div className="tpt-tile h" /><div className="tpt-tile h" />
              <div className="tpt-tile h" /><div className="tpt-tile h" /><div className="tpt-tile h" />
            </div>
            <div className="tpt-foot"><span className="tpt-price" /><span className="tpt-btn" /></div>
          </>
        )}
        {kind === 'grid' && (
          <>
            <div className="tpt-hero"><span className="tpt-pill" /></div>
            <div className="tpt-grid g2">
              <div className="tpt-tile tall" /><div className="tpt-tile tall" />
              <div className="tpt-tile tall" /><div className="tpt-tile tall" />
            </div>
            <div className="tpt-foot"><span className="tpt-price" /><span className="tpt-btn" /></div>
          </>
        )}
      </div>
    </div>
  );
}
