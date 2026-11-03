// Internal → Reports → share links. POST intent=create (shop, from, to, days)
// builds the report again, saves a frozen copy (services/report-shares.server.js)
// and shows the link to send; intent=revoke turns a link off. The link opens
// at /r/<id> (routes/r.$id.jsx) without the password.
import { loadClientReport } from '../services/client-report.server';
import { createShare, revokeShare } from '../services/report-shares.server';
import { INTERNAL_HEADERS, internalEnabled, isSignedIn } from '../utils/internal-auth.server';
import { renderClientReportHtml } from '../utils/client-report-html.js';
import { escHtml, internalPage } from '../utils/internal-page';

const html = (body, status = 200) => new Response(body, { status, headers: INTERNAL_HEADERS });
const toReports = () => new Response(null, { status: 303, headers: { Location: '/internal/reports' } });

// Links use the app's public address (SHOPIFY_APP_URL on Fly), not the address
// the request arrived on behind Fly's proxy.
// eslint-disable-next-line no-undef
const publicOrigin = (request) => String(process.env.SHOPIFY_APP_URL || new URL(request.url).origin).replace(/\/$/, '');

export const loader = () => toReports();

export async function action({ request }) {
  if (!internalEnabled() || !(await isSignedIn(request))) return toReports();
  const form = await request.formData();
  if (form.get('intent') === 'revoke') {
    await revokeShare(String(form.get('id') || '')).catch((e) => console.error('[internal reports] revoke failed:', e.message));
    return toReports();
  }

  const shop = String(form.get('shop') || '');
  const from = String(form.get('from') || '');
  const to = String(form.get('to') || '');
  const back = `/internal/reports/view?${new URLSearchParams({ shop, from, to })}`;
  let link;
  let days;
  try {
    const result = await loadClientReport({ shop, from, to });
    if (result.error) {
      return html(internalPage('Client reports', `<div><div class="eyebrow">BRIX internal</div><h1>No link made</h1></div>
        <p class="error">${escHtml(result.error)}</p><p><a href="${escHtml(back)}">Back to the report</a></p>`), 400);
    }
    const saved = await createShare({ report: result.report, html: renderClientReportHtml(result.report), days: form.get('days') });
    link = `${publicOrigin(request)}/r/${saved.id}`;
    days = saved.days;
  } catch (error) {
    console.error('[internal reports] share failed:', shop, error.message);
    return html(internalPage('Client reports', `<div><div class="eyebrow">BRIX internal</div><h1>No link made</h1></div>
      <p class="error">The link could not be made just now. Try again in a minute.</p><p><a href="${escHtml(back)}">Back to the report</a></p>`), 500);
  }
  return html(internalPage('Share link', `
    <div><div class="eyebrow">BRIX internal</div><h1>Share link ready</h1></div>
    <p>Anyone with this link can open the report for ${days} days, without a password. It shows the numbers as they are now.</p>
    <form class="card" action="#">
      <label for="link">Link to send<input id="link" type="text" readonly value="${escHtml(link)}"></label>
      <p><small>Select the link and copy it. You can turn it off on the reports page.</small></p>
    </form>
    <div class="foot"><a href="${escHtml(link)}" target="_blank" rel="noopener">Open the link</a><a href="${escHtml(back)}">Back to the report</a></div>`));
}
