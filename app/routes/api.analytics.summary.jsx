import { authenticate } from "../shopify.server";
import { getPeriodTotals } from "../services/analytics-query.server";
import { pctChange, previousPeriodRange } from "../utils/analytics.shared";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const startDate = url.searchParams.get("startDate") || today;
  const endDate = url.searchParams.get("endDate") || today;
  const compare = url.searchParams.get("compare") !== "false";

  try {
    const current = await getPeriodTotals(shop, startDate, endDate);
    let previous = null;
    let change_pct = null;

    if (compare) {
      const prevRange = previousPeriodRange(startDate, endDate);
      previous = await getPeriodTotals(shop, prevRange.startDate, prevRange.endDate);
      change_pct = {
        revenue: pctChange(current.revenue, previous.revenue),
        order_count: pctChange(current.order_count, previous.order_count),
        aov: pctChange(current.aov, previous.aov),
        upsell_revenue: pctChange(current.upsell_revenue, previous.upsell_revenue),
        conversion_rate: pctChange(current.conversion_rate, previous.conversion_rate),
        checkout_rate: pctChange(current.checkout_rate, previous.checkout_rate),
      };
    }

    return Response.json({ success: true, data: { current, previous, change_pct } });
  } catch (error) {
    console.error("[api.analytics.summary] failed:", error.message);
    return Response.json(
      { success: false, error: error.message, data: { current: null, previous: null, change_pct: null } },
      { status: 500 }
    );
  }
}
