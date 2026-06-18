import { validateRequestBody, validateFBTConfig } from "../validators/product-sample.validator.js";
import { getDb } from "../services/db.server";

/* ---------------- DEFAULTS ---------------- */

const DEFAULT_AI_SETTINGS = {
    aiEnabled: false,
    aiProductCount: 3,
    maxSuggestions: 3,
    customPrompt: "",
};

const DEFAULT_FBT_DATA = {
    activeTemplate: "fbt1",
    mode: "manual",
    templates: {
        fbt1: {
            name: "Classic Grid",
            layout: "horizontal",
            interactionType: "classic",
            bgColor: "#ffffff",
            textColor: "#111827",
            priceColor: "#059669",
            buttonColor: "#111827",
            buttonTextColor: "#ffffff",
            borderColor: "#e5e7eb",
            borderRadius: 8,
            showPrices: true,
            showAddAllButton: true,
        },
        fbt2: {
            name: "Modern Cards",
            layout: "horizontal",
            interactionType: "bundle",
            bgColor: "#f9fafb",
            textColor: "#374151",
            priceColor: "#dc2626",
            buttonColor: "#4f46e5",
            buttonTextColor: "#ffffff",
            borderColor: "#d1d5db",
            borderRadius: 12,
            showPrices: true,
            showAddAllButton: true,
        },
        fbt3: {
            name: "Vertical List",
            layout: "vertical",
            interactionType: "quickAdd",
            bgColor: "#ffffff",
            textColor: "#1f2937",
            priceColor: "#2563eb",
            buttonColor: "#10b981",
            buttonTextColor: "#ffffff",
            borderColor: "#f3f4f6",
            borderRadius: 4,
            showPrices: true,
            showAddAllButton: true,
        },
    },
    aiSettings: { ...DEFAULT_AI_SETTINGS },
    manualRules: [],
};

function normalizeAiSettings(rawSettings) {
    const source = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
    const parsedLimit = Number.parseInt(source.aiProductCount ?? source.maxSuggestions, 10);
    const maxSuggestions = Number.isFinite(parsedLimit)
        ? Math.min(20, Math.max(1, parsedLimit))
        : DEFAULT_AI_SETTINGS.maxSuggestions;
    const aiEnabled = source.aiEnabled === true || source.aiEnabled === 1 || source.aiEnabled === "1";
    return {
        aiEnabled,
        aiProductCount: maxSuggestions,
        maxSuggestions,
        customPrompt: typeof source.customPrompt === "string"
            ? source.customPrompt.slice(0, 1000)
            : DEFAULT_AI_SETTINGS.customPrompt,
    };
}

function parseJson(val, fallback) {
    if (!val) return fallback;
    if (typeof val === "object") return val;
    try { return JSON.parse(val); } catch { return fallback; }
}

/* ---------------- DB HELPERS ---------------- */

async function fetchFbtRow(shopDomain) {
    const db = getDb();
    const [rows] = await db.execute(
        'SELECT * FROM fbt_widget WHERE shopDomain = ? LIMIT 1',
        [shopDomain]
    );
    return rows[0] || null;
}

function rowToFbt(row) {
    return {
        activeTemplate: row.selectedTemp || "fbt1",
        mode: row.selectedMode || "manual",
        templates: {
            fbt1: parseJson(row.temp1, DEFAULT_FBT_DATA.templates.fbt1),
            fbt2: parseJson(row.temp2, DEFAULT_FBT_DATA.templates.fbt2),
            fbt3: parseJson(row.temp3, DEFAULT_FBT_DATA.templates.fbt3),
        },
        manualRules: parseJson(row.condition, []),
        aiSettings: {
            ...DEFAULT_AI_SETTINGS,
            aiEnabled: row.ai_enabled === 1 || row.ai_enabled === true,
            aiProductCount: row.ai_product_count != null ? Number(row.ai_product_count) : DEFAULT_AI_SETTINGS.aiProductCount,
        },
    };
}

/* ---------------- LOADER ---------------- */

export async function loader({ request }) {
    const url = new URL(request.url);
    const shopDomain = url.searchParams.get("shopdomain");

    if (!shopDomain) {
        return Response.json({ success: true, fbt: { ...DEFAULT_FBT_DATA, manualRules: [] } });
    }

    try {
        const row = await fetchFbtRow(shopDomain);
        if (row) {
            return Response.json({ success: true, fbt: rowToFbt(row) });
        }
    } catch (e) {
        console.error("[FBT loader] DB read failed:", e.message);
    }

    return Response.json({ success: true, fbt: { ...DEFAULT_FBT_DATA, manualRules: [] } });
}

/* ---------------- ACTION ---------------- */

export async function action({ request }) {
    if (request.method !== "POST") {
        return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    try {
        const data = await request.json();
        const { actionType, shop } = data;

        const bodyCheck = validateRequestBody(data);
        if (bodyCheck.status === "error") {
            return Response.json({ success: false, errors: bodyCheck.errors }, { status: 400 });
        }

        if (actionType !== "saveFBTConfig") {
            return Response.json({ success: false, error: "Unsupported actionType" }, { status: 400 });
        }

        const configCheck = validateFBTConfig(data);
        if (configCheck.status === "error") {
            return Response.json({ success: false, errors: configCheck.errors }, { status: 400 });
        }

        const { activeTemplate, templateData: rawTemplateData, mode, configData: rawConfigData, aiSettings: rawAiSettings } = data;

        const templates = parseJson(rawTemplateData, {});
        const manualRules = parseJson(rawConfigData, []);
        const aiSettings = normalizeAiSettings(parseJson(rawAiSettings, {}));

        const db = getDb();
        await db.execute(
            `INSERT INTO fbt_widget
                (shopDomain, temp1, temp2, temp3, selectedTemp, selectedMode, \`condition\`, ai_enabled, ai_product_count, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
             ON DUPLICATE KEY UPDATE
                temp1 = VALUES(temp1),
                temp2 = VALUES(temp2),
                temp3 = VALUES(temp3),
                selectedTemp = VALUES(selectedTemp),
                selectedMode = VALUES(selectedMode),
                \`condition\` = VALUES(\`condition\`),
                ai_enabled = VALUES(ai_enabled),
                ai_product_count = VALUES(ai_product_count),
                updated_at = CURRENT_TIMESTAMP(3)`,
            [
                shop,
                templates.fbt1 ? JSON.stringify(templates.fbt1) : null,
                templates.fbt2 ? JSON.stringify(templates.fbt2) : null,
                templates.fbt3 ? JSON.stringify(templates.fbt3) : null,
                activeTemplate || "fbt1",
                mode || "manual",
                JSON.stringify(manualRules),
                aiSettings.aiEnabled ? 1 : 0,
                aiSettings.aiProductCount || 0,
            ]
        );

        return Response.json({
            success: true,
            message: "FBT configuration saved successfully!",
            shop,
        });

    } catch (error) {
        console.error("[FBT action] Error:", error.message);
        return Response.json({ success: false, error: "Internal error" }, { status: 500 });
    }
}
