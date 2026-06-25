import { useRouteError } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { authenticate } from '../shopify.server';
import prisma from '../db.server';
import TemplateManager from '../components/bundles/TemplateManager';

/* ─── Action ──────────────────────────────────────────────────────────────── */
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const contentType = request.headers.get('content-type') || '';
  let data = {};
  try {
    if (contentType.includes('application/json')) {
      data = await request.json();
    } else {
      const form = await request.formData();
      data = Object.fromEntries(form.entries());
    }
  } catch { /* silent */ }

  const { intent, id } = data;

  try {
    if (intent === 'delete' && id) {
      await prisma.$queryRawUnsafe(
        `DELETE FROM combo_templates WHERE id = ? AND shop_domain = ?`,
        Number(id), shop
      ).catch(() => {});
      return Response.json({ success: true, message: 'Template deleted.' });
    }
    if (intent === 'toggle_active' && id) {
      const active = data.active === 'true' || data.active === true ? 1 : 0;
      await prisma.$queryRawUnsafe(
        `UPDATE combo_templates SET is_active = ? WHERE id = ? AND shop_domain = ?`,
        active, Number(id), shop
      ).catch(() => {});
      return Response.json({ success: true, message: active ? 'Template activated.' : 'Template deactivated.' });
    }
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }

  return Response.json({ success: true });
};

/* ─── Loader ──────────────────────────────────────────────────────────────── */
export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  let templates = [];
  let discounts = [];

  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, name, is_active, customization_data, page_url, page_handle, created_at, updated_at
       FROM combo_templates WHERE shop_domain = ? ORDER BY updated_at DESC`,
      shop
    ).catch(() => []);

    templates = (Array.isArray(rows) ? rows : []).map(r => ({
      id: Number(r.id),
      title: r.name || 'Untitled',
      active: Boolean(r.is_active),
      config: (() => { try { return JSON.parse(r.customization_data || '{}'); } catch { return {}; } })(),
      page_url: r.page_url || r.page_handle || null,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
    }));
  } catch (e) {
    console.error('[Templates] loader error:', e);
  }

  try {
    const res = await admin.graphql(`
      query DiscountList {
        discountNodes(first: 100, reverse: true) {
          edges {
            node {
              id
              discount {
                ... on DiscountCodeBasic { title codes(first:1){edges{node{code}}} status }
                ... on DiscountCodeBxgy { title codes(first:1){edges{node{code}}} status }
                ... on DiscountCodeFreeShipping { title codes(first:1){edges{node{code}}} status }
              }
            }
          }
        }
      }
    `);
    const json = await res.json();
    discounts = (json.data?.discountNodes?.edges || [])
      .map(({ node }) => {
        const d = node.discount;
        if (!d) return null;
        const code = d.codes?.edges?.[0]?.node?.code || '';
        if (!code || d.status !== 'ACTIVE') return null;
        return { id: node.id, code, title: d.title || code };
      })
      .filter(Boolean);
  } catch { /* silent */ }

  return { templates, shop, discounts };
};

/* ─── Component — delegates all UI to TemplateManager ────────────────────── */
export default function TemplatesPage() {
  return <TemplateManager />;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers = (headersArgs) => boundary.headers(headersArgs);
