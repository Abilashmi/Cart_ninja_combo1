import { getDb } from "../services/db.server";

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
    allTemplateOverrides: {
        template1: {},
        template2: {},
        template3: {},
    },
};

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

/* ---------- TRANSFORM FROM DB ROW ---------- */

function transformFromDB(dbData) {
    const parseJSON = (val) => {
        if (!val) return {};
        if (typeof val === "object") return val;
        try { return JSON.parse(val); } catch { return {}; }
    };

    const parseJSONArray = (val) => {
        if (!val) return [];
        if (Array.isArray(val)) return val;
        if (typeof val !== "string") return [];
        try {
            return JSON.parse(val);
        } catch {
            const matches = val.match(/gid:[\/\\]+shopify[\/\\]+(DiscountCodeNode|DiscountAutomaticNode|DiscountNode)[\/\\]+\d+/g);
            if (matches) return matches.map(id => id.replace(/\\/g, '/'));
            return [];
        }
    };

    const normalizeId = (id) => id.replace(/\\/g, '/').replace(/\/+/g, '/');

    const activeTemplate = dbData.selectedTemplate || "template1";

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
            if (Object.keys(override).length > 0) overrides[couponId] = override;
        }
        return overrides;
    };

    const allTemplateOverrides = {
        template1: buildTemplateOverrides("temp1CouponStyle", "temp1CouponCondition"),
        template2: buildTemplateOverrides("temp2CouponStyle", "temp2CouponCondition"),
        template3: buildTemplateOverrides("temp3CouponStyle", "temp3CouponCondition"),
    };

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

    const seen = new Map();
    for (const id of idsFromSelected.map(rawId => normalizeId(rawId))) {
        const tail = id.split('/').pop();
        if (!seen.has(tail) && tail) seen.set(tail, id);
    }

    return {
        activeTemplate,
        templates,
        selectedActiveCoupons: [...seen.values()],
        allTemplateOverrides,
        title,
    };
}

/* ---------- TRANSFORM TO DB COLUMNS ---------- */

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
    const activeOverrides = allTemplateOverrides[activeTemplate] || {};
    const selectedCoupons = data.selectedActiveCoupons || [];

    function buildStyle(tplKey) {
        const tpl = templates[tplKey] || {};
        const defaultTpl = DEFAULT_DATA.templates[tplKey] || {};
        const merged = {};
        for (const k of STYLE_KEYS) {
            const currentVal = tpl[k];
            const defVal = defaultTpl[k] !== undefined ? defaultTpl[k] : "";
            merged[k] = (currentVal !== undefined && currentVal !== "") ? currentVal : defVal;
        }
        merged.title = normalizedTitle;
        return merged;
    }

    function buildCouponData(tplKey) {
        const couponConditions = [];
        const couponStyles = {};
        const tplOverrides = (data.allTemplateOverrides || {})[tplKey] || {};
        for (const couponId of Object.keys(tplOverrides)) {
            const ov = tplOverrides[couponId];
            const condition = { couponId, displayCondition: ov.displayCondition || "all" };
            if (ov.productHandles?.length) condition.productHandles = ov.productHandles;
            if (ov.collectionHandles?.length) condition.collectionHandles = ov.collectionHandles;
            if (ov.displayTags?.length) condition.displayTags = ov.displayTags;
            couponConditions.push(condition);
            const styleOv = {};
            for (const [k, v] of Object.entries(ov)) {
                if (!CONDITION_KEYS.includes(k) && !["label", "description"].includes(k)) styleOv[k] = v;
            }
            if (Object.keys(styleOv).length > 0) couponStyles[couponId] = styleOv;
        }
        return { couponConditions, couponStyles };
    }

    const t1 = buildCouponData("template1");
    const t2 = buildCouponData("template2");
    const t3 = buildCouponData("template3");

    return {
        shopDomain: shopDomain || "",
        selectedTemplate: activeTemplate,
        selectedTemplateCoupon: JSON.stringify(selectedCoupons.map(id => {
            const ov = activeOverrides[id] || {};
            const realCode = ov.couponCode && !/^\d+$/.test(ov.couponCode) ? ov.couponCode : null;
            const item = { id };
            if (realCode) item.code = realCode;
            if (ov.headingText !== undefined) item.h = ov.headingText;
            if (ov.subtextText !== undefined) item.s = ov.subtextText;
            return item;
        })),
        temp1DefaultStyle: JSON.stringify(buildStyle("template1")),
        temp2DefaultStyle: JSON.stringify(buildStyle("template2")),
        temp3DefaultStyle: JSON.stringify(buildStyle("template3")),
        temp1CouponStyle: JSON.stringify(t1.couponStyles),
        temp2CouponStyle: JSON.stringify(t2.couponStyles),
        temp3CouponStyle: JSON.stringify(t3.couponStyles),
        temp1CouponCondition: JSON.stringify(t1.couponConditions),
        temp2CouponCondition: JSON.stringify(t2.couponConditions),
        temp3CouponCondition: JSON.stringify(t3.couponConditions),
    };
}

/* ---------------- DB HELPERS ---------------- */

async function fetchRow(shopDomain) {
    const db = getDb();
    const [rows] = await db.execute(
        'SELECT * FROM coupon_slider_widget WHERE shopDomain = ? LIMIT 1',
        [shopDomain]
    );
    return rows[0] || null;
}

async function upsertRow(dbPayload) {
    const db = getDb();
    await db.execute(
        `INSERT INTO coupon_slider_widget
            (shopDomain, selectedTemplate, selectedTemplateCoupon,
             temp1DefaultStyle, temp2DefaultStyle, temp3DefaultStyle,
             temp1CouponStyle, temp2CouponStyle, temp3CouponStyle,
             temp1CouponCondition, temp2CouponCondition, temp3CouponCondition, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE
            selectedTemplate = VALUES(selectedTemplate),
            selectedTemplateCoupon = VALUES(selectedTemplateCoupon),
            temp1DefaultStyle = VALUES(temp1DefaultStyle),
            temp2DefaultStyle = VALUES(temp2DefaultStyle),
            temp3DefaultStyle = VALUES(temp3DefaultStyle),
            temp1CouponStyle = VALUES(temp1CouponStyle),
            temp2CouponStyle = VALUES(temp2CouponStyle),
            temp3CouponStyle = VALUES(temp3CouponStyle),
            temp1CouponCondition = VALUES(temp1CouponCondition),
            temp2CouponCondition = VALUES(temp2CouponCondition),
            temp3CouponCondition = VALUES(temp3CouponCondition),
            updated_at = CURRENT_TIMESTAMP(3)`,
        [
            dbPayload.shopDomain,
            dbPayload.selectedTemplate,
            dbPayload.selectedTemplateCoupon,
            dbPayload.temp1DefaultStyle,
            dbPayload.temp2DefaultStyle,
            dbPayload.temp3DefaultStyle,
            dbPayload.temp1CouponStyle,
            dbPayload.temp2CouponStyle,
            dbPayload.temp3CouponStyle,
            dbPayload.temp1CouponCondition,
            dbPayload.temp2CouponCondition,
            dbPayload.temp3CouponCondition,
        ]
    );
}

/* ---------------- LOADER (GET) ---------------- */

export async function loader({ request }) {
    const url = new URL(request.url);
    const shopDomain = (url.searchParams.get("shop") || url.searchParams.get("shopdomain") || "").toLowerCase();

    if (!shopDomain) {
        return Response.json({ success: true, config: normalizeConfig({}) });
    }

    try {
        const row = await fetchRow(shopDomain);
        if (row) {
            const config = normalizeConfig(transformFromDB(row));
            return Response.json({ success: true, config });
        }
    } catch (e) {
        console.error("[coupon-slider loader] DB read failed:", e.message);
    }

    return Response.json({ success: true, config: normalizeConfig({}) });
}

/* ---------------- ACTION (POST) ---------------- */

export async function action({ request }) {
    try {
        let body;
        const contentType = request.headers.get("content-type");
        if (contentType?.includes("application/json")) {
            body = await request.json();
        } else {
            const formData = await request.formData();
            body = Object.fromEntries(formData);
            for (const key of ["templateData", "selectedActiveCoupons", "couponOverrides", "allTemplateOverrides", "title"]) {
                if (typeof body[key] === "string") {
                    try { body[key] = JSON.parse(body[key]); } catch {}
                }
            }
        }

        const shop = (body.shop || body.shopDomain || "").toLowerCase();
        if (!shop) {
            return Response.json({ success: false, error: "No shop domain provided" }, { status: 400 });
        }

        // Read existing config from DB to merge into
        let existing = normalizeConfig({});
        try {
            const row = await fetchRow(shop);
            if (row) existing = normalizeConfig(transformFromDB(row));
        } catch (e) {
            console.warn("[coupon-slider action] Could not read existing row:", e.message);
        }

        // Promote legacy flat couponOverrides to allTemplateOverrides
        let incomingAllTemplateOverrides = body.allTemplateOverrides;
        if (!incomingAllTemplateOverrides && body.couponOverrides) {
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

        // Remove stale legacy fields
        delete updated.displayCondition;
        delete updated.productHandles;
        delete updated.collectionHandles;
        delete updated.displayTags;
        delete updated.selectedTemplate;
        delete updated.selectedCouponNames;
        delete updated.textContent;
        delete updated.color;
        delete updated.styling;
        delete updated.couponOverrides;

        const dbPayload = transformForDB(updated, shop);
        await upsertRow(dbPayload);

        return Response.json({ success: true, config: updated });

    } catch (error) {
        console.error("[coupon-slider action] Error:", error.message);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
}
