import { loadComboTemplateRow } from '../services/combo-page.server';
import { createComboLoader } from '../utils/combo-loader.shared.js';

// Public: a combo template's preloader settings only (no products, no Shopify
// calls), so the storefront script (combo-page[.]js.jsx) can swap its default
// round spinner for the merchant's own loader while the full page data
// (/api/combo-page-data) is still loading. Read-only and non-sensitive.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const Loader = createComboLoader();

export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = String(url.searchParams.get('shop') || '').trim().toLowerCase();
  const templateId = String(url.searchParams.get('templateId') || '');
  if (!SHOP_RE.test(shop) || !/^\d{1,12}$/.test(templateId)) {
    return Response.json({ success: false, error: 'shop and templateId are required' }, { status: 400, headers: CORS_HEADERS });
  }
  try {
    const row = await loadComboTemplateRow(shop, templateId);
    if (!row) return Response.json({ success: false, error: 'Template not found' }, { status: 404, headers: CORS_HEADERS });
    let config = {};
    try { config = JSON.parse(row.customization_data || '{}') || {}; } catch { config = {}; }
    return Response.json(
      // The raw loader_* keys: the page checks them with the same Loader.pick.
      { success: true, loader: Loader.subset(config) },
      { headers: { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=60' } },
    );
  } catch (error) {
    console.error('[api.combo-loader] failed:', error.message);
    return Response.json({ success: false, error: 'Internal server error' }, { status: 500, headers: CORS_HEADERS });
  }
}

export async function action({ request }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  return Response.json({ success: false, error: 'Method not allowed' }, { status: 405, headers: CORS_HEADERS });
}
