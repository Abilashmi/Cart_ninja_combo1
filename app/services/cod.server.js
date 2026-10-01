/**
 * BRIX COD Checkout — server side (see CLAUDE.md, "BRIX COD Checkout").
 *
 * Cash on Delivery orders are placed by BRIX itself: the storefront sheet
 * (extensions/cart-drawer/assets/brix_cod.js) collects phone + address, and
 * this module prices the items through Shopify (draftOrderCalculate — prices
 * from the browser are never trusted), checks the merchant's COD rules, then
 * creates a real Shopify order with payment pending (draftOrderCreate →
 * draftOrderComplete). Prepaid orders never come here; they use Shopify's own
 * checkout exactly as before.
 *
 * Tables (MySQL via db_proxy, created on first use — see ensureCodTables):
 *   cod_settings  one JSON settings blob per shop
 *   cod_otp       hashed one-time codes
 *   cod_orders    one row per COD order attempt (idempotency + daily limits + admin list)
 */
import crypto from 'node:crypto';
import { getDb } from './db.server';
import { sendOtpSms, smsProviderStatus } from './cod-sms.server';
import {
  DEFAULT_COD_SETTINGS, sanitizeCodSettings, checkCodRules, codCharges, isCheckoutOnlyLine,
  maskPhone, splitName, provinceCodeFor, moneyFormatter,
} from '../utils/cod.shared.js';

export class CodError extends Error {
  constructor(code, message, { status = 400, details } = {}) {
    super(message);
    this.name = 'CodError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function codErrorResponse(error, headers = {}) {
  if (error instanceof Response) return error;
  if (error instanceof CodError) {
    return Response.json({ success: false, error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) }, { status: error.status, headers });
  }
  console.error('[cod] unexpected error:', String(error?.stack || error?.message || error).slice(0, 500));
  return Response.json({ success: false, error: 'Something went wrong. Please try again, or pay online.', code: 'internal_error' }, { status: 500, headers });
}

/* ───────────────────────── storage ───────────────────────── */

let tablesReady = false;

export async function ensureCodTables(db = getDb()) {
  if (tablesReady) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cod_settings (
      shop          VARCHAR(255) NOT NULL,
      settings_json TEXT NOT NULL,
      updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (shop)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cod_otp (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop        VARCHAR(255) NOT NULL,
      phone_hash  CHAR(64) NOT NULL,
      code_hash   CHAR(64) NOT NULL,
      attempts    INT NOT NULL DEFAULT 0,
      verified    TINYINT(1) NOT NULL DEFAULT 0,
      expires_at  DATETIME NOT NULL,
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_cod_otp_phone (shop, phone_hash, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cod_orders (
      id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop            VARCHAR(255) NOT NULL,
      idem_key        VARCHAR(64) NOT NULL,
      status          VARCHAR(16) NOT NULL DEFAULT 'creating',
      source          VARCHAR(16) NOT NULL,
      phone_hash      CHAR(64) NOT NULL,
      phone_masked    VARCHAR(16) NOT NULL,
      phone_verified  TINYINT(1) NOT NULL DEFAULT 0,
      customer_name   VARCHAR(120) NULL,
      pincode         VARCHAR(10) NULL,
      total           DECIMAL(12,2) NULL,
      currency        VARCHAR(8) NULL,
      draft_order_id  VARCHAR(64) NULL,
      order_id        VARCHAR(64) NULL,
      order_name      VARCHAR(32) NULL,
      created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_cod_orders_idem (shop, idem_key),
      KEY idx_cod_orders_phone (shop, phone_hash, created_at),
      KEY idx_cod_orders_shop (shop, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  tablesReady = true;
}

async function run(fn) {
  const db = getDb();
  try {
    await ensureCodTables(db);
    return await fn(db);
  } catch (error) {
    if (error instanceof CodError) throw error;
    if (/duplicate entry|ER_DUP_ENTRY|1062/i.test(String(error?.message || ''))) {
      throw new CodError('duplicate', 'This request was already received.', { status: 409 });
    }
    console.error('[cod] database error:', String(error?.message || error).slice(0, 300));
    throw new CodError('database_error', 'Cash on Delivery is temporarily unavailable. Please try again, or pay online.', { status: 503 });
  }
}

export async function getCodSettings(shop) {
  return run(async (db) => {
    const [rows] = await db.execute('SELECT settings_json FROM cod_settings WHERE shop = ? LIMIT 1', [shop]);
    if (!rows?.length) return sanitizeCodSettings({}, DEFAULT_COD_SETTINGS);
    let stored = {};
    try { stored = JSON.parse(rows[0].settings_json || '{}') || {}; } catch { stored = {}; }
    return sanitizeCodSettings(stored, DEFAULT_COD_SETTINGS);
  });
}

/** Merge `patch` onto the saved settings (omitted fields keep their saved value). */
export async function saveCodSettings(shop, patch) {
  const current = await getCodSettings(shop);
  const next = sanitizeCodSettings(patch, current);
  await run((db) => db.execute(
    'INSERT INTO cod_settings (shop, settings_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json)',
    [shop, JSON.stringify(next)],
  ));
  return next;
}

/* ───────────────────────── secrets / hashing ───────────────────────── */

function secret() {
  const value = process.env.SHOPIFY_API_SECRET;
  if (!value) throw new CodError('not_configured', 'Cash on Delivery is not set up on this server.', { status: 503 });
  return value;
}

function hmac(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('hex');
}

export function phoneHash(shop, phone) {
  return hmac(`cod-phone:${shop}:${phone}`);
}

function codeHash(shop, phone, code) {
  return hmac(`cod-otp:${shop}:${phone}:${code}`);
}

const TOKEN_TTL_MS = 30 * 60 * 1000;

export function issuePhoneToken(shop, phone, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ s: shop, p: phone, e: now + TOKEN_TTL_MS })).toString('base64url');
  return `${payload}.${hmac(`cod-token:${payload}`)}`;
}

/** Returns the verified 10-digit phone, or null. */
export function readPhoneToken(shop, token, now = Date.now()) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = hmac(`cod-token:${payload}`);
  if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.s !== shop || typeof data.p !== 'string' || !(data.e > now)) return null;
    return data.p;
  } catch {
    return null;
  }
}

/* ───────────────────────── rate limiting (per process) ───────────────────────── */

const buckets = new Map();

/** Sliding-window counter. Returns true when the call is allowed. */
export function rateLimit(key, max, windowMs, now = Date.now()) {
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) { buckets.set(key, hits); return false; }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 20000) {
    for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  }
  return true;
}

export function clientIp(request) {
  return (request.headers.get('fly-client-ip')
    || request.headers.get('cf-connecting-ip')
    || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || 'unknown');
}

/* ───────────────────────── OTP ───────────────────────── */

const OTP_TTL_MIN = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_SENDS_PER_HOUR = 5;
const OTP_RESEND_SECONDS = 30;

export function otpAvailable() {
  return smsProviderStatus().configured;
}

export async function sendCodOtp(shop, phone) {
  const hash = phoneHash(shop, phone);
  await run(async (db) => {
    const [recent] = await db.execute(
      `SELECT COUNT(*) AS sends, MAX(TIMESTAMPDIFF(SECOND, created_at, NOW()) < ?) AS too_soon
         FROM cod_otp WHERE shop = ? AND phone_hash = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
      [OTP_RESEND_SECONDS, shop, hash],
    );
    const sends = Number(recent?.[0]?.sends || 0);
    if (Number(recent?.[0]?.too_soon || 0) === 1) {
      throw new CodError('otp_too_soon', `Please wait ${OTP_RESEND_SECONDS} seconds before asking for a new code.`, { status: 429 });
    }
    if (sends >= OTP_MAX_SENDS_PER_HOUR) {
      throw new CodError('otp_limit', 'Too many codes were sent to this number. Try again in an hour, or pay online.', { status: 429 });
    }
  });

  const code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  const [insert] = await run((db) => db.execute(
    `INSERT INTO cod_otp (shop, phone_hash, code_hash, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ${OTP_TTL_MIN} MINUTE))`,
    [shop, hash, codeHash(shop, phone, code)],
  ));
  const result = await sendOtpSms(phone, code);
  if (!result.sent) {
    await run((db) => db.execute('DELETE FROM cod_otp WHERE id = ?', [insert.insertId])).catch(() => {});
    throw new CodError('otp_send_failed', "We couldn't send the code to this number. Check it and try again, or pay online.", { status: 503 });
  }
  return { resendAfter: OTP_RESEND_SECONDS };
}

export async function verifyCodOtp(shop, phone, code) {
  if (!/^\d{4}$/.test(String(code || ''))) throw new CodError('otp_invalid', 'Enter the 4-digit code from the SMS.');
  const hash = phoneHash(shop, phone);
  return run(async (db) => {
    const [rows] = await db.execute(
      `SELECT id, code_hash, attempts FROM cod_otp
        WHERE shop = ? AND phone_hash = ? AND verified = 0 AND expires_at > NOW()
        ORDER BY id DESC LIMIT 1`,
      [shop, hash],
    );
    const row = rows?.[0];
    if (!row) throw new CodError('otp_expired', 'This code has expired. Ask for a new one.');
    if (Number(row.attempts) >= OTP_MAX_ATTEMPTS) throw new CodError('otp_locked', 'Too many wrong tries. Ask for a new code.');
    const expected = codeHash(shop, phone, code);
    const ok = expected.length === String(row.code_hash).length
      && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(row.code_hash)));
    if (!ok) {
      await db.execute('UPDATE cod_otp SET attempts = attempts + 1 WHERE id = ?', [row.id]);
      const left = OTP_MAX_ATTEMPTS - Number(row.attempts) - 1;
      throw new CodError('otp_wrong', left > 0 ? `That code doesn't match. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong tries. Ask for a new code.');
    }
    await db.execute('UPDATE cod_otp SET verified = 1 WHERE id = ?', [row.id]);
    return { token: issuePhoneToken(shop, phone) };
  });
}

/* ───────────────────────── Shopify ───────────────────────── */

async function gql(admin, query, variables) {
  let json;
  try {
    const res = await admin.graphql(query, { variables });
    json = await res.json();
  } catch (error) {
    json = error?.body || { errors: [{ message: String(error?.message || error) }] };
  }
  const errors = json?.errors;
  if (errors && (Array.isArray(errors) ? errors.length : true)) {
    const message = JSON.stringify(errors).slice(0, 400);
    if (/access denied|ACCESS_DENIED|draft_orders/i.test(message)) {
      console.error('[cod] missing Shopify permission:', message);
      throw new CodError('missing_scope', 'Cash on Delivery needs a permission update in the BRIX app. Please pay online for now.', { status: 503 });
    }
    console.error('[cod] Shopify GraphQL error:', message);
    throw new CodError('shopify_error', "We couldn't reach the store right now. Please try again, or pay online.", { status: 502 });
  }
  return json.data;
}

const toVariantGid = (id) => `gid://shopify/ProductVariant/${id}`;
const amountOf = (bag) => Number(bag?.shopMoney?.amount || 0);

async function loadVariants(admin, lines) {
  const data = await gql(admin, `#graphql
    query CodVariants($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant { id availableForSale product { id title tags status } }
      }
    }`, { ids: lines.map((l) => toVariantGid(l.variantId)) });
  const nodes = data?.nodes || [];
  const tags = [];
  nodes.forEach((node, i) => {
    if (!node?.id || node.product?.status !== 'ACTIVE') {
      throw new CodError('item_unavailable', 'One of the items in your cart is no longer available. Refresh the page and try again.', { status: 409 });
    }
    if (!node.availableForSale) {
      throw new CodError('item_sold_out', `${node.product?.title || 'An item'} is sold out.`, { status: 409, details: { variantId: lines[i].variantId } });
    }
    tags.push(...(node.product?.tags || []));
  });
  return { tags };
}

function draftLineItems(lines) {
  return lines.map((line) => ({
    variantId: toVariantGid(line.variantId),
    quantity: line.quantity,
    customAttributes: Object.entries(line.properties || {})
      .filter(([key]) => !key.startsWith('_brix'))
      .map(([key, value]) => ({ key, value })),
  }));
}

const CALCULATE = `#graphql
  mutation CodCalculate($input: DraftOrderInput!) {
    draftOrderCalculate(input: $input) {
      calculatedDraftOrder {
        currencyCode
        taxesIncluded
        discountCodes
        lineItems {
          name title variantTitle quantity
          image { url(transform: { maxWidth: 160 }) }
          originalTotalSet { shopMoney { amount } }
          discountedTotalSet { shopMoney { amount } }
        }
        lineItemsSubtotalPrice { shopMoney { amount } }
        subtotalPriceSet { shopMoney { amount } }
        totalDiscountsSet { shopMoney { amount } }
        totalShippingPriceSet { shopMoney { amount } }
        totalTaxSet { shopMoney { amount } }
        totalPriceSet { shopMoney { amount } }
      }
      userErrors { field message }
    }
  }`;

async function calculate(admin, input) {
  const data = await gql(admin, CALCULATE, { input });
  const result = data?.draftOrderCalculate;
  if (result?.userErrors?.length) {
    console.warn('[cod] draftOrderCalculate userErrors:', JSON.stringify(result.userErrors).slice(0, 300));
    throw new CodError('calculate_failed', "We couldn't price this order. Please try again, or pay online.", { status: 422 });
  }
  return result?.calculatedDraftOrder;
}

function shippingLine(settings, charges, currencyCode) {
  return {
    title: settings.codFee > 0 ? 'Cash on Delivery (incl. COD fee)' : 'Cash on Delivery',
    priceWithCurrency: { amount: charges.total.toFixed(2), currencyCode },
  };
}

/**
 * Price the lines through Shopify and apply the merchant's COD rules.
 * Returns { quote, input } — `input` is the DraftOrderInput core reused by placeCodOrder.
 */
export async function quoteCod(admin, { settings, lines, coupon, pincode, surface, currencyCode = 'INR' }) {
  if (lines.some((l) => isCheckoutOnlyLine(l.properties))) {
    throw new CodError('checkout_only', 'This cart has a Pack or free gift that is only available with online payment.', { status: 422 });
  }
  const { tags } = await loadVariants(admin, lines);
  const format = moneyFormatter(currencyCode);

  const code = settings.allowCoupons && typeof coupon === 'string' && /^[\w-]{1,60}$/.test(coupon.trim()) ? coupon.trim() : null;
  const base = {
    lineItems: draftLineItems(lines),
    acceptAutomaticDiscounts: true,
    ...(code ? { discountCodes: [code] } : {}),
    ...(pincode ? { shippingAddress: { countryCode: 'IN', zip: String(pincode) } } : {}),
  };

  let calc = await calculate(admin, base);
  const subtotal = amountOf(calc.subtotalPriceSet);
  const ruleError = checkCodRules({ settings, subtotal, pincode, productTags: tags, surface, format });
  if (ruleError) throw new CodError(ruleError.code, ruleError.message, { status: 422 });

  const charges = codCharges(settings, subtotal);
  const input = { ...base };
  if (charges.total > 0) {
    input.shippingLine = shippingLine(settings, charges, calc.currencyCode || currencyCode);
    calc = await calculate(admin, input);
  } else {
    input.shippingLine = shippingLine(settings, charges, calc.currencyCode || currencyCode);
  }

  const couponApplied = Boolean(code)
    && (calc.discountCodes || []).some((c) => c.toLowerCase() === code.toLowerCase())
    && amountOf(calc.totalDiscountsSet) > 0;

  const quote = {
    currency: calc.currencyCode || currencyCode,
    lines: (calc.lineItems || []).map((li) => ({
      title: li.name || li.title,
      variantTitle: li.variantTitle && li.variantTitle !== 'Default Title' ? li.variantTitle : '',
      quantity: li.quantity,
      image: li.image?.url || null,
      originalTotal: amountOf(li.originalTotalSet),
      total: amountOf(li.discountedTotalSet),
    })),
    itemsTotal: amountOf(calc.lineItemsSubtotalPrice),
    subtotal: amountOf(calc.subtotalPriceSet),
    discounts: amountOf(calc.totalDiscountsSet),
    shipping: charges.shipping,
    codFee: charges.codFee,
    tax: amountOf(calc.totalTaxSet),
    taxesIncluded: Boolean(calc.taxesIncluded),
    total: amountOf(calc.totalPriceSet),
    coupon: code ? { code, applied: couponApplied } : null,
  };
  if (code && !couponApplied) delete input.discountCodes;
  return { quote, input };
}

const CREATE = `#graphql
  mutation CodCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder { id ready }
      userErrors { field message }
    }
  }`;

const COMPLETE = `#graphql
  mutation CodComplete($id: ID!) {
    draftOrderComplete(id: $id, paymentPending: true) {
      draftOrder {
        order { id name statusPageUrl totalPriceSet { shopMoney { amount currencyCode } } }
      }
      userErrors { field message }
    }
  }`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUntilReady(admin, id) {
  for (let i = 0; i < 12; i++) {
    const data = await gql(admin, `#graphql
      query CodDraftReady($id: ID!) { draftOrder(id: $id) { ready } }`, { id });
    if (data?.draftOrder?.ready) return;
    await sleep(500);
  }
  throw new CodError('draft_not_ready', 'The store took too long to confirm your order. Please try again.', { status: 504 });
}

async function deleteDraft(admin, id) {
  try {
    await gql(admin, `#graphql
      mutation CodDraftDelete($input: DraftOrderDeleteInput!) { draftOrderDelete(input: $input) { deletedId } }`, { input: { id } });
  } catch { /* best effort */ }
}

function addressInput(address, phone, withProvince = true) {
  const { firstName, lastName } = splitName(address.name);
  const provinceCode = withProvince ? provinceCodeFor(address.state) : null;
  return {
    firstName, lastName: lastName || firstName,
    address1: address.address1,
    address2: address.address2 || null,
    city: provinceCode ? address.city : `${address.city}, ${address.state}`,
    ...(provinceCode ? { provinceCode } : {}),
    zip: address.pincode,
    countryCode: 'IN',
    phone: `+91${phone}`,
  };
}

/**
 * Create the COD order. Idempotent per (shop, idemKey): a retried tap returns
 * the order already placed instead of creating a second one.
 */
export async function placeCodOrder(admin, {
  shop, settings, lines, coupon, address, phone, phoneVerified, surface, attributes = {}, idemKey, currencyCode,
}) {
  if (!/^[\w-]{8,64}$/.test(String(idemKey || ''))) throw new CodError('invalid_request', 'Refresh the page and try again.');
  const hash = phoneHash(shop, phone);

  const existing = await run(async (db) => {
    const [rows] = await db.execute('SELECT status, order_name, order_id, total, currency FROM cod_orders WHERE shop = ? AND idem_key = ? LIMIT 1', [shop, idemKey]);
    return rows?.[0] || null;
  });
  if (existing?.status === 'placed') {
    return { orderName: existing.order_name, orderId: existing.order_id, total: Number(existing.total), currency: existing.currency, statusPageUrl: null, repeated: true };
  }
  if (existing) throw new CodError('in_progress', 'Your order is already being placed. Please wait a moment.', { status: 409 });

  const placedToday = await run(async (db) => {
    const [rows] = await db.execute(
      "SELECT COUNT(*) AS n FROM cod_orders WHERE shop = ? AND phone_hash = ? AND status = 'placed' AND created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)",
      [shop, hash],
    );
    return Number(rows?.[0]?.n || 0);
  });
  if (placedToday >= settings.dailyLimitPerPhone) {
    throw new CodError('daily_limit', `This number has reached today's limit of ${settings.dailyLimitPerPhone} Cash on Delivery ${settings.dailyLimitPerPhone === 1 ? 'order' : 'orders'}. Please pay online to order again.`, { status: 429 });
  }

  const { quote, input } = await quoteCod(admin, { settings, lines, coupon, pincode: address.pincode, surface, currencyCode });

  try {
    await run((db) => db.execute(
      `INSERT INTO cod_orders (shop, idem_key, status, source, phone_hash, phone_masked, phone_verified, customer_name, pincode, total, currency)
       VALUES (?, ?, 'creating', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [shop, idemKey, surface, hash, maskPhone(phone), phoneVerified ? 1 : 0, address.name.slice(0, 120), address.pincode, quote.total, quote.currency],
    ));
  } catch (error) {
    if (error instanceof CodError && error.code === 'duplicate') throw new CodError('in_progress', 'Your order is already being placed. Please wait a moment.', { status: 409 });
    throw error;
  }

  const clearAttempt = () => run((db) => db.execute("DELETE FROM cod_orders WHERE shop = ? AND idem_key = ? AND status = 'creating'", [shop, idemKey])).catch(() => {});

  const tags = [...new Set(['COD', 'BRIX-COD', `brix-src-${surface}`, ...settings.orderTags])];
  const customAttributes = [
    { key: 'payment_method', value: 'Cash on Delivery' },
    { key: 'brix_cod_source', value: surface },
    { key: 'brix_cod_phone_verified', value: phoneVerified ? 'yes' : 'no' },
    ...Object.entries(attributes || {})
      .filter(([k, v]) => /^[\w ]{1,40}$/.test(k) && v != null && String(v).length <= 200)
      .slice(0, 10)
      .map(([key, value]) => ({ key, value: String(value) })),
  ];
  const where = { drawer: 'cart drawer', product: 'product page', combo: 'combo page' }[surface] || surface;
  const orderInput = (withProvince) => ({
    ...input,
    shippingAddress: addressInput(address, phone, withProvince),
    billingAddress: addressInput(address, phone, withProvince),
    phone: `+91${phone}`,
    ...(address.email ? { email: address.email } : {}),
    tags,
    note: `Cash on Delivery order placed through BRIX (${where}). Collect ${moneyFormatter(quote.currency)(quote.total)} on delivery.${phoneVerified ? ' Phone verified by OTP.' : ''}`,
    customAttributes,
  });

  let draftId = null;
  try {
    let created = (await gql(admin, CREATE, { input: orderInput(true) }))?.draftOrderCreate;
    if (created?.userErrors?.some((e) => /province|state|zone/i.test(`${e.field} ${e.message}`))) {
      created = (await gql(admin, CREATE, { input: orderInput(false) }))?.draftOrderCreate;
    }
    if (created?.userErrors?.length || !created?.draftOrder?.id) {
      console.error('[cod] draftOrderCreate userErrors:', JSON.stringify(created?.userErrors || []).slice(0, 400));
      const first = created?.userErrors?.[0]?.message;
      throw new CodError('order_rejected', first ? `The store couldn't accept this order: ${first}` : "The store couldn't accept this order. Please check your details.", { status: 422 });
    }
    draftId = created.draftOrder.id;
    if (!created.draftOrder.ready) await waitUntilReady(admin, draftId);

    const completed = (await gql(admin, COMPLETE, { id: draftId }))?.draftOrderComplete;
    const order = completed?.draftOrder?.order;
    if (completed?.userErrors?.length || !order?.id) {
      console.error('[cod] draftOrderComplete userErrors:', JSON.stringify(completed?.userErrors || []).slice(0, 400));
      throw new CodError('order_rejected', completed?.userErrors?.[0]?.message
        ? `The store couldn't confirm this order: ${completed.userErrors[0].message}`
        : "The store couldn't confirm this order. Please try again, or pay online.", { status: 422 });
    }

    const total = Number(order.totalPriceSet?.shopMoney?.amount ?? quote.total);
    const currency = order.totalPriceSet?.shopMoney?.currencyCode || quote.currency;
    await run((db) => db.execute(
      "UPDATE cod_orders SET status = 'placed', draft_order_id = ?, order_id = ?, order_name = ?, total = ?, currency = ? WHERE shop = ? AND idem_key = ?",
      [draftId, order.id, order.name, total, currency, shop, idemKey],
    )).catch((error) => console.error('[cod] order placed but tracking row update failed:', order.name, error?.message));

    return { orderName: order.name, orderId: order.id, statusPageUrl: order.statusPageUrl || null, total, currency };
  } catch (error) {
    if (draftId) await deleteDraft(admin, draftId);
    await clearAttempt();
    throw error;
  }
}

/* ───────────────────────── admin: orders list ───────────────────────── */

export async function listCodOrders(admin, shop, limit = 50) {
  const rows = await run(async (db) => {
    const [r] = await db.execute(
      `SELECT order_id, order_name, source, phone_masked, phone_verified, customer_name, pincode, total, currency, created_at
         FROM cod_orders WHERE shop = ? AND status = 'placed' ORDER BY id DESC LIMIT ${Math.min(200, Math.max(1, Number(limit) || 50))}`,
      [shop],
    );
    return r || [];
  });
  const ids = rows.map((r) => r.order_id).filter(Boolean);
  const live = new Map();
  if (ids.length && admin) {
    try {
      const data = await gql(admin, `#graphql
        query CodOrders($ids: [ID!]!) {
          nodes(ids: $ids) { ... on Order { id displayFinancialStatus displayFulfillmentStatus cancelledAt } }
        }`, { ids });
      for (const node of data?.nodes || []) if (node?.id) live.set(node.id, node);
    } catch (error) {
      console.warn('[cod] could not load live order status:', error?.message);
    }
  }
  return rows.map((r) => {
    const node = live.get(r.order_id);
    let status = 'unknown';
    if (node) {
      if (node.cancelledAt) status = 'cancelled';
      else if (node.displayFinancialStatus === 'PAID') status = 'paid';
      else if (['REFUNDED', 'VOIDED'].includes(node.displayFinancialStatus)) status = 'cancelled';
      else status = 'pending';
    }
    return {
      orderId: r.order_id,
      orderName: r.order_name,
      orderNumericId: String(r.order_id || '').split('/').pop(),
      source: r.source,
      phone: r.phone_masked,
      phoneVerified: Number(r.phone_verified) === 1,
      customer: r.customer_name,
      pincode: r.pincode,
      total: Number(r.total || 0),
      currency: r.currency,
      createdAt: r.created_at ? `${String(r.created_at).replace(' ', 'T')}Z` : null,
      status,
      fulfillment: node?.displayFulfillmentStatus || null,
    };
  });
}

export function summarizeCodOrders(orders) {
  const sum = (list) => list.reduce((a, o) => a + o.total, 0);
  const pending = orders.filter((o) => o.status === 'pending');
  const paid = orders.filter((o) => o.status === 'paid');
  const cancelled = orders.filter((o) => o.status === 'cancelled');
  return {
    count: orders.length,
    toCollect: sum(pending),
    collected: sum(paid),
    paidCount: paid.length,
    cancelledCount: cancelled.length,
    cancelRate: orders.length ? Math.round((cancelled.length / orders.length) * 100) : 0,
  };
}

/* ───────────────────────── PIN code lookup ───────────────────────── */

const pinCache = new Map();

/** India Post lookup. Returns { city, state } or null — never throws. */
export async function lookupPincode(pin) {
  const cached = pinCache.get(pin);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  let value = null;
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`, { signal: AbortSignal.timeout(3500) });
    const body = await res.json();
    const office = body?.[0]?.Status === 'Success' ? body[0].PostOffice?.[0] : null;
    if (office?.State) value = { city: office.District || office.Block || office.Name || '', state: office.State };
  } catch {
    value = null;
  }
  pinCache.set(pin, { value, expiresAt: Date.now() + (value ? 24 * 3600e3 : 5 * 60e3) });
  if (pinCache.size > 5000) pinCache.delete(pinCache.keys().next().value);
  return value;
}
