// Internal → Reports: the client report's numbers and page. Pure functions,
// no Shopify or MySQL.
// Run with: node --test tests/reports/client-report.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClientReport, classifyOrder, localDay, resolveRange, zoneOffsetMinutes } from '../../app/utils/client-report.js';
import { renderClientReportHtml } from '../../app/utils/client-report-html.js';

const IST = 'Asia/Kolkata';

const order = (over = {}) => ({
  name: '#1001',
  createdAt: '2026-10-20T06:00:00Z',
  cancelledAt: null,
  displayFinancialStatus: 'PAID',
  tags: [],
  paymentGatewayNames: ['PayU'],
  discountCodes: [],
  customAttributes: [],
  app: { name: 'FASTERR' },
  totalPriceSet: { shopMoney: { amount: '500.00' } },
  ...over,
});

test('days follow the store time zone', () => {
  assert.equal(localDay('2026-10-16T19:00:13Z', IST), '2026-10-17');
  assert.equal(localDay('2026-10-16T18:29:59Z', IST), '2026-10-16');
  assert.equal(zoneOffsetMinutes(Date.parse('2026-10-20T00:00:00Z'), IST), 330);
  assert.equal(zoneOffsetMinutes(Date.parse('2026-07-01T12:00:00Z'), 'America/New_York'), -240);
  assert.equal(zoneOffsetMinutes(Date.parse('2026-12-01T12:00:00Z'), 'America/New_York'), -300);
});

test('orders are sorted into paid, BRIX COD, other COD and staff', () => {
  const brixByTag = classifyOrder(order({ tags: ['BRIX-COD', 'brix-src-drawer'], paymentGatewayNames: ['manual'], app: { name: 'Brix - Convert' } }), IST);
  assert.equal(brixByTag.channel, 'brix_cod');
  assert.equal(brixByTag.brixEntry, 'Cart drawer');
  const brixByAttr = classifyOrder(order({ customAttributes: [{ key: '_brixCod', value: 'true' }, { key: 'brix_cod_source', value: 'product' }], paymentGatewayNames: ['manual'] }), IST);
  assert.equal(brixByAttr.channel, 'brix_cod');
  assert.equal(brixByAttr.brixEntry, 'Product page');
  const other = classifyOrder(order({ paymentGatewayNames: ['Cash on Delivery (COD)'], displayFinancialStatus: 'PENDING' }), IST);
  assert.equal(other.channel, 'other_cod');
  assert.equal(other.viaApp, 'FASTERR');
  assert.equal(classifyOrder(order({ paymentGatewayNames: ['cod'] }), IST).channel, 'other_cod');
  assert.equal(classifyOrder(order({ paymentGatewayNames: ['Codapay'] }), IST).channel, 'paid');
  assert.equal(classifyOrder(order({ app: { name: 'Draft Orders' }, paymentGatewayNames: ['manual'] }), IST).channel, 'staff');
  assert.equal(classifyOrder(order(), IST).channel, 'paid');
});

test('cancelled or voided orders are not kept; combo orders are found by their attributes or box code', () => {
  assert.equal(classifyOrder(order({ cancelledAt: '2026-10-21T00:00:00Z' }), IST).kept, false);
  assert.equal(classifyOrder(order({ displayFinancialStatus: 'VOIDED' }), IST).kept, false);
  assert.equal(classifyOrder(order(), IST).kept, true);
  assert.equal(classifyOrder(order({ customAttributes: [{ key: 'combo_source', value: 'ComboForge' }, { key: 'combo_template_id', value: '112' }] }), IST).comboId, '112');
  assert.equal(classifyOrder(order({ customAttributes: [{ key: 'combo_source', value: 'ComboForge' }] }), IST).comboId, 'unknown');
  assert.equal(classifyOrder(order({ discountCodes: ['BXSGVTPQVKPU'] }), IST).comboId, 'unknown');
  assert.equal(classifyOrder(order({ discountCodes: ['PREPAID10'] }), IST).comboId, '');
});

test('date range rules', () => {
  const today = '2026-11-03';
  assert.match(resolveRange('', '2026-11-01', today).error, /start and an end/);
  assert.match(resolveRange('2026-11-02', '2026-11-01', today).error, /after the end/);
  assert.match(resolveRange('2026-11-01', '2026-11-04', today).error, /future/);
  assert.match(resolveRange('2026-10-01', '2026-11-02', today).error, /at most 31/);
  assert.match(resolveRange('2026-09-04', '2026-09-10', today).error, /last 60 days/);
  const r = resolveRange('2026-10-18', '2026-11-03', today);
  assert.deepEqual(r, { from: '2026-10-18', to: '2026-11-03', prevFrom: '2026-10-01', prevTo: '2026-10-17', days: 17, previousAvailable: true });
  assert.equal(resolveRange('2026-09-10', '2026-09-30', today).previousAvailable, false);
});

function sample() {
  const at = (day, hourUtc = 6) => `${day}T${String(hourUtc).padStart(2, '0')}:00:00Z`;
  const raw = [
    order({ name: '#1', createdAt: at('2026-10-19') }),
    order({ name: '#2', createdAt: at('2026-10-19'), totalPriceSet: { shopMoney: { amount: '1000' } } }),
    order({ name: '#3', createdAt: at('2026-10-20'), paymentGatewayNames: ['Cash on Delivery (COD)'], cancelledAt: at('2026-10-21') }),
    order({ name: '#4', createdAt: at('2026-10-20'), paymentGatewayNames: ['Cash on Delivery (COD)'] }),
    order({ name: '#5', createdAt: at('2026-10-20'), tags: ['BRIX-COD', 'brix-src-product'], paymentGatewayNames: ['manual'], totalPriceSet: { shopMoney: { amount: '1200' } } }),
    order({ name: '#6', createdAt: at('2026-10-21'), tags: ['BRIX-COD', 'brix-src-drawer'], paymentGatewayNames: ['manual'], cancelledAt: at('2026-10-22'),
      customAttributes: [{ key: 'combo_source', value: 'ComboForge' }, { key: 'combo_template_id', value: '7' }] }),
    order({ name: '#7', createdAt: at('2026-10-21'), app: { name: 'Draft Orders' }, paymentGatewayNames: ['manual'] }),
    order({ name: '#8', createdAt: at('2026-10-17') }), // previous period
    order({ name: '#9', createdAt: at('2026-10-17'), paymentGatewayNames: ['Cash on Delivery (COD)'] }),
    order({ name: '#10', createdAt: at('2026-10-21'), customAttributes: [{ key: 'combo_template_id', value: '7' }, { key: 'combo_source', value: 'ComboForge' }] }),
  ];
  return buildClientReport({
    shop: 'demo.myshopify.com', shopName: 'Demo <Kids>', currency: 'INR', timeZone: IST,
    range: resolveRange('2026-10-19', '2026-10-21', '2026-10-21'), today: '2026-10-21', generatedAt: '2026-10-21T06:30:00Z',
    orders: raw.map((o) => classifyOrder(o, IST)),
    comboEvents: [
      { day: '2026-10-20', templateId: '7', views: 40, presses: 3 },
      { day: '2026-10-21', templateId: '7', views: 10, presses: 1 },
      { day: '2026-10-21', templateId: '8', views: 5, presses: 0 },
      { day: '2026-10-18', templateId: '7', views: 99, presses: 9 }, // outside the range
    ],
    comboPages: [{ id: '7', name: 'Buy any 5' }, { id: '8', name: 'Books' }, { id: '9', name: 'Unused' }],
  });
}

test('report totals, comparison and daily rows', () => {
  const r = sample();
  const s = Object.fromEntries(r.summary.map((x) => [x.key, x]));
  assert.deepEqual([s.paid.orders, s.other_cod.orders, s.brix_cod.orders, s.all_cod.orders], [3, 2, 2, 4]);
  assert.equal(r.staffOrders, 1);
  assert.equal(s.paid.value, 2000);
  assert.equal(s.other_cod.keptRate, 0.5);
  assert.equal(s.brix_cod.keptRate, 0.5);
  assert.equal(s.paid.share, 3 / 7);
  assert.equal(s.paid.perDay, 1);
  const p = Object.fromEntries(r.previousSummary.map((x) => [x.key, x]));
  assert.deepEqual([p.paid.orders, p.other_cod.orders, p.brix_cod.orders], [1, 1, 0]);
  assert.equal(p.brix_cod.keptRate, null);
  assert.deepEqual(r.daily.map((d) => d.day), ['2026-10-19', '2026-10-20', '2026-10-21']);
  assert.deepEqual(r.daily[1], { day: '2026-10-20', paid: 0, paidValue: 0, otherCod: 2, otherCodCancelled: 1, brixCod: 1, brixCodCancelled: 0, brixValue: 1200,
    codShare: 1, comboViews: 40, comboPresses: 3, comboOrders: 0 });
  assert.equal(r.daily[2].comboOrders, 2);
  assert.deepEqual(r.brixEntries.map((e) => [e.entry, e.orders, e.kept]), [['Cart drawer', 1, 0], ['Product page', 1, 1]]);
  assert.deepEqual(r.otherCodVia, [{ app: 'FASTERR', orders: 2 }]);
  assert.equal(r.includesToday, true);
});

test('combo pages: views, presses and orders per page, unused pages left out', () => {
  const r = sample();
  assert.deepEqual(r.combo.map((c) => [c.name, c.views, c.presses, c.orders, c.paid, c.cod, c.kept]), [
    ['Buy any 5', 50, 4, 2, 1, 1, 1],
    ['Books', 5, 0, 0, 0, 0, 0],
  ]);
  assert.deepEqual([r.comboTotal.views, r.comboTotal.presses, r.comboTotal.orders, r.comboTotal.kept], [55, 4, 2, 1]);
});

test('the page escapes store text, runs no script and drops combo parts when there is no combo data', () => {
  const r = sample();
  const page = renderClientReportHtml(r, { toolbar: { backHref: '/internal/reports', downloadHref: '/internal/reports/view?download=1' } });
  assert.ok(page.includes('Demo &lt;Kids&gt;'));
  assert.ok(!page.includes('Demo <Kids>'));
  assert.ok(!/<script/i.test(page));
  assert.ok(page.includes('Download HTML file'));
  assert.ok(page.includes('Combo pages'));
  assert.ok(page.includes('₹2,000'));
  const plain = renderClientReportHtml({ ...r, comboTracked: false, combo: [] });
  assert.ok(!plain.includes('Combo page views'));
  assert.ok(!plain.includes('Download HTML file'));
  const noPrev = renderClientReportHtml({ ...r, previousSummary: null });
  assert.ok(noPrev.includes('older than the 60 days'));
});

test('share links: the toolbar offers them, the shared copy has no toolbar or form', () => {
  const r = sample();
  const share = { action: '/internal/reports/share', fields: { intent: 'create', shop: 'demo.myshopify.com', from: '2026-10-19', to: '2026-10-21"><b>' }, days: [7, 30, 90], defaultDays: 30 };
  const page = renderClientReportHtml(r, { toolbar: { backHref: '/internal/reports', downloadHref: '/internal/reports/view?download=1', share } });
  assert.ok(page.includes('action="/internal/reports/share"'));
  assert.ok(page.includes('<option value="30" selected>30 days</option>'));
  assert.ok(page.includes('value="2026-10-21&quot;&gt;&lt;b&gt;"'), 'hidden fields are escaped');
  assert.ok(page.includes('Create share link'));
  const shared = renderClientReportHtml(r);
  assert.ok(!/<form|Create share link|Back to reports/.test(shared));
});
