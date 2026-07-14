import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router';
import useAiAgent from './useAiAgent';
import MarkdownMessage from './MarkdownMessage';

const SIZES = {
  lg: { maxWidth: '960px', inputFont: 17, padLeft: 28, btnText: true,  iconSize: 26, panelH: 380 },
  md: { maxWidth: '720px', inputFont: 14, padLeft: 18, btnText: true,  iconSize: 20, panelH: 300 },
  sm: { maxWidth: '100%',  inputFont: 13, padLeft: 14, btnText: false, iconSize: 17, panelH: 240 },
};

const HISTORY_ICON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
  </svg>
);

const CLOSE_ICON = (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M2 2l10 10M12 2L2 12" />
  </svg>
);

// Client-timed stage labels shown while a flow turn is in flight — no real
// server-side step signaling, just enough to visibly "think" before replying.
const THINKING_STAGES = ['Analyzing…', 'Preparing changes…', 'Waiting for confirmation…'];
function ThinkingLabel() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setStage(s => (s + 1) % THINKING_STAGES.length), 900);
    return () => clearInterval(interval);
  }, []);
  return <span className="bxb-loading-text">{THINKING_STAGES[stage]}</span>;
}

function relativeDate(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function BrixBar({
  size = 'md',
  center,
  floating = false,
  side = 'center',
  placeholder = 'Ask Brix anything about your cart, upsells, or analytics…',
  zIndex = 9998,
}) {
  const cfg = SIZES[size] || SIZES.md;
  const location = useLocation();
  const { messages, loading, sendMessage, setMessages, setActiveConvId, conversations, selectConversation, credits } = useAiAgent(location);

  const [input, setInput] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const scrollRef = useRef(null);
  const histListRef = useRef(null);
  const barRef = useRef(null);
  const [aboveSpace, setAboveSpace] = useState(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const inIframe = typeof window !== 'undefined' && window !== window.parent;
  const leftNavOffset = inIframe ? 20 : 260;

  const hasThread = expanded && (messages.length > 0 || loading);
  const hasHistory = conversations.length > 0;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  // The list keeps whatever scroll position it was left at (a native DOM
  // property, not React state) — without this, reopening history after
  // scrolling down previously shows stale mid-list entries instead of the
  // newest conversations at the top.
  useEffect(() => {
    if (showHistory && histListRef.current) histListRef.current.scrollTop = 0;
  }, [showHistory]);

  // The panel opens upward from the bar, so its usable height is however much
  // room actually exists above it on screen — not a fixed guess. A hardcoded
  // vh-based cap previously let the panel (including its header) render
  // above the visible viewport when that guess didn't match reality.
  useEffect(() => {
    if (!floating || !(hasThread || showHistory)) return undefined;
    const measure = () => {
      if (!barRef.current) return;
      const top = barRef.current.getBoundingClientRect().top;
      setAboveSpace(Math.max(160, top - 20));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [floating, hasThread, showHistory]);

  const abovePanelStyle = floating && aboveSpace != null ? { maxHeight: Math.min(440, aboveSpace) } : undefined;

  const handleSend = useCallback((text) => {
    const t = (text ?? '').trim();
    if (!t || loading) return;
    setExpanded(true);
    setShowHistory(false);
    setInput('');
    sendMessage(t);
  }, [sendMessage, loading]);

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setActiveConvId(null);
    setExpanded(false);
    setShowHistory(false);
    setInput('');
  }, [setMessages, setActiveConvId]);

  const handleSelectConv = useCallback((convId) => {
    selectConversation(convId);
    setExpanded(true);
    setShowHistory(false);
  }, [selectConversation]);

  function renderMessage(msg) {
    if (msg.role === 'user') {
      return (
        <div key={msg.id} className="bxb-row bxb-row-user">
          <div className="bxb-bubble-user">{msg.text}</div>
        </div>
      );
    }
    const j = msg.json;
    const choices = j?.choices;
    // Plain conversational bubble only — no action/status card, no feature
    // badges, no divider, no timestamp/evidence metadata below the message.
    // Execution details (j.actions, j.evidence) stay in state for anyone
    // debugging via devtools, but are never rendered.
    const raw = j?.message || msg.text || '';
    const bodyText = raw.replace(/^\s*[✓✅]\s*/, '');
    const card = (
      <div className="bxb-card">
        <MarkdownMessage text={bodyText} variant="bxb-md" />
      </div>
    );

    return (
      <div key={msg.id} className="bxb-row bxb-row-agent">
        <div className="bxb-agent-stack">
          {card}
          {choices?.length > 0 && (
            <div className="bxb-choices">
              {choices.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  className={`bxb-choice-btn${c.value === '__confirm__' ? ' confirm' : c.value === '__cancel__' ? ' cancel' : ''}`}
                  onClick={() => handleSend(c.value)}
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

  const outerInlineStyle = { width: '100%', maxWidth: cfg.maxWidth, margin: (center ?? false) ? '0 auto' : undefined };
  const outerFloatStyle = side === 'left'
    ? { position: 'fixed', bottom: 20, left: leftNavOffset, right: 'calc(45% + 20px)', zIndex }
    : { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', width: 'calc(100% - 40px)', maxWidth: cfg.maxWidth, zIndex };
  const outerStyle = floating ? outerFloatStyle : outerInlineStyle;

  const panelHead = (
    <div className="bxb-panel-head">
      <div className="bxb-panel-icon">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="1.8"><path d="M7 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" /></svg>
      </div>
      <span className="bxb-panel-name">Brix</span>
      <span className="bxb-panel-status"><span className="bxb-panel-dot" />Connected</span>
      {credits && (
        <span
          className="bxb-panel-credits"
          title={credits.isOverage ? `Over your monthly cap — billed $${credits.overageRate?.toFixed(2)}/credit` : 'AI credits remaining'}
          style={credits.isOverage ? { color: '#b45309', background: '#fffbeb', borderColor: '#fde68a' } : undefined}
        >
          {credits.isOverage
            ? `Overage $${credits.overageRate?.toFixed(2)}/credit`
            : `${credits.remaining}/${credits.limit} credits`}
        </span>
      )}
      <button className="bxb-panel-action" onClick={handleNewChat}>New chat</button>
      <button className="bxb-hist-close" onClick={() => setExpanded(false)} aria-label="Close chat">{CLOSE_ICON}</button>
    </div>
  );

  const chatBody = (
    <div className="bxb-msgs" ref={scrollRef}>
      {messages.map(renderMessage)}
      {loading && (
        <div className="bxb-row bxb-row-agent">
          <div className="bxb-loading">
            <div className="bxb-spinner" />
            <ThinkingLabel />
          </div>
        </div>
      )}
    </div>
  );

  const historyPanelContent = (
    <>
      <div className="bxb-panel-head">
        <div className="bxb-panel-icon">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
        </div>
        <span className="bxb-panel-name">History</span>
        <button className="bxb-panel-action" onClick={handleNewChat}>New chat</button>
        <button className="bxb-hist-close" onClick={() => setShowHistory(false)} aria-label="Close history">{CLOSE_ICON}</button>
      </div>
      <div className="bxb-hist-list" ref={histListRef}>
        {conversations.length === 0 ? (
          <div className="bxb-hist-empty">No previous chats yet</div>
        ) : (
          conversations.map(conv => (
            <button key={conv.id} className="bxb-hist-item" onClick={() => handleSelectConv(conv.id)}>
              <span className="bxb-hist-title">{conv.title || 'Untitled chat'}</span>
              <span className="bxb-hist-date">{relativeDate(conv.updatedAt || conv.createdAt)}</span>
            </button>
          ))
        )}
      </div>
    </>
  );

  const bxbNode = (
    <div className="bxb" style={{ ...outerStyle, position: floating ? outerStyle.position : 'relative' }}>
      <style>{`
        .bxb-bar{display:flex;align-items:center;gap:${size==='sm'?8:10}px;background:${floating?'rgba(255,255,255,0.84)':'#fff'};${floating?'backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);':''}border:1px solid ${floating?'rgba(220,220,220,0.7)':'#e1e3e5'};border-radius:9999px;padding:${size==='sm'?`6px 6px 6px ${cfg.padLeft}px`:size==='lg'?`10px 10px 10px ${cfg.padLeft}px`:`8px 8px 8px ${cfg.padLeft}px`};box-shadow:${floating?'0 4px 24px rgba(0,0,0,0.10),0 1px 4px rgba(0,0,0,0.06)':'0 2px 10px rgba(0,0,0,.06)'}}
        .bxb-search-icon{flex-shrink:0}
        .bxb-input{flex:1;background:transparent;border:none;outline:none;color:#1a1a1a;font-size:${cfg.inputFont}px;padding:${size==='sm'?'6px 0':size==='lg'?'12px 0':'10px 0'};min-width:0}
        .bxb-input::placeholder{color:#9ca3af}
        .bxb-hist-btn{background:none;border:none;cursor:pointer;padding:4px 6px;color:#9ca3af;border-radius:6px;display:flex;align-items:center;flex-shrink:0;transition:color .15s,background .15s}
        .bxb-hist-btn:hover{color:#374151;background:rgba(0,0,0,0.05)}
        .bxb-hist-btn.active{color:#1a1a1a}
        .bxb-send{background:#1a1a1a;color:#fff;border:none;border-radius:9999px;cursor:pointer;font-weight:700;display:flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;transition:opacity .15s,transform .15s;flex-shrink:0}
        .bxb-send:not(:disabled):hover{opacity:0.85;transform:scale(1.03)}
        .bxb-send:disabled{opacity:.35;cursor:default}
        .bxb-send-lg{padding:13px 28px;font-size:15px}
        .bxb-send-md{padding:10px 20px;font-size:14px}
        .bxb-send-sm{width:32px;height:32px}
        .bxb-panel,.bxb-hist-panel{background:${floating?'rgba(255,255,255,0.92)':'#fff'};${floating?'backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);':''}border:1px solid ${floating?'rgba(210,210,210,0.65)':'#e1e3e5'};border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.09);animation:bxbIn .18s ease;display:flex;flex-direction:column;max-height:min(440px, calc(100vh - 120px))}
        .bxb-panel,.bxb-hist-panel{margin-top:10px}
        .bxb-panel-above{position:absolute;bottom:calc(100% + 10px);left:0;right:0;margin-top:0}
        @keyframes bxbIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
        .bxb-panel-head{display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid #f0f0f0;flex-shrink:0}
        .bxb-panel-icon{width:20px;height:20px;border-radius:5px;background:#1a1a1a;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .bxb-panel-name{font-size:12px;font-weight:600;color:#1a1a1a}
        .bxb-panel-status{margin-left:auto;display:flex;align-items:center;gap:4px;font-size:10px;color:#059669}
        .bxb-panel-dot{width:5px;height:5px;border-radius:50%;background:#059669}
        .bxb-panel-credits{display:flex;align-items:center;font-size:10px;font-weight:700;color:#1a9de0;background:#e8f9ff;border:1px solid #d4f1fe;border-radius:999px;padding:2px 8px;white-space:nowrap;margin-left:6px}
        .bxb-panel-action{background:none;border:none;cursor:pointer;font-size:11px;color:#374151;font-weight:600;padding:3px 6px;border-radius:5px;margin-left:auto}
        .bxb-panel-action:hover{background:#f3f4f6}
        .bxb-msgs{flex:1;min-height:0;max-height:${cfg.panelH}px;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
        .bxb-row{display:flex}
        .bxb-row-user{justify-content:flex-end}
        .bxb-row-agent{justify-content:flex-start}
        .bxb-bubble-user{max-width:80%;background:#1a1a1a;color:#fff;padding:7px 12px;border-radius:12px;border-bottom-right-radius:4px;font-size:13px;line-height:1.45;word-wrap:break-word}
        .bxb-agent-stack{display:flex;flex-direction:column;align-items:flex-start;gap:6px;max-width:88%}
        .bxb-card{background:#f9fafb;border:1px solid #e8e8e8;border-radius:12px;padding:10px 12px;font-size:13px;line-height:1.5;color:#1a1a1a}
        .bxb-choices{display:flex;flex-wrap:wrap;gap:6px}
        .bxb-choice-btn{background:#fff;border:1px solid #d1d5db;border-radius:999px;padding:6px 14px;font-size:12px;font-weight:600;color:#1a1a1a;cursor:pointer;transition:background .15s,border-color .15s,opacity .15s}
        .bxb-choice-btn:hover:not(:disabled){background:#f3f4f6;border-color:#9ca3af}
        .bxb-choice-btn:disabled{opacity:.5;cursor:default}
        .bxb-choice-btn.confirm{background:#1a1a1a;color:#fff;border-color:#1a1a1a}
        .bxb-choice-btn.confirm:hover:not(:disabled){opacity:.85}
        .bxb-choice-btn.cancel{color:#DC2626;border-color:#fecaca}
        .bxb-choice-btn.cancel:hover:not(:disabled){background:#fef2f2}
        .bxb-md p{margin:0 0 6px}
        .bxb-md p:last-child{margin-bottom:0}
        .bxb-md :is(h1,h2,h3,h4,h5,h6){font-size:13px;font-weight:700;margin:6px 0 4px;color:#1a1a1a}
        .bxb-md ul,.bxb-md ol{margin:4px 0 6px;padding-left:18px}
        .bxb-md li{margin:2px 0}
        .bxb-md strong{font-weight:700}
        .bxb-md em{font-style:italic}
        .bxb-md code{background:#eef0f2;border-radius:4px;padding:1px 5px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
        .bxb-md pre{background:#eef0f2;border-radius:8px;padding:8px 10px;overflow-x:auto;margin:6px 0}
        .bxb-md pre code{background:none;padding:0}
        .bxb-md blockquote{border-left:3px solid #d1d5db;margin:6px 0;padding:2px 0 2px 10px;color:#4b5563}
        .bxb-md table{border-collapse:collapse;margin:6px 0;font-size:12px;width:100%}
        .bxb-md th,.bxb-md td{border:1px solid #e5e7eb;padding:4px 8px;text-align:left}
        .bxb-md a{color:#1a73e8;text-decoration:underline}
        .bxb-loading{display:flex;align-items:center;gap:6px;padding:7px 11px;background:#f9fafb;border:1px solid #e8e8e8;border-radius:12px;max-width:80%}
        .bxb-spinner{width:12px;height:12px;border:2px solid #e8e8e8;border-top-color:#374151;border-radius:50%;animation:bxbSpin .6s linear infinite;flex-shrink:0}
        @keyframes bxbSpin{to{transform:rotate(360deg)}}
        .bxb-loading-text{font-size:11px;color:#888}
        .bxb-hist-close{background:none;border:none;cursor:pointer;padding:4px;color:#6b7280;border-radius:4px;display:flex;align-items:center;margin-left:4px}
        .bxb-hist-close:hover{background:#f3f4f6;color:#1a1a1a}
        .bxb-hist-list{flex:1;min-height:0;max-height:280px;overflow-y:auto;padding:6px;display:flex;flex-direction:column;gap:2px}
        .bxb-hist-empty{padding:16px 12px;text-align:center;font-size:12px;color:#9ca3af}
        .bxb-hist-item{display:flex;align-items:center;justify-content:space-between;width:100%;background:none;border:none;cursor:pointer;padding:8px 10px;border-radius:8px;text-align:left;transition:background .12s}
        .bxb-hist-item:hover{background:#f3f4f6}
        .bxb-hist-title{font-size:13px;color:#1a1a1a;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;margin-right:8px}
        .bxb-hist-date{font-size:11px;color:#9ca3af;flex-shrink:0;white-space:nowrap}
      `}</style>

      {showHistory && floating && (
        <div className="bxb-hist-panel bxb-panel-above" style={abovePanelStyle}>
          {historyPanelContent}
        </div>
      )}

      {hasThread && floating && !showHistory && (
        <div className="bxb-panel bxb-panel-above" style={abovePanelStyle}>
          {panelHead}
          {chatBody}
        </div>
      )}

      <div className="bxb-bar" ref={barRef}>
        <svg className="bxb-search-icon" width={cfg.iconSize} height={cfg.iconSize} viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" />
        </svg>
        <input
          className="bxb-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSend(input); } }}
          placeholder={placeholder}
        />
        {hasHistory && (
          <button
            className={`bxb-hist-btn${showHistory ? ' active' : ''}`}
            onClick={() => { setShowHistory(v => !v); setExpanded(false); }}
            aria-label="Chat history"
            title="Chat history"
          >
            {HISTORY_ICON}
          </button>
        )}
        <button
          className={`bxb-send bxb-send-${size}`}
          onClick={() => handleSend(input)}
          disabled={!input.trim() || !!loading}
          aria-label="Ask Brix"
        >
          {cfg.btnText && 'Ask Brix'}
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M2 8l12-4-4 8-3-3-3-3z" />
          </svg>
        </button>
      </div>

      {hasThread && !floating && !showHistory && (
        <div className="bxb-panel">
          {panelHead}
          {chatBody}
        </div>
      )}

      {showHistory && !floating && (
        <div className="bxb-hist-panel">
          {historyPanelContent}
        </div>
      )}
    </div>
  );

  // Polaris's `.Polaris-Page` wrapper sets `zoom` (see app/global.css), which
  // in Chromium/WebKit creates a new containing block for `position: fixed`
  // descendants exactly like `transform` does. That silently breaks this
  // component's viewport-pinned floating bar, anchoring it to the Page box
  // instead — portaling straight to <body> sidesteps the ancestor entirely.
  if (floating) {
    if (!mounted) return null;
    return createPortal(bxbNode, document.body);
  }
  return bxbNode;
}
