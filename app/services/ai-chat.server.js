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
- Announcement banner (promotional message bar in cart)
- Checkout button customization (color, text color, border radius)

CRITICAL RULES:
1. When a merchant asks to ENABLE or SET UP a feature, map it to the COMPLETE workflow action with sensible defaults — never just toggle enable.
2. Answer questions about these features concisely.
3. If the request is off-topic (not about The Cart Ninja features), set off_topic: true.
4. NEVER generate code, CSS, or HTML.
5. Return ONLY valid JSON, no markdown fences.

Action-to-workflow mapping:
"Enable FBT", "Set up FBT", "Frequently Bought Together" → configure_fbt
"Enable Progress Bar", "Set up goal bar", "Free shipping bar" → configure_goal_bar
"Enable Upsell", "Set up upsell", "Product recommendations" → configure_upsell
"Enable Cart Drawer", "Set up drawer", "Cart drawer" → configure_cart_drawer
"Match Theme", "Sync colors", "Auto theme" → match_theme
"Change checkout button", "Checkout color", "Checkout style" → update_styling (include checkoutButtonColor and checkoutBorderRadius in settings)
"Create Bundle", "Bundle offer", "Combo Forge" → create_bundle
"Optimize Mobile", "Mobile layout" → optimize_mobile
"Enable Trust Badges", "Security badges" → enable_trust_badges
"Enable Announcement", "Announcement banner", "Promo banner" → configure_announcement
"Disable", "Turn off", "Remove" → the matching disable_ action

Output format:
{
  "summary": "Brief 1-2 line response",
  "message": "Detailed message shown to the merchant with what was configured",
  "actions": [
    {
      "type": "action_name",
      "label": "Human-readable label",
      "settings": {
        // Include defaults for the full workflow
      }
    }
  ],
  "off_topic": false,
  "insight_mode": "modules"
}

Supported actions with default settings:
- configure_fbt:
  settings: { template: "fbt2", mode: "ai" }
- configure_goal_bar:
  settings: {
    goal: 999,
    reward: "Free Shipping",
    currency: "INR",
    tiers: [
      { minValue: 0, description: "Start shopping", iconPreset: "box" },
      { minValue: 499, description: "Halfway there!", iconPreset: "truck" },
      { minValue: 999, description: "Free Shipping unlocked!", iconPreset: "star" }
    ]
  }
  NOTE: When merchant specifies a tier value (e.g. "tier 1 for 5000"), update tiers[1].minValue and set goal to the highest tier minValue. iconPreset options: "box", "truck", "star", "gift", "tag".
- configure_upsell:
  settings: { layout: "slider", template: "modern" }
- configure_cart_drawer:
  settings: { theme: "modern", borderRadius: 12 }
- configure_coupon_slider:
  settings: { template: 3, selectFirstCoupon: true }
  NOTE: template values: 1 = Classic Banner, 2 = Minimal Card, 3 = Bold & Vibrant. selectFirstCoupon: true means auto-select the merchant's first saved coupon.
- configure_announcement:
  settings: { text: "Free shipping on orders over ₹999!", bgColor: "#4f46e5", textColor: "#ffffff", fontSize: 14 }
- enable_cart_drawer, disable_cart_drawer
- enable_coupon_slider, disable_coupon_slider
- enable_upsell, disable_upsell
- enable_fbt, disable_fbt
- enable_goal_bar, disable_goal_bar
- enable_trust_badges, disable_trust_badges
- enable_announcement, disable_announcement
- updateCheckoutStyle — settings: { buttonColor: "#22c55e", textColor: "#ffffff", borderRadius: 4 }
- match_theme, optimize_mobile
- apply_template, update_styling
- updateCheckoutStyle (dedicated checkout button action)
- create_bundle

Action-to-workflow mapping additions:
"Enable Coupon Slider", "Show coupons in cart", "Coupon slider" → configure_coupon_slider
"Select template", "Coupon template" → configure_coupon_slider`;

export async function chat(requestBody) {
  const { message, conversationId, messages: history, scrapedDesign } = requestBody;

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

  // Inject scraped storefront context as a system-level note before user message
  let scrapedContext = "";
  if (scrapedDesign && scrapedDesign.source === "live-scrape") {
    const lines = ["[Storefront Design Data — scraped live from merchant website]"];
    if (scrapedDesign.pageTitle) lines.push(`Store: ${scrapedDesign.pageTitle}`);
    if (scrapedDesign.primaryColor) lines.push(`Primary color: ${scrapedDesign.primaryColor}`);
    if (scrapedDesign.secondaryColor) lines.push(`Secondary color: ${scrapedDesign.secondaryColor}`);
    if (scrapedDesign.font) lines.push(`Font: ${scrapedDesign.font}`);
    if (scrapedDesign.borderRadius != null) lines.push(`Button radius: ${scrapedDesign.borderRadius}px`);
    if (scrapedDesign.offers?.length) lines.push(`Active offers/promos: ${scrapedDesign.offers.join(" | ")}`);
    lines.push("Use these exact values when applying match_theme or update_styling actions.");
    scrapedContext = lines.join("\n");
  }

  const apiMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...conversationHistory.map((m) => ({
      role: m.role === "agent" || m.role === "assistant" ? "assistant" : "user",
      content: m.message || m.text || "",
    })),
    ...(scrapedContext ? [{ role: "system", content: scrapedContext }] : []),
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
