/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
import { useMemo, useState } from 'react';
import { BlockStack, InlineStack, Text } from '@shopify/polaris';

const DAYS = 14;

function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// COD orders per day for the last two weeks, from the orders the page already
// loaded (the latest 50), so it never claims more than it knows.
export default function CodOrdersChart({ orders, money }) {
  const [hover, setHover] = useState(null);
  const days = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const list = [];
    const index = {};
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const entry = { date: d, count: 0, total: 0 };
      index[dayKey(d)] = entry;
      list.push(entry);
    }
    for (const o of orders) {
      if (!o.createdAt) continue;
      const entry = index[dayKey(new Date(o.createdAt))];
      if (entry) { entry.count += 1; entry.total += o.total; }
    }
    return list;
  }, [orders]);

  const max = Math.max(1, ...days.map((d) => d.count));
  const inRange = days.reduce((n, d) => n + d.count, 0);
  const label = (d) => d.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="baseline">
        <Text as="h3" variant="headingSm">COD orders per day</Text>
        <Text as="span" variant="bodySm" tone="subdued">Last {DAYS} days · {inRange} {inRange === 1 ? 'order' : 'orders'}</Text>
      </InlineStack>
      <div className="cod-chart" role="group" aria-label={`COD orders per day, last ${DAYS} days`}>
        <span className="cod-chart-max">{max}</span>
        <div className="cod-chart-plot">
          {days.map((d, i) => (
            <button
              type="button"
              key={i}
              className={`cod-bar${hover === i ? ' on' : ''}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${label(d)}: ${d.count} ${d.count === 1 ? 'order' : 'orders'}, ${money(d.total)}`}
            >
              <span className="cod-bar-fill" style={{ height: d.count ? `${Math.max(6, (d.count / max) * 100)}%` : 0 }} />
              {hover === i && (
                <span className={`cod-tip${i > DAYS - 4 ? ' left' : ''}`} role="presentation">
                  <b>{label(d)}</b>
                  <span>{d.count} {d.count === 1 ? 'order' : 'orders'}</span>
                  <span>{money(d.total)}</span>
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="cod-chart-x">
          <span>{label(days[0])}</span>
          <span>{label(days[Math.floor(DAYS / 2)])}</span>
          <span>Today</span>
        </div>
      </div>
      {!inRange && <Text as="p" variant="bodySm" tone="subdued">No COD orders in the last {DAYS} days yet.</Text>}
    </BlockStack>
  );
}
