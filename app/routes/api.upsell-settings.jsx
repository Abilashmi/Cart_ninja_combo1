import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';
import { getShopPlan, canPublishFeature } from '../services/plan-permissions.server';
import { saveUpsellWidgetSettings } from '../services/cart-config-writes.server';

function parseManualRules(row) {
  if (!row) return row;
  try {
    row.manual_rules = row.manual_rules ? JSON.parse(row.manual_rules) : [];
  } catch {
    row.manual_rules = [];
  }
  return row;
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const db = getDb();
  const [rows] = await db.execute(
    'SELECT * FROM upsell_widget_settings WHERE shop_domain = ? LIMIT 1',
    [session.shop]
  );
  const data = parseManualRules(rows[0] || null);

  // Defense-in-depth: the PHP GET handler (hit via the App Proxy) is the real
  // storefront choke point, but also force is_enabled false here in case this
  // Node route is ever consumed directly. Stored row is left untouched.
  if (data) {
    const planKey = await getShopPlan(session.shop);
    if (!canPublishFeature(planKey, 'ai_cart_upsell')) {
      data.is_enabled = 0;
    }
  }

  return Response.json({ success: !!data, data });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();

  // The manual editor's full save always sends the complete manualRules
  // array it holds in context state — matches this route's historical
  // "always overwrite with whatever was sent" behavior for that field.
  const planKey = await getShopPlan(shop);
  const data = await saveUpsellWidgetSettings(shop, planKey, { ...body, manualRules: body.manualRules ?? [] });
  return Response.json({ success: true, data });
}
