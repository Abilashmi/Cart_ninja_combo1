import db from "../db.server";
import { authenticate } from "../shopify.server";
import { FAKE_COUPON_CONFIG, FAKE_FBT_CONFIG } from "./product-widget.shared.js";

/**
 * Fetch product widget settings from the database
 */
export async function getProductWidgetData(request) {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;

    // 1. Fetch products from Shopify
    let products = [];
    try {
        const response = await admin.graphql(`
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
        const data = await response.json();
        products = data.data?.products?.edges?.map(({ node }) => ({
            id: node.id,
            title: node.title,
            image: node.featuredImage?.url || "",
            price: node.variants.edges[0]?.node?.price || "0.00",
        })) || [];
    } catch (e) {
        console.error("Failed to fetch products:", e);
    }

    // 2. Fetch settings from DB
    let couponConfig = FAKE_COUPON_CONFIG;
    let fbtConfig = FAKE_FBT_CONFIG;

    try {
        const settings = await db.widgetSettings.findUnique({
            where: { shop }
        });

        if (settings) {
            if (settings.coupons) couponConfig = JSON.parse(settings.coupons);
            if (settings.fbt) fbtConfig = JSON.parse(settings.fbt);
        }
    } catch (e) {
        console.error("Failed to fetch settings from DB:", e);
    }

    return {
        couponConfig,
        fbtConfig,
        products,
    };
}

/**
 * Save product widget settings to the database
 */
export async function saveProductWidgetData(request) {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;
    const formData = await request.formData();
    const actionType = formData.get("actionType");

    if (actionType === "saveCouponConfig") {
        // Accept all coupon config fields
        const activeTemplate = formData.get("activeTemplate");
        const templateData = formData.get("templateData");
        const selectedActiveCoupons = formData.get("selectedActiveCoupons");
        const couponOverrides = formData.get("couponOverrides");

        if (!activeTemplate || !templateData) {
            return { success: false, error: "Missing required fields" };
        }

        try {
            const parsedTemplates = JSON.parse(templateData);
            // selectedActiveCoupons and couponOverrides may be undefined/null if not sent
            const parsedSelectedActiveCoupons = selectedActiveCoupons ? JSON.parse(selectedActiveCoupons) : [];
            const parsedCouponOverrides = couponOverrides ? JSON.parse(couponOverrides) : {};
            // Save full config
            const couponConfig = {
                activeTemplate,
                templates: parsedTemplates,
                selectedActiveCoupons: parsedSelectedActiveCoupons,
                couponOverrides: parsedCouponOverrides
            };

            await db.widgetSettings.upsert({
                where: { shop },
                update: { coupons: JSON.stringify(couponConfig) },
                create: {
                    shop,
                    coupons: JSON.stringify(couponConfig),
                    fbt: JSON.stringify(FAKE_FBT_CONFIG)
                }
            });

            return { success: true, message: "Coupon configuration saved successfully!" };
        } catch (e) {
            console.error("DB Save Failure (Coupon):", e);
            return { success: false, error: "Failed to save to database" };
        }
    }

    if (actionType === "saveFBTConfig") {
        const mode = formData.get("mode");
        const configData = formData.get("configData");
        const activeTemplate = formData.get("activeTemplate");
        const openaiKey = formData.get("openaiKey");
        const templateData = formData.get("templateData");

        if (!mode || !["manual", "ai"].includes(mode)) {
            return { success: false, error: "Invalid mode" };
        }

        if (mode === "ai" && (!openaiKey || openaiKey.trim() === "")) {
            return { success: false, error: "An API key is required for AI mode" };
        }

        try {
            const fbtConfig = {
                activeTemplate,
                mode,
                openaiKey,
                templates: JSON.parse(templateData),
                manualRules: configData ? JSON.parse(configData) : []
            };

            await db.widgetSettings.upsert({
                where: { shop },
                update: { fbt: JSON.stringify(fbtConfig) },
                create: {
                    shop,
                    fbt: JSON.stringify(fbtConfig),
                    coupons: JSON.stringify(FAKE_COUPON_CONFIG)
                }
            });

            return { success: true, message: "FBT configuration saved successfully!" };
        } catch (e) {
            console.error("DB Save Failure (FBT):", e);
            return { success: false, error: "Failed to save to database" };
        }
    }

    return { success: false, error: "Unknown action type" };
}
