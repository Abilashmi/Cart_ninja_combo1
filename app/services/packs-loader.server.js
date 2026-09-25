import { authenticate } from '../shopify.server';
import { getFeatureState } from '../config/plans';
import { getShopPlan } from './plan-permissions.server';
import { getShopCurrency } from '../utils/currency.server';
import { PackError } from './packs.server';

/**
 * Shared loader prelude for every /app/packs* route: authenticates the admin
 * request (never bypassed), resolves the shop's REAL plan state and currency.
 */
export async function packsRouteContext(request) {
  const { admin, session } = await authenticate.admin(request);
  const planKey = await getShopPlan(session.shop, admin);
  const currency = await getShopCurrency(admin, session.shop);
  return {
    admin,
    shop: session.shop,
    planKey,
    planState: getFeatureState(planKey, 'packs'),
    currency: { code: currency.code, locale: currency.locale, symbol: currency.symbol },
  };
}

/** Loader helper: PackErrors become route error responses the Packs ErrorBoundary can explain. */
export function throwPackResponse(error) {
  if (error instanceof Response) throw error;
  if (error instanceof PackError) throw new Response(error.message, { status: error.status, statusText: error.code });
  console.error('[packs route] unexpected loader error:', String(error?.message || error).slice(0, 300));
  throw new Response('Something went wrong loading this page. Please try again.', { status: 500 });
}
