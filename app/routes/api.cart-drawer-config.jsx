import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';
import { getShopPlan } from '../services/plan-permissions.server';
import { saveCartDrawerConfig } from '../services/cart-config-writes.server';

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const db = getDb();
  try {
    const [rows] = await db.execute(
      'SELECT * FROM cart_drawer_config WHERE shop_domain = ? LIMIT 1',
      [session.shop]
    );
    const data = rows[0] || null;
    return Response.json({ success: !!data, data });
  } catch (error) {
    console.error('[cart-drawer-config] loader DB error:', error.message);
    return Response.json({ success: false, error: 'Failed to load cart drawer config' }, { status: 502 });
  }
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();

  console.log('[cart-drawer-config] POST shop:', shop, '| is_enabled:', body.is_enabled);

  try {
    const planKey = await getShopPlan(shop);
    const data = await saveCartDrawerConfig(shop, planKey, body);
    return Response.json({ success: true, data });
  } catch (error) {
    console.error('[cart-drawer-config] action DB error:', error.message);
    return Response.json({ success: false, error: 'Failed to save cart drawer config' }, { status: 502 });
  }
}
