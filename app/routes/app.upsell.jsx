import { authenticate } from "../shopify.server";
import { getDb } from "../services/db.server";
import {
  DEFAULT_UPSELL_CONFIG,
  UPSELL_STYLES,
  validateUpsellRule,
} from "../services/api.cart-settings.shared";

function parseJson(val, fallback = null) {
  if (!val) return fallback;
  if (typeof val === "object") return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

/* ─── LOADER ──────────────────────────────────────────────────────────────── */
export const loader = async ({ request }) => {
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
    "SELECT * FROM upsell_rules WHERE shop = ? ORDER BY priority ASC",
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
        upsellProducts: parseJson(rule1.upsellProducts, []),
        upsellCollections: parseJson(rule1.upsellCollections, []),
      } : DEFAULT_UPSELL_CONFIG.rule1,
      rule2: rule2 ? {
        enabled: !!rule2.enabled,
        triggerProducts: parseJson(rule2.triggerProducts, []),
        triggerCollections: parseJson(rule2.triggerCollections, []),
        upsellProducts: parseJson(rule2.upsellProducts, []),
        upsellCollections: parseJson(rule2.upsellCollections, []),
      } : DEFAULT_UPSELL_CONFIG.rule2,
      rule3: rule3 ? {
        enabled: !!rule3.enabled,
        cartValueThreshold: rule3.cartValueThreshold || 1000,
        upsellProducts: parseJson(rule3.upsellProducts, []),
        upsellCollections: parseJson(rule3.upsellCollections, []),
      } : DEFAULT_UPSELL_CONFIG.rule3,
    };
  }

  return Response.json({ success: true, data: { config, allProducts, allCollections } });
};

/* ─── ACTION ──────────────────────────────────────────────────────────────── */
export const action = async ({ request }) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopId = session.shop;
    const body = await request.json();

    const rulesToSave = [
      { id: `${shopId}-rule-1`, priority: 0, data: body.rule1, ruleType: "GLOBAL" },
      { id: `${shopId}-rule-2`, priority: 1, data: body.rule2, ruleType: "TRIGGERED" },
      { id: `${shopId}-rule-3`, priority: 2, data: body.rule3, ruleType: "CART_CONDITIONS" },
    ];

    for (const rule of rulesToSave) {
      if (!rule.data) continue;
      const validation = validateUpsellRule({ ...rule.data, ruleType: rule.ruleType, id: rule.id });
      if (!validation.valid) {
        return Response.json({ success: false, error: validation.error || `Invalid rule: ${rule.ruleType}` }, { status: 400 });
      }
    }

    const db = getDb();
    for (const rule of rulesToSave) {
      if (!rule.data) continue;
      await db.execute(
        `INSERT INTO upsell_rules
            (id, shop, enabled, ruleType, priority, triggerProducts, triggerCollections,
             upsellProducts, upsellCollections, cartValueThreshold, layout, title, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE
            shop = VALUES(shop),
            enabled = VALUES(enabled),
            ruleType = VALUES(ruleType),
            priority = VALUES(priority),
            triggerProducts = VALUES(triggerProducts),
            triggerCollections = VALUES(triggerCollections),
            upsellProducts = VALUES(upsellProducts),
            upsellCollections = VALUES(upsellCollections),
            cartValueThreshold = VALUES(cartValueThreshold),
            layout = VALUES(layout),
            title = VALUES(title),
            updatedAt = CURRENT_TIMESTAMP(3)`,
        [
          rule.id, shopId,
          rule.data.enabled ? 1 : 0,
          rule.ruleType, rule.priority,
          rule.data.triggerProducts ? JSON.stringify(rule.data.triggerProducts) : null,
          rule.data.triggerCollections ? JSON.stringify(rule.data.triggerCollections) : null,
          rule.data.upsellProducts ? JSON.stringify(rule.data.upsellProducts) : null,
          rule.data.upsellCollections ? JSON.stringify(rule.data.upsellCollections) : null,
          rule.data.cartValueThreshold || 0,
          body.activeTemplate || "grid",
          body.title || "Recommended for you",
        ]
      );
    }

    return Response.json({ success: true, message: "Upsell configuration saved" });
  } catch (error) {
    console.error("[upsell action]", error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
};

export default function UpsellPage() {
  return null;
}
