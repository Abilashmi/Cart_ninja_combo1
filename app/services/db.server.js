// Direct TCP MySQL access isn't available from where this app runs (Fly.io)
// to where MySQL lives (Hostinger, remote-MySQL connection-limited) — so
// this pool is actually an HTTPS proxy to php_backend/db_proxy.php, which
// runs on the same server as MySQL and executes the statement locally.
//
// The exposed shape (`db.execute(sql, params)` -> `[rows]` for reads,
// `[{ insertId, affectedRows }]` for writes) intentionally mirrors
// mysql2/promise's pool.execute() so none of this app's ~45 call sites
// needed to change.
import { BASE_PHP_URL } from '../utils/api-helpers';

function isReadStatement(sql) {
  return /^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i.test(sql);
}

// Every one of this app's ~45 DB call sites goes through this single fetch,
// so a stalled (not just erroring) PHP host would otherwise hang every one
// of them indefinitely rather than failing fast.
const DB_PROXY_TIMEOUT_MS = 15_000;

async function proxyExecute(sql, params = []) {
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
    console.error('[db_proxy] raw response body:', text.substring(0, 1000));
    throw new Error(json.error || `DB proxy error (HTTP ${res.status})`);
  }

  if (isReadStatement(sql)) {
    return [json.rows];
  }
  return [{ insertId: json.insertId, affectedRows: json.affectedRows }];
}

let db = null;

export function getDb() {
  if (!db) {
    db = { execute: proxyExecute };
  }
  return db;
}
