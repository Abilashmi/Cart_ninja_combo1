import { useState, useMemo, useId } from 'react';
import { formatMoneyWhole } from '../../../utils/money-display';
import { pctChange } from '../../../utils/analytics.shared';

// Visual sales report drawn in the chat: KPI tiles with trend sparklines, an
// interactive daily chart (Revenue / Orders / AOV), top products and the
// visitor → order funnel. `report` comes straight from the get_sales_report
// tool (see services/sales-report.server.js); nothing here invents numbers.

const ACCENT = '#1a9de0';
const W = 520;
const H = 176;
const PAD = { l: 46, r: 10, t: 12, b: 24 };

const TABS = [
  { key: 'revenue', label: 'Revenue', money: true },
  { key: 'orders', label: 'Orders', money: false },
  { key: 'aov', label: 'Avg. order', money: true },
];

function niceMax(v) {
  if (!(v > 0)) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
}

function shortDate(s) {
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function makeFormatters(currency) {
  const code = currency?.code || 'USD';
  const locale = currency?.locale;
  const symbol = currency?.symbol || '';
  // Whole amounts drop the ".00" so tiles and rows stay short and readable.
  const money = (v) => formatMoneyWhole(v, { currencyCode: code, locale });
  let compactFmt;
  try { compactFmt = new Intl.NumberFormat(locale || 'en', { notation: 'compact', maximumFractionDigits: 1 }); } catch { compactFmt = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }); }
  const compact = (v) => compactFmt.format(v);
  const count = (v) => new Intl.NumberFormat(locale || 'en').format(Math.round(v));
  return { money, moneyAxis: (v) => `${symbol}${compact(v)}`, compact, count };
}

function Delta({ curr, prev }) {
  if (prev == null) return null;
  if (!prev && !curr) return null;
  const isNew = !prev && curr > 0;
  const pct = isNew ? null : pctChange(curr, prev);
  const up = isNew || pct >= 0;
  const flat = pct === 0;
  const color = flat ? '#6b7280' : up ? '#15803d' : '#b91c1c';
  const bg = flat ? '#f3f4f6' : up ? '#e2f8e9' : '#fee2e2';
  return (
    <span className="bsr-delta" style={{ color, background: bg }}>
      {flat ? '–' : up ? '▲' : '▼'} {isNew ? 'New' : `${Math.abs(pct)}%`}
    </span>
  );
}

function Sparkline({ values, color }) {
  const gid = useId().replace(/:/g, '');
  if (!values || values.length < 2 || Math.max(...values) <= 0) return <div className="bsr-spark-empty" />;
  const w = 64;
  const h = 24;
  const max = Math.max(...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - (v / max) * (h - 5)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return (
    <svg className="bsr-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <defs>
        <linearGradient id={`sp-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={`url(#sp-${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrendChart({ daily, tab, fmt }) {
  const gid = useId().replace(/:/g, '');
  const [hover, setHover] = useState(null);
  const values = daily.map((d) => Number(d[tab.key]) || 0);
  const n = values.length;
  const max = niceMax(Math.max(...values, 0));
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const xAt = (i) => (n === 1 ? PAD.l + innerW / 2 : PAD.l + (i * innerW) / (n - 1));
  const yAt = (v) => PAD.t + innerH * (1 - v / max);
  const fmtVal = (v) => (tab.money ? fmt.money(v) : fmt.count(v));
  const fmtAxis = (v) => (tab.money ? fmt.moneyAxis(v) : fmt.compact(v));
  const isBars = tab.key === 'orders';
  const barW = Math.max(3, Math.min(22, (innerW / Math.max(n, 1)) * 0.62));

  const line = values.map((v, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`).join(' ');
  const area = n > 1 ? `${line} L${xAt(n - 1).toFixed(1)} ${(PAD.t + innerH).toFixed(1)} L${xAt(0).toFixed(1)} ${(PAD.t + innerH).toFixed(1)} Z` : '';
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const labelIdx = n <= 5 ? values.map((_, i) => i) : [0, 1, 2, 3, 4].map((k) => Math.round((k * (n - 1)) / 4));

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let idx = n === 1 ? 0 : Math.round(((x - PAD.l) / innerW) * (n - 1));
    idx = Math.max(0, Math.min(n - 1, idx));
    setHover(idx);
  };

  const hx = hover != null ? xAt(hover) : 0;
  const hy = hover != null ? yAt(values[hover]) : 0;
  const tipW = 118;
  const tipX = hx + tipW + 12 > W ? hx - tipW - 8 : hx + 8;
  const tipY = Math.max(PAD.t, Math.min(hy - 18, PAD.t + innerH - 40));

  return (
    <svg
      className="bsr-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${tab.label} per day`}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <defs>
        <linearGradient id={`ar-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={ACCENT} stopOpacity="0.30" />
          <stop offset="1" stopColor={ACCENT} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={yAt(t)} y2={yAt(t)} stroke="#eceef2" strokeWidth="1" strokeDasharray={i === 0 ? '0' : '3 4'} />
          <text x={PAD.l - 8} y={yAt(t) + 3.5} textAnchor="end" className="bsr-axis">{fmtAxis(t)}</text>
        </g>
      ))}
      {labelIdx.map((i, k) => (
        <text key={`${i}-${k}`} x={xAt(i)} y={H - 6} textAnchor={k === 0 && n > 1 ? 'start' : k === labelIdx.length - 1 && n > 1 ? 'end' : 'middle'} className="bsr-axis">
          {shortDate(daily[i].date)}
        </text>
      ))}
      {isBars ? (
        values.map((v, i) => (
          <rect
            key={i}
            x={xAt(i) - barW / 2}
            y={yAt(v)}
            width={barW}
            height={Math.max(0, PAD.t + innerH - yAt(v))}
            rx="3"
            fill={ACCENT}
            opacity={hover == null || hover === i ? 0.9 : 0.35}
          />
        ))
      ) : (
        <>
          {n > 1 && <path d={area} fill={`url(#ar-${gid})`} />}
          <path d={line} fill="none" stroke={ACCENT} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          {n === 1 && <circle cx={xAt(0)} cy={yAt(values[0])} r="3.5" fill={ACCENT} />}
        </>
      )}
      {hover != null && (
        <g pointerEvents="none">
          {!isBars && <line x1={hx} x2={hx} y1={PAD.t} y2={PAD.t + innerH} stroke="#c9ced8" strokeWidth="1" />}
          {!isBars && <circle cx={hx} cy={hy} r="4.5" fill="#fff" stroke={ACCENT} strokeWidth="2.2" />}
          <rect x={tipX} y={tipY} width={tipW} height="38" rx="8" fill="#111827" />
          <text x={tipX + 10} y={tipY + 15} className="bsr-tip-date">{shortDate(daily[hover].date)}</text>
          <text x={tipX + 10} y={tipY + 30} className="bsr-tip-val">{fmtVal(values[hover])}</text>
        </g>
      )}
    </svg>
  );
}

const CSS = `
.bsr{width:560px;max-width:100%;box-sizing:border-box;background:#fff;border:1px solid #e8e8ec;border-radius:16px;padding:14px;color:#111827;box-shadow:0 1px 2px rgba(16,24,40,.04);animation:bsrIn .3s ease}
.bsr *{box-sizing:border-box}
.bsr-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.bsr-title{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700}
.bsr-title-ic{width:26px;height:26px;border-radius:8px;background:#111827;color:#fff;display:flex;align-items:center;justify-content:center}
.bsr-chip{font-size:11px;font-weight:600;color:#4b5563;background:#f3f4f6;border-radius:999px;padding:3px 10px;white-space:nowrap}
.bsr-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
.bsr-kpi{background:#f9fafb;border:1px solid #eef0f3;border-radius:12px;padding:10px 12px;min-width:0}
.bsr-kpi-label{font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.04em}
.bsr-kpi-row{display:flex;align-items:flex-end;justify-content:space-between;gap:6px;margin-top:5px;min-height:24px}
.bsr-kpi-val{margin-top:3px;font-size:19px;font-weight:800;letter-spacing:-.01em;line-height:1.15;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.bsr-spark{width:64px;height:24px;flex-shrink:0}
.bsr-spark-empty{width:64px;height:24px;flex-shrink:0}
.bsr-delta{display:inline-block;align-self:flex-end;font-size:10.5px;font-weight:700;border-radius:999px;padding:1px 7px}
.bsr-sec{margin-top:14px}
.bsr-sec-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;flex-wrap:wrap}
.bsr-sec-title{font-size:12.5px;font-weight:700;color:#111827}
.bsr-tabs{display:inline-flex;background:#f3f4f6;border-radius:9px;padding:2px}
.bsr-tab{border:none;background:none;font:inherit;font-size:11.5px;font-weight:600;color:#6b7280;padding:4px 10px;border-radius:7px;cursor:pointer}
.bsr-tab[aria-pressed="true"]{background:#fff;color:#111827;box-shadow:0 1px 2px rgba(16,24,40,.12)}
.bsr-chart{width:100%;height:auto;display:block;overflow:visible}
.bsr-axis{font-size:10px;fill:#9ca3af;font-family:inherit}
.bsr-tip-date{font-size:10px;fill:#9ca3af;font-family:inherit}
.bsr-tip-val{font-size:12px;font-weight:700;fill:#fff;font-family:inherit}
.bsr-rows{display:flex;flex-direction:column;gap:8px}
.bsr-row-top{display:flex;justify-content:space-between;gap:10px;font-size:12px;margin-bottom:3px}
.bsr-row-name{font-weight:600;color:#1f2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.bsr-row-val{font-weight:700;color:#111827;white-space:nowrap}
.bsr-row-val small{font-weight:500;color:#9ca3af;margin-left:4px}
.bsr-track{height:8px;border-radius:999px;background:#eef0f3;overflow:hidden}
.bsr-fill{height:100%;border-radius:999px;transition:width .5s ease}
.bsr-step{font-size:10.5px;color:#9ca3af;margin:-2px 0 0 2px}
.bsr-empty{text-align:center;padding:26px 12px;color:#6b7280;font-size:13px;line-height:1.5}
.bsr-empty strong{display:block;color:#111827;font-size:14px;margin-bottom:4px}
@keyframes bsrIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@media (prefers-reduced-motion:reduce){.bsr{animation:none}.bsr-fill{transition:none}}
`;

const FUNNEL_COLORS = ['#1a9de0', '#3fb0e8', '#7cc8f0', '#111827'];

export default function SalesReportWidget({ report }) {
  const [tabKey, setTabKey] = useState('revenue');
  const fmt = useMemo(() => makeFormatters(report?.currency), [report]);
  if (!report) return null;

  const { totals, previous, daily = [], topProducts = [], funnel } = report;
  const tab = TABS.find((t) => t.key === tabKey) || TABS[0];
  const series = (key) => daily.map((d) => Number(d[key]) || 0);

  const kpis = [
    { key: 'revenue', label: 'Revenue', value: fmt.money(totals.revenue), curr: totals.revenue, prev: previous?.revenue, spark: series('revenue'), color: ACCENT },
    { key: 'orders', label: 'Orders', value: fmt.count(totals.orders), curr: totals.orders, prev: previous?.orders, spark: series('orders'), color: '#7c3aed' },
    { key: 'aov', label: 'Avg. order value', value: fmt.money(totals.aov), curr: totals.aov, prev: previous?.aov, spark: series('aov'), color: '#15803d' },
    { key: 'conv', label: 'Conversion', value: `${(totals.conversionRate || 0).toFixed(1)}%`, curr: totals.conversionRate, prev: previous?.conversionRate },
    { key: 'visitors', label: 'Visitors', value: fmt.count(totals.visitors), curr: totals.visitors, prev: previous?.visitors, spark: series('visitors'), color: '#c2410c' },
    { key: 'upsell', label: 'Upsell revenue', value: fmt.money(totals.upsellRevenue), curr: totals.upsellRevenue, prev: previous?.upsellRevenue },
  ];

  const topMax = Math.max(...topProducts.map((p) => p.revenue), 1);
  const funnelSteps = funnel
    ? [
        { label: 'Visitors', value: funnel.visitors },
        { label: 'Carts created', value: funnel.carts },
        { label: 'Checkout clicks', value: funnel.checkouts },
        { label: 'Orders', value: funnel.orders },
      ]
    : [];
  const funnelMax = Math.max(...funnelSteps.map((s) => s.value), 1);
  const showFunnel = funnelSteps.some((s) => s.value > 0);

  return (
    <div className="bsr">
      <style>{CSS}</style>
      <div className="bsr-head">
        <div className="bsr-title">
          <span className="bsr-title-ic">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3v18h18M7 15l4-4 3 3 5-6" /></svg>
          </span>
          Sales report
        </div>
        <span className="bsr-chip">{report.label} · {shortDate(report.startDate)}{report.startDate !== report.endDate ? ` – ${shortDate(report.endDate)}` : ''}</span>
      </div>

      {report.empty ? (
        <div className="bsr-empty">
          <strong>No sales recorded for this period</strong>
          Once orders and cart activity come in, revenue, top products and your conversion funnel will show up here.
        </div>
      ) : (
        <>
          <div className="bsr-kpis">
            {kpis.map((k) => (
              <div className="bsr-kpi" key={k.key}>
                <div className="bsr-kpi-label">{k.label}</div>
                <div className="bsr-kpi-val" title={k.value}>{k.value}</div>
                <div className="bsr-kpi-row">
                  <Delta curr={k.curr} prev={k.prev} />
                  {k.spark && <Sparkline values={k.spark} color={k.color} />}
                </div>
              </div>
            ))}
          </div>

          {daily.length > 0 && (
            <div className="bsr-sec">
              <div className="bsr-sec-head">
                <span className="bsr-sec-title">Daily trend</span>
                <div className="bsr-tabs" role="group" aria-label="Chart metric">
                  {TABS.map((t) => (
                    <button key={t.key} type="button" className="bsr-tab" aria-pressed={t.key === tab.key} onClick={() => setTabKey(t.key)}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <TrendChart daily={daily} tab={tab} fmt={fmt} />
            </div>
          )}

          {topProducts.length > 0 && (
            <div className="bsr-sec">
              <div className="bsr-sec-head"><span className="bsr-sec-title">Top products</span></div>
              <div className="bsr-rows">
                {topProducts.map((p, i) => (
                  <div key={p.product_id ?? i}>
                    <div className="bsr-row-top">
                      <span className="bsr-row-name" title={p.name}>{p.name}</span>
                      <span className="bsr-row-val">{fmt.money(p.revenue)}<small>{fmt.count(p.units_sold)} sold</small></span>
                    </div>
                    <div className="bsr-track"><div className="bsr-fill" style={{ width: `${Math.max(3, (p.revenue / topMax) * 100)}%`, background: ACCENT, opacity: 1 - i * 0.14 }} /></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showFunnel && (
            <div className="bsr-sec">
              <div className="bsr-sec-head"><span className="bsr-sec-title">Conversion funnel</span></div>
              <div className="bsr-rows">
                {funnelSteps.map((s, i) => {
                  const prevVal = i > 0 ? funnelSteps[i - 1].value : 0;
                  return (
                    <div key={s.label}>
                      <div className="bsr-row-top">
                        <span className="bsr-row-name">{s.label}</span>
                        <span className="bsr-row-val">{fmt.count(s.value)}</span>
                      </div>
                      <div className="bsr-track"><div className="bsr-fill" style={{ width: `${Math.max(s.value > 0 ? 3 : 0, (s.value / funnelMax) * 100)}%`, background: FUNNEL_COLORS[i] }} /></div>
                      {i > 0 && prevVal > 0 && <div className="bsr-step">{Math.round((s.value / prevVal) * 1000) / 10}% of {funnelSteps[i - 1].label.toLowerCase()}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
