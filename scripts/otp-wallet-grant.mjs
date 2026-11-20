#!/usr/bin/env node
/* eslint-env node */
// Gives a store free OTP codes (BRIX pays): credits its OTP wallet through
// php_backend/otp_wallet.php `grant`. The same reference never credits twice,
// so running it again by mistake does nothing (pass --ref to grant again).
//
//   PHP_BASE_URL=https://int.thebrix.io BRIX_INTERNAL_SECRET=... \
//     node scripts/otp-wallet-grant.mjs <shop>.myshopify.com <codes> [--ref grant:launch]
//
// 1 code = 50 paise; at most 2000 codes (Rs 1,000) a grant.
import { internalAuthHeaders } from '../app/utils/internal-auth.js';

const OTP_PRICE_PAISE = 50;
const args = process.argv.slice(2);
const refAt = args.indexOf('--ref');
const ref = refAt >= 0 ? args.splice(refAt, 2)[1] : null;
const [shop, codesRaw] = args;
const codes = Number(codesRaw);

if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(String(shop || '')) || !Number.isInteger(codes) || codes < 1 || codes > 2000) {
  console.error('Usage: node scripts/otp-wallet-grant.mjs <shop>.myshopify.com <codes 1-2000> [--ref grant:<name>]');
  process.exit(1);
}
const base = String(process.env.PHP_BASE_URL || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('Set PHP_BASE_URL to the BRIX PHP server (where otp_wallet.php is), e.g. https://int.thebrix.io');
  process.exit(1);
}
if (!internalAuthHeaders()['X-Brix-Internal-Secret']) {
  console.error('Set BRIX_INTERNAL_SECRET (the same 32+ character value as on Fly and the PHP server).');
  process.exit(1);
}
const grantRef = ref && ref.startsWith('grant:') ? ref : `grant:${codes}-codes`;

const call = (body) => fetch(`${base}/otp_wallet.php`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...internalAuthHeaders() },
  body: JSON.stringify(body),
}).then(async (res) => ({ status: res.status, json: await res.json().catch(() => ({})) }));

const res = await call({ action: 'grant', shop, amount_paise: codes * OTP_PRICE_PAISE, ref: grantRef });
if (res.status !== 200 || res.json.success === false) {
  console.error(`Not credited (HTTP ${res.status}):`, res.json.error || res.json.code || res.json);
  process.exit(1);
}
const balance = Number(res.json.balance_paise) || 0;
console.log(res.json.duplicate
  ? `Already granted earlier (${grantRef}); nothing added.`
  : `Added ${codes} codes (Rs ${(codes * OTP_PRICE_PAISE / 100).toFixed(2)}) to ${shop}.`);
console.log(`Balance now Rs ${(balance / 100).toFixed(2)} = ${Math.floor(balance / OTP_PRICE_PAISE)} codes.`);
