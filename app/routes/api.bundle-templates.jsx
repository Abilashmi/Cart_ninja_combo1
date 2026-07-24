import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';
import { checkComboPlanGate, createComboTemplate } from '../services/combo-templates.server';
import { ensureComboForgeTemplate } from '../services/combo-page.server';

// Shopify Pages don't process Liquid tags in their body content (confirmed
// live — {{ ... }} shows up as literal text to shoppers), so shop/templateId
// must be baked in as plain strings at creation time, and the renderer must
// be served from this app rather than referenced via the asset_url Liquid
// filter. See app/routes/combo-page[.]js.jsx for the actual renderer.
// Used as a fallback body even when the guaranteed template (below) is
// active, so a page still shows something sane if the merchant later
// switches it back to the Default Page template.
function buildPageBody(shop, templateId) {
  const scriptOrigin = process.env.SHOPIFY_APP_URL || 'https://cartdrawer.fly.dev';
  return `<!-- Combo Bundle Template -->
<div data-brix-combo-root data-shop="${shop}" data-template-id="${templateId}"></div>
<script src="${scriptOrigin}/combo-page.js" defer></script>`;
}

// ── Shopify page helpers ───────────────────────────────────────────────────────

// namespace/key here must match what the provisioned section reads via
// `page.metafields.combo_forge.template_id` (see combo-page.server.js's
// ensureComboForgeTemplate / comboForgeSectionLiquid).
function comboForgePageFields(shop, templateId, hasGuaranteedTemplate) {
  const fields = { body: buildPageBody(shop, templateId) };
  if (hasGuaranteedTemplate) {
    fields.templateSuffix = 'combo-forge';
    fields.metafields = [{ namespace: 'combo_forge', key: 'template_id', type: 'number_integer', value: String(templateId) }];
  }
  return fields;
}

async function createShopifyPage(admin, title, handle, shop, templateId) {
  const hasGuaranteedTemplate = await ensureComboForgeTemplate(admin);
  const res = await admin.graphql(`#graphql
    mutation pageCreate($page: PageCreateInput!) {
      pageCreate(page: $page) {
        page { id title handle }
        userErrors { field message }
      }
    }
  `, { variables: { page: { title, handle, ...comboForgePageFields(shop, templateId, hasGuaranteedTemplate) } } });
  const json = await res.json();
  if (json.data?.pageCreate?.userErrors?.length > 0) {
    throw new Error(json.data.pageCreate.userErrors.map(e => e.message).join('; '));
  }
  const page = json.data?.pageCreate?.page;
  return { id: page?.id, handle: page?.handle || handle };
}

// ── Loader (GET) ──────────────────────────────────────────────────────────────

export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const id = url.searchParams.get('id');

  if (!shop) return Response.json({ success: false, error: 'shop parameter required' }, { status: 400 });

  const db = getDb();
  try {
    if (id) {
      const [rows] = await db.execute(
        'SELECT * FROM combo_templates WHERE id = ? AND shop_domain = ?',
        [Number(id), shop]
      );
      const row = rows[0] || null;
      if (!row) return Response.json({ success: false, error: 'Template not found' }, { status: 404 });
      return Response.json({ success: true, template: row });
    }
    const [rows] = await db.execute(
      'SELECT * FROM combo_templates WHERE shop_domain = ? ORDER BY updated_at DESC',
      [shop]
    );
    return Response.json({ success: true, templates: rows });
  } catch (e) {
    console.error('[bundle-templates loader]', e.message);
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
}

// ── Action (POST / DELETE) ────────────────────────────────────────────────────

export async function action({ request }) {
  if (request.method === 'POST') {
    let admin, session;
    try {
      const auth = await authenticate.admin(request);
      admin = auth.admin; session = auth.session;
    } catch (e) {
      return Response.json({ success: false, error: 'Authentication failed: ' + e.message }, { status: 401 });
    }
    const shop = session.shop;
    const db = getDb();

    let data;
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await request.json();
    } else {
      const formData = await request.formData();
      data = JSON.parse(formData.get('body') || '{}');
    }
    const { id, name, template_type, status, is_active, customization_data, publishParams, action: dataAction } = data;

    // ── Preview action ──────────────────────────────────────────────────────
    if (dataAction === 'preview') {
      const [rows] = await db.execute(
        'SELECT * FROM combo_templates WHERE id = ? AND shop_domain = ?',
        [Number(id), shop]
      );
      const row = rows[0] || null;
      if (!row) return Response.json({ success: false, error: 'Template not found' }, { status: 404 });

      const handle = row.page_handle || (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'combo-page';

      try {
        const existingRes = await admin.graphql(`#graphql
          query getPageByHandle($handle: String!) { pageByHandle(handle: $handle) { id title handle } }
        `, { variables: { handle } });
        const existingJson = await existingRes.json();
        const existingPage = existingJson.data?.pageByHandle;
        if (existingPage) {
          await db.execute('UPDATE combo_templates SET page_handle = ?, page_id = ? WHERE id = ?', [existingPage.handle, existingPage.id, Number(id)]);
          try {
            const hasGuaranteedTemplate = await ensureComboForgeTemplate(admin);
            await admin.graphql(`#graphql
              mutation pageUpdate($id: ID!, $page: PageUpdateInput!) { pageUpdate(id: $id, page: $page) { page { id } userErrors { message } } }
            `, { variables: { id: existingPage.id, page: comboForgePageFields(shop, id, hasGuaranteedTemplate) } });
          } catch {}
          return Response.json({ success: true, previewUrl: `https://${shop}/pages/${existingPage.handle}?preview`, handle: existingPage.handle });
        }
      } catch {}

      try {
        const pageResult = await createShopifyPage(admin, name || 'Combo Page', handle, shop, id);
        if (pageResult) {
          await db.execute('UPDATE combo_templates SET page_handle = ?, page_id = ? WHERE id = ?', [pageResult.handle, pageResult.id, Number(id)]);
          return Response.json({ success: true, previewUrl: `https://${shop}/pages/${pageResult.handle}?preview`, handle: pageResult.handle });
        }
      } catch (e) {
        return Response.json({ success: false, error: e.message });
      }
    }

    let pageResult = null;
    let pageError = null;
    const isActive = (is_active === 1 || is_active === true) ? 1 : 0;

    // ── Update existing template ────────────────────────────────────────────
    if (id) {
      await db.execute(
        `UPDATE combo_templates SET
           shop_domain = ?, name = ?, template_type = ?, status = ?, is_active = ?,
           customization_data = ?, page_handle = ?, page_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          shop, name || 'Untitled', template_type || 'grid', status || 'draft', isActive,
          customization_data || '{}',
          publishParams?.pageInfo?.handle || null,
          publishParams?.pageInfo?.selectedPageId || null,
          Number(id),
        ]
      );

      if (publishParams?.pageInfo && !publishParams.pageInfo.selectedPageId) {
        try {
          pageResult = await createShopifyPage(admin, publishParams.pageInfo.title, publishParams.pageInfo.handle, shop, id);
          if (pageResult) {
            await db.execute('UPDATE combo_templates SET page_handle = ?, page_id = ? WHERE id = ?', [pageResult.handle, pageResult.id, Number(id)]);
          }
        } catch (e) {
          pageError = e.message;
        }
      }

      if (pageError) return Response.json({ success: false, error: `Template saved but page creation failed: ${pageError}`, id });
      return Response.json({ success: true, message: 'Template updated', id, page: pageResult });
    }

    // ── Create new template ─────────────────────────────────────────────────
    // Backend enforcement of Build a Combo plan gating — defense-in-depth
    // against a Free shop (or a Starter shop at its cap) hitting this API
    // directly, bypassing the dashboard's own pre-emptive UI lock.
    const gateError = await checkComboPlanGate(shop);
    if (gateError) return Response.json({ success: false, ...gateError }, { status: 403 });

    const newId = await createComboTemplate(shop, {
      name, template_type, status, is_active: isActive,
      customization_data,
      page_handle: publishParams?.pageInfo?.handle || null,
      page_id: publishParams?.pageInfo?.selectedPageId || null,
    });

    if (publishParams?.pageInfo && !publishParams.pageInfo.selectedPageId) {
      try {
        pageResult = await createShopifyPage(admin, publishParams.pageInfo.title, publishParams.pageInfo.handle, shop, newId);
        if (pageResult) {
          await db.execute('UPDATE combo_templates SET page_handle = ?, page_id = ? WHERE id = ?', [pageResult.handle, pageResult.id, newId]);
        }
      } catch (e) {
        pageError = e.message;
      }
    }

    if (pageError) return Response.json({ success: false, error: `Template saved but page creation failed: ${pageError}`, id: newId });
    return Response.json({ success: true, message: 'Template created', id: newId, page: pageResult });
  }

  if (request.method === 'DELETE') {
    let session;
    try {
      const auth = await authenticate.admin(request);
      session = auth.session;
    } catch (e) {
      return Response.json({ success: false, error: 'Authentication failed' }, { status: 401 });
    }
    const data = await request.json();
    const { id } = data;
    if (!id) return Response.json({ success: false, error: 'id required' }, { status: 400 });
    const db = getDb();
    await db.execute('DELETE FROM combo_templates WHERE id = ? AND shop_domain = ?', [Number(id), session.shop]);
    return Response.json({ success: true, message: 'Template deleted' });
  }

  return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
}
