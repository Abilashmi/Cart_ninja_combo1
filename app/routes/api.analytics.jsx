import { authenticate } from "../shopify.server";
import { getAnalyticsData } from "../services/analytics.server";

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

export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = await resolveShop(request, url);
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");

  const result = await getAnalyticsData(shop, startDate, endDate);
  return Response.json(result, { status: result.success === false ? 400 : 200 });
}
