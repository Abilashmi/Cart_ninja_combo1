/* eslint-disable react/prop-types */
// Reminder of the store's OTP credits, top right of every admin page (mounted
// once in routes/app.jsx). Shows the balance and how many codes it covers;
// amber when running low, red when empty (shoppers then skip phone
// verification). A tap opens COD → Customize → OTP SMS, where "Recharge" is.
// Loads from /api/otp-credits (nothing shows for stores that use their own MSG91
// keys), refreshes when the tab is visible again and every 2 minutes.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

const API = '/api/otp-credits';
const REFRESH_MS = 120000;
const LOW_CODES = 20;

const CSS = `
.bxoc{position:fixed;top:6px;right:14px;z-index:400;display:flex;align-items:center;gap:6px;border:1px solid #d5dae1;background:#fff;color:#1a1d23;border-radius:999px;padding:3px 11px 3px 9px;font:600 12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;cursor:pointer;box-shadow:0 1px 3px rgba(15,23,42,.12)}
.bxoc:hover{background:#f6f7f9}
.bxoc-dot{width:8px;height:8px;border-radius:50%;background:#14a05a;flex:none}
.bxoc--low{border-color:#e0b24a;background:#fff8e6}.bxoc--low .bxoc-dot{background:#e09b00}
.bxoc--empty{border-color:#e07b73;background:#fff1f0;color:#8e1f14}.bxoc--empty .bxoc-dot{background:#d72c0d}
.bxoc-sub{font-weight:500;opacity:.75}
@media (max-width:480px){.bxoc-sub{display:none}}
`;

function rupees(paise) {
  const v = (Number(paise) || 0) / 100;
  return `₹${Number.isInteger(v) ? v : v.toFixed(2)}`;
}

export default function OtpCreditsBadge() {
  const [data, setData] = useState(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    let alive = true;
    const load = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetch(API, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (alive && j) setData(j); })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    document.addEventListener('visibilitychange', load);
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [pathname]);

  if (!data || !data.show) return null;
  const codes = Number(data.messagesLeft) || 0;
  const level = codes <= 0 ? 'empty' : codes <= LOW_CODES ? 'low' : '';
  const label = codes <= 0 ? 'OTP credits: ₹0, recharge' : `OTP credits ${rupees(data.balancePaise)}`;
  return (
    <>
      <style>{CSS}</style>
      <button
        type="button"
        className={`bxoc ${level ? `bxoc--${level}` : ''}`}
        data-clarity-mask="true"
        title={codes <= 0 ? 'Your OTP credits are finished. Shoppers skip phone verification until you recharge.' : `About ${codes} OTP codes left. Tap to recharge.`}
        onClick={() => navigate('/app/cod/customize?section=sms')}
      >
        <span className="bxoc-dot" />
        <span>{label}</span>
        {codes > 0 && <span className="bxoc-sub">· {codes} codes</span>}
      </button>
    </>
  );
}
