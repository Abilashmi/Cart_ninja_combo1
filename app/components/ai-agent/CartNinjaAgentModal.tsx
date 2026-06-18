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
          background:
            radial-gradient(circle at 72% 18%, rgba(255,107,0,0.20), transparent 28%),
            rgba(12,16,24,0.62);
          backdrop-filter: blur(10px) saturate(110%);
          -webkit-backdrop-filter: blur(10px) saturate(110%);
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
          animation: cnam-fade 0.22s ease;
        }
        @keyframes cnam-fade {
          from { opacity: 0; } to { opacity: 1; }
        }
        .cnam-modal {
          position: relative;
          width: min(1380px, 96vw);
          height: min(900px, 92vh);
          border-radius: 18px;
          overflow: hidden;
          background: #f5f6f8;
          border: 1px solid rgba(255,255,255,0.22);
          box-shadow: 0 28px 90px rgba(0,0,0,0.34);
          animation: cnam-scale 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes cnam-scale {
          from { transform: scale(0.92); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .cnam-body {
          width: 100%; height: 100%; border-radius: 18px; overflow: hidden;
        }
        .cnam-body > * { width: 100%; height: 100%; }
        @media (max-width: 600px) {
          .cnam-backdrop { padding: 0; }
          .cnam-modal { width: 100vw; height: 100vh; border-radius: 0; max-width: none; }
          .cnam-body { border-radius: 0; }
        }
      `}</style>
      <div className="cnam-backdrop" onClick={onClose}>
        <div className="cnam-modal" onClick={(e) => e.stopPropagation()}>
          <div className="cnam-body">
            <CartNinjaAgentV2 initialQuery={initialQuery} onClose={onClose} />
          </div>
        </div>
      </div>
    </>
  );
}
