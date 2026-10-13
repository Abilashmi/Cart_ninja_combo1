/**
 * FBT "buy all together" offer — everything that makes it real at checkout,
 * via the BRIX bundle offer Function (extensions/brix-fbt-discount):
 *   - build the trusted config the Function reads (from the merchant's saved
 *     FBT rules and offer settings, never from the browser)
 *   - write it to the shop's app-owned metafield
 *   - make sure the automatic app discount that runs the Function exists
 *   - tell the storefront widget which rules really carry an offer (only
 *     once Shopify confirms the discount is ACTIVE), and report honestly.
 *
 * Same trust model and shape as reward-gift-shopify.server.js.
 */
import { getDb } from './db.server';
import { ensureFbtOfferColumns, ensureFbtRulesSourceColumn } from './cart-config-writes.server';
import { getShopPlan } from './plan-permissions.server';
import { canPublishFeature } from '../config/plans';
import { buildFbtOfferConfig, sanitizeFbtOffer, withConditionOffers } from '../utils/fbt-offer.shared';

export const FBT_OFFER_FUNCTION_HANDLE = 'brix-fbt-discount';
export const FBT_OFFER_DISCOUNT_TITLE = 'BRIX Bundle Offer';
export const FBT_OFFER_CONFIG_KEY = 'fbt_offer_config';

function parseJson(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

async function gql(admin, query, variables) {
  const response = await admin.graphql(query, { variables });
  const payload = await response.json();
  if (payload?.errors?.length) throw new Error(`Shopify rejected the request: ${JSON.stringify(payload.errors).slice(0, 200)}`);
  return payload.data;
}

/** The widget offer, the live mode and that mode's active rules (offer-ready shape). */
export async function loadFbtOfferInputs(db, shop) {
  await ensureFbtRulesSourceColumn(db);
  await ensureFbtOfferColumns(db);
  const [settingsRows] = await db.execute(
    'SELECT mode, offer_enabled, offer_type, offer_value, offer_text FROM fbt_widget_settings WHERE shop_domain = ? LIMIT 1', [shop]
  );
  const s = settingsRows[0] || {};
  const mode = s.mode === 'ai' ? 'ai' : 'manual';
  const offer = sanitizeFbtOffer({ enabled: s.offer_enabled, type: s.offer_type, value: s.offer_value, text: s.offer_text });
  const [ruleRows] = await db.execute(
    'SELECT * FROM fbt_rules WHERE shop_domain = ? AND source = ? AND is_active = 1 ORDER BY sort_order ASC', [shop, mode]
  );
  const rules = ruleRows.map((r) => ({
    id: String(r.id),
    displayScope: r.trigger_scope === 'all' ? 'all' : 'per_product',
    triggerProducts: parseJson(r.trigger_products, []),
    fbtProducts: parseJson(r.fbt_products, []),
    offerMode: r.offer_mode || 'widget',
    offerValue: Number(r.offer_value) || 0,
  }));
  return { offer, mode, rules };
}

async function shopInfo(admin) {
  const data = await gql(admin, '#graphql\nquery FbtOfferShop { shop { id currencyCode } }');
  return data.shop;
}

async function writeConfig(admin, ownerId, config) {
  const data = await gql(admin, `#graphql
    mutation FbtOfferConfig($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message code } }
    }`, { metafields: [{ ownerId, namespace: '$app', key: FBT_OFFER_CONFIG_KEY, type: 'json', value: JSON.stringify(config) }] });
  const errors = data?.metafieldsSet?.userErrors || [];
  if (errors.length) throw new Error(`Could not sync the bundle offer configuration: ${errors[0].message}`);
}

async function findInstalledDiscount(admin) {
  const data = await gql(admin, `#graphql
    query FbtOfferDiscounts {
      discountNodes(first: 100, query: "type:app") {
        nodes { id discount { __typename ... on DiscountAutomaticApp { title status } } }
      }
    }`);
  const node = (data?.discountNodes?.nodes || []).find((n) => n.discount?.__typename === 'DiscountAutomaticApp' && n.discount.title === FBT_OFFER_DISCOUNT_TITLE);
  return node ? { id: node.id, status: node.discount.status } : null;
}

async function ensureDiscount(admin) {
  const existing = await findInstalledDiscount(admin);
  if (existing) return existing;
  const data = await gql(admin, `#graphql
    mutation FbtOfferDiscountCreate($discount: DiscountAutomaticAppInput!) {
      discountAutomaticAppCreate(automaticAppDiscount: $discount) {
        automaticAppDiscount { discountId status }
        userErrors { field message code }
      }
    }`, {
    discount: {
      title: FBT_OFFER_DISCOUNT_TITLE,
      functionHandle: FBT_OFFER_FUNCTION_HANDLE,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      discountClasses: ['PRODUCT'],
      // The Function itself skips free gifts, Packs and combo box lines.
      combinesWith: { productDiscounts: true, orderDiscounts: true, shippingDiscounts: true },
    },
  });
  const errors = data?.discountAutomaticAppCreate?.userErrors || [];
  if (errors.length) {
    const notDeployed = errors.some((e) => /function/i.test(`${e.message} ${e.code}`));
    const err = new Error(notDeployed ? 'not_deployed' : errors[0].message);
    err.code = notDeployed ? 'not_deployed' : 'create_failed';
    throw err;
  }
  return { status: data.discountAutomaticAppCreate.automaticAppDiscount.status };
}

// The storefront widget shows an offer only on rules in `liveIds`.
async function publishConditionOffers(db, shop, inputs, liveIds) {
  const [rows] = await db.execute('SELECT `condition` FROM fbt_widget WHERE shopDomain = ? LIMIT 1', [shop]);
  if (!rows.length) return;
  const condition = parseJson(rows[0].condition, []);
  const next = withConditionOffers(condition, new Map(inputs.rules.map((r) => [r.id, r])), inputs.offer, liveIds);
  if (JSON.stringify(next) !== JSON.stringify(condition)) {
    await db.execute('UPDATE fbt_widget SET `condition` = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE shopDomain = ?', [JSON.stringify(next), shop]);
  }
}

async function recordState(db, shop, result) {
  try {
    await db.execute('UPDATE fbt_widget_settings SET offer_state = ?, offer_message = ? WHERE shop_domain = ?', [result.state, String(result.message).slice(0, 255), shop]);
  } catch (e) {
    console.error('[fbt-offer] could not record state:', e.message);
  }
}

/**
 * Bring Shopify and the storefront widget in line with the saved FBT offer.
 * Never throws — returns { ok, verified, state, message, rules, skipped }.
 * `verified` is true only when the discount exists and is ACTIVE and the
 * config was written; only then does the widget show any offer.
 *
 * states: not_needed | active | not_deployed | inactive | failed
 */
export async function syncFbtOfferDiscount(admin, shop) {
  const db = getDb();
  let inputs = null;
  const finish = async (result, liveIds) => {
    if (inputs) {
      try { await publishConditionOffers(db, shop, inputs, liveIds); } catch (e) { console.error('[fbt-offer] condition update failed:', e.message); }
    }
    await recordState(db, shop, result);
    return result;
  };
  try {
    inputs = await loadFbtOfferInputs(db, shop);
    const planKey = await getShopPlan(shop);
    const publishable = canPublishFeature(planKey, 'fbt');
    const shopData = await shopInfo(admin);
    const { config, included, skipped } = buildFbtOfferConfig(inputs.offer, publishable ? inputs.rules : [], shopData.currencyCode);
    await writeConfig(admin, shopData.id, config);
    if (!config.sets.length) {
      const wanted = inputs.rules.some((r) => r.offerMode === 'percentage' || r.offerMode === 'fixed_amount') || inputs.offer.enabled;
      return finish({
        ok: true, verified: false, state: 'not_needed',
        message: !publishable && wanted ? 'Bundle offers go live once FBT is on your plan.' : 'No bundle offer is set up.',
        rules: 0, skipped,
      }, []);
    }
    const discount = await ensureDiscount(admin);
    if (discount.status && discount.status !== 'ACTIVE') {
      return finish({ ok: false, verified: false, state: 'inactive', message: `The bundle offer discount is ${String(discount.status).toLowerCase()} in Shopify.`, rules: included.length, skipped }, []);
    }
    return finish({
      ok: true, verified: true, state: 'active',
      message: `The bundle offer is live on ${included.length} rule${included.length === 1 ? '' : 's'}.${skipped.some((x) => x.reason === 'too_big') ? ' Some rules were left out (too many rules with an offer).' : ''}`,
      rules: included.length, skipped,
    }, included);
  } catch (error) {
    if (error?.code === 'not_deployed') {
      return finish({
        ok: false, verified: false, state: 'not_deployed',
        message: 'The bundle offer discount is not installed on this store yet (the app needs to be deployed once with its latest extension).',
        rules: 0, skipped: [],
      }, []);
    }
    console.error('[fbt-offer] sync failed:', String(error?.message || error).slice(0, 300));
    return finish({ ok: false, verified: false, state: 'failed', message: 'Could not set up the bundle offer discount in Shopify.', rules: 0, skipped: [] }, []);
  }
}
