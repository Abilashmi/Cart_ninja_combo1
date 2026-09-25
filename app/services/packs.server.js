/**
 * BRIX Packs — persistence layer for the brix_packs MySQL table.
 *
 * The table is created by migrations/create_brix_packs.sql (see CLAUDE.md,
 * "BRIX Packs"). This module never runs DDL: a missing table surfaces as a
 * clear PackError instead of a CREATE TABLE on every request.
 *
 * Product/variant ids are stored as numeric strings. Rows written by the
 * first prototype stored full GIDs, so every lookup accepts both spellings.
 */
import { getDb } from './db.server';
import { defaultCustomization, mergeCustomization, sanitizeCustomization, toNumericId, toGid, VALID_STATUSES } from '../utils/packs.shared.js';

/** Error with a stable machine-readable `code` and a merchant-safe message. */
export class PackError extends Error {
  constructor(code, message, { status = 400, details } = {}) {
    super(message);
    this.name = 'PackError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function parseJson(value, fallback) {
  try { const parsed = JSON.parse(value || ''); return parsed ?? fallback; } catch { return fallback; }
}

/** Translate low-level DB failures into PackErrors without leaking SQL / hosts. */
function mapDbError(error) {
  if (error instanceof PackError) return error;
  const message = String(error?.message || '');
  if (/doesn't exist|does not exist|no such table|ER_NO_SUCH_TABLE|1146/i.test(message)) {
    console.error('[packs.server] brix_packs table missing:', message.slice(0, 200));
    return new PackError('storage_not_ready', 'Packs storage is not set up yet. Run migrations/create_brix_packs.sql on the database (see CLAUDE.md).', { status: 503 });
  }
  if (/duplicate entry|ER_DUP_ENTRY|1062/i.test(message)) {
    return new PackError('duplicate', 'A Pack already exists for this product and variant.', { status: 409 });
  }
  console.error('[packs.server] database error:', message.slice(0, 300));
  return new PackError('database_error', 'Could not reach Packs storage. Please try again in a moment.', { status: 503 });
}

async function run(fn) {
  try { return await fn(getDb()); } catch (error) { throw mapDbError(error); }
}

export function parsePackId(id) {
  const text = String(id ?? '').trim();
  if (!/^\d{1,18}$/.test(text)) throw new PackError('invalid_id', 'Invalid Pack id.', { status: 400 });
  return Number(text);
}

export function rowToPack(row) {
  const parsedCustomization = sanitizeCustomization(parseJson(row.customization_json, {})).value;
  return {
    id: Number(row.id),
    shop: row.shop_domain,
    productId: toNumericId(row.product_id) || String(row.product_id),
    variantId: toNumericId(row.variant_id) || String(row.variant_id),
    productTitle: row.product_title,
    variantTitle: row.variant_title,
    productImage: row.product_image || '',
    // Last price seen from Shopify — a cache only; live price is always re-fetched.
    basePrice: Number(row.base_price),
    status: row.status,
    enabled: Boolean(row.enabled),
    template: row.template,
    version: Number(row.version || 1),
    tiers: parseJson(row.tiers_json, []),
    customization: mergeCustomization(parsedCustomization),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listPacks(shop) {
  return run(async (db) => {
    const [rows] = await db.execute('SELECT * FROM brix_packs WHERE shop_domain = ? ORDER BY updated_at DESC', [shop]);
    return (rows || []).map(rowToPack);
  });
}

export async function getPack(shop, id) {
  const packId = parsePackId(id);
  return run(async (db) => {
    const [rows] = await db.execute('SELECT * FROM brix_packs WHERE id = ? AND shop_domain = ?', [packId, shop]);
    return rows?.[0] ? rowToPack(rows[0]) : null;
  });
}

/** Active Packs for one product (exact id match — 123 never matches 1123). */
export async function listActivePacksForProduct(shop, productId) {
  const numeric = toNumericId(productId);
  if (!numeric) throw new PackError('invalid_product', 'Invalid product id.');
  return run(async (db) => {
    const [rows] = await db.execute(
      "SELECT * FROM brix_packs WHERE shop_domain = ? AND status = 'active' AND enabled = 1 AND product_id IN (?, ?)",
      [shop, numeric, toGid('Product', numeric)]
    );
    return (rows || []).map(rowToPack);
  });
}

export async function listActivePacks(shop) {
  return run(async (db) => {
    const [rows] = await db.execute("SELECT * FROM brix_packs WHERE shop_domain = ? AND status = 'active' AND enabled = 1", [shop]);
    return (rows || []).map(rowToPack);
  });
}

/** Another Pack (not `excludeId`) already owns this product+variant for the shop? */
export async function findDuplicatePack(shop, productId, variantId, excludeId = null) {
  const product = toNumericId(productId);
  const variant = toNumericId(variantId);
  return run(async (db) => {
    const [rows] = await db.execute(
      'SELECT id FROM brix_packs WHERE shop_domain = ? AND product_id IN (?, ?) AND variant_id IN (?, ?)',
      [shop, product, toGid('Product', product), variant, toGid('ProductVariant', variant)]
    );
    const hit = (rows || []).find((row) => excludeId === null || Number(row.id) !== Number(excludeId));
    return hit ? Number(hit.id) : null;
  });
}

/**
 * Insert or update a Pack from already-verified data. The caller (api.packs)
 * is responsible for re-fetching product/variant/price from Shopify, running
 * plan checks and validating tiers; this layer additionally guards duplicates.
 */
export async function savePack(shop, input) {
  const status = VALID_STATUSES.has(input.status) ? input.status : 'draft';
  const enabled = status === 'active' ? 1 : 0;
  const productId = toNumericId(input.productId);
  const variantId = toNumericId(input.variantId);
  if (!productId || !variantId) throw new PackError('invalid_variant', 'A valid Shopify product and variant are required.');
  const packId = input.id ? parsePackId(input.id) : null;

  let existing = null;
  if (packId) {
    existing = await getPack(shop, packId);
    if (!existing) throw new PackError('not_found', 'Pack not found.', { status: 404 });
  }
  const duplicateId = await findDuplicatePack(shop, productId, variantId, packId);
  if (duplicateId) {
    throw new PackError('duplicate', 'A Pack already exists for this product and variant. Edit the existing Pack instead.', { status: 409, details: { existingId: duplicateId } });
  }

  // Merge over what is stored, never over a hardcoded object — a partial patch
  // can't silently reset groups it didn't mention.
  const customization = mergeCustomization(existing?.customization || defaultCustomization(), sanitizeCustomization(input.customization).value);
  const tiersJson = JSON.stringify(input.tiers);
  const customizationJson = JSON.stringify(customization);

  return run(async (db) => {
    if (packId) {
      await db.execute(
        'UPDATE brix_packs SET product_id=?, variant_id=?, product_title=?, variant_title=?, product_image=?, base_price=?, status=?, enabled=?, template=?, version=version+1, tiers_json=?, customization_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND shop_domain=?',
        [productId, variantId, input.productTitle, input.variantTitle, input.productImage || '', input.basePrice, status, enabled, input.template, tiersJson, customizationJson, packId, shop]
      );
      return getPack(shop, packId);
    }
    const [result] = await db.execute(
      'INSERT INTO brix_packs (shop_domain, product_id, variant_id, product_title, variant_title, product_image, base_price, status, enabled, template, tiers_json, customization_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [shop, productId, variantId, input.productTitle, input.variantTitle, input.productImage || '', input.basePrice, status, enabled, input.template, tiersJson, customizationJson]
    );
    return getPack(shop, result.insertId);
  });
}

export async function deletePack(shop, id) {
  const packId = parsePackId(id);
  return run(async (db) => {
    const [result] = await db.execute('DELETE FROM brix_packs WHERE id = ? AND shop_domain = ?', [packId, shop]);
    return Number(result?.affectedRows || 0) > 0;
  });
}

export async function setPackStatus(shop, id, status) {
  if (!['active', 'inactive', 'draft'].includes(status)) throw new PackError('invalid_status', 'Invalid Pack status.');
  const packId = parsePackId(id);
  const pack = await getPack(shop, packId);
  if (!pack) throw new PackError('not_found', 'Pack not found.', { status: 404 });
  return run(async (db) => {
    await db.execute('UPDATE brix_packs SET status=?, enabled=?, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND shop_domain=?', [status, status === 'active' ? 1 : 0, packId, shop]);
    return getPack(shop, packId);
  });
}

/**
 * Turn any thrown value into a JSON error Response. PackErrors carry a safe
 * message + code; anything else is logged server-side and replaced with a
 * generic message so SQL, hosts, tokens etc. never reach the browser.
 */
export function packErrorResponse(error, headers = {}) {
  if (error instanceof Response) return error;
  if (error instanceof PackError) {
    return Response.json({ success: false, error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) }, { status: error.status, headers });
  }
  console.error('[packs] unexpected error:', String(error?.message || error).slice(0, 300));
  return Response.json({ success: false, error: 'Something went wrong. Please try again.', code: 'internal_error' }, { status: 500, headers });
}
