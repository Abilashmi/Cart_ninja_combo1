/**
 * Shared plumbing for the public BRIX COD storefront endpoints
 * (api.cod.config / api.cod.pincode / api.cod.otp / api.cod.quote / api.cod.order).
 *
 * These are called cross-origin straight from the storefront (like
 * api.combo-page-data), so they are unauthenticated: every write is protected
 * by server-side re-pricing, OTP (when an SMS provider is configured),
 * per-IP / per-phone limits and idempotency keys — see cod.server.js.
 */
import { unauthenticated } from '../shopify.server';
import { getFeatureState } from '../config/plans';
import { getShopPlan } from './plan-permissions.server';
import { getShopCurrency } from '../utils/currency.server';
import { CodError, getCodSettings, otpAvailable, rateLimit, clientIp } from './cod.server';
import { COD_SURFACES } from '../utils/cod.shared.js';

export const COD_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export function corsPreflight() {
  return new Response(null, { status: 204, headers: COD_CORS_HEADERS });
}

export function ok(body, extraHeaders = {}) {
  return Response.json({ success: true, ...body }, { headers: { ...COD_CORS_HEADERS, ...extraHeaders } });
}

export function parseShop(value) {
  const shop = String(value || '').trim().toLowerCase();
  if (!SHOP_RE.test(shop)) throw new CodError('invalid_shop', 'A valid shop is required.');
  return shop;
}

export function parseSurface(value) {
  const surface = String(value || '');
  if (!COD_SURFACES.includes(surface)) throw new CodError('invalid_request', 'Refresh the page and try again.');
  return surface;
}

export async function readJson(request) {
  if (request.method !== 'POST') throw new CodError('method_not_allowed', 'POST only.', { status: 405 });
  const text = await request.text();
  if (text.length > 64 * 1024) throw new CodError('invalid_request', 'Request is too large.', { status: 413 });
  try { return JSON.parse(text || '{}') || {}; } catch { throw new CodError('invalid_request', 'Refresh the page and try again.'); }
}

export function limitByIp(request, bucket, max, windowMs) {
  if (!rateLimit(`${bucket}:${clientIp(request)}`, max, windowMs)) {
    throw new CodError('rate_limited', 'Too many requests. Please wait a minute and try again.', { status: 429 });
  }
}

/**
 * Everything a COD request needs about the shop. `live` is true only when the
 * merchant turned COD on AND their plan publishes it to the storefront.
 */
export async function loadCodContext(shop, { needAdmin = true } = {}) {
  let admin = null;
  if (needAdmin) {
    try {
      ({ admin } = await unauthenticated.admin(shop));
    } catch {
      throw new CodError('shop_not_installed', 'This store is not connected to BRIX.', { status: 404 });
    }
  }
  const [settings, planKey] = await Promise.all([getCodSettings(shop), getShopPlan(shop)]);
  const planState = getFeatureState(planKey, 'cod_checkout');
  const currency = admin ? await getShopCurrency(admin, shop) : null;
  return {
    admin,
    settings,
    planState,
    live: settings.enabled && planState === 'enabled',
    otpRequired: settings.requireOtp && otpAvailable(),
    currencyCode: currency?.code || 'INR',
  };
}

export function assertLive(ctx, surface) {
  if (!ctx.live || (surface && ctx.settings.surfaces[surface] === false)) {
    throw new CodError('cod_disabled', 'Cash on Delivery is not available right now. Please pay online.', { status: 403 });
  }
}
