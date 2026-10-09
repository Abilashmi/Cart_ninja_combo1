/**
 * SMS delivery for BRIX COD Checkout OTPs.
 *
 * Provider: MSG91 (India). Each store can connect its own MSG91 account in
 * COD → Customize → OTP SMS (MSG91) (kept in cod_secrets, passed in as
 * `creds`); without one, the BRIX server's env vars are used:
 *   MSG91_AUTH_KEY         — MSG91 auth key
 *   MSG91_OTP_TEMPLATE_ID  — DLT-approved OTP template id (the template must
 *                            contain the ##OTP## variable)
 *
 * We generate and verify the code ourselves (cod.server.js); MSG91 only
 * delivers it, so switching provider means changing sendOtpSms() only.
 *
 * Local testing without SMS: set COD_OTP_DEV_LOG=1 (ignored when
 * NODE_ENV=production) and the code is printed to the server log instead.
 */

const SEND_TIMEOUT_MS = 8000;

// The MSG91 account to send with: the store's own (both keys set), else the server's.
function msg91Account(creds) {
  if (creds?.authKey && creds?.templateId) return { authKey: creds.authKey, templateId: creds.templateId, own: true };
  if (process.env.MSG91_AUTH_KEY && process.env.MSG91_OTP_TEMPLATE_ID) {
    return { authKey: process.env.MSG91_AUTH_KEY, templateId: process.env.MSG91_OTP_TEMPLATE_ID, own: false };
  }
  return null;
}

/** `creds` = the store's { authKey, templateId } (may be empty). source: 'store' | 'server' | 'dev-log' | null. */
export function smsProviderStatus(creds) {
  const account = msg91Account(creds);
  if (account) return { configured: true, provider: 'msg91', source: account.own ? 'store' : 'server' };
  if (devLogEnabled()) return { configured: true, provider: 'dev-log', source: 'dev-log' };
  return { configured: false, provider: null, source: null };
}

function devLogEnabled() {
  return process.env.COD_OTP_DEV_LOG === '1' && process.env.NODE_ENV !== 'production';
}

/** Returns { sent: true } or { sent: false, reason } — never throws. */
export async function sendOtpSms(phone10, code, creds) {
  const account = msg91Account(creds);
  if (account) {
    const { authKey, templateId } = account;
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
  if (devLogEnabled()) {
    console.log(`[cod-sms] DEV OTP for +91${phone10}: ${code}`);
    return { sent: true };
  }
  return { sent: false, reason: 'not_configured' };
}
