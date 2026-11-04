// Writes a buildClientReport() result as one CSV file: every number the report
// has, unformatted (no currency signs or thousands commas, rates as percents),
// so it adds up in a spreadsheet. One block per table, a blank row between
// blocks, each block a title row then a header row. UTF-8 with a BOM and CRLF
// rows, so Excel opens store names in any script correctly.

const PCT_DIGITS = 2;

/** A cell: numbers as they are, null/undefined empty, text quoted when needed. */
function cell(v) {
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  let s = String(v);
  // Store and combo page names come from merchants: a leading = + - @ would
  // run as a formula in Excel / Sheets.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const pct = (v) => (v == null ? null : Number((v * 100).toFixed(PCT_DIGITS)));
const num2 = (v) => (v == null ? null : Number(v.toFixed(2)));

function block(title, head, rows) {
  return [[title], head, ...rows];
}

function summaryBlock(title, summary, cur) {
  return block(title,
    ['Payment', 'Orders', 'Not cancelled', 'Cancelled', 'Not cancelled (%)', `Order value (${cur})`, `Avg order (${cur})`, 'Share of orders (%)', 'Orders a day'],
    summary.map((r) => [r.label, r.orders, r.kept, r.cancelled, pct(r.keptRate), r.value, r.avgOrder, pct(r.share), num2(r.perDay)]));
}

/** @param report buildClientReport() result → CSV text */
export function renderClientReportCsv(report) {
  const cur = report.currency || '';
  const blocks = [];

  blocks.push(block('Report', ['Field', 'Value'], [
    ['Store', report.shopName],
    ['Store domain', report.shop],
    ['From', report.from],
    ['To', report.to],
    ['Days', report.days],
    ['Previous period from', report.prevFrom],
    ['Previous period to', report.prevTo],
    ['Previous period compared', report.previousAvailable && !!report.previousSummary],
    ['Currency', cur],
    ['Time zone', report.timeZone],
    ['Includes today (partly counted)', !!report.includesToday],
    ['Staff orders left out', report.staffOrders],
    ['Generated at (UTC)', report.generatedAt],
  ]));

  blocks.push(summaryBlock('Summary, this period', report.summary, cur));
  if (report.previousSummary) blocks.push(summaryBlock('Summary, previous period', report.previousSummary, cur));

  blocks.push(block('BRIX COD by where it was placed',
    ['Placed from', 'Orders', 'Not cancelled', 'Cancelled', 'Not cancelled (%)', `Order value (${cur})`, `Avg order (${cur})`],
    report.brixEntries.map((e) => [e.entry, e.orders, e.kept, e.cancelled, pct(e.keptRate), e.value, e.avgOrder])));

  blocks.push(block('Other COD by checkout or app', ['Checkout or app', 'Orders'],
    report.otherCodVia.map((v) => [v.app, v.orders])));

  if (report.comboTracked) {
    const head = ['Combo page', 'Combo page id', 'Page views', 'Checkout or COD presses', 'Orders', 'Paid online', 'COD', 'Not cancelled', 'Cancelled', 'Not cancelled (%)', `Order value (${cur})`, `Avg order (${cur})`];
    const row = (c, name, id) => [name, id, c.views, c.presses, c.orders, c.paid, c.cod, c.kept, c.cancelled, pct(c.keptRate), c.value, c.avgOrder];
    const ct = report.comboTotal;
    blocks.push(block('Combo pages', head, [...report.combo.map((c) => row(c, c.name, c.id)), row(ct, 'All combo pages', '')]));
  }

  blocks.push(block('Day by day',
    ['Date', 'Weekday', 'Paid online', `Paid order value (${cur})`, 'Other COD', 'Other COD cancelled', 'BRIX COD', 'BRIX COD cancelled', `BRIX COD order value (${cur})`,
      'All orders', 'COD share (%)', 'Combo page views', 'Combo button presses', 'Combo orders'],
    report.daily.map((d) => [d.day, new Date(`${d.day}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short' }),
      d.paid, d.paidValue, d.otherCod, d.otherCodCancelled, d.brixCod, d.brixCodCancelled, d.brixValue,
      d.paid + d.otherCod + d.brixCod, pct(d.codShare), d.comboViews, d.comboPresses, d.comboOrders])));

  const lines = [];
  blocks.forEach((rows, i) => {
    if (i) lines.push('');
    for (const r of rows) lines.push(r.map(cell).join(','));
  });
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
