import { getDb } from './db.server';

// Reads the enabled/disabled flag for every Brix widget in one call — the
// same five tables php_backend/ai_agent_apply.php already reads back into
// its `after` payload post-apply, now exposed as a reusable Node function so
// read-only features (like the AOV/store-insights flow) don't need a PHP
// round-trip just to know current state.
//
// Sequential, not Promise.all: db.execute is an HTTPS call to
// php_backend/db_proxy.php (see db.server.js), and firing 5 of these at
// once intermittently tripped the Hostinger host's own rate-limiting —
// db_proxy.php returned an HTML challenge/interstitial page (HTTP 403)
// instead of JSON, which surfaced to the merchant as "Something went
// wrong analyzing your store." One request at a time avoids the burst.
export async function getStoreConfigSnapshot(shop) {
  const db = getDb();
  const [cartDrawer] = (await db.execute('SELECT is_enabled FROM cart_drawer_config WHERE shop_domain = ? LIMIT 1', [shop]))[0];
  const [progressBar] = (await db.execute('SELECT is_enabled FROM progress_bar_settings WHERE shop_domain = ? LIMIT 1', [shop]))[0];
  const [upsell] = (await db.execute('SELECT is_enabled FROM upsell_widget_settings WHERE shop_domain = ? LIMIT 1', [shop]))[0];
  const [fbt] = (await db.execute('SELECT is_enabled FROM fbt_widget_settings WHERE shop_domain = ? LIMIT 1', [shop]))[0];
  const [couponSlider] = (await db.execute('SELECT is_enabled FROM coupon_slider_settings WHERE shop_domain = ? LIMIT 1', [shop]))[0];

  return {
    cartDrawer: !!cartDrawer?.is_enabled,
    progressBar: !!progressBar?.is_enabled,
    upsells: !!upsell?.is_enabled,
    fbt: !!fbt?.is_enabled,
    couponSlider: !!couponSlider?.is_enabled,
  };
}
