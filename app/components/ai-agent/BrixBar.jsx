import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router';
import useAiAgent from './useAiAgent';

const SIZES = {
  lg: { maxWidth: '960px', inputFont: 17, padLeft: 28, btnText: true,  iconSize: 26, panelH: 380 },
  md: { maxWidth: '720px', inputFont: 14, padLeft: 18, btnText: true,  iconSize: 20, panelH: 300 },
  sm: { maxWidth: '100%',  inputFont: 13, padLeft: 14, btnText: false, iconSize: 17, panelH: 240 },
};

const CHECK_ICON = (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7l3 3 5-5" />
  </svg>
);

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
}) {
  const cfg = SIZES[size] || SIZES.md;
  const location = useLocation();
  const { messages, loading, sendMessage, setMessages, setActiveConvId, conversations, selectConversation } = useAiAgent(location);

  const [input, setInput] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const scrollRef = useRef(null);

  const inIframe = typeof window !== 'undefined' && window !== window.parent;
  const leftNavOffset = inIframe ? 20 : 260;

  const hasThread = expanded && (messages.length > 0 || loading);
  const hasHistory = conversations.length > 0;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

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
    const failed = j?.status === 'failed';
    if (j?.actions?.length > 0) {
      return (
        <div key={msg.id} className="bxb-row bxb-row-agent">
          <div className="bxb-card">
            {(j.message || '').split('\n').filter(Boolean).map((line, i) => (
              <div key={i} className="bxb-card-line">{line}</div>
            ))}
            <div className="bxb-card-divider" />
            {j.actions.map((a, i) => (
              <div key={i} className="bxb-card-change">
                <span className={`bxb-card-bullet ${failed ? 'err' : ''}`}>{failed ? '✖' : CHECK_ICON}</span>
                <span>{a.label || a.module}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    const lines = (j?.message || msg.text || '').split('\n').filter(Boolean);
    return (
      <div key={msg.id} className="bxb-row bxb-row-agent">
        <div className="bxb-card">
          {lines.map((line, i) => {
            const ok = line.startsWith('✓') || line.startsWith('✅');
            return (
              <div key={i} className={`bxb-card-line ${ok ? 'ok' : ''}`}>
                {ok && <span className="bxb-card-line-icon">{CHECK_ICON}</span>}
                {line.replace(/^[✓✅]\s*/, '')}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const outerInlineStyle = { width: '100%', maxWidth: cfg.maxWidth, margin: (center ?? false) ? '0 auto' : undefined };
  const outerFloatStyle = side === 'left'
    ? { position: 'fixed', bottom: 20, left: leftNavOffset, right: 'calc(45% + 20px)', zIndex: 9998 }
    : { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', width: 'calc(100% - 40px)', maxWidth: cfg.maxWidth, zIndex: 9998 };
  const outerStyle = floating ? outerFloatStyle : outerInlineStyle;

  const panelHead = (
    <div className="bxb-panel-head">
      <div className="bxb-panel-icon">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="#fff" strokeWidth="1.8"><path d="M7 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" /></svg>
      </div>
      <span className="bxb-panel-name">Brix</span>
      <span className="bxb-panel-status"><span className="bxb-panel-dot" />Connected</span>
      <button className="bxb-panel-action" onClick={handleNewChat}>New chat</button>
    </div>
  );

  const chatBody = (
    <div className="bxb-msgs" ref={scrollRef}>
      {messages.map(renderMessage)}
      {loading && (
        <div className="bxb-row bxb-row-agent">
          <div className="bxb-loading">
            <div className="bxb-spinner" />
            <span className="bxb-loading-text">Brix is thinking…</span>
          </div>
        </div>
      )}
    </div>
  );

  const historyPanel = (
    <div className="bxb-hist-panel">
      <div className="bxb-panel-head">
        <div className="bxb-panel-icon">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
        </div>
        <span className="bxb-panel-name">History</span>
        <button className="bxb-panel-action" onClick={handleNewChat}>New chat</button>
        <button className="bxb-hist-close" onClick={() => setShowHistory(false)} aria-label="Close history">{CLOSE_ICON}</button>
      </div>
      <div className="bxb-hist-list">
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
    </div>
  );

  return (
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
        .bxb-panel,.bxb-hist-panel{background:${floating?'rgba(255,255,255,0.92)':'#fff'};${floating?'backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);':''}border:1px solid ${floating?'rgba(210,210,210,0.65)':'#e1e3e5'};border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.09);animation:bxbIn .18s ease}
        .bxb-panel{margin-top:10px}
        .bxb-panel-above{position:absolute;bottom:calc(100% + 10px);left:0;right:0}
        @keyframes bxbIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
        .bxb-panel-head{display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid #f0f0f0}
        .bxb-panel-icon{width:20px;height:20px;border-radius:5px;background:#1a1a1a;display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .bxb-panel-name{font-size:12px;font-weight:600;color:#1a1a1a}
        .bxb-panel-status{margin-left:auto;display:flex;align-items:center;gap:4px;font-size:10px;color:#059669}
        .bxb-panel-dot{width:5px;height:5px;border-radius:50%;background:#059669}
        .bxb-panel-action{background:none;border:none;cursor:pointer;font-size:11px;color:#374151;font-weight:600;padding:3px 6px;border-radius:5px;margin-left:auto}
        .bxb-panel-action:hover{background:#f3f4f6}
        .bxb-msgs{max-height:${cfg.panelH}px;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
        .bxb-row{display:flex}
        .bxb-row-user{justify-content:flex-end}
        .bxb-row-agent{justify-content:flex-start}
        .bxb-bubble-user{max-width:80%;background:#1a1a1a;color:#fff;padding:7px 12px;border-radius:12px;border-bottom-right-radius:4px;font-size:13px;line-height:1.45;word-wrap:break-word}
        .bxb-card{max-width:88%;background:#f9fafb;border:1px solid #e8e8e8;border-radius:12px;padding:10px 12px;font-size:13px;line-height:1.5;color:#1a1a1a}
        .bxb-card-line{padding:2px 0;display:flex;align-items:center;gap:5px}
        .bxb-card-line.ok{color:#059669}
        .bxb-card-line-icon{flex-shrink:0;color:#059669;display:flex}
        .bxb-card-divider{height:1px;background:#e8e8e8;margin:6px 0}
        .bxb-card-change{display:flex;align-items:center;gap:5px;padding:2px 0}
        .bxb-card-bullet{color:#059669;display:flex;flex-shrink:0}
        .bxb-card-bullet.err{color:#DC2626}
        .bxb-loading{display:flex;align-items:center;gap:6px;padding:7px 11px;background:#f9fafb;border:1px solid #e8e8e8;border-radius:12px;max-width:80%}
        .bxb-spinner{width:12px;height:12px;border:2px solid #e8e8e8;border-top-color:#374151;border-radius:50%;animation:bxbSpin .6s linear infinite;flex-shrink:0}
        @keyframes bxbSpin{to{transform:rotate(360deg)}}
        .bxb-loading-text{font-size:11px;color:#888}
        .bxb-hist-panel{position:absolute;bottom:calc(100% + 10px);left:0;right:0}
        .bxb-hist-close{background:none;border:none;cursor:pointer;padding:4px;color:#6b7280;border-radius:4px;display:flex;align-items:center;margin-left:4px}
        .bxb-hist-close:hover{background:#f3f4f6;color:#1a1a1a}
        .bxb-hist-list{max-height:280px;overflow-y:auto;padding:6px;display:flex;flex-direction:column;gap:2px}
        .bxb-hist-empty{padding:16px 12px;text-align:center;font-size:12px;color:#9ca3af}
        .bxb-hist-item{display:flex;align-items:center;justify-content:space-between;width:100%;background:none;border:none;cursor:pointer;padding:8px 10px;border-radius:8px;text-align:left;transition:background .12s}
        .bxb-hist-item:hover{background:#f3f4f6}
        .bxb-hist-title{font-size:13px;color:#1a1a1a;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;margin-right:8px}
        .bxb-hist-date{font-size:11px;color:#9ca3af;flex-shrink:0;white-space:nowrap}
      `}</style>

      {showHistory && historyPanel}

      {hasThread && floating && !showHistory && (
        <div className="bxb-panel bxb-panel-above">
          {panelHead}
          {chatBody}
        </div>
      )}

      <div className="bxb-bar">
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
    </div>
  );
}
