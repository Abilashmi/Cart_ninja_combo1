import process from "node:process";

const NVIDIA_API_KEY = process.env.OPENAI_API_KEY || "";
const NVIDIA_MODEL = "meta/llama-3.1-8b-instruct";
const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

function extractNumericId(value) {
    if (!value) return "";
    const s = String(value).trim();
    const match = s.match(/(\d+)(?:\?.*)?$/);
    return match ? match[1] : s;
}

export async function action({ request }) {
    if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
            status: 405,
            headers: { "Content-Type": "application/json" },
        });
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

    const cartProducts = Array.isArray(body?.cartProducts) ? body.cartProducts : [];
    const allProducts = Array.isArray(body?.allProducts) ? body.allProducts : [];
    const limit = Math.min(5, Math.max(1, Number.parseInt(String(body?.limit ?? 3), 10) || 3));

    // Nothing to recommend from
    if (allProducts.length === 0) {
        return new Response(
            JSON.stringify({ success: true, recommendations: [] }),
            { headers: { "Content-Type": "application/json" } }
        );
    }

    if (!NVIDIA_API_KEY) {
        return new Response(
            JSON.stringify({ success: true, recommendations: [] }),
            { headers: { "Content-Type": "application/json" } }
        );
    }

    const cartList = cartProducts.map(p => p.title || p.id).filter(Boolean).join(", ") || "various items";
    const catalogList = allProducts
        .map((p, i) => `${i + 1}. [ID:${extractNumericId(p.id)}] ${p.title}`)
        .join("\n");

    const prompt = `A customer has these items in their cart: ${cartList}.

From the product catalog below, recommend exactly ${limit} products they would likely also want to buy. Return ONLY a JSON array of numeric product IDs (no explanation, no markdown).

Product catalog:
${catalogList}

Return format: ["ID1","ID2","ID3"]`;

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
                    { role: "system", content: "You output only valid JSON arrays of numeric IDs. No explanation, no markdown." },
                    { role: "user", content: prompt },
                ],
                temperature: 0.5,
                max_tokens: 200,
            }),
        });

        // Quota exceeded — degrade gracefully
        if (nvidiaRes.status === 429) {
            return new Response(
                JSON.stringify({ success: true, recommendations: [] }),
                { headers: { "Content-Type": "application/json" } }
            );
        }

        if (!nvidiaRes.ok) {
            return new Response(
                JSON.stringify({ success: true, recommendations: [] }),
                { headers: { "Content-Type": "application/json" } }
            );
        }

        const nvidiaData = await nvidiaRes.json();
        const rawContent = nvidiaData.choices?.[0]?.message?.content || "[]";

        const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            return new Response(
                JSON.stringify({ success: true, recommendations: [] }),
                { headers: { "Content-Type": "application/json" } }
            );
        }

        const parsed = JSON.parse(jsonMatch[0]);
        const recommendations = (Array.isArray(parsed) ? parsed : [])
            .map(id => extractNumericId(id))
            .filter(Boolean)
            .slice(0, limit);

        return new Response(
            JSON.stringify({ success: true, recommendations }),
            { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
        );

    } catch {
        return new Response(
            JSON.stringify({ success: true, recommendations: [] }),
            { headers: { "Content-Type": "application/json" } }
        );
    }
}
