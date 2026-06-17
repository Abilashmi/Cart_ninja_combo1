import { getDb } from "../services/db.server";

export async function loader() {
  try {
    const db = getDb();
    const [rows] = await db.execute("SELECT 1+1 AS result, DATABASE() AS db_name");
    const [tables] = await db.execute(`
      SELECT TABLE_NAME, TABLE_ROWS
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME
    `);
    return Response.json({
      success: true,
      connection: rows[0],
      tables: tables.map(t => ({ name: t.TABLE_NAME, rows: t.TABLE_ROWS })),
    });
  } catch (e) {
    return Response.json({ success: false, error: e.message, code: e.code }, { status: 500 });
  }
}
