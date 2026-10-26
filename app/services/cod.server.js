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
  maskPhone, splitName, provinceCodeFor, moneyFormatter, codRuleCollections, codShownOnProduct, unlistedCodAllowed,
} from '../utils/cod.shared.js';
import { computeBox, decimalsFor, formatWeight, tierLabel, toGrams, toMinor } from '../utils/combo-weight.shared.js';
import { COMBO_WEIGHT_CONFIG_KEY, COMBO_WEIGHT_DISCOUNT_TITLE } from './combo-weight-shopify.server';
import {
  sanitizeShipping, quoteShipping, deliveryForShopper, deliverySummary, referencedCollections, dateLabel, slotLabel,
} from '../utils/shipping.shared.js';

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
// prepaid sync replaces it; `unlisted` (loadUnlistedBlocked) likewise.
function runtimeFacts(previous, secrets) {
  const facts = { otpAvailable: otpAvailable(secrets) };
  if (previous?.prepaid && typeof previous.prepaid === 'object') facts.prepaid = previous.prepaid;
  if (previous?.unlisted && typeof previous.unlisted === 'object') facts.unlisted = previous.unlisted;
  return facts;
}

/**
 * Merge `patch` onto the saved settings (omitted fields keep their saved value).
 * `syncPrepaid(next)`, when given, brings Shopify's prepaid discount in line
 * with the new settings before they are stored, and returns the runtime facts
 * the storefront may rely on ({ verified, percent, ... }); its result is kept
 * in `_runtime.prepaid`. `syncUnlisted(next)` returns the unlisted products
 * COD may not sell (loadUnlistedBlocked), kept in `_runtime.unlisted`.
 */
export async function saveCodSettings(shop, patch, { syncPrepaid, syncUnlisted } = {}) {
  const raw = await loadStoredSettings(shop);
  const current = sanitizeCodSettings(raw || {}, DEFAULT_COD_SETTINGS);
  const next = sanitizeCodSettings(patch, current);
  const runtime = runtimeFacts(raw?._runtime, await getCodSecrets(shop));
  if (typeof syncPrepaid === 'function') runtime.prepaid = await syncPrepaid(next);
  if (typeof syncUnlisted === 'function') {
    runtime.unlisted = await syncUnlisted(next);
    unlistedCheckedAt.set(shop, Date.now());
  }
  await php('cod_settings.php', { action: 'save', shop, settings: withRuntime(next, runtime) });
  return next;
}

// cod_settings.php refuses a blob over 60,000 bytes, as PHP encodes it ("/" as "\/").
const SETTINGS_MAX_BYTES = 59000;
const storedBytes = (value) => Buffer.byteLength(JSON.stringify(value).replace(/\//g, '\\/'));

// The settings with their runtime facts, as stored. A long unlisted list is
// cut rather than the save refused: products left out still can't be
// ordered with COD (productRuleError), their pages just keep the button.
function withRuntime(settings, runtime) {
  let blob = { ...settings, _runtime: runtime };
  const list = runtime.unlisted?.blocked;
  let keep = Array.isArray(list) ? list.length : 0;
  while (keep > 0 && storedBytes(blob) > SETTINGS_MAX_BYTES) {
    keep = Math.floor(keep * 0.75);
    blob = { ...settings, _runtime: { ...runtime, unlisted: { ...runtime.unlisted, blocked: list.slice(0, keep), cut: true } } };
  }
  return blob;
}

/**
 * Re-saves the stored settings when the runtime facts changed since the last
 * save (e.g. an SMS provider was configured), so the storefront's OTP step
 * matches what /api/cod/otp will actually accept. Called by the admin pages;
 * with `admin`, also refreshes the unlisted products list (at most every
 * UNLISTED_REFRESH_MS per shop and process).
 */
export async function syncCodRuntime(shop, { admin = null } = {}) {
  const raw = await loadStoredSettings(shop);
  if (!raw) return;
  const settings = sanitizeCodSettings(raw, DEFAULT_COD_SETTINGS);
  const facts = runtimeFacts(raw._runtime, await getCodSecrets(shop));
  if (admin && Date.now() - (unlistedCheckedAt.get(shop) || 0) > UNLISTED_REFRESH_MS) {
    unlistedCheckedAt.set(shop, Date.now());
    const fresh = await loadUnlistedBlocked(admin, settings);
    // A failed lookup keeps the list it had.
    if (!fresh.failed && JSON.stringify(fresh.blocked) !== JSON.stringify(facts.unlisted?.blocked || null)) facts.unlisted = fresh;
  }
  if (JSON.stringify(raw._runtime || null) === JSON.stringify(facts)) return;
  await php('cod_settings.php', { action: 'save', shop, settings: withRuntime(settings, facts) });
}

/* ───────────────────────── unlisted products ───────────────────────── */

// Shopify doesn't tell a product page that its product is unlisted, so the
// storefront gets the ids of the unlisted products COD may not sell
// (`_runtime.unlisted.blocked`, numeric) and hides the COD button on such a
// page while it is also marked noindex (Shopify marks unlisted pages so; a
// product listed again since keeps its button). Every order is still checked
// on Shopify's live status (productRuleError).
const UNLISTED_LIST_MAX = 1000;
const UNLISTED_REFRESH_MS = 10 * 60 * 1000;
const unlistedCheckedAt = new Map();

// Up to `cap` numeric product ids matching a products search, 250 a page.
async function productIdsFor(admin, search, cap) {
  const query = `#graphql
    query CodProductIds($q: String!, $after: String) {
      products(first: 250, after: $after, query: $q) { nodes { id } pageInfo { hasNextPage endCursor } }
    }`;
  const ids = [];
  let after = null;
  while (ids.length < cap) {
    const conn = (await gql(admin, query, { q: search, after }))?.products;
    for (const node of conn?.nodes || []) ids.push(String(node.id).split('/').pop());
    if (!conn?.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return ids.slice(0, cap);
}

/**
 * The store's unlisted products COD may not sell, for the storefront:
 * { blocked: [numeric ids], at }. Never throws: a failed lookup gives an
 * empty list (+ failed), so no button is hidden by mistake.
 */
export async function loadUnlistedBlocked(admin, settings) {
  const at = new Date().toISOString();
  const u = settings?.unlisted || {};
  if (u.allow && u.mode !== 'only') return { blocked: [], at };
  try {
    const all = await productIdsFor(admin, 'status:unlisted', UNLISTED_LIST_MAX);
    if (!all.length || !u.allow) return { blocked: all, at };
    const allowed = new Set((u.products || []).map((p) => String(p.id).split('/').pop()));
    for (const c of u.collections || []) {
      const ids = await productIdsFor(admin, `status:unlisted AND collection_id:${String(c.id).split('/').pop()}`, UNLISTED_LIST_MAX);
      ids.forEach((id) => allowed.add(id));
    }
    return { blocked: all.filter((id) => !allowed.has(id)), at };
  } catch (error) {
    console.warn('[cod] unlisted products could not be listed:', String(error?.message || error).slice(0, 200));
    return { blocked: [], at, failed: true };
  }
}

/* ───────────────────────── dynamic shipping config ───────────────────────── */

// Delivery options, zones, rules, extra charges and delivery dates
// (utils/shipping.shared.js), used while settings.shippingMode is 'advanced'.
// Stored by php_backend/cod_shipping.php, apart from the settings blob (PIN
// code lists are too big for it). Kept for a short while per process, since
// the popup asks for a new quote on every delivery option or coupon change.
const SHIPPING_CACHE_MS = 20_000;
const shippingCache = new Map();

/** The stored config (sanitised), or null when the store never saved one. */
export async function getCodShipping(shop) {
  const hit = shippingCache.get(shop);
  if (hit && Date.now() - hit.at < SHIPPING_CACHE_MS) return hit.config;
  const { shipping } = await php('cod_shipping.php', { action: 'get', shop });
  const config = shipping && typeof shipping === 'object' ? sanitizeShipping(shipping) : null;
  shippingCache.set(shop, { at: Date.now(), config });
  if (shippingCache.size > 2000) shippingCache.delete(shippingCache.keys().next().value);
  return config;
}

// cod_shipping.php stores at most 200 000 bytes (its requests are capped at 256 KB).
const SHIPPING_MAX_BYTES = 195_000;

export async function saveCodShipping(shop, raw) {
  const config = sanitizeShipping(raw);
  const bytes = Buffer.byteLength(JSON.stringify(config));
  if (bytes > SHIPPING_MAX_BYTES) {
    throw new CodError('shipping_too_large', `Your shipping settings are too big to save (${Math.ceil(bytes / 1000)} KB of ${SHIPPING_MAX_BYTES / 1000} KB). Use PIN code ranges or prefixes instead of long lists, or pick fewer products in rules.`);
  }
  await php('cod_shipping.php', { action: 'save', shop, shipping: config });
  shippingCache.set(shop, { at: Date.now(), config });
  return config;
}

/**
 * Shipping charged on placed COD orders of the last `days` days, or of the
 * dashboard's date filter ({ startMs, endMs }), by delivery option and by zone.
 */
export async function getCodShippingStats(shop, days = 30, { startMs = null, endMs = null } = {}) {
  const windowed = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
  const { rows = [] } = await php('cod_orders.php', {
    action: 'shipping_stats', shop, days,
    ...(windowed ? { from_ts: Math.floor(startMs / 1000), to_ts: Math.floor(endMs / 1000) } : {}),
  });
  const totals = { orders: 0, shipping: 0, total: 0, free: 0 };
  const group = (key) => {
    const map = new Map();
    for (const r of rows) {
      const name = r[key] || '';
      const g = map.get(name) || { name, orders: 0, shipping: 0, free: 0 };
      g.orders += r.orders; g.shipping += r.shipping; g.free += r.free;
      map.set(name, g);
    }
    return [...map.values()].map((g) => ({ ...g, shipping: Math.round(g.shipping * 100) / 100 })).sort((a, b) => b.orders - a.orders);
  };
  for (const r of rows) { totals.orders += r.orders; totals.shipping += r.shipping; totals.total += r.total; totals.free += r.free; }
  totals.shipping = Math.round(totals.shipping * 100) / 100;
  return { days, ...totals, byOption: group('option'), byZone: group('zone') };
}

/* ───────────────────────── tracking secrets ───────────────────────── */

// GA4 Measurement Protocol secret, Meta Conversions API token, Meta test
// event code and the store's MSG91 keys (OTP SMS). Kept in their own table
// (php_backend/cod_settings.php secrets_*), never in the settings blob the
// storefront reads. Only this server reads the values; the admin page sees
// getCodSecretsStatus().
const SECRET_KEYS = ['ga4ApiSecret', 'metaCapiToken', 'metaTestCode', 'msg91AuthKey', 'msg91TemplateId'];
const SECRET_RE = /^[A-Za-z0-9_-]{1,512}$/;
const SECRET_LABELS = {
  ga4ApiSecret: 'The GA4 API secret', metaCapiToken: 'The Meta access token', metaTestCode: 'The Meta test code',
  msg91AuthKey: 'The MSG91 auth key', msg91TemplateId: 'The MSG91 template ID',
};

export async function getCodSecrets(shop) {
  const { secrets } = await php('cod_settings.php', { action: 'secrets_get', shop });
  return Object.fromEntries(SECRET_KEYS.map((key) => [key, secrets?.[key] || '']));
}

/** The store's MSG91 keys as cod-sms.server.js takes them. */
export function msg91Creds(secrets) {
  return { authKey: secrets?.msg91AuthKey || '', templateId: secrets?.msg91TemplateId || '' };
}

export async function getCodSecretsStatus(shop) {
  const s = await getCodSecrets(shop);
  const status = (v) => ({ set: Boolean(v), last4: v ? v.slice(-4) : '' });
  return Object.fromEntries(SECRET_KEYS.map((key) => [key, status(s[key])]));
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
    if (!SECRET_RE.test(v)) throw new CodError(`invalid_${key}`, `${SECRET_LABELS[key]} does not look right. Paste it again without spaces.`);
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

/** `secrets` = getCodSecrets(shop): the store's own MSG91 keys, else the server's. */
export function otpAvailable(secrets) {
  return smsProviderStatus(msg91Creds(secrets)).configured;
}

export async function sendCodOtp(shop, phone) {
  const code = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  const { id, resendAfter } = await php('cod_otp.php', {
    action: 'create', shop, phone_hash: phoneHash(shop, phone), code_hash: codeHash(shop, phone, code),
  });
  const result = await sendOtpSms(phone, code, msg91Creds(await getCodSecrets(shop).catch(() => null)));
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

/**
 * Checks every line is still on sale. With `shipping` (advanced shipping on),
 * also reads what the shipping rules need per variant: its product, tags,
 * weight, whether it ships at all, and which of the rules' collections it's
 * in (inCollection, only those). `collections` (gids) = more collections to
 * check membership of (the merchant's product rules, codRuleCollections).
 * Returns { tags, info: Map(variantId → …) }.
 */
async function loadVariants(admin, lines, { shipping = null, collections = [] } = {}) {
  const ids = lines.map((l) => toVariantGid(l.variantId));
  const cols = [...new Set([...(shipping ? referencedCollections(shipping) : []), ...collections])];
  const query = (withWeight) => `#graphql
    query CodVariants($ids: [ID!]!${cols.map((_, i) => `, $c${i}: ID!`).join('')}) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id availableForSale${withWeight ? ' inventoryItem { requiresShipping measurement { weight { value unit } } }' : ''}
          product { id title tags status${cols.map((_, i) => ` c${i}: inCollection(id: $c${i})`).join('')} }
        }
      }
    }`;
  const variables = { ids, ...Object.fromEntries(cols.map((id, i) => [`c${i}`, id])) };
  let data;
  try {
    data = await gql(admin, query(Boolean(shipping)), variables);
  } catch (error) {
    // Weights come from the inventory item (read_products is enough per
    // Shopify's docs). If a store refuses it anyway, price without weights
    // rather than refuse COD.
    if (!shipping || !(error instanceof CodError)) throw error;
    console.warn('[cod] variant weights unavailable, shipping priced without them:', error.code);
    data = await gql(admin, query(false), variables);
  }
  const nodes = data?.nodes || [];
  const tags = [];
  const info = new Map();
  nodes.forEach((node, i) => {
    // UNLISTED (API 2025-10+) is on sale like ACTIVE, only reached by a direct
    // link; whether COD may sell it is the merchant's choice (productRuleError).
    if (!node?.id || !['ACTIVE', 'UNLISTED'].includes(node.product?.status)) {
      throw new CodError('item_unavailable', 'One of the items in your cart is no longer available. Refresh the page and try again.', { status: 409 });
    }
    if (!node.availableForSale) {
      throw new CodError('item_sold_out', `${node.product?.title || 'An item'} is sold out.`, { status: 409, details: { variantId: lines[i].variantId } });
    }
    tags.push(...(node.product?.tags || []));
    const weight = node.inventoryItem?.measurement?.weight;
    info.set(String(lines[i].variantId), {
      productId: node.product?.id || '',
      title: node.product?.title || '',
      unlisted: node.product?.status === 'UNLISTED',
      tags: node.product?.tags || [],
      unitGrams: weight ? toGrams(weight.value, weight.unit) : null,
      requiresShipping: node.inventoryItem?.requiresShipping !== false,
      collections: cols.filter((_, c) => node.product?.[`c${c}`] === true),
    });
  });
  return { tags, info };
}

/**
 * The merchant's product rules for COD, checked on Shopify's own data:
 * unlisted products only when settings.unlisted allows them, and a product
 * page order only for a product whose page shows COD (productButton.showOn).
 * Returns null, or { code, message } safe to show shoppers.
 */
function productRuleError(settings, info, surface) {
  for (const v of info.values()) {
    const product = { id: v.productId, collections: v.collections };
    if (v.unlisted && !unlistedCodAllowed(settings, product)) {
      return { code: 'product_excluded', message: `${v.title || 'One of these products'} isn't available with Cash on Delivery. Please pay online.` };
    }
    if (surface === 'product' && !codShownOnProduct(settings, product)) {
      return { code: 'product_excluded', message: "Cash on Delivery isn't available for this product. Please pay online." };
    }
  }
  return null;
}

// The order's lines as the shipping engine reads them: Shopify's prices
// (after line discounts) with each variant's product, tags, weight and collections.
function shippingLines(calc, info) {
  return (calc?.lineItems || []).map((li) => {
    const v = info.get(String(li.variant?.id || '').split('/').pop()) || {};
    return {
      productId: v.productId || li.product?.id || '',
      quantity: li.quantity,
      value: amountOf(li.discountedTotalSet),
      unitGrams: v.unitGrams,
      tags: v.tags || [],
      collections: v.collections || [],
      requiresShipping: v.requiresShipping !== false,
    };
  });
}

/** The shopper's pick of delivery option / date / slot from the popup (untrusted). */
export function cleanDeliveryChoice(value) {
  const v = value && typeof value === 'object' ? value : {};
  const pick = (x, re) => (typeof x === 'string' && re.test(x) ? x : null);
  return {
    option: pick(v.option, /^[a-z0-9_-]{1,40}$/i),
    date: pick(v.date, /^\d{4}-\d{2}-\d{2}$/),
    slot: pick(v.slot, /^\d{2}:\d{2}-\d{2}:\d{2}$/),
  };
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
// Membership is asked per collection the boxes count (inCollection), like the
// Function's inCollections, so a product in many collections is never missed.
async function loadComboVariants(admin, variantIds, collectionIds = []) {
  const ids = [...new Set(variantIds.map(String))];
  const collections = [...new Set(collectionIds.map(String))];
  const declarations = collections.map((_, i) => `, $c${i}: ID!`).join('');
  const memberships = collections.map((_, i) => `c${i}: inCollection(id: $c${i})`).join(' ');
  const collectionVars = Object.fromEntries(collections.map((id, i) => [`c${i}`, `gid://shopify/Collection/${id}`]));
  const result = new Map();
  for (let start = 0; start < ids.length; start += 10) {
    const data = await gql(admin, `#graphql
      query CodComboVariants($ids: [ID!]!${declarations}) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id price
            inventoryItem { measurement { weight { value unit } } }
            product { id ${memberships} }
          }
        }
      }`, { ids: ids.slice(start, start + 10).map(toVariantGid), ...collectionVars });
    for (const node of data?.nodes || []) {
      if (!node?.id) continue;
      const weight = node.inventoryItem?.measurement?.weight;
      result.set(numericOf(node.id), {
        price: node.price,
        unitGrams: toGrams(weight?.value, weight?.unit),
        productId: numericOf(node.product?.id),
        collectionIds: collections.filter((_, i) => node.product?.[`c${i}`] === true),
      });
    }
  }
  return result;
}

function comboQualifies(template, variant) {
  if (!variant?.productId) return false;
  // Same rule as the checkout Function: "not part of the box offer" never counts.
  if ((template.exclude_ids || []).map(String).includes(variant.productId)) return false;
  if ((template.product_ids || []).map(String).includes(variant.productId)) return true;
  const allowed = (template.collection_ids || []).map(String);
  return variant.collectionIds.some((id) => allowed.includes(id));
}

/**
 * Box discounts for the weight-combo lines of a COD order: the same price
 * Shopify checkout gives. `comboWeightLive` = the shop's plan publishes
 * some box pricing (BOX_PRICING_FEATURES; the trusted config only holds the
 * templates its plan allows). Applies only while the checkout discount is ACTIVE.
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

  const variants = await loadComboVariants(
    admin,
    [...boxes.values()].flatMap((b) => b.entries.map((e) => e.line.variantId)),
    [...boxes.values()].flatMap((b) => b.template.collection_ids || []),
  );
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
    const title = tierLabel(box.tier, template.unit, template.measure);
    for (const { key, amountMinor } of box.allocations) {
      result.byLine.set(key, amountMinor);
      result.titles.set(key, title);
    }
    result.boxes.push({
      templateId: comboId, title, grams: box.grams, weight: formatWeight(box.grams, template.unit), amountMinor: box.discountMinor,
      // The lines that count toward the box and their subtotal (combo-box-code.server.js).
      subtotalMinor: box.subtotalMinor, lineKeys: box.countedKeys,
    });
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

/**
 * Did Shopify put another discount on a box line? Checkout never does
 * (combinesWith.productDiscounts: false). Counted per variant, so it doesn't
 * depend on the order Shopify returns lines in; a variant that is also in the
 * cart outside the box counts as stacked, the safe side.
 */
function boxLinesStacked(calc, lines, combo) {
  const expected = new Map();
  lines.forEach((line, index) => {
    const amount = combo.byLine.get(index);
    if (amount) expected.set(String(line.variantId), (expected.get(String(line.variantId)) || 0) + amount);
  });
  const taken = new Map();
  const count = new Map();
  for (const li of calc?.lineItems || []) {
    const id = numericOf(li.variant?.id);
    if (!expected.has(id)) continue;
    taken.set(id, (taken.get(id) || 0) + toMinor(amountOf(li.originalTotalSet), combo.decimals) - toMinor(amountOf(li.discountedTotalSet), combo.decimals));
    count.set(id, (count.get(id) || 0) + 1);
  }
  return [...expected].some(([id, amount]) => (taken.get(id) || 0) > amount + (count.get(id) || 0));
}

// platformDiscounts = each Shopify discount on the draft (automatic, app /
// Function and code ones) with its title and amount, so the popup can name
// them. Validated against the 2026-01 schema; if the store's API version
// rejects it, calculate() falls back to CALCULATE_BASIC for good.
const CALCULATE_FIELDS = (withPlatform) => `#graphql
  mutation CodCalculate($input: DraftOrderInput!) {
    draftOrderCalculate(input: $input) {
      calculatedDraftOrder {
        currencyCode
        taxesIncluded
        discountCodes
        ${withPlatform ? 'platformDiscounts { title code automaticDiscount totalAmountPriceSet { shopMoney { amount } } }' : ''}
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
const CALCULATE = CALCULATE_FIELDS(true);
const CALCULATE_BASIC = CALCULATE_FIELDS(false);
let platformDiscountsSupported = true;

async function calculate(admin, input) {
  let data;
  try {
    data = await gql(admin, platformDiscountsSupported ? CALCULATE : CALCULATE_BASIC, { input });
  } catch (error) {
    if (!platformDiscountsSupported || !(error instanceof CodError) || error.code !== 'shopify_error') throw error;
    console.warn('[cod] draftOrderCalculate without platformDiscounts from now on');
    platformDiscountsSupported = false;
    data = await gql(admin, CALCULATE_BASIC, { input });
  }
  const result = data?.draftOrderCalculate;
  if (result?.userErrors?.length) {
    console.warn('[cod] draftOrderCalculate userErrors:', JSON.stringify(result.userErrors).slice(0, 300));
    throw new CodError('calculate_failed', "We couldn't price this order. Please try again, or pay online.", { status: 422 });
  }
  return result?.calculatedDraftOrder;
}

// `option` = the delivery option's name under advanced shipping (its title on the order).
function shippingLine(settings, charges, currencyCode, option = null) {
  const cod = charges.codFee > 0 ? 'Cash on Delivery (incl. COD fee)' : 'Cash on Delivery';
  return {
    title: option ? `${option} · ${cod}` : cod,
    priceWithCurrency: { amount: charges.total.toFixed(2), currencyCode },
  };
}

// Codes from the shopper's cart (cart.js discount_codes / the BRIX drawer).
const MAX_DISCOUNT_CODES = 5;
function cleanCartCodes(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const c = typeof raw === 'string' ? raw.trim() : '';
    if (/^[^\s<>"'`\\]{1,60}$/.test(c) && !out.some((x) => x.toLowerCase() === c.toLowerCase())) out.push(c);
    if (out.length >= MAX_DISCOUNT_CODES) break;
  }
  return out;
}

// The cart's attributes (cart.js attributes), as order attributes. BRIX's own
// keys and anything odd are dropped.
function cleanAttributes(attributes) {
  return Object.entries(attributes && typeof attributes === 'object' ? attributes : {})
    .filter(([k, v]) => /^[\w .:-]{1,60}$/.test(k) && !/^_?brix/i.test(k) && k !== 'payment_method' && v != null && typeof v !== 'object' && String(v).length <= 250)
    .slice(0, 20)
    .map(([key, value]) => ({ key, value: String(value) }));
}

// What a code takes off on this draft: Shopify's own figure when it names
// the discounts, else the difference against the same draft without it.
async function codeAmount(admin, { code, base, calc }) {
  if (Array.isArray(calc.platformDiscounts)) {
    return calc.platformDiscounts
      .filter((d) => d.code && d.code.toLowerCase() === code.toLowerCase())
      .reduce((sum, d) => sum + amountOf(d.totalAmountPriceSet), 0);
  }
  const without = { ...base, discountCodes: (base.discountCodes || []).filter((c) => c.toLowerCase() !== code.toLowerCase()) };
  if (!without.discountCodes.length) delete without.discountCodes;
  const plain = await calculate(admin, without);
  return Math.max(0, amountOf(calc.totalDiscountsSet) - amountOf(plain.totalDiscountsSet));
}

// Does the code have a usage limit or once-per-customer rule? A capped code
// goes on the order as a fixed discount, which Shopify doesn't count as a use,
// so such codes are refused over the cap instead (never reusable through COD).
// Unknown (lookup failed) counts as limited.
async function codeIsLimited(admin, code) {
  try {
    const data = await gql(admin, `#graphql
      query CodCouponLimits($code: String!) {
        codeDiscountNodeByCode(code: $code) {
          codeDiscount {
            ... on DiscountCodeBasic { usageLimit appliesOncePerCustomer }
            ... on DiscountCodeBxgy { usageLimit appliesOncePerCustomer }
            ... on DiscountCodeFreeShipping { usageLimit appliesOncePerCustomer }
            ... on DiscountCodeApp { usageLimit appliesOncePerCustomer }
          }
        }
      }`, { code });
    const d = data?.codeDiscountNodeByCode?.codeDiscount;
    if (!d) return true;
    return d.usageLimit != null || d.appliesOncePerCustomer === true;
  } catch {
    return true;
  }
}

/**
 * settings.couponMaxDiscount: a typed code that would take off more than the
 * cap. Without usage limits it becomes the order's fixed discount of exactly
 * the cap (titled with the code); with limits it's left off with a message.
 * Returns null (no cap, not applied, or within it), { applied, amount, base,
 * calc } or { refused, message, base, calc }.
 */
async function capCoupon(admin, { settings, code, base, calc, format }) {
  const cap = Number(settings.couponMaxDiscount) || 0;
  if (cap <= 0 || !(base.discountCodes || []).some((c) => c.toLowerCase() === code.toLowerCase())) return null;
  const amount = await codeAmount(admin, { code, base, calc });
  if (!(amount > cap + 0.004)) return null;
  const rest = (base.discountCodes || []).filter((c) => c.toLowerCase() !== code.toLowerCase());
  const next = { ...base };
  if (rest.length) next.discountCodes = rest; else delete next.discountCodes;
  if (await codeIsLimited(admin, code)) {
    return {
      refused: true,
      message: `${code} takes off more than ${format(cap)}, the most a Cash on Delivery order can save with a code. Pay online to use it, or try another code.`,
      base: next,
      calc: await calculate(admin, next),
    };
  }
  next.appliedDiscount = { title: code.slice(0, 40), description: `${code}, up to ${format(cap)} on COD`, value: Math.round(cap * 100) / 100, valueType: 'FIXED_AMOUNT' };
  next.customAttributes = [...(next.customAttributes || []), { key: 'brix_coupon_capped', value: code }];
  return { applied: true, amount: Math.round(cap * 100) / 100, base: next, calc: await calculate(admin, next) };
}

/**
 * Price the lines through Shopify and apply the merchant's COD rules.
 * Returns { quote, input, shipping } — `input` is the DraftOrderInput core
 * reused by placeCodOrder; `shipping` is the full quoteShipping result
 * (advanced shipping only, else null).
 *
 * Advanced shipping (settings.shippingMode 'advanced' + `shipping` config):
 * `destination` ({ pincode, city, state }, null before the address) and
 * `delivery` (the shopper's { option, date, slot }) choose the delivery
 * option; `strictDelivery` (placing the order) refuses a pick that is no
 * longer offered instead of quietly switching it.
 */
export async function quoteCod(admin, {
  settings, lines, coupon, pincode, surface, currencyCode = 'INR', comboWeightLive = false, cartCodes = [], cartAttributes = {},
  shipping = null, destination = null, delivery = null, strictDelivery = false, now = new Date(),
}) {
  if (lines.some((l) => isCheckoutOnlyLine(l.properties))) {
    throw new CodError('checkout_only', 'This cart has a Pack or free gift that is only available with online payment.', { status: 422 });
  }
  const advanced = settings.shippingMode === 'advanced' && shipping ? shipping : null;
  const where = destination || (pincode ? { pincode } : null);
  const { tags, info } = await loadVariants(admin, lines, { shipping: advanced, collections: codRuleCollections(settings, surface) });
  const productError = productRuleError(settings, info, surface);
  if (productError) throw new CodError(productError.code, productError.message, { status: 422 });
  const format = moneyFormatter(currencyCode);
  const combo = await comboWeightAdjustments(admin, { lines, comboWeightLive, currencyCode });
  const hasBoxes = combo.boxes.length > 0;

  const code = settings.allowCoupons && typeof coupon === 'string' && /^[\w-]{1,60}$/.test(coupon.trim()) ? coupon.trim() : null;
  // The cart's own discounts (settings.cartDiscounts, default on): Shopify's
  // automatic discounts, including app / Function ones, and the codes already
  // on the shopper's cart, as in Shopify checkout. Off: none of them.
  const withCartDiscounts = settings.cartDiscounts !== false;
  const carried = withCartDiscounts ? cleanCartCodes(cartCodes).filter((c) => !code || c.toLowerCase() !== code.toLowerCase()) : [];
  const codes = [...(code ? [code] : []), ...carried].slice(0, MAX_DISCOUNT_CODES);
  let base = {
    lineItems: hasBoxes ? await comboPricedLineItems(admin, lines, combo) : draftLineItems(lines),
    // The cart's attributes go along (as they do into checkout): some
    // discount Functions decide by them.
    customAttributes: [{ ...COD_MARKER }, ...cleanAttributes(cartAttributes)],
    // Automatic order / shipping discounts and product discounts on the other
    // items apply as in checkout. Checkout never adds another product discount
    // to a box line (combinesWith.productDiscounts: false), so if Shopify does
    // that here, COD leaves automatic discounts off for this order instead.
    acceptAutomaticDiscounts: withCartDiscounts,
    ...(codes.length ? { discountCodes: codes } : {}),
    ...(where?.pincode ? { shippingAddress: { countryCode: 'IN', zip: String(where.pincode) } } : {}),
  };

  let calc = await calculate(admin, base);
  if (hasBoxes && boxLinesStacked(calc, lines, combo)) {
    base = { ...base, acceptAutomaticDiscounts: false };
    calc = await calculate(admin, base);
  }
  // The most a typed code may take off (settings.couponMaxDiscount).
  const capped = code ? await capCoupon(admin, { settings, code, base, calc, format }) : null;
  if (capped) ({ base, calc } = capped);
  const subtotal = amountOf(calc.subtotalPriceSet);
  const ruleError = checkCodRules({ settings, subtotal, pincode: where?.pincode, productTags: tags, surface, format });
  if (ruleError) throw new CodError(ruleError.code, ruleError.message, { status: 422 });

  // Advanced shipping: the delivery option's price for this address and cart.
  let ship = null;
  if (advanced) {
    ship = quoteShipping(advanced, { destination: where, subtotal, lines: shippingLines(calc, info), now, choice: delivery || {}, fmt: format });
    if (ship.blocked) throw new CodError('not_deliverable', ship.blocked.message, { status: 422 });
    if (where && !ship.noShipping && !ship.options.length) {
      throw new CodError('no_delivery_option', 'No delivery option is available for this address and cart right now. Please try another address, or pay online.', { status: 422 });
    }
    if (strictDelivery && ship.choiceError) {
      throw new CodError('delivery_changed', ship.choiceError === 'option'
        ? 'That delivery option is no longer available. Please check your order again.'
        : 'That delivery day or time is no longer available. Please pick another.', { status: 409 });
    }
  }
  const charges = codCharges(settings, subtotal, ship ? (ship.selected?.price ?? 0) : null);
  const input = { ...base };
  input.shippingLine = shippingLine(settings, charges, calc.currencyCode || currencyCode, ship?.selected?.name || null);
  if (charges.total > 0) calc = await calculate(admin, input);

  // With a box discount, Items is the price before it, the box discount gets
  // its own row, and Discounts is whatever else Shopify took off (worked out
  // from Shopify's own total, so the rows always add up to what is charged).
  const factor = 10 ** combo.decimals;
  const comboDiscount = combo.boxes.reduce((sum, b) => sum + b.amountMinor, 0) / factor;
  const itemsOriginal = (calc.lineItems || []).reduce((sum, li) => sum + amountOf(li.originalTotalSet), 0);
  const otherDiscounts = hasBoxes
    ? Math.max(0, Math.round((itemsOriginal - comboDiscount + charges.total + (calc.taxesIncluded ? 0 : amountOf(calc.totalTaxSet)) - amountOf(calc.totalPriceSet)) * factor) / factor)
    : amountOf(calc.totalDiscountsSet);

  // Which codes Shopify really used: by platformDiscounts when the API gives
  // them, else by discountCodes plus a non-zero discount.
  const platform = Array.isArray(calc.platformDiscounts) ? calc.platformDiscounts : null;
  const usedCode = (c) => (platform
    ? platform.some((d) => d.code && d.code.toLowerCase() === c.toLowerCase() && amountOf(d.totalAmountPriceSet) > 0)
    : (calc.discountCodes || []).some((x) => x.toLowerCase() === c.toLowerCase()) && otherDiscounts > 0);
  const couponApplied = capped?.applied ? true : capped?.refused ? false : Boolean(code) && usedCode(code);
  const cartCodesApplied = carried.map((c) => ({ code: c, applied: usedCode(c) }));

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
    // Advanced shipping: the delivery options for this address and cart, and
    // which one is picked (null under simple shipping).
    delivery: ship ? deliveryForShopper(ship) : null,
    codFee: charges.codFee,
    tax: amountOf(calc.totalTaxSet),
    taxesIncluded: Boolean(calc.taxesIncluded),
    total: amountOf(calc.totalPriceSet),
    coupon: code ? {
      code,
      applied: couponApplied,
      ...(capped?.applied ? { capped: true, amount: capped.amount } : {}),
      ...(capped?.refused ? { message: capped.message } : {}),
    } : null,
    // The cart's codes carried over (only when the merchant has cart discounts on).
    cartCodes: cartCodesApplied,
    // Each discount Shopify gave, by name (null when the API can't say).
    discountList: platform
      ? platform.map((d) => ({ title: d.title || d.code || 'Discount', code: d.code || null, automatic: Boolean(d.automaticDiscount), amount: amountOf(d.totalAmountPriceSet) }))
        .filter((d) => d.amount > 0)
      : null,
  };
  // Only codes Shopify used go on the order (a capped code is the order's
  // fixed discount instead, see capCoupon).
  const kept = [...(couponApplied && !capped?.applied ? [code] : []), ...cartCodesApplied.filter((c) => c.applied).map((c) => c.code)];
  if (kept.length) input.discountCodes = kept;
  else delete input.discountCodes;
  return { quote, input, shipping: ship };
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
  track = null, clientIp: ip = null, userAgent = null, comboWeightLive = false, cartCodes = [], cartAttributes = {},
  shipping = null, delivery = null,
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

  const { quote, input, shipping: ship } = await quoteCod(admin, {
    settings, lines, coupon, pincode: address.pincode, surface, currencyCode, comboWeightLive, cartCodes, cartAttributes,
    shipping, destination: { pincode: address.pincode, city: address.city, state: address.state }, delivery, strictDelivery: true,
  });
  const option = ship?.selected || null;

  try {
    await php('cod_orders.php', {
      action: 'begin', shop, idem_key: idemKey, source: surface, phone_hash: hash, phone_masked: maskPhone(phone),
      phone_verified: phoneVerified, customer_name: address.name, pincode: address.pincode, total: quote.total, currency: quote.currency,
      shipping_amount: quote.shipping, shipping_option: option?.name || null, shipping_zone: ship?.zone?.name || null, delivery_date: ship?.date || null,
    });
  } catch (error) {
    if (error instanceof CodError && error.code === 'duplicate') throw new CodError('in_progress', 'Your order is already being placed. Please wait a moment.', { status: 409 });
    throw error;
  }

  const clearAttempt = () => php('cod_orders.php', { action: 'abandon', shop, idem_key: idemKey }).catch(() => {});

  const boxes = quote.comboDiscounts || [];
  const tags = [...new Set([
    'COD', 'BRIX-COD', `brix-src-${surface}`, ...(boxes.length ? ['brix-combo-weight'] : []),
    ...(option ? [`brix-ship-${option.kind.replace(/_/g, '-')}`] : []), ...settings.orderTags,
  ])];
  // Advanced shipping: what was booked, for the merchant and their courier.
  const deliveryAttributes = option ? [
    { key: 'brix_delivery_option', value: option.name },
    ...(ship.zone ? [{ key: 'brix_delivery_zone', value: ship.zone.name }] : []),
    ...(ship.date ? [{ key: 'brix_delivery_date', value: `${ship.date} (${dateLabel(ship.date)})` }] : []),
    ...(ship.slot ? [{ key: 'brix_delivery_slot', value: slotLabel(ship.slot) }] : []),
    ...(!ship.date && option.eta ? [{ key: 'brix_delivery_eta', value: option.eta.from === option.eta.to ? option.eta.from : `${option.eta.from} to ${option.eta.to}` }] : []),
  ] : [];
  const reserved = new Set(['brix_combo_weight', ...deliveryAttributes.map((a) => a.key)]);
  const customAttributes = [
    { ...COD_MARKER },
    { key: 'payment_method', value: 'Cash on Delivery' },
    { key: 'brix_cod_source', value: surface },
    { key: 'brix_cod_phone_verified', value: phoneVerified ? 'yes' : 'no' },
    ...(boxes.length ? [{
      key: 'brix_combo_weight',
      value: boxes.map((b) => `combo ${b.templateId}: ${b.title}, ${b.weight}, -${b.amount.toFixed(2)}`).join('; ').slice(0, 250),
    }] : []),
    ...deliveryAttributes,
    ...Object.entries(attributes || {})
      .filter(([k, v]) => /^[\w ]{1,40}$/.test(k) && !k.startsWith('_brix') && !reserved.has(k) && v != null && String(v).length <= 200)
      .slice(0, 10)
      .map(([key, value]) => ({ key, value: String(value) })),
  ];
  // The cart's attributes priced with (quoteCod), unless set above.
  for (const a of input.customAttributes || []) {
    if (!customAttributes.some((c) => c.key === a.key)) customAttributes.push(a);
  }
  const where = { drawer: 'cart drawer', product: 'product page', combo: 'combo page' }[surface] || surface;
  const orderInput = (withProvince) => ({
    ...input,
    shippingAddress: addressInput(address, phone, withProvince),
    billingAddress: addressInput(address, phone, withProvince),
    phone: `+91${phone}`,
    ...(address.email ? { email: address.email } : {}),
    tags,
    note: `Cash on Delivery order placed through BRIX (${where}). Collect ${moneyFormatter(quote.currency)(quote.total)} on delivery.${phoneVerified ? ' Phone verified by OTP.' : ''}${option ? ` Delivery: ${deliverySummary(ship)}.` : ''}`,
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
  return (await loadCodOrders(admin, shop, { limit })).orders;
}

// The most orders one dashboard view loads (each needs its live status from Shopify).
export const COD_ORDERS_VIEW_MAX = 500;

/**
 * Placed COD orders, newest first, with their live payment status from
 * Shopify. `startMs` / `endMs` = the dashboard's date filter (UTC instants,
 * end not included). → { orders, total }: total = how many the window holds
 * (more than `limit` = the list is cut to the newest).
 */
export async function loadCodOrders(admin, shop, { limit = 50, startMs = null, endMs = null } = {}) {
  const windowed = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
  const { orders: rows = [], total } = await php('cod_orders.php', {
    action: 'list', shop, limit: Math.min(limit, COD_ORDERS_VIEW_MAX),
    ...(windowed ? { from_ts: Math.floor(startMs / 1000), to_ts: Math.floor(endMs / 1000) } : {}),
  });
  const ids = rows.map((r) => r.order_id).filter(Boolean);
  const live = new Map();
  if (ids.length && admin) {
    try {
      // nodes() takes at most 250 ids.
      for (let i = 0; i < ids.length; i += 250) {
        const data = await gql(admin, `#graphql
          query CodOrders($ids: [ID!]!) {
            nodes(ids: $ids) { ... on Order { id displayFinancialStatus displayFulfillmentStatus cancelledAt } }
          }`, { ids: ids.slice(i, i + 250) });
        for (const node of data?.nodes || []) if (node?.id) live.set(node.id, node);
      }
    } catch (error) {
      console.warn('[cod] could not load live order status:', error?.message);
    }
  }
  return { orders: rows.map((r) => codOrderRow(r, live.get(r.order_id))), total: Number.isFinite(Number(total)) ? Number(total) : rows.length };
}

// One stored row as the dashboard shows it; `node` = Shopify's live order (payment status).
function codOrderRow(r, node) {
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
}

const shopTimezones = new Map();

/** The shop's time zone (Shopify `ianaTimezone`), cached an hour; COD is India-first, so Asia/Kolkata if Shopify can't be asked. */
export async function getShopTimezone(admin, shop) {
  const hit = shopTimezones.get(shop);
  if (hit && Date.now() - hit.at < 3600000) return hit.timeZone;
  let timeZone = 'Asia/Kolkata';
  try {
    const data = await gql(admin, '#graphql\n query CodShopTimezone { shop { ianaTimezone } }', {});
    if (data?.shop?.ianaTimezone) timeZone = data.shop.ianaTimezone;
    shopTimezones.set(shop, { at: Date.now(), timeZone });
  } catch (error) {
    console.warn('[cod] shop time zone unavailable:', error?.code || error?.message);
  }
  return timeZone;
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
