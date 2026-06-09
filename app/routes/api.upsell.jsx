/**
 * Upsell API Endpoints
 * GET /api/upsell - Retrieve upsell configuration
 * POST /api/upsell - Save upsell configuration
 * GET /api/upsell/products - Get available upsell products
 */
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  DEFAULT_UPSELL_CONFIG,
  UPSELL_STYLES,
  getProductsByIds,
  validateUpsellRule,
} from '../services/api.cart-settings.shared';
// In-memory storage is replaced by Prisma db.upsellRule
const collectUpsellProductIds = (config) => {
  const ids = [
    ...(config?.rule1?.enabled ? (config.rule1.upsellProducts || []) : []),
    ...(config?.rule2?.enabled ? (config.rule2.upsellProducts || []) : []),
    ...(config?.rule3?.enabled ? (config.rule3.upsellProducts || []) : []),
  ];
  return [...new Set(ids)];
};

/**
 * GET /api/upsell
 * Retrieve current upsell configuration
 */
export async function loader({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const shopId = session.shop;

    // Fetch all products for the picker
    const productsResponse = await admin.graphql(`
      query getProducts {
        products(first: 50) {
          edges {
            node {
              id
              title
              featuredImage {
                url
              }
              variants(first: 1) {
                edges {
                  node {
                    price
                  }
                }
              }
            }
          }
        }
      }
    `);
    const productsData = await productsResponse.json();
    const allProducts = productsData.data?.products?.edges?.map(({ node }) => ({
      id: node.id,
      title: node.title,
      image: node.featuredImage?.url || "",
      price: node.variants.edges[0]?.node?.price || "0.00",
    })) || [];

    // Fetch all collections for the picker
    const collectionsResponse = await admin.graphql(`
      query getCollections {
        collections(first: 50) {
          edges {
            node {
              id
              title
              productsCount {
                count
              }
            }
          }
        }
      }
    `);
    const collectionsData = await collectionsResponse.json();
    const allCollections = collectionsData.data?.collections?.edges?.map(({ node }) => ({
      id: node.id,
      title: node.title,
      productCount: node.productsCount?.count || 0,
    })) || [];

    // Get upsell rules from DB
    const rules = await db.upsellRule.findMany({
      where: { shop: shopId },
      orderBy: { priority: 'asc' }
    });

    // If no rules, use default
    let config = DEFAULT_UPSELL_CONFIG;
    if (rules.length > 0) {
      // Reconstruct a config object that matches the structure expected by the UI
      // We'll map the first 3 rules to rule1, rule2, rule3 for compatibility
      const rule1 = rules.find(r => r.priority === 0) || rules[0];
      const rule2 = rules.find(r => r.priority === 1);
      const rule3 = rules.find(r => r.priority === 2);

      config = {
        ...DEFAULT_UPSELL_CONFIG,
        activeTemplate: rule1?.layout || UPSELL_STYLES.GRID,
        rule1: rule1 ? {
          enabled: rule1.enabled,
          upsellProducts: rule1.upsellProducts ? JSON.parse(rule1.upsellProducts) : [],
          upsellCollections: rule1.upsellCollections ? JSON.parse(rule1.upsellCollections) : [],
        } : DEFAULT_UPSELL_CONFIG.rule1,
        rule2: rule2 ? {
          enabled: rule2.enabled,
          triggerProducts: rule2.triggerProducts ? JSON.parse(rule2.triggerProducts) : [],
          triggerCollections: rule2.triggerCollections ? JSON.parse(rule2.triggerCollections) : [],
          upsellProducts: rule2.upsellProducts ? JSON.parse(rule2.upsellProducts) : [],
          upsellCollections: rule2.upsellCollections ? JSON.parse(rule2.upsellCollections) : [],
        } : DEFAULT_UPSELL_CONFIG.rule2,
        rule3: rule3 ? {
          enabled: rule3.enabled,
          cartValueThreshold: rule3.cartValueThreshold || 1000,
          upsellProducts: rule3.upsellProducts ? JSON.parse(rule3.upsellProducts) : [],
          upsellCollections: rule3.upsellCollections ? JSON.parse(rule3.upsellCollections) : [],
        } : DEFAULT_UPSELL_CONFIG.rule3,
      };
    }

    const response = {
      success: true,
      data: {
        config: config,
        allProducts,
        allCollections
      },
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      },
    });
  } catch (error) {
    console.error('Error in upsell loader:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Failed to retrieve upsell configuration',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

/**
 * POST /api/upsell
 * Save upsell configuration
 */
export async function action({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const shopId = session.shop;

    const body = await request.json();

    // Validate each rule individually
    const rulesToSave = [
      { id: `${shopId}-rule-1`, priority: 0, data: body.rule1, ruleType: 'GLOBAL' },
      { id: `${shopId}-rule-2`, priority: 1, data: body.rule2, ruleType: 'TRIGGERED' },
      { id: `${shopId}-rule-3`, priority: 2, data: body.rule3, ruleType: 'CART_CONDITIONS' },
    ];

    for (const rule of rulesToSave) {
      if (!rule.data) continue;

      const validation = validateUpsellRule(rule.data);
      if (!validation.valid) {
        return new Response(
          JSON.stringify({
            success: false,
            error: validation.error || `Invalid configuration for rule: ${rule.ruleType}`,
          }),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          }
        );
      }

      await db.upsellRule.upsert({
        where: { id: rule.id },
        update: {
          shop: shopId,
          enabled: rule.data.enabled ?? false,
          title: body.title || 'Recommended for you',
          ruleType: rule.ruleType,
          triggerProducts: rule.data.triggerProducts ? JSON.stringify(rule.data.triggerProducts) : null,
          triggerCollections: rule.data.triggerCollections ? JSON.stringify(rule.data.triggerCollections) : null,
          upsellProducts: rule.data.upsellProducts ? JSON.stringify(rule.data.upsellProducts) : null,
          upsellCollections: rule.data.upsellCollections ? JSON.stringify(rule.data.upsellCollections) : null,
          priority: rule.priority,
          layout: body.activeTemplate || 'grid',
          cartValueThreshold: rule.data.cartValueThreshold || 0,
        },
        create: {
          id: rule.id,
          shop: shopId,
          enabled: rule.data.enabled ?? false,
          title: body.title || 'Recommended for you',
          ruleType: rule.ruleType,
          triggerProducts: rule.data.triggerProducts ? JSON.stringify(rule.data.triggerProducts) : null,
          triggerCollections: rule.data.triggerCollections ? JSON.stringify(rule.data.triggerCollections) : null,
          upsellProducts: rule.data.upsellProducts ? JSON.stringify(rule.data.upsellProducts) : null,
          upsellCollections: rule.data.upsellCollections ? JSON.stringify(rule.data.upsellCollections) : null,
          priority: rule.priority,
          layout: body.activeTemplate || 'grid',
          cartValueThreshold: rule.data.cartValueThreshold || 0,
        }
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Upsell configuration saved successfully to DB',
        data: {
          config: body,
          products: getProductsByIds(collectUpsellProductIds(body)),
        },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error in upsell action:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Failed to save upsell configuration',
        details: error.message,
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}
