/* eslint-env node */
// Cart Image Banner end to end, against the real PHP backend on a throwaway
// MariaDB (tests/cod/php-harness.mjs; never the shared production database):
//   Node saveCartDrawerConfig  → db_proxy.php → cart_drawer_config
//   storefront GET             → save_cart_drawer.php (banner_*_src, no image data)
//   image                      → cart_banner_image.php (real bytes, long cache)
// Run with: node --import ./tests/packs/register.mjs --test tests/cart-drawer/banner-php.test.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { harnessAvailable, startHarness } from '../cod/php-harness.mjs';

if (!harnessAvailable()) {
  test('cart banner PHP tests need XAMPP (MariaDB + PHP)', { skip: true }, () => {});
} else {
  const harness = await startHarness({ extraFiles: ['save_cart_drawer.php', 'cart_banner_image.php', 'db_proxy.php', 'shop_integrations.php'] });
  process.env.PHP_BASE_URL = harness.baseUrl;
  process.env.SHOPIFY_API_KEY = harness.secret;
  after(() => harness.stop());

  const { db } = harness;
  const SHOP = 'banner-test.myshopify.com';
  const NEW_SHOP = 'fresh-shop.myshopify.com';
  // Tables as they exist before this feature: no banner_* columns anywhere.
  await db.query(`CREATE TABLE cart_drawer (
    id INT AUTO_INCREMENT PRIMARY KEY, shop VARCHAR(255) NOT NULL UNIQUE, cartStatus TINYINT(1) DEFAULT 1,
    progress_status TINYINT(1) DEFAULT 0, progress_data TEXT NULL, upsell_status TINYINT(1) DEFAULT 0, upsell_data TEXT NULL,
    coupon_status TINYINT(1) DEFAULT 0, coupon_data TEXT NULL, checkout_button_style TEXT NULL, custom_css TEXT NULL
  ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE cart_drawer_config (
    id INT AUTO_INCREMENT PRIMARY KEY, shop_domain VARCHAR(255) NOT NULL UNIQUE, is_enabled TINYINT(1) DEFAULT 1,
    checkout_button_text VARCHAR(255), checkout_footer_text VARCHAR(255), checkout_button_bg_color VARCHAR(20),
    checkout_button_text_color VARCHAR(20), checkout_button_border_radius INT, custom_css TEXT NULL,
    announcement_enabled TINYINT(1), announcement_text TEXT NULL, announcement_bg_color VARCHAR(20), announcement_text_color VARCHAR(20),
    announcement_font_size INT, open_on_add TINYINT(1), open_on_icon_click TINYINT(1), position VARCHAR(10),
    header_title VARCHAR(255), header_close_style VARCHAR(20), header_bg_color VARCHAR(20), header_text_color VARCHAR(20), header_border_bottom TINYINT(1),
    design_width VARCHAR(20), design_border_radius INT, design_shadow TINYINT(1), design_animation VARCHAR(20),
    empty_cart_message VARCHAR(255), empty_cart_show_continue_shopping TINYINT(1), empty_cart_show_recommendations TINYINT(1),
    updated_at DATETIME(3) NULL
  ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query('CREATE TABLE upsell_widget_settings (shop_domain VARCHAR(255) PRIMARY KEY, is_enabled TINYINT(1), manual_rules TEXT NULL)');
  await db.query('INSERT INTO cart_drawer (shop, cartStatus) VALUES (?, 1), (?, 1)', [SHOP, NEW_SHOP]);
  await db.query('INSERT INTO shops (shop_domain, plan_name) VALUES (?, ?), (?, ?)', [SHOP, 'pro', NEW_SHOP, 'pro']);

  const { saveCartDrawerConfig } = await import('../../app/services/cart-config-writes.server.js');

  // A real 2x1 PNG.
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwnwEEGBgAHv4C/qw9qaMAAAAASUVORK5CYII=';
  const PNG = `data:image/png;base64,${PNG_B64}`;
  const storefront = async (shop) => (await fetch(`${harness.baseUrl}/save_cart_drawer.php?shopdomain=${shop}`)).json();
  const local = (src) => src.replace(/^https?:\/\/[^/]+/, harness.baseUrl);

  test('a shop with no banner yet: the storefront GET adds the columns itself and returns no banner', async () => {
    const json = await storefront(NEW_SHOP);
    assert.equal(json.status, 'success');
    assert.equal(json.data.banner_enabled, 0);
    assert.equal(json.data.banner_desktop_src, '');
    assert.equal(json.data.banner_mobile_src, '');
    assert.equal(json.data.banner_placement, 'above_progress', 'default placement');
    const [cols] = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_NAME = 'cart_drawer_config' AND COLUMN_NAME LIKE 'banner_%'");
    assert.equal(cols.length, 7);
    assert.equal(json.data.banner_margin_top, 12, 'default space above');
    assert.equal(json.data.banner_margin_bottom, 12, 'default space below');
  });

  test('save: banner settings stored next to the other drawer settings (Node adds columns if missing)', async () => {
    const row = await saveCartDrawerConfig(SHOP, 'pro', {
      header_title: 'My Cart', banner_enabled: 1, banner_desktop_image: PNG,
      banner_mobile_image: 'https://cdn.shopify.com/s/files/1/m.jpg', banner_placement: 'below_progress', banner_alt: '  Free shipping  ',
    });
    assert.equal(row.header_title, 'My Cart');
    assert.equal(Number(row.banner_enabled), 1);
    assert.equal(row.banner_desktop_image, PNG);
    assert.equal(row.banner_mobile_image, 'https://cdn.shopify.com/s/files/1/m.jpg');
    assert.equal(row.banner_placement, 'below_progress');
    assert.equal(row.banner_alt, 'Free shipping');
  });

  test('save: other saves keep the banner; bad values are refused; empty removes an image', async () => {
    let row = await saveCartDrawerConfig(SHOP, 'pro', { header_title: 'Cart' });
    assert.equal(row.banner_desktop_image, PNG, 'a patch without banner fields keeps them');
    assert.equal(row.banner_placement, 'below_progress');
    row = await saveCartDrawerConfig(SHOP, 'pro', { banner_desktop_image: 'javascript:alert(1)', banner_mobile_image: 'data:image/svg+xml;base64,PHN2Zz4=', banner_placement: 'sideways' });
    assert.equal(row.banner_desktop_image, PNG, 'a bad image is ignored, the stored one stays');
    assert.equal(row.banner_mobile_image, 'https://cdn.shopify.com/s/files/1/m.jpg', 'no SVG');
    assert.equal(row.banner_placement, 'above_progress', 'unknown placement → default');
    row = await saveCartDrawerConfig(SHOP, 'pro', { banner_placement: 'below_progress', banner_mobile_image: '' });
    assert.equal(row.banner_mobile_image, null, 'empty removes the mobile image');
    await saveCartDrawerConfig(SHOP, 'pro', { banner_mobile_image: 'https://cdn.shopify.com/s/files/1/m.jpg' });
  });

  test('storefront GET: image URLs only (never the uploaded data), placement, alt', async () => {
    const { data } = await storefront(SHOP);
    assert.equal(data.banner_enabled, 1);
    assert.equal(data.banner_placement, 'below_progress');
    assert.equal(data.banner_alt, 'Free shipping');
    assert.equal(data.banner_mobile_src, 'https://cdn.shopify.com/s/files/1/m.jpg', 'https links pass through');
    assert.match(data.banner_desktop_src, /\/cart_banner_image\.php\?shop=banner-test\.myshopify\.com&slot=desktop&v=[0-9a-f]{12}$/);
    assert.equal('banner_desktop_image' in data, false, 'raw image data is not sent');
    assert.equal(JSON.stringify(data).includes('base64'), false);
    assert.equal(data.header_title, 'Cart');
  });

  test('cart_banner_image.php: the uploaded image as a real, long-cached file', async () => {
    const { data } = await storefront(SHOP);
    let res = await fetch(local(data.banner_desktop_src));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.match(res.headers.get('cache-control'), /max-age=31536000.*immutable/);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), Buffer.from(PNG_B64, 'base64'));
    res = await fetch(local(data.banner_desktop_src).replace(/v=[0-9a-f]+/, 'v=000000000000'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=300', 'an old version link is only cached briefly');
    res = await fetch(`${harness.baseUrl}/cart_banner_image.php?shop=${SHOP}&slot=mobile&v=x`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://cdn.shopify.com/s/files/1/m.jpg');
    assert.equal((await fetch(`${harness.baseUrl}/cart_banner_image.php?shop=${NEW_SHOP}&slot=desktop`)).status, 404);
    assert.equal((await fetch(`${harness.baseUrl}/cart_banner_image.php?shop=bad%20shop&slot=desktop`)).status, 400);
    assert.equal((await fetch(`${harness.baseUrl}/cart_banner_image.php?shop=${SHOP}&slot=hero`)).status, 400);
  });

  test('a new upload gets a new link (so shoppers never see a cached old banner)', async () => {
    const before = (await storefront(SHOP)).data.banner_desktop_src;
    const OTHER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    await saveCartDrawerConfig(SHOP, 'pro', { banner_desktop_image: OTHER });
    const afterSrc = (await storefront(SHOP)).data.banner_desktop_src;
    assert.notEqual(afterSrc, before);
    const res = await fetch(local(afterSrc));
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), Buffer.from(OTHER.split(',')[1], 'base64'));
  });

  test('space above / below: saved, clamped to 0-40, kept by other saves, sent to the storefront', async () => {
    let row = await saveCartDrawerConfig(SHOP, 'pro', { banner_margin_top: 0, banner_margin_bottom: 6 });
    assert.equal(Number(row.banner_margin_top), 0, '0 is a real value, not "missing"');
    assert.equal(Number(row.banner_margin_bottom), 6);
    row = await saveCartDrawerConfig(SHOP, 'pro', { header_title: 'Cart' });
    assert.equal(Number(row.banner_margin_bottom), 6, 'a patch without spacing keeps it');
    row = await saveCartDrawerConfig(SHOP, 'pro', { banner_margin_top: 99, banner_margin_bottom: -5 });
    assert.equal(Number(row.banner_margin_top), 40);
    assert.equal(Number(row.banner_margin_bottom), 0);
    row = await saveCartDrawerConfig(SHOP, 'pro', { banner_margin_top: 'abc', banner_margin_bottom: 8 });
    assert.equal(Number(row.banner_margin_top), 40, 'junk keeps the stored value');
    const { data } = await storefront(SHOP);
    assert.equal(data.banner_margin_top, 40);
    assert.equal(data.banner_margin_bottom, 8);
  });

  test('banner turned off: the storefront gets banner_enabled 0', async () => {
    await saveCartDrawerConfig(SHOP, 'pro', { banner_enabled: 0 });
    assert.equal((await storefront(SHOP)).data.banner_enabled, 0);
  });
}
