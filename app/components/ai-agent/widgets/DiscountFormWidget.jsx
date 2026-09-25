import { useState } from 'react';
import { formatMoneyWhole } from '../../../utils/money-display';

// In-chat form for creating a real Shopify discount. Brix pre-fills whatever
// the merchant already said; the merchant checks the fields and clicks Create,
// which runs the matching tool directly (no extra round-trip through the LLM).
// `prefill` comes from the show_discount_form tool; `onCreate(toolName, args)`
// resolves to { success, message }.

const TYPES = [
  {
    key: 'free_shipping', label: 'Free shipping', hint: 'Applies automatically', color: '#0e7490', tint: '#e0f7fa',
    icon: <><path d="M1 6h13v10H1zM14 9h4l3 3v4h-7z" /><circle cx="5.5" cy="18.5" r="1.8" /><circle cx="17.5" cy="18.5" r="1.8" /></>,
  },
  {
    key: 'percentage_off', label: 'Percentage off', hint: 'Applies automatically', color: '#7c3aed', tint: '#f1eafe',
    icon: <><path d="M19 5L5 19" /><circle cx="7" cy="7" r="2.2" /><circle cx="17" cy="17" r="2.2" /></>,
  },
  {
    key: 'amount_off', label: 'Amount off', hint: 'Applies automatically', color: '#15803d', tint: '#e2f8e9',
    icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5c0-1 1-1.7 2.5-1.7s2.5.7 2.5 1.7-1 1.5-2.5 1.9-2.5.9-2.5 2 1 1.7 2.5 1.7 2.5-.7 2.5-1.7" /></>,
  },
  {
    key: 'discount_code', label: 'Discount code', hint: 'Customer enters a code', color: '#be185d', tint: '#fde7f1',
    icon: <><path d="M20 12l-8 8-9-9V3h8l9 9z" /><circle cx="7.5" cy="7.5" r="1" /></>,
  },
];

const CSS = `
.bdf{width:520px;max-width:100%;box-sizing:border-box;background:#fff;border:1px solid #e8e8ec;border-radius:16px;padding:14px;color:#111827;box-shadow:0 1px 2px rgba(16,24,40,.04);animation:bdfIn .3s ease}
.bdf *{box-sizing:border-box}
.bdf-head{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;margin-bottom:12px}
.bdf-head-ic{width:26px;height:26px;border-radius:8px;background:#111827;color:#fff;display:flex;align-items:center;justify-content:center}
.bdf-label{display:block;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin:14px 0 6px}
.bdf-label small{text-transform:none;letter-spacing:0;font-weight:500;color:#9ca3af;margin-left:4px}
.bdf-types{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.bdf-type{display:flex;align-items:center;gap:10px;text-align:left;font:inherit;background:#fff;border:1.5px solid #e8e8ec;border-radius:12px;padding:9px 10px;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.bdf-type:hover{border-color:#c9ced8}
.bdf-type[aria-pressed="true"]{border-color:#1a9de0;box-shadow:0 0 0 3px rgba(26,157,224,.14)}
.bdf-type:disabled{cursor:default;opacity:.6}
.bdf-type-ic{flex-shrink:0;width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center}
.bdf-type-name{display:block;font-size:13px;font-weight:700;color:#111827;line-height:1.2}
.bdf-type-hint{display:block;font-size:11px;color:#9ca3af;margin-top:1px}
.bdf-field{display:flex;align-items:center;border:1.5px solid #e2e5ea;border-radius:10px;background:#fff;overflow:hidden;transition:border-color .15s,box-shadow .15s}
.bdf-field:focus-within{border-color:#1a9de0;box-shadow:0 0 0 3px rgba(26,157,224,.14)}
.bdf-field[data-invalid="true"]{border-color:#dc2626}
.bdf-affix{padding:0 10px;font-size:13px;font-weight:700;color:#6b7280;background:#f5f6f8;align-self:stretch;display:flex;align-items:center}
.bdf-input{flex:1;min-width:0;border:none;outline:none;font:inherit;font-size:14px;padding:9px 10px;background:transparent;color:#111827}
.bdf-input::placeholder{color:#b5bac4}
.bdf-input:disabled{color:#9ca3af}
.bdf-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
.bdf-switch{position:relative;width:34px;height:20px;border-radius:999px;border:none;background:#d1d5db;cursor:pointer;flex-shrink:0;transition:background .15s;padding:0}
.bdf-switch[aria-checked="true"]{background:#1a9de0}
.bdf-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}
.bdf-switch[aria-checked="true"]::after{transform:translateX(14px)}
.bdf-switch:disabled{opacity:.6;cursor:default}
.bdf-err{font-size:11.5px;font-weight:600;color:#dc2626;margin-top:5px}
.bdf-preview{margin-top:14px;padding:10px 12px;border-radius:12px;background:#f5f8fb;border:1px dashed #cbd9e6;font-size:13px;color:#1f2937;line-height:1.45}
.bdf-preview strong{font-weight:700}
.bdf-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:14px}
.bdf-btn{border:none;font:inherit;font-size:13.5px;font-weight:700;color:#fff;background:#111827;border-radius:999px;padding:10px 22px;cursor:pointer;transition:opacity .15s,transform .15s}
.bdf-btn:hover:not(:disabled){opacity:.88;transform:translateY(-1px)}
.bdf-btn:disabled{opacity:.4;cursor:default}
.bdf-btn-ghost{background:#f3f4f6;color:#111827}
.bdf-result{margin-top:14px;padding:10px 12px;border-radius:12px;font-size:13px;font-weight:600;line-height:1.45}
.bdf-result[data-ok="true"]{background:#e2f8e9;color:#166534}
.bdf-result[data-ok="false"]{background:#fee2e2;color:#991b1b}
@keyframes bdfIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@media (max-width:420px){.bdf-types{grid-template-columns:minmax(0,1fr)}}
@media (prefers-reduced-motion:reduce){.bdf{animation:none}}
`;

function defaultTitle(kind, value, min, money) {
  const over = min ? ` Over ${money(min)}` : '';
  if (kind === 'free_shipping') return `Free Shipping${over}`;
  if (kind === 'amount_off') return `${value ? money(value) : ''} Off${over || ' Storewide'}`.trim();
  return `${value || ''}% Off${over || ' Storewide'}`.trim();
}

export default function DiscountFormWidget({ prefill, onCreate }) {
  const initialKind = TYPES.some((t) => t.key === prefill?.kind) ? prefill.kind : 'free_shipping';
  const [kind, setKind] = useState(initialKind);
  const [value, setValue] = useState(prefill?.value ? String(prefill.value) : '');
  const [hasMin, setHasMin] = useState(!!prefill?.minimumAmount);
  const [minimum, setMinimum] = useState(prefill?.minimumAmount ? String(prefill.minimumAmount) : '');
  const [code, setCode] = useState(prefill?.code || '');
  const [title, setTitle] = useState(prefill?.title || '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [touched, setTouched] = useState(false);

  const currency = prefill?.currency || {};
  const symbol = currency.symbol || '';
  const money = (v) => formatMoneyWhole(Number(v), { currencyCode: currency.code || 'USD', locale: currency.locale });

  const done = result?.success === true;
  const locked = busy || done;
  const needsValue = kind !== 'free_shipping';
  const isPercent = kind === 'percentage_off' || kind === 'discount_code';
  const valueNum = Number(value);
  const minNum = hasMin ? Number(minimum) : null;

  const errors = {};
  if (needsValue) {
    if (!(valueNum > 0)) errors.value = isPercent ? 'Enter a percentage' : 'Enter an amount';
    else if (isPercent && valueNum > 100) errors.value = 'A percentage can be at most 100';
  }
  if (hasMin && !(minNum > 0)) errors.minimum = 'Enter a minimum order amount, or switch it off';
  if (kind === 'discount_code' && !code.trim()) errors.code = 'Enter the code customers will type in';
  const invalid = Object.keys(errors).length > 0;

  const previewText = (() => {
    const over = hasMin && minNum > 0 ? ` on orders over ${money(minNum)}` : ' on every order';
    if (kind === 'free_shipping') return <>Free shipping{over}. Applies automatically at checkout.</>;
    const what = valueNum > 0 ? (isPercent ? `${valueNum}% off` : `${money(valueNum)} off`) : (isPercent ? 'Percentage off' : 'Amount off');
    if (kind === 'discount_code') return <><strong>{code.trim() || 'CODE'}</strong>: {what}{over}. Customers enter the code at checkout.</>;
    return <>{what}{over}. Applies automatically at checkout.</>;
  })();

  const submit = async () => {
    setTouched(true);
    if (invalid || locked) return;
    setBusy(true);
    setResult(null);
    const name = title.trim();
    const minArg = hasMin ? { minimumAmount: minNum } : {};
    const titleArg = name ? { title: name } : { title: defaultTitle(kind, valueNum, hasMin ? minNum : null, money) };
    let tool;
    let args;
    if (kind === 'free_shipping') { tool = 'create_free_shipping'; args = { ...minArg, ...titleArg }; }
    else if (kind === 'discount_code') { tool = 'create_discount'; args = { code: code.trim().toUpperCase(), percentage: valueNum, ...minArg, ...titleArg }; }
    else { tool = 'create_amount_off_promotion'; args = { ...(kind === 'percentage_off' ? { percentage: valueNum } : { amountOff: valueNum }), ...minArg, ...titleArg }; }
    const res = await onCreate(tool, args);
    setBusy(false);
    setResult(res);
  };

  const shown = (key) => touched && errors[key];

  return (
    <div className="bdf">
      <style>{CSS}</style>
      <div className="bdf-head">
        <span className="bdf-head-ic">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 12l-8 8-9-9V3h8l9 9z" /><circle cx="7.5" cy="7.5" r="1" /></svg>
        </span>
        Create a discount
      </div>

      <span className="bdf-label" style={{ marginTop: 0 }}>Type</span>
      <div className="bdf-types">
        {TYPES.map((t) => (
          <button key={t.key} type="button" className="bdf-type" aria-pressed={kind === t.key} disabled={locked} onClick={() => setKind(t.key)}>
            <span className="bdf-type-ic" style={{ background: t.tint, color: t.color }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{t.icon}</svg>
            </span>
            <span><span className="bdf-type-name">{t.label}</span><span className="bdf-type-hint">{t.hint}</span></span>
          </button>
        ))}
      </div>

      {kind === 'discount_code' && (
        <>
          <label className="bdf-label" htmlFor="bdf-code">Discount code</label>
          <div className="bdf-field" data-invalid={!!shown('code')}>
            <input id="bdf-code" className="bdf-input" value={code} disabled={locked} placeholder="e.g. SUMMER20" onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} />
          </div>
          {shown('code') && <div className="bdf-err">{errors.code}</div>}
        </>
      )}

      {needsValue && (
        <>
          <label className="bdf-label" htmlFor="bdf-value">{isPercent ? 'Discount percentage' : 'Discount amount'}</label>
          <div className="bdf-field" data-invalid={!!shown('value')}>
            {!isPercent && <span className="bdf-affix">{symbol}</span>}
            <input id="bdf-value" className="bdf-input" inputMode="decimal" value={value} disabled={locked} placeholder={isPercent ? '10' : '200'} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))} />
            {isPercent && <span className="bdf-affix">%</span>}
          </div>
          {shown('value') && <div className="bdf-err">{errors.value}</div>}
        </>
      )}

      <div className="bdf-label bdf-row" style={{ marginBottom: hasMin ? 6 : 0 }}>
        <span>Minimum order<small>optional</small></span>
        <button type="button" role="switch" aria-checked={hasMin} aria-label="Require a minimum order amount" className="bdf-switch" disabled={locked} onClick={() => setHasMin((v) => !v)} />
      </div>
      {hasMin && (
        <>
          <div className="bdf-field" data-invalid={!!shown('minimum')}>
            <span className="bdf-affix">{symbol}</span>
            <input className="bdf-input" inputMode="decimal" aria-label="Minimum order amount" value={minimum} disabled={locked} placeholder="3000" onChange={(e) => setMinimum(e.target.value.replace(/[^0-9.]/g, ''))} />
          </div>
          {shown('minimum') && <div className="bdf-err">{errors.minimum}</div>}
        </>
      )}

      <label className="bdf-label" htmlFor="bdf-title">Name<small>optional, only you see it</small></label>
      <div className="bdf-field">
        <input id="bdf-title" className="bdf-input" value={title} disabled={locked} maxLength={80} placeholder={kind === 'free_shipping' || valueNum > 0 ? defaultTitle(kind, valueNum || '', hasMin && minNum > 0 ? minNum : null, money) : 'Name your discount'} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="bdf-preview">{previewText}</div>

      {result && (
        <div className="bdf-result" data-ok={done} role="status">
          {done ? result.message : (result.message || "That didn't go through. Please try again.")}
        </div>
      )}

      {!done && (
        <div className="bdf-actions">
          <button type="button" className="bdf-btn" onClick={submit} disabled={busy || (touched && invalid)}>
            {busy ? 'Creating…' : result ? 'Try again' : 'Create discount'}
          </button>
        </div>
      )}
    </div>
  );
}
