// Internal → Chat: the BRIX team's inbox for the support chat merchants open
// in the BRIX admin (components/support/SupportChat.jsx). Same password and
// cookie as Internal → Reports. Inbox (who is waiting first), the chat with the
// store's details (name, domain, email, plan, page, app embed, features on),
// replies with quick replies, take over from / hand back to BRIX AI, close,
// and the chat settings. Data: routes/internal.chat_.api.jsx (polled).
// Resource route (no root.jsx, so no Clarity); merchant text is only ever set
// with textContent.
import crypto from 'node:crypto';
import { INTERNAL_HEADERS, internalEnabled, isSignedIn, signIn, signOut } from '../utils/internal-auth.server';
import { escHtml, internalPage } from '../utils/internal-page';
import { supportChatPanel } from '../utils/support-chat-panel';

const html = (body, status = 200, extra = {}) => new Response(body, { status, headers: { ...INTERNAL_HEADERS, ...extra } });

const closedPage = () => internalPage('Chat', `
  <div><div class="eyebrow">BRIX internal</div><h1>Chat is switched off</h1></div>
  <p>Set a REPORTS_PASSWORD of at least 12 characters on the server to open the internal pages.</p>`);

const loginPage = (error) => internalPage('Chat sign in', `
  <div><div class="eyebrow">BRIX internal</div><h1>Support chat</h1></div>
  <form class="card" method="post">
    <input type="hidden" name="intent" value="login">
    <label for="password">Password<input id="password" name="password" type="password" autocomplete="current-password" required autofocus></label>
    ${error ? `<p class="error">${escHtml(error)}</p>` : ''}
    <button type="submit">Sign in</button>
  </form>`);

export async function loader({ request }) {
  if (!internalEnabled()) return html(closedPage(), 503);
  if (!(await isSignedIn(request))) return html(loginPage());
  const nonce = crypto.randomBytes(16).toString('base64');
  return html(supportChatPanel(nonce), 200, {
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
  });
}

export async function action({ request }) {
  if (!internalEnabled()) return html(closedPage(), 503);
  const form = await request.formData();
  if (form.get('intent') === 'logout') {
    return new Response(null, { status: 303, headers: { Location: '/internal/chat', 'Set-Cookie': await signOut() } });
  }
  const setCookie = await signIn(form.get('password'));
  if (!setCookie) return html(loginPage('That password is not right.'), 401);
  return new Response(null, { status: 303, headers: { Location: '/internal/chat', 'Set-Cookie': setCookie } });
}
