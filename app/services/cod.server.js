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
 * Storage lives in the PHP backend (php_backend/cod_settings.php, cod_otp.php,
 * cod_orders.php), which owns the cod_settings / cod_otp / cod_orders tables.
 * This module only sends it hashes of phone numbers and OTP codes, never the
 * raw values.
 */
import crypto from 'node:crypto';
import { BASE_PHP_URL } from '../utils/api-helpers';
import { sendOtpSms, smsProviderStatus } from './cod-sms.server';
import { sendCodPurchaseEvents, sendCodRefundEvent } from './cod-tracking.server';
import {
  DEFAULT_COD_SETTINGS, sanitizeCodSettings, checkCodRules, codCharges, isCheckoutOnlyLine,
  maskPhone, splitName, provinceCodeFor, moneyFormatter,
} from '../utils/cod.shared.js';
import { computeBox, decimalsFor, formatWeight, tierLabel, toGrams, toMinor } from '../utils/combo-weight.shared.js';
import { COMBO_WEIGHT_CONFIG_KEY, COMBO_WEIGHT_DISCOUNT_TITLE } from './combo-weight-shopify.server';

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

/* ───────────────────────── storage (PHP backend) ───────────────────────── */

const PHP_TIMEOUT_MS = 15_000;

/**
 * Calls one of the COD PHP endpoints (php_backend/cod_*.php), which own the
 * cod_settings / cod_otp / cod_orders tables. Returns the parsed JSON on
 * success; throws a CodError otherwise. Expected refusals (409 duplicate,
 * 429 OTP limits) keep the PHP code and message so callers can react.
 */
async function php(file, body) {
  let res;
  let json;
  try {
    res = await fetch(`${BASE_PHP_URL}/${file}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Forge-Secret': process.env.SHOPIFY_API_KEY || '' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PHP_TIMEOUT_MS),
    });
    json = await res.json().catch(() => null); // e.g. the host's HTML 404 page
  } catch (error) {
    console.error(`[cod] ${file} unreachable:`, String(error?.message || error).slice(0, 200));
    throw new CodError('database_error', 'Cash on Delivery is temporarily unavailable. Please try again, or pay online.', { status: 503 });
  }
  if (res.ok && json?.success) return json;
  if (res.status === 404 && !json?.code) {
    console.error(`[cod] ${BASE_PHP_URL}/${file} not found — upload php_backend/cod_*.php to the PHP server.`);
    throw new CodError('storage_missing', 'Cash on Delivery is temporarily unavailable. Please try again, or pay online.', { status: 503 });
  }
  if ([409, 429].includes(res.status) && json?.code) throw new CodError(json.code, json.error, { status: res.status });
  console.error(`[cod] ${file} ${body.action} failed:`, res.status, JSON.stringify(json).slice(0, 300));
  throw new CodError('database_error', 'Cash on Delivery is temporarily unavailable. Please try again, or pay online.', { status: 503 });
}

async function loadStoredSettings(shop) {
  const { settings } = await php('cod_settings.php', { action: 'get', shop });
  return settings && typeof settings === 'object' ? settings : null;
}

export async function getCodSettings(shop) {
  return sanitizeCodSettings((await loadStoredSettings(shop)) || {}, DEFAULT_COD_SETTINGS);
}

/** The settings plus the stored runtime facts (e.g. whether the prepaid discount is verified in Shopify). */
export async function getCodSettingsWithRuntime(shop) {
  const raw = await loadStoredSettings(shop);
  return { settings: sanitizeCodSettings(raw || {}, DEFAULT_COD_SETTINGS), runtime: raw?._runtime || {} };
}

// Facts only this Node server knows, stored next to the settings so the
// storefront can read everything from php_backend/cod_storefront.php.
// `prepaid` (from prepaid-discount-shopify.server.js) is kept until the next
// prepaid sync replaces it.
function runtimeFacts(previous) {
  const facts = { otpAvailable: otpAvailable() };
  if (previous?.prepaid && typeof previous.prepaid === 'object') facts.prepaid = previous.prepaid;
  return facts;
}

/**
 * Merge `patch` onto the saved settings (omitted fields keep their saved value).
 * `syncPrepaid(next)`, when given, brings Shopify's prepaid discount in line
 * with the new settings before they are stored, and returns the runtime facts
 * the storefront may rely on ({ verified, percent, ... }); its result is kept
 * in `_runtime.prepaid`.
 */
export async function saveCodSettings(shop, patch, { syncPrepaid } = {}) {
  const raw = await loadStoredSettings(shop);
  const current = sanitizeCodSettings(raw || {}, DEFAULT_COD_SETTINGS);
  const next = sanitizeCodSettings(patch, current);
  const runtime = runtimeFacts(raw?._runtime);
  if (typeof syncPrepaid === 'function') runtime.prepaid = await syncPrepaid(next);
  await php('cod_settings.php', { action: 'save', shop, settings: { ...next, _runtime: runtime } });
  return next;
}

/**
 * Re-saves the stored settings when the runtime facts changed since the last
 * save (e.g. an SMS provider was configured), so the storefront's OTP step
 * matches what /api/cod/otp will actually accept. Called by the admin page.
 */
export async function syncCodRuntime(shop) {
  const raw = await loadStoredSettings(shop);
  if (!raw) return;
  const facts = runtimeFacts(raw._runtime);
  if (JSON.stringify(raw._runtime || null) === JSON.stringify(facts)) return;
  const settings = sanitizeCodSettings(raw, DEFAULT_COD_SETTINGS);
  await php('cod_settings.php', { action: 'save', shop, settings: { ...settings, _runtime: facts } });
}

/* ───────────────────────── tracking secrets ───────────────────────── */

// GA4 Measurement Protocol secret, Meta Conversions API token and Meta test
// event code. Kept in their own table (php_backend/cod_settings.php
// secrets_*), never in the settings blob the storefront reads. Only this
// server reads the values; the admin page sees getCodSecretsStatus().
const SECRET_KEYS = ['ga4ApiSecret', 'metaCapiToken', 'metaTestCode'];
const SECRET_RE = /^[A-Za-z0-9_-]{1,512}$/;

export async function getCodSecrets(shop) {
  const { secrets } = await php('cod_settings.php', { action: 'secrets_get', shop });
  return { ga4ApiSecret: secrets?.ga4ApiSecret || '', metaCapiToken: secrets?.metaCapiToken || '', metaTestCode: secrets?.metaTestCode || '' };
}

export async function getCodSecretsStatus(shop) {
  const s = await getCodSecrets(shop);
  const status = (v) => ({ set: Boolean(v), last4: v ? v.slice(-4) : '' });
  return { ga4ApiSecret: status(s.ga4ApiSecret), metaCapiToken: status(s.metaCapiToken), metaTestCode: status(s.metaTestCode) };
}

/**
 * `patch` keys that are missing or '' keep the saved value; null removes it.
 * Throws a CodError naming the field when a value doesn't look like a key.
 */
export async function saveCodSecrets(shop, patch = {}) {
  const secrets = {};
  for (const key of SECRET_KEYS) {
    if (!(key in (patch || {}))) continue;
    const value = patch[key];
    if (value === null) { secrets[key] = ''; continue; }
    const v = String(value ?? '').trim();
    if (!v) continue;
    if (!SECRET_RE.test(v)) throw new CodError(`invalid_${key}`, `${key} does not look right. Paste it again without spaces.`);
    secrets[key] = v;
  }
  if (Object.keys(secrets).length) await php('cod_settings.php', { action: 'secrets_save', shop, secrets });
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
  // Relayed by php_backend/cod_checkout.php: the connection comes from the
  // PHP server, so use the shopper IP it forwards (trusted only with the secret).
  const relayed = request.headers.get('x-brix-client-ip');
  const secret = process.env.SHOPIFY_API_KEY;
  if (relayed && secret && request.headers.get('x-forge-secret') === secret) return relayed.trim().slice(0, 64);
  return (request.headers.get('fly-client-ip')
    || request.headers.get('cf-connecting-ip')
    || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || 'unknown');
}

/** The shopper's User-Agent, forwarded by the PHP relay (trusted only with the secret, like clientIp). */
export function clientUa(request) {
  const secret = process.env.SHOPIFY_API_KEY;
  const relayed = request.headers.get('x-brix-client-ua');
  if (relayed && secret && request.headers.get('x-forge-secret') === secret) return relayed.slice(0, 400);
  return (request.headers.get('user-agent') || '').slice(0, 400);
}

/* ───────────────────────── OTP ───────────────────────── */

// Limits (30 s between codes, 5 per hour, 10 min expiry, 5 tries) are
// enforced by php_backend/cod_otp.php.

export function otpAvailable() {
  return smsProviderStatus().configured;
}

export async function sendCodOtp(shop, phone) {
  const code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  const { id, resendAfter } = await php('cod_otp.php', {
    action: 'create', shop, phone_hash: phoneHash(shop, phone), code_hash: codeHash(shop, phone, code),
  });
  const result = await sendOtpSms(phone, code);
  if (!result.sent) {
    await php('cod_otp.php', { action: 'delete', shop, id }).catch(() => {});
    throw new CodError('otp_send_failed', "We couldn't send the code to this number. Check it and try again, or pay online.", { status: 503 });
  }
  return { resendAfter: resendAfter || 30 };
}

export async function verifyCodOtp(shop, phone, code) {
  if (!/^\d{4}$/.test(String(code || ''))) throw new CodError('otp_invalid', 'Enter the 4-digit code from the SMS.');
  const { result, attemptsLeft } = await php('cod_otp.php', {
    action: 'verify', shop, phone_hash: phoneHash(shop, phone), code_hash: codeHash(shop, phone, code),
  });
  if (result === 'ok') return { token: issuePhoneToken(shop, phone) };
  if (result === 'wrong') throw new CodError('otp_wrong', `That code doesn't match. ${attemptsLeft} ${attemptsLeft === 1 ? 'try' : 'tries'} left.`);
  if (result === 'locked') throw new CodError('otp_locked', 'Too many wrong tries. Ask for a new code.');
  throw new CodError('otp_expired', 'This code has expired. Ask for a new one.');
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

// Every COD line (and the order itself, see placeCodOrder) carries this. The
// BRIX prepaid discount Function (extensions/brix-prepaid-discount) gives
// nothing to a cart with it, so automatic discounts accepted on the draft
// (acceptAutomaticDiscounts) can never include the online-payment discount.
// Set here on the server only; shopper-sent _brix* properties are dropped.
export const COD_MARKER = Object.freeze({ key: '_brixCod', value: 'true' });

function draftLineItems(lines) {
  return lines.map((line) => ({
    variantId: toVariantGid(line.variantId),
    quantity: line.quantity,
    customAttributes: [
      ...Object.entries(line.properties || {})
        .filter(([key]) => !key.startsWith('_brix'))
        .map(([key, value]) => ({ key, value })),
      { ...COD_MARKER },
    ],
  }));
}

/* ───────────────────────── weight combo boxes ───────────────────────── */

// A weight-priced combo box (combo page, or its lines in the cart drawer)
// gets its price in Shopify checkout from the BRIX combo weight Function.
// Draft orders don't run it for these lines (their _brix* markers are
// stripped above), so COD applies the same box price itself, from the same
// trusted config the Function reads and the same shared rules
// (combo-weight.shared.js), as a line discount on the draft order.
const numericOf = (gid) => String(gid || '').split('/').pop();

async function loadComboWeightContext(admin) {
  const data = await gql(admin, `#graphql
    query CodComboWeight {
      shop { metafield(namespace: "$app", key: "${COMBO_WEIGHT_CONFIG_KEY}") { jsonValue } }
      discountNodes(first: 100, query: "type:app") {
        nodes { discount { __typename ... on DiscountAutomaticApp { title status } } }
      }
    }`);
  const active = (data?.discountNodes?.nodes || []).some((n) => n.discount?.__typename === 'DiscountAutomaticApp'
    && n.discount.title === COMBO_WEIGHT_DISCOUNT_TITLE && n.discount.status === 'ACTIVE');
  const config = data?.shop?.metafield?.jsonValue;
  return { active, templates: config && typeof config === 'object' && config.templates && typeof config.templates === 'object' ? config.templates : null };
}

// Price, weight and collections of the box's variants, straight from Shopify.
async function loadComboVariants(admin, variantIds) {
  const ids = [...new Set(variantIds.map(String))];
  const result = new Map();
  // 10 per query keeps collections(first: 50) well under the query cost limit.
  for (let start = 0; start < ids.length; start += 10) {
    const data = await gql(admin, `#graphql
      query CodComboVariants($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id price
            inventoryItem { measurement { weight { value unit } } }
            product { id collections(first: 50) { nodes { id } } }
          }
        }
      }`, { ids: ids.slice(start, start + 10).map(toVariantGid) });
    for (const node of data?.nodes || []) {
      if (!node?.id) continue;
      const weight = node.inventoryItem?.measurement?.weight;
      result.set(numericOf(node.id), {
        price: node.price,
        unitGrams: toGrams(weight?.value, weight?.unit),
        productId: numericOf(node.product?.id),
        collectionIds: (node.product?.collections?.nodes || []).map((c) => numericOf(c.id)),
      });
    }
  }
  return result;
}

function comboQualifies(template, variant) {
  if (!variant?.productId) return false;
  if ((template.product_ids || []).map(String).includes(variant.productId)) return true;
  const allowed = (template.collection_ids || []).map(String);
  return variant.collectionIds.some((id) => allowed.includes(id));
}

/**
 * Box discounts for the weight-combo lines of a COD order: the same price
 * Shopify checkout gives. `comboWeightLive` = the shop's plan publishes
 * combo_weight_pricing. Applies only while the checkout discount is ACTIVE.
 * Returns { byLine: Map<lineIndex, amountMinor>, titles: Map<lineIndex, title>, boxes: [...] }.
 */
export async function comboWeightAdjustments(admin, { lines, comboWeightLive = false, currencyCode = 'INR' }) {
  const result = { byLine: new Map(), titles: new Map(), boxes: [], decimals: decimalsFor(currencyCode) };
  const marked = lines.map((line, index) => ({ line, index }))
    .filter(({ line }) => line.properties?._brix_combo_id && line.properties?._brix_combo_group);
  if (!marked.length || !comboWeightLive) return result;
  const { active, templates } = await loadComboWeightContext(admin);
  if (!active || !templates) return result;

  const boxes = new Map();
  for (const entry of marked) {
    const comboId = String(entry.line.properties._brix_combo_id);
    if (!Object.prototype.hasOwnProperty.call(templates, comboId)) continue;
    const template = templates[comboId];
    if (!template || !Array.isArray(template.tiers) || !template.tiers.length) continue;
    const key = `${comboId}:${entry.line.properties._brix_combo_group}`;
    if (!boxes.has(key)) boxes.set(key, { comboId, template, entries: [] });
    boxes.get(key).entries.push(entry);
  }
  if (!boxes.size) return result;

  const variants = await loadComboVariants(admin, [...boxes.values()].flatMap((b) => b.entries.map((e) => e.line.variantId)));
  const { decimals } = result;
  for (const { comboId, template, entries } of boxes.values()) {
    const box = computeBox({
      pricing: template,
      decimals,
      rate: 1,
      lines: entries.map(({ line, index }) => {
        const variant = variants.get(String(line.variantId));
        return {
          key: index,
          unitGrams: variant?.unitGrams ?? null,
          quantity: line.quantity,
          subtotalMinor: variant ? toMinor(variant.price, decimals) * line.quantity : 0,
          qualifies: comboQualifies(template, variant),
        };
      }),
    });
    if (!box.tier || box.discountMinor <= 0) continue;
    const title = tierLabel(box.tier, template.unit);
    for (const { key, amountMinor } of box.allocations) {
      result.byLine.set(key, amountMinor);
      result.titles.set(key, title);
    }
    result.boxes.push({ templateId: comboId, title, grams: box.grams, weight: formatWeight(box.grams, template.unit), amountMinor: box.discountMinor });
  }
  return result;
}

// How Shopify reads a FIXED_AMOUNT line discount on a draft order (per unit or
// per line) has not been confirmed on a store yet, so the first combo quote
// checks what Shopify actually did and remembers the mode that matched.
let comboLineDiscountMode = 'unit';

function comboLineItems(lines, combo, mode) {
  const items = draftLineItems(lines);
  const factor = 10 ** combo.decimals;
  const out = [];
  items.forEach((item, index) => {
    const amountMinor = combo.byLine.get(index);
    if (!amountMinor) { out.push(item); return; }
    const title = combo.titles.get(index);
    const discount = (minor) => ({ valueType: 'FIXED_AMOUNT', value: minor / factor, title, description: 'BRIX combo box' });
    if (mode === 'line' || item.quantity === 1) {
      out.push({ ...item, appliedDiscount: discount(amountMinor) });
      return;
    }
    // Per unit: split the line when the box discount doesn't divide evenly,
    // so the units still add up to exactly the box discount.
    const base = Math.floor(amountMinor / item.quantity);
    const extra = amountMinor - base * item.quantity;
    if (extra > 0) out.push({ ...item, quantity: extra, appliedDiscount: discount(base + 1) });
    if (item.quantity - extra > 0) out.push({ ...item, quantity: item.quantity - extra, ...(base > 0 ? { appliedDiscount: discount(base) } : {}) });
  });
  return out;
}

const lineDiscountMinor = (calc, decimals) => (calc?.lineItems || [])
  .reduce((sum, li) => sum + toMinor(amountOf(li.originalTotalSet), decimals) - toMinor(amountOf(li.discountedTotalSet), decimals), 0);

/**
 * Line items carrying the box discounts, after checking on a bare
 * draftOrderCalculate that Shopify discounts exactly what checkout would.
 * Refuses COD (never charges a different price) when neither mode matches.
 */
async function comboPricedLineItems(admin, lines, combo) {
  const expected = combo.boxes.reduce((sum, b) => sum + b.amountMinor, 0);
  const modes = comboLineDiscountMode === 'unit' ? ['unit', 'line'] : ['line', 'unit'];
  for (const mode of modes) {
    const lineItems = comboLineItems(lines, combo, mode);
    const probe = await calculate(admin, { lineItems, acceptAutomaticDiscounts: false });
    if (Math.abs(lineDiscountMinor(probe, combo.decimals) - expected) <= lineItems.length) {
      comboLineDiscountMode = mode;
      return lineItems;
    }
  }
  console.error('[cod] combo box discount did not price as expected; refusing COD for this box.');
  throw new CodError('combo_price_mismatch', "Cash on Delivery can't be used for this box right now. Please pay online.", { status: 422 });
}

const CALCULATE = `#graphql
  mutation CodCalculate($input: DraftOrderInput!) {
    draftOrderCalculate(input: $input) {
      calculatedDraftOrder {
        currencyCode
        taxesIncluded
        discountCodes
        lineItems {
          name title variantTitle quantity sku
          variant { id }
          product { id }
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
    title: charges.codFee > 0 ? 'Cash on Delivery (incl. COD fee)' : 'Cash on Delivery',
    priceWithCurrency: { amount: charges.total.toFixed(2), currencyCode },
  };
}

/**
 * Price the lines through Shopify and apply the merchant's COD rules.
 * Returns { quote, input } — `input` is the DraftOrderInput core reused by placeCodOrder.
 */
export async function quoteCod(admin, { settings, lines, coupon, pincode, surface, currencyCode = 'INR', comboWeightLive = false }) {
  if (lines.some((l) => isCheckoutOnlyLine(l.properties))) {
    throw new CodError('checkout_only', 'This cart has a Pack or free gift that is only available with online payment.', { status: 422 });
  }
  const { tags } = await loadVariants(admin, lines);
  const format = moneyFormatter(currencyCode);
  const combo = await comboWeightAdjustments(admin, { lines, comboWeightLive, currencyCode });
  const hasBoxes = combo.boxes.length > 0;

  const code = settings.allowCoupons && typeof coupon === 'string' && /^[\w-]{1,60}$/.test(coupon.trim()) ? coupon.trim() : null;
  const base = {
    lineItems: hasBoxes ? await comboPricedLineItems(admin, lines, combo) : draftLineItems(lines),
    customAttributes: [{ ...COD_MARKER }],
    // In checkout the box discount doesn't combine with other automatic
    // product discounts (combinesWith.productDiscounts: false), so COD leaves
    // them off too; discount codes still go to Shopify.
    acceptAutomaticDiscounts: !hasBoxes,
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

  // With a box discount, Items is the price before it, the box discount gets
  // its own row, and Discounts is whatever else Shopify took off (worked out
  // from Shopify's own total, so the rows always add up to what is charged).
  const factor = 10 ** combo.decimals;
  const comboDiscount = combo.boxes.reduce((sum, b) => sum + b.amountMinor, 0) / factor;
  const itemsOriginal = (calc.lineItems || []).reduce((sum, li) => sum + amountOf(li.originalTotalSet), 0);
  const otherDiscounts = hasBoxes
    ? Math.max(0, Math.round((itemsOriginal - comboDiscount + charges.total + (calc.taxesIncluded ? 0 : amountOf(calc.totalTaxSet)) - amountOf(calc.totalPriceSet)) * factor) / factor)
    : amountOf(calc.totalDiscountsSet);

  const couponApplied = Boolean(code)
    && (calc.discountCodes || []).some((c) => c.toLowerCase() === code.toLowerCase())
    && otherDiscounts > 0;

  const quote = {
    currency: calc.currencyCode || currencyCode,
    lines: (calc.lineItems || []).map((li) => ({
      title: li.name || li.title,
      variantTitle: li.variantTitle && li.variantTitle !== 'Default Title' ? li.variantTitle : '',
      quantity: li.quantity,
      image: li.image?.url || null,
      originalTotal: amountOf(li.originalTotalSet),
      total: amountOf(li.discountedTotalSet),
      // For GA4 items / Meta content_ids (catalogItemId in cod-tracking.server.js).
      unitPrice: li.quantity ? Math.round((amountOf(li.discountedTotalSet) / li.quantity) * 100) / 100 : 0,
      variantId: li.variant?.id ? String(li.variant.id).split('/').pop() : null,
      productId: li.product?.id ? String(li.product.id).split('/').pop() : null,
      sku: li.sku || null,
    })),
    itemsTotal: hasBoxes ? Math.round(itemsOriginal * factor) / factor : amountOf(calc.lineItemsSubtotalPrice),
    subtotal: amountOf(calc.subtotalPriceSet),
    discounts: otherDiscounts,
    comboDiscount,
    comboDiscounts: combo.boxes.map((b) => ({ templateId: b.templateId, title: b.title, weight: b.weight, amount: b.amountMinor / factor })),
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
 * Server-side GA4 / Meta Purchase for a placed order, then records what
 * happened on the cod_orders row. Called without await: it never throws and
 * never delays or fails the shopper's order.
 */
async function trackPlacedOrder({ shop, settings, idemKey, order, quote, phone, address, track, clientIp, userAgent }) {
  const t = settings.tracking || {};
  if (!t.ga4Id && !t.metaPixelId) return;
  try {
    const secrets = await getCodSecrets(shop);
    const result = await sendCodPurchaseEvents({ settings, secrets, order, quote, phone, address, track, clientIp, userAgent });
    await php('cod_orders.php', { action: 'tracking', shop, idem_key: idemKey, ga4_status: result.ga4, meta_status: result.meta });
  } catch (error) {
    console.warn('[cod] server-side tracking failed for', order.orderName, String(error?.message || error).slice(0, 200));
  }
}

/**
 * Create the COD order. Idempotent per (shop, idemKey): a retried tap returns
 * the order already placed instead of creating a second one.
 *
 * `track` (sanitizeCodTrack), `clientIp` and `userAgent` are only used for the
 * server-side GA4 / Meta Purchase sent after the order exists.
 */
export async function placeCodOrder(admin, {
  shop, settings, lines, coupon, address, phone, phoneVerified, surface, attributes = {}, idemKey, currencyCode,
  track = null, clientIp: ip = null, userAgent = null, comboWeightLive = false,
}) {
  if (!/^[\w-]{8,64}$/.test(String(idemKey || ''))) throw new CodError('invalid_request', 'Refresh the page and try again.');
  const hash = phoneHash(shop, phone);

  const { order: existing } = await php('cod_orders.php', { action: 'find', shop, idem_key: idemKey });
  if (existing?.status === 'placed') {
    return { orderName: existing.order_name, orderId: existing.order_id, total: Number(existing.total), currency: existing.currency, statusPageUrl: null, repeated: true };
  }
  if (existing) throw new CodError('in_progress', 'Your order is already being placed. Please wait a moment.', { status: 409 });

  const { count: placedToday } = await php('cod_orders.php', { action: 'count_recent', shop, phone_hash: hash });
  if (placedToday >= settings.dailyLimitPerPhone) {
    throw new CodError('daily_limit', `This number has reached today's limit of ${settings.dailyLimitPerPhone} Cash on Delivery ${settings.dailyLimitPerPhone === 1 ? 'order' : 'orders'}. Please pay online to order again.`, { status: 429 });
  }

  const { quote, input } = await quoteCod(admin, { settings, lines, coupon, pincode: address.pincode, surface, currencyCode, comboWeightLive });

  try {
    await php('cod_orders.php', {
      action: 'begin', shop, idem_key: idemKey, source: surface, phone_hash: hash, phone_masked: maskPhone(phone),
      phone_verified: phoneVerified, customer_name: address.name, pincode: address.pincode, total: quote.total, currency: quote.currency,
    });
  } catch (error) {
    if (error instanceof CodError && error.code === 'duplicate') throw new CodError('in_progress', 'Your order is already being placed. Please wait a moment.', { status: 409 });
    throw error;
  }

  const clearAttempt = () => php('cod_orders.php', { action: 'abandon', shop, idem_key: idemKey }).catch(() => {});

  const boxes = quote.comboDiscounts || [];
  const tags = [...new Set(['COD', 'BRIX-COD', `brix-src-${surface}`, ...(boxes.length ? ['brix-combo-weight'] : []), ...settings.orderTags])];
  const customAttributes = [
    { ...COD_MARKER },
    { key: 'payment_method', value: 'Cash on Delivery' },
    { key: 'brix_cod_source', value: surface },
    { key: 'brix_cod_phone_verified', value: phoneVerified ? 'yes' : 'no' },
    ...(boxes.length ? [{
      key: 'brix_combo_weight',
      value: boxes.map((b) => `combo ${b.templateId}: ${b.title}, ${b.weight}, -${b.amount.toFixed(2)}`).join('; ').slice(0, 250),
    }] : []),
    ...Object.entries(attributes || {})
      .filter(([k, v]) => /^[\w ]{1,40}$/.test(k) && !k.startsWith('_brix') && k !== 'brix_combo_weight' && v != null && String(v).length <= 200)
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
    // The Shopify order exists now — a failed bookkeeping write must not turn
    // it into an error for the shopper (who would then retry and order twice).
    await php('cod_orders.php', {
      action: 'complete', shop, idem_key: idemKey, draft_order_id: draftId, order_id: order.id, order_name: order.name, total, currency,
    }).catch((error) => console.error('[cod] order placed but tracking row update failed:', order.name, error?.message));

    const placed = { orderName: order.name, orderId: order.id, statusPageUrl: order.statusPageUrl || null, total, currency };
    // Not awaited and never throws, so it can't delay the shopper or reach the catch below.
    if (track) trackPlacedOrder({ shop, settings, idemKey, order: placed, quote, phone, address, track, clientIp: ip, userAgent });
    return placed;
  } catch (error) {
    if (draftId) await deleteDraft(admin, draftId);
    await clearAttempt();
    throw error;
  }
}

/* ───────────────────────── Shopify order webhooks ───────────────────────── */

const isBrixCodOrder = (payload) => String(payload?.tags || '').split(',').some((t) => t.trim().toLowerCase() === 'brix-cod');

/** All successful refunds on an order so far (REST order payload). */
function refundedTotal(payload) {
  let sum = 0;
  for (const refund of payload?.refunds || []) {
    for (const tx of refund?.transactions || []) {
      if (tx?.kind === 'refund' && tx?.status === 'success') sum += Number(tx.amount) || 0;
    }
  }
  return Math.round(sum * 100) / 100;
}

/** Shipment status of the most recently updated fulfillment (delivered / failure / in_transit …). */
function latestShipmentStatus(payload) {
  const list = (payload?.fulfillments || []).filter((f) => f?.status !== 'cancelled');
  list.sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
  return list.length ? (list[list.length - 1].shipment_status || null) : null;
}

/**
 * Keeps a BRIX COD order's lifecycle (shipped / delivered / paid / RTO /
 * cancelled / refunded) in step with Shopify, from the orders/updated,
 * orders/paid and orders/cancelled webhooks. orders/updated fires on every
 * refund too and carries all refunds so far, so refunds/create isn't needed.
 * When an order becomes cancelled or refunded, GA4 gets a refund event (once,
 * on the transition). Never throws; non-BRIX orders are skipped without a call.
 */
export async function syncCodOrderFromWebhook(shop, payload) {
  if (!payload?.id || !isBrixCodOrder(payload)) return null;
  try {
    const result = await php('cod_orders.php', {
      action: 'sync',
      shop,
      order_id: String(payload.id),
      financial_status: payload.financial_status || null,
      fulfillment_status: payload.fulfillment_status || null,
      shipment_status: latestShipmentStatus(payload),
      cancelled_at: payload.cancelled_at || null,
      refunded_total: refundedTotal(payload),
    });
    const ended = ['cancelled', 'refunded'];
    if (result.matched && ended.includes(result.lifecycle) && !ended.includes(result.previous)) {
      const settings = await getCodSettings(shop);
      if (settings.tracking?.ga4Id) {
        const secrets = await getCodSecrets(shop);
        const value = result.lifecycle === 'refunded' && result.refunded_total > 0 ? result.refunded_total : result.total;
        await sendCodRefundEvent({ settings, secrets, orderName: result.order_name, value, currency: result.currency });
      }
    }
    return result;
  } catch (error) {
    console.warn('[cod] webhook sync failed for order', payload.id, String(error?.message || error).slice(0, 200));
    return null;
  }
}

/* ───────────────────────── admin: orders list ───────────────────────── */

export async function listCodOrders(admin, shop, limit = 50) {
  const { orders: rows = [] } = await php('cod_orders.php', { action: 'list', shop, limit });
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
      phoneVerified: r.phone_verified === true,
      customer: r.customer_name,
      pincode: r.pincode,
      total: Number(r.total || 0),
      currency: r.currency,
      createdAt: r.created_at || null,
      lifecycle: r.lifecycle || 'placed',
      tracking: { ga4: r.ga4_status || null, meta: r.meta_status || null },
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
    rtoCount: orders.filter((o) => o.lifecycle === 'rto').length,
  };
}
