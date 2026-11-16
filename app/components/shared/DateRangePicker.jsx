/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
// Shopify-analytics style date filter: a button showing the period opens a
// popover with the quick periods on the left, two date boxes and a two-month
// calendar, and Cancel / Apply. `range` = resolveCodRange() from the loader;
// `onApply({ preset })` for a quick period, `onApply({ from, to })` for days.
import { useState } from 'react';
import { Button, DatePicker, Popover, TextField } from '@shopify/polaris';
import { CalendarIcon } from '@shopify/polaris-icons';
import { COD_RANGE_PRESETS } from '../../utils/cod-dates.shared';

const toDate = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d); };
const toYmd = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const longDate = (date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

const CSS = `
.drp{display:flex;width:min(760px,92vw)}
.drp-presets{width:170px;flex:none;background:#f7f7f7;padding:12px 8px;display:flex;flex-direction:column;gap:2px;border-right:1px solid #e3e3e3}
.drp-p{all:unset;box-sizing:border-box;cursor:pointer;padding:7px 10px;border-radius:8px;font-size:13px;color:#303030}
.drp-p:hover{background:#ebebeb}
.drp-p.on{background:#e3e3e3;font-weight:600}
.drp-p:focus-visible{outline:2px solid #005bd3;outline-offset:1px}
.drp-sep{height:1px;background:#e3e3e3;margin:6px 4px}
.drp-main{flex:1;min-width:0;padding:12px 16px 14px;display:flex;flex-direction:column;gap:12px}
.drp-inputs{display:flex;align-items:center;gap:10px}
.drp-inputs>div{flex:1;min-width:0}
.drp-foot{display:flex;justify-content:flex-end;gap:8px;border-top:1px solid #e3e3e3;padding-top:12px}
@media (max-width:640px){.drp{flex-direction:column}.drp-presets{width:auto;flex-direction:row;flex-wrap:wrap;border-right:0;border-bottom:1px solid #e3e3e3}}
`;

export default function DateRangePicker({ range, onApply, presetLabel }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(null);
  const [startText, setStartText] = useState('');
  const [endText, setEndText] = useState('');
  const [view, setView] = useState({ month: 0, year: 2000 });

  const choose = (start, end) => {
    setPicked({ start, end });
    setStartText(longDate(start));
    setEndText(longDate(end));
  };
  const show = () => {
    const end = toDate(range.to);
    choose(toDate(range.from), end);
    // Two months side by side: end on the right, the month before on the left.
    const left = new Date(end.getFullYear(), end.getMonth() - 1, 1);
    setView({ month: left.getMonth(), year: left.getFullYear() });
    setOpen(true);
  };
  const close = () => setOpen(false);
  const pickPreset = (id) => { setOpen(false); if (id !== range.preset) onApply({ preset: id }); };
  const apply = () => {
    setOpen(false);
    if (!picked) return;
    const from = toYmd(picked.start);
    const to = toYmd(picked.end);
    if (range.preset !== 'custom' || from !== range.from || to !== range.to) onApply({ from, to });
  };
  // A typed date counts once it reads as a real day that is not in the future.
  const typed = (text, which) => {
    const d = new Date(text);
    if (Number.isNaN(d.getTime()) || toYmd(d) > range.today) { choose(picked.start, picked.end); return; }
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const start = which === 'start' ? day : picked.start;
    const end = which === 'end' ? day : picked.end;
    if (start <= end) choose(start, end); else choose(day, day);
    setView({ month: Math.max(0, day.getMonth() - 1), year: day.getFullYear() });
  };

  const label = (p) => (presetLabel ? presetLabel(p) : p.label);

  return (
    <>
      <style>{CSS}</style>
      <Popover
        active={open}
        onClose={close}
        preferredAlignment="right"
        autofocusTarget="none"
        activator={<Button icon={CalendarIcon} disclosure={open ? 'up' : 'down'} onClick={open ? close : show}>{range.preset === 'custom' ? range.label : label(COD_RANGE_PRESETS.find((p) => p.id === range.preset) || COD_RANGE_PRESETS[3])}</Button>}
      >
        <div className="drp">
          <div className="drp-presets" aria-label="Quick periods">
            {COD_RANGE_PRESETS.slice(0, 2).map((p) => (
              <button key={p.id} type="button" className={`drp-p${range.preset === p.id ? ' on' : ''}`} aria-pressed={range.preset === p.id} onClick={() => pickPreset(p.id)}>{label(p)}</button>
            ))}
            <div className="drp-sep" />
            {COD_RANGE_PRESETS.slice(2).map((p) => (
              <button key={p.id} type="button" className={`drp-p${range.preset === p.id ? ' on' : ''}`} aria-pressed={range.preset === p.id} onClick={() => pickPreset(p.id)}>{label(p)}</button>
            ))}
            <div className="drp-sep" />
            <button type="button" className={`drp-p${range.preset === 'custom' ? ' on' : ''}`} aria-pressed={range.preset === 'custom'} onClick={() => {}}>Custom range</button>
          </div>
          <div className="drp-main">
            <div className="drp-inputs">
              <TextField label="Start date" labelHidden autoComplete="off" value={startText} onChange={setStartText} onBlur={() => typed(startText, 'start')} />
              <span aria-hidden="true">→</span>
              <TextField label="End date" labelHidden autoComplete="off" value={endText} onChange={setEndText} onBlur={() => typed(endText, 'end')} />
            </div>
            <DatePicker
              month={view.month}
              year={view.year}
              onMonthChange={(month, year) => setView({ month, year })}
              selected={picked || undefined}
              onChange={(r) => choose(r.start, r.end)}
              allowRange
              multiMonth
              disableDatesAfter={toDate(range.today)}
            />
            <div className="drp-foot">
              <Button onClick={close}>Cancel</Button>
              <Button variant="primary" onClick={apply} disabled={!picked}>Apply</Button>
            </div>
          </div>
        </div>
      </Popover>
    </>
  );
}
