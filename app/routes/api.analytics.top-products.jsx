import { authenticate } from "../shopify.server";
import { getTopProducts } from "../services/analytics-query.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const startDate = url.searchParams.get("startDate") || today;
  const endDate = url.searchParams.get("endDate") || today;
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "10", 10), 50);

  try {
    const data = await getTopProducts(shop, startDate, endDate, limit);
    return Response.json({ success: true, data });
  } catch (error) {
    console.error("[api.analytics.top-products] failed:", error.message);
    return Response.json({ success: false, error: error.message, data: [] }, { status: 500 });
  }
}
