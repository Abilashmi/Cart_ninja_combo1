/* eslint-env node */
// Cart drawer customization fixes end to end, against the real PHP backend on
// a throwaway MariaDB (tests/cod/php-harness.mjs; never the shared database):
//   rotating announcements  → cart_drawer_config → save_cart_drawer.php GET
//   upsell colours          → upsell_widget_settings
//   free gift variant/badge → progress_bar_tiers (kept when the AI rewrites tiers)
// Every table starts without the new columns, so the self-healing ALTERs run.
// Run with: node --import ./tests/packs/register.mjs --test tests/cart-drawer/customization-php.test.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { harnessAvailable, startHarness } from '../cod/php-harness.mjs';

if (!harnessAvailable()) {
  test('customization PHP tests need XAMPP (MariaDB + PHP)', { skip: true }, () => {});
} else {
  // Own ports: banner-php.test.mjs in this folder runs at the same time.
  const harness = await startHarness({ extraFiles: ['save_cart_drawer.php', 'cart_banner_image.php', 'db_proxy.php', 'shop_integrations.php'], portOffset: 20 });
  process.env.PHP_BASE_URL = harness.baseUrl;
  process.env.SHOPIFY_API_KEY = harness.secret;
  after(() => harness.stop());

  const { db } = harness;
  const SHOP = 'custom-test.myshopify.com';
  await db.query(`CREATE TABLE cart_drawer (
    id INT AUTO_INCREMENT PRIMARY KEY, shop VARCHAR(255) NOT NULL UNIQUE, cartStatus TINYINT(1) DEFAULT 1,
    progress_status TINYINT(1) DEFAULT 0, progress_data TEXT NULL, upsell_status TINYINT(1) DEFAULT 0, upsell_data TEXT NULL,
    coupon_status TINYINT(1) DEFAULT 0, coupon_data TEXT NULL, checkout_button_style TEXT NULL, custom_css TEXT NULL
  ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE cart_drawer_config (
    id INT AUTO_INCREMENT PRIMARY KEY, shop_domain VARCHAR(255) NOT NULL UNIQUE, is_enabled TINYINT(1) DEFAULT 1,
    checkout_button_text VARCHAR(255), checkout_footer_text VARCHAR(255), checkout_button_bg_color VARCHAR(20),
    checkout_button_text_color VARCHAR(20), checkout_button_border_radius INT, custom_css TEXT NULL,
    announcement_enabled TINYINT(1), announcement_text VARCHAR(500) NULL, announcement_bg_color VARCHAR(20), announcement_text_color VARCHAR(20),
    announcement_font_size INT, open_on_add TINYINT(1), open_on_icon_click TINYINT(1), position VARCHAR(10),
    header_title VARCHAR(255), header_close_style VARCHAR(20), header_bg_color VARCHAR(20), header_text_color VARCHAR(20), header_border_bottom TINYINT(1),
    design_width VARCHAR(20), design_border_radius INT, design_shadow TINYINT(1), design_animation VARCHAR(20),
    empty_cart_message VARCHAR(255), empty_cart_show_continue_shopping TINYINT(1), empty_cart_show_recommendations TINYINT(1),
    updated_at DATETIME(3) NULL
  ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE upsell_widget_settings (
    id INT AUTO_INCREMENT PRIMARY KEY, shop_domain VARCHAR(255) NOT NULL UNIQUE, is_enabled TINYINT(1) DEFAULT 0,
    title VARCHAR(255), title_color VARCHAR(20), title_font_weight INT, show_on_empty_cart TINYINT(1),
    layout VARCHAR(20), button_text VARCHAR(100), button_bg_color VARCHAR(20), button_text_color VARCHAR(20),
    button_border_radius INT, show_price TINYINT(1), position VARCHAR(20), display_limit INT,
    active_template VARCHAR(50), manual_rules TEXT NULL, updated_at DATETIME(3) NULL
  ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE progress_bar_settings (
    id INT AUTO_INCREMENT PRIMARY KEY, shop_domain VARCHAR(255) NOT NULL UNIQUE, is_enabled TINYINT(1) DEFAULT 0,
    mode VARCHAR(20), show_on_empty TINYINT(1), bar_background_color VARCHAR(20), bar_foreground_color VARCHAR(20),
    icon_color VARCHAR(20), border_radius INT, placement VARCHAR(20), completion_text VARCHAR(255),
    completion_text_color VARCHAR(20), enable_confetti TINYINT(1), updated_at DATETIME(3) NULL
  ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE progress_bar_tiers (
    id INT AUTO_INCREMENT PRIMARY KEY, shop_domain VARCHAR(255), settings_id INT, min_value DECIMAL(10,2), min_quantity INT,
    description VARCHAR(255), reward_type VARCHAR(30), icon_type VARCHAR(20), icon_preset VARCHAR(30), icon_custom_svg TEXT NULL,
    reward_products TEXT NULL, is_active TINYINT(1) DEFAULT 1, sort_order INT, updated_at DATETIME(3) NULL
  ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query('INSERT INTO cart_drawer (shop, cartStatus) VALUES (?, 1)', [SHOP]);
  await db.query('INSERT INTO shops (shop_domain, plan_name) VALUES (?, ?)', [SHOP, 'pro']);

  const { saveCartDrawerConfig, saveUpsellWidgetSettings, saveProgressBarSettings } = await import('../../app/services/cart-config-writes.server.js');
  const storefront = async () => (await fetch(`${harness.baseUrl}/save_cart_drawer.php?shopdomain=${SHOP}`)).json();

  test('a bar saved before rotation: the storefront GET adds the columns and keeps one message', async () => {
    await db.query("INSERT INTO cart_drawer_config (shop_domain, announcement_enabled, announcement_text) VALUES (?, 1, 'Old single text')", [SHOP]);
    const json = await storefront();
    assert.equal(json.status, 'success');
    assert.equal(json.data.announcement_text, 'Old single text');
    assert.equal(json.data.announcement_messages, null, 'no list yet: the drawer falls back to the text');
    assert.equal(Number(json.data.announcement_auto_rotate), 1);
    assert.equal(Number(json.data.announcement_interval), 4);
    assert.equal(Number(json.data.announcement_show_arrows), 1);
  });

  test('several messages: saved, first one mirrored into announcement_text, sent to the storefront', async () => {
    const row = await saveCartDrawerConfig(SHOP, 'pro', {
      announcement_messages: ['Free shipping over ₹999', '  ', 'Sale ends Sunday'],
      announcement_auto_rotate: 0, announcement_interval: 30, announcement_show_arrows: 1,
    });
    assert.deepEqual(JSON.parse(row.announcement_messages), ['Free shipping over ₹999', 'Sale ends Sunday']);
    assert.equal(row.announcement_text, 'Free shipping over ₹999');
    assert.equal(Number(row.announcement_auto_rotate), 0);
    assert.equal(Number(row.announcement_interval), 15, 'interval clamped to 2-15 s');
    const json = await storefront();
    assert.deepEqual(JSON.parse(json.data.announcement_messages), ['Free shipping over ₹999', 'Sale ends Sunday']);
  });

  test('the AI setting only the text changes the first message and keeps the rest', async () => {
    const row = await saveCartDrawerConfig(SHOP, 'pro', { announcement_text: 'Diwali sale is live' });
    assert.deepEqual(JSON.parse(row.announcement_messages), ['Diwali sale is live', 'Sale ends Sunday']);
    assert.equal(row.announcement_text, 'Diwali sale is live');
    assert.equal(Number(row.announcement_auto_rotate), 0, 'untouched fields keep their value');
  });

  test('upsell colours: new columns self-heal; the button follows checkout unless turned off', async () => {
    let row = await saveUpsellWidgetSettings(SHOP, 'pro', { title: 'You may like' });
    assert.equal(Number(row.button_follow_checkout), 1);
    assert.equal(row.price_color, null);
    row = await saveUpsellWidgetSettings(SHOP, 'pro', { button_follow_checkout: 0, button_bg_color: '#ff5733', button_text_color: '#000000', product_title_color: '#333333', price_color: '#008060' });
    assert.equal(Number(row.button_follow_checkout), 0);
    assert.equal(row.button_bg_color, '#ff5733');
    assert.equal(row.price_color, '#008060');
    row = await saveUpsellWidgetSettings(SHOP, 'pro', { title: 'Picked for you' });
    assert.equal(row.product_title_color, '#333333', 'a patch without the colour keeps it');
  });

  test('free gift: chosen variant and badge text saved per tier, cleaned, and kept when tiers are rewritten without them', async () => {
    const P1 = 'gid://shopify/Product/1';
    const P2 = 'gid://shopify/Product/2';
    let pb = await saveProgressBarSettings(SHOP, 'pro', {
      is_enabled: 1,
      tiers: [{
        min_value: 500, description: 'Gift', reward_type: 'product', products: [P1],
        reward_pricing: 'free',
        reward_variants: { [P1]: 'gid://shopify/ProductVariant/11', [P2]: 'gid://shopify/ProductVariant/22', junk: 'x' },
        reward_badge_label: '  Birthday <b>gift</b>  ',
      }],
    });
    assert.deepEqual(pb.tiers[0].reward_variants, { [P1]: 'gid://shopify/ProductVariant/11' }, 'only the tier\'s own products, only variant ids');
    assert.equal(pb.tiers[0].reward_badge_label, 'Birthday bgift/b');
    // The AI's tier tools send whole tiers without these fields.
    pb = await saveProgressBarSettings(SHOP, 'pro', { tiers: [{ min_value: 600, description: 'Gift', reward_type: 'product', products: [P1], reward_pricing: 'free' }] });
    assert.deepEqual(pb.tiers[0].reward_variants, { [P1]: 'gid://shopify/ProductVariant/11' });
    assert.equal(pb.tiers[0].reward_badge_label, 'Birthday bgift/b');
    // The editor clearing them does clear them.
    pb = await saveProgressBarSettings(SHOP, 'pro', { tiers: [{ min_value: 600, products: [P1], reward_variants: {}, reward_badge_label: '' }] });
    assert.deepEqual(pb.tiers[0].reward_variants, {});
    assert.equal(pb.tiers[0].reward_badge_label, null);
  });
}
