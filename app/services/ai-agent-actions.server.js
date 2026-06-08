/**
 * AI Agent — Action Engine
 *
 * Converts the structured `actions` array returned by OpenAI into real changes
 * on the same settings store the Cart Editor / FBT pages read and write
 * (the external Cart Ninja PHP backend, with a local JSON fallback file —
 * the same resilience pattern used by api.cartdrawer-config.jsx).
 *
 * The AI never edits theme files or generates code — it only ever flips these
 * known settings.
 */

import { promises as fs } from "fs";
import path from "path";

const EXTERNAL_CART_API = "https://int.thecartninja.com/save_cart_drawer.php";
const EXTERNAL_FBT_API = "https://int.thecartninja.com/save_fbt_widget.php";
const LOCAL_CART_DATA_FILE = path.resolve("cartdrawer-config-data.json");
const LOCAL_FBT_DATA_FILE = path.resolve("ai-agent-fbt-data.json");

const FETCH_HEADERS = { "ngrok-skip-browser-warning": "true" };

export const SUPPORTED_ACTIONS = [
    "enableDrawer", "disableDrawer",
    "enableUpsell", "disableUpsell",
    "enableFBT", "disableFBT",
    "enableGoalBar", "disableGoalBar",
    "enableTrustBadges", "disableTrustBadges",
    "matchTheme", "optimizeMobile",
    "applyTemplate", "updateStyling",
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
    enableUpsell: "Enable Upsell Recommendations",
    disableUpsell: "Disable Upsell Recommendations",
    enableFBT: "Enable Frequently Bought Together",
    disableFBT: "Disable Frequently Bought Together",
    enableGoalBar: "Enable Free Shipping Goal Bar",
    disableGoalBar: "Disable Free Shipping Goal Bar",
    enableTrustBadges: "Enable Trust Badges",
    disableTrustBadges: "Disable Trust Badges",
    matchTheme: "Match Theme Colors & Font",
    optimizeMobile: "Optimize Mobile Layout",
    applyTemplate: "Apply Style Template",
    updateStyling: "Update Cart Styling",
};

export const ACTION_IMPACT = {
    enableDrawer:        "Keeps shoppers on-page and reduces checkout drop-off — drawer carts typically lift conversion by 5–10%.",
    disableDrawer:       "Cart drawer turned off — shoppers will use the standard cart page instead.",
    enableUpsell:        "Surfacing related products in the cart can grow average order value by 10–15%.",
    disableUpsell:       "Upsell recommendations hidden from the cart.",
    enableFBT:           "\"Frequently Bought Together\" bundles often add 5–8% to order value on product pages.",
    disableFBT:          "Frequently Bought Together widget hidden from product pages.",
    enableGoalBar:       "Free shipping goal bars are one of the strongest AOV levers — often +8–12% per order.",
    disableGoalBar:      "Free shipping progress bar removed from the cart.",
    enableTrustBadges:   "Trust badges near checkout reduce cart abandonment by reassuring shoppers about security.",
    disableTrustBadges:  "Trust badges removed from the cart.",
    matchTheme:          "Cart now mirrors your storefront's colors and font for a seamless, on-brand feel.",
    optimizeMobile:      "Layout tuned for small screens — larger tap targets and stacked content for mobile shoppers.",
    applyTemplate:       "A complete style preset applied across the cart, upsell and goal bar widgets.",
    updateStyling:       "Custom styling preferences applied to the cart drawer.",
};

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
        const res = await fetch(`${EXTERNAL_CART_API}?shopdomain=${encodeURIComponent(shop)}`, {
            method: "GET",
            headers: FETCH_HEADERS,
        });
        if (res.ok) {
            const body = await res.json();
            if (body?.status === "success" && body?.data) {
                return body.data;
            }
        }
    } catch (e) {
        console.warn("[AI Agent] External cart drawer fetch failed, using local fallback:", e?.message);
    }

    const localMap = await readLocalMap(LOCAL_CART_DATA_FILE);
    return (shopKey && localMap[shopKey]) ? localMap[shopKey] : null;
}

export async function persistCartDrawerRecord(shop, record) {
    const shopKey = normalizeShopDomain(shop);
    const payload = { ...record, shop, shopDomain: shop };

    if (shopKey) {
        const map = await readLocalMap(LOCAL_CART_DATA_FILE);
        map[shopKey] = payload;
        await writeLocalMap(LOCAL_CART_DATA_FILE, map);
    }

    try {
        const res = await fetch(EXTERNAL_CART_API, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(payload),
        });
        return res.ok;
    } catch (e) {
        console.warn("[AI Agent] External cart drawer sync failed (local fallback saved):", e?.message);
        return false;
    }
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
            mobileOptimized: Boolean(upsell.mobileOptimized),
        },
        goalBar: {
            enabled: truthyFlag(record?.progress_status),
            barColor: progress.barForegroundColor || themeColors?.primaryColor || "#2563eb",
            completionText: progress.completionText || "🎉 You've unlocked free shipping!",
        },
        trustBadges: {
            enabled: Boolean(upsell.trustBadges?.enabled),
            style: upsell.trustBadges?.style || "secure-checkout",
        },
    };
}

// ---------------- FBT settings ----------------

async function fetchFbtRecord(shop) {
    const shopKey = normalizeShopDomain(shop);

    try {
        const res = await fetch(`${EXTERNAL_FBT_API}?shopdomain=${encodeURIComponent(shop)}`, {
            method: "GET",
            headers: FETCH_HEADERS,
        });
        if (res.ok) {
            const body = await res.json();
            if (body?.status === "success" && body?.data) {
                return body.data;
            }
        }
    } catch (e) {
        console.warn("[AI Agent] External FBT fetch failed, using local fallback:", e?.message);
    }

    const localMap = await readLocalMap(LOCAL_FBT_DATA_FILE);
    return (shopKey && localMap[shopKey]) ? localMap[shopKey] : null;
}

async function persistFbtRecord(shop, record) {
    const shopKey = normalizeShopDomain(shop);
    const payload = { ...record, shop, shopDomain: shop };

    if (shopKey) {
        const map = await readLocalMap(LOCAL_FBT_DATA_FILE);
        map[shopKey] = payload;
        await writeLocalMap(LOCAL_FBT_DATA_FILE, map);
    }

    try {
        const res = await fetch(EXTERNAL_FBT_API, {
            method: "POST",
            headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
            body: JSON.stringify(payload),
        });
        return res.ok;
    } catch (e) {
        console.warn("[AI Agent] External FBT sync failed (local fallback saved):", e?.message);
        return false;
    }
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

    const cartRecordBefore = await fetchCartDrawerRecord(shop);
    const fbtRecordBefore = await fetchFbtRecord(shop);

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
                    if (aiSettings.buttonColor) upsell.buttonColor = aiSettings.buttonColor;
                    if (aiSettings.accentColor) upsell.accentColor = aiSettings.accentColor;
                    if (aiSettings.borderRadius != null) {
                        upsell.borderRadius = aiSettings.borderRadius;
                        progress.borderRadius = aiSettings.borderRadius;
                    }
                    if (aiSettings.font) upsell.font = aiSettings.font;
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

    let cartSynced = true;
    let fbtSynced = true;

    // Dry runs (the "Preview Changes" step) compute the same before/after
    // snapshot without writing anything to the live storefront settings.
    if (!dryRun) {
        if (touchesCart) cartSynced = await persistCartDrawerRecord(shop, cartRecord);
        if (touchesFbt) fbtSynced = await persistFbtRecord(shop, fbtRecord);
    }

    const after = {
        cart: readableCartSnapshot(touchesCart ? cartRecord : cartRecordBefore, themeColors),
        fbt: readableFbtSnapshot(touchesFbt ? fbtRecord : fbtRecordBefore),
    };

    return {
        appliedActions: applied,
        before,
        after,
        synced: dryRun ? true : (cartSynced && fbtSynced),
        dryRun,
    };
}
