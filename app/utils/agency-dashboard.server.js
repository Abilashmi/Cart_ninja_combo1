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
export async function getAgencyStoreStatus(shop) {
  try {
    const res = await fetch(
      agencyDashboardUrl(`/internal/shopify/agency/store-status?shop_domain=${encodeURIComponent(shop)}`),
      { headers: agencyDashboardHeaders() }
    );
    const body = await res.json();
    if (!res.ok || !body?.success) {
      return { stage: "ERROR", shop };
    }
    return { ...body.data, shop };
  } catch {
    return { stage: "ERROR", shop };
  }
}

export { agencyDashboardHeaders, agencyDashboardUrl };
