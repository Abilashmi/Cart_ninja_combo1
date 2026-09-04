/**
 * Server-side client for the Agency Dashboard's internal (shared-secret)
 * API. Two separate hosts hold this shared secret + base URL: the PHP
 * backend at int.thebrix.io (php_backend/install_shop.php,
 * uninstall_shop.php) and this Node app's own environment (Fly.io
 * secrets) — configured independently since they're different
 * runtimes/deployments, but must carry the exact same values on both
 * sides for the Agency Dashboard to trust either caller.
 */

function agencyDashboardHeaders() {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    // eslint-disable-next-line no-undef
    "X-Internal-Secret": process.env.AGENCY_DASHBOARD_INTERNAL_SECRET || "",
  };
}

function agencyDashboardUrl(path) {
  // eslint-disable-next-line no-undef
  const base = (process.env.AGENCY_DASHBOARD_URL || "").replace(/\/+$/, "");
  return `${base}${path}`;
}

/**
 * Read-only agency-connection status check for a shop, backed entirely by
 * brix_superadmin (installation_status + agency_stores.relationship_status)
 * through the Agency Dashboard's existing internal endpoint. Never throws —
 * an unreachable/misconfigured Agency Dashboard degrades to stage "ERROR"
 * so callers can fail open (e.g. Home should still render normally).
 * @param {string} shop
 * @returns {Promise<{stage: string, [key: string]: any}>}
 */
const STATUS_ENDPOINT = "/internal/shopify/agency/store-status";

// Temporary diagnostics for the post-install agency hand-off — safe to
// remove once the redirect is confirmed working against the real deployed
// Agency Dashboard. Never logs the shared secret, access tokens, or
// response bodies — only the shop domain, endpoint, HTTP status/stage, or
// error type.
function logAgencyStatusDebug(shop, fields) {
  // eslint-disable-next-line no-undef
  console.log(
    `[BRIX AGENCY DEBUG] shop=${shop} status_endpoint=${STATUS_ENDPOINT} ` +
    Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(" ")
  );
}

export async function getAgencyStoreStatus(shop) {
  try {
    const res = await fetch(
      agencyDashboardUrl(`${STATUS_ENDPOINT}?shop_domain=${encodeURIComponent(shop)}`),
      { headers: agencyDashboardHeaders() }
    );
    const body = await res.json();
    if (!res.ok || !body?.success) {
      logAgencyStatusDebug(shop, { http_status: res.status, stage: "ERROR" });
      return { stage: "ERROR", shop };
    }
    logAgencyStatusDebug(shop, { http_status: res.status, stage: body.data?.stage });
    return { ...body.data, shop };
  } catch (err) {
    logAgencyStatusDebug(shop, { error: err?.name || "unknown", message: err?.message || "" });
    return { stage: "ERROR", shop };
  }
}

export { agencyDashboardHeaders, agencyDashboardUrl };
