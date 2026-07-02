import { authenticate } from "../shopify.server";
import { getDb } from "../services/db.server";

const DEFAULT_ANALYTICS_UPSTREAMS = [
  "https://int.thecartninja.com/analytics.php"
];

const DEFAULT_ANALYTICS = {
  checkout_click: 0,
  coupon_click: 0,
  upsell_click: 0,
  upsell_revenue_generated: 0,
  cartdrawer_total_revenue: 0,
  cartdrawer_total_coupon_applied: 0,
};

function getAnalyticsUpstreamUrls() {
  const listFromEnv = String(process.env.ANALYTICS_API_URLS || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);

  const singleFromEnv = [
    process.env.ANALYTICS_API_URL,
    process.env.EXTERNAL_ANALYTICS_API_URL,
  ].map((url) => String(url || "").trim()).filter(Boolean);

  return [...new Set([...listFromEnv, ...singleFromEnv, ...DEFAULT_ANALYTICS_UPSTREAMS])];
}

function toCount(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function toAmount(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const numeric = typeof value === "number"
    ? value
    : Number.parseFloat(String(value).replace(/[^0-9.-]/g, ""));

  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function extractCounts(source) {
  return {
    checkout_click: toCount(source?.checkout_click ?? source?.checkoutClicks ?? source?.checkout),
    coupon_click: toCount(source?.coupon_click ?? source?.couponClicks ?? source?.coupon),
    upsell_click: toCount(source?.upsell_click ?? source?.upsellClicks ?? source?.upsell),
    upsell_revenue_generated: toAmount(
      source?.upsell_revenue_generated ??
      source?.upsell_revenue ??
      source?.upsellRevenueGenerated ??
      source?.upsellRevenue ??
      source?.upsell_revenue_total ??
      source?.revenue_generated_upsell
    ),
    cartdrawer_total_revenue: toAmount(
      source?.cartdrawer_total_revenue ??
      source?.cart_drawer_total_revenue ??
      source?.cartdrawerRevenue ??
      source?.cartDrawerRevenue ??
      source?.total_revenue_cartdrawer ??
      source?.cart_revenue
    ),
    cartdrawer_total_coupon_applied: toCount(
      source?.cartdrawer_total_coupon_applied ??
      source?.cart_drawer_total_coupon_applied ??
      source?.total_coupon_applied_cartdrawer ??
      source?.coupon_applied_cartdrawer ??
      source?.couponAppliedInCartDrawer ??
      source?.cartdrawer_coupon_applied
    ),
  };
}

function normalizeAnalyticsPayload(payload) {
  const source = payload && typeof payload === "object" && "data" in payload
    ? payload.data
    : payload;

  if (Array.isArray(source)) {
    if (source.length === 0) {
      return { ...DEFAULT_ANALYTICS };
    }

    return source.reduce((acc, row) => {
      const current = extractCounts(row && typeof row === "object" ? row : {});
      return {
        checkout_click: acc.checkout_click + current.checkout_click,
        coupon_click: acc.coupon_click + current.coupon_click,
        upsell_click: acc.upsell_click + current.upsell_click,
        upsell_revenue_generated: acc.upsell_revenue_generated + current.upsell_revenue_generated,
        cartdrawer_total_revenue: acc.cartdrawer_total_revenue + current.cartdrawer_total_revenue,
        cartdrawer_total_coupon_applied: acc.cartdrawer_total_coupon_applied + current.cartdrawer_total_coupon_applied,
      };
    }, { ...DEFAULT_ANALYTICS });
  }

  if (source && typeof source === "object") {
    return extractCounts(source);
  }

  return { ...DEFAULT_ANALYTICS };
}

async function resolveShop(request, url) {
  const queryShop = (url.searchParams.get("shop") || url.searchParams.get("shopdomain") || "").trim();
  if (queryShop) {
    return queryShop;
  }

  try {
    const { session } = await authenticate.admin(request);
    return session?.shop || "";
  } catch {
    return "";
  }
}

// Local, dev-time source of truth for real order revenue/AOV/conversion rate —
// populated by app/routes/webhooks.orders.paid.jsx into store_order_events on
// the same MySQL DB as getDb(). Click counts (checkout/coupon/upsell) still
// come from the PHP upstream below. Once ready to run this against production,
// no code change is needed here — it already reads from whatever DB_HOST/
// DB_NAME the deployed app is configured with.
async function getLocalOrderStats(shop, startDate, endDate, checkoutClicks) {
  const stats = { total_revenue: 0, avg_order_value: 0, conversion_rate: 0, order_count: 0 };

  try {
    const db = getDb();
    let query = `SELECT COUNT(*) AS n, COALESCE(SUM(revenue), 0) AS total FROM store_order_events WHERE shop_domain = ?`;
    const params = [shop];
    if (startDate) {
      query += ` AND created_at >= ?`;
      params.push(`${startDate} 00:00:00`);
    }
    if (endDate) {
      query += ` AND created_at <= ?`;
      params.push(`${endDate} 23:59:59`);
    }

    const [rows] = await db.execute(query, params);
    const orderCount = Number(rows[0]?.n || 0);
    const totalRevenue = parseFloat(rows[0]?.total || 0);

    stats.order_count = orderCount;
    stats.total_revenue = totalRevenue;
    stats.avg_order_value = orderCount > 0 ? totalRevenue / orderCount : 0;
    stats.conversion_rate = checkoutClicks > 0 ? (orderCount / checkoutClicks) * 100 : 0;
  } catch (error) {
    console.error("[api.analytics] Local order stats query failed:", error.message);
  }

  return stats;
}

async function getErrorBody(response) {
  try {
    const body = await response.clone().json();
    return body?.error || body?.message || JSON.stringify(body);
  } catch { }

  try {
    const text = await response.text();
    return text || "Unknown error";
  } catch {
    return "Unknown error";
  }
}

export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = await resolveShop(request, url);

  if (!shop) {
    return Response.json(
      {
        success: false,
        error: "Shop is required.",
        data: { ...DEFAULT_ANALYTICS },
      },
      { status: 400 }
    );
  }

  const upstreams = getAnalyticsUpstreamUrls();
  const upstreamErrors = [];

  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");

  for (const baseUrl of upstreams) {
    const separator = baseUrl.includes("?") ? "&" : "?";
    let analyticsUrl = `${baseUrl}${separator}shop=${encodeURIComponent(shop)}`;
    
    // Append date filters if they exist
    if (startDate) {
      analyticsUrl += `&startDate=${encodeURIComponent(startDate)}`;
    }
    if (endDate) {
      analyticsUrl += `&endDate=${encodeURIComponent(endDate)}`;
    }

    try {
      const response = await fetch(analyticsUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "ngrok-skip-browser-warning": "true",
        },
      });

      if (!response.ok) {
        const detail = await getErrorBody(response);
        upstreamErrors.push(`${baseUrl} -> ${response.status}: ${detail}`);
        continue;
      }

      const payload = await response.json();
      const clickData = normalizeAnalyticsPayload(payload);
      const orderStats = await getLocalOrderStats(shop, startDate, endDate, clickData.checkout_click);

      return Response.json({
        success: true,
        data: {
          ...clickData,
          cartdrawer_total_revenue: orderStats.total_revenue,
          avg_order_value: orderStats.avg_order_value,
          conversion_rate: orderStats.conversion_rate,
        },
      });
    } catch (error) {
      upstreamErrors.push(`${baseUrl} -> ${error?.message || "Request failed"}`);
    }
  }

  const detail = upstreamErrors.slice(0, 3).join(" | ") || "No upstream configured.";
  const orderStats = await getLocalOrderStats(shop, startDate, endDate, 0);

  return Response.json({
    success: true,
    error: `Click-tracking upstream unavailable (revenue/AOV still shown from local orders). ${detail}`,
    data: {
      ...DEFAULT_ANALYTICS,
      cartdrawer_total_revenue: orderStats.total_revenue,
      avg_order_value: orderStats.avg_order_value,
      conversion_rate: orderStats.conversion_rate,
    },
  });
}
