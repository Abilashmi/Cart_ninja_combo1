// This app's MySQL data (combo_templates, etc.) lives on Hostinger, and
// this Node app doesn't have a direct MySQL route to it (see
// app/services/db.server.js for the full explanation) — so the small
// number of routes that used the Prisma MySQL client for raw queries proxy
// through php_backend/db_proxy.php instead, over HTTPS.
//
// Prisma's raw-query provider (mysql) already used `?` placeholders and a
// `(sql, ...params)` signature, matching this proxy 1:1, so callers are
// unchanged.
//
// Shopify session storage does NOT use this file — it has its own SQLite
// Prisma client (app/session-db.server.js), unaffected by any of this.
import { BASE_PHP_URL } from './utils/api-helpers';

function isReadStatement(sql) {
  return /^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i.test(sql);
}

const DB_PROXY_TIMEOUT_MS = 15_000;

async function rawExecute(sql, params) {
  const res = await fetch(`${BASE_PHP_URL}/db_proxy.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forge-Secret': process.env.SHOPIFY_API_KEY || '',
    },
    body: JSON.stringify({ sql, params }),
    signal: AbortSignal.timeout(DB_PROXY_TIMEOUT_MS),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`DB proxy returned non-JSON (HTTP ${res.status}): ${text.substring(0, 300)}`);
  }

  if (!res.ok || !json.success) {
    throw new Error(json.error || `DB proxy error (HTTP ${res.status})`);
  }

  return isReadStatement(sql) ? json.rows : json.affectedRows;
}

const prisma = {
  $queryRawUnsafe: (sql, ...params) => rawExecute(sql, params),
  $executeRawUnsafe: (sql, ...params) => rawExecute(sql, params),
};

export default prisma;
