// Shopify's mandatory privacy webhooks (customers/data_request,
// customers/redact, shop/redact), received by webhooks.compliance.jsx.
// The work runs after the 200 (webhook-queue.server.js) and is retried here,
// since Shopify won't resend a webhook we already answered.
//   - PHP (php_backend/gdpr_lib.php, internal secret) anonymises / deletes the
//     MySQL rows: COD orders + OTPs, Partial COD, order analytics, and on
//     shop/redact every table with a shop column.
//   - Node deletes the saved addresses (it holds their key) and, on
//     shop/redact, the shop's sessions.
// Nothing about the customer (id, email, phone) is logged.
import { BASE_PHP_URL } from "../utils/api-helpers";
import { internalAuthHeaders } from "../utils/internal-auth";
import { getDb } from "./db.server";
import { deleteForCustomer, normalizeIndianMobile } from "./saved-addresses.server";
import { phoneHash } from "./cod.server";

const ATTEMPTS = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(label, fn, { attempts = ATTEMPTS, delayMs = 2000 } = {}) {
  let lastError;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.error(`[compliance] ${label} failed (try ${i}/${attempts}):`, error.message);
      if (i < attempts) await sleep(delayMs * i);
    }
  }
  throw lastError;
}

async function callPhp(file, body, fetchImpl = fetch) {
  const res = await fetchImpl(`${BASE_PHP_URL}/${file}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...internalAuthHeaders() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new Error(`${file} answered ${res.status}${json?.error ? `: ${json.error}` : ""}`);
  return json;
}

const orderIds = (list) => (Array.isArray(list) ? list : []).map((id) => String(id).split("/").pop()).filter((id) => /^\d{1,20}$/.test(id));

/** customers/redact */
export async function redactCustomer(shop, payload, deps = {}) {
  const { fetchImpl = fetch, db = getDb(), retry = {} } = deps;
  const phone = normalizeIndianMobile(payload?.customer?.phone);
  const orders = orderIds(payload?.orders_to_redact);
  const php = await withRetry(`customers/redact ${shop}`, () => callPhp("customers-redact.php", {
    shop_domain: shop,
    cod_phone_hash: phone ? phoneHash(shop, phone) : "",
    orders_to_redact: orders,
  }, fetchImpl), retry);
  const addresses = await withRetry(`customers/redact addresses ${shop}`, () => deleteForCustomer(db, shop, {
    customerId: payload?.customer?.id,
    email: payload?.customer?.email,
    phone: payload?.customer?.phone,
    orderIds: orders,
  }), retry);
  console.log(`[compliance] customers/redact ${shop}: ${orders.length} orders, rows ${JSON.stringify(php.changed || {})}, addresses ${addresses}`);
  return { changed: php.changed || {}, addresses };
}

/** shop/redact */
export async function redactShop(shop, deps = {}) {
  const { fetchImpl = fetch, sessions, retry = {} } = deps;
  const php = await withRetry(`shop/redact ${shop}`, () => callPhp("shop-redact.php", { shop_domain: shop }, fetchImpl), retry);
  let sessionsDeleted = 0;
  if (sessions) {
    sessionsDeleted = (await sessions.session.deleteMany({ where: { shop } }))?.count || 0;
  }
  const total = Object.values(php.deleted || {}).reduce((a, b) => a + b, 0);
  console.log(`[compliance] shop/redact ${shop}: ${total} rows deleted, ${sessionsDeleted} sessions`);
  return { deleted: php.deleted || {}, sessionsDeleted };
}

/** customers/data_request: logged for the BRIX team to answer the merchant. */
export async function recordDataRequest(shop, payload, deps = {}) {
  const { fetchImpl = fetch, retry = {} } = deps;
  await withRetry(`customers/data_request ${shop}`, () => callPhp("customers-data-request.php", {
    shop_domain: shop,
    data_request_id: payload?.data_request?.id != null ? String(payload.data_request.id) : "",
    orders_count: orderIds(payload?.orders_requested).length,
  }, fetchImpl), retry);
  console.warn(`[compliance] customers/data_request for ${shop} (request ${payload?.data_request?.id ?? "?"}): send the merchant what BRIX holds for this customer`);
}
