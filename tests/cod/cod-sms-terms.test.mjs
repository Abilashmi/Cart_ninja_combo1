// Run with: node --test tests/cod/cod-sms-terms.test.mjs
// The store's own MSG91 keys for OTP SMS, the popup's Terms and conditions
// link, and the text on Shopify's Buy it now (COD → Customize).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { smsProviderStatus, sendOtpSms } from '../../app/services/cod-sms.server.js';
import { sanitizeCodSettings, DEFAULT_COD_SETTINGS, isValidTermsUrl } from '../../app/utils/cod.shared.js';
import { toForm, toSettings, formErrors, secretsPatch, SECRET_FIELDS } from '../../app/components/cod/codSettingsForm.js';

const withEnv = async (env, fn) => {
  const keep = { ...process.env };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  try { return await fn(); } finally { process.env = keep; }
};

test('MSG91: the store\'s own keys first, then the server\'s, else nothing', () => withEnv(
  { MSG91_AUTH_KEY: undefined, MSG91_OTP_TEMPLATE_ID: undefined, COD_OTP_DEV_LOG: undefined },
  async () => {
    assert.deepEqual(smsProviderStatus({}), { configured: false, provider: null, source: null });
    assert.deepEqual(smsProviderStatus({ authKey: 'abc' }), { configured: false, provider: null, source: null }, 'both keys are needed');
    assert.deepEqual(smsProviderStatus({ authKey: 'abc', templateId: 't1' }), { configured: true, provider: 'msg91', source: 'store' });
    await withEnv({ MSG91_AUTH_KEY: 'srv', MSG91_OTP_TEMPLATE_ID: 'srvT' }, () => {
      assert.equal(smsProviderStatus({}).source, 'server');
      assert.equal(smsProviderStatus({ authKey: 'abc', templateId: 't1' }).source, 'store', 'the store\'s keys win');
    });
  },
));

test('MSG91: the code goes out with the store\'s key and template', () => withEnv(
  { MSG91_AUTH_KEY: 'srv', MSG91_OTP_TEMPLATE_ID: 'srvT' },
  async () => {
    const realFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push({ url: String(url), key: init.headers.authkey }); return new Response('{"type":"success"}'); };
    try {
      assert.deepEqual(await sendOtpSms('9876543210', '1234', { authKey: 'storeKey', templateId: 'storeTpl' }), { sent: true });
      assert.deepEqual(await sendOtpSms('9876543210', '1234', null), { sent: true });
    } finally { globalThis.fetch = realFetch; }
    const u0 = new URL(calls[0].url);
    assert.deepEqual([calls[0].key, u0.searchParams.get('template_id'), u0.searchParams.get('mobile'), u0.searchParams.get('otp')], ['storeKey', 'storeTpl', '919876543210', '1234']);
    assert.deepEqual([calls[1].key, new URL(calls[1].url).searchParams.get('template_id')], ['srv', 'srvT'], 'no store keys: the server\'s');
  },
));

test('MSG91 keys are write-only secrets in the admin form', () => {
  assert.ok(SECRET_FIELDS.includes('msg91AuthKey') && SECRET_FIELDS.includes('msg91TemplateId'));
  const f = toForm(sanitizeCodSettings({}));
  assert.equal(f.msg91AuthKey, '');
  assert.deepEqual(secretsPatch({ ...f, msg91AuthKey: ' key123 ', msg91TemplateId: '' }), { msg91AuthKey: 'key123' }, 'empty = keep the saved one');
  assert.deepEqual(secretsPatch({ ...f, msg91TemplateId: null }), { msg91TemplateId: null }, 'null = remove');
  assert.equal(JSON.stringify(toSettings(f)).includes('msg91'), false, 'never in the settings the storefront reads');
});

test('Terms and conditions link: empty = the store\'s terms page; https or a store path only', () => {
  assert.equal(DEFAULT_COD_SETTINGS.sheet.termsUrl, '');
  for (const ok of ['https://example.com/terms', '/policies/terms-of-service', '/pages/terms']) assert.equal(isValidTermsUrl(ok), true, ok);
  for (const bad of ['http://example.com', 'javascript:alert(1)', 'terms', '/pages/a b', 'https://x.com/"><script>']) assert.equal(isValidTermsUrl(bad), false, bad);
  assert.equal(sanitizeCodSettings({ sheet: { termsUrl: '/pages/terms' } }).sheet.termsUrl, '/pages/terms');
  assert.equal(sanitizeCodSettings({ sheet: { termsUrl: 'javascript:alert(1)' } }).sheet.termsUrl, '');
  const f = toForm(sanitizeCodSettings({}));
  assert.equal(formErrors({ ...f, sheetTermsUrl: 'www.x.com' }).sheetTermsUrl !== undefined, true);
  assert.equal(formErrors({ ...f, sheetTermsUrl: '' }).sheetTermsUrl, undefined);
  assert.equal(toSettings({ ...f, sheetTermsUrl: ' /pages/terms ' }).sheet.termsUrl, '/pages/terms');
});

test('Buy it now text: kept, cleaned, and round-trips through the form', () => {
  assert.equal(DEFAULT_COD_SETTINGS.productButton.buyNowText, '');
  const s = sanitizeCodSettings({ productButton: { buyNowText: '  Buy it now   {price} ' } });
  assert.equal(s.productButton.buyNowText, 'Buy it now {price}');
  assert.equal(sanitizeCodSettings({ productButton: { marginTop: 4 } }, s).productButton.buyNowText, 'Buy it now {price}', 'other saves keep it');
  assert.equal(toSettings(toForm(s)).productButton.buyNowText, 'Buy it now {price}');
});

test('Buy it now selector and the theme drawer\'s Checkout text', () => {
  assert.equal(sanitizeCodSettings({ productButton: { buyNowSelector: ' .hk-buy-now ' } }).productButton.buyNowSelector, '.hk-buy-now');
  assert.equal(sanitizeCodSettings({ productButton: { buyNowSelector: '<script>' } }).productButton.buyNowSelector, '', 'not a selector');
  assert.equal(DEFAULT_COD_SETTINGS.drawerCheckoutText, '');
  const s = sanitizeCodSettings({ drawerCheckoutText: '  Pay online   {price} ' });
  assert.equal(s.drawerCheckoutText, 'Pay online {price}');
  assert.equal(sanitizeCodSettings({ codFee: 5 }, s).drawerCheckoutText, 'Pay online {price}', 'other saves keep it');
  const f = toForm(s);
  assert.equal(toSettings(f).drawerCheckoutText, 'Pay online {price}');
  assert.ok(formErrors({ ...f, pbBuyNowSelector: '<b>' }).pbBuyNowSelector);
  assert.equal(toSettings({ ...f, pbBuyNowSelector: '.hk-buy-now' }).productButton.buyNowSelector, '.hk-buy-now');
  const php = fs.readFileSync(new URL('../../php_backend/cod_storefront.php', import.meta.url), 'utf8');
  assert.match(php, /'buyNowSelector' => cods_selector/);
  assert.match(php, /'drawerCheckoutText' => cods_text/);
});

test('storefront and PHP: "Terms and conditions", no data policy; PHP passes buyNowText and termsUrl', () => {
  const js = fs.readFileSync(new URL('../../extensions/cart-drawer/assets/brix_cod.js', import.meta.url), 'utf8');
  assert.match(js, /Terms and conditions<\/a>/);
  assert.doesNotMatch(js, /data policy|cod-data-policy/i);
  assert.match(js, /policies\/terms-of-service/);
  const php = fs.readFileSync(new URL('../../php_backend/cod_storefront.php', import.meta.url), 'utf8');
  assert.match(php, /'buyNowText' => cods_text/);
  assert.match(php, /'termsUrl' =>/);
  const settingsPhp = fs.readFileSync(new URL('../../php_backend/cod_settings.php', import.meta.url), 'utf8');
  assert.match(settingsPhp, /'msg91AuthKey'\s+=> \['msg91_auth_key'/);
});
