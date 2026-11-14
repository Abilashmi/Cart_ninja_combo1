/**
 * Partial COD: a small advance paid online in Shopify's own checkout, the
 * rest on delivery (settings: utils/partial-cod.shared.js).
 *
 * 1. createPartialCod (POST /api/cod/partial-cod, from the COD popup's review
 *    step): prices the order exactly like a COD order (quoteCod: discounts,
 *    Packs, shipping, COD fee, tax), splits the total into advance + balance,
 *    and makes a one-time Shopify discount code worth the items' Shopify price
 *    minus the advance. The browser then opens Shopify checkout for those
 *    items with the code, so the checkout charges only the advance (plus any
 *    shipping or tax Shopify adds). The order's expected total is kept in the
 *    partial_cod_orders table, keyed by the code. Nothing from the browser
 *    sets an amount.
 *
 *    The code is built like the prepaid / box codes Shiprocket and Shopify
 *    accept (prepaid-code.server.js): single use, short lived, a fixed amount
 *    off just these variants, their full price as the minimum, never combined
 *    with other product or order discounts (it already carries them, being
 *    worth everything but the advance).
 *
 * 2. completePartialCodOrder (orders/create webhook): for an order that used
 *    one of these codes, adds the rest back as a "Balance payable on delivery"
 *    line (order edit: untaxed, not shipped), so the order total is the full
 *    amount again and Shopify shows the order as Partially paid, then tags it
 *    partial-cod. Each code is handled once (an atomic claim on its row).
 *    On failure it retries, then tags the order partial-cod-check so the
 *    merchant looks at it.
 */
import crypto from 'node:crypto';
import { getDb } from './db.server';
import { newBoxCode, cleanupExpiredCodes } from './combo-box-code.server';
import { CodError, quoteCod } from './cod.server';
import {
  PARTIAL_COD_BALANCE_TITLE, PARTIAL_COD_CODE_PREFIX, PARTIAL_COD_TAGS, partialCodSplit,
} from '../utils/partial-cod.shared.js';

// Shipping + COD fee of a priced order: the advance in `charges` mode.
export function quoteCharges(quote) {
  return Math.round(((Number(quote?.shipping) || 0) + (Number(quote?.codFee) || 0)) * 100) / 100;
}

export const PARTIAL_COD_TTL_MS = 2 * 60 * 60 * 1000;
const CODE_RE = /^PC[A-Z0-9]{10}$/;
const toVariantGid = (id) => `gid://shopify/ProductVariant/${id}`;
const toOrderGid = (id) => (String(id).startsWith('gid://') ? String(id) : `gid://shopify/Order/${id}`);

async function gql(admin, query, variables) {
  const res = await admin.graphql(query, { variables });
  const json = await res.json();
  if (json?.errors && (Array.isArray(json.errors) ? json.errors.length : true)) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors).slice(0, 300)}`);
  }
  return json.data;
}

let tableReady = null;
export function ensurePartialCodTable(db = getDb()) {
  if (!tableReady) {
    tableReady = db.execute(`CREATE TABLE IF NOT EXISTS partial_cod_orders (
      code VARCHAR(32) NOT NULL,
      shop VARCHAR(255) NOT NULL,
      expected_total DECIMAL(12,2) NOT NULL,
      advance DECIMAL(12,2) NOT NULL,
      currency CHAR(3) NOT NULL DEFAULT 'INR',
      status VARCHAR(16) NOT NULL DEFAULT 'created',
      order_id VARCHAR(64) NULL,
      order_name VARCHAR(64) NULL,
      paid DECIMAL(12,2) NULL,
      balance_added DECIMAL(12,2) NULL,
      error VARCHAR(500) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (code),
      KEY idx_partial_cod_shop (shop, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).catch((error) => { tableReady = null; throw error; });
  }
  return tableReady;
}

// The shopper's name, PIN code and where they started (drawer / product /
// combo), for the COD dashboard; added to tables made before they existed.
let columnsReady = null;
function ensurePartialCodColumns(db) {
  if (!columnsReady) {
    columnsReady = (async () => {
      await ensurePartialCodTable(db);
      for (const ddl of [
        'ADD COLUMN customer_name VARCHAR(120) NULL',
        'ADD COLUMN pincode VARCHAR(10) NULL',
        'ADD COLUMN surface VARCHAR(16) NULL',
      ]) {
        try { await db.execute(`ALTER TABLE partial_cod_orders ${ddl}`); } catch (error) {
          if (!/duplicate column/i.test(String(error?.message || ''))) throw error;
        }
      }
    })().catch((error) => { columnsReady = null; throw error; });
  }
  return columnsReady;
}

/**
 * Price the order like a COD order, split it, make the code and remember the
 * order's expected total. Returns { code, advance, balance, total, currency, endsAt }.
 */
export async function createPartialCod(admin, {
  shop, settings, lines, coupon, address, surface, currencyCode = 'INR', comboWeightLive = false,
  cartCodes = [], cartAttributes = {}, shipping = null, delivery = null,
  db = getDb(), now = Date.now(), random = crypto.randomBytes, priceOrder = quoteCod,
}) {
  const { quote } = await priceOrder(admin, {
    settings, lines, coupon, pincode: address.pincode, surface, currencyCode, comboWeightLive, cartCodes, cartAttributes,
    shipping, destination: { pincode: address.pincode, city: address.city, state: address.state }, delivery, strictDelivery: true,
  });
  const split = partialCodSplit(settings.partialCod, quote.total, quoteCharges(quote));
  if (!split) throw new CodError('partial_unavailable', 'Part payment is not available for this order. Please choose Cash on Delivery or pay online.', { status: 422 });

  // The items at their Shopify price: what the checkout starts from before the code.
  const quantities = new Map();
  for (const line of lines) {
    const id = String(line.variantId);
    quantities.set(id, (quantities.get(id) || 0) + (Number(line.quantity) || 0));
  }
  const priced = await gql(admin, `#graphql
    query BrixPartialCodPrices($ids: [ID!]!) {
      nodes(ids: $ids) { ... on ProductVariant { id price } }
    }`, { ids: [...quantities.keys()].map(toVariantGid) });
  let fullMinor = 0;
  const variantIds = [];
  for (const node of priced?.nodes || []) {
    const id = String(node?.id || '').split('/').pop();
    const price = Number(node?.price);
    if (!quantities.has(id) || !Number.isFinite(price) || price < 0) continue;
    fullMinor += Math.round(price * 100) * quantities.get(id);
    variantIds.push(id);
  }
  if (variantIds.length !== quantities.size) throw new CodError('invalid_items', 'Some items are no longer available. Refresh the page and try again.', { status: 422 });
  const advanceMinor = Math.round(split.advance * 100);
  const amountMinor = fullMinor - advanceMinor;
  if (amountMinor <= 0) throw new CodError('partial_unavailable', 'Part payment is not available for this order. Please choose Cash on Delivery or pay online.', { status: 422 });

  const code = newBoxCode(random, 'PC');
  const endsAt = new Date(now + PARTIAL_COD_TTL_MS).toISOString();
  const data = await gql(admin, `#graphql
    mutation BrixPartialCodCode($input: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $input) {
        codeDiscountNode { id }
        userErrors { field code message }
      }
    }`, {
    input: {
      title: `${PARTIAL_COD_CODE_PREFIX} ${code}`,
      code,
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt,
      usageLimit: 1,
      appliesOncePerCustomer: false,
      context: { all: 'ALL' },
      customerGets: {
        value: { discountAmount: { amount: (amountMinor / 100).toFixed(2), appliesOnEachItem: false } },
        items: { products: { productVariantsToAdd: variantIds.map(toVariantGid) } },
      },
      minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: (fullMinor / 100).toFixed(2) } },
      combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: true },
    },
  });
  const errors = data?.discountCodeBasicCreate?.userErrors || [];
  if (errors.length || !data?.discountCodeBasicCreate?.codeDiscountNode?.id) {
    throw new Error(`discountCodeBasicCreate failed: ${JSON.stringify(errors).slice(0, 300)}`);
  }
  await ensurePartialCodColumns(db);
  await db.execute(
    'INSERT INTO partial_cod_orders (code, shop, expected_total, advance, currency, customer_name, pincode, surface) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [code, shop, quote.total, split.advance, quote.currency || currencyCode, String(address?.name || '').trim().slice(0, 120) || null, String(address?.pincode || '').slice(0, 10) || null, ['drawer', 'product', 'combo'].includes(surface) ? surface : null],
  );
  cleanupExpiredCodes(admin, shop, PARTIAL_COD_CODE_PREFIX).catch(() => {});
  return { code, advance: split.advance, balance: split.balance, total: quote.total, currency: quote.currency || currencyCode, endsAt };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function addBalance(admin, orderGid, balance, currency, staffNote) {
  const begun = await gql(admin, `#graphql
    mutation BrixPartialCodEditBegin($id: ID!) {
      orderEditBegin(id: $id) { calculatedOrder { id } userErrors { field message } }
    }`, { id: orderGid });
  const editId = begun?.orderEditBegin?.calculatedOrder?.id;
  if (!editId) throw new Error(`orderEditBegin failed: ${JSON.stringify(begun?.orderEditBegin?.userErrors || []).slice(0, 300)}`);
  const added = await gql(admin, `#graphql
    mutation BrixPartialCodAddBalance($id: ID!, $title: String!, $price: MoneyInput!) {
      orderEditAddCustomItem(id: $id, title: $title, price: $price, quantity: 1, taxable: false, requiresShipping: false) {
        calculatedLineItem { id }
        userErrors { field message }
      }
    }`, { id: editId, title: PARTIAL_COD_BALANCE_TITLE, price: { amount: balance.toFixed(2), currencyCode: currency } });
  if (!added?.orderEditAddCustomItem?.calculatedLineItem?.id) {
    throw new Error(`orderEditAddCustomItem failed: ${JSON.stringify(added?.orderEditAddCustomItem?.userErrors || []).slice(0, 300)}`);
  }
  const committed = await gql(admin, `#graphql
    mutation BrixPartialCodEditCommit($id: ID!, $staffNote: String) {
      orderEditCommit(id: $id, notifyCustomer: false, staffNote: $staffNote) { order { id } userErrors { field message } }
    }`, { id: editId, staffNote });
  if (!committed?.orderEditCommit?.order?.id) {
    throw new Error(`orderEditCommit failed: ${JSON.stringify(committed?.orderEditCommit?.userErrors || []).slice(0, 300)}`);
  }
}

async function addTags(admin, orderGid, tags) {
  const data = await gql(admin, `#graphql
    mutation BrixPartialCodTags($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } }
    }`, { id: orderGid, tags });
  const errors = data?.tagsAdd?.userErrors || [];
  if (errors.length) throw new Error(`tagsAdd failed: ${JSON.stringify(errors).slice(0, 300)}`);
}

const money = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })}`;

/**
 * orders/create: finish a Partial COD order (see the top of this file).
 * `getAdmin()` returns the shop's Admin API client. Returns what it did
 * ({ handled: false } for any other order).
 */
export async function completePartialCodOrder(shop, payload, {
  getAdmin, db = getDb(), retries = [3000, 15000], wait = sleep,
} = {}) {
  const codes = (payload?.discount_codes || []).map((d) => String(d?.code || '').toUpperCase()).filter((c) => CODE_RE.test(c));
  if (!codes.length || !payload?.id) return { handled: false };
  await ensurePartialCodTable(db);
  const [rows] = await db.execute(
    `SELECT code, expected_total, advance, currency, status FROM partial_cod_orders WHERE shop = ? AND code IN (${codes.map(() => '?').join(',')}) LIMIT 1`,
    [shop, ...codes],
  );
  const row = rows?.[0];
  if (!row) return { handled: false };
  const orderGid = toOrderGid(payload.admin_graphql_api_id || payload.id);
  // Claim it: Shopify can send orders/create more than once.
  const [claim] = await db.execute(
    "UPDATE partial_cod_orders SET status = 'processing', order_id = ?, order_name = ? WHERE code = ? AND shop = ? AND status = 'created'",
    [orderGid, String(payload.name || ''), row.code, shop],
  );
  if (!claim || claim.affectedRows !== 1) return { handled: true, skipped: 'already_handled' };

  const expected = Number(row.expected_total);
  const paid = Number(payload.current_total_price ?? payload.total_price);
  const balance = Math.round((expected - paid) * 100) / 100;
  const currency = String(payload.currency || row.currency || 'INR');
  const staffNote = `BRIX Partial COD: advance ${money(paid)} paid online, ${money(Math.max(0, balance))} to collect on delivery.`;
  let lastError = null;
  for (let attempt = 0; attempt <= retries.length; attempt += 1) {
    try {
      const admin = await getAdmin();
      if (balance > 0.009) await addBalance(admin, orderGid, balance, currency, staffNote);
      await addTags(admin, orderGid, PARTIAL_COD_TAGS);
      await db.execute(
        "UPDATE partial_cod_orders SET status = 'done', paid = ?, balance_added = ?, error = NULL WHERE code = ? AND shop = ?",
        [paid, Math.max(0, balance), row.code, shop],
      );
      return { handled: true, balance: Math.max(0, balance), paid };
    } catch (error) {
      lastError = error;
      if (attempt < retries.length) await wait(retries[attempt]);
    }
  }
  const message = String(lastError?.message || lastError).slice(0, 480);
  console.error(`[partial-cod] ${shop} ${payload.name || orderGid}: balance not added: ${message}`);
  await db.execute(
    "UPDATE partial_cod_orders SET status = 'failed', paid = ?, error = ? WHERE code = ? AND shop = ?",
    [paid, message, row.code, shop],
  ).catch(() => {});
  try {
    const admin = await getAdmin();
    await addTags(admin, orderGid, [...PARTIAL_COD_TAGS, 'partial-cod-check']);
  } catch { /* the failed row is the record */ }
  return { handled: true, failed: true, error: message };
}

/* ───────────── the payment rule (extensions/brix-partial-cod-payment) ───────────── */

export const PARTIAL_COD_FUNCTION_HANDLE = 'brix-partial-cod-payment';
/**
 * Partial COD orders for the COD dashboard (routes/app.cod.jsx), in the same
 * row shape as loadCodOrders, newest first: orders that came in (a code was
 * used), created in [startMs, endMs) when given. Status from Shopify's live
 * order: Partially paid = pending (the balance is still to collect), Paid =
 * paid, cancelled / refunded / voided = cancelled. `partial` = { advance,
 * balance }: what was paid online and what is left to collect.
 */
export async function loadPartialCodOrders(admin, shop, { startMs = null, endMs = null, limit = 500 } = {}, { db = getDb() } = {}) {
  await ensurePartialCodColumns(db);
  const windowed = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
  const [rows] = await db.execute(
    `SELECT code, expected_total, advance, currency, status, order_id, order_name, paid, balance_added, customer_name, pincode, surface,
            UNIX_TIMESTAMP(created_at) AS created_ts
       FROM partial_cod_orders
      WHERE shop = ? AND order_id IS NOT NULL AND status IN ('processing', 'done', 'failed')
        ${windowed ? 'AND created_at >= FROM_UNIXTIME(?) AND created_at < FROM_UNIXTIME(?)' : ''}
      ORDER BY created_at DESC LIMIT ${Math.max(1, Math.min(500, Number(limit) || 500))}`,
    windowed ? [shop, Math.floor(startMs / 1000), Math.floor(endMs / 1000)] : [shop],
  );
  const list = Array.isArray(rows) ? rows : [];
  const live = new Map();
  const ids = list.map((r) => toOrderGid(r.order_id));
  for (let i = 0; i < ids.length && admin; i += 250) {
    try {
      const data = await gql(admin, `#graphql
        query PartialCodOrders($ids: [ID!]!) {
          nodes(ids: $ids) { ... on Order { id displayFinancialStatus displayFulfillmentStatus cancelledAt
            currentTotalPriceSet { shopMoney { amount } } totalOutstandingSet { shopMoney { amount } } } }
        }`, { ids: ids.slice(i, i + 250) });
      for (const node of data?.nodes || []) if (node?.id) live.set(node.id, node);
    } catch (error) {
      console.warn('[partial-cod] could not load live order status:', error?.message);
    }
  }
  const num = (v, fallback = 0) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : fallback);
  return list.map((r) => {
    const gid = toOrderGid(r.order_id);
    const node = live.get(gid);
    let status = 'unknown';
    if (node) {
      if (node.cancelledAt || ['REFUNDED', 'VOIDED'].includes(node.displayFinancialStatus)) status = 'cancelled';
      else if (node.displayFinancialStatus === 'PAID') status = 'paid';
      else status = 'pending';
    }
    const total = node ? num(node.currentTotalPriceSet?.shopMoney?.amount, num(r.expected_total)) : num(r.expected_total);
    const advance = num(r.paid, num(r.advance));
    const balance = node ? num(node.totalOutstandingSet?.shopMoney?.amount, Math.max(0, total - advance)) : num(r.balance_added, Math.max(0, total - advance));
    return {
      orderId: gid,
      orderName: r.order_name || `#${String(r.order_id).split('/').pop()}`,
      orderNumericId: String(r.order_id || '').split('/').pop(),
      source: r.surface || null,
      phone: '',
      phoneVerified: false,
      customer: r.customer_name || 'Shopper',
      pincode: r.pincode || '',
      total,
      currency: r.currency,
      createdAt: Number(r.created_ts) ? new Date(Number(r.created_ts) * 1000).toISOString() : null,
      lifecycle: 'placed',
      tracking: { ga4: null, meta: null },
      status,
      fulfillment: node?.displayFulfillmentStatus || null,
      partial: { advance, balance, needsCheck: r.status === 'failed' },
    };
  });
}

export const PARTIAL_COD_RULE_TITLE = 'BRIX Partial COD: advance paid online';

/**
 * Keeps the store's payment customization for Partial COD in line with the
 * setting: created and on while Partial COD is on, off while it is off. The
 * rule itself only acts on a Partial COD checkout (the _brix_partial_cod
 * attribute), so it never touches other checkouts. Never throws.
 * → { active, message? }
 */
export async function syncPartialCodPaymentRule(admin, enabled) {
  try {
    const found = await gql(admin, `#graphql
      query BrixPartialCodRules {
        paymentCustomizations(first: 50) { nodes { id title enabled } }
      }`);
    const mine = (found?.paymentCustomizations?.nodes || []).find((n) => n.title === PARTIAL_COD_RULE_TITLE);
    if (mine && mine.enabled !== enabled) {
      const data = await gql(admin, `#graphql
        mutation BrixPartialCodRuleSet($id: ID!, $input: PaymentCustomizationInput!) {
          paymentCustomizationUpdate(id: $id, paymentCustomization: $input) { paymentCustomization { id enabled } userErrors { field message } }
        }`, { id: mine.id, input: { enabled } });
      const errors = data?.paymentCustomizationUpdate?.userErrors || [];
      if (errors.length) return { active: Boolean(mine.enabled), message: errors[0].message };
      return { active: enabled };
    }
    if (mine || !enabled) return { active: Boolean(mine?.enabled) };
    const data = await gql(admin, `#graphql
      mutation BrixPartialCodRuleCreate($input: PaymentCustomizationInput!) {
        paymentCustomizationCreate(paymentCustomization: $input) { paymentCustomization { id enabled } userErrors { field message } }
      }`, { input: { functionHandle: PARTIAL_COD_FUNCTION_HANDLE, title: PARTIAL_COD_RULE_TITLE, enabled: true } });
    const errors = data?.paymentCustomizationCreate?.userErrors || [];
    if (errors.length || !data?.paymentCustomizationCreate?.paymentCustomization?.id) {
      return { active: false, message: errors[0]?.message || 'Shopify did not create the payment rule.' };
    }
    return { active: true };
  } catch (error) {
    console.error('[partial-cod] payment rule sync failed:', String(error?.message || error).slice(0, 300));
    return { active: false, message: 'Could not set up the Partial COD payment rule in Shopify. Save again to retry.' };
  }
}
