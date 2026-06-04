import prisma from '../db.server';

const TABLE_NAME = 'combo_templates';

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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export async function loader({ request }) {
  await ensureTable();
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const id = url.searchParams.get('id');

  if (!shop) {
    return Response.json({ success: false, error: 'shop parameter required' }, { status: 400 });
  }

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

  const templates = await prisma.$queryRawUnsafe(
    `SELECT * FROM ${TABLE_NAME} WHERE shop_domain = ? ORDER BY updated_at DESC`,
    shop
  );
  return Response.json({ success: true, templates: Array.isArray(templates) ? templates : [] });
}

export async function action({ request }) {
  await ensureTable();

  if (request.method === 'POST') {
    const data = await request.json();
    const { shop_domain, id, name, template_type, status, is_active, slug, description, features, customization_data } = data;

    if (!shop_domain) {
      return Response.json({ success: false, error: 'shop_domain required' }, { status: 400 });
    }

    const genSlug = slug || name?.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();

    if (id) {
      await prisma.$executeRawUnsafe(
        `UPDATE ${TABLE_NAME} SET name = ?, template_type = ?, status = ?, is_active = ?, slug = ?, description = ?, features = ?, customization_data = ?, version = version + 1, updated_at = datetime('now') WHERE id = ? AND shop_domain = ?`,
        name || '', template_type || 'grid', status || 'draft', is_active ?? 1, genSlug, description || '', features || null, customization_data || null, Number(id), shop_domain
      );

      if (data.publishParams?.pageInfo) {
        const existing = await prisma.$queryRawUnsafe(
          `SELECT customization_data FROM ${TABLE_NAME} WHERE id = ? AND shop_domain = ?`,
          Number(id), shop_domain
        );
        const row = Array.isArray(existing) && existing.length > 0 ? existing[0] : null;
        let cd = {};
        try { cd = row?.customization_data ? JSON.parse(row.customization_data) : {}; } catch {}
        cd.pageInfo = data.publishParams.pageInfo;
        await prisma.$executeRawUnsafe(
          `UPDATE ${TABLE_NAME} SET customization_data = ?, updated_at = datetime('now') WHERE id = ?`,
          JSON.stringify(cd), Number(id)
        );
      }

      return Response.json({ success: true, message: 'Template updated', id: Number(id) });
    }

    const result = await prisma.$executeRawUnsafe(
      `INSERT INTO ${TABLE_NAME} (shop_domain, name, slug, template_type, status, is_active, description, features, customization_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      shop_domain, name || 'Untitled Template', genSlug, template_type || 'grid', status || 'draft', is_active ?? 1, description || '', features || null, customization_data || null
    );

    const lastId = await prisma.$queryRawUnsafe(`SELECT last_insert_rowid() as id`);
    const newId = Array.isArray(lastId) && lastId.length > 0 ? Number(lastId[0].id) : 0;

    return Response.json({ success: true, message: 'Template created', id: newId });
  }

  if (request.method === 'DELETE') {
    const data = await request.json();
    const { id, shop_domain } = data;
    if (!id) {
      return Response.json({ success: false, error: 'id required' }, { status: 400 });
    }
    if (shop_domain) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM ${TABLE_NAME} WHERE id = ? AND shop_domain = ?`,
        Number(id), shop_domain
      );
    } else {
      await prisma.$executeRawUnsafe(
        `DELETE FROM ${TABLE_NAME} WHERE id = ?`,
        Number(id)
      );
    }
    return Response.json({ success: true, message: 'Template deleted' });
  }

  return Response.json({ success: false, error: 'Method not allowed' }, { status: 405 });
}
