import { useState, useMemo } from "react";
import { getTimeGroup } from "./AiAgent";

export default function HistorySidebar({
  open, conversations, activeId, onSelect, onClose, onNew, onRename, onDelete, onPin, onArchive,
}) {
  const [search, setSearch] = useState("");

  const grouped = useMemo(() => {
    const filtered = search.trim()
      ? conversations.filter((c) => c.title.toLowerCase().includes(search.toLowerCase()))
      : conversations;
    const pinned = filtered.filter((c) => c.pinned && !c.archived);
    const others = filtered.filter((c) => !c.pinned && !c.archived);
    return {
      pinned,
      today: others.filter((c) => getTimeGroup(c.ts) === "Today"),
      yesterday: others.filter((c) => getTimeGroup(c.ts) === "Yesterday"),
      last7: others.filter((c) => getTimeGroup(c.ts) === "Last 7 Days"),
      last30: others.filter((c) => getTimeGroup(c.ts) === "Last 30 Days"),
      older: others.filter((c) => getTimeGroup(c.ts) === "Older"),
    };
  }, [conversations, search]);

  return (
    <div className={`ai-history${open ? "" : " ai-history--collapsed"}`}>
      <div className="ai-history-inner">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px", borderBottom: "1px solid var(--p-color-border)" }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>History</span>
          <div style={{ display: "flex", gap: 4 }}>
            {onNew && (
              <button
                onClick={onNew}
                style={{ width: 32, height: 32, borderRadius: 6, border: "1px solid var(--p-color-border)", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                title="New chat"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 2v8M2 6h8" /></svg>
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                style={{ width: 32, height: 32, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                title="Close"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 4l8 8M12 4l-8 8" /></svg>
              </button>
            )}
          </div>
        </div>
        <div style={{ padding: "10px 12px" }}>
          <input
            type="text"
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%", height: 36, padding: "0 12px", border: "1px solid var(--p-color-border)",
              borderRadius: 6, fontSize: 13, outline: "none", boxSizing: "border-box",
            }}
            onFocus={(e) => e.target.style.borderColor = "#FF6B00"}
            onBlur={(e) => e.target.style.borderColor = "var(--p-color-border)"}
          />
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {conversations.length === 0 && (
            <div style={{ padding: "24px 16px", textAlign: "center", color: "#999", fontSize: 13 }}>
              No conversations yet
            </div>
          )}

          {grouped.pinned.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: "0.5px", padding: "10px 16px 4px" }}>Pinned</div>
              {grouped.pinned.map((c) => (
                <ConversationItem key={c.id} conv={c} active={c.id === activeId} onSelect={onSelect} onRename={onRename} onDelete={onDelete} onPin={onPin} onArchive={onArchive} />
              ))}
            </>
          )}
          {grouped.today.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: "0.5px", padding: "10px 16px 4px" }}>Today</div>
              {grouped.today.map((c) => (
                <ConversationItem key={c.id} conv={c} active={c.id === activeId} onSelect={onSelect} onRename={onRename} onDelete={onDelete} onPin={onPin} onArchive={onArchive} />
              ))}
            </>
          )}
          {grouped.yesterday.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: "0.5px", padding: "10px 16px 4px" }}>Yesterday</div>
              {grouped.yesterday.map((c) => (
                <ConversationItem key={c.id} conv={c} active={c.id === activeId} onSelect={onSelect} onRename={onRename} onDelete={onDelete} onPin={onPin} onArchive={onArchive} />
              ))}
            </>
          )}
          {grouped.last7.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: "0.5px", padding: "10px 16px 4px" }}>Last 7 Days</div>
              {grouped.last7.map((c) => (
                <ConversationItem key={c.id} conv={c} active={c.id === activeId} onSelect={onSelect} onRename={onRename} onDelete={onDelete} onPin={onPin} onArchive={onArchive} />
              ))}
            </>
          )}
          {grouped.last30.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: "0.5px", padding: "10px 16px 4px" }}>Last 30 Days</div>
              {grouped.last30.map((c) => (
                <ConversationItem key={c.id} conv={c} active={c.id === activeId} onSelect={onSelect} onRename={onRename} onDelete={onDelete} onPin={onPin} onArchive={onArchive} />
              ))}
            </>
          )}
          {grouped.older.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: "0.5px", padding: "10px 16px 4px" }}>Older</div>
              {grouped.older.map((c) => (
                <ConversationItem key={c.id} conv={c} active={c.id === activeId} onSelect={onSelect} onRename={onRename} onDelete={onDelete} onPin={onPin} onArchive={onArchive} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ConversationItem({ conv, active, onSelect, onRename, onDelete, onPin, onArchive }) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => onSelect(conv.id)}
        style={{
          display: "block", width: "100%", textAlign: "left",
          background: active ? "var(--p-color-bg-surface-secondary)" : "transparent",
          border: "none", borderRadius: 6, padding: "9px 16px", cursor: "pointer",
          fontSize: 13, color: "var(--p-color-text)",
          transition: "background .1s",
          borderLeft: active ? "3px solid #FF6B00" : "3px solid transparent",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
          {conv.title}
        </span>
      </button>
      {active && (
        <button
          onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
          style={{
            position: "absolute", right: 8, top: 8, width: 24, height: 24, borderRadius: 4,
            border: "none", background: "transparent", cursor: "pointer", display: "flex",
            alignItems: "center", justifyContent: "center", color: "#999",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="7" cy="7" r="1" fill="currentColor"/><circle cx="7" cy="3.5" r="1" fill="currentColor"/><circle cx="7" cy="10.5" r="1" fill="currentColor"/>
          </svg>
        </button>
      )}
      {showMenu && (
        <div style={{
          position: "absolute", right: 8, top: 34, background: "#fff", border: "1px solid #E8E8E8",
          borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,.12)", zIndex: 100, minWidth: 140,
          overflow: "hidden",
        }}>
          {["Rename", "Pin", "Archive", "Delete"].map((action) => (
            <button
              key={action}
              onClick={() => {
                setShowMenu(false);
                if (action === "Rename" && onRename) onRename(conv.id);
                if (action === "Pin" && onPin) onPin(conv.id);
                if (action === "Archive" && onArchive) onArchive(conv.id);
                if (action === "Delete" && onDelete) onDelete(conv.id);
              }}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
                border: "none", background: "none", cursor: "pointer", fontSize: 13,
                color: action === "Delete" ? "#DC2626" : "#1a1a1a",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "#F5F5F5"}
              onMouseLeave={(e) => e.currentTarget.style.background = "none"}
            >
              {action === "Pin" ? (conv.pinned ? "Unpin" : "Pin") : action}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
