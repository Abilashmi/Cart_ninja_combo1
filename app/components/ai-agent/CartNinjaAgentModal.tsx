import CartNinjaAgentV2 from "./CartNinjaAgentV2";

interface Props {
  initialQuery: string;
  onClose: () => void;
}

export default function CartNinjaAgentModal({ initialQuery, onClose }: Props) {
  return (
    <>
      <style>{`
        .cnam-backdrop {
          position: fixed; inset: 0; z-index: 2147483100;
          background: rgba(0,0,0,0.5);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          display: flex; align-items: center; justify-content: center;
          animation: cnam-fade 0.3s ease;
        }
        @keyframes cnam-fade {
          from { opacity: 0; } to { opacity: 1; }
        }
        .cnam-modal {
          position: relative;
          width: 90vw; max-width: 1400px; height: 90vh;
          border-radius: 24px; overflow: hidden;
          background: transparent;
          animation: cnam-scale 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes cnam-scale {
          from { transform: scale(0.92); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .cnam-body {
          width: 100%; height: 100%; border-radius: 24px; overflow: hidden;
        }
        .cnam-body > * { width: 100%; height: 100%; }
        .cnam-close {
          position: absolute; top: 16px; right: 16px; z-index: 10;
          width: 36px; height: 36px; border-radius: 50%;
          background: rgba(0,0,0,0.4); border: none; color: #fff;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: background 0.15s; backdrop-filter: blur(4px);
        }
        .cnam-close:hover { background: rgba(0,0,0,0.6); }
        .cnam-close svg { width: 18px; height: 18px; }
        @media (max-width: 600px) {
          .cnam-modal { width: 100vw; height: 100vh; border-radius: 0; max-width: none; }
          .cnam-body { border-radius: 0; }
        }
      `}</style>
      <div className="cnam-backdrop" onClick={onClose}>
        <div className="cnam-modal" onClick={(e) => e.stopPropagation()}>
          <button className="cnam-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M6 6l12 12M18 6l-12 12" />
            </svg>
          </button>
          <div className="cnam-body">
            <CartNinjaAgentV2 initialQuery={initialQuery} onClose={onClose} />
          </div>
        </div>
      </div>
    </>
  );
}
