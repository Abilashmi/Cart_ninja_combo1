// Internal → Reports → one client report, as a self-contained HTML page.
// ?download=1 sends the same page as a file to forward to the merchant.
import { loadClientReport } from '../services/client-report.server';
import { INTERNAL_HEADERS, internalEnabled, isSignedIn } from '../utils/internal-auth.server';
import { renderClientReportHtml } from '../utils/client-report-html.js';
import { escHtml, internalPage } from '../utils/internal-page';
import { DEFAULT_SHARE_DAYS, SHARE_DAYS } from '../services/report-shares.server';

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'store';

export async function loader({ request }) {
  if (!internalEnabled() || !(await isSignedIn(request))) {
    return new Response(null, { status: 303, headers: { Location: '/internal/reports' } });
  }
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop') || '';
  const from = url.searchParams.get('from') || '';
  const to = url.searchParams.get('to') || '';
  const back = `/internal/reports?${new URLSearchParams({ shop, from, to })}`;

  let result;
  try {
    result = await loadClientReport({ shop, from, to });
  } catch (error) {
    console.error('[internal reports] report failed:', shop, error.message);
    result = { error: 'The report could not be built just now. Try again in a minute.' };
  }
  if (result.error) {
    return new Response(internalPage('Client reports', `
      <div><div class="eyebrow">BRIX internal</div><h1>No report</h1></div>
      <p class="error">${escHtml(result.error)}</p>
      <p><a href="${escHtml(back)}">Back to reports</a></p>`), { status: 400, headers: INTERNAL_HEADERS });
  }

  const { report } = result;
  if (url.searchParams.get('download') === '1') {
    return new Response(renderClientReportHtml(report), {
      headers: {
        ...INTERNAL_HEADERS,
        'Content-Disposition': `attachment; filename="${slug(report.shopName)}-cod-vs-paid-${report.from}-to-${report.to}.html"`,
      },
    });
  }
  const download = `/internal/reports/view?${new URLSearchParams({ shop, from, to, download: '1' })}`;
  const share = { action: '/internal/reports/share', fields: { intent: 'create', shop, from, to }, days: SHARE_DAYS, defaultDays: DEFAULT_SHARE_DAYS };
  return new Response(renderClientReportHtml(report, { toolbar: { backHref: back, downloadHref: download, share } }), { headers: INTERNAL_HEADERS });
}
