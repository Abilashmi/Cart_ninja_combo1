import { CodError, codErrorResponse, sendCodOtp, verifyCodOtp } from '../services/cod.server';
import {
  COD_CORS_HEADERS, assertLive, corsPreflight, limitByIp, loadCodContext, ok, parseShop, readJson,
} from '../services/cod-storefront.server';
import { normalizeIndianPhone } from '../utils/cod.shared.js';
import { otpWalletOn } from '../services/cod-sms.server';
import { getDb } from '../services/db.server';
import { savedAddressesForShopper } from '../services/saved-addresses.server';

/**
 * POST /api/cod/otp
 *   { shop, phone, step: 'send' }            → { resendAfter }
 *   { shop, phone, step: 'verify', code }    → { token, addresses }   (token signed, 30 min;
 *        addresses = that phone's saved addresses from this store's orders, only
 *        after the code matched, stores in OTP_WALLET_SHOPS only, else [])
 */
export async function action({ request }) {
  if (request.method === 'OPTIONS') return corsPreflight();
  try {
    const body = await readJson(request);
    const shop = parseShop(body.shop);
    const phone = normalizeIndianPhone(body.phone);
    if (!phone) throw new CodError('invalid_phone', 'Enter a valid 10-digit mobile number.');

    const ctx = await loadCodContext(shop, { needAdmin: false });
    assertLive(ctx);
    if (!ctx.otpRequired) throw new CodError('otp_not_needed', 'No code is needed for this store.');

    if (body.step === 'send') {
      limitByIp(request, 'cod-otp-send', 10, 60 * 60_000);
      return ok(await sendCodOtp(shop, phone));
    }
    if (body.step === 'verify') {
      limitByIp(request, 'cod-otp-verify', 30, 10 * 60_000);
      const verified = await verifyCodOtp(shop, phone, String(body.code || '').trim());
      // Only here, after the code matched: the phone is the shopper's own.
      const addresses = otpWalletOn(shop) ? await savedAddressesForShopper(getDb(), shop, phone) : [];
      return ok({ ...verified, addresses });
    }
    throw new CodError('invalid_request', 'Refresh the page and try again.');
  } catch (error) {
    return codErrorResponse(error, COD_CORS_HEADERS);
  }
}

export function loader() {
  return Response.json({ success: false, error: 'POST only.' }, { status: 405, headers: COD_CORS_HEADERS });
}
