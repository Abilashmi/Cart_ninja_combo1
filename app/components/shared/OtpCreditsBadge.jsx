/* eslint-disable react/prop-types */
// Reminder of the store's OTP credits, top left corner of Home and the COD module pages only (dashboard, OTP activity); not on Customize, whose OTP SMS section has its own wallet card (mounted
// once in routes/app.jsx). Shows the balance and how many codes it covers;
// blinking dot when running low, white when empty (shoppers then skip phone
// verification). A tap opens COD → Customize → OTP SMS, where "Recharge" is.
// Loads from /api/otp-credits (nothing shows for stores that use their own MSG91
// keys), refreshes when the tab is visible again and every 2 minutes.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

const API = '/api/otp-credits';
const REFRESH_MS = 120000;
const LOW_CODES = 20;

const CSS = `
.bxoc{position:fixed;top:0;left:14px;z-index:400;display:flex;align-items:center;gap:6px;border:1px solid #000;border-top:0;background:#000;color:#fff;border-radius:0 0 8px 8px;padding:5px 14px 6px;font:600 12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,.25)}
.bxoc:hover{background:#222}
.bxoc-dot{width:7px;height:7px;border-radius:50%;background:#fff;flex:none}
.bxoc--low .bxoc-dot{animation:bxoc-blink 1.4s ease-in-out infinite}
.bxoc--empty{background:#fff;color:#000}.bxoc--empty:hover{background:#f1f1f1}.bxoc--empty .bxoc-dot{background:#000}
.bxoc-plus{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:#fff;color:#000;font-size:14px;font-weight:700;line-height:1;margin-left:2px;flex:none}
.bxoc--empty .bxoc-plus{background:#000;color:#fff}
.bxoc-sub{font-weight:500;opacity:.7}
@keyframes bxoc-blink{50%{opacity:.25}}
@media (prefers-reduced-motion:reduce){.bxoc--low .bxoc-dot{animation:none}}
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

  // Only on Home and the COD module (dashboard, Customize incl. OTP SMS, OTP activity).
  const onPage = pathname === '/app' || pathname === '/app/' || (pathname.startsWith('/app/cod') && !pathname.startsWith('/app/cod/customize'));
  if (!onPage || !data || !data.show) return null;
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
        <span className="bxoc-plus" aria-hidden="true">+</span>
      </button>
    </>
  );
}
