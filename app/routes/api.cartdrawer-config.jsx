import { authenticate } from "../shopify.server";
import { getStoredCoupons } from "./api.create_coupon-sample";
import { promises as fs } from "fs";
import path from "path";

// ---------------- EXTERNAL API ----------------
// Single source of truth for the external PHP backend URL.
// Update this when the ngrok tunnel URL changes.
const EXTERNAL_CART_API = "https://int.thecartninja.com/save_cart_drawer.php";

// Local fallback persistence (used when external API is unavailable or incomplete)
const LOCAL_DATA_FILE = path.resolve("cartdrawer-config-data.json");

function normalizeShopDomain(shopDomain) {
    return (shopDomain || "").toString().trim().toLowerCase();
}

async function readLocalConfigMap() {
    try {
        const raw = await fs.readFile(LOCAL_DATA_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

async function writeLocalConfigMap(map) {
    await fs.writeFile(LOCAL_DATA_FILE, JSON.stringify(map, null, 2));
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

    // Strip any accidental top-level AI key fields.
    const safeTopLevel = stripLegacyAiKeysFromObject(out);
    const base = safeTopLevel || out;

    // Strip legacy AI key fields nested inside upsell config payloads.
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

    // Never expose any AI/OpenAI API keys to the frontend (legacy data may contain them).
    const safeUpsellData = stripLegacyAiKeysFromObject(upsellData) || {};

    // Map DB status flags to enabled booleans
    const progressEnabled = dbData.progress_status === 1 || dbData.progress_status === "1" || dbData.progress_status === true;
    const couponEnabled = dbData.coupon_status === 1 || dbData.coupon_status === "1" || dbData.coupon_status === true;
    const upsellEnabled = dbData.upsell_status === 1 || dbData.upsell_status === "1" || dbData.upsell_status === true;

    // Support both cartStatus and cart_status from DB
    const cartActive = dbData.cartStatus === 1 || dbData.cartStatus === "1" || dbData.cartStatus === true ||
        dbData.cart_status === 1 || dbData.cart_status === "1" || dbData.cart_status === true;

    // Build settings in the format the frontend expects
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
        // Checkout button & custom CSS — top-level fields in DB response
        checkoutName: dbData.checkoutName || 'Checkout Now',
        checkoutFooterText: dbData.checkoutFooterText || 'Shipping and taxes calculated at checkout',
        customCSS: dbData.customCSS || '',
        checkout_button_style: dbData.checkout_button_style || null,
    };

    // Extract coupon selections if present in coupon_data
    const couponSelections = {
        selectedCouponIds: couponData.selectedActiveCoupons || [],
        couponOverrides: couponData.couponOverrides || {},
        allCouponDetails: couponData.allCouponDetails || [],
    };

    return {
        settings,
        couponSelections,
        cartActive,
        shop: dbData.shop || dbData.shopDomain || ""
    };
}

// In-memory store for cart drawer settings (per-shop, used as fallback in loader)
const savedSettingsMap = new Map();

// ---------------- LOADER ----------------
export async function loader({ request }) {
    const url = new URL(request.url);
    const shopDomain = url.searchParams.get("shop") || url.searchParams.get("shopdomain") || "";
    const shopKey = normalizeShopDomain(shopDomain);

    // Local fallback config (per-shop)
    const localConfigMap = shopKey ? await readLocalConfigMap() : {};
    const localDbData = shopKey && localConfigMap[shopKey] ? localConfigMap[shopKey] : null;

    const storedCoupons = await getStoredCoupons(shopDomain);

    // Try to fetch from Shopify API if authenticated
    let shopifyProducts = [];
    let shopifyCollections = [];

    try {
        const { admin } = await authenticate.admin(request);

        if (admin) {
            // Fetch Products
            const productQuery = `
              query {
                products(first: 50) {
                  edges {
                    node {
                      id
                      title
                                            productType
                                            vendor
                                            tags
                      status
                      totalInventory
                      featuredImage { url }
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
        console.warn("Shopify API authentication failed, using mock fallback:", e.message);
    }

    // Map stored coupons to the format app.cartdrawer.jsx expects
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

    // If no shopDomain, return defaults
    if (!shopDomain) {
        console.warn("No shop domain provided to sample API loader, returning defaults");
        return Response.json({
            success: true,
            settings: { ...DEFAULT_SETTINGS },
            cartStatus: false,
            cartData: { ...DEFAULT_CART_DATA },
            coupons: formattedCoupons
        });
    }

    try {
        const apiUrl = `${EXTERNAL_CART_API}?shopdomain=${encodeURIComponent(shopDomain)}`;
        console.log("Fetching cart drawer config from:", apiUrl);

        const extRes = await fetch(apiUrl, {
            method: "GET",
            headers: { "ngrok-skip-browser-warning": "true" },
        });

        const extBody = await extRes.json();
        console.log(`External Cart API GET response [${extRes.status}]:`, JSON.stringify(extBody));
        if (extBody.status === "success" && extBody.data) {
            const { settings, couponSelections, cartActive } = transformFromDB(extBody.data);

            // If the external API returns an apparently empty selection but we have a locally-saved
            // selection, prefer the local data so the admin UI reflects the last saved state.
            if (
                (!couponSelections?.selectedCouponIds || couponSelections.selectedCouponIds.length === 0) &&
                localDbData
            ) {
                const localTransformed = transformFromDB(localDbData);
                if (localTransformed?.couponSelections?.selectedCouponIds?.length) {
                    return Response.json({
                        success: true,
                        settings: localTransformed.settings,
                        couponSelections: localTransformed.couponSelections,
                        cartStatus: localTransformed.cartActive,
                        cartData: { ...DEFAULT_CART_DATA },
                        coupons: formattedCoupons,
                        shopifyProducts,
                        shopifyCollections
                    });
                }
            }
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
        } else {
            console.warn("External Cart API returned non-success, using defaults");
            if (localDbData) {
                const localTransformed = transformFromDB(localDbData);
                return Response.json({
                    success: true,
                    settings: localTransformed.settings,
                    couponSelections: localTransformed.couponSelections,
                    cartStatus: localTransformed.cartActive,
                    cartData: { ...DEFAULT_CART_DATA },
                    coupons: formattedCoupons,
                    shopifyProducts,
                    shopifyCollections
                });
            }

            const memCached = savedSettingsMap.get(shopKey);
            if (memCached) {
                const localTransformed = transformFromDB(memCached);
                return Response.json({
                    success: true,
                    settings: localTransformed.settings,
                    couponSelections: localTransformed.couponSelections,
                    cartStatus: localTransformed.cartActive,
                    cartData: { ...DEFAULT_CART_DATA },
                    coupons: formattedCoupons,
                    shopifyProducts,
                    shopifyCollections
                });
            }

            return Response.json({
                success: true,
                settings: { ...DEFAULT_SETTINGS },
                cartData: { ...DEFAULT_CART_DATA },
                coupons: formattedCoupons,
                shopifyProducts,
                shopifyCollections
            });
        }
    } catch (error) {
        console.error("Failed to fetch from external Cart API:", error.message);
        if (localDbData) {
            const localTransformed = transformFromDB(localDbData);
            return Response.json({
                success: true,
                settings: localTransformed.settings,
                couponSelections: localTransformed.couponSelections,
                cartStatus: localTransformed.cartActive,
                cartData: { ...DEFAULT_CART_DATA },
                coupons: formattedCoupons,
                shopifyProducts,
                shopifyCollections
            });
        }

        const memCached2 = savedSettingsMap.get(shopKey);
        if (memCached2) {
            const localTransformed = transformFromDB(memCached2);
            return Response.json({
                success: true,
                settings: localTransformed.settings,
                couponSelections: localTransformed.couponSelections,
                cartStatus: localTransformed.cartActive,
                cartData: { ...DEFAULT_CART_DATA },
                coupons: formattedCoupons,
                shopifyProducts,
                shopifyCollections
            });
        }

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
        return Response.json(
            { error: "Method not allowed" },
            { status: 405 }
        );
    }

    try {
        const rawData = await request.json();
        const data = sanitizeIncomingCartDrawerPayload(rawData);

        console.log("------------------------------------------");
        console.log("RECEIVED DATA ON SAMPLE API:");
        console.log(JSON.stringify(data, null, 2));
        console.log("------------------------------------------");

        // Normalize shop identifier for local persistence and external API.
        // Prefer the authenticated session's shop when available.
        let sessionShop = "";
        try {
            const auth = await authenticate.admin(request);
            sessionShop = auth?.session?.shop || "";
        } catch {
            // If not authenticated, fall back to header/body.
        }

        const headerShop = request.headers.get("X-Shop-ID") || "";
        const rawShop = sessionShop || headerShop || data.shop || data.shopDomain || data.Id || "";
        const shopKey = normalizeShopDomain(rawShop);
        const payload = {
            ...data,
            shop: rawShop,
            shopDomain: rawShop, // Send both to satisfy different PHP backend versions
        };

        // Save to in-memory store (fast refresh fallback)
        if (shopKey) savedSettingsMap.set(shopKey, payload);

        // Save to local JSON file (refresh + server restart fallback)
        if (shopKey) {
            try {
                const map = await readLocalConfigMap();
                map[shopKey] = payload;
                await writeLocalConfigMap(map);
            } catch (fileErr) {
                console.warn("Failed to persist cart drawer config locally:", fileErr.message);
            }
        } else {
            console.warn("No shop domain found in payload. Local persistence skipped.");
        }

        // Forward to external PHP endpoint (required for storefront)
        let externalOk = false;
        let externalStatus = null;
        let externalResult = null;
        let externalError = null;

        try {
            const externalResponse = await fetch(EXTERNAL_CART_API, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                body: JSON.stringify({
                    ...payload,
                    shop: rawShop,
                    shopDomain: rawShop,
                })
            });

            externalStatus = externalResponse.status;

            const externalText = await externalResponse.text();
            let parsed = null;
            try {
                parsed = externalText ? JSON.parse(externalText) : null;
            } catch {
                parsed = null;
            }

            externalResult = parsed ?? externalText;

            const externalBodyOk =
                parsed && typeof parsed === "object"
                    ? (parsed.status === "success")
                    : externalResponse.ok;

            externalOk = Boolean(externalResponse.ok && externalBodyOk);

            if (externalOk) {
                console.log("External sync successful:", externalResult);
            } else {
                externalError =
                    (parsed && (parsed.message || parsed.error)) ||
                    externalText ||
                    `External sync failed (HTTP ${externalResponse.status})`;
                console.warn(`External sync failed (${externalResponse.status}):`, externalError);
            }
        } catch (externalErr) {
            externalError = externalErr.message;
            console.warn("External sync unavailable (data saved locally):", externalErr.message);
        }

        // The storefront reads from the external DB via App Proxy.
        // If external sync fails, treat the save as failed (but keep local fallback).
        if (!externalOk) {
            return Response.json(
                {
                    success: false,
                    error: externalError
                        ? `External DB sync failed: ${externalError}`
                        : "External DB sync failed — storefront will not update until this succeeds.",
                    shop: rawShop,
                    localSaved: true,
                    externalOk,
                    externalStatus,
                    external: externalResult,
                    externalError,
                    receivedAt: new Date().toISOString(),
                },
                { status: 502 }
            );
        }

        return Response.json({
            success: true,
            message: "Configuration saved successfully",
            shop: rawShop,
            localSaved: true,
            externalOk,
            externalStatus,
            external: externalResult,
            externalError,
            receivedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error("Sample API Critical Error:", error);
        return Response.json(
            { success: false, error: error.message || "Failed to parse request" },
            { status: 400 }
        );
    }
}