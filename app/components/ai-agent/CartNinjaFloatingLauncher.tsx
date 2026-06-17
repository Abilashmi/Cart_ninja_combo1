import { useState, useCallback, useEffect } from "react";
import CartNinjaGreetingBubble from "./CartNinjaGreetingBubble";
import CartNinjaAgentModal from "./CartNinjaAgentModal";

export default function CartNinjaFloatingLauncher() {
  const [step, setStep] = useState<"idle" | "popup" | "modal">("idle");
  const [modalQuery, setModalQuery] = useState("");

  const closeAll = useCallback(() => {
    setStep("idle");
    setModalQuery("");
  }, []);

  const handleQuery = useCallback((query: string) => {
    setModalQuery(query);
    setStep("modal");
  }, []);

  useEffect(() => {
    if (step !== "modal") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAll();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [step, closeAll]);

  return (
    <>
      <style>{`
        .cnfl-root {
          position: fixed; z-index: 2147483000;
          right: 24px; bottom: 24px;
          display: flex; flex-direction: column;
          align-items: flex-end; gap: 12px;
        }
        @media (max-width: 600px) {
          .cnfl-root { right: 16px; bottom: 16px; }
        }
        .cnfl-btn {
          width: 64px; height: 64px; border-radius: 50%;
          background: #ffffff; border: none;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.08);
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          animation: cnfl-pulse 3s ease-in-out infinite;
          flex-shrink: 0;
        }
        .cnfl-btn:hover { transform: scale(1.08); box-shadow: 0 8px 30px rgba(0,0,0,0.2), 0 4px 12px rgba(0,0,0,0.1); }
        .cnfl-btn:active { transform: scale(0.96); }
        @keyframes cnfl-pulse {
          0%, 100% { box-shadow: 0 4px 20px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.08); }
          50% { box-shadow: 0 4px 20px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.08), 0 0 0 8px rgba(255,107,0,0.08); }
        }
        .cnfl-btn svg { width: 32px; height: 32px; }
        @media (max-width: 600px) {
          .cnfl-btn { width: 56px; height: 56px; }
          .cnfl-btn svg { width: 28px; height: 28px; }
        }
      `}</style>

      <div className="cnfl-root">
        {step === "popup" && (
          <CartNinjaGreetingBubble onQuery={handleQuery} onClose={closeAll} />
        )}
        <button
          className="cnfl-btn"
          onClick={() => (step === "idle" ? setStep("popup") : closeAll())}
          aria-label="Cart Ninja AI Agent"
        >
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="24" height="24" rx="5" fill="#FF6B00" />
            <path d="M6 8h3l2 8h6l2-6h-4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <circle cx="9" cy="19" r="1.2" fill="#fff" />
            <circle cx="17" cy="19" r="1.2" fill="#fff" />
            <path d="M14 8V5a2 2 0 00-4 0v3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </button>
      </div>

      {step === "modal" && (
        <CartNinjaAgentModal initialQuery={modalQuery} onClose={closeAll} />
      )}
    </>
  );
}
