/**
 * SMS delivery for BRIX COD Checkout OTPs.
 *
 * Who sends the code, in this order:
 *   1. The store's own MSG91 account (COD → Customize → OTP SMS, kept in
 *      cod_secrets, passed in as `creds`). Free: BRIX charges nothing.
 *   2. Stores in OTP_WALLET_SHOPS: BRIX's own SMS, sent by the BRIX PHP server
 *      (php_backend/otp_wallet.php `send` → otp_sms_lib.php, BRIX_MSG91_* keys in
 *      its .htaccess) and paid from the store's OTP wallet at OTP_PRICE_PAISE a
 *      message. cod.server.js (`sendCodOtp`) calls PHP for these; they never
 *      come through sendOtpSms() here.
 *   3. Every other store: the server's own MSG91 account
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

/**
 * Which stores use the OTP wallet (rollout switch): OTP_WALLET_SHOPS = '*' (every
 * store) or a comma list of myshopify domains; unset / empty = none, so every
 * other store keeps sending as before (its own MSG91 keys, else the server's).
 */
export function otpWalletShopAllowed(shop) {
  return shopInList(process.env.OTP_WALLET_SHOPS, shop);
}

// A store switch: '*' = every store, else a comma list of myshopify domains; unset = none.
function shopInList(list, shop) {
  const raw = String(list || '').trim().toLowerCase();
  if (!raw) return false;
  if (raw === '*') return true;
  const want = String(shop || '').trim().toLowerCase();
  return Boolean(want) && raw.split(',').map((s) => s.trim()).includes(want);
}

/**
 * "Recharge" (Razorpay on Digifyce) is shown only to the stores in OTP_WALLET_RECHARGE
 * ('*' or '1' = every wallet store, else a comma list of myshopify domains; unset =
 * none): it is off-platform billing (App Store 1.2.1), so until it moves to Shopify
 * billing the BRIX team adds codes with scripts/otp-wallet-grant.mjs.
 */
export function otpWalletRechargeOn(shop) {
  const raw = String(process.env.OTP_WALLET_RECHARGE || '').trim();
  return shopInList(raw === '1' ? '*' : raw, shop);
}

/** Does this store's OTP go through the wallet (BRIX's SMS from the PHP server)? */
export function otpWalletOn(shop) {
  return otpWalletShopAllowed(shop);
}

/**
 * `creds` = the store's { authKey, templateId } (may be empty). `walletPaise` = the store's OTP
 * balance (null when not known / not needed). source: 'store' | 'wallet' | 'server' | 'dev-log' | null.
 * With source 'wallet', `configured` is whether the balance covers one more OTP.
 */
export function smsProviderStatus(creds, walletPaise = null, shop = null) {
  if (hasOwnMsg91(creds)) return { configured: true, provider: 'msg91', source: 'store' };
  if (otpWalletOn(shop)) {
    return { configured: Number(walletPaise) >= OTP_PRICE_PAISE, provider: 'brix', source: 'wallet' };
  }
  const account = msg91Account(creds);
  if (account) return { configured: true, provider: 'msg91', source: 'server' };
  if (devLogEnabled()) return { configured: true, provider: 'dev-log', source: 'dev-log' };
  return { configured: false, provider: null, source: null };
}

function devLogEnabled() {
  return process.env.COD_OTP_DEV_LOG === '1' && process.env.NODE_ENV !== 'production';
}

/**
 * The one MSG91 OTP request (also used by scripts/msg91-otp-tester.mjs):
 * MSG91 sends `code` with the template to +91 phone10. Returns
 * { ok, status, body } with MSG91's own reply; throws only when MSG91 can't
 * be reached.
 */
export async function msg91OtpRequest({ authKey, templateId }, phone10, code) {
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
  return { ok: res.ok && body.type !== 'error', status: res.status, body };
}

/**
 * The same send through MSG91's Flow API, for an SMS template made under
 * MSG91 → SMS → Templates (not the OTP section): the code goes in the
 * template's variable `variable` (default OTP). Same { ok, status, body }.
 * Only scripts/msg91-otp-tester.mjs uses it so far; COD sends with
 * msg91OtpRequest.
 */
export async function msg91FlowRequest({ authKey, templateId, variable = 'OTP' }, phone10, code) {
  const res = await fetch('https://control.msg91.com/api/v5/flow', {
    method: 'POST',
    headers: { authkey: authKey, accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ template_id: templateId, short_url: '0', recipients: [{ mobiles: `91${phone10}`, [variable || 'OTP']: code }] }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && body.type !== 'error', status: res.status, body };
}

async function sendViaMsg91(phone10, code, account) {
  try {
    const { ok, status, body } = await msg91OtpRequest(account, phone10, code);
    if (ok) return { sent: true };
    console.error('[cod-sms] MSG91 rejected the OTP send:', status, String(body.message || '').slice(0, 200));
    return { sent: false, reason: 'provider_rejected' };
  } catch (error) {
    console.error('[cod-sms] MSG91 request failed:', String(error?.message || error).slice(0, 200));
    return { sent: false, reason: 'provider_unreachable' };
  }
}

/**
 * Returns { sent: true, via } or { sent: false, reason } — never throws.
 * `via` = 'store' | 'server' | 'dev-log'. Wallet stores (otpWalletOn) are sent by
 * the PHP server instead (cod.server.js `sendCodOtp`), never here.
 */
export async function sendOtpSms(phone10, code, creds) {
  if (hasOwnMsg91(creds)) {
    const result = await sendViaMsg91(phone10, code, creds);
    return result.sent ? { ...result, via: 'store' } : result;
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
