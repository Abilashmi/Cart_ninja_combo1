import { getDb } from './db.server';
import { getShopPlan, canAccessFeature } from './plan-permissions.server';
import { PLANS } from '../config/plans';

// Shared with api.bundle-templates.jsx's create path so the chat-driven
// combo flow can't drift from (or bypass) the same Build a Combo plan gate.
// Returns null if the shop may create another template, or an error object
// { error, limitReached: true } if blocked.
export async function checkComboPlanGate(shop) {
  const planKey = await getShopPlan(shop);
  if (!canAccessFeature(planKey, 'build_a_combo')) {
    return { error: 'Build a Combo requires the Starter plan or higher.', limitReached: true };
  }
  const comboTemplateLimit = PLANS[planKey]?.comboTemplateLimit;
  if (comboTemplateLimit !== null && comboTemplateLimit !== undefined) {
    const db = getDb();
    const [countRows] = await db.execute(
      'SELECT COUNT(*) AS cnt FROM combo_templates WHERE shop_domain = ?',
      [shop]
    );
    if (countRows[0].cnt >= comboTemplateLimit) {
      return {
        error: `Your ${PLANS[planKey].label} plan allows up to ${comboTemplateLimit} combo template${comboTemplateLimit === 1 ? '' : 's'}. Upgrade to add more.`,
        limitReached: true,
      };
    }
  }
  return null;
}

// Shared with api.bundle-templates.jsx's create path — the single INSERT
// both the manual builder save and the chat-driven flow use, so required
// columns/defaults can't drift between the two.
export async function createComboTemplate(shop, { name, template_type, status, is_active, customization_data, page_handle = null, page_id = null }) {
  const db = getDb();
  const isActive = (is_active === 1 || is_active === true) ? 1 : 0;
  const [insertResult] = await db.execute(
    `INSERT INTO combo_templates (shop_domain, name, template_type, status, is_active, customization_data, page_handle, page_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [shop, name || 'Untitled', template_type || 'grid', status || 'draft', isActive, customization_data || '{}', page_handle, page_id]
  );
  return insertResult.insertId;
}
