import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let body;
  try { body = await request.json(); } catch { return Response.json({ success: false, error: 'Invalid JSON' }, { status: 400 }); }

  const { plan } = body || {};
  const actions = plan?.actions || [];
  const settings = plan?.settings || {};

  if (actions.length === 0) {
    return Response.json({ success: false, error: 'No actions provided' }, { status: 400 });
  }

  const db = getDb();
  const applied = [];
  const before = {};
  const after = {};

  try {
    for (const action of actions) {
      switch (action) {
        case 'enableDrawer':
        case 'disableDrawer': {
          const enabled = action === 'enableDrawer' ? 1 : 0;
          before.cart = before.cart || {};
          before.cart.drawerEnabled = !enabled;
          await db.execute(
            'UPDATE cart_drawer_config SET is_active = ? WHERE shop_domain = ?',
            [enabled, shop]
          );
          after.cart = after.cart || {};
          after.cart.drawerEnabled = !!enabled;
          applied.push(action);
          break;
        }

        case 'enableGoalBar':
        case 'disableGoalBar': {
          const enabled = action === 'enableGoalBar' ? 1 : 0;
          before.cart = before.cart || {};
          before.cart.goalBar = { enabled: !enabled };
          await db.execute(
            'UPDATE progress_bar_settings SET is_enabled = ? WHERE shop_domain = ?',
            [enabled, shop]
          );
          after.cart = after.cart || {};
          after.cart.goalBar = { enabled: !!enabled };
          applied.push(action);
          break;
        }

        case 'enableUpsell':
        case 'disableUpsell': {
          const enabled = action === 'enableUpsell' ? 1 : 0;
          before.cart = before.cart || {};
          before.cart.upsell = { enabled: !enabled };
          await db.execute(
            'UPDATE upsell_widget_settings SET is_enabled = ? WHERE shop_domain = ?',
            [enabled, shop]
          );
          after.cart = after.cart || {};
          after.cart.upsell = { enabled: !!enabled };
          applied.push(action);
          break;
        }

        case 'enableFBT':
        case 'disableFBT': {
          const enabled = action === 'enableFBT' ? 1 : 0;
          before.fbt = { widgetEnabled: !enabled };
          await db.execute(
            'UPDATE fbt_widget_settings SET is_enabled = ? WHERE shop_domain = ?',
            [enabled, shop]
          );
          after.fbt = { widgetEnabled: !!enabled };
          applied.push(action);
          break;
        }

        case 'applyTemplate': {
          const template = settings.template || 'premium';
          const THEMES = {
            premium: { bg: '#1a1a2e', text: '#ffffff', btn: '#7c3aed' },
            minimal: { bg: '#ffffff', text: '#1a1a1a', btn: '#000000' },
            luxury:  { bg: '#1a1000', text: '#f5e642', btn: '#c9a800' },
          };
          const t = THEMES[template] || THEMES.minimal;
          before.cart = {};
          after.cart = { theme: template, bgColor: t.bg, textColor: t.text };
          applied.push(action);
          break;
        }

        case 'matchTheme':
        case 'optimizeMobile':
          after[action] = true;
          applied.push(action);
          break;

        default:
          break;
      }
    }

    return Response.json({ success: true, applied, synced: applied.length > 0, before, after });
  } catch (e) {
    console.error('[api.ai-agent.apply]', e);
    return Response.json({ success: false, error: e.message || 'Apply failed' }, { status: 500 });
  }
}
