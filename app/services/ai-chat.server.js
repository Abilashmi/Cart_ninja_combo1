const NVIDIA_API_KEY = process.env.OPENAI_API_KEY || "";
const NVIDIA_MODEL = "meta/llama-3.1-8b-instruct";
const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

const SYSTEM_PROMPT = `You are an ecommerce cart optimization expert for The Cart Ninja app by DigiCommerce.

The Cart Ninja app helps Shopify merchants optimize their cart with these features:
- Cart drawer (slide-out panel replacing the default cart page)
- Upsell recommendations (related products in cart)
- Frequently Bought Together (FBT bundles on product pages)
- Free shipping goal bar (progress bar encouraging larger orders)
- Trust badges (security/payment icons near checkout)
- Coupon slider/banner (display promotional coupons)
- Coupon creator (generate discount codes)
- Combo Forge (bundle builder)
- Theme color matching (reads brand colors via Shopify API)
- Mobile optimization (responsive tap targets, single column)

Your job:
1. Answer questions about these features concisely.
2. Detect what the merchant wants to do and plan the appropriate action.
3. If the request is off-topic (not about The Cart Ninja features), set off_topic: true.
4. NEVER generate code, CSS, or HTML.
5. Return ONLY valid JSON, no markdown fences.

Output format:
{
  "summary": "Brief 1-2 line response",
  "message": "Detailed message shown to the merchant",
  "actions": [{ "type": "action_name", "label": "Human-readable label" }],
  "off_topic": false,
  "insight_mode": "modules"  // optional: "analytics", "recommendation", "configuration", "design", "modules"
}

Supported actions:
- enable_cart_drawer, disable_cart_drawer
- enable_upsell, disable_upsell
- enable_fbt, disable_fbt
- enable_goal_bar, disable_goal_bar
- enable_trust_badges, disable_trust_badges
- match_theme, optimize_mobile
- apply_template, update_styling`;

export async function chat(requestBody) {
  const { message, conversationId, messages: history } = requestBody;

  if (!message?.trim()) {
    return { success: false, error: "Message is required" };
  }

  if (!NVIDIA_API_KEY) {
    return {
      success: true,
      message: "AI is not configured yet. Please set your OPENAI_API_KEY in the .env file.",
      summary: "AI key missing",
      actions: [],
    };
  }

  const conversationHistory = Array.isArray(history) ? history.slice(-20) : [];

  const apiMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...conversationHistory.map((m) => ({
      role: m.role === "agent" || m.role === "assistant" ? "assistant" : "user",
      content: m.message || m.text || "",
    })),
    { role: "user", content: message },
  ];

  try {
    const response = await fetch(NVIDIA_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
      },
      body: JSON.stringify({
        model: NVIDIA_MODEL,
        messages: apiMessages,
        temperature: 0.4,
        max_tokens: 800,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error("[AI Chat] NVIDIA API error:", response.status, errText);
      if (response.status === 429) {
        return {
          success: true,
          message: "AI quota exceeded. Please check your API key or try again later.",
          summary: "Quota exceeded",
          actions: [],
        };
      }
      return {
        success: true,
        message: "Sorry, I couldn't process that request. Please try again.",
        summary: "API error",
        actions: [],
      };
    }

    const data = await response.json();
    const rawContent = data?.choices?.[0]?.message?.content || "{}";
    const parsed = extractJson(rawContent);

    if (!parsed) {
      return {
        success: true,
        message: rawContent.slice(0, 500),
        summary: rawContent.slice(0, 100),
        actions: [],
      };
    }

    return {
      success: true,
      message: parsed.message || parsed.summary || "Done!",
      summary: parsed.summary || "",
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      off_topic: parsed.off_topic === true,
      insight_mode: parsed.insight_mode || null,
    };
  } catch (err) {
    console.error("[AI Chat] Error:", err);
    return {
      success: true,
      message: "Sorry, something went wrong. Please try again.",
      summary: "Server error",
      actions: [],
    };
  }
}

function extractJson(raw) {
  const text = typeof raw === "string" ? raw : "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}
