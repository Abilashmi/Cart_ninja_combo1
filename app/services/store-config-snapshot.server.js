import { getDb } from './db.server';

// Reads the enabled/disabled flag for every Brix widget in one call — the
// same five tables php_backend/ai_agent_apply.php already reads back into
// its `after` payload post-apply, now exposed as a reusable Node function so
// read-only features (like the AOV/store-insights flow) don't need a PHP
// round-trip just to know current state.
export async function getStoreConfigSnapshot(shop) {
  const db = getDb();
  const [[cartDrawer], [progressBar], [upsell], [fbt], [couponSlider]] = await Promise.all([
    db.execute('SELECT is_enabled FROM cart_drawer_config WHERE shop_domain = ? LIMIT 1', [shop]),
    db.execute('SELECT is_enabled FROM progress_bar_settings WHERE shop_domain = ? LIMIT 1', [shop]),
    db.execute('SELECT is_enabled FROM upsell_widget_settings WHERE shop_domain = ? LIMIT 1', [shop]),
    db.execute('SELECT is_enabled FROM fbt_widget_settings WHERE shop_domain = ? LIMIT 1', [shop]),
    db.execute('SELECT is_enabled FROM coupon_slider_settings WHERE shop_domain = ? LIMIT 1', [shop]),
  ]);

  return {
    cartDrawer: !!cartDrawer[0]?.is_enabled,
    progressBar: !!progressBar[0]?.is_enabled,
    upsells: !!upsell[0]?.is_enabled,
    fbt: !!fbt[0]?.is_enabled,
    couponSlider: !!couponSlider[0]?.is_enabled,
  };
}
