/**
 * POST /api/fbt-ai
 * Accepts the store's product catalog and returns AI-generated FBT rule suggestions.
 * OpenAI key is stored server-side — never exposed to the client.
 */

import { authenticate } from "../shopify.server";
import { getCurrencySymbolFromCode } from "../utils/currency.server";

const NVIDIA_API_KEY = process.env.OPENAI_API_KEY || "";
const NVIDIA_MODEL = "meta/llama-3.1-8b-instruct";
const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const DEFAULT_PRODUCTS_PER_TRIGGER = 3;
const MIN_PRODUCTS_PER_TRIGGER = 1;
const MAX_PRODUCTS_PER_TRIGGER = 10;

function normalizeProductsPerTrigger(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_PRODUCTS_PER_TRIGGER;
    }
    return Math.min(MAX_PRODUCTS_PER_TRIGGER, Math.max(MIN_PRODUCTS_PER_TRIGGER, parsed));
}

export async function action({ request }) {
    if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
    }

    if (!OPENAI_API_KEY) {
        return new Response(
            JSON.stringify({ error: "OpenAI API key not configured on the server." }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }

    // Try to get the currency symbol
    let currencySymbol = "$";
    try {
        const { admin } = await authenticate.admin(request);
        if (admin) {
            const response = await admin.graphql(`
                query {
                    shop {
                        currencyCode
                    }
                }
            `);
            const data = await response.json();
            const currencyCode = data?.data?.shop?.currencyCode;
            if (currencyCode) {
                currencySymbol = getCurrencySymbolFromCode(currencyCode);
            }
        }
    } catch (error) {
        console.error("[FBT-AI] Error fetching currency:", error);
        // Continue with default $ symbol
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
    }

    const products = body.products || [];
    if (products.length === 0) {
        return new Response(
            JSON.stringify({ error: "No products provided." }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    const requestedProductsPerTrigger = normalizeProductsPerTrigger(
        body.productsPerTrigger ?? body.limit
    );

    const productsPerTrigger = Math.min(
        requestedProductsPerTrigger,
        Math.max(0, products.length - 1)
    );

    if (productsPerTrigger <= 0) {
        return new Response(
            JSON.stringify({ error: "At least 2 products are required for FBT generation." }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    const customPrompt = typeof body.customPrompt === "string"
        ? body.customPrompt.trim().slice(0, 1000)
        : "";

    // Build a compact product list for the prompt (title + price only — no IDs sent to OpenAI)
    const productIndex = products.map((p, i) => `${i + 1}. ${p.title} (${currencySymbol}${p.price})`).join("\n");

    const customInstructionBlock = customPrompt
        ? `\nAdditional merchant instruction:\n${customPrompt}\n`
        : "";

    const prompt = `You are an e-commerce product recommendation expert.

Given this product catalog from an online store, suggest which products are frequently bought together.
Cover ALL products in the catalog as trigger products.
For each trigger product, suggest exactly ${productsPerTrigger} other products from the catalog that customers commonly buy with it.
Focus on natural complementary pairings (e.g. phone + case, shoes + socks, camera + memory card).
${customInstructionBlock}

Product Catalog:
${productIndex}

Return ONLY a valid JSON array. Each item must have:
- "triggerIndex": the 1-based index of the main product
- "fbtIndexes": array of ${productsPerTrigger} unique 1-based indexes of suggested FBT products

Example: [{"triggerIndex": 1, "fbtIndexes": [3, 5]}, ...]

Return one object for every triggerIndex from 1 to ${products.length}. Do not skip trigger indexes.
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
                messages: [{ role: "user", content: prompt }],
                temperature: 0.3,
                max_tokens: 1500,
            }),
        });

        if (!nvidiaRes.ok) {
            const errText = await nvidiaRes.text();
            console.error("NVIDIA API error:", nvidiaRes.status, errText);
            // Quota exceeded — return empty rules so UI degrades gracefully
            if (nvidiaRes.status === 429) {
                return new Response(
                    JSON.stringify({ success: true, rules: [], warning: "AI quota exceeded. Please update your NVIDIA API key." }),
                    { status: 200, headers: { "Content-Type": "application/json" } }
                );
            }
            let errDetail = errText;
            try { errDetail = JSON.parse(errText)?.error?.message || errText; } catch {}
            return new Response(
                JSON.stringify({ error: `NVIDIA API error (${nvidiaRes.status}): ${errDetail}` }),
                { status: 502, headers: { "Content-Type": "application/json" } }
            );
        }

        const nvidiaData = await nvidiaRes.json();
        const rawContent = nvidiaData.choices?.[0]?.message?.content || "[]";

        // Extract JSON from the response (strip any markdown code fences)
        const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            return new Response(
                JSON.stringify({ error: "AI returned unexpected format.", raw: rawContent }),
                { status: 502, headers: { "Content-Type": "application/json" } }
            );
        }

        const aiRules = JSON.parse(jsonMatch[0]);

        const aiRuleMap = new Map();
        for (const rule of Array.isArray(aiRules) ? aiRules : []) {
            const triggerIndex = Number.parseInt(rule?.triggerIndex, 10);
            if (!Number.isFinite(triggerIndex) || triggerIndex < 1 || triggerIndex > products.length) {
                continue;
            }
            aiRuleMap.set(triggerIndex, Array.isArray(rule?.fbtIndexes) ? rule.fbtIndexes : []);
        }

        const buildFallbackIndexes = (triggerIndex, neededCount, existingSet) => {
            const fallback = [];
            for (let i = 1; i <= products.length; i += 1) {
                if (i === triggerIndex) continue;
                if (existingSet.has(i)) continue;
                fallback.push(i);
                if (fallback.length >= neededCount) break;
            }
            return fallback;
        };

        // Map AI indexes back to real product objects with strict full-product coverage.
        const rules = [];
        for (let triggerIndex = 1; triggerIndex <= products.length; triggerIndex += 1) {
            const triggerProduct = products[triggerIndex - 1];
            if (!triggerProduct) continue;

            const uniqueIndexes = [];
            const seenIndexes = new Set();

            const fromAI = aiRuleMap.get(triggerIndex) || [];
            for (const idx of fromAI) {
                const numeric = Number.parseInt(idx, 10);
                if (!Number.isFinite(numeric)) continue;
                if (numeric === triggerIndex) continue;
                if (numeric < 1 || numeric > products.length) continue;
                if (seenIndexes.has(numeric)) continue;
                seenIndexes.add(numeric);
                uniqueIndexes.push(numeric);
                if (uniqueIndexes.length >= productsPerTrigger) break;
            }

            if (uniqueIndexes.length < productsPerTrigger) {
                const fallbackIndexes = buildFallbackIndexes(
                    triggerIndex,
                    productsPerTrigger - uniqueIndexes.length,
                    seenIndexes
                );
                fallbackIndexes.forEach((idx) => {
                    seenIndexes.add(idx);
                    uniqueIndexes.push(idx);
                });
            }

            const fbtProducts = uniqueIndexes
                .map((idx) => products[idx - 1])
                .filter(Boolean)
                .slice(0, productsPerTrigger);

            if (fbtProducts.length > 0) {
                rules.push({
                    id: `ai-rule-${Date.now()}-${triggerIndex}`,
                    displayScope: "single",
                    triggerProducts: [triggerProduct],
                    fbtProducts,
                    aiGenerated: true,
                });
            }
        }

        return new Response(
            JSON.stringify({
                success: true,
                rules,
                totalProducts: products.length,
                productsPerTrigger,
                requestedProductsPerTrigger,
            }),
            { headers: { "Content-Type": "application/json" } }
        );

    } catch (err) {
        console.error("FBT AI error:", err);
        return new Response(
            JSON.stringify({ error: `Server error: ${err.message}` }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}
