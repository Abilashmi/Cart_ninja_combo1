// Internal → Reports: sign in with the shared password, pick a store and
// dates, open the client report (internal.reports_.view.jsx). Not part of the
// Shopify admin; resource route, so root.jsx never renders here.
import { listReportShops } from '../services/client-report.server';
import { INTERNAL_HEADERS, internalEnabled, isSignedIn, signIn, signOut } from '../utils/internal-auth.server';
import { escHtml, internalPage } from '../utils/internal-page';
import { MAX_REPORT_DAYS, ORDER_HISTORY_DAYS, addDays } from '../utils/client-report.js';

const html = (body, status = 200, extra = {}) => new Response(body, { status, headers: { ...INTERNAL_HEADERS, ...extra } });

const closedPage = () => internalPage('Reports', `
  <div><div class="eyebrow">BRIX internal</div><h1>Reports are switched off</h1></div>
  <p>Set a REPORTS_PASSWORD of at least 12 characters on the server to open them.</p>`);

const loginPage = (error) => internalPage('Reports sign in', `
  <div><div class="eyebrow">BRIX internal</div><h1>Client reports</h1></div>
  <form class="card" method="post">
    <input type="hidden" name="intent" value="login">
    <label for="password">Password<input id="password" name="password" type="password" autocomplete="current-password" required autofocus></label>
    ${error ? `<p class="error">${escHtml(error)}</p>` : ''}
    <button type="submit">Sign in</button>
  </form>`);

function pickerPage(shops, { shop = '', from, to }) {
  const options = shops.map((s) => `<option value="${escHtml(s.shop)}"${s.shop === shop ? ' selected' : ''}>${escHtml(s.name)} (${escHtml(s.host)})</option>`).join('');
  return internalPage('Client reports', `
  <div><div class="eyebrow">BRIX internal</div><h1>Client reports</h1></div>
  <p>COD vs paid orders and combo pages for one store. Opening the report takes a few seconds; download it there to send it.</p>
  <form class="card" method="get" action="/internal/reports/view">
    <label for="shop">Store
      <select id="shop" name="shop" required><option value="">Choose a store</option>${options}</select>
    </label>
    <div class="row">
      <label for="from">From<input id="from" name="from" type="date" value="${escHtml(from)}" required></label>
      <label for="to">To<input id="to" name="to" type="date" value="${escHtml(to)}" required></label>
    </div>
    <p><small>Up to ${MAX_REPORT_DAYS} days, within the last ${ORDER_HISTORY_DAYS} days. The report also compares with the same number of days just before.</small></p>
    <button type="submit">Open report</button>
  </form>
  <form class="foot" method="post">
    <a href="/internal/reports?fresh=1">Refresh the store list</a>
    <input type="hidden" name="intent" value="logout">
    <button class="plain" type="submit">Sign out</button>
  </form>`);
}

export async function loader({ request }) {
  if (!internalEnabled()) return html(closedPage(), 503);
  if (!(await isSignedIn(request))) return html(loginPage());
  const url = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const shops = await listReportShops({ fresh: url.searchParams.get('fresh') === '1' });
  return html(pickerPage(shops, {
    shop: url.searchParams.get('shop') || '',
    from: url.searchParams.get('from') || addDays(today, -13),
    to: url.searchParams.get('to') || today,
  }));
}

export async function action({ request }) {
  if (!internalEnabled()) return html(closedPage(), 503);
  const form = await request.formData();
  if (form.get('intent') === 'logout') {
    return new Response(null, { status: 303, headers: { Location: '/internal/reports', 'Set-Cookie': await signOut() } });
  }
  const setCookie = await signIn(form.get('password'));
  if (!setCookie) return html(loginPage('That password is not right.'), 401);
  return new Response(null, { status: 303, headers: { Location: '/internal/reports', 'Set-Cookie': setCookie } });
}
