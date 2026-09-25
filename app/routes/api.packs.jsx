import { authenticate } from '../shopify.server';
import { getFeatureState } from '../config/plans';
import { getShopPlan } from '../services/plan-permissions.server';
import { getShopCurrency } from '../utils/currency.server';
import { PackError, packErrorResponse, getPack, listPacks, listActivePacks, savePack, deletePack, setPackStatus, parsePackId } from '../services/packs.server';
import { fetchProduct, verifyProductVariant, hydratePacks, syncCheckoutDiscount, getCheckoutDiscountStatus } from '../services/packs-shopify.server';
import { VALID_TEMPLATES, calculateTier, resolveSaveStatus, normalizeTiers, sanitizeCustomization, validateTiers, toNumericId } from '../utils/packs.shared.js';

/**
 * Admin JSON API for BRIX Packs. Response contract (always):
 *   success: { success: true, ...payload }
 *   failure: { success: false, error: <merchant-safe message>, code, details? }
 * Plan rules are enforced HERE from the shop's real plan — the browser's
 * requested status is only ever a request, never trusted.
 */

async function context(request) {
  const { admin, session } = await authenticate.admin(request);
  const planKey = await getShopPlan(session.shop, admin);
  const planState = getFeatureState(planKey, 'packs');
  return { admin, shop: session.shop, planKey, planState };
}

function requireAvailable(planState) {
  if (planState === 'locked') throw new PackError('plan_restricted', 'Packs is not available on your current plan.', { status: 403 });
}

function requirePublishing(planState) {
  if (planState !== 'enabled') throw new PackError('plan_restricted', 'Publishing Packs requires an eligible plan. You can keep this Pack as a draft and preview it.', { status: 403 });
}

async function readBody(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    return body;
  } catch {
    throw new PackError('invalid_json', 'The request could not be read. Please refresh and try again.', { status: 400 });
  }
}

/** Active Packs that the checkout discount function should know about. */
async function packsForFunction(shop, planState) {
  return planState === 'enabled' ? listActivePacks(shop) : [];
}

export async function loader({ request }) {
  try {
    const { admin, shop, planState } = await context(request);
    requireAvailable(planState);
    const url = new URL(request.url);
    const currency = await getShopCurrency(admin, shop);
    if (url.searchParams.get('product')) {
      const product = await fetchProduct(admin, url.searchParams.get('product'));
      return Response.json({ success: true, product, currency });
    }
    if (url.searchParams.get('id')) {
      const pack = await getPack(shop, url.searchParams.get('id'));
      if (!pack) throw new PackError('not_found', 'Pack not found.', { status: 404 });
      const [hydrated] = await hydratePacks(admin, [pack], currency);
      return Response.json({ success: true, pack: hydrated, currency });
    }
    const packs = await hydratePacks(admin, await listPacks(shop), currency);
    return Response.json({ success: true, packs, currency });
  } catch (error) {
    return packErrorResponse(error);
  }
}

export async function action({ request }) {
  try {
    if (request.method !== 'POST') throw new PackError('method_not_allowed', 'Method not allowed.', { status: 405 });
    const { admin, shop, planState } = await context(request);
    const body = await readBody(request);
    const currency = await getShopCurrency(admin, shop);

    if (body.action === 'preview') {
      requireAvailable(planState);
      return Response.json(await previewPack(admin, body, currency));
    }

    if (body.action === 'delete') {
      const id = parsePackId(body.id);
      const pack = await getPack(shop, id);
      if (!pack) throw new PackError('not_found', 'Pack not found.', { status: 404 });
      await deletePack(shop, id);
      const sync = pack.status === 'active' ? await syncCheckoutDiscount(admin, await packsForFunction(shop, planState), { install: false, currencyCode: currency.code }) : null;
      return Response.json({ success: true, deleted: true, warning: sync?.warning || null });
    }

    if (body.action === 'status') {
      const id = parsePackId(body.id);
      const target = body.status;
      if (!['active', 'inactive'].includes(target)) throw new PackError('invalid_status', 'Invalid Pack status.');
      const pack = await getPack(shop, id);
      if (!pack) throw new PackError('not_found', 'Pack not found.', { status: 404 });
      if (target === 'active') {
        requirePublishing(planState);
        await assertActivatable(admin, pack, currency);
      }
      const updated = await setPackStatus(shop, id, target);
      const active = await packsForFunction(shop, planState);
      const sync = await syncCheckoutDiscount(admin, active, { install: target === 'active', currencyCode: currency.code });
      const checkoutDiscount = target === 'active' ? await getCheckoutDiscountStatus(admin, active) : null;
      const [hydrated] = await hydratePacks(admin, [updated], currency);
      return Response.json({ success: true, pack: hydrated, checkoutDiscount, warning: sync.warning });
    }

    if (body.action === 'save') {
      requireAvailable(planState);
      return Response.json(await saveFromBody({ admin, shop, planState, currency }, body));
    }

    throw new PackError('unsupported_action', 'Unsupported Packs action.', { status: 400 });
  } catch (error) {
    return packErrorResponse(error);
  }
}

/** Tiers + live variant must be valid before a Pack may go (or stay) live. */
async function assertActivatable(admin, pack, currency) {
  const { variant } = await verifyProductVariant(admin, pack.productId, pack.variantId, { requireAvailable: true });
  const tiers = normalizeTiers(pack.tiers);
  const check = validateTiers(tiers, { basePrice: variant.price, currencyCode: currency.code });
  if (!check.valid) throw new PackError('invalid_tiers', `Fix the Pack tiers before enabling: ${check.errors[0].message}`, { status: 422, details: { errors: check.errors } });
}

async function previewPack(admin, body, currency) {
  const { variant } = await verifyProductVariant(admin, body.productId, body.variantId);
  const tiers = normalizeTiers(body.tiers);
  const check = validateTiers(tiers, { basePrice: variant.price, currencyCode: currency.code });
  return {
    success: true,
    valid: check.valid,
    errors: check.errors,
    currency,
    variant: { id: variant.id, title: variant.title, price: variant.price, availableForSale: variant.availableForSale, maxQuantity: variant.maxQuantity, inventoryQuantity: variant.inventoryQuantity },
    tiers: check.valid ? tiers.map((tier) => ({ ...tier, ...calculateTier(variant.price, tier, { currencyCode: currency.code, locale: currency.locale }) })) : [],
  };
}

async function saveFromBody({ admin, shop, planState, currency }, body) {
  if (!VALID_TEMPLATES.has(body.template)) throw new PackError('invalid_template', 'Choose a valid Pack template.', { status: 422 });
  if (!toNumericId(body.productId) || !toNumericId(body.variantId)) throw new PackError('invalid_variant', 'Select a Shopify product and variant first.', { status: 422 });

  const existing = body.id ? await getPack(shop, body.id) : null;
  if (body.id && !existing) throw new PackError('not_found', 'Pack not found.', { status: 404 });

  // Resolve the final status from the shop's REAL plan, never from the browser.
  const resolved = resolveSaveStatus({ requested: body.status, existingStatus: existing?.status, planState });
  if (resolved.error === 'invalid_status') throw new PackError('invalid_status', 'Invalid Pack status.');
  if (resolved.error === 'plan_restricted') requirePublishing(planState);
  const status = resolved.status;

  const tiers = normalizeTiers(body.tiers);
  const structure = validateTiers(tiers);
  if (!structure.valid) throw new PackError('invalid_tiers', structure.errors[0].message, { status: 422, details: { errors: structure.errors } });

  const custom = sanitizeCustomization(body.customization);
  if (custom.errors.length) throw new PackError('invalid_customization', custom.errors[0], { status: 422, details: { errors: custom.errors } });

  const { product, variant } = await verifyProductVariant(admin, body.productId, body.variantId, { requireAvailable: status === 'active' });
  const priced = validateTiers(tiers, { basePrice: variant.price, currencyCode: currency.code });
  if (!priced.valid) throw new PackError('invalid_tiers', priced.errors[0].message, { status: 422, details: { errors: priced.errors } });

  const saved = await savePack(shop, {
    id: existing?.id || null,
    productId: product.id,
    variantId: variant.id,
    productTitle: product.title,
    variantTitle: variant.title,
    productImage: product.image,
    basePrice: variant.price,
    status,
    template: body.template,
    tiers,
    customization: custom.value,
  });

  const touchesLive = status === 'active' || existing?.status === 'active';
  let warning = null;
  let checkoutDiscount = null;
  if (touchesLive) {
    const active = await packsForFunction(shop, planState);
    const sync = await syncCheckoutDiscount(admin, active, { install: status === 'active', currencyCode: currency.code });
    warning = sync.warning;
    if (status === 'active') checkoutDiscount = await getCheckoutDiscountStatus(admin, active);
  }
  const [hydrated] = await hydratePacks(admin, [saved], currency);
  return { success: true, pack: hydrated, checkoutDiscount, warning };
}
