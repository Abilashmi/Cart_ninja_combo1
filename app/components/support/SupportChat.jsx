/* eslint-disable react/prop-types */
// The BRIX support chat on every admin page (mounted once in routes/app.jsx).
// A round chat button in the bottom-right corner (with the unread count)
// opens it; until the store has chatted, a chat-style message bubble from the
// team sits above it ("Need help setting up?" + the greeting + "Chat with
// us", which opens the chat), there from page load (no pop-in) and hidden for good by its ×
// (localStorage). The chat window never opens by itself (Built for Shopify 4.3.3). BRIX AI answers first,
// "Talk to a person" hands the chat to the team, who answer from
// /internal/chat. Server: routes/api.support-chat.jsx. Messages are masked
// from Clarity's recordings.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useT } from '../../i18n/admin';
import { embedStatusFrom } from '../shared/useAppEmbedStatus';
import { CHAT_MESSAGE_MAX } from '../../utils/support-chat.shared.js';

const API = '/api/support-chat';
const POLL_OPEN_MS = 4000;
const POLL_WAITING_MS = 2000;
const POLL_CLOSED_MS = 60000;
const AI_WAIT_MS = 45000;
const TEASER_CLOSED_KEY = 'brixChatTeaserClosed';

const CSS = `
.bxsc-launch{position:fixed;right:20px;bottom:var(--brix-sidekick-space,80px);z-index:9990;display:flex;align-items:center;gap:8px;border:0;cursor:pointer;background:#111;color:#fff;font:600 14px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;border-radius:999px;padding:12px 18px 12px 14px;box-shadow:0 8px 24px rgba(15,23,42,.25);transition:transform .15s}
.bxsc-launch:hover{transform:translateY(-2px)}
.bxsc-launch.round{width:52px;height:52px;padding:0;justify-content:center}
.bxsc-teaser{position:fixed;right:20px;bottom:calc(var(--brix-sidekick-space,80px) + 64px);z-index:9990;width:300px;background:#fff;border-radius:16px 16px 4px 16px;box-shadow:0 12px 32px rgba(15,23,42,.22);padding:12px 14px 14px;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#111;text-align:start}
.bxsc-teaser-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.bxsc-av{width:32px;height:32px;border-radius:50%;background:#fff;border:1px solid #e5e7eb;display:flex;align-items:center;justify-content:center;flex:none;overflow:hidden}
.bxsc-av img{width:24px;height:24px;display:block}
.bxsc-teaser-head b{font-size:13.5px;display:block}
.bxsc-teaser-head small{display:flex;align-items:center;gap:5px;color:#6b7280;font-size:12px}
.bxsc-teaser-x{margin-left:auto;border:0;background:transparent;color:#6b7280;width:28px;height:28px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.bxsc-teaser-x:hover{background:#f3f4f6;color:#111}
.bxsc-teaser-x:focus-visible,.bxsc-teaser-go:focus-visible{outline:2px solid #2c6ecb;outline-offset:2px}
.bxsc-bubble{background:#f3f4f6;border-radius:4px 14px 14px 14px;padding:9px 12px}
.bxsc-bubble strong{display:block;margin-bottom:2px}
.bxsc-teaser-go{margin-top:10px;width:100%;border:0;border-radius:10px;background:#111;color:#fff;font:600 14px/1 inherit;padding:11px 12px;cursor:pointer}
.bxsc-launch:focus-visible,.bxsc button:focus-visible,.bxsc textarea:focus-visible{outline:2px solid #2c6ecb;outline-offset:2px}
.bxsc-badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;border-radius:10px;background:#e11d48;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px;border:2px solid #fff}
.bxsc{position:fixed;right:20px;bottom:var(--brix-sidekick-space,80px);z-index:9991;width:370px;height:min(560px,calc(100vh - 120px));background:#fff;border-radius:16px;box-shadow:0 16px 48px rgba(15,23,42,.28);display:flex;flex-direction:column;overflow:hidden;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#111}
.bxsc-head{background:#111;color:#fff;padding:14px 14px 14px 16px;display:flex;align-items:center;gap:10px}
.bxsc-head b{display:block;font-size:15px}
.bxsc-head small{display:flex;align-items:center;gap:6px;color:rgba(255,255,255,.75);font-size:12px}
.bxsc-dot{width:8px;height:8px;border-radius:50%;background:#22c55e}
.bxsc-dot.away{background:#f59e0b}
.bxsc-x{margin-left:auto;background:transparent;border:0;color:#fff;cursor:pointer;width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center}
.bxsc-x:hover{background:rgba(255,255,255,.12)}
.bxsc-body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:#f6f6f7}
.bxsc-msg{max-width:85%;display:flex;flex-direction:column;gap:2px}
.bxsc-msg.me{align-self:flex-end;align-items:flex-end}
.bxsc-msg span{font-size:11px;color:#6b7280;padding:0 4px}
.bxsc-msg p{margin:0;padding:9px 12px;border-radius:14px;white-space:pre-wrap;word-break:break-word;background:#fff;border:1px solid #e5e7eb}
.bxsc-msg.me p{background:#111;color:#fff;border-color:#111;border-bottom-right-radius:4px}
.bxsc-msg.them p{border-bottom-left-radius:4px}
.bxsc-msg.team p{background:#eef4ff;border-color:#c7d7fe}
.bxsc-note{align-self:center;max-width:92%;text-align:center;font-size:12.5px;color:#4b5563;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:7px 10px;white-space:pre-wrap}
.bxsc-typing{align-self:flex-start;color:#6b7280;font-size:12.5px;padding:4px}
.bxsc-person{align-self:center;border:1px solid #d1d5db;background:#fff;border-radius:999px;padding:6px 12px;font:600 12.5px/1 inherit;cursor:pointer;color:#111}
.bxsc-person:hover{background:#f3f4f6}
.bxsc-foot{border-top:1px solid #e5e7eb;padding:10px;display:flex;gap:8px;align-items:flex-end;background:#fff}
.bxsc-foot textarea{flex:1;resize:none;border:1px solid #d1d5db;border-radius:10px;padding:9px 10px;font:inherit;max-height:120px;min-height:40px}
.bxsc-send{border:0;background:#111;color:#fff;border-radius:10px;height:40px;padding:0 14px;font:600 14px/1 inherit;cursor:pointer}
.bxsc-send[disabled]{opacity:.45;cursor:default}
.bxsc-err{color:#b42318;font-size:12.5px;padding:0 12px 8px}
.bxsc-hint{font-size:11.5px;color:#6b7280;text-align:center;padding:0 12px 8px}
@media (max-width:480px){.bxsc{right:8px;left:8px;width:auto;bottom:8px;height:calc(100vh - 16px)}.bxsc-launch{right:12px}.bxsc-teaser{right:12px;width:min(300px,calc(100vw - 24px))}}
`;

const ChatIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.4A8 8 0 1 1 21 12z" />
  </svg>
);

// The BRIX bag mark (public/brix-mark.png, cut from the BRIX logo) in a white circle.
const BrixAvatar = () => <span className="bxsc-av"><img src="/brix-mark.png" alt="" width="24" height="24" /></span>;

async function call(method, body, after = 0) {
  const res = await fetch(method === 'GET' ? `${API}?after=${after}` : API, method === 'GET' ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ success: false }));
  if (!res.ok || !json.success) throw new Error(json.error || 'failed');
  return json;
}

async function embedStatus() {
  try {
    const list = await window.shopify?.app?.extensions?.();
    const s = embedStatusFrom(list);
    return s === 'active' ? 'on' : 'off';
  } catch { return 'unknown'; }
}

const mergeMessages = (list, more) => {
  const byId = new Map(list.map((m) => [m.id, m]));
  more.forEach((m) => { if (m && m.id != null) byId.set(m.id, m); });
  return [...byId.values()].sort((a, b) => a.id - b.id);
};

export default function SupportChat() {
  const t = useT();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [waitingSince, setWaitingSince] = useState(0);
  const [error, setError] = useState('');
  // The message bubble's ×: hidden for good in this browser (read after mount, no SSR mismatch).
  const [teaserClosed, setTeaserClosed] = useState(true);
  useEffect(() => {
    try { setTeaserClosed(window.localStorage.getItem(TEASER_CLOSED_KEY) === '1'); } catch { setTeaserClosed(false); }
  }, []);
  const closeTeaser = () => {
    setTeaserClosed(true);
    try { window.localStorage.setItem(TEASER_CLOSED_KEY, '1'); } catch { /* private window */ }
  };
  const lastId = useRef(0);
  const bodyRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const data = await call('GET', null, lastId.current);
      // Same as before = no re-render (polls run every few seconds).
      setSettings((prev) => (JSON.stringify(prev) === JSON.stringify(data.settings) ? prev : data.settings));
      setConversation((prev) => (JSON.stringify(prev) === JSON.stringify(data.conversation) ? prev : data.conversation));
      if (data.messages.length) {
        setMessages((list) => {
          const next = mergeMessages(list, data.messages);
          lastId.current = next.length ? next[next.length - 1].id : lastId.current;
          return next;
        });
        if (data.messages.some((m) => m.sender !== 'merchant')) setWaitingSince(0);
      }
    } catch { /* try again on the next poll */ }
  }, []);

  // First load a moment after the page, then poll: fast while open (faster
  // while BRIX AI is answering), once a minute for the unread count when closed.
  useEffect(() => { const id = setTimeout(refresh, 1200); return () => clearTimeout(id); }, [refresh]);
  useEffect(() => {
    const waiting = waitingSince && Date.now() - waitingSince < AI_WAIT_MS;
    const every = open ? (waiting ? POLL_WAITING_MS : POLL_OPEN_MS) : POLL_CLOSED_MS;
    const id = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, every);
    return () => clearInterval(id);
  }, [open, waitingSince, refresh]);

  const unread = conversation?.unread || 0;
  useEffect(() => {
    if (open && unread > 0) call('POST', { intent: 'read' }).then(() => setConversation((c) => (c ? { ...c, unread: 0 } : c))).catch(() => {});
  }, [open, unread]);
  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [open, messages.length, waitingSince]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setError('');
    try {
      const res = await call('POST', { intent: 'send', body: text, page: location.pathname, embed: await embedStatus(), locale: document.documentElement.lang || '' });
      setInput('');
      setMessages((list) => {
        const next = mergeMessages(list, [res.message]);
        lastId.current = Math.max(lastId.current, res.message.id || 0);
        return next;
      });
      setConversation((c) => c || { id: null, status: 'open', needsTeam: false, unread: 0 });
      setWaitingSince(res.aiWillAnswer ? Date.now() : 0);
      setTimeout(refresh, 1500);
    } catch (e) {
      setError(e.message && e.message !== 'failed' ? e.message : t('admin.chat.error'));
    } finally {
      setSending(false);
    }
  };

  const askTeam = async () => {
    setError('');
    try {
      const res = await call('POST', { intent: 'team' });
      setMessages((list) => mergeMessages(list, [res.message]));
      setConversation((c) => ({ ...(c || { status: 'open', unread: 0 }), needsTeam: true }));
      setWaitingSince(0);
      setTimeout(refresh, 800);
    } catch { setError(t('admin.chat.error')); }
  };

  if (!settings?.enabled) return null;
  const waiting = waitingSince && Date.now() - waitingSince < AI_WAIT_MS;
  const firstTime = !conversation && messages.length === 0;
  const canAskTeam = settings.aiEnabled && !conversation?.needsTeam && messages.some((m) => m.sender === 'merchant');

  return (
    <>
      <style>{CSS}</style>
      {!open && firstTime && !teaserClosed && (
        // The team's chat-style message above the button; "Chat with us" opens the chat.
        <aside className="bxsc-teaser" aria-label={settings.teamName}>
          <div className="bxsc-teaser-head">
            <BrixAvatar />
            <div>
              <b>{settings.teamName}</b>
              <small><span className={`bxsc-dot${settings.online ? '' : ' away'}`} />{settings.online ? t('admin.chat.online') : t('admin.chat.away')}</small>
            </div>
            <button type="button" className="bxsc-teaser-x" aria-label={t('admin.chat.dismiss')} onClick={closeTeaser}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <div className="bxsc-bubble"><strong>{settings.launcherText}</strong>{settings.greeting}</div>
          <button type="button" className="bxsc-teaser-go" onClick={() => setOpen(true)}>{t('admin.chat.start')}</button>
        </aside>
      )}
      {!open && (
        <button type="button" className="bxsc-launch round" onClick={() => setOpen(true)} aria-label={t('admin.chat.open')}>
          <ChatIcon size={22} />
          {unread > 0 && <span className="bxsc-badge" aria-label={t('admin.chat.unread', { count: unread })}>{unread > 9 ? '9+' : unread}</span>}
        </button>
      )}
      {open && (
        <section className="bxsc" role="dialog" aria-label={settings.teamName} data-clarity-mask="true">
          <header className="bxsc-head">
            <BrixAvatar />
            <div>
              <b>{settings.teamName}</b>
              <small><span className={`bxsc-dot${settings.online ? '' : ' away'}`} />{settings.online ? t('admin.chat.online') : t('admin.chat.away')}</small>
            </div>
            <button type="button" className="bxsc-x" onClick={() => setOpen(false)} aria-label={t('admin.chat.close')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </header>
          <div className="bxsc-body" ref={bodyRef} aria-live="polite">
            <div className="bxsc-msg them"><span>{settings.aiEnabled ? t('admin.chat.ai_label') : settings.teamName}</span><p>{settings.greeting}</p></div>
            {messages.map((m) => (m.sender === 'system'
              ? <div key={m.id} className="bxsc-note">{m.body}</div>
              : (
                <div key={m.id} className={`bxsc-msg ${m.sender === 'merchant' ? 'me' : `them${m.sender === 'team' ? ' team' : ''}`}`}>
                  {m.sender !== 'merchant' && <span>{m.sender === 'ai' ? t('admin.chat.ai_label') : m.author || settings.teamName}</span>}
                  <p>{m.body}</p>
                </div>
              )))}
            {waiting ? <div className="bxsc-typing">{t('admin.chat.typing')}</div> : null}
            {canAskTeam && !waiting && <button type="button" className="bxsc-person" onClick={askTeam}>{t('admin.chat.talk_to_team')}</button>}
          </div>
          {error && <div className="bxsc-err" role="alert">{error}</div>}
          <div className="bxsc-foot">
            <textarea rows={1} value={input} maxLength={CHAT_MESSAGE_MAX} placeholder={t('admin.chat.placeholder')} aria-label={t('admin.chat.placeholder')}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button type="button" className="bxsc-send" onClick={send} disabled={sending || !input.trim()}>{t('admin.chat.send')}</button>
          </div>
          {settings.aiEnabled && <div className="bxsc-hint">{t('admin.chat.ai_note')}</div>}
        </section>
      )}
    </>
  );
}
