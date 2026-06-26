import { promises as fs } from "fs";
import path from "path";
import { getDb } from "../services/db.server.js";

const DATA_FILE = path.resolve("coupon-slider-data.json");
const CONDITION_KEYS = ["displayCondition", "productHandles", "collectionHandles", "displayTags"];

async function readData() {
    try {
        const raw = await fs.readFile(DATA_FILE, "utf-8");
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function buildCouponStyles(allTemplateOverrides, tplKey) {
    const tplOverrides = allTemplateOverrides[tplKey] || {};
    const couponStyles = {};
    for (const [couponId, ov] of Object.entries(tplOverrides)) {
        const styleOv = {};
        for (const [k, v] of Object.entries(ov)) {
            if (!CONDITION_KEYS.includes(k) && !["label", "description"].includes(k)) {
                styleOv[k] = v;
            }
        }
        if (Object.keys(styleOv).length > 0) couponStyles[couponId] = styleOv;
    }
    return couponStyles;
}

function buildCouponConditions(allTemplateOverrides, tplKey) {
    const tplOverrides = allTemplateOverrides[tplKey] || {};
    return Object.entries(tplOverrides)
        .filter(([, ov]) => ov.displayCondition)
        .map(([couponId, ov]) => {
            const cond = { couponId, displayCondition: ov.displayCondition };
            if (ov.productHandles?.length) cond.productHandles = ov.productHandles;
            if (ov.collectionHandles?.length) cond.collectionHandles = ov.collectionHandles;
            if (ov.displayTags?.length) cond.displayTags = ov.displayTags;
            return cond;
        });
}

export async function loader({ request }) {
    const url = new URL(request.url);
    const shopDomain = url.searchParams.get("shopdomain") || url.searchParams.get("shopDomain") || "";

    const config = await readData();

    const activeTemplate = config.activeTemplate || "template1";
    const selectedActiveCoupons = config.selectedActiveCoupons || [];
    const allTemplateOverrides = config.allTemplateOverrides || {};
    const templates = config.templates || {};
    const title = config.title || {};

    const activeOverrides = allTemplateOverrides[activeTemplate] || {};
    // Return plain GID strings — coupon_slider.js expects an array of ID strings
    const selectedTemplateCoupon = selectedActiveCoupons;

    // Read placement from MySQL coupon_slider_settings
    let widgetPlacement = "above_cart";
    if (shopDomain) {
        try {
            const db = getDb();
            const [rows] = await db.execute(
                "SELECT position FROM coupon_slider_settings WHERE shop_domain = ? LIMIT 1",
                [shopDomain]
            );
            if (rows.length > 0 && rows[0].position) {
                widgetPlacement = rows[0].position;
            }
        } catch (_e) {
            // fallback to default
        }
    }

    const data = {
        selectedTemplate: activeTemplate,
        selectedTemplateCoupon,
        widgetPlacement,
        temp1DefaultStyle: { ...(templates.template1 || {}), title },
        temp2DefaultStyle: { ...(templates.template2 || {}), title },
        temp3DefaultStyle: { ...(templates.template3 || {}), title },
        temp1CouponStyle: buildCouponStyles(allTemplateOverrides, "template1"),
        temp2CouponStyle: buildCouponStyles(allTemplateOverrides, "template2"),
        temp3CouponStyle: buildCouponStyles(allTemplateOverrides, "template3"),
        temp1CouponCondition: buildCouponConditions(allTemplateOverrides, "template1"),
        temp2CouponCondition: buildCouponConditions(allTemplateOverrides, "template2"),
        temp3CouponCondition: buildCouponConditions(allTemplateOverrides, "template3"),
        updated_at: new Date().toISOString(),
    };

    return new Response(JSON.stringify({ status: "success", data }), {
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
    });
}
