/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
// The COD dashboard's date filter: quick periods (Today, Yesterday, Last 7
// days, ...) apply at once; any days can be picked on the calendar and applied.
// `range` = resolveCodRange() from the loader (days in the shop's time zone).
import { useState } from 'react';
import { BlockStack, Button, DatePicker, InlineStack, Popover, Text } from '@shopify/polaris';
import { CalendarIcon } from '@shopify/polaris-icons';
import { COD_RANGE_PRESETS, rangeText } from '../../utils/cod-dates.shared';

// Calendar days as the DatePicker's local Dates and back (no time zone maths: just the day).
const toDate = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d); };
const toYmd = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export default function CodDateRange({ range, onApply, loading = false }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(null); // { start, end } Dates while choosing on the calendar
  const [view, setView] = useState(() => { const d = toDate(range.to); return { month: d.getMonth(), year: d.getFullYear() }; });

  const show = () => {
    setPicked({ start: toDate(range.from), end: toDate(range.to) });
    const d = toDate(range.to);
    setView({ month: d.getMonth(), year: d.getFullYear() });
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

  return (
    <div className="cod-dr-wrap">
      <Popover
        active={open}
        onClose={close}
        preferredAlignment="right"
        autofocusTarget="first-node"
        activator={<Button icon={CalendarIcon} disclosure onClick={open ? close : show} loading={loading}>{range.label}</Button>}
      >
        <div className="cod-dr">
          <div className="cod-dr-presets" aria-label="Quick periods">
            {COD_RANGE_PRESETS.map((p) => (
              <button key={p.id} type="button" className={`cod-dr-p${range.preset === p.id ? ' on' : ''}`} aria-pressed={range.preset === p.id} onClick={() => pickPreset(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="cod-dr-cal">
            <BlockStack gap="300">
              <DatePicker
                month={view.month}
                year={view.year}
                onMonthChange={(month, year) => setView({ month, year })}
                selected={picked || undefined}
                onChange={setPicked}
                allowRange
                disableDatesAfter={toDate(range.today)}
              />
              <Text as="p" variant="bodySm" tone="subdued">{picked ? rangeText(toYmd(picked.start), toYmd(picked.end)) : 'Pick the first and the last day.'}</Text>
              <InlineStack align="end" gap="200">
                <Button onClick={close}>Cancel</Button>
                <Button variant="primary" onClick={apply} disabled={!picked}>Apply</Button>
              </InlineStack>
            </BlockStack>
          </div>
        </div>
      </Popover>
      {range.preset !== 'custom' && <span className="cod-dr-dates">{rangeText(range.from, range.to)}</span>}
    </div>
  );
}
