import { authenticate } from "../shopify.server";
import { getStoredCoupons } from "./api.create_coupon-sample";
import { getDb } from "../services/db.server";

function normalizeShopDomain(shopDomain) {
    return (shopDomain || "").toString().trim().toLowerCase();
}

// ---------------- DEFAULTS ----------------
const DEFAULT_SETTINGS = {
    progressBar: {
        enabled: false,
        mode: "amount",
        showOnEmpty: true,
        barBackgroundColor: "#e2e8f0",
        barForegroundColor: "#2563eb",
        iconColor: "#2563eb",
        fill_gradient: "",
        borderRadius: 8,
        completionText: "🎉 You've unlocked free shipping!",
        maxTarget: 1000,
        placement: "top",
        tiers: [
            {
                id: 1,
                minValue: 500,
                minQuantity: 3,
                description: "Free Shipping",
                products: [],
                rewardType: 'product',
                iconType: 'preset',
                iconPreset: 'gift',
                iconCustomSvg: ''
            }
        ]
    },
    coupons: {
        enabled: false,
        selectedStyle: "style-2",
        position: "top",
        layout: "grid",
        alignment: "horizontal",
        title: {
            text: "Apply Coupon",
            fontSize: 14,
            textColor: "#1e293b",
            alignment: "left"
        }
    },
    upsell: {
        enabled: false,
        upsellMode: 'manual',
        upsellTitle: { text: "Frequently Bought Together", color: "#111827" },
        manualRules: [],
        activeTemplate: 'grid'
    }
};

const DEFAULT_CART_DATA = {
    cartValue: 0,
    totalQuantity: 0,
    items: [],
};

function stripLegacyAiKeysFromObject(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    const out = { ...obj };
    delete out.aiApiKey;
    delete out.apiKey;
    delete out.openaiKey;
    delete out.openai_api_key;
    delete out.OPENAI_API_KEY;
    delete out.OPENAI_KEY;
    return out;
}

function sanitizeUpsellDataField(value) {
    if (!value) return value;
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            const safeObj = stripLegacyAiKeysFromObject(parsed);
            if (!safeObj) return value;
            return JSON.stringify(safeObj);
        } catch {
            return value;
        }
    }
    if (typeof value === "object") {
        const safeObj = stripLegacyAiKeysFromObject(value);
        return safeObj || value;
    }
    return value;
}

function sanitizeIncomingCartDrawerPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
    const out = { ...payload };
    const safeTopLevel = stripLegacyAiKeysFromObject(out);
    const base = safeTopLevel || out;
    if (Object.prototype.hasOwnProperty.call(base, "upsell_data")) {
        base.upsell_data = sanitizeUpsellDataField(base.upsell_data);
    }
    if (Object.prototype.hasOwnProperty.call(base, "upsellData")) {
        base.upsellData = sanitizeUpsellDataField(base.upsellData);
    }
    return base;
}

// ---------------- TRANSFORM FROM DB ----------------
function transformFromDB(dbData) {
    const parseJSON = (val) => {
        if (!val) return {};
        if (typeof val === "object") return val;
        try { return JSON.parse(val); } catch { return {}; }
    };

    const progressData = parseJSON(dbData.progress_data);
    const couponData = parseJSON(dbData.coupon_data);
    const upsellData = parseJSON(dbData.upsell_data);
    const safeUpsellData = stripLegacyAiKeysFromObject(upsellData) || {};

    const progressEnabled = dbData.progress_status === 1 || dbData.progress_status === "1" || dbData.progress_status === true;
    const couponEnabled = dbData.coupon_status === 1 || dbData.coupon_status === "1" || dbData.coupon_status === true;
    const upsellEnabled = dbData.upsell_status === 1 || dbData.upsell_status === "1" || dbData.upsell_status === true;
    const cartActive = dbData.cartStatus === 1 || dbData.cartStatus === "1" || dbData.cartStatus === true ||
        dbData.cart_status === 1 || dbData.cart_status === "1" || dbData.cart_status === true;

    const settings = {
        progressBar: {
            ...DEFAULT_SETTINGS.progressBar,
            ...progressData,
            enabled: progressEnabled,
            mode: progressData.mode || DEFAULT_SETTINGS.progressBar.mode,
            iconColor: progressData.iconColor || progressData.icon_color || progressData.barForegroundColor || DEFAULT_SETTINGS.progressBar.iconColor,
            placement: progressData.placement || DEFAULT_SETTINGS.progressBar.placement,
            tiers: (progressData.tiers || DEFAULT_SETTINGS.progressBar.tiers).map(tier => ({
                ...tier,
                minQuantity: tier.minQuantity || 1,
                iconType: tier.iconType || 'preset',
                iconPreset: tier.iconPreset || 'gift',
                iconCustomSvg: tier.iconCustomSvg || ''
            }))
        },
        coupons: {
            ...DEFAULT_SETTINGS.coupons,
            enabled: couponEnabled,
            selectedStyle: couponData.style || couponData.selectedStyle || DEFAULT_SETTINGS.coupons.selectedStyle,
            position: couponData.position || DEFAULT_SETTINGS.coupons.position,
            layout: couponData.layout || DEFAULT_SETTINGS.coupons.layout,
            alignment: couponData.alignment || DEFAULT_SETTINGS.coupons.alignment,
            title: {
                text:
                    (couponData.title && typeof couponData.title === 'object' ? couponData.title.text : null) ||
                    couponData.titleText ||
                    DEFAULT_SETTINGS.coupons.title.text,
                fontSize:
                    Number(
                        (couponData.title && typeof couponData.title === 'object'
                            ? (couponData.title.fontSize ?? couponData.title.font_size)
                            : null) ??
                        couponData.titleFontSize ??
                        couponData.title_font_size
                    ) || DEFAULT_SETTINGS.coupons.title.fontSize,
                textColor:
                    (couponData.title && typeof couponData.title === 'object' ? couponData.title.textColor : null) ||
                    couponData.titleTextColor ||
                    DEFAULT_SETTINGS.coupons.title.textColor,
                alignment:
                    (couponData.title && typeof couponData.title === 'object' ? couponData.title.alignment : null) ||
                    couponData.titleAlignment ||
                    DEFAULT_SETTINGS.coupons.title.alignment,
            },
        },
        upsell: {
            ...DEFAULT_SETTINGS.upsell,
            ...safeUpsellData,
            enabled: upsellEnabled,
        },
        checkoutName: dbData.checkoutName || 'Checkout Now',
        checkoutFooterText: dbData.checkoutFooterText || 'Shipping and taxes calculated at checkout',
        customCSS: dbData.customCSS || '',
        checkout_button_style: dbData.checkout_button_style || null,
    };

    const couponSelections = {
        selectedCouponIds: couponData.selectedActiveCoupons || [],
        couponOverrides: couponData.couponOverrides || {},
        allCouponDetails: couponData.allCouponDetails || [],
    };

    return { settings, couponSelections, cartActive, shop: dbData.shop || dbData.shopDomain || "" };
}

// ---------------- LOADER ----------------
export async function loader({ request }) {
    const url = new URL(request.url);
    const shopDomain = url.searchParams.get("shop") || url.searchParams.get("shopdomain") || "";
    const shopKey = normalizeShopDomain(shopDomain);

    const storedCoupons = await getStoredCoupons(shopDomain);

    let shopifyProducts = [];
    let shopifyCollections = [];

    try {
        const { admin } = await authenticate.admin(request);
        if (admin) {
            const productQuery = `
              query {
                products(first: 50) {
                  edges {
                    node {
                      id title productType vendor tags status totalInventory
                      featuredImage { url }
                      variants(first: 1) { edges { node { price } } }
                    }
                  }
                }
                collections(first: 50) {
                  edges {
                    node { id title productsCount { count } }
                  }
                }
              }
            `;
            const gqlRes = await admin.graphql(productQuery);
            const gqlData = await gqlRes.json();
            if (gqlData.data) {
                shopifyProducts = (gqlData.data.products?.edges || []).map(({ node }) => ({
                    id: node.id,
                    title: node.title,
                    status: (node.status || '').toLowerCase(),
                    price: node.variants.edges[0]?.node.price || "0.00",
                    image: node.featuredImage?.url || "📦",
                    inventory: node.totalInventory,
                    productType: node.productType || "",
                    vendor: node.vendor || "",
                    tags: Array.isArray(node.tags) ? node.tags : [],
                }));
                shopifyCollections = (gqlData.data.collections?.edges || []).map(({ node }) => ({
                    id: node.id,
                    title: node.title,
                    productCount: node.productsCount?.count || 0
                }));
            }
        }
    } catch (e) {
        console.warn("Shopify API auth failed:", e.message);
    }

    const formattedCoupons = storedCoupons.map(c => ({
        id: c.id,
        code: c.code,
        heading: c.title || c.code,
        subtext: c.type === 'amount_off_order' ? 'Order Discount' : 'Product Discount',
        discountType: c.valueType === 'percentage' ? 'percentage' : 'fixed',
        discountValue: parseFloat(c.value || 0),
        ends_at: c.endDate,
        status: 'ACTIVE'
    }));

    if (!shopKey) {
        return Response.json({
            success: true,
            settings: { ...DEFAULT_SETTINGS },
            cartStatus: false,
            cartData: { ...DEFAULT_CART_DATA },
            coupons: formattedCoupons
        });
    }

    try {
        const db = getDb();
        const [rows] = await db.execute(
            'SELECT * FROM cart_drawer WHERE shop = ? LIMIT 1',
            [shopKey]
        );

        if (rows.length > 0) {
            const { settings, couponSelections, cartActive } = transformFromDB(rows[0]);
            return Response.json({
                success: true,
                settings,
                couponSelections,
                cartStatus: cartActive,
                cartData: { ...DEFAULT_CART_DATA },
                coupons: formattedCoupons,
                shopifyProducts,
                shopifyCollections
            });
        }

        // No record yet — return defaults
        return Response.json({
            success: true,
            settings: { ...DEFAULT_SETTINGS },
            cartStatus: false,
            cartData: { ...DEFAULT_CART_DATA },
            coupons: formattedCoupons,
            shopifyProducts,
            shopifyCollections
        });

    } catch (error) {
        console.error("DB read failed:", error.message);
        return Response.json({
            success: true,
            settings: { ...DEFAULT_SETTINGS },
            cartData: { ...DEFAULT_CART_DATA },
            coupons: formattedCoupons,
            shopifyProducts,
            shopifyCollections
        });
    }
}

// ---------------- ACTION ----------------
export async function action({ request }) {
    if (request.method !== "POST") {
        return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    try {
        const rawData = await request.json();
        const data = sanitizeIncomingCartDrawerPayload(rawData);

        let sessionShop = "";
        try {
            const auth = await authenticate.admin(request);
            sessionShop = auth?.session?.shop || "";
        } catch {}

        const headerShop = request.headers.get("X-Shop-ID") || "";
        const rawShop = sessionShop || headerShop || data.shop || data.shopDomain || data.Id || "";
        const shopKey = normalizeShopDomain(rawShop);

        if (!shopKey) {
            return Response.json({ success: false, error: "No shop domain provided" }, { status: 400 });
        }

        // Normalize field names (support both snake_case and camelCase from frontend)
        const progressData = data.progress_data ?? data.progressData ?? null;
        const couponData = data.coupon_data ?? data.couponData ?? null;
        const upsellData = data.upsell_data ?? data.upsellData ?? null;
        const progressStatus = data.progress_status ?? data.progressStatus ?? 0;
        const couponStatus = data.coupon_status ?? data.couponStatus ?? 0;
        const upsellStatus = data.upsell_status ?? data.upsellStatus ?? 0;
        const cartStatus = data.cartStatus ?? data.cart_status ?? 1;

        const toJson = (val) => {
            if (!val) return null;
            if (typeof val === "string") return val;
            return JSON.stringify(val);
        };

        const toBool = (val) => (val === true || val === 1 || val === "1") ? 1 : 0;

        const db = getDb();
        await db.execute(
            `INSERT INTO cart_drawer
                (shop, cartStatus, progress_data, coupon_data, upsell_data,
                 progress_status, coupon_status, upsell_status,
                 checkoutName, checkoutFooterText, customCSS, checkout_button_style, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
             ON DUPLICATE KEY UPDATE
                cartStatus = VALUES(cartStatus),
                progress_data = VALUES(progress_data),
                coupon_data = VALUES(coupon_data),
                upsell_data = VALUES(upsell_data),
                progress_status = VALUES(progress_status),
                coupon_status = VALUES(coupon_status),
                upsell_status = VALUES(upsell_status),
                checkoutName = VALUES(checkoutName),
                checkoutFooterText = VALUES(checkoutFooterText),
                customCSS = VALUES(customCSS),
                checkout_button_style = VALUES(checkout_button_style),
                updated_at = CURRENT_TIMESTAMP(3)`,
            [
                shopKey,
                toBool(cartStatus),
                toJson(progressData),
                toJson(couponData),
                toJson(upsellData),
                toBool(progressStatus),
                toBool(couponStatus),
                toBool(upsellStatus),
                data.checkoutName || null,
                data.checkoutFooterText || null,
                data.customCSS || null,
                data.checkout_button_style || null,
            ]
        );

        return Response.json({
            success: true,
            message: "Configuration saved successfully",
            shop: shopKey,
        });

    } catch (error) {
        console.error("Cart drawer save failed:", error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
}
