export default function AIChangesSummary({ actions, results, onUndo, message, synced }) {
  const hasErrors = results?.some((r) => r.status === "error");
  const allDone = results?.every((r) => r.status === "executed");
  const statusText = allDone ? (synced !== false ? 'Applied' : 'Applied (offline)') : hasErrors ? 'Issues found' : 'Processing';

  return (
    <div className="aif-action-summary">
      <div className={"aif-as-bar" + (allDone && synced !== false ? " aif-as-bar--ok" : "") + (hasErrors ? " aif-as-bar--err" : "")}>
        <div className="aif-as-status-text">
          <span className="aif-as-status-label">{statusText}</span>
          {allDone && synced === false && <span className="aif-as-status-msg">Saved locally, will sync to server</span>}
          {message && <span className="aif-as-status-msg">{message}</span>}
        </div>
      </div>

      <div className="aif-as-items">
        {actions.map((a, i) => {
          const moduleLabel = a.label || (a.module || a.type || "")
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, (s) => s.toUpperCase())
            .trim();
          const actionLabel = a.action
            ? a.action.charAt(0).toUpperCase() + a.action.slice(1)
            : (a.type || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
          const result = results?.[i];
          const isDone = result?.status === "executed";
          const isError = result?.status === "error";

          return (
            <div key={i} className={"aif-as-item" + (isDone ? " aif-as-item--done" : "") + (isError ? " aif-as-item--err" : "")}>
              <div className="aif-as-item-body">
                <div className="aif-as-item-top">
                  <span className="aif-as-item-name">{moduleLabel}</span>
                  <span className={"aif-as-item-badge" + (isDone ? " aif-as-item-badge--done" : "") + (isError ? " aif-as-item-badge--err" : "")}>
                    {actionLabel}
                  </span>
                </div>
                {result?.impact && <div className="aif-as-impact">{result.impact}</div>}
                {a.settings && (
                  <div className="aif-as-item-settings">
                    {Object.entries(a.settings)
                      .filter(([k, v]) => k !== "enabled" && v !== undefined && v !== null)
                      .map(([k, v]) => (
                        <span key={k} className="aif-as-tag">{k}: {String(v)}</span>
                      ))}
                  </div>
                )}
              </div>
              {onUndo && a.action !== "delete" && a.action !== "disable_cart_drawer" && (
                <button className="aif-as-undo" onClick={() => onUndo(a)} title="Undo">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M4 8h8M4 8l3-3M4 8l3 3" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
