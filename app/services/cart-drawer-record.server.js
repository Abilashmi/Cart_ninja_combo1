import { promises as fs } from "fs";
import path from "path";
import { getDb } from "./db.server";

const LOCAL_CART_DATA_FILE = path.resolve("cartdrawer-config-data.json");

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

function agentLog(level, stage, message, data = null) {
    if (!level || !stage || !message) return;
    const threshold = LOG_LEVELS[process.env.AI_AGENT_LOG_LEVEL] ?? LOG_LEVELS.INFO;
    if (LOG_LEVELS[level] < threshold) return;
    const entry = {
        ts: new Date().toISOString(),
        level,
        stage,
        message,
        ...(data ? { data } : {}),
    };
    const prefix = `[AI Agent] [${level}] [${stage}]`;
    if (level === "ERROR") {
        console.error(prefix, message, data ? JSON.stringify(data) : "");
    } else if (level === "WARN") {
        console.warn(prefix, message, data ? JSON.stringify(data) : "");
    } else {
        console.log(prefix, message, data ? JSON.stringify(data) : "");
    }
}

function normalizeShopDomain(shopDomain) {
    return (shopDomain || "").toString().trim().toLowerCase();
}

async function readLocalMap(file) {
    try {
        const raw = await fs.readFile(file, "utf-8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

async function writeLocalMap(file, map) {
    try {
        await fs.writeFile(file, JSON.stringify(map, null, 2));
    } catch (e) {
        console.warn("[AI Agent] Failed to persist local fallback:", e?.message);
    }
}

export function truthyFlag(value) {
    return value === 1 || value === "1" || value === true;
}

export async function fetchCartDrawerRecord(shop) {
    const shopKey = normalizeShopDomain(shop);

    try {
        const pool = getDb();
        const [rows] = await pool.execute(
            "SELECT * FROM cart_drawer WHERE shop = ? LIMIT 1",
            [shop]
        );
        if (rows.length > 0) {
            agentLog("INFO", "cart_fetch", "Cart drawer record fetched from MySQL");
            return rows[0];
        }
        agentLog("WARN", "cart_fetch", "No cart_drawer row found for shop", { shop });
    } catch (e) {
        agentLog("WARN", "cart_fetch", "MySQL fetch failed, trying local fallback", { error: e?.message });
    }

    const localMap = await readLocalMap(LOCAL_CART_DATA_FILE);
    const fallback = (shopKey && localMap[shopKey]) ? localMap[shopKey] : null;
    if (fallback) agentLog("INFO", "cart_fetch", "Cart drawer loaded from local JSON fallback");
    return fallback || null;
}

export async function persistCartDrawerRecord(shop, record) {
    const shopKey = normalizeShopDomain(shop);
    const payload = { ...record, shop, shopDomain: shop };

    agentLog("INFO", "cart_persist", "Persisting cart drawer to MySQL", {
        shop,
        cartStatus: payload.cartStatus,
        upsellStatus: payload.upsell_status,
        progressStatus: payload.progress_status,
    });

    if (shopKey) {
        const map = await readLocalMap(LOCAL_CART_DATA_FILE);
        map[shopKey] = payload;
        await writeLocalMap(LOCAL_CART_DATA_FILE, map);
        agentLog("DEBUG", "cart_persist", "Cart drawer written to local JSON fallback");
    }

    try {
        const pool = getDb();
        const cartStatus = payload.cartStatus != null ? (payload.cartStatus ? 1 : 0) : 0;
        const progressData = payload.progress_data
            ? (typeof payload.progress_data === "string" ? payload.progress_data : JSON.stringify(payload.progress_data))
            : null;
        const upsellData = payload.upsell_data
            ? (typeof payload.upsell_data === "string" ? payload.upsell_data : JSON.stringify(payload.upsell_data))
            : null;
        const progressStatus = payload.progress_status != null ? (payload.progress_status ? 1 : 0) : 0;
        const upsellStatus = payload.upsell_status != null ? (payload.upsell_status ? 1 : 0) : 0;
        const couponStatus = payload.coupon_status != null ? (payload.coupon_status ? 1 : 0) : 0;
        const checkoutButtonStyle = payload.checkout_button_style
            ? (typeof payload.checkout_button_style === "string" ? payload.checkout_button_style : JSON.stringify(payload.checkout_button_style))
            : null;

        const couponData = payload.coupon_data
            ? (typeof payload.coupon_data === "string" ? payload.coupon_data : JSON.stringify(payload.coupon_data))
            : null;
        const checkoutName = payload.checkoutName || null;
        const checkoutFooterText = payload.checkoutFooterText || null;
        const customCSS = payload.customCSS || null;

        await pool.execute(`
            INSERT INTO cart_drawer (shop, cartStatus, progress_data, coupon_data, upsell_data,
                progress_status, coupon_status, upsell_status, checkout_button_style,
                checkoutName, checkoutFooterText, customCSS,
                progress_updated_at, coupon_updated_at, upsell_updated_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
            ON DUPLICATE KEY UPDATE
                cartStatus = VALUES(cartStatus),
                progress_data = VALUES(progress_data),
                coupon_data = VALUES(coupon_data),
                upsell_data = VALUES(upsell_data),
                progress_status = VALUES(progress_status),
                coupon_status = VALUES(coupon_status),
                upsell_status = VALUES(upsell_status),
                checkout_button_style = VALUES(checkout_button_style),
                checkoutName = VALUES(checkoutName),
                checkoutFooterText = VALUES(checkoutFooterText),
                customCSS = VALUES(customCSS),
                progress_updated_at = IF(VALUES(progress_data) IS NOT NULL, CURRENT_TIMESTAMP(3), progress_updated_at),
                coupon_updated_at    = IF(VALUES(coupon_data)   IS NOT NULL, CURRENT_TIMESTAMP(3), coupon_updated_at),
                upsell_updated_at    = IF(VALUES(upsell_data)   IS NOT NULL, CURRENT_TIMESTAMP(3), upsell_updated_at),
                updated_at = CURRENT_TIMESTAMP(3)
        `, [shop, cartStatus, progressData, couponData, upsellData, progressStatus, couponStatus, upsellStatus, checkoutButtonStyle, checkoutName, checkoutFooterText, customCSS]);

        agentLog("INFO", "cart_persist", "Cart drawer saved to MySQL successfully");
    } catch (e) {
        agentLog("ERROR", "cart_persist", "MySQL save failed", { error: e?.message });
        return { ok: false, error: e?.message, response: { status: "error", message: e?.message }, httpStatus: 500 };
    }

    return { ok: true, response: { status: "success", message: "Cart drawer saved" }, httpStatus: 200 };
}
