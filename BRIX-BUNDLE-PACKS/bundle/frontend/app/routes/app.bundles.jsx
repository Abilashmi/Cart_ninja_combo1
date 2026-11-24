import { Outlet, useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';
import { syncComboWeightIfNeeded } from '../services/combo-weight-shopify.server';

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return {};
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get('intent');
  const id = formData.get('id');

  try {
    const db = getDb();
    const readConfig = async () => {
      const [rows] = await db.execute('SELECT customization_data FROM combo_templates WHERE id = ? AND shop_domain = ?', [Number(id), shop]);
      return rows?.[0]?.customization_data || null;
    };
    if (intent === 'delete' && id) {
      const config = await readConfig();
      await db.execute(
        'DELETE FROM combo_templates WHERE id = ? AND shop_domain = ?',
        [Number(id), shop]
      );
      await syncComboWeightIfNeeded(admin, shop, config);
      return { success: true, message: 'Template deleted.' };
    }
    if (intent === 'toggle_active' && id) {
      const active = formData.get('active') === 'true' ? 1 : 0;
      await db.execute(
        'UPDATE combo_templates SET is_active = ? WHERE id = ? AND shop_domain = ?',
        [active, Number(id), shop]
      );
      await syncComboWeightIfNeeded(admin, shop, await readConfig());
      return { success: true, message: active ? 'Template activated.' : 'Template deactivated.' };
    }
  } catch (e) {
    console.error('[bundles layout action]', e.message);
    return { success: false, error: e.message };
  }
  return { success: true, message: 'Done.' };
};

export default function AppBundlesLayout() {
  return <Outlet />;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
