<?php
require_once __DIR__ . '/config.php';

$tables = [];

try {
  // 1. shops — already exists, ensure it has required fields
  $pdo->exec("
    CREATE TABLE IF NOT EXISTS shops (
      id INT AUTO_INCREMENT PRIMARY KEY,
      shop_domain VARCHAR(255) NOT NULL UNIQUE,
      access_token TEXT,
      is_active TINYINT(1) DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ");
  $tables[] = 'shops (exists)';

  // 2. combo_templates
  $pdo->exec("
    CREATE TABLE IF NOT EXISTS combo_templates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      shop_domain VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(255),
      template_type ENUM('grid','carousel','premium') NOT NULL DEFAULT 'grid',
      status ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
      is_active TINYINT(1) DEFAULT 1,
      version INT DEFAULT 1,
      thumbnail_url VARCHAR(500),
      description TEXT,
      features JSON,
      created_by VARCHAR(255),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_shop (shop_domain),
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ");
  $tables[] = 'combo_templates';

  // 3. template_pages
  $pdo->exec("
    CREATE TABLE IF NOT EXISTS template_pages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      template_id INT NOT NULL,
      shop_domain VARCHAR(255) NOT NULL,
      page_id VARCHAR(100),
      page_handle VARCHAR(255),
      page_title VARCHAR(255),
      preview_url VARCHAR(500),
      published_url VARCHAR(500),
      admin_url VARCHAR(500),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (template_id) REFERENCES combo_templates(id) ON DELETE CASCADE,
      INDEX idx_template (template_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ");
  $tables[] = 'template_pages';

  // 4. template_collections
  $pdo->exec("
    CREATE TABLE IF NOT EXISTS template_collections (
      id INT AUTO_INCREMENT PRIMARY KEY,
      template_id INT NOT NULL,
      shop_domain VARCHAR(255) NOT NULL,
      collection_id VARCHAR(100) NOT NULL,
      collection_title VARCHAR(255),
      handle VARCHAR(255),
      products_per_row INT DEFAULT 3,
      max_products INT DEFAULT 12,
      display_mode ENUM('grid','carousel') DEFAULT 'grid',
      slider_speed INT DEFAULT 3000,
      infinite_loop TINYINT(1) DEFAULT 0,
      autoplay TINYINT(1) DEFAULT 1,
      show_arrows TINYINT(1) DEFAULT 1,
      show_dots TINYINT(1) DEFAULT 1,
      sort_order VARCHAR(50) DEFAULT 'manual',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (template_id) REFERENCES combo_templates(id) ON DELETE CASCADE,
      INDEX idx_template (template_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ");
  $tables[] = 'template_collections';

  // 5. template_banners
  $pdo->exec("
    CREATE TABLE IF NOT EXISTS template_banners (
      id INT AUTO_INCREMENT PRIMARY KEY,
      template_id INT NOT NULL,
      shop_domain VARCHAR(255) NOT NULL,
      desktop_image VARCHAR(500),
      desktop_height VARCHAR(20) DEFAULT '400px',
      desktop_width VARCHAR(20) DEFAULT '100%',
      desktop_border_radius VARCHAR(20) DEFAULT '12px',
      desktop_overlay_color VARCHAR(20) DEFAULT 'rgba(0,0,0,0.3)',
      desktop_overlay_opacity DECIMAL(3,2) DEFAULT 0.30,
      mobile_image VARCHAR(500),
      mobile_height VARCHAR(20) DEFAULT '250px',
      mobile_width VARCHAR(20) DEFAULT '100%',
      mobile_border_radius VARCHAR(20) DEFAULT '8px',
      mobile_overlay_color VARCHAR(20) DEFAULT 'rgba(0,0,0,0.3)',
      mobile_overlay_opacity DECIMAL(3,2) DEFAULT 0.30,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (template_id) REFERENCES combo_templates(id) ON DELETE CASCADE,
      INDEX idx_template (template_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ");
  $tables[] = 'template_banners';

  // 6. template_typography
  $pdo->exec("
    CREATE TABLE IF NOT EXISTS template_typography (
      id INT AUTO_INCREMENT PRIMARY KEY,
      template_id INT NOT NULL,
      shop_domain VARCHAR(255) NOT NULL,
      section_key VARCHAR(50) NOT NULL,
      font_family VARCHAR(100) DEFAULT 'Inter',
      font_size VARCHAR(10) DEFAULT '16px',
      font_weight VARCHAR(10) DEFAULT '400',
      font_color VARCHAR(20) DEFAULT '#202223',
      alignment ENUM('left','center','right') DEFAULT 'left',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (template_id) REFERENCES combo_templates(id) ON DELETE CASCADE,
      INDEX idx_template_section (template_id, section_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ");
  $tables[] = 'template_typography';

  // 7. template_progressbars
  $pdo->exec("
    CREATE TABLE IF NOT EXISTS template_progressbars (
      id INT AUTO_INCREMENT PRIMARY KEY,
      template_id INT NOT NULL,
      shop_domain VARCHAR(255) NOT NULL,
      is_enabled TINYINT(1) DEFAULT 0,
      bar_color VARCHAR(20) DEFAULT '#e1e3e5',
      filled_color VARCHAR(20) DEFAULT '#008060',
      text_color VARCHAR(20) DEFAULT '#202223',
      milestone_color VARCHAR(20) DEFAULT '#008060',
      success_color VARCHAR(20) DEFAULT '#2e7d32',
      background_color VARCHAR(20) DEFAULT '#f6f6f7',
      border_radius VARCHAR(20) DEFAULT '8px',
      animation_enabled TINYINT(1) DEFAULT 1,
      popup_enabled TINYINT(1) DEFAULT 0,
      popup_success_color VARCHAR(20) DEFAULT '#2e7d32',
      popup_reached_message VARCHAR(255) DEFAULT 'Congratulations!',
      popup_styling JSON,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (template_id) REFERENCES combo_templates(id) ON DELETE CASCADE,
      INDEX idx_template (template_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ");
  $tables[] = 'template_progressbars';

  // 8. template_milestones
  $pdo->exec("
    CREATE TABLE IF NOT EXISTS template_milestones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      progressbar_id INT NOT NULL,
      template_id INT NOT NULL,
      shop_domain VARCHAR(255) NOT NULL,
      milestone_value DECIMAL(12,2) NOT NULL,
      label VARCHAR(255),
      message TEXT,
      sort_order INT DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (progressbar_id) REFERENCES template_progressbars(id) ON DELETE CASCADE,
      FOREIGN KEY (template_id) REFERENCES combo_templates(id) ON DELETE CASCADE,
      INDEX idx_progressbar (progressbar_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ");
  $tables[] = 'template_milestones';

  // 9. template_ai_blocks
  $pdo->exec("
    CREATE TABLE IF NOT EXISTS template_ai_blocks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      template_id INT NOT NULL,
      shop_domain VARCHAR(255) NOT NULL,
      is_enabled TINYINT(1) DEFAULT 0,
      heading VARCHAR(255) DEFAULT 'You Might Also Like',
      sub_heading VARCHAR(255),
      recommendation_count INT DEFAULT 4,
      layout_style ENUM('grid','carousel','list') DEFAULT 'grid',
      background_color VARCHAR(20) DEFAULT '#ffffff',
      text_color VARCHAR(20) DEFAULT '#202223',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (template_id) REFERENCES combo_templates(id) ON DELETE CASCADE,
      INDEX idx_template (template_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ");
  $tables[] = 'template_ai_blocks';

  // 10. template_custom_css
  $pdo->exec("
    CREATE TABLE IF NOT EXISTS template_custom_css (
      id INT AUTO_INCREMENT PRIMARY KEY,
      template_id INT NOT NULL,
      shop_domain VARCHAR(255) NOT NULL,
      css_content LONGTEXT,
      is_valid TINYINT(1) DEFAULT 1,
      compiled_hash VARCHAR(64),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (template_id) REFERENCES combo_templates(id) ON DELETE CASCADE,
      INDEX idx_template (template_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ");
  $tables[] = 'template_custom_css';

  // 11. template_settings
  $pdo->exec("
    CREATE TABLE IF NOT EXISTS template_settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      template_id INT NOT NULL,
      shop_domain VARCHAR(255) NOT NULL,
      main_title VARCHAR(255),
      subtitle VARCHAR(255),
      description TEXT,
      cta_text VARCHAR(100) DEFAULT 'Shop Now',
      cta_link VARCHAR(500),
      cta_bg_color VARCHAR(20) DEFAULT '#008060',
      cta_text_color VARCHAR(20) DEFAULT '#ffffff',
      cta_border_radius VARCHAR(20) DEFAULT '6px',
      cta_hover_color VARCHAR(20) DEFAULT '#006e52',
      content_width VARCHAR(20) DEFAULT '1200px',
      section_gap VARCHAR(20) DEFAULT '40px',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (template_id) REFERENCES combo_templates(id) ON DELETE CASCADE,
      INDEX idx_template (template_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ");
  $tables[] = 'template_settings';

  // 12. template_revisions
  $pdo->exec("
    CREATE TABLE IF NOT EXISTS template_revisions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      template_id INT NOT NULL,
      shop_domain VARCHAR(255) NOT NULL,
      version INT NOT NULL,
      snapshot JSON,
      created_by VARCHAR(255),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (template_id) REFERENCES combo_templates(id) ON DELETE CASCADE,
      INDEX idx_template_version (template_id, version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ");
  $tables[] = 'template_revisions';

  // 13. activity_logs
  $pdo->exec("
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      shop_domain VARCHAR(255) NOT NULL,
      action VARCHAR(100) NOT NULL,
      entity_type VARCHAR(50),
      entity_id INT,
      details JSON,
      ip_address VARCHAR(45),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_shop (shop_domain),
      INDEX idx_action (action),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ");
  $tables[] = 'activity_logs';

  echo json_encode([
    "status" => "success",
    "message" => "All Combo Forge tables initialized",
    "tables" => $tables
  ]);

} catch (PDOException $e) {
  http_response_code(500);
  echo json_encode([
    "status" => "error",
    "message" => "Schema initialization failed: " . $e->getMessage()
  ]);
}
