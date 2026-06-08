/**
 * POST /api/ai-upsell
 * Secure AI-powered upsell recommendations.
 *
 * - Reads the OpenAI API key from process.env.OPENAI_API_KEY (never from the client).
 * - All OpenAI calls are server-side only.
 * - Returns 3–5 recommendations as JSON.
 */

import { authenticate } from "../shopify.server";
import { getCurrencySymbolFromCode } from "../utils/currency.server";
import process from "node:process";

const NVIDIA_API_KEY = process.env.OPENAI_API_KEY || "";
const NVIDIA_MODEL = "meta/llama-3.1-8b-instruct";
const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

const MIN_RECOMMENDATIONS = 3;
const MAX_RECOMMENDATIONS = 5;

// Optional, small in-memory cache for faster first paint.
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_ENTRIES = 250;
const _cache = new Map();

function clampRecommendationsLimit(limit) {
    const parsed = Number.parseInt(String(limit ?? ""), 10);
    if (!Number.isFinite(parsed)) return 4;
    return Math.min(MAX_RECOMMENDATIONS, Math.max(MIN_RECOMMENDATIONS, parsed));
}

function asTrimmedString(value, maxLen = 500) {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, maxLen);
}

function asStringArray(value, maxItems = 25, maxItemLen = 80) {
    const arr = Array.isArray(value) ? value : [];
    const out = [];
    for (const item of arr) {
        const s = asTrimmedString(String(item ?? ""), maxItemLen);
        if (!s) continue;
        out.push(s);
        if (out.length >= maxItems) break;
    }
    return out;
}

function normalizeProductInput(input) {
    const currentProduct = input && typeof input === "object" ? input : {};

    return {
        id: asTrimmedString(currentProduct.id || currentProduct.productId || currentProduct.gid || "", 200),
        title: asTrimmedString(currentProduct.title || "", 160),
        tags: asStringArray(currentProduct.tags || [], 40, 50),
        category: asTrimmedString(currentProduct.category || currentProduct.productType || "", 80),
        vendor: asTrimmedString(currentProduct.vendor || "", 80),
        price: asTrimmedString(
            currentProduct.price != null ? String(currentProduct.price) : "",
            40
        ),
        currencyCode: asTrimmedString(currentProduct.currencyCode || currentProduct.currency || "", 10),
    };
}

function pruneCacheIfNeeded() {
    if (_cache.size <= MAX_CACHE_ENTRIES) return;
    // Remove oldest entries first.
    const entries = Array.from(_cache.entries());
    entries.sort((a, b) => (a[1]?.createdAt || 0) - (b[1]?.createdAt || 0));
    const toRemove = Math.max(0, _cache.size - MAX_CACHE_ENTRIES);
    for (let i = 0; i < toRemove; i += 1) {
        _cache.delete(entries[i][0]);
    }
}

function getCached(cacheKey) {
    const hit = _cache.get(cacheKey);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
        _cache.delete(cacheKey);
        return null;
    }
    return hit.value;
}

function setCached(cacheKey, value) {
    pruneCacheIfNeeded();
    _cache.set(cacheKey, {
        createdAt: Date.now(),
        expiresAt: Date.now() + CACHE_TTL_MS,
        value,
    });
}

function buildCacheKey({ shop, limit, product, excludeTitles }) {
    const stableTags = (product.tags || []).slice(0, 30).map((t) => t.toLowerCase()).sort().join(",");
    const excludes = (excludeTitles || []).slice(0, 10).map((t) => t.toLowerCase()).sort().join("|");

    return [
        "ai-upsell",
        shop || "unknown-shop",
        String(limit),
        (product.title || "").toLowerCase(),
        (product.category || "").toLowerCase(),
        stableTags,
        excludes,
    ].join("::");
}

function stripCodeFencesToJsonArray(raw) {
    const text = typeof raw === "string" ? raw : "";
    const match = text.match(/\[[\s\S]*\]/);
    return match ? match[0] : "";
}

function dedupeByTitle(recommendations = []) {
    const seen = new Set();
    const out = [];

    for (const item of recommendations) {
        const title = asTrimmedString(item?.title || "", 160);
        if (!title) continue;
        const key = title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            title,
            description: asTrimmedString(item?.description || "", 220),
            reason: asTrimmedString(item?.reason || "", 160),
            priceRange: asTrimmedString(item?.priceRange || item?.price_range || "", 60),
        });
    }

    return out;
}

export async function action({ request }) {
    if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json" },
        });
    }

    if (!NVIDIA_API_KEY) {
        return new Response(
            JSON.stringify({ error: "NVIDIA API key not configured on the server." }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    const limit = clampRecommendationsLimit(body?.limit);
    const excludeTitles = asStringArray(body?.excludeTitles || body?.exclude_titles || [], 25, 120);
    const variationSeed = asTrimmedString(body?.variationSeed || body?.seed || "", 80) || String(Date.now());
    const cacheMode = asTrimmedString(body?.cacheMode || "allow", 20).toLowerCase();
    const allowCache = cacheMode !== "bypass";

    // Product context is required.
    const product = normalizeProductInput(body?.currentProduct || body?.product || {});
    if (!product.title && !product.id) {
        return new Response(
            JSON.stringify({ error: "currentProduct is required (at least id or title)." }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    // Require an authenticated admin session to prevent unauthenticated abuse
    // of the server-side OpenAI key.
    let shop = "";
    let currencySymbol = "";
    let admin;
    try {
        const auth = await authenticate.admin(request);
        shop = auth?.session?.shop || "";
        admin = auth?.admin;
    } catch (e) {
        console.error("[AI-UPSELL] Unauthorized request:", e);
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    // Prefer currency code from the request, but if missing, attempt to fetch from Shopify.
    if (product.currencyCode) {
        currencySymbol = getCurrencySymbolFromCode(product.currencyCode);
    } else if (admin) {
        try {
            const currencyRes = await admin.graphql(`
                query {
                    shop { currencyCode }
                }
            `);
            const currencyData = await currencyRes.json();
            const currencyCode = currencyData?.data?.shop?.currencyCode;
            if (currencyCode) {
                currencySymbol = getCurrencySymbolFromCode(currencyCode);
            }
        } catch (e) {
            void e;
        }
    }

    const effectiveCurrencySymbol = currencySymbol || (product.currencyCode ? getCurrencySymbolFromCode(product.currencyCode) : "$");

    const cacheKey = buildCacheKey({ shop, limit, product, excludeTitles });
    if (allowCache && excludeTitles.length === 0) {
        const cached = getCached(cacheKey);
        if (cached) {
            return new Response(
                JSON.stringify({ success: true, recommendations: cached, cached: true }),
                { headers: { "Content-Type": "application/json" } }
            );
        }
    }

    const excludeBlock = excludeTitles.length
        ? `\nDo NOT recommend any of these items (case-insensitive):\n- ${excludeTitles.join("\n- ")}\n`
        : "";

    const tagsLine = product.tags.length ? product.tags.join(", ") : "";

    const prompt = `You are a Shopify upsell strategist. Generate high-conversion upsell recommendations that are tightly relevant to the current product.

Current product context:
- Title: ${product.title || "(unknown)"}
- Category: ${product.category || "(unknown)"}
- Tags: ${tagsLine || "(none)"}
- Vendor/Brand: ${product.vendor || "(unknown)"}
- Price: ${product.price ? `${effectiveCurrencySymbol}${product.price}` : "(unknown)"}

Requirements:
- Return exactly ${limit} upsell suggestions.
- Each suggestion must be specific and context-aware (avoid generic: "gift card", "bestsellers", "random accessories").
- Focus on items that increase AOV and convert well (complements, add-ons, bundles, care kits, matching pieces).
- Do not repeat the current product itself.
- Provide variety across suggestions (different types of complements).
${excludeBlock}
Variation seed (use this to generate a different-but-relevant set each request): ${variationSeed}

Output format:
Return ONLY a valid JSON array of ${limit} objects. Each object must include:
- "title" (string) : the upsell product name
- "description" (string) : short description (<= 1 sentence)
- "reason" (string) : short reason (<= 1 sentence)
- "priceRange" (string, optional) : e.g., "${effectiveCurrencySymbol}10–${effectiveCurrencySymbol}25" or "Under ${effectiveCurrencySymbol}20"

JSON array:`;

    try {
        const nvidiaRes = await fetch(NVIDIA_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${NVIDIA_API_KEY}`,
            },
            body: JSON.stringify({
                model: NVIDIA_MODEL,
                messages: [
                    { role: "system", content: "You output only valid JSON with no extra commentary." },
                    { role: "user", content: prompt },
                ],
                temperature: 0.8,
                max_tokens: 700,
            }),
        });

        if (!nvidiaRes.ok) {
            const errText = await nvidiaRes.text();
            console.error("[AI-UPSELL] NVIDIA API error:", nvidiaRes.status, errText);
            if (nvidiaRes.status === 429) {
                return new Response(
                    JSON.stringify({ success: true, recommendations: [], warning: "AI quota exceeded. Please update your NVIDIA API key." }),
                    { status: 200, headers: { "Content-Type": "application/json" } }
                );
            }
            let errDetail = errText;
            try {
                errDetail = JSON.parse(errText)?.error?.message || errText;
            } catch (e) {
                void e;
            }
            return new Response(
                JSON.stringify({ error: `NVIDIA API error (${nvidiaRes.status}): ${errDetail}` }),
                { status: 502, headers: { "Content-Type": "application/json" } }
            );
        }

        const nvidiaData = await nvidiaRes.json();
        const rawContent = nvidiaData.choices?.[0]?.message?.content || "[]";
        const jsonArrayText = stripCodeFencesToJsonArray(rawContent);
        if (!jsonArrayText) {
            return new Response(
                JSON.stringify({ error: "AI returned unexpected format.", raw: rawContent }),
                { status: 502, headers: { "Content-Type": "application/json" } }
            );
        }

        const parsed = JSON.parse(jsonArrayText);
        const recommendations = dedupeByTitle(Array.isArray(parsed) ? parsed : []);

        // Ensure we return 3–5 and match the requested limit as closely as possible.
        const trimmed = recommendations.slice(0, limit);
        if (trimmed.length < MIN_RECOMMENDATIONS) {
            return new Response(
                JSON.stringify({ error: "AI returned too few recommendations.", raw: rawContent }),
                { status: 502, headers: { "Content-Type": "application/json" } }
            );
        }

        if (allowCache && excludeTitles.length === 0) {
            setCached(cacheKey, trimmed);
        }

        return new Response(
            JSON.stringify({ success: true, recommendations: trimmed, cached: false }),
            { headers: { "Content-Type": "application/json" } }
        );
    } catch (err) {
        console.error("[AI-UPSELL] Server error:", err);
        return new Response(
            JSON.stringify({ error: `Server error: ${err?.message || "Unknown error"}` }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}
