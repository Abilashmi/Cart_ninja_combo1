import { authenticate } from "../shopify.server";
import { getRecentActivity } from "../services/analytics-query.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);

  try {
    const data = await getRecentActivity(shop, limit);
    return Response.json({ success: true, data });
  } catch (error) {
    console.error("[api.analytics.recent-activity] failed:", error.message);
    return Response.json({ success: false, error: error.message, data: [] }, { status: 500 });
  }
}
