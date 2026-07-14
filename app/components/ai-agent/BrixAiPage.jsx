import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "react-router";
import useAiAgent from "./useAiAgent";
import MarkdownMessage from "./MarkdownMessage";

const HISTORY_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </svg>
);

const CLOSE_ICON = (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M2 2l10 10M12 2L2 12" />
  </svg>
);

function relativeDate(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
  if (diff < 604800000) return Math.floor(diff / 86400000) + "d ago";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function MessageRow({ msg, onChoice, loading }) {
  const isUser = msg.role === "user";
  if (isUser) {
    return (
      <div className="bai-row bai-row-user">
        <div className="bai-bubble-user">{msg.text}</div>
      </div>
    );
  }

  const j = msg.json;
  const choices = j?.choices;
  // Plain conversational bubble only — no action/status card, no feature
  // badges, no divider, no timestamp/evidence metadata below the message.
  // Execution details (j.actions, j.evidence) stay in state for anyone
  // debugging via devtools, but are never rendered.
  const raw = j?.message || msg.text || "";
  const bodyText = raw.replace(/^\s*[✓✅]\s*/, "");
  const card = (
    <div className="bai-card">
      <MarkdownMessage text={bodyText} variant="bai-md" />
    </div>
  );

  return (
    <div className="bai-row bai-row-agent">
      <div className="bai-agent-stack">
        {card}
        {choices?.length > 0 && (
          <div className="bai-choices">
            {choices.map((c, i) => (
              <button
                key={i}
                type="button"
                className={`bai-choice-btn${c.value === "__confirm__" ? " confirm" : c.value === "__cancel__" ? " cancel" : ""}`}
                onClick={() => onChoice?.(c.value)}
                disabled={!!loading}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const QUICK_CHIPS = [
  "Enable Cart Drawer",
  "Add Free Shipping Goal",
  "Add Upsells",
  "Apply Premium Dark Theme",
  "Analyze my store",
  "Create a campaign",
  "Diagnose low conversions",
  "Optimize for mobile",
];

export default function BrixAiPage() {
  const location = useLocation();
  const {
    messages, loading, sendMessage, setMessages, setActiveConvId,
    conversations, selectConversation, credits,
  } = useAiAgent(location);

  const [input, setInput] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const histListRef = useRef(null);

  const hasThread = messages.length > 0 || !!loading;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  // The list keeps whatever scroll position it was left at (a native DOM
  // property, not React state) — without this, reopening history after
  // scrolling down previously shows stale mid-list entries instead of the
  // newest conversations at the top.
  useEffect(() => {
    if (showHistory && histListRef.current) histListRef.current.scrollTop = 0;
  }, [showHistory]);

  const handleSend = useCallback((text) => {
    const t = (text ?? input).trim();
    if (!t || loading) return;
    setShowHistory(false);
    setInput("");
    sendMessage(t);
  }, [input, loading, sendMessage]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const handleNewChat = useCallback(() => {
    setMessages([]); setActiveConvId(null); setShowHistory(false); setInput("");
  }, [setMessages, setActiveConvId]);

  const handleSelectConv = useCallback((convId) => {
    selectConversation(convId); setShowHistory(false);
  }, [selectConversation]);

  return (
    <>
      <style>{`
        .bai-page{display:flex;flex-direction:column;height:100%;background:#fff;overflow:hidden;position:relative}
        .bai-header{display:flex;align-items:center;gap:8px;padding:14px 24px;border-bottom:1px solid #e1e3e5;flex-shrink:0;z-index:2;background:#fff}
        .bai-header-icon{width:22px;height:22px;border-radius:6px;background:#1a1a1a;display:flex;align-items:center;justify-content:center}
        .bai-header-title{font-size:15px;font-weight:700;color:#1a1a1a}
        .bai-header-credits{margin-left:auto;display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:#1a9de0;background:#e8f9ff;border:1px solid #d4f1fe;border-radius:999px;padding:3px 10px}
        .bai-header-new{background:none;border:1px solid #e1e3e5;border-radius:8px;padding:5px 14px;font-size:12px;font-weight:600;color:#374151;cursor:pointer;transition:background .12s,border-color .12s}
        .bai-header-new:hover{background:#f3f4f6;border-color:#d1d5db}
        .bai-body{flex:1;display:flex;flex-direction:column;overflow:hidden;position:relative}
        .bai-msgs-wrap{flex:1;overflow-y:auto;min-height:0;opacity:0;pointer-events:none;transition:opacity .35s ease}
        .bai-msgs-wrap.visible{opacity:1;pointer-events:auto}
        .bai-msgs-wrap::-webkit-scrollbar{width:4px}
        .bai-msgs-wrap::-webkit-scrollbar-thumb{background:#e1e3e5;border-radius:2px}
        .bai-msgs-inner{max-width:720px;margin:0 auto;padding:28px 24px 16px;display:flex;flex-direction:column;gap:16px}
        .bai-input-zone{flex-shrink:0;padding:0 24px 20px;background:#fff;position:relative;transform:translateY(-10vh);transition:transform .48s cubic-bezier(0.22,1,0.36,1);z-index:1}
        .bai-input-zone.active{transform:translateY(0)}
        .bai-welcome-compact{text-align:center;padding:0 0 28px;overflow:hidden;transition:max-height .35s ease,opacity .25s ease,padding .35s ease;max-height:200px}
        .bai-welcome-compact.hidden{max-height:0;opacity:0;padding-bottom:0;pointer-events:none}
        .bai-welcome-compact .bai-wc-icon{width:52px;height:52px;border-radius:14px;background:#1a1a1a;display:flex;align-items:center;justify-content:center;margin:0 auto 16px}
        .bai-welcome-compact h2{font-size:28px;font-weight:800;letter-spacing:-.3px;color:#1a1a1a;margin:0 0 8px}
        .bai-welcome-compact p{font-size:14px;color:#6b7280;line-height:1.6;margin:0}
        .bai-input-inner{max-width:720px;margin:0 auto;position:relative}
        .bai-bar{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #e1e3e5;border-radius:9999px;padding:8px 8px 8px 22px;box-shadow:0 2px 14px rgba(0,0,0,.07);transition:border-color .15s,box-shadow .15s}
        .bai-bar:focus-within{border-color:#9ca3af;box-shadow:0 2px 20px rgba(0,0,0,.11)}
        .bai-search-icon{flex-shrink:0}
        .bai-input{flex:1;background:transparent;border:none;outline:none;color:#1a1a1a;font-size:15px;font-family:inherit;padding:8px 0;min-width:0;resize:none;line-height:1.4;max-height:120px;overflow-y:auto}
        .bai-input::placeholder{color:#9ca3af}
        .bai-hist-btn{background:none;border:none;cursor:pointer;padding:4px 6px;color:#9ca3af;border-radius:6px;display:flex;align-items:center;flex-shrink:0;transition:color .15s,background .15s}
        .bai-hist-btn:hover{color:#374151;background:rgba(0,0,0,.05)}
        .bai-hist-btn.active{color:#1a1a1a}
        .bai-send{background:#1a1a1a;color:#fff;border:none;border-radius:9999px;cursor:pointer;font-weight:700;display:flex;align-items:center;justify-content:center;gap:6px;padding:10px 20px;font-size:14px;white-space:nowrap;transition:opacity .15s,transform .15s;flex-shrink:0}
        .bai-send:hover:not(:disabled){opacity:.85;transform:scale(1.03)}
        .bai-send:disabled{opacity:.35;cursor:default}
        .bai-hint{text-align:center;font-size:11px;color:#c4c4c4;margin-top:9px;transition:opacity .25s ease}
        .bai-hint.hidden{opacity:0}
        .bai-chips-row{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:600px;margin:16px auto 0;overflow:hidden;transition:max-height .35s ease,opacity .25s ease,margin .35s ease;max-height:120px}
        .bai-chips-row.hidden{max-height:0;opacity:0;margin-top:0;pointer-events:none}
        .bai-chip{padding:7px 16px;border-radius:9999px;border:1px solid #e1e3e5;background:#fff;font-size:13px;color:#374151;cursor:pointer;transition:background .12s,border-color .12s,color .12s;white-space:nowrap}
        .bai-chip:hover{background:#f3f4f6;border-color:#9ca3af;color:#1a1a1a}
        .bai-row{display:flex}
        .bai-row-user{justify-content:flex-end}
        .bai-row-agent{justify-content:flex-start}
        .bai-bubble-user{max-width:80%;background:#1a1a1a;color:#fff;padding:10px 16px;border-radius:18px 18px 4px 18px;font-size:14px;line-height:1.55;word-wrap:break-word;animation:baiSlideIn .18s ease}
        .bai-agent-stack{display:flex;flex-direction:column;align-items:flex-start;gap:8px;max-width:85%}
        .bai-card{background:#f9fafb;border:1px solid #e8e8e8;border-radius:4px 18px 18px 18px;padding:12px 16px;font-size:14px;line-height:1.55;color:#1a1a1a;animation:baiSlideIn .18s ease}
        .bai-choices{display:flex;flex-wrap:wrap;gap:8px}
        .bai-choice-btn{background:#fff;border:1px solid #d1d5db;border-radius:9999px;padding:7px 16px;font-size:13px;font-weight:600;color:#1a1a1a;cursor:pointer;transition:background .12s,border-color .12s,opacity .12s}
        .bai-choice-btn:hover:not(:disabled){background:#f3f4f6;border-color:#9ca3af}
        .bai-choice-btn:disabled{opacity:.5;cursor:default}
        .bai-choice-btn.confirm{background:#1a1a1a;color:#fff;border-color:#1a1a1a}
        .bai-choice-btn.confirm:hover:not(:disabled){opacity:.85}
        .bai-choice-btn.cancel{color:#dc2626;border-color:#fecaca}
        .bai-choice-btn.cancel:hover:not(:disabled){background:#fef2f2}
        .bai-md p{margin:0 0 6px}
        .bai-md p:last-child{margin-bottom:0}
        .bai-md :is(h1,h2,h3,h4,h5,h6){font-size:14px;font-weight:700;margin:6px 0 4px;color:#1a1a1a}
        .bai-md ul,.bai-md ol{margin:4px 0 6px;padding-left:18px}
        .bai-md li{margin:2px 0}
        .bai-md strong{font-weight:700}
        .bai-md em{font-style:italic}
        .bai-md code{background:#eef0f2;border-radius:4px;padding:1px 5px;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
        .bai-md pre{background:#eef0f2;border-radius:8px;padding:8px 10px;overflow-x:auto;margin:6px 0}
        .bai-md pre code{background:none;padding:0}
        .bai-md blockquote{border-left:3px solid #d1d5db;margin:6px 0;padding:2px 0 2px 10px;color:#4b5563}
        .bai-md table{border-collapse:collapse;margin:6px 0;font-size:13px;width:100%}
        .bai-md th,.bai-md td{border:1px solid #e5e7eb;padding:4px 8px;text-align:left}
        .bai-md a{color:#1a73e8;text-decoration:underline}
        .bai-typing{display:flex;gap:5px;align-items:center;padding:12px 16px;background:#f9fafb;border:1px solid #e8e8e8;border-radius:4px 18px 18px 18px;max-width:80px}
        .bai-typing span{width:7px;height:7px;border-radius:50%;background:#9ca3af;animation:baiDot 1.2s ease-in-out infinite}
        .bai-typing span:nth-child(2){animation-delay:.2s}
        .bai-typing span:nth-child(3){animation-delay:.4s}
        @keyframes baiDot{0%,80%,100%{transform:scale(.7);opacity:.4}40%{transform:scale(1);opacity:1}}
        @keyframes baiSlideIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .bai-hist-panel{position:absolute;bottom:calc(100% + 10px);left:0;right:0;background:#fff;border:1px solid #e1e3e5;border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.09);animation:baiPanelIn .18s ease;z-index:100;display:flex;flex-direction:column;max-height:min(400px, calc(100vh - 120px))}
        @keyframes baiPanelIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
        .bai-hist-head{display:flex;align-items:center;gap:6px;padding:10px 14px;border-bottom:1px solid #f0f0f0;flex-shrink:0}
        .bai-hist-head-icon{width:20px;height:20px;border-radius:5px;background:#1a1a1a;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .bai-hist-head-title{font-size:12px;font-weight:600;color:#1a1a1a}
        .bai-hist-new{background:none;border:none;cursor:pointer;font-size:11px;color:#374151;font-weight:600;padding:3px 6px;border-radius:5px;margin-left:auto}
        .bai-hist-new:hover{background:#f3f4f6}
        .bai-hist-close{background:none;border:none;cursor:pointer;padding:4px;color:#6b7280;border-radius:4px;display:flex;align-items:center}
        .bai-hist-close:hover{background:#f3f4f6;color:#1a1a1a}
        .bai-hist-list{flex:1;min-height:0;max-height:260px;overflow-y:auto;padding:6px;display:flex;flex-direction:column;gap:2px}
        .bai-hist-empty{padding:20px 14px;text-align:center;font-size:12px;color:#9ca3af}
        .bai-hist-item{display:flex;align-items:center;justify-content:space-between;width:100%;background:none;border:none;cursor:pointer;padding:9px 10px;border-radius:8px;text-align:left;transition:background .12s}
        .bai-hist-item:hover{background:#f3f4f6}
        .bai-hist-item-title{font-size:13px;color:#1a1a1a;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;margin-right:8px}
        .bai-hist-item-date{font-size:11px;color:#9ca3af;flex-shrink:0;white-space:nowrap}
      `}</style>

      <div className="bai-page">
        {/* Header */}
        <div className="bai-header">
          <div className="bai-header-icon">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="1.8">
              <path d="M7 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" />
            </svg>
          </div>
          <span className="bai-header-title">Brix AI</span>
          {credits && (
            <span
              className="bai-header-credits"
              title={credits.isOverage ? `Over your monthly cap — billed $${credits.overageRate?.toFixed(2)}/credit` : 'AI credits remaining'}
              style={credits.isOverage ? { color: '#b45309', background: '#fffbeb', borderColor: '#fde68a' } : undefined}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
              {credits.isOverage
                ? `Overage active — $${credits.overageRate?.toFixed(2)}/credit`
                : `${credits.remaining}/${credits.limit} credits left`}
            </span>
          )}
          {hasThread && (
            <button className="bai-header-new" onClick={handleNewChat}>New chat</button>
          )}
        </div>

        {/* Body */}
        <div className="bai-body">
          <div className={`bai-msgs-wrap${hasThread ? " visible" : ""}`} ref={scrollRef}>
            <div className="bai-msgs-inner">
              {messages.map((msg) => <MessageRow key={msg.id} msg={msg} onChoice={handleSend} loading={loading} />)}
              {loading && (
                <div className="bai-row bai-row-agent">
                  <div className="bai-typing"><span /><span /><span /></div>
                </div>
              )}
            </div>
          </div>

          <div className={`bai-input-zone${hasThread || showHistory ? " active" : ""}`}>
            <div className={`bai-welcome-compact${hasThread || showHistory ? " hidden" : ""}`}>
              <div className="bai-wc-icon">
                <svg width="24" height="24" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="1.6">
                  <path d="M7 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" />
                </svg>
              </div>
              <h2>Ask Brix</h2>
              <p>Your AI store assistant — describe what you want and Brix will set it up for you.</p>
            </div>

            <div className="bai-input-inner">
              {showHistory && (
                <div className="bai-hist-panel">
                  <div className="bai-hist-head">
                    <div className="bai-hist-head-icon">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
                        <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>
                      </svg>
                    </div>
                    <span className="bai-hist-head-title">History</span>
                    <button className="bai-hist-new" onClick={handleNewChat}>New chat</button>
                    <button className="bai-hist-close" onClick={() => setShowHistory(false)}>{CLOSE_ICON}</button>
                  </div>
                  <div className="bai-hist-list" ref={histListRef}>
                    {conversations.length === 0 ? (
                      <div className="bai-hist-empty">No previous chats yet</div>
                    ) : (
                      conversations.map((conv) => (
                        <button key={conv.id} className="bai-hist-item" onClick={() => handleSelectConv(conv.id)}>
                          <span className="bai-hist-item-title">{conv.title || "Untitled chat"}</span>
                          <span className="bai-hist-item-date">{relativeDate(conv.updatedAt || conv.createdAt)}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              <div className="bai-bar">
                <svg className="bai-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" />
                </svg>
                <textarea
                  ref={inputRef}
                  className="bai-input"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask Brix anything about your cart, upsells, or analytics…"
                  rows={1}
                />
                <button
                  className={`bai-hist-btn${showHistory ? " active" : ""}`}
                  onClick={() => setShowHistory((v) => !v)}
                  aria-label="Chat history"
                  title="Chat history"
                >
                  {HISTORY_ICON}
                </button>
                <button
                  className="bai-send"
                  onClick={() => handleSend()}
                  disabled={!input.trim() || !!loading}
                >
                  Ask Brix
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M2 8l12-4-4 8-3-3-3-3z" />
                  </svg>
                </button>
              </div>

              <p className={`bai-hint${hasThread ? " hidden" : ""}`}>
                Enter to send · Shift+Enter for new line
              </p>
            </div>

            <div className={`bai-chips-row${hasThread ? " hidden" : ""}`}>
              {QUICK_CHIPS.map((chip) => (
                <button key={chip} className="bai-chip" onClick={() => { setInput(chip); setTimeout(() => inputRef.current?.focus(), 0); }}>
                  {chip}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
