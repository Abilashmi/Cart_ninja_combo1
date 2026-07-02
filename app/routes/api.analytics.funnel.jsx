import { authenticate } from "../shopify.server";
import { getFunnel } from "../services/analytics-query.server";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const startDate = url.searchParams.get("startDate") || today;
  const endDate = url.searchParams.get("endDate") || today;

  try {
    const data = await getFunnel(shop, startDate, endDate);
    return Response.json({ success: true, data });
  } catch (error) {
    console.error("[api.analytics.funnel] failed:", error.message);
    return Response.json(
      { success: false, error: error.message, data: { visitors: 0, cart_creates: 0, checkout_clicks: 0, orders: 0, rates: {} } },
      { status: 500 }
    );
  }
}
