import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router";

const CHAT_ICON = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" />
  </svg>
);
const X_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export default function AiAgentFloating() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const inputRef = useRef(null);

  const navigate = useNavigate();
  const location = useLocation();

  // Hide on the ai-agent page — after all hooks
  const hidden = location.pathname.includes("/app/ai-agent");

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    function handler(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey && input.trim()) {
      e.preventDefault();
      const q = input.trim();
      setInput("");
      setOpen(false);
      navigate("/app/ai-agent?q=" + encodeURIComponent(q));
    }
  };

  if (hidden) return null;

  return (
    <>
      <style>{`
.aif-shell { position:fixed; right:24px; bottom:24px; z-index:520; }
.aif-launcher {
  width:52px; height:52px; border-radius:50%; background:#534AB7; border:none;
  cursor:pointer; display:flex; align-items:center; justify-content:center;
  box-shadow:0 4px 14px rgba(0,0,0,.18); transition:transform .15s ease; color:#fff;
}
.aif-launcher:hover { transform:scale(1.05); }
.aif-popover {
  position:fixed; right:24px; bottom:88px; width:260px; background:#fff;
  border:1px solid #e3e3e3; border-radius:14px; padding:16px;
  box-shadow:0 8px 24px rgba(0,0,0,.10); z-index:520;
  animation:aifPop .18s ease;
}
@keyframes aifPop { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
.aif-popover h4 { margin:0 0 2px; font-size:14px; font-weight:600; color:#1a1a1a; }
.aif-popover p { margin:0 0 12px; font-size:13px; color:#6d6d6d; }
.aif-popover input {
  width:100%; height:34px; padding:0 10px; border:1px solid #e3e3e3; border-radius:8px;
  font-size:13px; outline:none; box-sizing:border-box;
}
.aif-popover input:focus { border-color:#534AB7; }
      `}</style>
      <div className="aif-shell">
        <button
          className="aif-launcher"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close" : "Open AI chat"}
        >
          {open ? X_ICON : CHAT_ICON}
        </button>
      </div>
      {open && (
        <div className="aif-popover">
          <h4>Hi there {"\u{1F44B}"}</h4>
          <p>How can I help you today?</p>
          <input
            ref={inputRef}
            type="text"
            placeholder="Ask me anything..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
          />
        </div>
      )}
    </>
  );
}
