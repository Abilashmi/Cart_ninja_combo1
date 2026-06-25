export function BrowserTabStrip({ tabs = [], selected = 0, onSelect, accent = '#1a9de0', fitted = false }) {
  return (
    <div className={`ft-tabstrip${fitted ? ' ft-tabstrip--fitted' : ''}`} style={{ '--ft-accent': accent }} role="tablist">
      <style>{`
.ft-tabstrip{display:flex;align-items:flex-end;gap:4px;padding:0 4px;border-bottom:1px solid #e1e3e5;margin-bottom:16px}
.ft-tabstrip-tab{position:relative;top:1px;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:11px 18px;border:1px solid transparent;border-bottom:none;border-radius:10px 10px 0 0;
  font-size:13px;font-weight:600;color:#6d7175;background:transparent;cursor:pointer;font-family:inherit;white-space:nowrap;transition:background .15s ease,color .15s ease}
.ft-tabstrip-tab:hover{background:#f1f2f4;color:#1a1a1a}
.ft-tabstrip-tab.active{background:#fff;color:#1a1a1a;border-color:#e1e3e5;box-shadow:0 -2px 6px rgba(16,24,40,.04)}
.ft-tabstrip-tab.active::before{content:'';position:absolute;left:0;right:0;top:0;height:3px;border-radius:3px 3px 0 0;background:var(--ft-accent)}
.ft-tabstrip-tab.active::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:1px;background:#fff}
.ft-tabstrip--fitted{gap:6px}
.ft-tabstrip--fitted .ft-tabstrip-tab{flex:1 1 0}
      `}</style>
      {tabs.map((tab, i) => (
        <button
          key={tab.id || i}
          type="button"
          role="tab"
          aria-selected={selected === i}
          className={`ft-tabstrip-tab ${selected === i ? 'active' : ''}`}
          onClick={() => onSelect?.(i)}
        >
          {tab.content}
        </button>
      ))}
    </div>
  );
}
