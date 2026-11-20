#!/usr/bin/env node
/* eslint-env node */
// MSG91 OTP tester: a page on this computer only (http://127.0.0.1:8791).
// Paste an MSG91 auth key + OTP template id, type a phone number, Send: it
// sends a code with the exact request the COD popup uses
// (app/services/cod-sms.server.js msg91OtpRequest) and shows the code it sent
// and MSG91's reply, so you can match it with the SMS on the phone.
// Nothing is saved: the keys stay in this process and are gone when it stops.
//
//   node scripts/msg91-otp-tester.mjs            (port 8791)
//   PORT=9000 node scripts/msg91-otp-tester.mjs
import crypto from 'node:crypto';
import http from 'node:http';
import { msg91FlowRequest, msg91OtpRequest } from '../app/services/cod-sms.server.js';

const PORT = Number(process.env.PORT) || 8791;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const history = []; // this run's sends, newest first

function page(form = {}, result = null) {
  const rows = history.map((h) => `<tr><td>${esc(h.time)}</td><td>+91 ${esc(h.phone)}</td><td class="code">${esc(h.code)}</td><td class="${h.ok ? 'ok' : 'bad'}">${h.ok ? 'Sent' : 'Failed'}</td><td>${esc(h.note)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MSG91 OTP tester</title><style>
:root{--bg:#f6f7f9;--panel:#fff;--fg:#1b1f27;--muted:#5d6573;--line:#d9dde3;--accent:#1f6feb;--ok:#067647;--bad:#b42318;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#111418;--panel:#191d23;--fg:#e8eaee;--muted:#9aa3b0;--line:#2f3640;--accent:#4c8dff;--ok:#47cd89;--bad:#f97066;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:620px;margin:0 auto;padding:40px 16px;display:flex;flex-direction:column;gap:18px}
h1{margin:0;font:600 24px/1.2 system-ui}p{margin:0;color:var(--muted)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:12px}
label{display:flex;flex-direction:column;gap:5px;font-weight:600;font-size:14px}label small{font-weight:400;color:var(--muted)}
input,select{font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:9px 10px;width:100%}
.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:12px}
button{font:inherit;font-weight:600;border-radius:8px;padding:10px 16px;cursor:pointer;border:1px solid var(--accent);background:var(--accent);color:#fff}
.big{font:700 40px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em}
.ok{color:var(--ok);font-weight:600}.bad{color:var(--bad);font-weight:600}
pre{margin:0;padding:10px;background:var(--bg);border:1px solid var(--line);border-radius:8px;overflow:auto;font-size:13px;white-space:pre-wrap;word-break:break-all}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:6px 4px;border-top:1px solid var(--line)}th{color:var(--muted);font-weight:500}
td.code{font-family:ui-monospace,Menlo,monospace;font-weight:700}
</style></head><body><main>
<div><h1>MSG91 OTP tester</h1><p>Sends a code with the same MSG91 request the BRIX COD popup uses. Only on this computer; nothing is saved.</p></div>
<form class="card" method="post" action="/send" autocomplete="off">
  <label>MSG91 auth key<input name="authKey" type="password" value="${esc(form.authKey)}" required></label>
  <label>Template type<select name="api">
    <option value="flow"${form.api !== 'otp' ? ' selected' : ''}>SMS template (Flow API, MSG91 → SMS → Templates)</option>
    <option value="otp"${form.api === 'otp' ? ' selected' : ''}>OTP template (OTP API, MSG91 → OTP → Templates)</option>
  </select></label>
  <div class="row">
    <label>Template ID<small>MSG91's ID (letters and numbers), not the DLT number.</small><input name="templateId" value="${esc(form.templateId)}" required></label>
    <label>Code variable<small>SMS template only: the variable that holds the code.</small><input name="variable" value="${esc(form.variable || 'OTP')}"></label>
  </div>
  <div class="row">
    <label>Phone number<small>10 digits, India (+91 is added).</small><input name="phone" inputmode="numeric" value="${esc(form.phone)}" required></label>
    <label>Code to send<small>Empty = a random 4-digit code.</small><input name="code" inputmode="numeric" value=""></label>
  </div>
  <button type="submit">Send OTP</button>
</form>
${result ? `<section class="card">
  ${result.ok
    ? `<div class="ok">MSG91 accepted it. The SMS to +91 ${esc(result.phone)} should show:</div><div class="big">${esc(result.code)}</div>`
    : `<div class="bad">Not sent: ${esc(result.note)}</div>${result.code ? `<p>Code that was tried: <b>${esc(result.code)}</b></p>` : ''}`}
  ${result.reply !== undefined ? `<div><p>MSG91's reply${result.status ? ` (HTTP ${esc(result.status)})` : ''}:</p><pre>${esc(JSON.stringify(result.reply, null, 2))}</pre></div>` : ''}
  ${result.ok ? '<p>"Accepted" means MSG91 took the request. If no SMS arrives, check MSG91 → Reports for that request ID (DLT template, sender ID and balance problems show there).</p>' : ''}
</section>` : ''}
${history.length ? `<section class="card"><b>Sent in this run</b><table><tr><th>Time</th><th>Phone</th><th>Code</th><th>Result</th><th>Reply</th></tr>${rows}</table></section>` : ''}
</main></body></html>`;
}

async function send(form) {
  const phone = String(form.phone || '').replace(/\D/g, '').replace(/^(?:91|0)(?=\d{10}$)/, '');
  const authKey = String(form.authKey || '').trim();
  const templateId = String(form.templateId || '').trim();
  const typed = String(form.code || '').replace(/\D/g, '');
  if (/^\d{15,}$/.test(templateId)) return { ok: false, note: "That looks like the DLT template number. Use MSG91's own template ID (letters and numbers) from MSG91 → Templates." };
  if (!authKey || !templateId) return { ok: false, note: 'Enter the auth key and the template ID.' };
  if (!/^[6-9]\d{9}$/.test(phone)) return { ok: false, note: 'Enter a 10-digit Indian mobile number.' };
  if (typed && !/^\d{4,8}$/.test(typed)) return { ok: false, note: 'The code must be 4 to 8 digits.' };
  const code = typed || String(crypto.randomInt(0, 10000)).padStart(4, '0');
  let result;
  try {
    const variable = String(form.variable || 'OTP').trim().replace(/[^A-Za-z0-9_]/g, '') || 'OTP';
    const { ok, status, body } = form.api === 'otp'
      ? await msg91OtpRequest({ authKey, templateId }, phone, code)
      : await msg91FlowRequest({ authKey, templateId, variable }, phone, code);
    result = { ok, status, reply: body, phone, code, note: ok ? (body.request_id || body.message || 'accepted') : String(body.message || `HTTP ${status}`) };
  } catch (error) {
    result = { ok: false, phone, code, note: `Couldn't reach MSG91 (${String(error?.message || error).slice(0, 120)})` };
  }
  history.unshift({ time: new Date().toLocaleTimeString(), phone, code, ok: result.ok, note: result.note });
  history.length = Math.min(history.length, 30);
  return result;
}

const server = http.createServer(async (req, res) => {
  const reply = (status, html) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.end(html);
  };
  if (req.method === 'POST' && req.url === '/send') {
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 10000) return reply(413, 'Too large'); }
    const form = Object.fromEntries(new URLSearchParams(raw));
    const result = await send(form);
    return reply(200, page({ authKey: form.authKey, templateId: form.templateId, phone: form.phone, api: form.api, variable: form.variable }, result));
  }
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) return reply(200, page());
  reply(404, 'Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`MSG91 OTP tester: http://127.0.0.1:${PORT}  (Ctrl+C to stop)`);
});
