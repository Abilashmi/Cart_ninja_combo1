// The store's OTP credits for the reminder badge on every admin page
// (components/shared/OtpCreditsBadge.jsx). Signed-in shop only. Returns
// { show: false } when the store doesn't use BRIX's OTP wallet (its own
// MSG91 keys, or the wallet isn't switched on for it), so no badge appears.
import { authenticate } from '../shopify.server';
import { getCodSecrets, msg91Creds, getOtpWalletSummary } from '../services/cod.server';
import { otpWalletOn } from '../services/cod-sms.server';

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  try {
    if (!otpWalletOn(shop)) return Response.json({ show: false });
    const own = msg91Creds(await getCodSecrets(shop));
    if (own.authKey && own.templateId) return Response.json({ show: false });
    const w = await getOtpWalletSummary(shop);
    return Response.json({ show: true, balancePaise: w.balancePaise, pricePaise: w.pricePaise, messagesLeft: w.messagesLeft });
  } catch (error) {
    console.warn('[api.otp-credits] could not load:', String(error?.message || error).slice(0, 200));
    return Response.json({ show: false });
  }
};
