// Saved shopper addresses, so the COD popup can fill in the address after the
// shopper verifies their phone with an OTP (savedAddressesForShopper, sent with
// the OTP verify answer by api.cod.otp.jsx; stores in OTP_WALLET_SHOPS only).
//
// Collected from every store's orders/create webhook (that includes BRIX COD
// orders, which are real Shopify orders). Indian mobile numbers only: COD and
// its OTP are India-only, so nothing else is kept.
//
// Nothing readable is stored:
//   - phone, email, Shopify customer id and order id → HMAC-SHA256 (lookup and
//     deletion only; they can't be turned back into the number or email)
//   - name, phone, email and the address → AES-256-GCM, bound (AAD) to the
//     row's shop, scope and phone hash, so a row copied elsewhere won't decrypt
// Both keys come from one Fly secret, CUSTOMER_DATA_KEY (32 random bytes,
// base64 or hex). Without it nothing is collected. Losing the key makes every
// saved address unreadable, so keep a copy of it outside Fly.
//
// scope 'store' = from that store's orders, shown on that store only.
// scope 'brix'  = (later) typed in the BRIX COD popup with the shopper's
//                 "save with BRIX" tick, shown on every BRIX store.
// At most MAX_PER_PHONE addresses per phone per store; each expires
// RETENTION_DAYS after it was last used. customers/redact and shop/redact
// delete them (deleteForCustomer / deleteForShop).
import crypto from 'node:crypto';

export const MAX_PER_PHONE = 3;
export const RETENTION_DAYS = 365;
const KEY_VERSION = 1;
const PURGE_EVERY_MS = 6 * 60 * 60 * 1000;

let keysCache = null;
let ensured = false;
let lastPurge = 0;
let warnedNoKey = false;

/** Test hook: forget cached keys / table check (the env may have changed). */
export function resetSavedAddressState() {
  keysCache = null;
  ensured = false;
  lastPurge = 0;
  warnedNoKey = false;
}

function decodeKey(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const buf = /^[0-9a-f]{64}$/i.test(text) ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64');
  return buf.length === 32 ? buf : null;
}

function keys() {
  if (keysCache) return keysCache;
  const master = decodeKey(process.env.CUSTOMER_DATA_KEY);
  if (!master) return null;
  const derive = (info) => Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), Buffer.from(info), 32));
  keysCache = { enc: derive('brix-saved-address-enc-v1'), hash: derive('brix-saved-address-hash-v1') };
  return keysCache;
}

export function savedAddressesEnabled() {
  return Boolean(keys());
}

function hmac(label, value) {
  return crypto.createHmac('sha256', keys().hash).update(`${label}:${value}`).digest('hex');
}

/** 10-digit Indian mobile, or null. Accepts +91 / 91 / 0 prefixes, spaces, dashes. */
export function normalizeIndianMobile(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/** The same for every store, so a 'brix' address can be found on any store. */
export function phoneLookupHash(phone10) {
  return hmac('phone', phone10);
}

const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * The address worth keeping from a Shopify order webhook payload, or null:
 * an Indian shipping address (billing when there's no shipping) with an
 * Indian mobile number and enough to deliver to.
 */
export function addressFromOrder(payload) {
  const order = payload || {};
  const addr = order.shipping_address || order.billing_address;
  if (!addr) return null;
  const country = clean(addr.country_code, 2).toUpperCase();
  if (country && country !== 'IN') return null;
  const phone = normalizeIndianMobile(addr.phone)
    || normalizeIndianMobile(order.phone)
    || normalizeIndianMobile(order.billing_address?.phone)
    || normalizeIndianMobile(order.customer?.phone);
  if (!phone) return null;
  const address = {
    firstName: clean(addr.first_name, 100),
    lastName: clean(addr.last_name, 100),
    address1: clean(addr.address1),
    address2: clean(addr.address2),
    city: clean(addr.city, 100),
    province: clean(addr.province, 100),
    provinceCode: clean(addr.province_code, 10),
    zip: clean(addr.zip, 12).replace(/\s/g, ''),
    countryCode: 'IN',
    phone,
    email: clean(order.email || order.contact_email || order.customer?.email, 254).toLowerCase(),
  };
  if (!address.address1 || !/^\d{6}$/.test(address.zip) || !(address.firstName || address.lastName)) return null;
  return address;
}

// Same place = same row, however it was typed (case, spaces, punctuation).
function addressKey(a) {
  const norm = (v) => String(v || '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
  return [a.address1, a.address2, a.city, a.zip].map(norm).join('|');
}

function aad(shop, scope, phoneHash) {
  return Buffer.from(`${shop}|${scope}|${phoneHash}`);
}

export function encryptAddress(address, { shop, scope, phoneHash }) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keys().enc, iv);
  cipher.setAAD(aad(shop, scope, phoneHash));
  const body = Buffer.concat([cipher.update(JSON.stringify(address), 'utf8'), cipher.final()]);
  return `v${KEY_VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
}

/** The address, or null when the row was tampered with or the key is wrong. */
export function decryptAddress(blob, { shop, scope, phoneHash }) {
  try {
    const match = /^v1:(.+)$/.exec(String(blob || ''));
    if (!match) return null;
    const raw = Buffer.from(match[1], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', keys().enc, raw.subarray(0, 12));
    decipher.setAAD(aad(shop, scope, phoneHash));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
  } catch {
    return null;
  }
}

export async function ensureSavedAddressTable(db) {
  if (ensured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS customer_addresses (
      id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop_domain   VARCHAR(255) NOT NULL,
      scope         VARCHAR(10)  NOT NULL DEFAULT 'store',
      phone_hash    CHAR(64)     NOT NULL,
      address_hash  CHAR(64)     NOT NULL,
      email_hash    CHAR(64)     NULL,
      customer_hash CHAR(64)     NULL,
      order_hash    CHAR(64)     NULL,
      payload_enc   TEXT         NOT NULL,
      source        VARCHAR(20)  NOT NULL DEFAULT 'order',
      orders_count  INT UNSIGNED NOT NULL DEFAULT 1,
      first_seen    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at    DATETIME     NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_address (shop_domain, scope, phone_hash, address_hash),
      INDEX idx_phone (phone_hash, scope),
      INDEX idx_shop_email (shop_domain, email_hash),
      INDEX idx_shop_customer (shop_domain, customer_hash),
      INDEX idx_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  ensured = true;
}

const sqlDate = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

/**
 * orders/create: keep (or refresh) the order's address for this store.
 * Returns 'saved' | 'skipped' | 'disabled'. Never throws on bad input; DB
 * errors are the caller's to log.
 */
export async function saveAddressFromOrder(db, shop, payload, { now = new Date() } = {}) {
  if (!keys()) {
    if (!warnedNoKey) console.warn('[saved-addresses] CUSTOMER_DATA_KEY is not set; addresses are not collected');
    warnedNoKey = true;
    return 'disabled';
  }
  const address = addressFromOrder(payload);
  if (!address || !shop) return 'skipped';
  await ensureSavedAddressTable(db);

  const scope = 'store';
  const phoneHash = phoneLookupHash(address.phone);
  const addressHash = hmac('address', `${shop}|${address.phone}|${addressKey(address)}`);
  const emailHash = address.email ? hmac('email', address.email) : null;
  const customerId = payload?.customer?.id;
  const customerHash = customerId ? hmac('customer', `${shop}|${customerId}`) : null;
  const orderHash = payload?.id ? hmac('order', `${shop}|${payload.id}`) : null;
  const seen = sqlDate(now);
  const expires = sqlDate(new Date(now.getTime() + RETENTION_DAYS * 86400000));

  // orders_count goes up once per order (a retried webhook doesn't count twice);
  // MySQL applies the SET list left to right, so it compares the old order_hash.
  const [result] = await db.execute(
    `INSERT INTO customer_addresses
       (shop_domain, scope, phone_hash, address_hash, email_hash, customer_hash, order_hash,
        payload_enc, source, orders_count, first_seen, last_seen, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'order', 1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       orders_count  = orders_count + IF(order_hash <=> VALUES(order_hash), 0, 1),
       order_hash    = VALUES(order_hash),
       email_hash    = COALESCE(VALUES(email_hash), email_hash),
       customer_hash = COALESCE(VALUES(customer_hash), customer_hash),
       payload_enc   = VALUES(payload_enc),
       last_seen     = GREATEST(last_seen, VALUES(last_seen)),
       expires_at    = GREATEST(expires_at, VALUES(expires_at))`,
    [shop, scope, phoneHash, addressHash, emailHash, customerHash, orderHash,
      encryptAddress(address, { shop, scope, phoneHash }), seen, seen, expires]
  );

  // A new row (affectedRows 1): keep only the newest few for this phone here.
  if (result?.affectedRows === 1) await trimPhone(db, shop, scope, phoneHash);
  await purgeExpired(db, now);
  return 'saved';
}

async function trimPhone(db, shop, scope, phoneHash) {
  const [rows] = await db.execute(
    `SELECT id FROM customer_addresses WHERE shop_domain = ? AND scope = ? AND phone_hash = ?
     ORDER BY last_seen DESC, id DESC`,
    [shop, scope, phoneHash]
  );
  const extra = (rows || []).slice(MAX_PER_PHONE).map((r) => r.id);
  if (extra.length) {
    await db.execute(`DELETE FROM customer_addresses WHERE id IN (${extra.map(() => '?').join(', ')})`, extra);
  }
}

async function purgeExpired(db, now) {
  if (now.getTime() - lastPurge < PURGE_EVERY_MS) return;
  lastPurge = now.getTime();
  await db.execute(`DELETE FROM customer_addresses WHERE expires_at < ? LIMIT 1000`, [sqlDate(now)]);
}

/**
 * This store's saved addresses for a phone the shopper has just verified by
 * OTP (newest first). Only call after the OTP check.
 */
export async function findAddresses(db, shop, phone10) {
  const phone = normalizeIndianMobile(phone10);
  if (!keys() || !phone) return [];
  await ensureSavedAddressTable(db);
  const phoneHash = phoneLookupHash(phone);
  const [rows] = await db.execute(
    `SELECT id, scope, payload_enc FROM customer_addresses
     WHERE phone_hash = ? AND shop_domain = ? AND scope = 'store' AND expires_at > ?
     ORDER BY last_seen DESC, id DESC LIMIT ${MAX_PER_PHONE}`,
    [phoneHash, shop, sqlDate(new Date())]
  );
  return (rows || [])
    .map((r) => decryptAddress(r.payload_enc, { shop, scope: r.scope, phoneHash }))
    .filter(Boolean);
}

const AUTOFILL_TIMEOUT_MS = 2500;

/** A saved address in the COD popup's own shape (brix_cod.js `addr`). */
export function addressForPopup(a) {
  if (!a) return null;
  const out = {
    name: clean([a.firstName, a.lastName].filter(Boolean).join(' '), 120),
    address1: clean(a.address1),
    address2: clean(a.address2),
    city: clean(a.city, 100),
    state: clean(a.province, 100),
    pincode: clean(a.zip, 12).replace(/\s/g, ''),
    email: clean(a.email, 254),
  };
  return out.address1 && /^\d{6}$/.test(out.pincode) ? out : null;
}

/**
 * The COD popup's saved addresses for a phone that has JUST passed the OTP check
 * (newest first, this store's orders only). Never throws and never holds the OTP
 * step up: no key, a DB error or a slow DB = [] (the shopper types it as before).
 */
export async function savedAddressesForShopper(db, shop, phone10, { timeoutMs = AUTOFILL_TIMEOUT_MS } = {}) {
  if (!keys()) return [];
  let timer;
  try {
    const found = await Promise.race([
      findAddresses(db, shop, phone10),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
    if (found === null) console.warn('[saved-addresses] lookup took over', timeoutMs, 'ms; the shopper types the address');
    return (found || []).map(addressForPopup).filter(Boolean);
  } catch (error) {
    console.error('[saved-addresses] lookup failed:', String(error?.message || error).slice(0, 200));
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** customers/redact: everything this store holds for that customer. */
export async function deleteForCustomer(db, shop, { customerId, email, phone, orderIds = [] } = {}) {
  if (!keys() || !shop) return 0;
  await ensureSavedAddressTable(db);
  const where = [];
  const params = [];
  if (customerId) { where.push('customer_hash = ?'); params.push(hmac('customer', `${shop}|${customerId}`)); }
  const mail = clean(email, 254).toLowerCase();
  if (mail) { where.push('email_hash = ?'); params.push(hmac('email', mail)); }
  const mobile = normalizeIndianMobile(phone);
  if (mobile) { where.push('phone_hash = ?'); params.push(phoneLookupHash(mobile)); }
  const orders = (orderIds || []).filter(Boolean).slice(0, 500);
  if (orders.length) {
    where.push(`order_hash IN (${orders.map(() => '?').join(', ')})`);
    params.push(...orders.map((id) => hmac('order', `${shop}|${id}`)));
  }
  if (!where.length) return 0;
  const [result] = await db.execute(
    `DELETE FROM customer_addresses WHERE shop_domain = ? AND scope = 'store' AND (${where.join(' OR ')})`,
    [shop, ...params]
  );
  return result?.affectedRows || 0;
}

/** shop/redact (48 h after uninstall): every address collected from this store's orders. */
export async function deleteForShop(db, shop) {
  if (!shop) return 0;
  await ensureSavedAddressTable(db);
  const [result] = await db.execute(
    `DELETE FROM customer_addresses WHERE shop_domain = ? AND scope = 'store'`,
    [shop]
  );
  return result?.affectedRows || 0;
}
