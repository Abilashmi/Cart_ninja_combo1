/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
// Building blocks of the COD settings page (app.cod.jsx, Settings view).
// Styles: codSettingsStyles.js (everything prefixed bcod-).
import { useState } from 'react';
import { Button, Icon, TextField } from '@shopify/polaris';
import { CheckIcon } from '@shopify/polaris-icons';
import { codCharges } from '../../utils/cod.shared';
import { codButtonColors, codFeeLabel } from './codButtonLook';

/** The shopper's path through COD, on one line. A step that's switched off shows as skipped, not hidden. */
export function CodFlow({ otpOn }) {
  const steps = [
    { label: 'Cart drawer' },
    { label: 'COD', accent: true },
    { label: 'Phone verification', off: !otpOn },
    { label: 'Address' },
    { label: 'Review' },
    { label: 'Order', done: true },
  ];
  return (
    <ol className="bcod-flow" aria-label="Cash on Delivery steps for shoppers">
      {steps.map((s) => (
        <li key={s.label} className={`bcod-flow-s${s.accent ? ' is-accent' : ''}${s.off ? ' is-off' : ''}${s.done ? ' is-done' : ''}`} title={s.off ? 'Skipped right now' : undefined}>
          {s.done ? <Icon source={CheckIcon} /> : null}
          {s.label}
        </li>
      ))}
    </ol>
  );
}

/* ---------- Cart drawer integration ---------- */

export const PLACEMENT_OPTIONS = [
  { id: 'replace', title: 'Replace Checkout', text: 'Only the COD button. Shoppers can still pay online from the COD popup.' },
  { id: 'above', title: 'Above Checkout', text: 'COD first, your Checkout button under it.' },
  { id: 'below', title: 'Below Checkout', text: 'Checkout first, COD under it.' },
];

// The bottom of a cart drawer (subtotal + buttons), stacked as on the storefront.
function MiniFooter({ placement, buttons }) {
  const cod = <b key="cod" className="bcod-mini-cod" style={codButtonColors(buttons)}>Cash on Delivery</b>;
  const checkout = <b key="co" className="bcod-mini-co">Checkout</b>;
  let stack = [cod, checkout];
  if (placement === 'replace') stack = [cod];
  if (placement === 'below') stack = [checkout, cod];
  return (
    <span className="bcod-mini" aria-hidden="true">
      <span className="bcod-mini-sub"><i /><i /></span>
      <span className="bcod-mini-btns">{stack}</span>
    </span>
  );
}

// The same three choices on combo pages, next to the combo's Checkout button.
export const COMBO_PLACEMENT_OPTIONS = [
  { id: 'replace', title: 'Replace Checkout', text: 'Only the COD button. Shoppers can still pay online from the COD popup.' },
  { id: 'above', title: 'Above Checkout', text: 'COD first, Checkout after it (on wide screens: COD on the left).' },
  { id: 'below', title: 'Below Checkout', text: 'Checkout first, COD after it. How combo pages always looked.' },
];

/** Where COD goes next to Checkout (cart drawer, or `where`): one option per row, picture on the left. */
export function PlacementPicker({ value, onChange, buttons, disabled, options = PLACEMENT_OPTIONS, where = 'the cart drawer' }) {
  return (
    <div className="bcod-place" role="radiogroup" aria-label={`Where COD appears in ${where}`}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            className={`bcod-place-o${on ? ' is-on' : ''}`}
            onClick={() => onChange(o.id)}
          >
            <MiniFooter placement={o.id} buttons={buttons} />
            <span className="bcod-place-m">
              <span className="bcod-place-t">{o.title}</span>
              <span className="bcod-place-d">{o.text}</span>
            </span>
            <span className="bcod-place-r" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

/* ---------- COD button ---------- */

export const BUTTON_STYLES = [
  { id: 'filled', label: 'Filled' },
  { id: 'outline', label: 'Outline' },
  { id: 'minimal', label: 'Minimal' },
];

export function ButtonStylePicker({ value, onChange, buttons }) {
  return (
    <div className="bcod-seg" role="radiogroup" aria-label="Button style">
      {BUTTON_STYLES.map((s) => (
        <button key={s.id} type="button" role="radio" aria-checked={value === s.id} className={`bcod-seg-o${value === s.id ? ' is-on' : ''}`} onClick={() => onChange(s.id)}>
          <span className="bcod-seg-art" style={{ ...codButtonColors({ ...buttons, style: s.id }), borderRadius: Math.min(buttons.radius ?? 12, 14) }} />
          {s.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- COD fee ---------- */

const SAMPLE_SUBTOTAL = 1299;

/** The COD review step's totals for a sample cart, as shoppers will see them. */
export function FeeSummary({ settings, money }) {
  const charges = codCharges(settings, SAMPLE_SUBTOTAL);
  const hidden = settings.showCodFee === false && charges.codFee > 0;
  return (
    <div className="bcod-sum" aria-label="Order summary preview">
      <span className="bcod-sum-k">Order summary</span>
      <div className="bcod-sum-r"><span>Subtotal</span><span>{money(SAMPLE_SUBTOTAL)}</span></div>
      {hidden ? (
        <div className="bcod-sum-r"><span>Delivery charges</span><span>{money(charges.total)}</span></div>
      ) : (
        <>
          {charges.shipping > 0 && <div className="bcod-sum-r"><span>Shipping</span><span>{money(charges.shipping)}</span></div>}
          {charges.codFee > 0 && <div className="bcod-sum-r is-fee"><span>{codFeeLabel(settings)}</span><span>{money(charges.codFee)}</span></div>}
        </>
      )}
      <div className="bcod-sum-r is-tot"><span>Total</span><span>{money(SAMPLE_SUBTOTAL + charges.total)}</span></div>
    </div>
  );
}

/* ---------- eligibility ---------- */

const TAG_RE = /^[\w\- .:/]{1,40}$/; // same as parseTags in utils/cod.shared.js

/**
 * Excluded Shopify product tags, edited as removable chips. `value` is the
 * form's comma-separated string. Enter, a comma or the Add button adds; a
 * pasted list adds every tag in it.
 */
export function ExcludedTagsInput({ value, onChange }) {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState('');
  const tags = value.split(/[,\n]+/).map((t) => t.trim()).filter(Boolean);
  const add = (raw) => {
    const parts = String(raw).split(/[,\n]+/).map((t) => t.trim()).filter(Boolean);
    if (!parts.length) return;
    const bad = parts.filter((t) => !TAG_RE.test(t));
    if (bad.length) { setProblem(`"${bad[0]}" can't be a Shopify tag here. Use letters, numbers, spaces and - _ . : / (up to 40).`); return; }
    const known = new Set(tags.map((t) => t.toLowerCase()));
    const fresh = parts.filter((t) => !known.has(t.toLowerCase()) && known.add(t.toLowerCase()));
    if (!fresh.length) { setProblem(`${parts[0]} is already added.`); return; }
    onChange([...tags, ...fresh].join(', '));
    setDraft('');
    setProblem('');
  };
  const remove = (tag) => onChange(tags.filter((t) => t !== tag).join(', '));
  return (
    <div className="bcod-tagin">
      <form className="bcod-tags" onSubmit={(e) => { e.preventDefault(); add(draft); }}>
        <div>
          <TextField
            label="Excluded product tags"
            value={draft}
            onChange={(v) => { setProblem(''); if (/[,\n]/.test(v)) add(v); else setDraft(v); }}
            placeholder="Enter Shopify product tag"
            helpText="Products with these tags cannot use Cash on Delivery."
            error={problem || undefined}
            autoComplete="off"
            connectedRight={<Button submit variant="primary" disabled={!draft.trim()}>Add</Button>}
          />
        </div>
      </form>
      {tags.length ? (
        <div className="bcod-chips" aria-label="Excluded tags">
          {tags.map((t) => {
            const ok = TAG_RE.test(t);
            return (
              <span key={t} className={`bcod-chip${ok ? '' : ' is-bad'}`} title={ok ? undefined : 'Not a valid tag, will be skipped'}>
                {t}
                <button type="button" aria-label={`Remove ${t}`} onClick={() => remove(t)}>×</button>
              </span>
            );
          })}
        </div>
      ) : (
        <div className="bcod-empty">No excluded tags. Every product can use Cash on Delivery.</div>
      )}
    </div>
  );
}
