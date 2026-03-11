/**
 * POST /api/fbt-ai
 * Accepts the store's product catalog and returns AI-generated FBT rule suggestions.
 * OpenAI key is stored server-side — never exposed to the client.
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = "gpt-4o-mini";

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

    // Build a compact product list for the prompt (title + price only — no IDs sent to OpenAI)
    const productIndex = products.map((p, i) => `${i + 1}. ${p.title} ($${p.price})`).join("\n");

    const prompt = `You are an e-commerce product recommendation expert.

Given this product catalog from an online store, suggest which products are frequently bought together.
For each product, suggest 1–3 other products from the catalog that customers commonly buy with it.
Focus on natural complementary pairings (e.g. phone + case, shoes + socks, camera + memory card).

Product Catalog:
${productIndex}

Return ONLY a valid JSON array. Each item must have:
- "triggerIndex": the 1-based index of the main product
- "fbtIndexes": array of 1-based indexes of the suggested FBT products (1–3 items)

Example: [{"triggerIndex": 1, "fbtIndexes": [3, 5]}, ...]

Return only products that have clear, natural pairings. Skip products with no obvious FBT match.
JSON array:`;

    try {
        const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: OPENAI_MODEL,
                messages: [{ role: "user", content: prompt }],
                temperature: 0.3,
                max_tokens: 1500,
            }),
        });

        if (!openaiRes.ok) {
            const errText = await openaiRes.text();
            console.error("OpenAI API error:", openaiRes.status, errText);
            let errDetail = errText;
            try { errDetail = JSON.parse(errText)?.error?.message || errText; } catch {}
            return new Response(
                JSON.stringify({ error: `OpenAI error (${openaiRes.status}): ${errDetail}` }),
                { status: 502, headers: { "Content-Type": "application/json" } }
            );
        }

        const openaiData = await openaiRes.json();
        const rawContent = openaiData.choices?.[0]?.message?.content || "[]";

        // Extract JSON from the response (strip any markdown code fences)
        const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            return new Response(
                JSON.stringify({ error: "AI returned unexpected format.", raw: rawContent }),
                { status: 502, headers: { "Content-Type": "application/json" } }
            );
        }

        const aiRules = JSON.parse(jsonMatch[0]);

        // Map AI indexes back to real product objects
        const rules = [];
        for (const rule of aiRules) {
            const triggerProduct = products[rule.triggerIndex - 1];
            const fbtProducts = (rule.fbtIndexes || [])
                .map(i => products[i - 1])
                .filter(Boolean);

            if (triggerProduct && fbtProducts.length > 0) {
                rules.push({
                    id: `ai-rule-${Date.now()}-${rule.triggerIndex}`,
                    displayScope: "single",
                    triggerProducts: [triggerProduct],
                    fbtProducts,
                    aiGenerated: true,
                });
            }
        }

        return new Response(
            JSON.stringify({ success: true, rules }),
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
