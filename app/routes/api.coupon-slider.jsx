import { promises as fs } from "fs";
import path from "path";

const EXTERNAL_API = "https://blueviolet-clam-512487.hostingersite.com/save_coupon_slider_widget.php";

const DATA_FILE = path.resolve("coupon-slider-data.json");

/* ---------------- DEFAULTS ---------------- */
const DEFAULT_DATA = {
    activeTemplate: "template1",
    templates: {
        template1: {
            name: "Classic Banner",
            headingText: "GET 10% OFF!",
            subtextText: "Use code: SAVE10 at checkout",
            bgColor: "#ffffff",
            textColor: "#1a1a1a",
            accentColor: "#2563eb",
            buttonColor: "#2563eb",
            buttonTextColor: "#ffffff",
            borderRadius: 12,
            fontSize: 16,
            padding: 16,
            borderColor: "#e2e8f0",
            priceColor: "#1a1a1a",
            showPrices: true,
            showAddAllButton: false,
            interactionType: "copy",
            layout: "horizontal"
        },
        template2: {
            name: "Minimal Card",
            headingText: "SPECIAL OFFER",
            subtextText: "Free shipping on orders over ₹500",
            bgColor: "#f9fafb",
            textColor: "#374151",
            accentColor: "#10b981",
            buttonColor: "#10b981",
            buttonTextColor: "#ffffff",
            borderRadius: 8,
            fontSize: 14,
            padding: 14,
            borderColor: "#e5e7eb",
            priceColor: "#374151",
            showPrices: true,
            showAddAllButton: false,
            interactionType: "copy",
            layout: "horizontal"
        },
        template3: {
            name: "Bold & Vibrant",
            headingText: "FLASH SALE!",
            subtextText: "Use code: BOLD25 for extra 25% OFF",
            bgColor: "#4f46e5",
            textColor: "#ffffff",
            accentColor: "#f59e0b",
            buttonColor: "#f59e0b",
            buttonTextColor: "#111827",
            borderRadius: 16,
            fontSize: 18,
            padding: 20,
            borderColor: "#6366f1",
            priceColor: "#ffffff",
            showPrices: true,
            showAddAllButton: false,
            interactionType: "copy",
            layout: "horizontal"
        },
        template4: {
            name: "Modern Gradient",
            headingText: "Inherit",
            subtextText: "Free shipping on orders over ₹500",
            bgColor: "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)",
            textColor: "#ffffff",
            accentColor: "#fbbf24",
            buttonColor: "#fbbf24",
            buttonTextColor: "#000000",
            borderRadius: 20,
            fontSize: 16,
            padding: 20,
            borderColor: "transparent",
            priceColor: "#ffffff",
            showPrices: true,
            showAddAllButton: false,
            interactionType: "apply",
            layout: "horizontal"
        },
    },
    selectedActiveCoupons: [],
    couponOverrides: {},
};

/* ---------------- FILE HELPERS ---------------- */

async function readData() {
    try {
        const raw = await fs.readFile(DATA_FILE, "utf-8");
        return JSON.parse(raw);
    } catch {
        return { ...DEFAULT_DATA };
    }
}

async function writeData(data) {
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

/* ---------- TRANSFORM FROM DB RESPONSE ---------- */

function transformFromDB(dbData) {
    // Parse style JSON strings back into objects
    const parseJSON = (val) => {
        if (!val) return {};
        if (typeof val === "object") return val;
        try { return JSON.parse(val); } catch { return {}; }
    };

    // More robust array parsing to handle potential truncation
    const parseJSONArray = (val) => {
        if (!val) return [];
        if (Array.isArray(val)) return val;
        if (typeof val !== "string") return [];

        try {
            return JSON.parse(val);
        } catch {
            // If it's a truncated JSON string (e.g. ["gid://...","g), try to extract what we can
            // Matches DiscountCodeNode, DiscountAutomaticNode, or just DiscountNode
            // We use [\/\\]+ to handle both normal and escaped slashes in the raw string
            const matches = val.match(/gid:[\/\\]+shopify[\/\\]+(DiscountCodeNode|DiscountAutomaticNode|DiscountNode)[\/\\]+\d+/g);
            if (matches) {
                // Return cleaned IDs (replace backslashes with forward slashes for consistency)
                return matches.map(id => id.replace(/\\/g, '/'));
            }
            return [];
        }
    };

    const temp1Style = parseJSON(dbData.temp1DefaultStyle);
    const temp2Style = parseJSON(dbData.temp2DefaultStyle);
    const temp3Style = parseJSON(dbData.temp3DefaultStyle);

    const temp1CouponStyle = parseJSON(dbData.temp1CouponStyle);
    const temp2CouponStyle = parseJSON(dbData.temp2CouponStyle);
    const temp3CouponStyle = parseJSON(dbData.temp3CouponStyle);

    const temp1CouponCondition = parseJSONArray(dbData.temp1CouponCondition);
    const temp2CouponCondition = parseJSONArray(dbData.temp2CouponCondition);
    const temp3CouponCondition = parseJSONArray(dbData.temp3CouponCondition);

    const activeTemplate = dbData.selectedTemplate || "template1";

    // Build templates object with DEEP merging of defaults
    const templates = {
        template1: {
            ...DEFAULT_DATA.templates.template1,
            ...temp1Style,
        },
        template2: {
            ...DEFAULT_DATA.templates.template2,
            ...temp2Style,
        },
        template3: {
            ...DEFAULT_DATA.templates.template3,
            ...temp3Style,
        },
        template4: {
            ...DEFAULT_DATA.templates.template4,
            ...parseJSON(dbData.temp4DefaultStyle),
        },
    };

    // Build couponOverrides by merging style overrides and conditions
    const couponStyleMap = {
        template1: temp1CouponStyle,
        template2: temp2CouponStyle,
        template3: temp3CouponStyle,
        template4: parseJSON(dbData.temp4CouponStyle),
    };
    const couponConditionMap = {
        template1: temp1CouponCondition,
        template2: temp2CouponCondition,
        template3: temp3CouponCondition,
        template4: parseJSONArray(dbData.temp4CouponCondition),
    };

    const activeCouponStyles = couponStyleMap[activeTemplate] || {};
    const activeCouponConditions = couponConditionMap[activeTemplate] || [];

    // Consolidate Selected Coupons:
    // Some fields might be truncated in the DB (like selectedTemplateCoupon).
    // We merge IDs from:
    // 1. selectedTemplateCoupon (primary list)
    // 2. IDs present in active template's style overrides
    // 3. IDs present in active template's conditions
    // Support both old string format ["gid://..."] and new object format [{id,code}]
    const rawSelectedItems = parseJSONArray(dbData.selectedTemplateCoupon);
    const embeddedCodes = {};
    const embeddedHeadings = {};
    const embeddedSubtexts = {};
    const idsFromSelected = rawSelectedItems.map(item => {
        if (item && typeof item === 'object') {
            const itemId = item.id || '';
            if (itemId && item.code) embeddedCodes[itemId] = item.code;
            if (itemId && item.h !== undefined) embeddedHeadings[itemId] = item.h;
            if (itemId && item.s !== undefined) embeddedSubtexts[itemId] = item.s;
            return itemId;
        }
        return item;
    }).filter(Boolean);
    const idsFromStyles = Object.keys(activeCouponStyles);
    const idsFromConditions = activeCouponConditions.map(c => c.couponId).filter(Boolean);

    // ID Reconciliation: Prefer full IDs over truncated ones
    const allFullIds = [...new Set([...idsFromStyles, ...idsFromConditions])];

    // Normalize a GID to single forward slashes
    const normalizeId = (id) => id.replace(/\\/g, '/').replace(/\/+/g, '/');

    const reconciledSelected = idsFromSelected.map(rawId => {
        const id = normalizeId(rawId);
        // Find if this truncated ID matches the start of any full ID
        const match = allFullIds.find(f => normalizeId(f).startsWith(id) || id.startsWith(normalizeId(f)));
        return match || id;
    });

    // Combine and deduplicate
    const selectedCoupons = [...new Set([...reconciledSelected, ...allFullIds])];

    const couponOverrides = {};
    for (const rawCouponId of selectedCoupons) {
        const couponId = normalizeId(rawCouponId);
        const styleOv = activeCouponStyles[rawCouponId] || activeCouponStyles[couponId] || {};
        const conditionEntry = activeCouponConditions.find(c => normalizeId(c.couponId || "") === couponId) || {};

        const override = { ...styleOv };

        // Map headingText -> label and subtextText -> description for the liquid block
        if (styleOv.headingText) override.label = styleOv.headingText;
        if (styleOv.subtextText) override.description = styleOv.subtextText;

        // Embedded data from selectedTemplateCoupon (most reliable PHP storage)
        // Skip codes that are purely numeric — those are GID tails saved by mistake, not real coupon codes
        const embedded = embeddedCodes[rawCouponId] || embeddedCodes[couponId];
        if (embedded && !/^\d+$/.test(embedded)) override.couponCode = embedded;
        const embH = embeddedHeadings[rawCouponId] ?? embeddedHeadings[couponId];
        if (embH !== undefined) override.headingText = embH;
        const embS = embeddedSubtexts[rawCouponId] ?? embeddedSubtexts[couponId];
        if (embS !== undefined) override.subtextText = embS;

        if (conditionEntry.displayCondition) override.displayCondition = conditionEntry.displayCondition;
        if (!override.couponCode && conditionEntry.couponCode) override.couponCode = conditionEntry.couponCode;
        if (conditionEntry.headingText !== undefined) override.headingText = conditionEntry.headingText;
        if (conditionEntry.subtextText !== undefined) override.subtextText = conditionEntry.subtextText;
        if (conditionEntry.productHandles?.length) override.productHandles = conditionEntry.productHandles;
        if (conditionEntry.collectionHandles?.length) override.collectionHandles = conditionEntry.collectionHandles;
        if (conditionEntry.displayTags?.length) override.displayTags = conditionEntry.displayTags;

        if (Object.keys(override).length > 0) {
            couponOverrides[couponId] = override;
        }
    }

    return {
        activeTemplate,
        templates,
        selectedActiveCoupons: selectedCoupons,
        couponOverrides,
    };
}

/* ---------------- LOADER (GET) ---------------- */

export async function loader({ request }) {
    const url = new URL(request.url);
    const rawShop = url.searchParams.get("shop") || url.searchParams.get("shopdomain") || "";
    const shopDomain = rawShop.toLowerCase();

    // If no shopDomain provided, fall back to local defaults
    if (!shopDomain) {
        console.warn("No shop domain provided to coupon-slider loader, returning defaults");
        return new Response(JSON.stringify({ success: true, config: { ...DEFAULT_DATA } }), {
            headers: { "Content-Type": "application/json" },
        });
    }

    try {
        const apiUrl = `${EXTERNAL_API}?shopdomain=${encodeURIComponent(shopDomain)}`;
        console.log("Fetching coupon slider config from:", apiUrl);

        const extRes = await fetch(apiUrl, {
            method: "GET",
            headers: { "ngrok-skip-browser-warning": "true" },
        });

        const extBody = await extRes.json();
        console.log(`External API GET response [${extRes.status}]:`, JSON.stringify(extBody));

        if (extBody.status === "success" && extBody.data) {
            const config = transformFromDB(extBody.data);

            // AUTO-SYNC LOGIC:
            // Check if any template style is empty or malformed
            const needsSync = !extBody.data.temp1DefaultStyle ||
                !extBody.data.temp2DefaultStyle ||
                !extBody.data.temp3DefaultStyle ||
                !extBody.data.temp4DefaultStyle ||
                extBody.data.temp1DefaultStyle === "[]" ||
                extBody.data.temp1DefaultStyle === "{}";

            if (needsSync) {
                console.log("Database missing or partial defaults, triggering auto-sync...");
                // We don't await this to keep the loader fast
                (async () => {
                    try {
                        const dbPayload = transformForDB(config, shopDomain);
                        await fetch(EXTERNAL_API, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(dbPayload),
                        });
                        console.log("Auto-sync completed for", shopDomain);
                    } catch (err) {
                        console.error("Auto-sync failed:", err.message);
                    }
                })();
            }

            return new Response(JSON.stringify({ success: true, config }), {
                headers: { "Content-Type": "application/json" },
            });
        } else {
            console.warn("External API returned non-success, using defaults");
            return new Response(JSON.stringify({ success: true, config: { ...DEFAULT_DATA } }), {
                headers: { "Content-Type": "application/json" },
            });
        }
    } catch (error) {
        console.error("Failed to fetch from external API:", error.message);
        return new Response(JSON.stringify({ success: true, config: { ...DEFAULT_DATA } }), {
            headers: { "Content-Type": "application/json" },
        });
    }
}

/* ---------- TRANSFORM TO DB SCHEMA ---------- */

const STYLE_KEYS = [
    "bgColor", "textColor", "accentColor", "buttonColor", "buttonTextColor",
    "borderRadius", "fontSize", "padding", "borderColor", "priceColor",
    "headingText", "subtextText", "showPrices", "showAddAllButton",
    "interactionType", "layout"
];
const CONDITION_KEYS = ["displayCondition", "productHandles", "collectionHandles", "displayTags"];

function transformForDB(data, shopDomain) {
    const templates = data.templates || {};
    const overrides = data.couponOverrides || {};
    const selectedCoupons = data.selectedActiveCoupons || [];

    // Helper to build the style object for a template
    function buildStyle(tplKey) {
        const tpl = templates[tplKey] || {};
        const defaultTpl = (DEFAULT_DATA.templates && DEFAULT_DATA.templates[tplKey]) || {};
        const merged = {};
        for (const k of STYLE_KEYS) {
            // Use default if current value is undefined OR an empty string
            const currentVal = tpl[k];
            const defVal = defaultTpl[k] !== undefined ? defaultTpl[k] : "";
            merged[k] = (currentVal !== undefined && currentVal !== "") ? currentVal : defVal;
        }
        return merged;
    }

    // Helper to build coupon styles & conditions for a template
    function buildCouponData(tplKey) {
        const isActive = data.activeTemplate === tplKey;
        const couponConditions = [];
        const couponStyles = {};

        if (isActive) {
            for (const couponId of selectedCoupons) {
                const ov = overrides[couponId] || {};

                // Build condition — also store couponCode + text overrides here since
                // temp*CouponCondition reliably saves to PHP (temp*CouponStyle may not)
                // Condition = display rules only (which product/collection/tag to show on)
                const condition = {
                    couponId,
                    displayCondition: ov.displayCondition || "all",
                };
                if (ov.productHandles?.length) condition.productHandles = ov.productHandles;
                if (ov.collectionHandles?.length) condition.collectionHandles = ov.collectionHandles;
                if (ov.displayTags?.length) condition.displayTags = ov.displayTags;
                couponConditions.push(condition);

                // Style = per-coupon overrides: couponCode, headingText, subtextText + visual styles
                const styleOv = {};
                for (const [k, v] of Object.entries(ov)) {
                    if (!CONDITION_KEYS.includes(k) && !["label", "description"].includes(k)) {
                        styleOv[k] = v;
                    }
                }

                if (Object.keys(styleOv).length > 0) {
                    couponStyles[couponId] = styleOv;
                }
            }
        }

        return { couponConditions, couponStyles };
    }

    const t1Data = buildCouponData("template1");
    const t2Data = buildCouponData("template2");
    const t3Data = buildCouponData("template3");
    const t4Data = buildCouponData("template4");

    // Align with the DB fields shown in user's JSON
    // We STRINGIFY these objects because the PHP backend expects JSON strings in the DB
    return {
        id: "",
        shop: shopDomain || "",
        shopDomain: shopDomain || "",
        selectedTemplate: data.activeTemplate || "template1",
        // Store {id, code, h, s} objects so storefront liquid reads them directly
        // (bypasses unreliable temp*CouponStyle PHP storage)
        selectedTemplateCoupon: JSON.stringify(selectedCoupons.map(id => {
            const ov = overrides[id] || {};
            // Only write code if it's a real coupon string (not a numeric GID tail)
            const realCode = ov.couponCode && !/^\d+$/.test(ov.couponCode) ? ov.couponCode : null;
            const item = { id };
            if (realCode) item.code = realCode;
            if (ov.headingText !== undefined) item.h = ov.headingText;
            if (ov.subtextText !== undefined) item.s = ov.subtextText;
            return item;
        })),

        // Styles (Stringified for PHP DB)
        temp1DefaultStyle: JSON.stringify(buildStyle("template1")),
        temp2DefaultStyle: JSON.stringify(buildStyle("template2")),
        temp3DefaultStyle: JSON.stringify(buildStyle("template3")),
        temp4DefaultStyle: JSON.stringify(buildStyle("template4")),

        // Coupon Styles (Stringified for PHP DB)
        temp1CouponStyle: JSON.stringify(t1Data.couponStyles),
        temp2CouponStyle: JSON.stringify(t2Data.couponStyles),
        temp3CouponStyle: JSON.stringify(t3Data.couponStyles),
        temp4CouponStyle: JSON.stringify(t4Data.couponStyles),

        // Coupon Conditions (Stringified for PHP DB)
        temp1CouponCondition: JSON.stringify(t1Data.couponConditions),
        temp2CouponCondition: JSON.stringify(t2Data.couponConditions),
        temp3CouponCondition: JSON.stringify(t3Data.couponConditions),
        temp4CouponCondition: JSON.stringify(t4Data.couponConditions),

        // Explicitly include counts or other fields if required by PHP
        status: "success"
    };
}

/* ---------------- ACTION (POST) ---------------- */

export async function action({ request }) {
    console.log("------------------------------------------");
    console.log("RECEIVED ACTION REQUEST ON /api/coupon-slider");
    const contentType = request.headers.get("content-type");
    console.log("Content-Type:", contentType);

    try {
        let body;
        if (contentType?.includes("application/json")) {
            body = await request.json();
        } else {
            const formData = await request.formData();
            body = Object.fromEntries(formData);
            // Parse nested objects if they were sent as JSON strings in form fields
            if (typeof body.templateData === "string") {
                try { body.templateData = JSON.parse(body.templateData); } catch (e) { }
            }
            if (typeof body.selectedActiveCoupons === "string") {
                try { body.selectedActiveCoupons = JSON.parse(body.selectedActiveCoupons); } catch (e) { }
            }
            if (typeof body.couponOverrides === "string") {
                try { body.couponOverrides = JSON.parse(body.couponOverrides); } catch (e) { }
            }
        }

        console.log("Parsed body:", JSON.stringify(body, null, 2));

        // Read existing data
        const existing = await readData();

        // Merge incoming fields onto existing data
        const updated = {
            ...existing,
            ...(body.activeTemplate !== undefined && { activeTemplate: body.activeTemplate }),
            ...(body.templateData !== undefined && { templates: { ...existing.templates, ...body.templateData } }),
            ...(body.selectedActiveCoupons !== undefined && { selectedActiveCoupons: body.selectedActiveCoupons }),
            ...(body.couponOverrides !== undefined && { couponOverrides: body.couponOverrides }),
        };

        // Remove stale legacy top-level fields
        delete updated.displayCondition;
        delete updated.productHandles;
        delete updated.collectionHandles;
        delete updated.displayTags;
        delete updated.selectedTemplate;
        delete updated.selectedCouponNames;
        delete updated.textContent;
        delete updated.color;
        delete updated.styling;

        await writeData(updated);

        // Transform to DB schema and send to external PHP endpoint
        const rawShop = body.shop || body.shopDomain || existing.shop || updated.shop || "";
        const shop = rawShop.toLowerCase();
        const dbPayload = transformForDB(updated, shop);

        // Ensure both identifiers are present in the final payload
        dbPayload.shop = shop;
        dbPayload.shopDomain = shop;
        dbPayload.shopdomain = shop; // Add lowercase key too

        if (!shop) {
            console.warn("No shop domain found in payload or existing data. External API sync might fail.");
        }

        console.log("Outgoing DB payload to Coupon Slider API:", JSON.stringify(dbPayload, null, 2));

        try {
            const extRes = await fetch(EXTERNAL_API, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "Shopify-App-Action-Handler",
                },
                body: JSON.stringify(dbPayload),
            });

            const responseStatus = extRes.status;
            const responseText = await extRes.text();

            console.log(`External Coupon Slider API response [${responseStatus}]:`, responseText);

            try {
                const responseJSON = JSON.parse(responseText);
                if (responseJSON.status === "error") {
                    console.error("External API returned error status:", responseJSON.message);
                }
            } catch (e) {
                // Not JSON, that's fine, we already logged the text
            }
        } catch (extErr) {
            console.error("Failed to send to external Coupon Slider API:", extErr.message);
        }

        console.log("------------------------------------------");

        return new Response(
            JSON.stringify({ success: true, config: updated }),
            { headers: { "Content-Type": "application/json" } }
        );
    } catch (error) {
        console.error("Coupon slider action error:", error);
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}