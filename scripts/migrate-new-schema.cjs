/**
 * Full schema redesign migration.
 * Creates 9 new normalized tables to replace JSON-blob anti-patterns.
 * Safe to re-run — uses CREATE TABLE IF NOT EXISTS.
 * Run: node scripts/migrate-new-schema.cjs
 */
const mysql = require('mysql2/promise');

async function run() {
  const conn = await mysql.createConnection({
    host: '127.0.0.1', user: 'root', password: '', database: 'cart_drawer_ninja',
    multipleStatements: false,
  });

  const tables = [

    // ── 1. Cart Drawer Config ───────────────────────────────────────────────
    // Replaces cart_drawer JSON blobs with clean individual columns.
    {
      name: 'cart_drawer_config',
      ddl: `CREATE TABLE IF NOT EXISTS \`cart_drawer_config\` (
        \`id\`                          INT           NOT NULL AUTO_INCREMENT,
        \`shop_domain\`                 VARCHAR(255)  NOT NULL,
        \`is_enabled\`                  TINYINT(1)    NOT NULL DEFAULT 1,
        \`checkout_button_text\`        VARCHAR(255)  NOT NULL DEFAULT 'Checkout Now',
        \`checkout_footer_text\`        VARCHAR(500)  NOT NULL DEFAULT 'Shipping and taxes calculated at checkout',
        \`checkout_button_bg_color\`    VARCHAR(20)   NOT NULL DEFAULT '#111827',
        \`checkout_button_text_color\`  VARCHAR(20)   NOT NULL DEFAULT '#ffffff',
        \`checkout_button_border_radius\` INT         NOT NULL DEFAULT 4,
        \`custom_css\`                  LONGTEXT,
        \`announcement_enabled\`        TINYINT(1)    NOT NULL DEFAULT 0,
        \`announcement_text\`           VARCHAR(500),
        \`announcement_bg_color\`       VARCHAR(20)   NOT NULL DEFAULT '#111827',
        \`announcement_text_color\`     VARCHAR(20)   NOT NULL DEFAULT '#ffffff',
        \`announcement_font_size\`      INT           NOT NULL DEFAULT 13,
        \`created_at\`                  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\`                  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_shop\` (\`shop_domain\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },

    // ── 2. Progress Bar Settings ────────────────────────────────────────────
    // Replaces cart_drawer.progress_data JSON blob.
    {
      name: 'progress_bar_settings',
      ddl: `CREATE TABLE IF NOT EXISTS \`progress_bar_settings\` (
        \`id\`                   INT          NOT NULL AUTO_INCREMENT,
        \`shop_domain\`          VARCHAR(255) NOT NULL,
        \`is_enabled\`           TINYINT(1)   NOT NULL DEFAULT 0,
        \`mode\`                 ENUM('amount','quantity') NOT NULL DEFAULT 'amount',
        \`show_on_empty\`        TINYINT(1)   NOT NULL DEFAULT 1,
        \`bar_background_color\` VARCHAR(20)  NOT NULL DEFAULT '#e5e7eb',
        \`bar_foreground_color\` VARCHAR(20)  NOT NULL DEFAULT '#2563eb',
        \`icon_color\`           VARCHAR(20)  NOT NULL DEFAULT '#2563eb',
        \`border_radius\`        INT          NOT NULL DEFAULT 8,
        \`placement\`            ENUM('top','bottom') NOT NULL DEFAULT 'top',
        \`completion_text\`      VARCHAR(255) NOT NULL DEFAULT '🎉 You''ve unlocked free shipping!',
        \`completion_text_color\` VARCHAR(20) NOT NULL DEFAULT '#10b981',
        \`enable_confetti\`      TINYINT(1)   NOT NULL DEFAULT 1,
        \`created_at\`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_shop\` (\`shop_domain\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },

    // ── 3. Progress Bar Tiers ───────────────────────────────────────────────
    {
      name: 'progress_bar_tiers',
      ddl: `CREATE TABLE IF NOT EXISTS \`progress_bar_tiers\` (
        \`id\`               INT           NOT NULL AUTO_INCREMENT,
        \`shop_domain\`      VARCHAR(255)  NOT NULL,
        \`settings_id\`      INT           NOT NULL,
        \`min_value\`        DECIMAL(12,2) NOT NULL DEFAULT 0,
        \`min_quantity\`     INT           NOT NULL DEFAULT 0,
        \`description\`      VARCHAR(255),
        \`reward_type\`      ENUM('free_shipping','product','discount','gift') NOT NULL DEFAULT 'free_shipping',
        \`icon_type\`        ENUM('preset','custom') NOT NULL DEFAULT 'preset',
        \`icon_preset\`      VARCHAR(50)   NOT NULL DEFAULT 'gift',
        \`icon_custom_svg\`  TEXT,
        \`reward_products\`  JSON,
        \`is_active\`        TINYINT(1)    NOT NULL DEFAULT 1,
        \`sort_order\`       INT           NOT NULL DEFAULT 0,
        \`created_at\`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_shop\` (\`shop_domain\`),
        INDEX \`idx_settings\` (\`settings_id\`),
        CONSTRAINT \`fk_pbt_settings\` FOREIGN KEY (\`settings_id\`)
          REFERENCES \`progress_bar_settings\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },

    // ── 4. Coupon Slider Settings ───────────────────────────────────────────
    // Replaces coupon_slider_widget (12 JSON columns → clean typed columns).
    {
      name: 'coupon_slider_settings',
      ddl: `CREATE TABLE IF NOT EXISTS \`coupon_slider_settings\` (
        \`id\`                  INT          NOT NULL AUTO_INCREMENT,
        \`shop_domain\`         VARCHAR(255) NOT NULL,
        \`is_enabled\`          TINYINT(1)   NOT NULL DEFAULT 0,
        \`selected_template\`   VARCHAR(50)  NOT NULL DEFAULT 'template1',
        \`title_text\`          VARCHAR(255) NOT NULL DEFAULT 'Apply Coupon',
        \`title_color\`         VARCHAR(20)  NOT NULL DEFAULT '#1e293b',
        \`title_font_size\`     INT          NOT NULL DEFAULT 14,
        \`title_font_weight\`   INT          NOT NULL DEFAULT 700,
        \`title_alignment\`     ENUM('left','center','right') NOT NULL DEFAULT 'left',
        \`section_bg_color\`    VARCHAR(20)  NOT NULL DEFAULT '#ffffff',
        \`card_bg_color\`       VARCHAR(20)  NOT NULL DEFAULT '#ffffff',
        \`card_border_color\`   VARCHAR(20)  NOT NULL DEFAULT '#e5e7eb',
        \`card_border_width\`   INT          NOT NULL DEFAULT 1,
        \`card_border_radius\`  INT          NOT NULL DEFAULT 8,
        \`card_shadow\`         TINYINT(1)   NOT NULL DEFAULT 0,
        \`auto_slide\`          TINYINT(1)   NOT NULL DEFAULT 0,
        \`slide_interval\`      INT          NOT NULL DEFAULT 5,
        \`position\`            ENUM('top','bottom') NOT NULL DEFAULT 'top',
        \`layout\`              ENUM('grid','carousel','list') NOT NULL DEFAULT 'grid',
        \`created_at\`          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\`          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_shop\` (\`shop_domain\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },

    // ── 5. Coupon Display Rules ─────────────────────────────────────────────
    // Each coupon's display appearance + conditions. Replaces opaque JSON
    // blobs in selectedTemplateCoupon / temp*CouponStyle / temp*CouponCondition.
    {
      name: 'coupon_display_rules',
      ddl: `CREATE TABLE IF NOT EXISTS \`coupon_display_rules\` (
        \`id\`                    INT          NOT NULL AUTO_INCREMENT,
        \`shop_domain\`           VARCHAR(255) NOT NULL,
        \`coupon_code\`           VARCHAR(100) NOT NULL,
        \`name\`                  VARCHAR(255),
        \`heading_text\`          VARCHAR(255),
        \`subtext_text\`          TEXT,
        \`bg_color\`              VARCHAR(20)  NOT NULL DEFAULT '#ffffff',
        \`text_color\`            VARCHAR(20)  NOT NULL DEFAULT '#111827',
        \`button_text\`           VARCHAR(100) NOT NULL DEFAULT 'Apply',
        \`button_bg_color\`       VARCHAR(20)  NOT NULL DEFAULT '#111827',
        \`button_text_color\`     VARCHAR(20)  NOT NULL DEFAULT '#ffffff',
        \`button_border_radius\`  INT          NOT NULL DEFAULT 6,
        \`show_button\`           TINYINT(1)   NOT NULL DEFAULT 1,
        \`icon_url\`              VARCHAR(500),
        \`icon_bg_color\`         VARCHAR(20),
        \`icon_size\`             INT          NOT NULL DEFAULT 32,
        \`icon_border_radius\`    INT          NOT NULL DEFAULT 8,
        \`icon_alignment\`        ENUM('left','top','right') NOT NULL DEFAULT 'left',
        \`condition_type\`        ENUM('all','specific_products','specific_collections') NOT NULL DEFAULT 'all',
        \`selected_products\`     JSON,
        \`selected_collections\`  JSON,
        \`display_tags\`          JSON,
        \`is_active\`             TINYINT(1)   NOT NULL DEFAULT 1,
        \`sort_order\`            INT          NOT NULL DEFAULT 0,
        \`created_at\`            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\`            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_shop\`  (\`shop_domain\`),
        INDEX \`idx_code\`  (\`coupon_code\`),
        INDEX \`idx_active\` (\`is_active\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },

    // ── 6. Upsell Widget Settings ───────────────────────────────────────────
    // Global display settings for the upsell widget (layout, colors, title).
    // The individual rules stay in upsell_rules.
    {
      name: 'upsell_widget_settings',
      ddl: `CREATE TABLE IF NOT EXISTS \`upsell_widget_settings\` (
        \`id\`                    INT          NOT NULL AUTO_INCREMENT,
        \`shop_domain\`           VARCHAR(255) NOT NULL,
        \`is_enabled\`            TINYINT(1)   NOT NULL DEFAULT 0,
        \`title\`                 VARCHAR(255) NOT NULL DEFAULT 'Recommended for you',
        \`title_color\`           VARCHAR(20)  NOT NULL DEFAULT '#111827',
        \`title_font_weight\`     VARCHAR(10)  NOT NULL DEFAULT '700',
        \`show_on_empty_cart\`    TINYINT(1)   NOT NULL DEFAULT 0,
        \`layout\`                ENUM('grid','carousel','vertical') NOT NULL DEFAULT 'grid',
        \`button_text\`           VARCHAR(100) NOT NULL DEFAULT 'Add to Cart',
        \`button_bg_color\`       VARCHAR(20)  NOT NULL DEFAULT '#111827',
        \`button_text_color\`     VARCHAR(20)  NOT NULL DEFAULT '#ffffff',
        \`button_border_radius\`  INT          NOT NULL DEFAULT 6,
        \`show_price\`            TINYINT(1)   NOT NULL DEFAULT 1,
        \`position\`              ENUM('top','bottom') NOT NULL DEFAULT 'bottom',
        \`display_limit\`         INT          NOT NULL DEFAULT 3,
        \`active_template\`       VARCHAR(50)  NOT NULL DEFAULT 'grid',
        \`created_at\`            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\`            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_shop\` (\`shop_domain\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },

    // ── 7. FBT Widget Settings ──────────────────────────────────────────────
    // Global FBT display settings. Replaces fbt_widget JSON template blobs.
    {
      name: 'fbt_widget_settings',
      ddl: `CREATE TABLE IF NOT EXISTS \`fbt_widget_settings\` (
        \`id\`                      INT          NOT NULL AUTO_INCREMENT,
        \`shop_domain\`             VARCHAR(255) NOT NULL,
        \`is_enabled\`              TINYINT(1)   NOT NULL DEFAULT 0,
        \`selected_template\`       ENUM('fbt1','fbt2','fbt3') NOT NULL DEFAULT 'fbt1',
        \`mode\`                    ENUM('manual','ai') NOT NULL DEFAULT 'manual',
        \`ai_product_count\`        INT          NOT NULL DEFAULT 3,
        \`bg_color\`                VARCHAR(20)  NOT NULL DEFAULT '#ffffff',
        \`text_color\`              VARCHAR(20)  NOT NULL DEFAULT '#111827',
        \`price_color\`             VARCHAR(20)  NOT NULL DEFAULT '#059669',
        \`button_color\`            VARCHAR(20)  NOT NULL DEFAULT '#111827',
        \`button_text_color\`       VARCHAR(20)  NOT NULL DEFAULT '#ffffff',
        \`button_text\`             VARCHAR(100) NOT NULL DEFAULT 'Add All to Cart',
        \`border_color\`            VARCHAR(20)  NOT NULL DEFAULT '#e5e7eb',
        \`border_radius\`           INT          NOT NULL DEFAULT 8,
        \`layout\`                  ENUM('horizontal','vertical') NOT NULL DEFAULT 'horizontal',
        \`interaction_type\`        ENUM('classic','quick-add','bundle') NOT NULL DEFAULT 'classic',
        \`show_prices\`             TINYINT(1)   NOT NULL DEFAULT 1,
        \`show_add_all_button\`     TINYINT(1)   NOT NULL DEFAULT 1,
        \`created_at\`              DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\`              DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_shop\` (\`shop_domain\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },

    // ── 8. FBT Rules ────────────────────────────────────────────────────────
    // Individual FBT manual rules. Replaces condition JSON in fbt_widget.
    {
      name: 'fbt_rules',
      ddl: `CREATE TABLE IF NOT EXISTS \`fbt_rules\` (
        \`id\`                   INT          NOT NULL AUTO_INCREMENT,
        \`shop_domain\`          VARCHAR(255) NOT NULL,
        \`name\`                 VARCHAR(255) NOT NULL DEFAULT 'Rule',
        \`trigger_scope\`        ENUM('all','specific_products','specific_collections') NOT NULL DEFAULT 'all',
        \`trigger_products\`     JSON,
        \`trigger_collections\`  JSON,
        \`fbt_products\`         JSON,
        \`discount_type\`        ENUM('none','percentage','fixed') NOT NULL DEFAULT 'none',
        \`discount_value\`       DECIMAL(10,2) NOT NULL DEFAULT 0,
        \`is_active\`            TINYINT(1)   NOT NULL DEFAULT 1,
        \`sort_order\`           INT          NOT NULL DEFAULT 0,
        \`created_at\`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_shop\`   (\`shop_domain\`),
        INDEX \`idx_active\` (\`is_active\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },

    // ── 9. AI Applied Configs ───────────────────────────────────────────────
    // Persists every AI-generated and applied configuration change.
    {
      name: 'ai_applied_configs',
      ddl: `CREATE TABLE IF NOT EXISTS \`ai_applied_configs\` (
        \`id\`               VARCHAR(36)  NOT NULL,
        \`shop_domain\`      VARCHAR(255) NOT NULL,
        \`config_type\`      ENUM('cart_drawer','upsell','fbt','progress_bar','coupon_slider','styling','announcement','full') NOT NULL DEFAULT 'full',
        \`actions_applied\`  JSON         NOT NULL,
        \`settings_applied\` JSON,
        \`prompt\`           TEXT,
        \`conversation_id\`  VARCHAR(36),
        \`ai_summary\`       TEXT,
        \`before_state\`     JSON,
        \`after_state\`      JSON,
        \`is_active\`        TINYINT(1)   NOT NULL DEFAULT 1,
        \`applied_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`created_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updated_at\`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`id\`),
        INDEX \`idx_shop\`       (\`shop_domain\`),
        INDEX \`idx_type\`       (\`config_type\`),
        INDEX \`idx_applied_at\` (\`applied_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
  ];

  // Create tables
  for (const t of tables) {
    await conn.execute(t.ddl);
    console.log('✅ Table ready:', t.name);
  }

  // ── Migrate existing data into new tables ─────────────────────────────────
  console.log('\n── Migrating existing data ──');

  // 1. cart_drawer → cart_drawer_config
  const [cdRows] = await conn.query('SELECT * FROM cart_drawer');
  let migratedCd = 0;
  for (const r of cdRows) {
    let cbStyle = {};
    try { cbStyle = typeof r.checkout_button_style === 'string' ? JSON.parse(r.checkout_button_style) : (r.checkout_button_style || {}); } catch {}
    await conn.execute(`
      INSERT IGNORE INTO cart_drawer_config
        (shop_domain, is_enabled, checkout_button_text, checkout_footer_text,
         checkout_button_bg_color, checkout_button_text_color, checkout_button_border_radius,
         custom_css, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      r.shop,
      r.cartStatus ?? 1,
      r.checkoutName || 'Checkout Now',
      r.checkoutFooterText || 'Shipping and taxes calculated at checkout',
      cbStyle.backgroundColor || '#111827',
      cbStyle.textColor || '#ffffff',
      cbStyle.borderRadius ?? 4,
      r.customCSS || null,
      r.created_at || new Date().toISOString().slice(0,19).replace('T',' '),
      r.updated_at || new Date().toISOString().slice(0,19).replace('T',' '),
    ]);
    migratedCd++;
  }
  console.log(`✅ Migrated ${migratedCd} rows → cart_drawer_config`);

  // 2. cart_drawer.progress_data → progress_bar_settings + progress_bar_tiers
  let migratedPb = 0;
  for (const r of cdRows) {
    if (!r.progress_data) continue;
    let pb = {};
    try { pb = typeof r.progress_data === 'string' ? JSON.parse(r.progress_data) : r.progress_data; } catch { continue; }
    const [ins] = await conn.execute(`
      INSERT IGNORE INTO progress_bar_settings
        (shop_domain, is_enabled, mode, show_on_empty, bar_background_color, bar_foreground_color,
         icon_color, border_radius, placement, completion_text, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      r.shop,
      r.progress_status ?? 0,
      pb.mode || 'amount',
      pb.showOnEmpty ?? pb.showWhenEmpty ?? 1,
      pb.barBackgroundColor || pb.track_color || '#e5e7eb',
      pb.barForegroundColor || pb.fill_color || '#2563eb',
      pb.iconColor || pb.icon_color || '#2563eb',
      pb.borderRadius ?? 8,
      pb.placement || 'top',
      pb.completionText || pb.completionMessage || '🎉 You\'ve unlocked free shipping!',
      r.created_at || new Date().toISOString().slice(0,19).replace('T',' '),
      r.progress_updated_at || r.updated_at || new Date().toISOString().slice(0,19).replace('T',' '),
    ]);
    const settingsId = ins.insertId;
    if (!settingsId) continue;
    migratedPb++;
    // Migrate tiers
    const tiers = pb.tiers || [];
    for (let i = 0; i < tiers.length; i++) {
      const tier = tiers[i];
      await conn.execute(`
        INSERT INTO progress_bar_tiers
          (shop_domain, settings_id, min_value, min_quantity, description, reward_type,
           icon_type, icon_preset, reward_products, is_active, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `, [
        r.shop, settingsId,
        tier.minValue ?? 0, tier.minQuantity ?? 0,
        tier.description || 'Milestone',
        tier.rewardType || 'free_shipping',
        tier.iconType || 'preset',
        tier.iconPreset || 'gift',
        tier.products?.length ? JSON.stringify(tier.products) : null,
        i,
      ]);
    }
  }
  console.log(`✅ Migrated ${migratedPb} shops → progress_bar_settings + tiers`);

  // 3. coupon_slider_widget → coupon_slider_settings
  const [csRows] = await conn.query('SELECT * FROM coupon_slider_widget');
  let migratedCs = 0;
  for (const r of csRows) {
    let style = {};
    try { style = typeof r.temp1DefaultStyle === 'string' ? JSON.parse(r.temp1DefaultStyle) : (r.temp1DefaultStyle || {}); } catch {}
    await conn.execute(`
      INSERT IGNORE INTO coupon_slider_settings
        (shop_domain, is_enabled, selected_template, title_text, title_color, title_font_size, created_at, updated_at)
      VALUES (?, 0, ?, ?, ?, ?, ?, ?)
    `, [
      r.shopDomain,
      r.selectedTemplate || 'template1',
      style?.title?.text || 'Apply Coupon',
      style?.title?.textColor || '#1e293b',
      style?.title?.fontSize || 14,
      r.created_at || new Date().toISOString().slice(0,19).replace('T',' '),
      r.updated_at || new Date().toISOString().slice(0,19).replace('T',' '),
    ]);
    migratedCs++;
  }
  console.log(`✅ Migrated ${migratedCs} rows → coupon_slider_settings`);

  // 4. fbt_widget → fbt_widget_settings + fbt_rules
  const [fbtRows] = await conn.query('SELECT * FROM fbt_widget');
  let migratedFbt = 0;
  for (const r of fbtRows) {
    let tpl = {};
    try { tpl = typeof r.temp1 === 'string' ? JSON.parse(r.temp1) : (r.temp1 || {}); } catch {}
    await conn.execute(`
      INSERT IGNORE INTO fbt_widget_settings
        (shop_domain, is_enabled, selected_template, mode, ai_product_count,
         bg_color, text_color, price_color, button_color, button_text_color,
         border_color, border_radius, layout, interaction_type, show_prices, show_add_all_button,
         created_at, updated_at)
      VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      r.shopDomain,
      r.selectedTemp || 'fbt1',
      r.selectedMode || 'manual',
      r.ai_product_count || 3,
      tpl.bgColor || '#ffffff',
      tpl.textColor || '#111827',
      tpl.priceColor || '#059669',
      tpl.buttonColor || '#111827',
      tpl.buttonTextColor || '#ffffff',
      tpl.borderColor || '#e5e7eb',
      tpl.borderRadius ?? 8,
      tpl.layout || 'horizontal',
      tpl.interactionType || 'classic',
      tpl.showPrices !== false ? 1 : 0,
      tpl.showAddAllButton !== false ? 1 : 0,
      r.created_at || new Date().toISOString().slice(0,19).replace('T',' '),
      r.updated_at || new Date().toISOString().slice(0,19).replace('T',' '),
    ]);
    migratedFbt++;
    // Migrate manual rules
    let rules = [];
    try { rules = typeof r.condition === 'string' ? JSON.parse(r.condition) : (r.condition || []); } catch {}
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      await conn.execute(`
        INSERT INTO fbt_rules (shop_domain, name, trigger_scope, trigger_products, fbt_products, is_active, sort_order)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `, [
        r.shopDomain,
        rule.name || `Rule ${i+1}`,
        rule.displayScope || 'all',
        rule.triggerProducts?.length ? JSON.stringify(rule.triggerProducts) : null,
        rule.fbtProducts?.length ? JSON.stringify(rule.fbtProducts) : null,
        i,
      ]);
    }
  }
  console.log(`✅ Migrated ${migratedFbt} shops → fbt_widget_settings + rules`);

  // 5. upsell from cart_drawer.upsell_data → upsell_widget_settings
  let migratedUpsell = 0;
  for (const r of cdRows) {
    if (!r.upsell_data) continue;
    let up = {};
    try { up = typeof r.upsell_data === 'string' ? JSON.parse(r.upsell_data) : r.upsell_data; } catch { continue; }
    await conn.execute(`
      INSERT IGNORE INTO upsell_widget_settings
        (shop_domain, is_enabled, title, title_color, show_on_empty_cart,
         layout, button_text, button_bg_color, button_text_color,
         show_price, position, display_limit, active_template, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      r.shop,
      r.upsell_status ?? 0,
      up.title || 'Recommended for you',
      up.titleColor || '#111827',
      up.showOnEmptyCart ?? up.showWhenEmpty ?? 0,
      up.layout || 'grid',
      up.buttonText || 'Add to Cart',
      up.buttonColor || '#111827',
      up.buttonTextColor || '#ffffff',
      up.showPrice !== false ? 1 : 0,
      up.position || 'bottom',
      up.limit || 3,
      up.activeTemplate || up.template || 'grid',
      r.created_at || new Date().toISOString().slice(0,19).replace('T',' '),
      r.upsell_updated_at || r.updated_at || new Date().toISOString().slice(0,19).replace('T',' '),
    ]);
    migratedUpsell++;
  }
  console.log(`✅ Migrated ${migratedUpsell} shops → upsell_widget_settings`);

  // ── Register migration ────────────────────────────────────────────────────
  await conn.execute(
    `INSERT IGNORE INTO \`_prisma_migrations\`
       (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
     VALUES (UUID(), 'manual', NOW(3), ?, NULL, NULL, NOW(3), 1)`,
    ['20260618000005_new_normalized_schema']
  );

  // ── Final verification ───────────────────────────────────────────────────
  console.log('\n=== New Table Row Counts ===');
  for (const t of ['cart_drawer_config','progress_bar_settings','progress_bar_tiers','coupon_slider_settings','coupon_display_rules','upsell_widget_settings','fbt_widget_settings','fbt_rules','ai_applied_configs']) {
    const [r] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    console.log(` ${t.padEnd(30)} ${r[0].n} rows`);
  }

  await conn.end();
  console.log('\n✅ Schema migration complete.');
}

run().catch(err => { console.error('FATAL:', err.message, err.stack); process.exit(1); });
