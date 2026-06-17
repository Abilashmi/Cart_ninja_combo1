import { useRef, useEffect } from "react";

const SUGGESTIONS = [
  "Generate FBT",
  "Create Upsell",
  "Analyze Store",
  "Create Coupon",
  "Optimize Cart",
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

  return (
    <>
      <style>{`
        .cngb-popup {
          width: 320px;
          background: #ffffff;
          border-radius: 20px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.15), 0 8px 24px rgba(0,0,0,0.08);
          padding: 20px;
          animation: cngb-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          transform-origin: bottom right;
          position: relative;
        }
        @keyframes cngb-in {
          from { transform: scale(0.85); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .cngb-logo {
          width: 40px; height: 40px; border-radius: 12px;
          background: #FF6B00; display: flex;
          align-items: center; justify-content: center; margin-bottom: 14px;
        }
        .cngb-logo svg { width: 22px; height: 22px; }
        .cngb-title {
          font-size: 20px; font-weight: 700; color: #111827;
          margin: 0 0 2px; line-height: 1.3;
          font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
        }
        .cngb-sub {
          font-size: 14px; color: #6b7280; margin: 0 0 16px; line-height: 1.4;
          font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
        }
        .cngb-input {
          width: 100%; padding: 11px 14px; border-radius: 12px;
          border: 1.5px solid #e5e7eb; background: #f9fafb;
          font-size: 14px; color: #111827; outline: none; box-sizing: border-box;
          font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
          transition: border-color 0.15s; margin-bottom: 14px;
        }
        .cngb-input:focus { border-color: #FF6B00; background: #ffffff; }
        .cngb-input::placeholder { color: #9ca3af; }
        .cngb-suggestions { display: flex; flex-wrap: wrap; gap: 6px; }
        .cngb-suggestion {
          padding: 6px 14px; border-radius: 999px;
          border: 1px solid #e5e7eb; background: #f9fafb;
          color: #374151; font-size: 12.5px; font-weight: 500;
          cursor: pointer; transition: all 0.15s; white-space: nowrap;
          font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
        }
        .cngb-suggestion:hover {
          border-color: #FF6B00; color: #FF6B00; background: #fff5ed;
        }
      `}</style>
      <div className="cngb-popup">
        <div className="cngb-logo">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="5" fill="#fff" />
            <path d="M6 8h3l2 8h6l2-6h-4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <circle cx="9" cy="19" r="1.2" fill="#fff" />
            <circle cx="17" cy="19" r="1.2" fill="#fff" />
            <path d="M14 8V5a2 2 0 00-4 0v3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </div>
        <h3 className="cngb-title">Hi 👋</h3>
        <p className="cngb-sub">How can I help you today?</p>
        <input
          ref={inputRef}
          className="cngb-input"
          type="text"
          placeholder="Ask Cart Ninja AI..."
          onKeyDown={handleKeyDown}
        />
        <div className="cngb-suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="cngb-suggestion" onClick={() => onQuery(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
