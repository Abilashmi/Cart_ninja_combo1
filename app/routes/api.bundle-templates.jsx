import prisma from '../db.server';
import { authenticate } from '../shopify.server';
import { sendToPhp } from '../utils/api-helpers';

const TABLE_NAME = 'combo_templates';

const PAGE_BODY = `<!-- Combo Bundle Template -->
<div id="cc-root" data-shop="{{ shop.permanent_domain }}" data-currency="{{ shop.currency }}"></div>
{{ 'cart_drawer_inline.css' | asset_url | stylesheet_tag }}
<script src="{{ 'cart_drawer_inline.js' | asset_url }}" defer></script>`;

async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_domain TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      slug TEXT,
      template_type TEXT NOT NULL DEFAULT 'grid',
      status TEXT NOT NULL DEFAULT 'draft',
      is_active INTEGER NOT NULL DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      features TEXT,
      customization_data TEXT,
      page_handle TEXT,
      page_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await prisma.$executeRawUnsafe(`ALTER TABLE ${TABLE_NAME} ADD COLUMN page_handle TEXT`).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE ${TABLE_NAME} ADD COLUMN page_id TEXT`).catch(() => {});
}

export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const id = url.searchParams.get('id');

  if (!shop) {
    return Response.json({ success: false, error: 'shop parameter required' }, { status: 400 });
  }

  await ensureTable();
  if (id) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT * FROM ${TABLE_NAME} WHERE id = ? AND shop_domain = ?`,
      Number(id), shop
    );
    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!row) {
      return Response.json({ success: false, error: 'Template not found' }, { status: 404 });
    }
    return Response.json({ success: true, template: row });
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM ${TABLE_NAME} WHERE shop_domain = ? ORDER BY updated_at DESC`,
    shop
  );
  return Response.json({ success: true, templates: Array.isArray(rows) ? rows : [] });
}

async function createShopifyPage(admin, title, handle) {
  const mutation = `#graphql
    mutation pageCreate($page: PageCreateInput!) {
      pageCreate(page: $page) {
        page {
          id
          title
          handle
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const res = await admin.graphql(mutation, {
    variables: {
      page: {
        title,
        handle,
        body: PAGE_BODY,
      },
    },
  });

  const json = await res.json();
  if (json.data?.pageCreate?.userErrors?.length > 0) {
    const errs = json.data.pageCreate.userErrors.map(e => e.message).join('; ');
    throw new Error(`Page creation failed: ${errs}`);
  }

  const page = json.data?.pageCreate?.page;
  return {
    id: page?.id,
    handle: page?.handle || handle,
  };
}

export async function action({ request }) {
  if (request.method === 'POST') {
    // Authenticate FIRST before consuming the body (CSRF token needs the body)
    let admin, session;
    try {
      const auth = await authenticate.admin(request);
      admin = auth.admin;
      session = auth.session;
    } catch (e) {
      return Response.json({ success: false, error: 'Authentication failed: ' + e.message }, { status: 401 });
    }
    const shop = session.shop;

    let data;
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await request.json();
    } else {
      const formData = await request.formData();
      data = JSON.parse(formData.get('body') || '{}');
    }
    const { id, name, template_type, status, is_active, customization_data, publishParams, action: dataAction } = data;

    // Preview-only action: create/get the page URL for a template
    if (dataAction === 'preview') {
      await ensureTable();
      const rows = await prisma.$queryRawUnsafe(
        `SELECT * FROM ${TABLE_NAME} WHERE id = ? AND shop_domain = ?`,
        Number(id), shop
      );
      const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
      if (!row) {
        return Response.json({ success: false, error: 'Template not found' }, { status: 404 });
      }

      let handle = row.page_handle || (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'combo-page';
      // Try to find existing page by handle first
      try {
        const existingRes = await admin.graphql(`#graphql
          query getPageByHandle($handle: String!) {
            pageByHandle(handle: $handle) {
              id
              title
              handle
            }
          }
        `, { variables: { handle } });
        const existingJson = await existingRes.json();
        const existingPage = existingJson.data?.pageByHandle;
        if (existingPage) {
          await prisma.$executeRawUnsafe(
            `UPDATE ${TABLE_NAME} SET page_handle = ?, page_id = ? WHERE id = ?`,
            existingPage.handle, existingPage.id, Number(id)
          );
          // Update existing page body so it renders the cart drawer
          try {
            await admin.graphql(`#graphql
              mutation pageUpdate($id: ID!, $page: PageUpdateInput!) {
                pageUpdate(id: $id, page: $page) {
                  page { id title handle }
                  userErrors { field message }
                }
              }
            `, {
              variables: {
                id: existingPage.id,
                page: {
                  body: PAGE_BODY,
                },
              },
            });
          } catch (_e2) {}
          return Response.json({ success: true, previewUrl: `https://${shop}/pages/${existingPage.handle}?preview`, handle: existingPage.handle });
        }
      } catch (_e) {}

      // Create new page
      try {
        const pageResult = await createShopifyPage(admin, name || 'Combo Page', handle);
        if (pageResult) {
          await prisma.$executeRawUnsafe(
            `UPDATE ${TABLE_NAME} SET page_handle = ?, page_id = ? WHERE id = ?`,
            pageResult.handle, pageResult.id, Number(id)
          );
          return Response.json({ success: true, previewUrl: `https://${shop}/pages/${pageResult.handle}?preview`, handle: pageResult.handle });
        }
      } catch (e) {
        return Response.json({ success: false, error: e.message });
      }
    }

    await ensureTable();

    let pageResult = null;
    let pageError = null;

    if (id) {
      await prisma.$executeRawUnsafe(
        `UPDATE ${TABLE_NAME} SET shop_domain = ?, name = ?, template_type = ?, status = ?, is_active = ?, customization_data = ?, page_handle = ?, page_id = ?, updated_at = datetime('now') WHERE id = ?`,
        shop, name || 'Untitled', template_type || 'grid', status || 'draft',
        is_active === 1 || is_active === true ? 1 : 0, customization_data || '{}',
        publishParams?.pageInfo?.handle || null, publishParams?.pageInfo?.selectedPageId || null,
        Number(id)
      );

      if (publishParams?.pageInfo && !publishParams.pageInfo.selectedPageId) {
        try {
          pageResult = await createShopifyPage(admin, publishParams.pageInfo.title, publishParams.pageInfo.handle);
          if (pageResult) {
            await prisma.$executeRawUnsafe(
              `UPDATE ${TABLE_NAME} SET page_handle = ?, page_id = ? WHERE id = ?`,
              pageResult.handle, pageResult.id, Number(id)
            );
          }
        } catch (e) {
          pageError = e.message;
          console.error('[Templates] Shopify page creation error:', e);
        }
      }

      if (pageError) {
        return Response.json({ success: false, error: `Template saved but page creation failed: ${pageError}`, pageError, id });
      }

      // Sync to PHP backend
      sendToPhp({
        event: 'update',
        resource: 'templates',
        shop_domain: shop,
        data: { id: Number(id), name, template_type, status, is_active, customization_data, page_handle: publishParams?.pageInfo?.handle || null, page_id: publishParams?.pageInfo?.selectedPageId || null },
      }, 'templates.php').catch(() => {});

      return Response.json({ success: true, message: 'Template updated', id, page: pageResult });
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO ${TABLE_NAME} (shop_domain, name, template_type, status, is_active, customization_data, page_handle, page_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      shop, name || 'Untitled', template_type || 'grid', status || 'draft',
      is_active === 1 || is_active === true ? 1 : 0, customization_data || '{}',
      publishParams?.pageInfo?.handle || null, publishParams?.pageInfo?.selectedPageId || null
    );

    const idResult = await prisma.$queryRawUnsafe(`SELECT last_insert_rowid() as id`);
    const newId = Array.isArray(idResult) && idResult.length > 0 ? Number(idResult[0].id) : null;

    if (publishParams?.pageInfo && !publishParams.pageInfo.selectedPageId) {
      try {
        pageResult = await createShopifyPage(admin, publishParams.pageInfo.title, publishParams.pageInfo.handle);
        if (pageResult) {
          await prisma.$executeRawUnsafe(
            `UPDATE ${TABLE_NAME} SET page_handle = ?, page_id = ? WHERE id = ?`,
            pageResult.handle, pageResult.id, newId
          );
        }
      } catch (e) {
        pageError = e.message;
        console.error('[Templates] Shopify page creation error:', e);
      }
    }

    if (pageError) {
      return Response.json({ success: false, error: `Template saved but page creation failed: ${pageError}`, pageError, id: newId });
    }

    // Sync to PHP backend
    sendToPhp({
      event: 'create',
      resource: 'templates',
      shop_domain: shop,
      data: { id: newId, name, template_type, status, is_active, customization_data, page_handle: publishParams?.pageInfo?.handle || null, page_id: publishParams?.pageInfo?.selectedPageId || null },
    }, 'templates.php').catch(() => {});

    return Response.json({ success: true, message: 'Template created', id: newId, page: pageResult });
  }

  if (request.method === 'DELETE') {
    let admin, session;
    try {
      const auth = await authenticate.admin(request);
      admin = auth.admin;
      session = auth.session;
    } catch (e) {
      return Response.json({ success: false, error: 'Authentication failed' }, { status: 401 });
    }
    const data = await request.json();
    const { id } = data;
    if (!id) {
      return Response.json({ success: false, error: 'id required' }, { status: 400 });
    }
    await ensureTable();
    await prisma.$executeRawUnsafe(`DELETE FROM ${TABLE_NAME} WHERE id = ?`, Number(id));
    return Response.json({ success: true, message: 'Template deleted' });
  }

  return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
}
