import { authenticate } from "../shopify.server";
import { getDb } from "../services/db.server";
import { ensureAnalyticsTables } from "../services/analytics-schema.server";
import { getPeriodTotals, getTopProducts, getFunnel } from "../services/analytics-query.server";
import { pctChange, previousPeriodRange } from "../utils/analytics.shared";

const AI_API_KEY = process.env.OPENAI_API_KEY || process.env.NVIDIA_API_KEY || "";
const USE_NVIDIA = AI_API_KEY.startsWith("nvapi-");
const AI_MODEL = USE_NVIDIA ? "meta/llama-3.1-8b-instruct" : "gpt-4o-mini";
const AI_API_URL = USE_NVIDIA
  ? "https://integrate.api.nvidia.com/v1/chat/completions"
  : "https://api.openai.com/v1/chat/completions";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MIN_ORDERS_FOR_INSIGHTS = 3;
const VALID_SEVERITIES = new Set(["critical", "warning", "tip", "win"]);

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const startDate = url.searchParams.get("startDate") || today;
  const endDate = url.searchParams.get("endDate") || today;
  const force = url.searchParams.get("force") === "true";
  const periodKey = `${startDate}_${endDate}`;

  const db = getDb();
  await ensureAnalyticsTables(db);

  if (!force) {
    const cached = await getFreshCache(db, shop, periodKey);
    if (cached) return Response.json({ success: true, data: cached.insights, stale: false, generated_at: cached.generated_at });
  }

  let totals;
  try {
    totals = await getPeriodTotals(shop, startDate, endDate);
  } catch (error) {
    console.error("[api.analytics.insights] failed to load totals:", error.message);
    return fallbackResponse(db, shop, "Unable to load analytics data right now.");
  }

  if (totals.order_count < MIN_ORDERS_FOR_INSIGHTS) {
    const fallback = await getMostRecentCache(db, shop);
    if (fallback) {
      return Response.json({ success: true, data: fallback.insights, stale: true, generated_at: fallback.generated_at });
    }
    return Response.json({ success: true, data: [], reason: "insufficient_data" });
  }

  if (!AI_API_KEY) {
    return fallbackResponse(db, shop, "AI insights are not configured on the server.");
  }

  try {
    const [prevTotals, topProducts, funnel] = await Promise.all([
      getPeriodTotals(shop, ...Object.values(previousPeriodRange(startDate, endDate))),
      getTopProducts(shop, startDate, endDate, 3),
      getFunnel(shop, startDate, endDate),
    ]);

    const prompt = buildPrompt({ startDate, endDate, totals, prevTotals, topProducts, funnel });
    const content = await callAI(prompt);
    const insights = parseInsights(content);

    if (!insights.length) throw new Error("No valid insights returned.");

    await db.execute(
      `INSERT INTO analytics_insights_cache (shop_domain, period_key, insights_json, model)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE insights_json = VALUES(insights_json), model = VALUES(model), generated_at = NOW()`,
      [shop, periodKey, JSON.stringify(insights), AI_MODEL]
    );

    return Response.json({ success: true, data: insights, stale: false, generated_at: new Date().toISOString() });
  } catch (error) {
    console.error("[api.analytics.insights] generation failed:", error.message);
    return fallbackResponse(db, shop, "Could not generate fresh insights right now.");
  }
}

async function fallbackResponse(db, shop, message) {
  const fallback = await getMostRecentCache(db, shop);
  if (fallback) {
    return Response.json({ success: true, data: fallback.insights, stale: true, generated_at: fallback.generated_at, note: message });
  }
  return Response.json({ success: true, data: [], reason: "unavailable", note: message });
}

async function getFreshCache(db, shop, periodKey) {
  const [rows] = await db.execute(
    `SELECT insights_json, generated_at FROM analytics_insights_cache WHERE shop_domain = ? AND period_key = ?`,
    [shop, periodKey]
  );
  if (!rows.length) return null;
  const generatedAt = new Date(rows[0].generated_at);
  if (Date.now() - generatedAt.getTime() > CACHE_TTL_MS) return null;
  try {
    return { insights: JSON.parse(rows[0].insights_json), generated_at: generatedAt.toISOString() };
  } catch {
    return null;
  }
}

async function getMostRecentCache(db, shop) {
  const [rows] = await db.execute(
    `SELECT insights_json, generated_at FROM analytics_insights_cache WHERE shop_domain = ? ORDER BY generated_at DESC LIMIT 1`,
    [shop]
  );
  if (!rows.length) return null;
  try {
    return { insights: JSON.parse(rows[0].insights_json), generated_at: new Date(rows[0].generated_at).toISOString() };
  } catch {
    return null;
  }
}

function buildPrompt({ startDate, endDate, totals, prevTotals, topProducts, funnel }) {
  const revenueChange = pctChange(totals.revenue, prevTotals.revenue);
  const topProductLines = topProducts.length
    ? topProducts.map((p) => `- ${p.name}: revenue ${p.revenue.toFixed(2)}, units sold ${p.units_sold}`).join("\n")
    : "- No product-level sales data yet.";

  const systemPrompt = `You are an e-commerce analytics assistant for a Shopify cart-drawer app. Given real store metrics for a date range, produce 3-6 concise, actionable insight cards. Only reference numbers given to you — never invent data. Return ONLY a valid JSON array, no markdown fences, no prose.`;

  const userPrompt = `Period: ${startDate} to ${endDate}
Revenue: ${totals.revenue.toFixed(2)} (${revenueChange >= 0 ? "+" : ""}${revenueChange}% vs previous period)
Orders: ${totals.order_count}
Average order value: ${totals.aov.toFixed(2)}
Upsell revenue: ${totals.upsell_revenue.toFixed(2)}
Conversion rate: ${totals.conversion_rate.toFixed(2)}%
Checkout rate: ${totals.checkout_rate.toFixed(2)}%
Coupon clicks: ${totals.coupon_click_count}, coupon applications: ${totals.coupon_applied_count}
Funnel: ${funnel.visitors} visitors -> ${funnel.cart_creates} cart activity -> ${funnel.checkout_clicks} checkout clicks -> ${funnel.orders} orders

Top products by revenue:
${topProductLines}

Return a JSON array where each item has exactly these fields:
{ "severity": "critical" | "warning" | "tip" | "win", "tag": "short category label", "title": "short headline referencing a real number above", "description": "1-2 sentence explanation using only the numbers given", "recommendation": "one concrete, actionable suggestion" }`;

  return { systemPrompt, userPrompt };
}

async function callAI({ systemPrompt, userPrompt }) {
  const res = await fetch(AI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.5,
      max_tokens: 900,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const provider = USE_NVIDIA ? "NVIDIA" : "OpenAI";
    throw new Error(`${provider} API error: ${res.status} ${errText}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("AI returned empty response.");
  return content;
}

function parseInsights(content) {
  const stripped = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((item) =>
      item &&
      typeof item.title === "string" &&
      typeof item.description === "string" &&
      typeof item.recommendation === "string" &&
      VALID_SEVERITIES.has(item.severity)
    )
    .slice(0, 6)
    .map((item, index) => ({
      id: index + 1,
      severity: item.severity,
      tag: typeof item.tag === "string" ? item.tag : "Insight",
      title: item.title,
      description: item.description,
      recommendation: item.recommendation,
    }));
}
