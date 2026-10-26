/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
import { useMemo, useState } from 'react';
import { BlockStack, InlineStack, Text } from '@shopify/polaris';
import { localDate, localHour, rangeDays } from '../../utils/cod-dates.shared';

const dayLabel = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', day: 'numeric', month: 'short' });
const hourLabel = (h) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;

// COD orders in the date filter's period: per day, or per hour when the
// period is one day. Days and hours are the shop's (timeZone). Counts only
// the orders the page loaded (`cut` = the period held more), so it never
// claims more than it knows.
export default function CodOrdersChart({ orders, money, range, timeZone, cut = false }) {
  const [hover, setHover] = useState(null);
  const hourly = range.from === range.to;
  const buckets = useMemo(() => {
    const list = hourly
      ? Array.from({ length: 24 }, (_, h) => ({ key: h, label: `${dayLabel(range.from)}, ${hourLabel(h)}`, count: 0, total: 0 }))
      : rangeDays(range.from, range.to).map((d) => ({ key: d, label: dayLabel(d), count: 0, total: 0 }));
    const index = new Map(list.map((b) => [b.key, b]));
    for (const o of orders) {
      if (!o.createdAt) continue;
      const day = localDate(o.createdAt, timeZone);
      const b = hourly ? (day === range.from ? index.get(localHour(o.createdAt, timeZone)) : null) : index.get(day);
      if (b) { b.count += 1; b.total += o.total; }
    }
    return list;
  }, [orders, range.from, range.to, timeZone, hourly]);

  const max = Math.max(1, ...buckets.map((b) => b.count));
  const inRange = buckets.reduce((n, b) => n + b.count, 0);
  const n = buckets.length;
  const xLabels = hourly
    ? ['12 AM', '12 PM', '11 PM']
    : [dayLabel(range.from), dayLabel(buckets[Math.floor(n / 2)].key), range.to === range.today ? 'Today' : dayLabel(range.to)];

  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="baseline">
        <Text as="h3" variant="headingSm">{hourly ? 'COD orders per hour' : 'COD orders per day'}</Text>
        <Text as="span" variant="bodySm" tone="subdued">{range.label} · {inRange} {inRange === 1 ? 'order' : 'orders'}</Text>
      </InlineStack>
      <div className="cod-chart" role="group" aria-label={`COD orders per ${hourly ? 'hour' : 'day'}, ${range.label}`}>
        <span className="cod-chart-max">{max}</span>
        <div className="cod-chart-plot" style={{ gap: n > 120 ? 0 : n > 45 ? 1 : 2 }}>
          {buckets.map((b, i) => (
            <button
              type="button"
              key={b.key}
              className={`cod-bar${hover === i ? ' on' : ''}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${b.label}: ${b.count} ${b.count === 1 ? 'order' : 'orders'}, ${money(b.total)}`}
            >
              <span className="cod-bar-fill" style={{ height: b.count ? `${Math.max(6, (b.count / max) * 100)}%` : 0 }} />
              {hover === i && (
                <span className={`cod-tip${i > n - 4 ? ' left' : ''}`} role="presentation">
                  <b>{b.label}</b>
                  <span>{b.count} {b.count === 1 ? 'order' : 'orders'}</span>
                  <span>{money(b.total)}</span>
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="cod-chart-x">
          {xLabels.map((l, i) => <span key={i}>{l}</span>)}
        </div>
      </div>
      {!inRange && <Text as="p" variant="bodySm" tone="subdued">No COD orders in this period.</Text>}
      {cut && <Text as="p" variant="bodySm" tone="subdued">This period has more orders than the dashboard loads; the chart counts the newest ones. Pick fewer days for every order.</Text>}
    </BlockStack>
  );
}
