# Digifyce side of the BRIX OTP wallet (recharge only)

Digifyce only takes the Razorpay payment for a recharge. OTP SMS are sent by the BRIX PHP server, not from here.

Upload every `.php` file here to one folder on Digifyce's server: https://digifyceglobal.com/wallet-brix-convert (live since Nov 2026). BRIX talks to them; merchants only ever see `razorpay_pay.php`.

| File | Who calls it | What it does |
|---|---|---|
| `razorpay_create_order.php` | BRIX PHP server | Opens a Razorpay order for a recharge, returns the payment page link |
| `razorpay_pay.php` | Merchant's browser | Razorpay Checkout for that order |
| `razorpay_return.php` | Merchant's browser (after paying) | Verifies the payment, has BRIX credit the wallet, sends the merchant back to BRIX |
| `razorpay_webhook.php` | Razorpay | Same credit step, even if the merchant closed the tab. Event: `order.paid` |
| `razorpay_helpers.php` | all of the above | Shared checks and the signed call to BRIX |

## Server settings (never put these in the code)

Copy `.htaccess.example` to `.htaccess` on the Digifyce server and fill it in.

## Razorpay dashboard

Settings → Webhooks → add `https://digifyceglobal.com/wallet-brix-convert/razorpay_webhook.php`, event **order.paid**, with the same secret as `RAZORPAY_WEBHOOK_SECRET`. Test with Razorpay **test keys** first.

## On the BRIX side

PHP server (`php_backend/.htaccess`): `DIGIFYCE_API_URL`, `DIGIFYCE_API_KEY` (= `BRIX_API_KEY` here), `DIGIFYCE_CONFIRM_SECRET` (= `BRIX_CONFIRM_SECRET` here). Upload `otp_wallet.php`, `otp_wallet_lib.php`, `otp_wallet_confirm.php`.
Fly needs nothing from Digifyce (`OTP_WALLET_RECHARGE=1` shows "Add money").

`BRIX_CONFIRM_URL` here = `https://<BRIX PHP server>/php_backend/otp_wallet_confirm.php` (wherever `cod_otp.php` is served from).

## How the money moves

1. Merchant enters an amount in BRIX → BRIX PHP records a recharge and asks `razorpay_create_order.php` for an order.
2. Merchant pays on `razorpay_pay.php` (Razorpay Checkout).
3. `razorpay_return.php` and `razorpay_webhook.php` both check the order and payment with Razorpay, then POST a signed confirmation to BRIX `otp_wallet_confirm.php`.
4. BRIX checks the signature, the recharge and the amount, and credits the wallet **once per payment id**.
5. Each OTP is sent by the BRIX PHP server itself (`php_backend/otp_wallet.php` `send` → `otp_sms_lib.php`, BRIX's MSG91 account): it takes 50 paise and gives them back if MSG91 refuses. Digifyce sends no SMS.
