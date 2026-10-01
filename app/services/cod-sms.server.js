/**
 * SMS delivery for BRIX COD Checkout OTPs.
 *
 * Provider: MSG91 (India). Configure with env vars:
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

export function smsProviderStatus() {
  if (process.env.MSG91_AUTH_KEY && process.env.MSG91_OTP_TEMPLATE_ID) return { configured: true, provider: 'msg91' };
  if (devLogEnabled()) return { configured: true, provider: 'dev-log' };
  return { configured: false, provider: null };
}

function devLogEnabled() {
  return process.env.COD_OTP_DEV_LOG === '1' && process.env.NODE_ENV !== 'production';
}

/** Returns { sent: true } or { sent: false, reason } — never throws. */
export async function sendOtpSms(phone10, code) {
  const authKey = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_OTP_TEMPLATE_ID;
  if (authKey && templateId) {
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
