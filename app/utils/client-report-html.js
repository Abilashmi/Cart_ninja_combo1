// Draws a buildClientReport() result as one self-contained HTML page: no
// scripts, no outside requests, so the downloaded file can be sent to the
// merchant as it is. Every value is escaped.
import { ORDER_HISTORY_DAYS } from './client-report.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SERIES = [
  { key: 'brixCod', label: 'BRIX COD', color: 'var(--c-brix)' },
  { key: 'otherCod', label: 'Other COD', color: 'var(--c-other)' },
  { key: 'paid', label: 'Paid online', color: 'var(--c-paid)' },
];

function formatters(currency) {
  const money = new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 });
  const count = new Intl.NumberFormat('en-US');
  const dash = (f) => (v) => (v == null || Number.isNaN(v) ? '—' : f(v));
  return {
    money: dash((v) => money.format(v)),
    count: dash((v) => count.format(v)),
    pct: dash((v) => `${Math.round(v * 100)}%`),
    rate: dash((v) => v.toFixed(1)),
    day: (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }),
    dayLong: (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }),
    weekday: (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }),
  };
}

function niceTicks(max) {
  if (max <= 0) return [0, 1];
  const raw = max / 5;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  const ticks = [];
  for (let t = 0; t <= max + step * 0.999; t += step) ticks.push(Math.round(t));
  return ticks;
}

function chartSvg(daily, f) {
  const W = 960, H = 300, top = 16, bottom = 28, right = 8;
  const ticks = niceTicks(Math.max(...daily.map((d) => d.paid + d.otherCod + d.brixCod), 0));
  const yMax = ticks[ticks.length - 1];
  const left = 12 + String(f.count(yMax)).length * 8;
  const step = (W - left - right) / daily.length;
  const bw = Math.min(28, step * 0.75);
  const y = (v) => top + (H - top - bottom) * (1 - v / yMax);
  const labelEvery = Math.max(1, Math.ceil(daily.length / 12));
  const grid = ticks.map((t) => `<line x1="${left}" x2="${W - right}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? 'axis' : 'grid'}"/><text x="${left - 8}" y="${y(t)}" dy="0.32em" text-anchor="end" class="tick">${esc(f.count(t))}</text>`).join('');
  const bars = daily.map((d, i) => {
    const x = left + i * step + (step - bw) / 2;
    let base = 0;
    const parts = SERIES.map((s) => {
      const v = d[s.key];
      if (!v) return '';
      const r = `<rect x="${x.toFixed(1)}" y="${y(base + v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(base) - y(base + v)).toFixed(1)}" style="fill:${s.color}"/>`;
      base += v;
      return r;
    }).join('');
    const title = `${f.weekday(d.day)}: ${SERIES.map((s) => `${s.label} ${d[s.key]}`).join(', ')}`;
    const label = i % labelEvery === 0 ? `<text x="${(left + i * step + step / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="tick">${esc(f.day(d.day))}</text>` : '';
    return `<g><title>${esc(title)}</title>${parts}<rect x="${(left + i * step).toFixed(1)}" y="${top}" width="${step.toFixed(1)}" height="${H - top - bottom}" class="hit"/></g>${label}`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Orders per day by payment">${grid}${bars}</svg>`;
}

function table(head, rows, wrapClass = 'scroll') {
  return `<div class="${wrapClass}"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => (typeof c === 'object' && c ? `<td class="${c.cls || ''}">${esc(c.v)}</td>` : `<td>${esc(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>`;
}

const muted = (v, shown) => ({ v: shown, cls: v ? '' : 'zero' });
const bad = (v, shown) => ({ v: shown, cls: v ? 'bad' : 'zero' });

/**
 * @param report buildClientReport() result
 * @param opts { toolbar?: { backHref, downloadHref, csvHref?, share?: { action, fields, days, defaultDays } } } — the toolbar
 *   is left out of the downloaded file and shared links; share = a form that saves a share link
 */
export function renderClientReportHtml(report, opts = {}) {
  const f = formatters(report.currency);
  const s = Object.fromEntries(report.summary.map((r) => [r.key, r]));
  const p = report.previousSummary ? Object.fromEntries(report.previousSummary.map((r) => [r.key, r])) : null;
  const range = `${f.dayLong(report.from)} to ${f.dayLong(report.to)}`;
  const prevRange = `${f.dayLong(report.prevFrom)} to ${f.dayLong(report.prevTo)}`;
  const ct = report.comboTotal;
  const otherVia = report.otherCodVia.length ? report.otherCodVia.map((v) => `${v.app} (${f.count(v.orders)})`).join(', ') : 'none in this period';

  const tiles = [
    { label: 'Paid online', dot: 'paid', big: f.count(s.paid.orders), lines: [`${f.money(s.paid.value)} in orders · avg ${f.money(s.paid.avgOrder)}`, `${f.pct(s.paid.share)} of all orders`] },
    { label: 'BRIX COD', dot: 'brix', big: f.count(s.brix_cod.orders), lines: [`${f.money(s.brix_cod.value)} in orders · avg ${f.money(s.brix_cod.avgOrder)}`, `${f.count(s.brix_cod.kept)} not cancelled, ${f.count(s.brix_cod.cancelled)} cancelled`] },
    { label: 'Other COD', dot: 'other', big: f.count(s.other_cod.orders), lines: [`${f.money(s.other_cod.value)} in orders · avg ${f.money(s.other_cod.avgOrder)}`, `${f.count(s.other_cod.kept)} not cancelled, ${f.count(s.other_cod.cancelled)} cancelled`] },
    { label: 'COD orders not cancelled', big: f.pct(s.brix_cod.keptRate), lines: ['of BRIX COD orders', `Other COD: ${f.pct(s.other_cod.keptRate)}`] },
  ];
  if (report.comboTracked) tiles.push({ label: 'Combo page orders', big: f.count(ct.orders), lines: [`${f.count(ct.paid)} paid online, ${f.count(ct.cod)} COD · ${f.count(ct.kept)} not cancelled`, `${f.count(ct.views)} page views · ${f.count(ct.presses)} button presses`] });

  const compare = p ? `
  <section class="card">
    <h2>Compared with the ${esc(report.days)} days before</h2>
    <p class="note">Before: ${esc(prevRange)}. This report: ${esc(range)}.</p>
    ${table(['Payment', 'Orders a day, before', 'Orders a day, now', 'Share of orders, before', 'Share of orders, now', 'Not cancelled, before', 'Not cancelled, now', 'Avg order, now'],
      ['paid', 'other_cod', 'brix_cod', 'all_cod'].map((k) => [s[k].label, f.rate(p[k].perDay), f.rate(s[k].perDay), f.pct(p[k].share), f.pct(s[k].share), f.pct(p[k].keptRate), f.pct(s[k].keptRate), f.money(s[k].avgOrder)]))}
  </section>` : `
  <section class="card">
    <h2>Compared with the ${esc(report.days)} days before</h2>
    <p class="note">Not shown: those days (${esc(prevRange)}) are older than the ${esc(ORDER_HISTORY_DAYS)} days of orders Shopify gives the app.</p>
  </section>`;

  const entries = report.brixEntries.length ? `
    <section class="card">
      <h2>BRIX COD by where it was placed</h2>
      <p class="note">Shoppers can order COD from the cart drawer, the product page or a combo page.</p>
      ${table(['Placed from', 'Orders', 'Not cancelled', 'Share not cancelled', 'Order value'], report.brixEntries.map((e) => [e.entry, f.count(e.orders), f.count(e.kept), f.pct(e.keptRate), f.money(e.value)]))}
    </section>` : '';

  const combo = report.comboTracked ? `
  <section class="card">
    <h2>Combo pages</h2>
    <p class="note">Page views count every time a combo page was opened. Button presses count taps on the page's Checkout or COD button. Orders are the store's orders that came from each combo page.</p>
    ${report.combo.length ? table(['Combo page', 'Page views', 'Checkout or COD presses', 'Orders', 'Paid online', 'COD', 'Not cancelled', 'Order value'],
      report.combo.map((c) => [c.name, f.count(c.views), muted(c.presses, f.count(c.presses)), muted(c.orders, f.count(c.orders)), muted(c.paid, f.count(c.paid)), muted(c.cod, f.count(c.cod)), muted(c.kept, f.count(c.kept)), f.money(c.value)])) : '<p class="note">No combo page activity in this period.</p>'}
  </section>` : '';

  const dailyHead = ['Day', 'Paid online', 'Paid order value', 'Other COD', 'Other COD cancelled', 'BRIX COD', 'BRIX COD cancelled', 'BRIX COD order value', 'COD share'];
  if (report.comboTracked) dailyHead.push('Combo page views', 'Combo button presses', 'Combo orders');
  const dailyRows = report.daily.map((d) => {
    const row = [f.weekday(d.day), muted(d.paid, f.count(d.paid)), f.money(d.paidValue), muted(d.otherCod, f.count(d.otherCod)), bad(d.otherCodCancelled, f.count(d.otherCodCancelled)),
      muted(d.brixCod, f.count(d.brixCod)), bad(d.brixCodCancelled, f.count(d.brixCodCancelled)), f.money(d.brixValue), f.pct(d.codShare)];
    if (report.comboTracked) row.push(muted(d.comboViews, f.count(d.comboViews)), muted(d.comboPresses, f.count(d.comboPresses)), muted(d.comboOrders, f.count(d.comboOrders)));
    return row;
  });

  const generated = new Date(report.generatedAt).toLocaleString('en-GB', { timeZone: report.timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const share = opts.toolbar && opts.toolbar.share;
  const shareForm = share ? `<form class="share" method="post" action="${esc(share.action)}">${Object.entries(share.fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')}`
    + `<label>Link works for <select name="days">${share.days.map((d) => `<option value="${d}"${d === share.defaultDays ? ' selected' : ''}>${d} days</option>`).join('')}</select></label>`
    + '<button type="submit">Create share link</button></form>' : '';
  const toolbar = opts.toolbar ? `<nav class="toolbar"><a href="${esc(opts.toolbar.backHref)}">Back to reports</a><span class="actions">${shareForm}${opts.toolbar.csvHref ? `<a href="${esc(opts.toolbar.csvHref)}">Download CSV</a>` : ''}<a class="primary" href="${esc(opts.toolbar.downloadHref)}">Download HTML file</a></span></nav>` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(report.shopName)} COD vs Paid Orders</title>
<style>
  :root { --bg: #f6f7f9; --panel: #ffffff; --fg: #1b1f27; --muted: #5d6573; --line: #e2e5ea; --grid: #edf0f3; --bad: #b42318;
    --c-brix: #1f6feb; --c-other: #d97706; --c-paid: #b8c0cc; --accent: #1f6feb; color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111418; --panel: #191d23; --fg: #e8eaee; --muted: #9aa3b0; --line: #2a3039; --grid: #222831; --bad: #f97066;
    --c-brix: #4c8dff; --c-other: #f0a33a; --c-paid: #4a5361; --accent: #4c8dff; color-scheme: dark; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-variant-numeric: tabular-nums; }
  .page { max-width: 1120px; margin: 0 auto; padding: 28px max(16px, env(safe-area-inset-right, 0px)) 48px max(16px, env(safe-area-inset-left, 0px)); display: flex; flex-direction: column; gap: 20px; }
  .toolbar { display: flex; gap: 12px; justify-content: space-between; flex-wrap: wrap; }
  .toolbar a { color: var(--accent); text-decoration: none; font-weight: 600; padding: 8px 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
  .toolbar a.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  .toolbar .actions, .toolbar .share { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  .toolbar .share label { display: flex; gap: 6px; align-items: center; color: var(--muted); font-size: 14px; }
  .toolbar select { font: inherit; color: var(--fg); background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 7px 8px; }
  .toolbar button { font: inherit; font-weight: 600; color: var(--accent); background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 14px; cursor: pointer; }
  .eyebrow { font-size: 12px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
  h1 { margin: 4px 0 8px; font: 400 34px/1.15 Georgia, "Times New Roman", serif; text-wrap: balance; }
  header p { margin: 6px 0 0; max-width: 62rem; color: var(--muted); }
  header b { color: var(--fg); font-weight: 600; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 12px; }
  .tile, .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 18px; min-width: 0; }
  .tile { display: flex; flex-direction: column; gap: 4px; }
  .tile .label { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 14px; }
  .dot { width: 10px; height: 10px; border-radius: 2px; flex: none; display: inline-block; }
  .dot.brix { background: var(--c-brix); } .dot.other { background: var(--c-other); } .dot.paid { background: var(--c-paid); }
  .big { font: 400 38px/1.1 Georgia, "Times New Roman", serif; }
  .sub { font-size: 13px; color: var(--muted); }
  .card { display: flex; flex-direction: column; gap: 12px; }
  .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 12px; }
  h2 { margin: 0; font-size: 17px; font-weight: 600; }
  .note { margin: 0; font-size: 13px; color: var(--muted); max-width: 62rem; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 13px; color: var(--muted); }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  svg { display: block; overflow: visible; }
  svg .grid { stroke: var(--grid); } svg .axis { stroke: var(--line); }
  svg .tick { fill: var(--muted); font-size: 12px; }
  svg .hit { fill: transparent; } svg g:hover .hit { fill: var(--grid); fill-opacity: .5; }
  .scroll { overflow-x: auto; }
  .scroll.tall { max-height: 560px; overflow: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: right; font-weight: 600; color: var(--muted); font-size: 12px; padding: 6px 10px; border-bottom: 1px solid var(--line); vertical-align: bottom; background: var(--panel); position: sticky; top: 0; }
  td { text-align: right; padding: 6px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th:first-child, td:first-child { text-align: left; padding-left: 0; }
  td.zero { color: var(--muted); } td.bad { color: var(--bad); }
  ul.defs { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; max-width: 62rem; }
  footer { font-size: 12px; color: var(--muted); }
</style>
</head>
<body>
<div class="page">
  ${toolbar}
  <header>
    <div class="eyebrow">${esc(report.shopName)} · BRIX Convert · ${esc(range)}</div>
    <h1>COD vs paid orders</h1>
    <p>From ${esc(range)}, <b>${esc(f.count(s.brix_cod.orders))}</b> orders came through BRIX COD and <b>${esc(f.count(s.other_cod.orders))}</b> through other COD, next to <b>${esc(f.count(s.paid.orders))}</b> paid online orders. <b>${esc(f.pct(s.brix_cod.keptRate))}</b> of BRIX COD orders were not cancelled, against <b>${esc(f.pct(s.other_cod.keptRate))}</b> of other COD orders.</p>
    ${report.comboTracked ? `<p>Combo pages were opened <b>${esc(f.count(ct.views))}</b> times, shoppers pressed their Checkout or COD button <b>${esc(f.count(ct.presses))}</b> times, and <b>${esc(f.count(ct.orders))}</b> combo orders were placed, <b>${esc(f.count(ct.kept))}</b> of them not cancelled.</p>` : ''}
  </header>

  <section class="tiles">
    ${tiles.map((t) => `<div class="tile"><div class="label">${t.dot ? `<i class="dot ${t.dot}"></i>` : ''}${esc(t.label)}</div><div class="big">${esc(t.big)}</div>${t.lines.map((l) => `<div class="sub">${esc(l)}</div>`).join('')}</div>`).join('')}
  </section>

  <section class="card">
    <h2>Orders per day by payment</h2>
    <p class="note">Every order placed each day, stacked by how it was paid.${report.includesToday ? ' Today is only counted until this report was made.' : ''}</p>
    <div class="legend">${SERIES.map((x) => `<span><i class="dot ${x.key === 'brixCod' ? 'brix' : x.key === 'otherCod' ? 'other' : 'paid'}"></i>${esc(x.label)}</span>`).join('')}</div>
    ${chartSvg(report.daily, f)}
  </section>

  ${compare}

  <div class="grid2">
    ${entries}
    <section class="card">
      <h2>Where other COD came from</h2>
      <p class="note">The checkout or app that took each COD order not placed through BRIX: ${esc(otherVia)}.</p>
    </section>
  </div>

  ${combo}

  <section class="card">
    <h2>Day by day</h2>
    <p class="note">Order counts per day. Cancelled shows how many of that day's COD orders were later cancelled.</p>
    ${table(dailyHead, dailyRows, 'scroll tall')}
  </section>

  <section class="card">
    <h2>How these are counted</h2>
    <ul class="defs">
      <li><b>Paid online</b>: orders paid at checkout.</li>
      <li><b>Other COD</b>: Cash on Delivery orders placed through the store's own checkout or another app, not BRIX.</li>
      <li><b>BRIX COD</b>: orders placed with the BRIX Convert Cash on Delivery form.</li>
      <li><b>Not cancelled</b>: the order has shipped or is still open. Cancelled orders still count in the order totals.</li>
      <li><b>Order value</b>: the order total as placed, including shipping and taxes.</li>
      ${report.comboTracked ? '<li><b>Combo pages</b>: page views count each time a combo page was opened, so one shopper can count more than once. Button presses count taps on a combo page\'s Checkout or COD button.</li>' : ''}
      <li>${report.staffOrders ? `${esc(f.count(report.staffOrders))} order${report.staffOrders === 1 ? '' : 's'} staff created by hand ${report.staffOrders === 1 ? 'is' : 'are'} left out. ` : ''}Days follow the store's time zone (${esc(report.timeZone)}).</li>
    </ul>
  </section>

  <footer>Made by BRIX Convert from the store's Shopify orders on ${esc(generated)}.</footer>
</div>
</body>
</html>`;
}
