import { authenticate } from "../shopify.server";
import { getDb } from "../services/db.server";
import {
  DEFAULT_UPSELL_CONFIG,
  UPSELL_STYLES,
  getProductsByIds,
  validateUpsellRule,
} from '../services/api.cart-settings.shared';

function collectUpsellProductIds(config) {
  const ids = [
    ...(config?.rule1?.enabled ? (config.rule1.upsellProducts || []) : []),
    ...(config?.rule2?.enabled ? (config.rule2.upsellProducts || []) : []),
    ...(config?.rule3?.enabled ? (config.rule3.upsellProducts || []) : []),
  ];
  return [...new Set(ids)];
}

function parseJson(val, fallback = null) {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

// ── Loader (GET) ──────────────────────────────────────────────────────────────

export async function loader({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const shopId = session.shop;

    const [productsRes, collectionsRes] = await Promise.all([
      admin.graphql(`query { products(first:50) { edges { node { id title featuredImage { url } variants(first:1) { edges { node { price } } } } } } }`),
      admin.graphql(`query { collections(first:50) { edges { node { id title productsCount { count } } } } }`),
    ]);

    const productsData = await productsRes.json();
    const collectionsData = await collectionsRes.json();

    const allProducts = productsData.data?.products?.edges?.map(({ node }) => ({
      id: node.id, title: node.title,
      image: node.featuredImage?.url || "",
      price: node.variants.edges[0]?.node?.price || "0.00",
    })) || [];

    const allCollections = collectionsData.data?.collections?.edges?.map(({ node }) => ({
      id: node.id, title: node.title,
      productCount: node.productsCount?.count || 0,
    })) || [];

    const db = getDb();
    const [rules] = await db.execute(
      'SELECT * FROM upsell_rules WHERE shop = ? ORDER BY priority ASC',
      [shopId]
    );

    let config = DEFAULT_UPSELL_CONFIG;
    if (rules.length > 0) {
      const rule1 = rules.find(r => r.priority === 0) || rules[0];
      const rule2 = rules.find(r => r.priority === 1);
      const rule3 = rules.find(r => r.priority === 2);
      config = {
        ...DEFAULT_UPSELL_CONFIG,
        activeTemplate: rule1?.layout || UPSELL_STYLES.GRID,
        rule1: rule1 ? {
          enabled: !!rule1.enabled,
          upsellProducts: parseJson(rule1.upsell_products, []),
          upsellCollections: parseJson(rule1.upsell_collections, []),
        } : DEFAULT_UPSELL_CONFIG.rule1,
        rule2: rule2 ? {
          enabled: !!rule2.enabled,
          triggerProducts: parseJson(rule2.trigger_products, []),
          triggerCollections: parseJson(rule2.trigger_collections, []),
          upsellProducts: parseJson(rule2.upsell_products, []),
          upsellCollections: parseJson(rule2.upsell_collections, []),
        } : DEFAULT_UPSELL_CONFIG.rule2,
        rule3: rule3 ? {
          enabled: !!rule3.enabled,
          cartValueThreshold: rule3.cart_value_threshold || 1000,
          upsellProducts: parseJson(rule3.upsell_products, []),
          upsellCollections: parseJson(rule3.upsell_collections, []),
        } : DEFAULT_UPSELL_CONFIG.rule3,
      };
    }

    return Response.json({ success: true, data: { config, allProducts, allCollections } });
  } catch (error) {
    console.error('[upsell loader]', error);
    return Response.json({ success: false, error: 'Failed to retrieve upsell configuration' }, { status: 500 });
  }
}

// ── Action (POST) ─────────────────────────────────────────────────────────────

export async function action({ request }) {
  try {
    const { session } = await authenticate.admin(request);
    const shopId = session.shop;
    const body = await request.json();

    const rulesToSave = [
      { id: `${shopId}-rule-1`, priority: 0, data: body.rule1, ruleType: 'GLOBAL' },
      { id: `${shopId}-rule-2`, priority: 1, data: body.rule2, ruleType: 'TRIGGERED' },
      { id: `${shopId}-rule-3`, priority: 2, data: body.rule3, ruleType: 'CART_CONDITIONS' },
    ];

    for (const rule of rulesToSave) {
      if (!rule.data) continue;
      const validation = validateUpsellRule(rule.data);
      if (!validation.valid) {
        return Response.json({ success: false, error: validation.error || `Invalid rule: ${rule.ruleType}` }, { status: 400 });
      }
    }

    const db = getDb();
    for (const rule of rulesToSave) {
      if (!rule.data) continue;
      await db.execute(
        `INSERT INTO upsell_rules
            (id, shop, enabled, rule_type, priority, trigger_products, trigger_collections,
             upsell_products, upsell_collections, cart_value_threshold, layout, title)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            shop = VALUES(shop),
            enabled = VALUES(enabled),
            rule_type = VALUES(rule_type),
            priority = VALUES(priority),
            trigger_products = VALUES(trigger_products),
            trigger_collections = VALUES(trigger_collections),
            upsell_products = VALUES(upsell_products),
            upsell_collections = VALUES(upsell_collections),
            cart_value_threshold = VALUES(cart_value_threshold),
            layout = VALUES(layout),
            title = VALUES(title),
            updated_at = CURRENT_TIMESTAMP`,
        [
          rule.id, shopId,
          rule.data.enabled ? 1 : 0,
          rule.ruleType, rule.priority,
          rule.data.triggerProducts ? JSON.stringify(rule.data.triggerProducts) : null,
          rule.data.triggerCollections ? JSON.stringify(rule.data.triggerCollections) : null,
          rule.data.upsellProducts ? JSON.stringify(rule.data.upsellProducts) : null,
          rule.data.upsellCollections ? JSON.stringify(rule.data.upsellCollections) : null,
          rule.data.cartValueThreshold || 0,
          body.activeTemplate || 'grid',
          body.title || 'Recommended for you',
        ]
      );
    }

    return Response.json({
      success: true,
      message: 'Upsell configuration saved',
      data: { config: body, products: getProductsByIds(collectUpsellProductIds(body)) },
    });
  } catch (error) {
    console.error('[upsell action]', error);
    return Response.json({ success: false, error: 'Failed to save upsell configuration', details: error.message }, { status: 500 });
  }
}
