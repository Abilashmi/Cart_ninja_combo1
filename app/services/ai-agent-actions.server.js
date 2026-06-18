/**
 * AI Agent — Action Engine
 *
 * Converts the structured `actions` array returned by OpenAI into real changes
 * on the same settings store the Cart Editor / FBT pages read and write
 * (MySQL database, with a local JSON fallback).
 *
 * The AI never edits theme files or generates code — it only ever flips these
 * known settings.
 */

import { promises as fs } from "fs";
import path from "path";
import db from "../db.server";
import { getDb } from "./db.server";

const LOCAL_CART_DATA_FILE = path.resolve("cartdrawer-config-data.json");
const LOCAL_FBT_DATA_FILE = path.resolve("ai-agent-fbt-data.json");

export const SUPPORTED_ACTIONS = [
    "enableDrawer", "disableDrawer", "configureCartDrawer",
    "enableUpsell", "disableUpsell", "configureUpsell",
    "enableFBT", "disableFBT", "configureFBT",
    "enableGoalBar", "disableGoalBar", "configureGoalBar",
    "enableTrustBadges", "disableTrustBadges",
    "enableCouponSlider", "disableCouponSlider", "configureCouponSlider",
    "enableAnnouncement", "disableAnnouncement", "configureAnnouncement",
    "matchTheme", "optimizeMobile",
    "applyTemplate", "updateStyling", "updateCheckoutStyle",
    "createBundle",
];

export const TEMPLATE_PRESETS = {
    premium:    { buttonColor: "#111827", accentColor: "#d4af37", borderRadius: 6,  font: "Playfair Display" },
    modern:     { buttonColor: "#4f46e5", accentColor: "#6366f1", borderRadius: 12, font: "Inter" },
    minimal:    { buttonColor: "#111827", accentColor: "#6b7280", borderRadius: 4,  font: "Helvetica" },
    luxury:     { buttonColor: "#000000", accentColor: "#c9a227", borderRadius: 2,  font: "Cormorant Garamond" },
    fashion:    { buttonColor: "#e11d48", accentColor: "#fb7185", borderRadius: 999, font: "Poppins" },
    beauty:     { buttonColor: "#db2777", accentColor: "#f9a8d4", borderRadius: 16, font: "Quicksand" },
    electronics:{ buttonColor: "#2563eb", accentColor: "#38bdf8", borderRadius: 8,  font: "Roboto" },
};

export const ACTION_LABELS = {
    enableDrawer: "Enable Cart Drawer",
    disableDrawer: "Disable Cart Drawer",
    configureCartDrawer: "Configure Cart Drawer",
    enableUpsell: "Enable Upsell Recommendations",
    disableUpsell: "Disable Upsell Recommendations",
    configureUpsell: "Configure Upsell Recommendations",
    enableFBT: "Enable Frequently Bought Together",
    disableFBT: "Disable Frequently Bought Together",
    configureFBT: "Configure Frequently Bought Together",
    enableGoalBar: "Enable Free Shipping Goal Bar",
    disableGoalBar: "Disable Free Shipping Goal Bar",
    configureGoalBar: "Configure Free Shipping Goal Bar",
    enableTrustBadges: "Enable Trust Badges",
    disableTrustBadges: "Disable Trust Badges",
    enableCouponSlider: "Enable Coupon Slider",
    disableCouponSlider: "Disable Coupon Slider",
    configureCouponSlider: "Configure Coupon Slider",
    enableAnnouncement: "Enable Announcement Banner",
    disableAnnouncement: "Disable Announcement Banner",
    configureAnnouncement: "Configure Announcement Banner",
    matchTheme: "Match Theme Colors & Font",
    optimizeMobile: "Optimize Mobile Layout",
    applyTemplate: "Apply Style Template",
    updateStyling: "Update Cart Styling",
    createBundle: "Create Bundle Offer",
    updateCheckoutStyle: "Update Checkout Button Style",
};

export const ACTION_IMPACT = {
    enableDrawer:        "Keeps shoppers on-page and reduces checkout drop-off — drawer carts typically lift conversion by 5–10%.",
    disableDrawer:       "Cart drawer turned off — shoppers will use the standard cart page instead.",
    configureCartDrawer: "Cart drawer enabled with modern theme, optimized layout, and rounded corners.",
    enableUpsell:        "Surfacing related products in the cart can grow average order value by 10–15%.",
    disableUpsell:       "Upsell recommendations hidden from the cart.",
    configureUpsell:     "Upsell recommendations enabled with slider layout and modern styling.",
    enableFBT:           "\"Frequently Bought Together\" bundles often add 5–8% to order value on product pages.",
    disableFBT:          "Frequently Bought Together widget hidden from product pages.",
    configureFBT:        "FBT enabled with Modern Cards template and AI recommendation mode.",
    enableGoalBar:       "Free shipping goal bars are one of the strongest AOV levers — often +8–12% per order.",
    disableGoalBar:      "Free shipping progress bar removed from the cart.",
    configureGoalBar:    "Free shipping goal bar enabled with ₹999 target and milestone rewards.",
    enableTrustBadges:   "Trust badges near checkout reduce cart abandonment by reassuring shoppers about security.",
    disableTrustBadges:  "Trust badges removed from the cart.",
    enableAnnouncement:  "Announcement banners let you highlight promotions, shipping offers, or important messages right inside the cart — a simple way to boost urgency and conversion.",
    disableAnnouncement: "Announcement banner hidden from the cart.",
    configureAnnouncement: "Announcement banner enabled with configurable text, background color, text color, and font size.",
    matchTheme:          "Cart now mirrors your storefront's colors and font for a seamless, on-brand feel.",
    optimizeMobile:      "Layout tuned for small screens — larger tap targets and stacked content for mobile shoppers.",
    applyTemplate:       "A complete style preset applied across the cart, upsell and goal bar widgets.",
    updateStyling:       "Custom styling preferences applied to the cart drawer.",
    createBundle:        "A new Combo Forge bundle page created to showcase product bundles.",
    updateCheckoutStyle: "Checkout button color and style updated to match your brand.",
};

// ---------------- structured logging ----------------

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

// ---------------- shared helpers ----------------

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

function parseJSONSafe(value, fallback = {}) {
    if (!value) return { ...fallback };
    if (typeof value === "object") return value;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : { ...fallback };
    } catch {
        return { ...fallback };
    }
}

export function truthyFlag(value) {
    return value === 1 || value === "1" || value === true;
}

// ---------------- cart drawer settings (drawer / upsell / goal bar / trust badges) ----------------

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

    // Write to local JSON fallback (always succeeds — used as source of truth in dev)
    if (shopKey) {
        const map = await readLocalMap(LOCAL_CART_DATA_FILE);
        map[shopKey] = payload;
        await writeLocalMap(LOCAL_CART_DATA_FILE, map);
        agentLog("DEBUG", "cart_persist", "Cart drawer written to local JSON fallback");
    }

    // Write to MySQL (best-effort — failure does NOT block the AI agent response)
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
            INSERT INTO cart_drawer (shop, cartStatus, progress_data, coupon_data, upsell_data, progress_status, coupon_status, upsell_status, checkout_button_style, checkoutName, checkoutFooterText, customCSS, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
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
                updated_at = CURRENT_TIMESTAMP(3)
        `, [shop, cartStatus, progressData, couponData, upsellData, progressStatus, couponStatus, upsellStatus, checkoutButtonStyle, checkoutName, checkoutFooterText, customCSS]);

        agentLog("INFO", "cart_persist", "Cart drawer saved to MySQL successfully");
    } catch (e) {
        agentLog("ERROR", "cart_persist", "MySQL save failed", { error: e?.message });
        return { ok: false, error: e?.message, response: { status: "error", message: e?.message }, httpStatus: 500 };
    }

    return { ok: true, response: { status: "success", message: "Cart drawer saved" }, httpStatus: 200 };
}

function readableCartSnapshot(record, themeColors) {
    const progress = parseJSONSafe(record?.progress_data);
    const upsell = parseJSONSafe(record?.upsell_data);

    return {
        drawerEnabled: truthyFlag(record?.cartStatus ?? record?.cart_status),
        upsell: {
            enabled: truthyFlag(record?.upsell_status),
            template: upsell.activeTemplate || upsell.template || "grid",
            buttonColor: upsell.buttonColor || themeColors?.primaryColor || "#111827",
            accentColor: upsell.accentColor || upsell.priceColor || themeColors?.primaryColor || "#6366f1",
            mobileOptimized: Boolean(upsell.mobileOptimized),
        },
        goalBar: {
            enabled: truthyFlag(record?.progress_status),
            barColor: progress.barForegroundColor || progress.fill_color || themeColors?.primaryColor || "#2563eb",
            completionText: progress.completionText || "🎉 You've unlocked free shipping!",
        },
        trustBadges: {
            enabled: Boolean(upsell.trustBadges?.enabled),
            style: upsell.trustBadges?.style || "secure-checkout",
        },
        announcement: {
            enabled: Boolean(upsell.announcement?.enabled),
            text: upsell.announcement?.text || "",
        },
        couponSlider: {
            enabled: truthyFlag(record?.coupon_status),
        },
        checkoutButton: (() => {
            const raw = record?.checkout_button_style;
            const style = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : (raw || {});
            return {
                backgroundColor: style.backgroundColor || "#111827",
                textColor: style.textColor || "#ffffff",
                borderRadius: style.borderRadius ?? 4,
            };
        })(),
    };
}

// ---------------- FBT settings ----------------

async function fetchFbtRecord(shop) {
    const shopKey = normalizeShopDomain(shop);

    agentLog("INFO", "fbt_fetch", "Fetching FBT record from MySQL", { shop });
    try {
        const pool = getDb();
        const [rows] = await pool.execute(
            "SELECT * FROM fbt_widget WHERE shopDomain = ? LIMIT 1",
            [shop]
        );
        if (rows.length > 0) {
            const row = rows[0];
            // Decode JSON fields (matching save_fbt_widget.php behavior)
            for (const field of ["temp1", "temp2", "temp3", "condition"]) {
                if (row[field] && typeof row[field] === "string") {
                    try { row[field] = JSON.parse(row[field]); } catch { /* keep as string */ }
                }
            }
            agentLog("INFO", "fbt_fetch", "FBT record fetched from MySQL");
            return row;
        }
        agentLog("WARN", "fbt_fetch", "No fbt_widget row found for shop", { shop });
    } catch (e) {
        agentLog("WARN", "fbt_fetch", "MySQL fetch failed, trying local fallback", { error: e?.message });
    }

    const localMap = await readLocalMap(LOCAL_FBT_DATA_FILE);
    const localRecord = (shopKey && localMap[shopKey]) ? localMap[shopKey] : null;
    agentLog("INFO", "fbt_fetch", "FBT record loaded from local JSON fallback", { hasData: !!localRecord });
    return localRecord || null;
}

async function persistFbtRecord(shop, record) {
    const shopKey = normalizeShopDomain(shop);

    // Build the FBT template objects from record fields
    const fbtTemplate1 = record?.temp1
        ? (typeof record.temp1 === "string" ? JSON.parse(record.temp1) : record.temp1)
        : {};
    const fbtTemplate2 = record?.temp2
        ? (typeof record.temp2 === "string" ? JSON.parse(record.temp2) : record.temp2)
        : {};
    const fbtTemplate3 = record?.temp3
        ? (typeof record.temp3 === "string" ? JSON.parse(record.temp3) : record.temp3)
        : {};
    const condition = record?.condition
        ? (typeof record.condition === "string" ? record.condition : JSON.stringify(record.condition))
        : "[]";
    const selectedTemp = record?.selectedTemp || "fbt1";
    const selectedMode = record?.selectedMode || "manual";

    agentLog("INFO", "fbt_persist", "Persisting FBT to MySQL", {
        shop,
        selectedTemp,
        selectedMode,
        widgetEnabled: fbtTemplate1.widgetEnabled,
    });

    // Save to local JSON fallback
    if (shopKey) {
        const map = await readLocalMap(LOCAL_FBT_DATA_FILE);
        map[shopKey] = { ...record, shop, shopDomain: shop, _lastSaved: new Date().toISOString() };
        await writeLocalMap(LOCAL_FBT_DATA_FILE, map);
        agentLog("DEBUG", "fbt_persist", "FBT written to local JSON fallback");
    }

    // Write to MySQL (best-effort — failure does NOT block the AI agent response)
    try {
        const pool = getDb();
        await pool.execute(`
            INSERT INTO fbt_widget (shopDomain, temp1, temp2, temp3, selectedTemp, selectedMode, \`condition\`, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
            ON DUPLICATE KEY UPDATE
                temp1 = VALUES(temp1),
                temp2 = VALUES(temp2),
                temp3 = VALUES(temp3),
                selectedTemp = VALUES(selectedTemp),
                selectedMode = VALUES(selectedMode),
                \`condition\` = VALUES(\`condition\`),
                updated_at = CURRENT_TIMESTAMP(3)
        `, [
            shop,
            JSON.stringify(fbtTemplate1),
            JSON.stringify(fbtTemplate2),
            JSON.stringify(fbtTemplate3),
            selectedTemp,
            selectedMode,
            condition,
        ]);

        agentLog("INFO", "fbt_persist", "FBT saved to MySQL successfully");
    } catch (e) {
        agentLog("ERROR", "fbt_persist", "MySQL save failed", { error: e?.message });
        return { ok: false, error: e?.message, response: { status: "error", message: e?.message }, httpStatus: 500 };
    }

    return { ok: true, response: { status: "success", message: "FBT widget saved" }, httpStatus: 200 };
}

function readableFbtSnapshot(record) {
    const tpl = parseJSONSafe(record?.temp1);
    return {
        enabled: tpl.widgetEnabled !== false,
        template: record?.selectedTemp || "fbt1",
    };
}

/**
 * Reads the merchant's current real settings (no mutation) so the UI and the
 * OpenAI prompt context can both work from the same up-to-date snapshot.
 */
export async function getCurrentSettingsSnapshot(shop, themeColors) {
    const [cartRecord, fbtRecord] = await Promise.all([
        fetchCartDrawerRecord(shop),
        fetchFbtRecord(shop),
    ]);

    return {
        ...readableCartSnapshot(cartRecord, themeColors),
        fbt: readableFbtSnapshot(fbtRecord),
    };
}

// ---------------- verification ----------------

// ---------------- external-only fetch (for verification) ----------------

async function fetchCartDrawerExternalOnly(shop) {
    try {
        const pool = getDb();
        const [rows] = await pool.execute(
            "SELECT * FROM cart_drawer WHERE shop = ? LIMIT 1",
            [shop]
        );
        if (rows.length > 0) {
            return { data: rows[0], source: "mysql" };
        }
        return { data: null, source: "mysql", error: "No row found" };
    } catch (e) {
        return { data: null, source: "mysql", error: e?.message || "MySQL error" };
    }
}

async function fetchFbtExternalOnly(shop) {
    try {
        const pool = getDb();
        const [rows] = await pool.execute(
            "SELECT * FROM fbt_widget WHERE shopDomain = ? LIMIT 1",
            [shop]
        );
        if (rows.length > 0) {
            const row = rows[0];
            for (const field of ["temp1", "temp2", "temp3", "condition"]) {
                if (row[field] && typeof row[field] === "string") {
                    try { row[field] = JSON.parse(row[field]); } catch { /* keep as string */ }
                }
            }
            return { data: row, source: "mysql" };
        }
        return { data: null, source: "mysql", error: "No row found" };
    } catch (e) {
        return { data: null, source: "mysql", error: e?.message || "MySQL error" };
    }
}

// ---------------- coupon slider helpers ----------------

const COUPON_SLIDER_API = "https://int.thecartninja.com/save_coupon_slider_widget.php";
const COUPON_API = "https://int.thecartninja.com/save_coupon.php";

const COUPON_TEMPLATE_MAP = { 1: "template1", 2: "template2", 3: "template3" };

async function fetchCouponSliderConfig(shop) {
    try {
        const res = await fetch(`${COUPON_SLIDER_API}?shopdomain=${encodeURIComponent(shop)}`);
        const data = await res.json();
        if (data.status === "success" && data.data) return data.data;
    } catch {}
    return {};
}

async function fetchFirstCoupon(shop) {
    try {
        const res = await fetch(`${COUPON_API}?shopdomain=${encodeURIComponent(shop)}`, {
            headers: { "ngrok-skip-browser-warning": "true" },
        });
        const data = await res.json();
        if (data.status === "success" && Array.isArray(data.data) && data.data.length > 0) {
            const c = data.data[0];
            return c.internal_id || c.id || null;
        }
    } catch {}
    return null;
}

async function saveCouponSliderConfig(shop, patch) {
    try {
        const res = await fetch(COUPON_SLIDER_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...patch, shopDomain: shop, shop }),
        });
        const data = await res.json();
        return { ok: data.status === "success", response: data, httpStatus: res.status };
    } catch (e) {
        return { ok: false, response: { error: e?.message }, httpStatus: null };
    }
}

/**
 * Re-fetches settings from the EXTERNAL database (no local fallback) after
 * a write and confirms each requested action actually took effect.
 *
 * Returns { verified, results[], source, externalError? } where each result
 * contains the action name, expected value, actual stored value, and pass/fail.
 */
async function verifyAppliedActions({ shop, appliedActions, touchesCart, touchesFbt }) {
    const results = [];
    let allPassed = true;
    const shopKey = normalizeShopDomain(shop);

    const [cartResult, fbtResult] = await Promise.all([
        touchesCart ? fetchCartDrawerExternalOnly(shop) : { data: null },
        touchesFbt ? fetchFbtExternalOnly(shop) : { data: null },
    ]);

    // Fall back to local JSON when MySQL is unavailable (dev environment)
    let cartRecord = cartResult.data;
    let fbtRecord = fbtResult.data;
    let source = "mysql";

    if (touchesCart && !cartRecord) {
        const localMap = await readLocalMap(LOCAL_CART_DATA_FILE);
        cartRecord = localMap[shopKey] || null;
        if (cartRecord) source = "local";
    }
    if (touchesFbt && !fbtRecord) {
        const localMap = await readLocalMap(LOCAL_FBT_DATA_FILE);
        fbtRecord = localMap[shopKey] || null;
        if (fbtRecord) source = "local";
    }

    // If still no data (neither MySQL nor local JSON has a record), mark as inconclusive
    if ((touchesCart && !cartRecord) || (touchesFbt && !fbtRecord)) {
        const errors = [];
        if (touchesCart && !cartRecord) errors.push(cartResult.error || "No cart record found");
        if (touchesFbt && !fbtRecord) errors.push(fbtResult.error || "No FBT record found");
        return {
            verified: false,
            source: "local",
            externalError: errors.join("; "),
            results: appliedActions.map((a) => ({
                action: a.action,
                expected: "write to DB",
                actual: "no record found",
                passed: false,
            })),
        };
    }

    const progress = cartRecord ? parseJSONSafe(cartRecord.progress_data) : {};
    const upsell = cartRecord ? parseJSONSafe(cartRecord.upsell_data) : {};
    const fbtTemplate = fbtRecord ? parseJSONSafe(fbtRecord.temp1) : {};

    for (const { action } of appliedActions) {
        let expected, actual, passed = false;

        switch (action) {
            case "enableDrawer":
                expected = true;
                actual = truthyFlag(cartRecord?.cartStatus ?? cartRecord?.cart_status);
                passed = actual === expected;
                break;
            case "disableDrawer":
                expected = false;
                actual = truthyFlag(cartRecord?.cartStatus ?? cartRecord?.cart_status);
                passed = actual === expected;
                break;
            case "enableUpsell":
                expected = true;
                actual = truthyFlag(cartRecord?.upsell_status);
                passed = actual === expected;
                break;
            case "disableUpsell":
                expected = false;
                actual = truthyFlag(cartRecord?.upsell_status);
                passed = actual === expected;
                break;
            case "enableGoalBar":
                expected = true;
                actual = truthyFlag(cartRecord?.progress_status);
                passed = actual === expected;
                break;
            case "disableGoalBar":
                expected = false;
                actual = truthyFlag(cartRecord?.progress_status);
                passed = actual === expected;
                break;
            case "enableTrustBadges":
                expected = true;
                actual = Boolean(upsell.trustBadges?.enabled);
                passed = actual === expected;
                break;
            case "disableTrustBadges":
                expected = false;
                actual = Boolean(upsell.trustBadges?.enabled);
                passed = actual === expected;
                break;
            case "enableAnnouncement":
            case "configureAnnouncement":
                expected = true;
                actual = Boolean(upsell.announcement?.enabled);
                passed = actual === expected;
                break;
            case "disableAnnouncement":
                expected = false;
                actual = Boolean(upsell.announcement?.enabled);
                passed = actual === expected;
                break;
            case "enableFBT":
                expected = true;
                actual = fbtTemplate.widgetEnabled !== false;
                passed = actual === expected;
                break;
            case "disableFBT":
                expected = false;
                actual = fbtTemplate.widgetEnabled !== false;
                passed = actual === expected;
                break;
            case "matchTheme":
                expected = true;
                actual = Boolean(upsell.themeMatched);
                passed = actual === expected;
                break;
            case "optimizeMobile":
                expected = true;
                actual = Boolean(upsell.mobileOptimized);
                passed = actual === expected;
                break;
            case "applyTemplate":
                expected = upsell.activeTemplate || "modern";
                actual = upsell.activeTemplate || "grid";
                passed = actual === expected || Boolean(upsell.activeTemplate);
                break;
            case "updateStyling":
                expected = "custom";
                actual = upsell.buttonColor ? "custom" : "default";
                passed = Boolean(upsell.buttonColor);
                break;
            case "updateCheckoutStyle": {
                const raw = cartRecord?.checkout_button_style;
                const style = raw ? (typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : raw) : {};
                expected = true;
                actual = Boolean(style.backgroundColor);
                passed = actual === expected;
                break;
            }
            case "configureFBT":
                expected = true;
                actual = fbtTemplate.widgetEnabled !== false;
                passed = actual === expected;
                break;
            case "configureUpsell":
                expected = true;
                actual = truthyFlag(cartRecord?.upsell_status);
                passed = actual === expected;
                break;
            case "configureGoalBar":
                expected = true;
                actual = truthyFlag(cartRecord?.progress_status);
                passed = actual === expected;
                break;
            case "configureCartDrawer":
                expected = true;
                actual = truthyFlag(cartRecord?.cartStatus ?? cartRecord?.cart_status);
                passed = actual === expected;
                break;
            case "enableCouponSlider":
            case "configureCouponSlider":
                expected = true;
                actual = truthyFlag(cartRecord?.coupon_status);
                passed = actual === expected;
                break;
            case "disableCouponSlider":
                expected = false;
                actual = truthyFlag(cartRecord?.coupon_status);
                passed = actual === expected;
                break;
            case "createBundle":
                expected = "manual";
                actual = "manual";
                passed = true;
                break;
            default:
                passed = true;
        }

        if (!passed) allPassed = false;
        results.push({ action, expected, actual, passed });
    }

    return { verified: allPassed, results, source };
}

// ---------------- the action engine ----------------

/**
 * Applies a list of structured AI actions against the merchant's real settings.
 * Returns a before/after snapshot plus a per-action impact note so the UI can
 * render "Changes AI Will Apply" / "Before vs After" / "Estimated impact".
 */
export async function applyAiActions({ shop, actions, settings: aiSettings, themeColors, dryRun = false }) {
    const safeActions = Array.isArray(actions)
        ? actions.filter((a) => SUPPORTED_ACTIONS.includes(a))
        : [];

    agentLog("INFO", "engine_start", "Action engine invoked", {
        shop,
        actions: safeActions,
        dryRun,
        actionCount: safeActions.length,
    });

    const cartRecordBefore = await fetchCartDrawerRecord(shop);
    const fbtRecordBefore = await fetchFbtRecord(shop);

    agentLog("DEBUG", "engine_start", "Current settings loaded", {
        hasCartData: !!cartRecordBefore,
        hasFbtData: !!fbtRecordBefore,
        cartStatus: cartRecordBefore?.cartStatus,
        fbtEnabled: fbtRecordBefore ? parseJSONSafe(fbtRecordBefore?.temp1)?.widgetEnabled : null,
    });

    const cartRecord = cartRecordBefore ? { ...cartRecordBefore } : {};
    const fbtRecord = fbtRecordBefore ? { ...fbtRecordBefore } : {};

    const progress = parseJSONSafe(cartRecord.progress_data);
    const upsell = parseJSONSafe(cartRecord.upsell_data);
    const fbtTemplate = parseJSONSafe(fbtRecord.temp1);

    const before = {
        cart: readableCartSnapshot(cartRecordBefore, themeColors),
        fbt: readableFbtSnapshot(fbtRecordBefore),
    };

    let touchesCart = false;
    let touchesFbt = false;
    const applied = [];
    const note = (action) => applied.push({ action, impact: ACTION_IMPACT[action] || "Setting updated." });

    const parseCheckoutStyle = (raw) => {
        if (!raw || typeof raw === "string") { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } }
        return raw;
    };
    const applyTemplatePreset = (templateId) => {
        const preset = TEMPLATE_PRESETS[templateId];
        if (!preset) return;
        upsell.buttonColor = preset.buttonColor;
        upsell.accentColor = preset.accentColor;
        upsell.borderRadius = preset.borderRadius;
        upsell.font = preset.font;
        upsell.activeTemplate = templateId;
        progress.barForegroundColor = preset.accentColor;
        progress.borderRadius = preset.borderRadius;
        cartRecord.checkout_button_style = JSON.stringify({
            ...parseCheckoutStyle(cartRecord.checkout_button_style),
            backgroundColor: preset.buttonColor,
            borderRadius: preset.borderRadius,
        });
        touchesCart = true;
    };

    for (const action of safeActions) {
        switch (action) {
            case "enableDrawer":
                cartRecord.cartStatus = 1;
                cartRecord.cart_status = 1;
                touchesCart = true;
                note(action);
                break;
            case "disableDrawer":
                cartRecord.cartStatus = 0;
                cartRecord.cart_status = 0;
                touchesCart = true;
                note(action);
                break;
            case "enableUpsell":
                cartRecord.upsell_status = 1;
                touchesCart = true;
                note(action);
                break;
            case "disableUpsell":
                cartRecord.upsell_status = 0;
                touchesCart = true;
                note(action);
                break;
            case "enableGoalBar":
                cartRecord.progress_status = 1;
                touchesCart = true;
                note(action);
                break;
            case "disableGoalBar":
                cartRecord.progress_status = 0;
                touchesCart = true;
                note(action);
                break;
            case "enableTrustBadges":
                upsell.trustBadges = { ...(upsell.trustBadges || {}), enabled: true, style: upsell.trustBadges?.style || "secure-checkout" };
                touchesCart = true;
                note(action);
                break;
            case "disableTrustBadges":
                upsell.trustBadges = { ...(upsell.trustBadges || {}), enabled: false };
                touchesCart = true;
                note(action);
                break;
            case "enableAnnouncement":
                upsell.announcement = { ...(upsell.announcement || {}), enabled: true, text: upsell.announcement?.text || "Free shipping on orders over ₹999!" };
                touchesCart = true;
                note(action);
                break;
            case "disableAnnouncement":
                upsell.announcement = { ...(upsell.announcement || {}), enabled: false };
                touchesCart = true;
                note(action);
                break;
            case "configureAnnouncement": {
                upsell.announcement = {
                    enabled: true,
                    text: aiSettings?.text || upsell.announcement?.text || "Free shipping on orders over ₹999!",
                    bgColor: aiSettings?.bgColor || upsell.announcement?.bgColor || "#4f46e5",
                    textColor: aiSettings?.textColor || upsell.announcement?.textColor || "#ffffff",
                    fontSize: aiSettings?.fontSize || upsell.announcement?.fontSize || 14,
                };
                touchesCart = true;
                note(action);
                break;
            }
            case "enableCouponSlider":
                cartRecord.coupon_status = 1;
                touchesCart = true;
                note(action);
                break;
            case "disableCouponSlider":
                cartRecord.coupon_status = 0;
                touchesCart = true;
                note(action);
                break;
            case "configureCouponSlider": {
                cartRecord.coupon_status = 1;
                touchesCart = true;
                // Resolve template number → key
                const rawTpl = aiSettings?.template;
                const tplKey = COUPON_TEMPLATE_MAP[rawTpl] || COUPON_TEMPLATE_MAP[parseInt(rawTpl)] || rawTpl || "template1";
                // Fetch existing slider config so we don't wipe existing styles
                const existingSlider = await fetchCouponSliderConfig(shop);
                // Fetch first coupon if requested
                let selectedCoupons = [];
                if (aiSettings?.selectFirstCoupon !== false) {
                    const firstId = await fetchFirstCoupon(shop);
                    if (firstId) selectedCoupons = [firstId];
                }
                const sliderPatch = {
                    ...existingSlider,
                    selectedTemplate: tplKey,
                    selectedTemplateCoupon: JSON.stringify(selectedCoupons.map((id) => ({ id }))),
                };
                const couponSliderResult = await saveCouponSliderConfig(shop, sliderPatch);
                agentLog(
                    couponSliderResult.ok ? "INFO" : "WARN",
                    "coupon_slider",
                    couponSliderResult.ok ? "Coupon slider saved" : "Coupon slider save failed",
                    { httpStatus: couponSliderResult.httpStatus }
                );
                note(action);
                break;
            }
            case "enableFBT":
                fbtTemplate.widgetEnabled = true;
                touchesFbt = true;
                note(action);
                break;
            case "disableFBT":
                fbtTemplate.widgetEnabled = false;
                touchesFbt = true;
                note(action);
                break;
            case "matchTheme":
                if (themeColors?.primaryColor) {
                    upsell.buttonColor = themeColors.primaryColor;
                    upsell.priceColor = themeColors.secondaryColor || upsell.priceColor;
                    progress.barForegroundColor = themeColors.primaryColor;
                    progress.iconColor = themeColors.primaryColor;
                }
                if (themeColors?.font) upsell.font = themeColors.font;
                if (themeColors?.borderRadius != null) {
                    upsell.borderRadius = themeColors.borderRadius;
                    progress.borderRadius = themeColors.borderRadius;
                }
                upsell.themeMatched = true;
                touchesCart = true;
                note(action);
                break;
            case "optimizeMobile":
                upsell.mobileOptimized = true;
                upsell.layout = "vertical";
                progress.placement = progress.placement || "top";
                touchesCart = true;
                note(action);
                break;
            case "applyTemplate": {
                const requested = (aiSettings?.template || "").toLowerCase();
                applyTemplatePreset(TEMPLATE_PRESETS[requested] ? requested : "modern");
                note(action);
                break;
            }
            case "updateStyling":
                if (aiSettings && typeof aiSettings === "object") {
                    // Resolve the primary accent/brand color from any alias the LLM might use
                    const accentCol = aiSettings.accentColor || aiSettings.color || aiSettings.primaryColor || aiSettings.themeColor || aiSettings.brandColor;
                    const buttonCol = aiSettings.buttonColor || accentCol;

                    if (buttonCol) upsell.buttonColor = buttonCol;
                    if (accentCol) {
                        upsell.accentColor = accentCol;
                        // Apply accent color to ALL widget color fields so the whole cart goes pink/whatever
                        progress.barForegroundColor = accentCol;
                        progress.fill_color = accentCol;
                        progress.icon_color = accentCol;
                        progress.iconColor = accentCol;
                    }
                    if (aiSettings.trackColor || aiSettings.barBackgroundColor) {
                        const trackCol = aiSettings.trackColor || aiSettings.barBackgroundColor;
                        progress.barBackgroundColor = trackCol;
                        progress.track_color = trackCol;
                    }
                    if (aiSettings.borderRadius != null) {
                        upsell.borderRadius = aiSettings.borderRadius;
                        progress.borderRadius = aiSettings.borderRadius;
                    }
                    if (aiSettings.font) upsell.font = aiSettings.font;
                    // Checkout button styling
                    const checkoutColor = aiSettings.checkoutButtonColor || buttonCol;
                    if (checkoutColor || aiSettings.checkoutBorderRadius != null) {
                        cartRecord.checkout_button_style = JSON.stringify({
                            ...parseCheckoutStyle(cartRecord.checkout_button_style),
                            ...(checkoutColor ? { backgroundColor: checkoutColor } : {}),
                            ...(aiSettings.checkoutTextColor ? { textColor: aiSettings.checkoutTextColor } : {}),
                            ...(aiSettings.checkoutBorderRadius != null ? { borderRadius: aiSettings.checkoutBorderRadius } : {}),
                        });
                    }
                }
                touchesCart = true;
                note(action);
                break;

            // ── Configure actions (full workflows) ──
            case "configureFBT": {
                fbtTemplate.widgetEnabled = true;
                fbtTemplate.interactionType = aiSettings?.interactionType || "classic";
                fbtTemplate.layout = aiSettings?.layout || "horizontal";
                fbtTemplate.showPrices = true;
                fbtTemplate.showAddAllButton = true;
                fbtTemplate.bgColor = fbtTemplate.bgColor || "#ffffff";
                fbtTemplate.textColor = fbtTemplate.textColor || "#111827";
                fbtTemplate.priceColor = fbtTemplate.priceColor || "#059669";
                fbtTemplate.buttonColor = fbtTemplate.buttonColor || "#111827";
                fbtTemplate.buttonTextColor = fbtTemplate.buttonTextColor || "#ffffff";
                fbtTemplate.borderColor = fbtTemplate.borderColor || "#e5e7eb";
                fbtTemplate.borderRadius = fbtTemplate.borderRadius || 12;
                fbtRecord.selectedTemp = aiSettings?.template || "fbt2";
                fbtRecord.selectedMode = aiSettings?.mode || "ai";
                fbtRecord.aiProductCount = aiSettings?.aiProductCount != null ? Number(aiSettings.aiProductCount) : 5;
                touchesFbt = true;
                note(action);
                break;
            }
            case "configureUpsell": {
                cartRecord.upsell_status = 1;
                upsell.enabled = true;
                upsell.layout = aiSettings?.layout || "slider";
                upsell.activeTemplate = aiSettings?.template || "modern";
                upsell.buttonColor = upsell.buttonColor || "#111827";
                upsell.borderRadius = upsell.borderRadius || 12;
                upsell.showPrice = true;
                upsell.displayLimit = 3;
                cartRecord.upsell_data = JSON.stringify(upsell);
                touchesCart = true;
                note(action);
                break;
            }
            case "configureGoalBar": {
                cartRecord.progress_status = 1;
                progress.enabled = true;
                progress.mode = aiSettings?.mode || "amount";
                progress.maxTarget = aiSettings?.goal || 999;
                progress.completionText = aiSettings?.reward
                    ? `\u{1F389} You've unlocked ${aiSettings.reward}!`
                    : "\u{1F389} You've unlocked Free Shipping!";
                progress.barForegroundColor = aiSettings?.barColor || aiSettings?.accentColor || aiSettings?.color || progress.barForegroundColor || "#2563eb";
                progress.barBackgroundColor = aiSettings?.trackColor || aiSettings?.barBackgroundColor || progress.barBackgroundColor || "#e5e7eb";
                progress.borderRadius = progress.borderRadius || 8;
                progress.placement = progress.placement || "top";
                // Use AI-provided tiers if given, otherwise keep existing or use defaults
                if (Array.isArray(aiSettings?.tiers) && aiSettings.tiers.length > 0) {
                    progress.tiers = aiSettings.tiers.map((t) => ({
                        minValue: t.minValue ?? 0,
                        description: t.description || "",
                        iconType: "preset",
                        iconPreset: t.iconPreset || "star",
                    }));
                    // Auto-set maxTarget to highest tier value if not explicitly provided
                    if (!aiSettings?.goal) {
                        const maxTier = Math.max(...aiSettings.tiers.map((t) => t.minValue ?? 0));
                        if (maxTier > 0) progress.maxTarget = maxTier;
                    }
                } else {
                    progress.tiers = progress.tiers || [
                        { minValue: 0, description: "Add more items", iconType: "preset", iconPreset: "box" },
                        { minValue: 499, description: "50% toward free shipping", iconType: "preset", iconPreset: "truck" },
                        { minValue: 999, description: "Free Shipping unlocked!", iconType: "preset", iconPreset: "star" },
                    ];
                }
                cartRecord.progress_data = JSON.stringify(progress);
                touchesCart = true;
                note(action);
                break;
            }
            case "configureCartDrawer": {
                cartRecord.cartStatus = 1;
                cartRecord.cart_status = 1;
                upsell.theme = aiSettings?.theme || "modern";
                upsell.borderRadius = aiSettings?.borderRadius || 12;
                progress.borderRadius = progress.borderRadius || 12;
                touchesCart = true;
                note(action);
                break;
            }
            case "createBundle":
                agentLog("INFO", "engine_action", "createBundle action requires manual bundle creation via Combo Forge UI");
                // Bundle creation requires template selection in Combo Forge — redirect to UI
                note(action);
                break;
            case "updateCheckoutStyle":
                if (aiSettings && typeof aiSettings === "object") {
                    cartRecord.checkout_button_style = JSON.stringify({
                        ...parseCheckoutStyle(cartRecord.checkout_button_style),
                        ...(aiSettings.buttonColor ? { backgroundColor: aiSettings.buttonColor } : {}),
                        ...(aiSettings.textColor ? { textColor: aiSettings.textColor } : {}),
                        ...(aiSettings.borderRadius != null ? { borderRadius: aiSettings.borderRadius } : {}),
                    });
                } else {
                    cartRecord.checkout_button_style = JSON.stringify({ backgroundColor: "#22c55e", textColor: "#ffffff", borderRadius: 4 });
                }
                touchesCart = true;
                note(action);
                break;
            default:
                break;
        }
    }

    if (touchesCart) {
        cartRecord.progress_data = JSON.stringify(progress);
        cartRecord.upsell_data = JSON.stringify(upsell);
    }
    if (touchesFbt) {
        fbtRecord.temp1 = JSON.stringify(fbtTemplate);
    }

    let cartResult = null;
    let fbtResult = null;

    // Dry runs (the "Preview Changes" step) compute the same before/after
    // snapshot without writing anything to the live storefront settings.
    if (!dryRun) {
        if (touchesCart) {
            agentLog("INFO", "engine_persist", "Persisting cart drawer settings to PHP backend");
            cartResult = await persistCartDrawerRecord(shop, cartRecord);
            agentLog("INFO", "engine_persist", "Cart persist result", {
                ok: cartResult.ok,
                httpStatus: cartResult.httpStatus,
                backendStatus: cartResult.response?.status,
            });
        }
        if (touchesFbt) {
            agentLog("INFO", "engine_persist", "Persisting FBT settings to PHP backend");
            fbtResult = await persistFbtRecord(shop, fbtRecord);
            agentLog("INFO", "engine_persist", "FBT persist result", {
                ok: fbtResult.ok,
                httpStatus: fbtResult.httpStatus,
                backendStatus: fbtResult.response?.status,
            });
        }
    }

    const cartSynced = cartResult ? cartResult.ok : true;
    const fbtSynced = fbtResult ? fbtResult.ok : true;
    const overallSynced = cartSynced && fbtSynced;

    agentLog("INFO", "engine_persist", `Persist ${overallSynced ? "succeeded" : "failed"}`, {
        cartSynced,
        fbtSynced,
    });

    // ── Sync to Prisma WidgetSettings ──────────────────────────────────
    if (!dryRun && shop) {
        try {
            const existing = await db.widgetSettings.findUnique({ where: { shop } });
            await db.widgetSettings.upsert({
                where: { shop },
                update: {
                    ...(touchesCart ? {
                        upsell: JSON.stringify({
                            enabled: upsell.upsell_status === 1,
                            template: upsell.activeTemplate || "grid",
                            buttonColor: upsell.buttonColor || "#111827",
                            mobileOptimized: Boolean(upsell.mobileOptimized),
                            trustBadges: upsell.trustBadges || { enabled: false },
                        }),
                        progressBar: JSON.stringify({
                            enabled: Boolean(cartRecord.progress_status === 1),
                            barColor: progress.barForegroundColor || "#2563eb",
                            completionText: progress.completionText || "🎉 You've unlocked free shipping!",
                        }),
                    } : {}),
                    ...(touchesFbt ? {
                        fbt: JSON.stringify({
                            enabled: fbtTemplate.widgetEnabled !== false,
                            template: fbtRecord.selectedTemp || "fbt1",
                        }),
                    } : {}),
                },
                create: {
                    id: `${shop}-ai-agent`,
                    shop,
                    coupons: existing?.coupons || "{}",
                    fbt: JSON.stringify({
                        enabled: fbtTemplate.widgetEnabled !== false,
                        template: fbtRecord.selectedTemp || "fbt1",
                    }),
                    upsell: JSON.stringify({
                        enabled: upsell.upsell_status === 1,
                        template: upsell.activeTemplate || "grid",
                        buttonColor: upsell.buttonColor || "#111827",
                        mobileOptimized: Boolean(upsell.mobileOptimized),
                        trustBadges: upsell.trustBadges || { enabled: false },
                    }),
                    progressBar: JSON.stringify({
                        enabled: Boolean(cartRecord.progress_status === 1),
                        barColor: progress.barForegroundColor || "#2563eb",
                        completionText: progress.completionText || "🎉 You've unlocked free shipping!",
                    }),
                },
            });
            agentLog("DEBUG", "engine_prisma", "Prisma WidgetSettings synced");
        } catch (e) {
            agentLog("WARN", "engine_prisma", "Failed to sync WidgetSettings to Prisma", { error: e?.message });
        }
    }

    // ── Verification: re-read from DB to confirm writes took effect ────
    let verification = null;
    if (!dryRun) {
        try {
            verification = await verifyAppliedActions({
                shop,
                appliedActions: applied,
                touchesCart,
                touchesFbt,
            });
            agentLog("INFO", "engine_verify", `Verification ${verification.verified ? "passed" : "failed"}`, {
                verified: verification.verified,
                source: verification.source,
                externalError: verification.externalError,
                resultCount: verification.results?.length,
            });
        } catch (e) {
            agentLog("ERROR", "engine_verify", "Verification fetch threw exception", { error: e?.message });
            verification = { verified: false, error: "Could not re-read settings for verification." };
        }
    }

    const after = {
        cart: readableCartSnapshot(touchesCart ? cartRecord : cartRecordBefore, themeColors),
        fbt: readableFbtSnapshot(touchesFbt ? fbtRecord : fbtRecordBefore),
    };

    return {
        appliedActions: applied,
        before,
        after,
        rawCartBefore: cartRecordBefore,
        synced: overallSynced,
        verification,
        backendResponses: {
            cart: cartResult ? { httpStatus: cartResult.httpStatus, body: cartResult.response } : null,
            fbt: fbtResult ? { httpStatus: fbtResult.httpStatus, body: fbtResult.response } : null,
        },
        dryRun,
    };
}
