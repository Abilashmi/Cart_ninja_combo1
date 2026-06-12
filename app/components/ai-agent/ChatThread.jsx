import { useRef, useEffect, useCallback } from "react";

const COPY_ICON = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="6" width="8" height="8" rx="1" />
    <path d="M2 10V3a1 1 0 011-1h7" />
  </svg>
);

const REGENERATE_ICON = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M1 4v4h4" />
    <path d="M15 12v-4h-4" />
    <path d="M13.06 4.94A7 7 0 002.13 7.5M2.87 11.06A7 7 0 0013.87 8.5" />
  </svg>
);

const ATTACH_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M8 3v8a2 2 0 004 0V4a4 4 0 00-8 0v8a6 6 0 0012 0V3" />
  </svg>
);

const CAMERA_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="3" width="14" height="11" rx="2" />
    <circle cx="8" cy="8" r="3" />
    <path d="M5 3l1-2h4l1 2" />
  </svg>
);

function formatText(text) {
  if (!text) return null;
  return text.split("\n").map((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return <br key={i} />;
    const parts = trimmed.split(/(\*\*[^*]+\*\*)/g);
    return (
      <span key={i}>
        {parts.map((part, j) => {
          if (part.startsWith("**") && part.endsWith("**")) {
            return <strong key={j}>{part.slice(2, -2)}</strong>;
          }
          if (part.startsWith("\u2022") || /^\d+\./.test(part)) {
            return <span key={j} style={{ display: "block", paddingLeft: 8 }}>{part}</span>;
          }
          return <span key={j}>{part}</span>;
        })}
      </span>
    );
  });
}

function ChatBubble({ message, onAction, onCopy, onRegenerate }) {
  const isUser = message.role === "user";
  const j = message.json;
  const displayText = j?.message || message.text || "";

  const hasActions = message.actions?.length > 0;
  const hasUndo = j?.status === "undo";

  if (hasUndo) {
    return (
      <div style={{ maxWidth: "85%", alignSelf: "flex-start" }}>
        <div style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid #FFD9A8", background: "#FFF8F0", fontSize: 13, color: "#8B5E3C" }}>
          {"\u21A9"} Undo successful
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "85%", alignSelf: isUser ? "flex-end" : "flex-start" }}>
      <div
        style={{
          padding: "12px 18px",
          borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
          background: isUser ? "linear-gradient(135deg, #FF6B00, #FF8A33)" : "#fff",
          color: isUser ? "#fff" : "#1A1A1A",
          border: isUser ? "none" : "1px solid #E8E8E8",
          borderLeft: isUser ? "none" : "3px solid #FF6B00",
          boxShadow: isUser ? "0 2px 8px rgba(255,107,0,.2)" : "0 1px 3px rgba(0,0,0,.06)",
          fontSize: 14,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          overflowWrap: "break-word",
        }}
      >
        {formatText(displayText)}
      </div>

      {hasActions && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {message.actions.map((act, i) => (
            <button
              key={i}
              onClick={() => onAction?.(act.action)}
              style={{
                padding: "7px 18px",
                borderRadius: 8,
                border: act.primary ? "none" : "1px solid #E8E8E8",
                background: act.primary ? "linear-gradient(135deg, #FF6B00, #FF8A33)" : "#fff",
                color: act.primary ? "#fff" : "#1A1A1A",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                transition: "all .15s",
                boxShadow: act.primary ? "0 2px 8px rgba(255,107,0,.2)" : "none",
              }}
            >
              {act.label}
            </button>
          ))}
        </div>
      )}

      {!isUser && !hasActions && (
        <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
          <button
            onClick={() => onCopy?.(displayText)}
            style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: "#999", display: "flex", alignItems: "center", justifyContent: "center" }}
            title="Copy"
          >
            {COPY_ICON}
          </button>
          <button
            onClick={onRegenerate}
            style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: "#999", display: "flex", alignItems: "center", justifyContent: "center" }}
            title="Regenerate"
          >
            {REGENERATE_ICON}
          </button>
        </div>
      )}
    </div>
  );
}

export default function ChatThread({
  messages,
  typing,
  onSend,
  suggestions,
  onSuggestionClick,
  onToggleHistory,
  showHistory,
  insight,
  onAskFollowUp,
  onAction,
  input,
  setInput,
  onCopy,
  onRegenerate,
}) {
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, typing]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput("");
  }, [input, onSend, setInput]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const showWelcome = messages.length === 0 && !typing;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", borderBottom: "1px solid #E8E8E8", flexShrink: 0 }}>
        <button
          onClick={onToggleHistory}
          style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #E8E8E8", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B6B6B" }}
          title="History"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2 4h12M2 8h12M2 12h12" /></svg>
        </button>
        <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#FFF3EB", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="#FF6B00" strokeWidth="1.5"><path d="M7 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" /></svg>
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#1A1A1A" }}>Cart Ninja AI</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#059669" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981", display: "inline-block" }} />
            Connected
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12, background: "#FAFAFA" }}>
        {showWelcome && suggestions.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 32px", textAlign: "center" }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg, #FF6B00, #FF8A33)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16, boxShadow: "0 4px 20px rgba(255,107,0,.2)" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l2 4 4 2-4 2-2 4-2-4-4-2 4-2 2-4z" />
              </svg>
            </div>
            <h3 style={{ fontSize: 22, fontWeight: 700, color: "#1A1A1A", margin: "0 0 8px" }}>Hi, I'm Cart Ninja AI</h3>
            <p style={{ fontSize: 14, color: "#6B6B6B", lineHeight: 1.7, margin: "0 0 24px", maxWidth: 480 }}>
              I can help you configure your cart, increase sales, and optimize your store.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
              {suggestions.map((chip) => (
                <button
                  key={chip.id}
                  onClick={() => onSuggestionClick(chip.text)}
                  style={{
                    padding: "8px 18px", borderRadius: 20, border: "1px solid #E8E8E8",
                    background: "#fff", fontSize: 13, cursor: "pointer", color: "#1A1A1A",
                    transition: "all .15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#FF6B00"; e.currentTarget.style.color = "#FF6B00"; e.currentTarget.style.background = "#FFF3EB"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#E8E8E8"; e.currentTarget.style.color = "#1A1A1A"; e.currentTarget.style.background = "#fff"; }}
                >
                  {chip.text}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <ChatBubble
            key={msg.id}
            message={msg}
            onAction={onAction}
            onCopy={onCopy}
            onRegenerate={onRegenerate}
          />
        ))}

        {typing && (
          <div style={{ maxWidth: "85%", alignSelf: "flex-start" }}>
            <div style={{ padding: "14px 18px", borderRadius: "18px 18px 18px 4px", border: "1px solid #E8E8E8", borderLeft: "3px solid #FF6B00", background: "#fff" }}>
              <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#999", animation: "aiDotBounce 1.2s ease-in-out infinite" }} />
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#999", animation: "aiDotBounce 1.2s ease-in-out infinite", animationDelay: ".2s" }} />
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#999", animation: "aiDotBounce 1.2s ease-in-out infinite", animationDelay: ".4s" }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, padding: "12px 20px", borderTop: "1px solid #E8E8E8", flexShrink: 0, background: "#fff" }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe what you want to do..."
          rows={1}
          style={{
            flex: 1, minHeight: 44, maxHeight: 120, padding: "10px 14px",
            border: "1px solid #E8E8E8", borderRadius: 12, fontSize: 14,
            outline: "none", boxSizing: "border-box", background: "#FAFAFA",
            color: "#1A1A1A", resize: "none", lineHeight: 1.5, fontFamily: "inherit",
          }}
          onFocus={(e) => { e.target.style.borderColor = "#FF6B00"; e.target.style.boxShadow = "0 0 0 3px rgba(255,107,0,.2)"; }}
          onBlur={(e) => { e.target.style.borderColor = "#E8E8E8"; e.target.style.boxShadow = "none"; }}
        />
        <div style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "flex-end" }}>
          <button style={{ width: 36, height: 36, borderRadius: 10, border: "1px solid #E8E8E8", background: "#fff", cursor: "pointer", color: "#999", display: "flex", alignItems: "center", justifyContent: "center" }} title="Attach file">{ATTACH_ICON}</button>
          <button style={{ width: 36, height: 36, borderRadius: 10, border: "1px solid #E8E8E8", background: "#fff", cursor: "pointer", color: "#999", display: "flex", alignItems: "center", justifyContent: "center" }} title="Take screenshot">{CAMERA_ICON}</button>
        </div>
        <button
          onClick={handleSend}
          disabled={!input.trim() || typing}
          style={{
            width: 44, height: 44, borderRadius: 12, border: "none",
            background: !input.trim() || typing ? "linear-gradient(135deg, #FFD4B3, #FFE0CC)" : "linear-gradient(135deg, #FF6B00, #FF8A33)",
            color: !input.trim() || typing ? "#999" : "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: !input.trim() || typing ? "default" : "pointer",
            flexShrink: 0, transition: "transform .15s",
          }}
          aria-label="Send"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M2 8l12-4-4 8-3-3-3-3z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
