import { loadComboPageData, loadComboPageDataByHandle } from '../services/combo-page.server';

// Public JSON endpoint for the storefront combo-page script
// (app/routes/combo-page[.]js.jsx) — no admin auth, since the caller is an
// anonymous shopper's browser on the merchant's own storefront domain, not
// the embedded admin app. Product/collection/discount data is fetched
// server-side via unauthenticated.admin(shop) inside loadComboPageData, same
// as the existing (admin-authenticated) preview route.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const templateId = url.searchParams.get('templateId');
  const handle = url.searchParams.get('handle');

  if (!shop || (!templateId && !handle)) {
    return Response.json(
      { success: false, error: 'shop and either templateId or handle are required' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    // handle lookup powers the storefront script's auto-detect mode (running
    // globally via the cart-drawer app embed, which only knows the current
    // page's URL, not a template's numeric id).
    const data = templateId
      ? await loadComboPageData(shop, templateId)
      : await loadComboPageDataByHandle(shop, handle);
    return Response.json({ success: true, data }, { headers: CORS_HEADERS });
  } catch (error) {
    if (error instanceof Response) {
      return Response.json(
        { success: false, error: 'Template not found' },
        { status: error.status, headers: CORS_HEADERS }
      );
    }
    console.error('[api.combo-page-data] failed:', error.message);
    return Response.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function action({ request }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return Response.json({ success: false, error: 'Method not allowed' }, { status: 405, headers: CORS_HEADERS });
}
