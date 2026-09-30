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
import { defaultCustomization, mergeCustomization, sanitizeCustomization, toNumericId, toGid, VALID_STATUSES, VALID_PACK_TYPES, VALID_VARIANT_SCOPES, normalizeVariantIds } from '../utils/packs.shared.js';

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

// `created_at`/`updated_at` are MySQL TIMESTAMP columns (stored as UTC), but
// the PHP db_proxy returns them as a bare "YYYY-MM-DD HH:MM:SS" string with no
// timezone marker. `new Date(...)` on the client would otherwise parse that as
// local time instead of UTC, showing the right date but the wrong time
// (off by the viewer's UTC offset). Mark it explicitly so it parses correctly.
function toIsoUtc(value) {
  if (!value) return value;
  const text = String(value).trim();
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(text)) return text;
  return `${text.replace(' ', 'T')}Z`;
}

/** Translate low-level DB failures into PackErrors without leaking SQL / hosts. */
function mapDbError(error) {
  if (error instanceof PackError) return error;
  const message = String(error?.message || '');
  if (/doesn't exist|does not exist|no such table|ER_NO_SUCH_TABLE|1146/i.test(message)) {
    console.error('[packs.server] brix_packs table missing:', message.slice(0, 200));
    return new PackError('storage_not_ready', 'Packs storage is not set up yet. Run migrations/create_brix_packs.sql on the database (see CLAUDE.md).', { status: 503 });
  }
  if (/unknown column '(pack_type|variant_scope|allowed_variant_ids_json)'|ER_BAD_FIELD_ERROR|1054/i.test(message)) {
    console.error('[packs.server] brix_packs missing variant-scope columns:', message.slice(0, 200));
    return new PackError('storage_outdated', 'Packs storage needs an update. Run migrations/alter_brix_packs_variant_scope.sql on the database.', { status: 503 });
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
  // Columns added by migrations/alter_brix_packs_variant_scope.sql — default
  // to the pre-migration single-variant shape so rows on a DB that hasn't run
  // that migration yet still read back correctly instead of throwing.
  const packType = row.pack_type || (row.template === 'choose_each_item' ? 'mix_match' : 'same_variant');
  const variantScope = row.variant_scope || 'selected';
  const anchorVariantId = toNumericId(row.variant_id) || String(row.variant_id);
  const allowedVariantIds = row.allowed_variant_ids_json ? normalizeVariantIds(parseJson(row.allowed_variant_ids_json, [])) : [anchorVariantId];
  return {
    id: Number(row.id),
    shop: row.shop_domain,
    productId: toNumericId(row.product_id) || String(row.product_id),
    // Anchor variant — base price/display and the row's legacy unique key.
    // Which variants the Pack actually applies to is variantScope/allowedVariantIds.
    variantId: anchorVariantId,
    productTitle: row.product_title,
    variantTitle: row.variant_title,
    productImage: row.product_image || '',
    // Last price seen from Shopify — a cache only; live price is always re-fetched.
    basePrice: Number(row.base_price),
    status: row.status,
    enabled: Boolean(row.enabled),
    template: row.template,
    packType,
    variantScope,
    allowedVariantIds: variantScope === 'all' ? [] : allowedVariantIds,
    version: Number(row.version || 1),
    tiers: parseJson(row.tiers_json, []),
    customization: mergeCustomization(parsedCustomization),
    createdAt: toIsoUtc(row.created_at),
    updatedAt: toIsoUtc(row.updated_at),
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

/**
 * Record the last checkout-discount verification for the shop so the PHP
 * storefront endpoint (php_backend/packs_storefront.php) — which has no
 * Shopify access — can decide whether shoppers may see Packs.
 * `verifiedPacks` maps pack id -> version that was confirmed in the Function
 * config; PHP only shows Packs whose current version is in that map.
 * Never throws: a failed write only means the storefront keeps the previous state.
 */
export async function saveStorefrontDiscountState(shop, status, activePacks = []) {
  const verifiedPacks = status?.verified ? Object.fromEntries(activePacks.map((pack) => [String(pack.id), Number(pack.version || 1)])) : {};
  try {
    await getDb().execute(
      `INSERT INTO brix_packs_shop_state (shop_domain, discount_verified, discount_state, discount_message, verified_packs_json, checked_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE discount_verified = VALUES(discount_verified), discount_state = VALUES(discount_state),
         discount_message = VALUES(discount_message), verified_packs_json = VALUES(verified_packs_json), checked_at = CURRENT_TIMESTAMP`,
      [shop, status?.verified ? 1 : 0, String(status?.state || 'unknown').slice(0, 32), String(status?.message || '').slice(0, 255), JSON.stringify(verifiedPacks)]
    );
  } catch (error) {
    console.error('[packs.server] could not record storefront discount state:', String(error?.message || '').slice(0, 200));
  }
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
  const packType = VALID_PACK_TYPES.has(input.packType) ? input.packType : 'same_variant';
  const variantScope = VALID_VARIANT_SCOPES.has(input.variantScope) ? input.variantScope : 'selected';
  // 'all' scope is resolved against the live variant list on every read, never
  // frozen into a snapshot here — storing [] keeps that intent unambiguous.
  // The real "at least one variant" merchant-facing validation happens in
  // verifyPackCoverage before this is ever called; a caller that gives no
  // coverage info at all (e.g. a direct/legacy savePack call) falls back to
  // just the one variant it did give, matching the pre-redesign behavior.
  const rawAllowed = normalizeVariantIds(input.allowedVariantIds);
  const allowedVariantIds = variantScope === 'all' ? [] : (rawAllowed.length ? rawAllowed : [variantId]);
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
  const allowedVariantIdsJson = JSON.stringify(allowedVariantIds);

  return run(async (db) => {
    if (packId) {
      await db.execute(
        'UPDATE brix_packs SET product_id=?, variant_id=?, product_title=?, variant_title=?, product_image=?, base_price=?, status=?, enabled=?, template=?, pack_type=?, variant_scope=?, allowed_variant_ids_json=?, version=version+1, tiers_json=?, customization_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND shop_domain=?',
        [productId, variantId, input.productTitle, input.variantTitle, input.productImage || '', input.basePrice, status, enabled, input.template, packType, variantScope, allowedVariantIdsJson, tiersJson, customizationJson, packId, shop]
      );
      return getPack(shop, packId);
    }
    const [result] = await db.execute(
      'INSERT INTO brix_packs (shop_domain, product_id, variant_id, product_title, variant_title, product_image, base_price, status, enabled, template, pack_type, variant_scope, allowed_variant_ids_json, tiers_json, customization_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [shop, productId, variantId, input.productTitle, input.variantTitle, input.productImage || '', input.basePrice, status, enabled, input.template, packType, variantScope, allowedVariantIdsJson, tiersJson, customizationJson]
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
