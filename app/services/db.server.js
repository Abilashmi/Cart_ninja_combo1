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

// The remote (Hostinger) MySQL host is connection-limited, and db_proxy.php
// opens a fresh connection per request — a burst of parallel saves (this
// app's Cart Editor fires several at once) can transiently exceed that
// ceiling. That failure is recoverable a moment later, so it's worth one
// quick retry rather than surfacing a hard "Save failed" to the merchant.
const TRANSIENT_DB_ERROR = /DB Connection Failed/i;
const RETRY_DELAY_MS = 400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function proxyExecuteOnce(sql, params) {
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
    throw new Error(json.error || json.message || `DB proxy error (HTTP ${res.status})`);
  }

  if (isReadStatement(sql)) {
    return [json.rows];
  }
  return [{ insertId: json.insertId, affectedRows: json.affectedRows }];
}

async function proxyExecute(sql, params = []) {
  try {
    return await proxyExecuteOnce(sql, params);
  } catch (error) {
    if (!TRANSIENT_DB_ERROR.test(error.message)) throw error;
    console.warn('[db_proxy] transient DB connection failure, retrying once:', error.message);
    await sleep(RETRY_DELAY_MS);
    return proxyExecuteOnce(sql, params);
  }
}

let db = null;

export function getDb() {
  if (!db) {
    db = { execute: proxyExecute };
  }
  return db;
}
