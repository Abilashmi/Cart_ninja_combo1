// Share links for client reports (Internal → Reports → Create share link): a
// frozen copy of the report page, opened by anyone with the link at /r/<id>
// (routes/r.$id.jsx) until it expires or is turned off. Frozen, so the client
// sees the numbers that were sent, and the link keeps working after the dates
// fall out of the 60 days of orders Shopify gives the app. The id is 128
// random bits, the only secret; the table lives in MySQL (db_proxy.php).
import crypto from 'node:crypto';
import { getDb } from './db.server';

export const SHARE_DAYS = [7, 30, 90];
export const DEFAULT_SHARE_DAYS = 30;
const SHARE_ID = /^[a-f0-9]{32}$/;
const MAX_HTML = 1_500_000; // a 31-day report is ~60 KB

let ensured = false;
async function ensureTable(db) {
  if (ensured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS client_report_shares (
      id          CHAR(32)     NOT NULL,
      shop        VARCHAR(255) NOT NULL,
      shop_name   VARCHAR(255) NOT NULL DEFAULT '',
      from_day    DATE         NOT NULL,
      to_day      DATE         NOT NULL,
      html        MEDIUMTEXT   NOT NULL,
      created_at  DATETIME     NOT NULL,
      expires_at  DATETIME     NOT NULL,
      revoked     TINYINT(1)   NOT NULL DEFAULT 0,
      PRIMARY KEY (id),
      KEY idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  ensured = true;
}

/** Saves the page; returns { id, days }. */
export async function createShare({ report, html, days }) {
  const keep = SHARE_DAYS.includes(Number(days)) ? Number(days) : DEFAULT_SHARE_DAYS;
  if (!html || html.length > MAX_HTML) throw new Error('report page too large to share');
  const db = getDb();
  await ensureTable(db);
  const id = crypto.randomBytes(16).toString('hex');
  await db.execute(
    `INSERT INTO client_report_shares (id, shop, shop_name, from_day, to_day, html, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY))`,
    [id, report.shop, String(report.shopName || '').slice(0, 255), report.from, report.to, html, keep],
  );
  return { id, days: keep };
}

/** The shared page, or null when the id is unknown, expired or turned off. */
export async function getShare(id) {
  if (!SHARE_ID.test(String(id || ''))) return null;
  const db = getDb();
  await ensureTable(db);
  const [rows] = await db.execute(
    'SELECT html FROM client_report_shares WHERE id = ? AND revoked = 0 AND expires_at > UTC_TIMESTAMP() LIMIT 1',
    [id],
  );
  return rows && rows[0] ? { html: rows[0].html } : null;
}

/** The newest links (live first), for the reports page. */
export async function listShares(limit = 20) {
  const db = getDb();
  await ensureTable(db);
  const [rows] = await db.execute(
    `SELECT id, shop, shop_name, DATE_FORMAT(from_day, '%Y-%m-%d') AS from_day, DATE_FORMAT(to_day, '%Y-%m-%d') AS to_day,
       DATE_FORMAT(created_at, '%Y-%m-%d') AS created, DATE_FORMAT(expires_at, '%Y-%m-%d') AS expires,
       (revoked = 0 AND expires_at > UTC_TIMESTAMP()) AS live
     FROM client_report_shares ORDER BY created_at DESC LIMIT ${Math.max(1, Math.min(100, Number(limit) || 20))}`,
  );
  return (rows || []).map((r) => ({ ...r, live: Number(r.live) === 1 }));
}

/** Turns a link off for good. */
export async function revokeShare(id) {
  if (!SHARE_ID.test(String(id || ''))) return false;
  const db = getDb();
  await ensureTable(db);
  await db.execute('UPDATE client_report_shares SET revoked = 1 WHERE id = ?', [id]);
  return true;
}
