/**
 * SMS delivery for BRIX COD Checkout OTPs.
 *
 * Who sends the code, in this order:
 *   1. The store's own MSG91 account (COD → Customize → OTP SMS, kept in
 *      cod_secrets, passed in as `creds`). Free: BRIX charges nothing.
 *   2. Digifyce (digifyce.global.com), paid from the store's OTP wallet at
 *      OTP_PRICE_PAISE a message. Needs DIGIFYCE_API_URL + DIGIFYCE_API_KEY.
 *      The wallet itself is charged by cod.server.js (`sendCodOtp`), which
 *      takes the money before calling here and gives it back when the SMS
 *      didn't go out.
 *   3. Without Digifyce configured on the server, the server's own MSG91 account
 *        MSG91_AUTH_KEY         — MSG91 auth key
 *        MSG91_OTP_TEMPLATE_ID  — DLT-approved OTP template id (the template must
 *                                 contain the ##OTP## variable)
 *
 * We generate and verify the code ourselves (cod.server.js); the provider only
 * delivers it, so switching provider means changing sendOtpSms() only.
 *
 * Local testing without SMS: set COD_OTP_DEV_LOG=1 (ignored when
 * NODE_ENV=production) and the code is printed to the server log instead.
 */

const SEND_TIMEOUT_MS = 8000;

/** What one OTP SMS costs a store on the wallet, in paise (Rs 0.50). */
export const OTP_PRICE_PAISE = 50;

// The MSG91 account to send with: the store's own (both keys set), else the server's.
function msg91Account(creds) {
  if (creds?.authKey && creds?.templateId) return { authKey: creds.authKey, templateId: creds.templateId, own: true };
  if (process.env.MSG91_AUTH_KEY && process.env.MSG91_OTP_TEMPLATE_ID) {
    return { authKey: process.env.MSG91_AUTH_KEY, templateId: process.env.MSG91_OTP_TEMPLATE_ID, own: false };
  }
  return null;
}

function hasOwnMsg91(creds) {
  return Boolean(creds?.authKey && creds?.templateId);
}

/** Digifyce's address and key, or null when this server isn't set up for it. */
export function digifyceConfig() {
  const base = String(process.env.DIGIFYCE_API_URL || '').trim().replace(/\/+$/, '');
  const key = String(process.env.DIGIFYCE_API_KEY || '').trim();
  // https only; plain http to this machine is allowed outside production, for local testing.
  const local = process.env.NODE_ENV !== 'production' && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base);
  return (/^https:\/\//.test(base) || local) && key ? { base, key } : null;
}

/**
 * `creds` = the store's { authKey, templateId } (may be empty). `walletPaise` = the store's OTP
 * balance (null when not known / not needed). source: 'store' | 'wallet' | 'server' | 'dev-log' | null.
 * With source 'wallet', `configured` is whether the balance covers one more OTP.
 */
export function smsProviderStatus(creds, walletPaise = null) {
  if (hasOwnMsg91(creds)) return { configured: true, provider: 'msg91', source: 'store' };
  if (digifyceConfig()) {
    return { configured: Number(walletPaise) >= OTP_PRICE_PAISE, provider: 'digifyce', source: 'wallet' };
  }
  const account = msg91Account(creds);
  if (account) return { configured: true, provider: 'msg91', source: 'server' };
  if (devLogEnabled()) return { configured: true, provider: 'dev-log', source: 'dev-log' };
  return { configured: false, provider: null, source: null };
}

function devLogEnabled() {
  return process.env.COD_OTP_DEV_LOG === '1' && process.env.NODE_ENV !== 'production';
}

async function sendViaMsg91(phone10, code, { authKey, templateId }) {
  try {
    const url = new URL('https://control.msg91.com/api/v5/otp');
    url.searchParams.set('template_id', templateId);
    url.searchParams.set('mobile', `91${phone10}`);
    url.searchParams.set('otp', code);
    const res = await fetch(url, {
      method: 'POST',
      headers: { authkey: authKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.type !== 'error') return { sent: true };
    console.error('[cod-sms] MSG91 rejected the OTP send:', res.status, String(body.message || '').slice(0, 200));
    return { sent: false, reason: 'provider_rejected' };
  } catch (error) {
    console.error('[cod-sms] MSG91 request failed:', String(error?.message || error).slice(0, 200));
    return { sent: false, reason: 'provider_unreachable' };
  }
}

// Digifyce: POST <base>/otp_send.php { shop, mobile, otp, ref } → { ok, messageId } | { ok: false, error }.
async function sendViaDigifyce(phone10, code, { shop, ref }) {
  const config = digifyceConfig();
  if (!config) return { sent: false, reason: 'not_configured' };
  try {
    const res = await fetch(`${config.base}/otp_send.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${config.key}` },
      body: JSON.stringify({ shop, mobile: phone10, otp: code, ref }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok === true) return { sent: true, messageId: String(body.messageId || '') };
    console.error('[cod-sms] Digifyce refused the OTP send:', res.status, String(body.error || '').slice(0, 200));
    return { sent: false, reason: 'provider_rejected' };
  } catch (error) {
    console.error('[cod-sms] Digifyce request failed:', String(error?.message || error).slice(0, 200));
    return { sent: false, reason: 'provider_unreachable' };
  }
}

/**
 * Returns { sent: true, via } or { sent: false, reason } — never throws.
 * `via` = 'store' | 'wallet' | 'server' | 'dev-log': 'wallet' means the caller
 * has charged (or must charge) the store's OTP wallet. `context` = { shop, ref }
 * (what Digifyce logs against the message).
 */
export async function sendOtpSms(phone10, code, creds, context = {}) {
  if (hasOwnMsg91(creds)) {
    const result = await sendViaMsg91(phone10, code, creds);
    return result.sent ? { ...result, via: 'store' } : result;
  }
  if (digifyceConfig()) {
    const result = await sendViaDigifyce(phone10, code, context);
    return result.sent ? { ...result, via: 'wallet' } : result;
  }
  const account = msg91Account(creds);
  if (account) {
    const result = await sendViaMsg91(phone10, code, account);
    return result.sent ? { ...result, via: 'server' } : result;
  }
  if (devLogEnabled()) {
    console.log(`[cod-sms] DEV OTP for +91${phone10}: ${code}`);
    return { sent: true, via: 'dev-log' };
  }
  return { sent: false, reason: 'not_configured' };
}
