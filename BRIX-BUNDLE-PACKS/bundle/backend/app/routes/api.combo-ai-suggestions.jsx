import { createHash } from 'node:crypto';
import { authenticate } from '../shopify.server';
import { loadComboTemplateRow, loadComboPageDataForRow } from '../services/combo-page.server';
import {
  collectComboProducts, comboAiCacheKey, getComboAiPairs, MAX_PRODUCTS_FOR_AI,
} from '../services/combo-ai-suggestions.server';

// Public JSON endpoint for the storefront combo-page script
// (app/routes/combo-page[.]js.jsx): the AI "pairs well with" picks for one
// combo template, used when the merchant has turned on "Enable AI
// Suggestions for Customers" (config.ai_mode). No admin auth, same as
// api.combo-page-data.jsx, since the caller is an anonymous shopper. A
// shopper can't make this call the AI with their own input: the products
// come from the saved template, and the result is cached per template
// version (see services/combo-ai-suggestions.server.js).
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const templateId = url.searchParams.get('templateId');

  if (!shop || !templateId || !/^\d+$/.test(templateId)) {
    return Response.json(
      { success: false, error: 'shop and templateId are required' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const row = await loadComboTemplateRow(shop, templateId);
    if (!row) {
      return Response.json({ success: false, error: 'Template not found' }, { status: 404, headers: CORS_HEADERS });
    }
    const config = (() => { try { return JSON.parse(row.customization_data || '{}'); } catch { return {}; } })();
    if (!config.ai_mode) {
      return Response.json({ success: true, data: { enabled: false, pairs: {} } }, { headers: CORS_HEADERS });
    }

    const key = comboAiCacheKey(shop, row.id, row.updated_at);
    const { pairs } = await getComboAiPairs(key, async () => {
      const data = await loadComboPageDataForRow(shop, row);
      return {
        products: collectComboProducts(data.productsByHandle, data.collectionNameMap),
        templateName: data.templateName,
      };
    });
    return Response.json({ success: true, data: { enabled: true, pairs } }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error('[api.combo-ai-suggestions] failed:', error?.message || error);
    return Response.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

// POST: the combo builder's own live preview (app.bundles.customize.jsx),
// which shows the same row for the merchant's unsaved setup. Admin-only,
// since here the product list comes from the request; cached per shop +
// product list, so clicking around the builder doesn't re-call the AI.
export async function action({ request }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return Response.json({ success: false, error: 'Method not allowed' }, { status: 405, headers: CORS_HEADERS });
  }

  const { session } = await authenticate.admin(request);
  let body;
  try { body = await request.json(); } catch { body = null; }
  const text = (v) => String(v ?? '').slice(0, 120);
  const products = (Array.isArray(body?.products) ? body.products : [])
    .filter((p) => p && p.id != null && p.title)
    .slice(0, MAX_PRODUCTS_FOR_AI)
    .map((p) => ({ id: text(p.id), title: text(p.title), collection: text(p.collection), price: text(p.price), currency: '', description: '' }));

  const hash = createHash('sha1').update(JSON.stringify(products)).digest('hex');
  const { pairs, ok, reason } = await getComboAiPairs(`${session.shop}:builder:${hash}`, async () => ({
    products,
    templateName: text(body?.templateName),
  }), {}, { failureTtlMs: 30 * 1000 });
  return Response.json({ success: true, data: { enabled: true, pairs, ok, reason: ok ? null : reason } });
}
