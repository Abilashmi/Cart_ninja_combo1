/**
 * POST /api/ai-agent/generate
 *
 * Takes a merchant's natural-language prompt, gathers store/cart/theme/catalog
 * context, and asks OpenAI to convert it into a structured plan of supported
 * actions. The model never generates code, CSS or HTML — only JSON describing
 * which of The Cart Ninja's built-in actions to run.
 *
 * OpenAI key is read from process.env.OPENAI_API_KEY — never sent to the client.
 */

import { authenticate } from "../shopify.server";
import { analyzeThemeColors } from "../services/ai-agent-theme.server";
import {
    SUPPORTED_ACTIONS,
    TEMPLATE_PRESETS,
    ACTION_LABELS,
    ACTION_IMPACT,
    getCurrentSettingsSnapshot,
} from "../services/ai-agent-actions.server";

// eslint-disable-next-line no-undef
const NVIDIA_API_KEY = process.env.OPENAI_API_KEY || "";
const NVIDIA_MODEL = "meta/llama-3.1-8b-instruct";
const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

const SYSTEM_PROMPT = `You are an ecommerce cart optimization expert.

Your job is to analyze merchant requests and convert them into structured actions for The Cart Ninja app.

Never generate code.
Never generate CSS.
Never generate HTML.
Only return valid JSON.

Supported Actions:
${SUPPORTED_ACTIONS.join("\n")}

Supported Templates:
${Object.keys(TEMPLATE_PRESETS).join("\n")}

Output Format:
{
"summary": "",
"actions": [],
"settings": {}
}

Example Merchant Prompt:
Enable cart drawer and match my theme.

Expected Output:
{
"summary": "Enable cart drawer and apply store theme styling",
"actions": ["enableDrawer", "matchTheme"],
"settings": { "template": "modern" }
}

Rules:
- "actions" must only contain values from the Supported Actions list above.
- "settings.template" (if present) must only be one of the Supported Templates.
- Keep "summary" to a single short sentence merchants can understand.
- Return JSON only — no markdown fences, no commentary.`;

function asTrimmedString(value, maxLen = 2000) {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, maxLen);
}

function extractJsonObject(raw) {
    const text = typeof raw === "string" ? raw : "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
        return JSON.parse(match[0]);
    } catch {
        return null;
    }
}

async function fetchStoreContext(admin) {
    const context = { shopName: "", currencyCode: "", products: [], collections: [] };
    if (!admin) return context;

    try {
        const res = await admin.graphql(`
            query {
                shop { name currencyCode }
                products(first: 15) {
                    nodes { title productType vendor }
                }
                collections(first: 10) {
                    nodes { title }
                }
            }
        `);
        const data = await res.json();
        context.shopName = data?.data?.shop?.name || "";
        context.currencyCode = data?.data?.shop?.currencyCode || "";
        context.products = (data?.data?.products?.nodes || []).map((p) => p.title).filter(Boolean);
        context.collections = (data?.data?.collections?.nodes || []).map((c) => c.title).filter(Boolean);
    } catch (e) {
        console.warn("[AI Agent] Failed to load store context:", e?.message);
    }

    return context;
}

function buildContextBlock({ storeContext, themeColors, currentSettings }) {
    const lines = [];

    lines.push(`Store: ${storeContext.shopName || "(unknown)"} (currency: ${storeContext.currencyCode || "unknown"})`);

    lines.push(`Theme: primary color ${themeColors.primaryColor}, secondary color ${themeColors.secondaryColor}, font ${themeColors.font}, button radius ${themeColors.borderRadius}px`);

    if (storeContext.collections.length) {
        lines.push(`Collections: ${storeContext.collections.slice(0, 10).join(", ")}`);
    }
    if (storeContext.products.length) {
        lines.push(`Sample products: ${storeContext.products.slice(0, 15).join(", ")}`);
    }

    lines.push(`Current cart settings: drawer ${currentSettings.drawerEnabled ? "enabled" : "disabled"}, upsell ${currentSettings.upsell.enabled ? "enabled" : "disabled"}, goal bar ${currentSettings.goalBar.enabled ? "enabled" : "disabled"}, trust badges ${currentSettings.trustBadges.enabled ? "enabled" : "disabled"}.`);

    return lines.join("\n");
}

export async function action({ request }) {
    if (request.method !== "POST") {
        return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    if (!NVIDIA_API_KEY) {
            return Response.json(
                { error: "NVIDIA API key is not configured. Add OPENAI_API_KEY to your .env file." },
                { status: 200 }
            );
        }

    let body;
    try {
        body = await request.json();
    } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const prompt = asTrimmedString(body?.prompt, 1000);
    if (!prompt) {
        return Response.json({ error: "Please describe what you'd like to change." }, { status: 400 });
    }

    let admin;
    let shop = "";
    try {
        const auth = await authenticate.admin(request);
        admin = auth?.admin;
        shop = auth?.session?.shop || "";
    } catch (e) {
        console.error("[AI Agent] Unauthorized generate request:", e);
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [storeContext, themeColors] = await Promise.all([
        fetchStoreContext(admin),
        analyzeThemeColors(admin),
    ]);

    const currentSettings = await getCurrentSettingsSnapshot(shop, themeColors);

    const contextBlock = buildContextBlock({ storeContext, themeColors, currentSettings });

    const userMessage = `Merchant request:
"${prompt}"

Store context:
${contextBlock}

Convert this request into the JSON plan described in your instructions. Only use the supported actions and templates. Respond with JSON only.`;

    try {
        const nvidiaRes = await fetch(NVIDIA_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${NVIDIA_API_KEY}`,
            },
            body: JSON.stringify({
                model: NVIDIA_MODEL,
                messages: [
                    { role: "system", content: SYSTEM_PROMPT + "\n\nAlways respond with valid JSON only, no markdown." },
                    { role: "user", content: userMessage },
                ],
                temperature: 0.4,
                max_tokens: 600,
            }),
        });

        if (!nvidiaRes.ok) {
            const errText = await nvidiaRes.text();
            console.error("[AI Agent] NVIDIA API error:", nvidiaRes.status, errText);
            if (nvidiaRes.status === 429) {
                return Response.json(
                    { error: "AI quota exceeded. Please check your NVIDIA API key." },
                    { status: 200 }
                );
            }
            let errDetail = errText;
            try { errDetail = JSON.parse(errText)?.error?.message || errText; } catch { /* keep raw */ }
            return Response.json({ error: `NVIDIA API error (${nvidiaRes.status}): ${errDetail}` }, { status: 502 });
        }

        const nvidiaData = await nvidiaRes.json();
        const rawContent = nvidiaData?.choices?.[0]?.message?.content || "{}";
        const parsed = extractJsonObject(rawContent);

        if (!parsed || typeof parsed !== "object") {
            return Response.json({ error: "AI returned an unexpected format. Please try rephrasing your request." }, { status: 502 });
        }

        const summary = asTrimmedString(parsed.summary, 240) || "Here's what I'll change in your cart.";
        const actions = Array.isArray(parsed.actions)
            ? parsed.actions.filter((a) => SUPPORTED_ACTIONS.includes(a))
            : [];
        const settings = parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {};

        if (settings.template && !TEMPLATE_PRESETS[String(settings.template).toLowerCase()]) {
            delete settings.template;
        } else if (settings.template) {
            settings.template = String(settings.template).toLowerCase();
        }

        if (actions.length === 0) {
            return Response.json({
                success: true,
                plan: {
                    summary: "I couldn't map that request to a supported cart action yet — try one of the quick actions or be more specific (e.g. \"enable the cart drawer and match my theme\").",
                    actions: [],
                    settings: {},
                    items: [],
                },
                themeColors,
            });
        }

        const items = actions.map((a) => ({
            action: a,
            label: ACTION_LABELS[a] || a,
            impact: ACTION_IMPACT[a] || "Setting updated.",
        }));

        return Response.json({
            success: true,
            plan: { summary, actions, settings, items },
            themeColors,
            prompt,
            shop,
        });
    } catch (err) {
        console.error("[AI Agent] generate error:", err);
        return Response.json({ error: `Server error: ${err?.message || "Unknown error"}` }, { status: 500 });
    }
}
