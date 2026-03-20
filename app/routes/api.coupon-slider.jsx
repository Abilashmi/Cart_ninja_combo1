import { promises as fs } from "fs";
import path from "path";

const EXTERNAL_API = "https://blueviolet-clam-512487.hostingersite.com/save_coupon_slider_widget.php";

const DATA_FILE = path.resolve("coupon-slider-data.json");

/* ---------------- DEFAULTS ---------------- */
const DEFAULT_TITLE = {
    text: "Apply Coupon",
    fontSize: 14,
    textColor: "#111827",
    alignment: "left",
};

function normalizeTitle(rawTitle) {
    const t = (rawTitle && typeof rawTitle === "object") ? rawTitle : {};
    const text = (typeof t.text === "string" && t.text.trim()) ? t.text : DEFAULT_TITLE.text;
    const fontSize = Number.isFinite(Number(t.fontSize)) ? Number(t.fontSize) : DEFAULT_TITLE.fontSize;
    const textColor = (typeof t.textColor === "string" && t.textColor.trim()) ? t.textColor : DEFAULT_TITLE.textColor;
    const alignment = ["left", "center", "right"].includes(t.alignment) ? t.alignment : DEFAULT_TITLE.alignment;
    return { text, fontSize, textColor, alignment };
}

function normalizeConfig(raw) {
    const data = (raw && typeof raw === "object") ? raw : {};
    const rawTemplates = (data.templates && typeof data.templates === "object") ? data.templates : {};
    const rawAllOverrides = (data.allTemplateOverrides && typeof data.allTemplateOverrides === "object") ? data.allTemplateOverrides : {};

    return {
        ...DEFAULT_DATA,
        ...data,
        title: normalizeTitle(data.title),
        templates: {
            template1: { ...DEFAULT_DATA.templates.template1, ...(rawTemplates.template1 || {}) },
            template2: { ...DEFAULT_DATA.templates.template2, ...(rawTemplates.template2 || {}) },
            template3: { ...DEFAULT_DATA.templates.template3, ...(rawTemplates.template3 || {}) },
        },
        selectedActiveCoupons: Array.isArray(data.selectedActiveCoupons) ? data.selectedActiveCoupons : [],
        allTemplateOverrides: {
            template1: { ...(rawAllOverrides.template1 || {}) },
            template2: { ...(rawAllOverrides.template2 || {}) },
            template3: { ...(rawAllOverrides.template3 || {}) },
        },
    };
}

const DEFAULT_DATA = {
    activeTemplate: "template1",
    title: DEFAULT_TITLE,
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
            subtextText: "Free shipping on qualifying orders",
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
        
    },
    selectedActiveCoupons: [],
    // Option A: per-template coupon overrides — each template owns its own coupon styling independently
    allTemplateOverrides: {
        template1: {},
        template2: {},
        template3: {},
        
    },
};

/* ---------------- FILE HELPERS ---------------- */

async function readData() {
    try {
        const raw = await fs.readFile(DATA_FILE, "utf-8");
        return normalizeConfig(JSON.parse(raw));
    } catch {
        return normalizeConfig({});
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
            const matches = val.match(/gid:[\/\\]+shopify[\/\\]+(DiscountCodeNode|DiscountAutomaticNode|DiscountNode)[\/\\]+\d+/g);
            if (matches) {
                return matches.map(id => id.replace(/\\/g, '/'));
            }
            return [];
        }
    };

    // Normalize a GID to single forward slashes
    const normalizeId = (id) => id.replace(/\\/g, '/').replace(/\/+/g, '/');

    const activeTemplate = dbData.selectedTemplate || "template1";

    // Build templates object with DEEP merging of defaults
    const templates = {
        template1: { ...DEFAULT_DATA.templates.template1, ...parseJSON(dbData.temp1DefaultStyle) },
        template2: { ...DEFAULT_DATA.templates.template2, ...parseJSON(dbData.temp2DefaultStyle) },
        template3: { ...DEFAULT_DATA.templates.template3, ...parseJSON(dbData.temp3DefaultStyle) },
       
    };

    const titleCandidate = templates[activeTemplate]?.title
        || templates.template1?.title
        || templates.template2?.title
        || templates.template3?.title
        || dbData.title;
    const title = normalizeTitle(titleCandidate);

    // ── Option A: Build per-template coupon overrides independently ──
    // Each template reads from its own DB columns (temp1CouponStyle/Condition, etc.)
    const buildTemplateOverrides = (couponStyleField, couponCondField) => {
        const couponStyles = parseJSON(dbData[couponStyleField]);
        const couponConditions = parseJSONArray(dbData[couponCondField]);

        const overrides = {};
        const allIds = [...new Set([
            ...Object.keys(couponStyles),
            ...couponConditions.map(c => c.couponId).filter(Boolean),
        ])];

        for (const rawId of allIds) {
            const couponId = normalizeId(rawId);
            const styleOv = couponStyles[rawId] || couponStyles[couponId] || {};
            const condEntry = couponConditions.find(c => normalizeId(c.couponId || "") === couponId) || {};

            const override = { ...styleOv };
            if (condEntry.displayCondition) override.displayCondition = condEntry.displayCondition;
            if (!override.couponCode && condEntry.couponCode) override.couponCode = condEntry.couponCode;
            if (condEntry.headingText !== undefined) override.headingText = condEntry.headingText;
            if (condEntry.subtextText !== undefined) override.subtextText = condEntry.subtextText;
            if (condEntry.productHandles?.length) override.productHandles = condEntry.productHandles;
            if (condEntry.collectionHandles?.length) override.collectionHandles = condEntry.collectionHandles;
            if (condEntry.displayTags?.length) override.displayTags = condEntry.displayTags;

            if (Object.keys(override).length > 0) {
                overrides[couponId] = override;
            }
        }
        return overrides;
    };

    const allTemplateOverrides = {
        template1: buildTemplateOverrides("temp1CouponStyle", "temp1CouponCondition"),
        template2: buildTemplateOverrides("temp2CouponStyle", "temp2CouponCondition"),
        template3: buildTemplateOverrides("temp3CouponStyle", "temp3CouponCondition"),
       
    };

    // ── Enrich active template's overrides with embedded data from selectedTemplateCoupon ──
    // selectedTemplateCoupon stores {id, code, h, s} objects — most reliable source for coupon text
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

    // Merge embedded text/code into the active template's overrides
    const activeOverrides = allTemplateOverrides[activeTemplate];
    for (const rawId of idsFromSelected) {
        const couponId = normalizeId(rawId);
        const embedded = embeddedCodes[rawId] || embeddedCodes[couponId];
        const embH = embeddedHeadings[rawId] ?? embeddedHeadings[couponId];
        const embS = embeddedSubtexts[rawId] ?? embeddedSubtexts[couponId];

        if (embedded || embH !== undefined || embS !== undefined) {
            if (!activeOverrides[couponId]) activeOverrides[couponId] = {};
            if (embedded && !/^\d+$/.test(embedded)) activeOverrides[couponId].couponCode = embedded;
            if (embH !== undefined) activeOverrides[couponId].headingText = embH;
            if (embS !== undefined) activeOverrides[couponId].subtextText = embS;
        }
    }

    // ── Build selectedCoupons list (merge from all sources for active template) ──
    const activeIdsFromStyles = Object.keys(activeOverrides);

    // Only include coupons that were explicitly selected and saved, or have overrides if we really want to append (We should just use explicit selections)
    const reconciledSelected = idsFromSelected.map(rawId => {
        const id = normalizeId(rawId);
        return id;
    });

    // Deduplicate by numeric tail (GID suffix) to handle double-slash vs single-slash variants
    const seen = new Map();
    for (const id of reconciledSelected) {
        const tail = id.split('/').pop();
        if (!seen.has(tail) && tail) seen.set(tail, id);
    }
    const selectedCoupons = [...seen.values()];

    return {
        activeTemplate,
        templates,
        selectedActiveCoupons: selectedCoupons,
        allTemplateOverrides,
        title,
    };
}

/* ---------------- LOADER (GET) ---------------- */

export async function loader({ request }) {
    const url = new URL(request.url);
    const rawShop = url.searchParams.get("shop") || url.searchParams.get("shopdomain") || "";
    const shopDomain = rawShop.toLowerCase();

    // Local file is the authoritative fallback (and is what the action writes to).
    // If the external API is unavailable or returns incomplete data, use this.
    const localConfig = await readData();

    // If no shopDomain provided, fall back to locally-stored config (or defaults if none)
    if (!shopDomain) {
        console.warn("No shop domain provided to coupon-slider loader, returning defaults");
        return new Response(JSON.stringify({ success: true, config: localConfig }), {
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
            const config = normalizeConfig(transformFromDB(extBody.data));

            // If external doesn't have our title saved yet, prefer the locally-saved title.
            const externalHasTitle = Boolean(
                (extBody.data.temp1DefaultStyle && typeof extBody.data.temp1DefaultStyle === "object" && extBody.data.temp1DefaultStyle.title) ||
                (extBody.data.temp2DefaultStyle && typeof extBody.data.temp2DefaultStyle === "object" && extBody.data.temp2DefaultStyle.title) ||
                (extBody.data.temp3DefaultStyle && typeof extBody.data.temp3DefaultStyle === "object" && extBody.data.temp3DefaultStyle.title)
            );
            if (!externalHasTitle && localConfig?.title) {
                config.title = normalizeTitle(localConfig.title);
            }

            // If external returns a config that looks incomplete (common when save/sync fails),
            // prefer the locally-saved config so the admin UI shows what was last saved.
            const externalHasSelections = Array.isArray(config.selectedActiveCoupons) && config.selectedActiveCoupons.length > 0;
            const localHasSelections = Array.isArray(localConfig.selectedActiveCoupons) && localConfig.selectedActiveCoupons.length > 0;
            if (!externalHasSelections && localHasSelections) {
                return new Response(JSON.stringify({ success: true, config: localConfig }), {
                    headers: { "Content-Type": "application/json" },
                });
            }

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
            return new Response(JSON.stringify({ success: true, config: localConfig }), {
                headers: { "Content-Type": "application/json" },
            });
        }
    } catch (error) {
        console.error("Failed to fetch from external API:", error.message);
        return new Response(JSON.stringify({ success: true, config: localConfig }), {
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
    const normalizedTitle = normalizeTitle(data?.title);
    const templates = data.templates || {};
    const allTemplateOverrides = data.allTemplateOverrides || {};
    const activeTemplate = data.activeTemplate || "template1";
    // Active template's overrides are used to embed code/text into selectedTemplateCoupon
    const activeOverrides = allTemplateOverrides[activeTemplate] || {};
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
        // Persist the section title config inside the style JSON so the storefront block can render it.
        merged.title = normalizedTitle;
        return merged;
    }

    // Helper to build coupon styles & conditions for a template
    // Option A: each template always saves its own overrides independently
    function buildCouponData(tplKey) {
        const couponConditions = [];
        const couponStyles = {};

        // Use this template's own overrides — never just the active template's
        const tplOverrides = (data.allTemplateOverrides || {})[tplKey] || {};

        for (const couponId of Object.keys(tplOverrides)) {
            const ov = tplOverrides[couponId];

            const condition = {
                couponId,
                displayCondition: ov.displayCondition || "all",
            };
            if (ov.productHandles?.length) condition.productHandles = ov.productHandles;
            if (ov.collectionHandles?.length) condition.collectionHandles = ov.collectionHandles;
            if (ov.displayTags?.length) condition.displayTags = ov.displayTags;
            couponConditions.push(condition);

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

        return { couponConditions, couponStyles };
    }

    const t1Data = buildCouponData("template1");
    const t2Data = buildCouponData("template2");
    const t3Data = buildCouponData("template3");
   

    // Align with the DB fields shown in user's JSON
    // We STRINGIFY these objects because the PHP backend expects JSON strings in the DB
    return {
        id: "",
        shop: shopDomain || "",
        shopDomain: shopDomain || "",
        selectedTemplate: data.activeTemplate || "template1",
        // Store {id, code, h, s} objects so storefront liquid reads them directly
        // Uses the active template's overrides for embedded text (most current data)
        selectedTemplateCoupon: JSON.stringify(selectedCoupons.map(id => {
            const ov = activeOverrides[id] || {};
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
       

        // Coupon Styles (Stringified for PHP DB)
        temp1CouponStyle: JSON.stringify(t1Data.couponStyles),
        temp2CouponStyle: JSON.stringify(t2Data.couponStyles),
        temp3CouponStyle: JSON.stringify(t3Data.couponStyles),
       

        // Coupon Conditions (Stringified for PHP DB)
        temp1CouponCondition: JSON.stringify(t1Data.couponConditions),
        temp2CouponCondition: JSON.stringify(t2Data.couponConditions),
        temp3CouponCondition: JSON.stringify(t3Data.couponConditions),
       

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
            if (typeof body.allTemplateOverrides === "string") {
                try { body.allTemplateOverrides = JSON.parse(body.allTemplateOverrides); } catch (e) { }
            }
            if (typeof body.title === "string") {
                try { body.title = JSON.parse(body.title); } catch (e) { }
            }
        }

        console.log("Parsed body:", JSON.stringify(body, null, 2));

        // Read existing data
        const existing = await readData();

        // Merge incoming fields onto existing data
        // Option A: allTemplateOverrides is the source of truth; couponOverrides is legacy fallback
        let incomingAllTemplateOverrides = body.allTemplateOverrides;
        if (!incomingAllTemplateOverrides && body.couponOverrides) {
            // Legacy upgrade path: promote flat couponOverrides into active template's slot
            const activeTpl = body.activeTemplate || existing.activeTemplate || "template1";
            incomingAllTemplateOverrides = {
                ...(existing.allTemplateOverrides || DEFAULT_DATA.allTemplateOverrides),
                [activeTpl]: body.couponOverrides,
            };
        }

        const mergedTitle = body.title !== undefined
            ? normalizeTitle({ ...(existing.title || DEFAULT_TITLE), ...(body.title || {}) })
            : normalizeTitle(existing.title || DEFAULT_TITLE);

        const updated = {
            ...existing,
            ...(body.activeTemplate !== undefined && { activeTemplate: body.activeTemplate }),
            ...(body.templateData !== undefined && { templates: { ...existing.templates, ...body.templateData } }),
            ...(body.selectedActiveCoupons !== undefined && { selectedActiveCoupons: body.selectedActiveCoupons }),
            ...(incomingAllTemplateOverrides !== undefined && { allTemplateOverrides: incomingAllTemplateOverrides }),
            title: mergedTitle,
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
        delete updated.couponOverrides; // legacy flat field, replaced by allTemplateOverrides

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