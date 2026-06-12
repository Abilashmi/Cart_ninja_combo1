import { QUICK_ACTIONS } from "./constants";

export default function QuickActionChips({ onSelect, disabled }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {QUICK_ACTIONS.map((item) => (
        <button
          key={item.label}
          disabled={disabled}
          onClick={() => onSelect(item.prompt)}
          style={{
            padding: "8px 18px",
            borderRadius: 20,
            border: "1px solid var(--aiborder, #E8E8E8)",
            background: "var(--aisurface, #fff)",
            color: "var(--aitext, #1A1A1A)",
            fontSize: 13,
            cursor: "pointer",
            transition: "all .15s",
            fontWeight: 450,
            opacity: disabled ? 0.5 : 1,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "#FF6B00";
            e.currentTarget.style.color = "#FF6B00";
            e.currentTarget.style.background = "#FFF3EB";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--aiborder, #E8E8E8)";
            e.currentTarget.style.color = "var(--aitext, #1A1A1A)";
            e.currentTarget.style.background = "var(--aisurface, #fff)";
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
