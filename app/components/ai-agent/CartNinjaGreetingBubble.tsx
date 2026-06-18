import { useRef, useEffect } from "react";

const SUGGESTIONS = [
  { label: "Generate FBT", icon: (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="5" r="2"/><circle cx="15" cy="5" r="2"/><circle cx="10" cy="15" r="2"/>
      <path d="M6.5 6L10 13M13.5 6L10 13M6.5 5h7"/>
    </svg>
  )},
  { label: "Create Upsell", icon: (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 15l4.5-5.5 3.5 2.5 5-7"/><path d="M14 4h4v4"/>
    </svg>
  )},
  { label: "Analyze Store", icon: (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M3 16V5"/><path d="M3 16h14"/>
      <rect x="5" y="10" width="3" height="5" rx="1"/><rect x="10" y="7" width="3" height="8" rx="1"/><rect x="15" y="4" width="3" height="11" rx="1"/>
    </svg>
  )},
  { label: "Create Coupon", icon: (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M2 7a2 2 0 0 0 0 3v2.5h16V10a2 2 0 0 0 0-3V4H2z"/>
      <path d="M11 10H8.5M11 7.5l-3.5 5"/>
    </svg>
  )},
  { label: "Optimize Cart", icon: (
    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h2l3 9h6l2-6H9"/><circle cx="8.5" cy="17" r="1.2"/><circle cx="15" cy="17" r="1.2"/>
    </svg>
  )},
];

interface Props {
  onQuery: (query: string) => void;
  onClose: () => void;
}

export default function CartNinjaGreetingBubble({ onQuery, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = inputRef.current?.value.trim();
      if (val) onQuery(val);
    }
    if (e.key === "Escape") onClose();
  };

  const handleSend = () => {
    const val = inputRef.current?.value.trim();
    if (val) onQuery(val);
  };

  return (
    <>
      <style>{`
        .cngb-popup {
          width: 340px;
          background: #ffffff;
          border-radius: 20px;
          box-shadow: 0 24px 64px rgba(0,0,0,0.14), 0 8px 24px rgba(0,0,0,0.08);
          padding: 20px;
          animation: cngb-in 0.25s cubic-bezier(0.16, 1, 0.3, 1);
          transform-origin: bottom right;
          position: relative;
          font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
        }
        @keyframes cngb-in {
          from { transform: scale(0.88) translateY(8px); opacity: 0; }
          to   { transform: scale(1) translateY(0); opacity: 1; }
        }
        .cngb-close {
          position: absolute; top: 12px; right: 12px;
          width: 28px; height: 28px; border-radius: 8px;
          border: none; background: #f3f4f6; color: #6b7280;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: background 0.15s, color 0.15s;
        }
        .cngb-close:hover { background: #e5e7eb; color: #111827; }
        .cngb-header {
          display: flex; align-items: center; gap: 12px; margin-bottom: 16px;
        }
        .cngb-logo {
          width: 44px; height: 44px; border-radius: 12px;
          background: #FF6B00; display: flex; flex-shrink: 0;
          align-items: center; justify-content: center;
          box-shadow: 0 2px 8px rgba(255,107,0,0.3);
        }
        .cngb-logo svg { width: 24px; height: 24px; }
        .cngb-brand-name {
          font-size: 15px; font-weight: 700; color: #111827; line-height: 1.2;
        }
        .cngb-brand-status {
          display: flex; align-items: center; gap: 5px;
          font-size: 12px; color: #6b7280; margin-top: 2px;
        }
        .cngb-status-dot {
          width: 7px; height: 7px; border-radius: 50%; background: #10b981; flex-shrink: 0;
        }
        .cngb-greeting {
          font-size: 18px; font-weight: 700; color: #111827; margin: 0 0 4px;
        }
        .cngb-sub {
          font-size: 13.5px; color: #6b7280; margin: 0 0 16px; line-height: 1.5;
        }
        .cngb-input-row {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 12px; border-radius: 12px;
          border: 1.5px solid #e5e7eb; background: #f9fafb;
          margin-bottom: 14px; transition: border-color 0.15s, background 0.15s;
        }
        .cngb-input-row:focus-within { border-color: #FF6B00; background: #fff; }
        .cngb-input-icon { color: #9ca3af; display: flex; align-items: center; flex-shrink: 0; }
        .cngb-input {
          flex: 1; border: none; background: transparent;
          font-size: 13.5px; color: #111827; outline: none;
          font-family: inherit;
        }
        .cngb-input::placeholder { color: #9ca3af; }
        .cngb-send {
          width: 28px; height: 28px; border-radius: 8px;
          border: none; background: #FF6B00; color: #fff;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; transition: background 0.15s;
        }
        .cngb-send:hover { background: #e55f00; }
        .cngb-chips-label {
          font-size: 11px; font-weight: 600; color: #9ca3af;
          text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;
        }
        .cngb-suggestions { display: flex; flex-wrap: wrap; gap: 6px; }
        .cngb-suggestion {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 6px 12px; border-radius: 999px;
          border: 1.5px solid #e5e7eb; background: #f9fafb;
          color: #374151; font-size: 12.5px; font-weight: 500;
          cursor: pointer; transition: all 0.15s; white-space: nowrap;
          font-family: inherit;
        }
        .cngb-suggestion:hover {
          border-color: #FF6B00; color: #FF6B00; background: #fff5ed;
        }
        .cngb-footer {
          margin-top: 14px; padding-top: 12px;
          border-top: 1px solid #f3f4f6;
          font-size: 11px; color: #9ca3af; text-align: center;
        }
      `}</style>
      <div className="cngb-popup">
        <button className="cngb-close" onClick={onClose} aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M2 2l10 10M12 2L2 12"/>
          </svg>
        </button>

        <div className="cngb-header">
          <div className="cngb-logo">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 8h3l2 8h6l2-6h-4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="9" cy="19" r="1.2" fill="#fff"/>
              <circle cx="17" cy="19" r="1.2" fill="#fff"/>
              <path d="M14 8V5a2 2 0 00-4 0v3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <div className="cngb-brand-name">Cart Ninja AI</div>
            <div className="cngb-brand-status">
              <span className="cngb-status-dot"/>
              Online — ready to help
            </div>
          </div>
        </div>

        <p className="cngb-greeting">How can I help?</p>
        <p className="cngb-sub">Ask me to configure features, analyze your store, or create offers.</p>

        <div className="cngb-input-row">
          <span className="cngb-input-icon">
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <path d="M7 2l1.5 4.5H13l-3.5 2.5 1.5 4.5L7 11l-4 2.5 1.5-4.5L1 6.5h4.5z"/>
            </svg>
          </span>
          <input
            ref={inputRef}
            className="cngb-input"
            type="text"
            placeholder="Ask Cart Ninja AI..."
            onKeyDown={handleKeyDown}
          />
          <button className="cngb-send" onClick={handleSend} aria-label="Send">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M2 8l12-4-4 8-3-3-3-3z"/>
            </svg>
          </button>
        </div>

        <div className="cngb-chips-label">Quick actions</div>
        <div className="cngb-suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s.label} className="cngb-suggestion" onClick={() => onQuery(s.label)}>
              {s.icon}{s.label}
            </button>
          ))}
        </div>

        <div className="cngb-footer">Cart Ninja AI · Real-time store optimization</div>
      </div>
    </>
  );
}
