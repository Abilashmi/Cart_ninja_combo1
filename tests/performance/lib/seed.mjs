/* eslint-env node */
// Synthetic, non-production data for the performance environment. Every shop is
// perf-shop-NNNN.myshopify.com; nothing here comes from a real store.
// Tables follow the production DDL where the repo has it ("live cart ninja.sql",
// migrations/, the CREATE TABLE IF NOT EXISTS in php_backend / app/services); the
// self-healing columns are added by one warm-up request per endpoint (see warmUp).

export const shopName = (i) => `perf-shop-${String(i).padStart(4, '0')}.myshopify.com`;

const PLANS = [['free', 0.5], ['starter', 0.3], ['growth', 0.12], ['pro', 0.08]];
export function planFor(i) {
  const x = ((i * 2654435761) % 1000) / 1000; // deterministic spread
  let acc = 0;
  for (const [plan, share] of PLANS) { acc += share; if (x < acc) return plan; }
  return 'free';
}

const repeat = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const gid = (kind, n) => `gid://shopify/${kind}/${8000000000 + n}`;

function progressData(i) {
  return JSON.stringify({
    enabled: true, mode: 'amount', placement: 'top', sticky: false, confetti: true,
    colors: { background: '#e5e7eb', fill: '#111827', icon: '#ffffff', text: '#111827' },
    tiers: repeat(3, (t) => ({ id: `t${t}`, minValue: (t + 1) * 500, description: `Unlock reward ${t + 1} for shop ${i}`, rewardType: t === 2 ? 'product' : 'discount', rewardProducts: t === 2 ? [gid('Product', i * 10 + t)] : [], rewardPricing: 'regular' })),
    completionText: 'You unlocked every reward!',
  });
}

function couponData() {
  return JSON.stringify({
    enabled: true, title: 'Offers for you', layout: 'row', cardWidth: 132,
    selectedCoupons: repeat(4, (c) => ({ id: gid('DiscountCodeNode', c), code: `SAVE${10 + c * 5}`, title: `Save ${10 + c * 5}% on your order`, description: 'Applies to everything in the cart, once per customer.', timerEnabled: c === 0, iconShow: true, icon: 'discount' })),
  });
}

function upsellRules(i, n) {
  return repeat(n, (r) => ({ id: `rule-${r}`, trigger: { type: 'product', ids: [gid('Product', i * 100 + r)] }, offer: { ids: [gid('Product', i * 100 + r + 50), gid('Product', i * 100 + r + 51)] }, title: 'You may also like' }));
}

function checkoutStyle() {
  return JSON.stringify({ bg: '#111827', color: '#ffffff', radius: 8, fontSize: 15, paddingY: 16, mobileButtonType: 'swipe' });
}

function fbtTemplate(n) {
  return JSON.stringify({ isEnabled: true, heading: 'Frequently bought together', layout: 'cards', buttonText: 'Add all to cart', colors: { button: '#111827', text: '#ffffff' }, imageSize: 96, gap: 12, widgetPlacement: 'below_atc', note: 'x'.repeat(n) });
}

function fbtCondition(i, rules) {
  return JSON.stringify(repeat(rules, (r) => ({ trigger: gid('Product', i * 100 + r), products: [gid('Product', i * 100 + r + 1), gid('Product', i * 100 + r + 2)], backupProducts: [] })));
}

function codSettings(i) {
  return JSON.stringify({
    enabled: true, requireOtp: true, _runtime: { otpAvailable: true },
    surfaces: { drawer: true, product: true, combo: true }, drawerPlacement: 'above',
    codFeeEnabled: true, codFee: 49, minOrder: 0, maxOrder: 10000, shippingFee: 0, freeShippingAbove: 999,
    blockedPincodes: repeat(20, (p) => String(110000 + p)), excludedProductTags: ['no-cod'],
    buttons: { drawerText: 'Cash on Delivery', productText: 'Buy with Cash on Delivery', bg: '#111827', color: '#ffffff', style: 'filled', radius: 12 },
    sheet: { accent: '#111827', showSummary: true, showTrust: true, thankYou: `Thanks for ordering from shop ${i}` },
    tracking: { ga4Id: '', metaPixelId: '' },
  });
}

/** A data URL of exactly `chars` characters (what BannerImageField stores, max 700000). */
export function bannerDataUrl(chars) {
  const head = 'data:image/webp;base64,';
  return head + 'A'.repeat(Math.max(0, chars - head.length));
}

/**
 * @param db           mysql2 connection to the throwaway database
 * @param opts.shops   number of synthetic shops (default 2000)
 * @param opts.bannerEvery  every Nth shop gets two uploaded banner images (default 10)
 * @param opts.bannerChars  size of each banner data URL (default 600000)
 * @param opts.configCollation  collation of cart_drawer_config (production value unknown, see the report)
 */
export async function seed(db, { shops = 2000, bannerEvery = 10, bannerChars = 600000, configCollation = 'utf8mb4_unicode_ci' } = {}) {
  await db.query('SET SESSION max_allowed_packet = 67108864').catch(() => {});
  await db.query('SET GLOBAL max_allowed_packet = 67108864');
  await db.query(`
    CREATE TABLE shops (
      id INT AUTO_INCREMENT PRIMARY KEY, shop_domain VARCHAR(255) NOT NULL UNIQUE, access_token VARCHAR(255) NULL,
      is_active TINYINT(1) DEFAULT 1, plan_name VARCHAR(100) DEFAULT 'free',
      plan_key VARCHAR(20) NOT NULL DEFAULT 'free', pending_plan_key VARCHAR(20) NULL, billing_interval VARCHAR(10) NOT NULL DEFAULT 'monthly',
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      order_count INT DEFAULT 0, total_revenue DECIMAL(12,2) DEFAULT 0.00
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    CREATE TABLE cart_drawer (
      id INT AUTO_INCREMENT PRIMARY KEY, shop VARCHAR(255) NOT NULL, cartStatus TINYINT(1) DEFAULT 1,
      progress_data LONGTEXT NULL, coupon_data LONGTEXT NULL, upsell_data LONGTEXT NULL,
      progress_status TINYINT(1) DEFAULT 0, coupon_status TINYINT(1) DEFAULT 0, upsell_status TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      checkoutName VARCHAR(255) NULL, checkoutFooterText VARCHAR(500) NULL, customCSS LONGTEXT NULL, checkout_button_style TEXT NULL,
      UNIQUE KEY unique_shop (shop)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    CREATE TABLE cart_drawer_config (
      id INT AUTO_INCREMENT PRIMARY KEY, shop_domain VARCHAR(255) NOT NULL, is_enabled TINYINT(1) DEFAULT 1,
      checkout_button_text VARCHAR(255), checkout_footer_text VARCHAR(255), checkout_button_bg_color VARCHAR(20),
      checkout_button_text_color VARCHAR(20), checkout_button_border_radius INT, custom_css TEXT NULL,
      announcement_enabled TINYINT(1), announcement_text TEXT NULL, announcement_bg_color VARCHAR(20), announcement_text_color VARCHAR(20),
      announcement_font_size INT, open_on_add TINYINT(1), open_on_icon_click TINYINT(1), position VARCHAR(10),
      header_title VARCHAR(255), header_close_style VARCHAR(20), header_bg_color VARCHAR(20), header_text_color VARCHAR(20), header_border_bottom TINYINT(1),
      design_width VARCHAR(20), design_border_radius INT, design_shadow TINYINT(1), design_animation VARCHAR(20),
      empty_cart_message VARCHAR(255), empty_cart_show_continue_shopping TINYINT(1), empty_cart_show_recommendations TINYINT(1),
      banner_enabled TINYINT(1) NOT NULL DEFAULT 0, banner_desktop_image MEDIUMTEXT NULL, banner_mobile_image MEDIUMTEXT NULL,
      banner_placement VARCHAR(20) NOT NULL DEFAULT 'above_progress', banner_alt VARCHAR(160) NULL,
      updated_at DATETIME(3) NULL,
      UNIQUE KEY uniq_shop_domain (shop_domain)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${configCollation};
    CREATE TABLE upsell_widget_settings (
      id INT AUTO_INCREMENT PRIMARY KEY, shop_domain VARCHAR(255) NOT NULL UNIQUE, is_enabled TINYINT(1) DEFAULT 0, manual_rules LONGTEXT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    CREATE TABLE analytics_daily_rollup (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, shop_domain VARCHAR(255) NOT NULL, date DATE NOT NULL,
      order_count INT NOT NULL DEFAULT 0, billable_order_count INT NOT NULL DEFAULT 0,
      PRIMARY KEY (id), UNIQUE KEY uniq_shop_date (shop_domain, date), INDEX idx_shop_date (shop_domain, date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    CREATE TABLE shop_integrations (
      shop VARCHAR(255) NOT NULL PRIMARY KEY, shiprocket_enabled TINYINT(1) NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    CREATE TABLE coupons (
      id INT AUTO_INCREMENT PRIMARY KEY, internal_id VARCHAR(100) NOT NULL, shopify_id VARCHAR(100) NULL, shop_domain VARCHAR(255) NOT NULL,
      code VARCHAR(100) NOT NULL, discount_config LONGTEXT NOT NULL, is_active TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_shop (shop_domain), KEY idx_code (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    CREATE TABLE fbt_widget (
      id INT AUTO_INCREMENT PRIMARY KEY, shopDomain VARCHAR(255) NOT NULL, temp1 LONGTEXT NULL, temp2 LONGTEXT NULL, temp3 LONGTEXT NULL,
      selectedTemp VARCHAR(50) NULL, selectedMode VARCHAR(50) NULL, \`condition\` LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      ai_enabled TINYINT(1) DEFAULT 0, ai_product_count INT DEFAULT 0, UNIQUE KEY unique_shop (shopDomain)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    CREATE TABLE fbt_widget_settings (
      id INT AUTO_INCREMENT PRIMARY KEY, shop_domain VARCHAR(255) NOT NULL UNIQUE, is_enabled TINYINT(1) DEFAULT 1, widget_placement VARCHAR(40) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    CREATE TABLE brix_packs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, shop_domain VARCHAR(255) NOT NULL, product_id VARCHAR(64) NOT NULL, variant_id VARCHAR(64) NOT NULL,
      product_title VARCHAR(255) NOT NULL, variant_title VARCHAR(255) NOT NULL, product_image TEXT NULL, base_price DECIMAL(20,4) NOT NULL DEFAULT 0,
      status VARCHAR(32) NOT NULL DEFAULT 'draft', enabled TINYINT(1) NOT NULL DEFAULT 0, template VARCHAR(32) NOT NULL DEFAULT 'same_variant',
      pack_type VARCHAR(20) NOT NULL DEFAULT 'same_variant', variant_scope VARCHAR(20) NOT NULL DEFAULT 'selected', allowed_variant_ids_json LONGTEXT NULL,
      version INT NOT NULL DEFAULT 1, tiers_json LONGTEXT NOT NULL, customization_json LONGTEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id), UNIQUE KEY brix_packs_shop_variant (shop_domain, product_id, variant_id), KEY brix_packs_shop_status (shop_domain, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    CREATE TABLE brix_packs_shop_state (
      shop_domain VARCHAR(255) NOT NULL, discount_verified TINYINT(1) NOT NULL DEFAULT 0, discount_state VARCHAR(32) NOT NULL DEFAULT 'unknown',
      discount_message VARCHAR(255) NOT NULL DEFAULT '', verified_packs_json LONGTEXT NULL, checked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (shop_domain)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  const banner = bannerDataUrl(bannerChars);
  const today = new Date();
  const monthDays = repeat(Math.min(20, today.getDate()), (d) => `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`);
  const batch = 100;
  for (let start = 0; start < shops; start += batch) {
    const ids = repeat(Math.min(batch, shops - start), (k) => start + k);
    const rows = (f) => ids.map(f);
    await db.query('INSERT INTO shops (shop_domain, plan_name, plan_key, billing_interval) VALUES ?', [rows((i) => [shopName(i), planFor(i), planFor(i), i % 17 === 0 ? 'annual' : 'monthly'])]);
    await db.query('INSERT INTO cart_drawer (shop, cartStatus, progress_data, coupon_data, upsell_data, progress_status, coupon_status, upsell_status, checkoutName, checkoutFooterText, customCSS, checkout_button_style) VALUES ?',
      [rows((i) => [shopName(i), 1, progressData(i), couponData(), JSON.stringify({ enabled: true, title: 'You may also like', limit: 3, manualRules: upsellRules(i, 5) }), 1, 1, 1, 'Checkout • {price}', 'Taxes calculated at checkout', '.cc-drawer{letter-spacing:0}', checkoutStyle()])]);
    await db.query('INSERT INTO cart_drawer_config (shop_domain, announcement_enabled, announcement_text, header_title, design_width, empty_cart_message, banner_enabled, banner_desktop_image, banner_mobile_image, banner_alt, updated_at) VALUES ?',
      [rows((i) => {
        const withBanner = bannerEvery > 0 && i % bannerEvery === 0;
        return [shopName(i), 1, 'Free shipping over ₹999', 'Your cart', '420px', 'Your cart is empty', withBanner ? 1 : 0, withBanner ? banner : null, withBanner ? banner : null, withBanner ? 'Sale banner' : null, new Date()];
      })]);
    await db.query('INSERT INTO upsell_widget_settings (shop_domain, is_enabled, manual_rules) VALUES ?', [rows((i) => [shopName(i), 1, JSON.stringify(upsellRules(i, 20))])]);
    await db.query('INSERT INTO analytics_daily_rollup (shop_domain, date, order_count, billable_order_count) VALUES ?', [ids.flatMap((i) => monthDays.map((d) => [shopName(i), d, 5, 5]))]);
    await db.query('INSERT INTO shop_integrations (shop, shiprocket_enabled) VALUES ?', [rows((i) => [shopName(i), i % 5 === 0 ? 1 : 0])]);
    await db.query('INSERT INTO coupons (internal_id, shopify_id, shop_domain, code, discount_config) VALUES ?', [ids.flatMap((i) => repeat(5, (c) => [`int-${i}-${c}`, gid('DiscountCodeNode', i * 10 + c), shopName(i), `SAVE${c}`, JSON.stringify({ type: 'percentage', value: 10 + c, minSubtotal: 499, title: `Save ${10 + c}%` })]))]);
    await db.query('INSERT INTO fbt_widget (shopDomain, temp1, temp2, temp3, selectedTemp, selectedMode, `condition`, ai_enabled, ai_product_count) VALUES ?', [rows((i) => [shopName(i), fbtTemplate(1500), fbtTemplate(1500), fbtTemplate(1500), 'temp1', i % 3 === 0 ? 'ai' : 'manual', fbtCondition(i, 60), i % 3 === 0 ? 1 : 0, 3])]);
    await db.query('INSERT INTO fbt_widget_settings (shop_domain, is_enabled, widget_placement) VALUES ?', [rows((i) => [shopName(i), 1, 'below_atc'])]);
    const packShops = ids.filter((i) => planFor(i) !== 'free');
    if (packShops.length) {
      await db.query('INSERT INTO brix_packs (shop_domain, product_id, variant_id, product_title, variant_title, base_price, status, enabled, tiers_json, customization_json) VALUES ?',
        [packShops.flatMap((i) => repeat(3, (p) => [shopName(i), String(7000 + p), String(9000 + p), `Product ${p}`, 'Default', 499, 'active', 1, JSON.stringify([{ quantity: 1, discountType: 'percentage', value: 0 }, { quantity: 2, discountType: 'percentage', value: 10 }, { quantity: 3, discountType: 'percentage', value: 15 }]), JSON.stringify({ title: 'Buy more, save more', accent: '#111827' })]))]);
    }
  }
  // Packs verified for every shop that has them (so the storefront GET serves them).
  await db.query(`INSERT INTO brix_packs_shop_state (shop_domain, discount_verified, discount_state, discount_message, verified_packs_json)
    SELECT shop_domain, 1, 'active', 'ok', CONCAT('{', GROUP_CONCAT(CONCAT('"', id, '":1')), '}') FROM brix_packs GROUP BY shop_domain`);
  return { shops, bannerShops: bannerEvery > 0 ? Math.ceil(shops / bannerEvery) : 0, bannerChars };
}

/** COD tables are created by the PHP files themselves; settings for every 3rd shop. */
export async function seedCod(baseUrl, secret, db, shops) {
  // One request creates the COD tables (cod_ensure_tables).
  await fetch(`${baseUrl}/cod_settings.php`, { method: 'POST', headers: { 'X-Forge-Secret': secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get', shop: shopName(0) }) });
  const ids = repeat(shops, (i) => i).filter((i) => i % 3 === 0);
  for (let s = 0; s < ids.length; s += 200) {
    await db.query('INSERT INTO cod_settings (shop, settings_json) VALUES ? ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json)', [ids.slice(s, s + 200).map((i) => [shopName(i), codSettings(i)])]);
  }
}

/** One request per endpoint before measuring, so the self-healing ALTERs are done. */
export async function warmUp(baseUrl) {
  const shop = shopName(1);
  for (const p of [
    `/save_cart_drawer.php?shopdomain=${shop}`,
    `/save_coupon.php?shopdomain=${shop}`,
    `/save_fbt_widget.php?shopdomain=${shop}`,
    `/cod_storefront.php?shop=${shopName(3)}&action=config`,
    `/packs_storefront.php?shop=${shop}&productId=7000`,
  ]) {
    const res = await fetch(baseUrl + p);
    await res.text();
  }
}
