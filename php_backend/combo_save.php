<?php
require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);
$action = $_GET['action'] ?? ($input['action'] ?? null);
$shop = $input['shop_domain'] ?? $_GET['shop'] ?? '';

if (!$shop) {
  http_response_code(400);
  echo json_encode(["status" => "error", "message" => "shop_domain required"]);
  exit;
}

try {

  // ===== GET: Fetch templates =====
  if ($method === 'GET') {
    $id = $_GET['id'] ?? null;

    if ($id) {
      $stmt = $pdo->prepare("
        SELECT ct.*,
          tp.id AS page_id, tp.page_handle, tp.page_title, tp.preview_url, tp.published_url, tp.admin_url,
          tc.id AS collection_id, tc.collection_title, tc.products_per_row, tc.max_products, tc.display_mode, tc.slider_speed, tc.infinite_loop, tc.autoplay, tc.show_arrows, tc.show_dots,
          tb.id AS banner_id, tb.desktop_image, tb.desktop_height, tb.desktop_width, tb.desktop_border_radius, tb.desktop_overlay_color, tb.desktop_overlay_opacity, tb.mobile_image, tb.mobile_height, tb.mobile_width, tb.mobile_border_radius, tb.mobile_overlay_color, tb.mobile_overlay_opacity,
          ts.id AS settings_id, ts.main_title, ts.subtitle, ts.description, ts.cta_text, ts.cta_link, ts.cta_bg_color, ts.cta_text_color, ts.cta_border_radius, ts.cta_hover_color, ts.content_width, ts.section_gap,
          tai.id AS ai_block_id, tai.is_enabled AS ai_enabled, tai.heading AS ai_heading, tai.sub_heading AS ai_sub_heading, tai.recommendation_count, tai.layout_style AS ai_layout, tai.background_color AS ai_bg_color, tai.text_color AS ai_text_color,
          tcc.id AS css_id, tcc.css_content,
          tpb.id AS progressbar_id, tpb.is_enabled AS pb_enabled, tpb.filled_color AS pb_filled, tpb.bar_color AS pb_bar, tpb.text_color AS pb_text, tpb.milestone_color AS pb_milestone, tpb.success_color AS pb_success, tpb.background_color AS pb_bg, tpb.border_radius AS pb_radius, tpb.animation_enabled, tpb.popup_enabled, tpb.popup_reached_message
        FROM combo_templates ct
        LEFT JOIN template_pages tp ON tp.template_id = ct.id
        LEFT JOIN template_collections tc ON tc.template_id = ct.id
        LEFT JOIN template_banners tb ON tb.template_id = ct.id
        LEFT JOIN template_settings ts ON ts.template_id = ct.id
        LEFT JOIN template_ai_blocks tai ON tai.template_id = ct.id
        LEFT JOIN template_custom_css tcc ON tcc.template_id = ct.id
        LEFT JOIN template_progressbars tpb ON tpb.template_id = ct.id
        WHERE ct.id = ? AND ct.shop_domain = ?
        LIMIT 1
      ");
      $stmt->execute([$id, $shop]);
      $row = $stmt->fetch();

      if (!$row) {
        http_response_code(404);
        echo json_encode(["status" => "error", "message" => "Template not found"]);
        exit;
      }

      // Fetch milestones separately
      $milestones = [];
      if ($row['progressbar_id']) {
        $ms = $pdo->prepare("SELECT * FROM template_milestones WHERE progressbar_id = ? ORDER BY sort_order ASC");
        $ms->execute([$row['progressbar_id']]);
        $milestones = $ms->fetchAll();
      }

      // Fetch typography separately
      $typo = $pdo->prepare("SELECT * FROM template_typography WHERE template_id = ?");
      $typo->execute([$id]);
      $typographyRows = $typo->fetchAll();
      $typography = [];
      foreach ($typographyRows as $t) {
        $typography[$t['section_key']] = $t;
      }

      echo json_encode([
        "status" => "success",
        "template" => $row,
        "milestones" => $milestones,
        "typography" => $typography
      ]);
    } else {
      $stmt = $pdo->prepare("
        SELECT ct.*, tp.published_url, tp.page_title
        FROM combo_templates ct
        LEFT JOIN template_pages tp ON tp.template_id = ct.id
        WHERE ct.shop_domain = ?
        ORDER BY ct.updated_at DESC
      ");
      $stmt->execute([$shop]);
      $templates = $stmt->fetchAll();
      echo json_encode(["status" => "success", "templates" => $templates]);
    }
    exit;
  }

  // ===== POST: Save template =====
  if ($method === 'POST') {
    $pdo->beginTransaction();
    try {
      $id = $input['id'] ?? null;
      $name = $input['name'] ?? 'Untitled Template';
      $templateType = $input['template_type'] ?? 'grid';
      $status = $input['status'] ?? 'draft';
      $isActive = isset($input['is_active']) ? ($input['is_active'] ? 1 : 0) : 1;
      $slug = $input['slug'] ?? strtolower(preg_replace('/[^a-z0-9]+/', '-', $name)) . '-' . time();
      $description = $input['description'] ?? '';
      $features = isset($input['features']) ? json_encode($input['features']) : null;

      if ($id) {
        // UPDATE existing
        $stmt = $pdo->prepare("
          UPDATE combo_templates SET name=?, template_type=?, status=?, is_active=?, slug=?, description=?, features=?, version=version+1, updated_at=NOW()
          WHERE id=? AND shop_domain=?
        ");
        $stmt->execute([$name, $templateType, $status, $isActive, $slug, $description, $features, $id, $shop]);
      } else {
        // INSERT new
        $stmt = $pdo->prepare("
          INSERT INTO combo_templates (shop_domain, name, slug, template_type, status, is_active, description, features, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        ");
        $stmt->execute([$shop, $name, $slug, $templateType, $status, $isActive, $description, $features]);
        $id = (int) $pdo->lastInsertId();
      }

      // Save template_settings
      $settings = $input['settings'] ?? [];
      if ($settings) {
        $stmt = $pdo->prepare("
          INSERT INTO template_settings (template_id, shop_domain, main_title, subtitle, description, cta_text, cta_link, cta_bg_color, cta_text_color, cta_border_radius, cta_hover_color, content_width, section_gap)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            main_title=VALUES(main_title), subtitle=VALUES(subtitle), description=VALUES(description),
            cta_text=VALUES(cta_text), cta_link=VALUES(cta_link), cta_bg_color=VALUES(cta_bg_color),
            cta_text_color=VALUES(cta_text_color), cta_border_radius=VALUES(cta_border_radius),
            cta_hover_color=VALUES(cta_hover_color), content_width=VALUES(content_width), section_gap=VALUES(section_gap)
        ");
        $stmt->execute([
          $id, $shop,
          $settings['main_title'] ?? null, $settings['subtitle'] ?? null, $settings['description'] ?? null,
          $settings['cta_text'] ?? 'Shop Now', $settings['cta_link'] ?? null,
          $settings['cta_bg_color'] ?? '#008060', $settings['cta_text_color'] ?? '#ffffff',
          $settings['cta_border_radius'] ?? '6px', $settings['cta_hover_color'] ?? '#006e52',
          $settings['content_width'] ?? '1200px', $settings['section_gap'] ?? '40px'
        ]);
      }

      // Save collections
      $collections = $input['collections'] ?? [];
      if ($collections) {
        $pdo->prepare("DELETE FROM template_collections WHERE template_id = ?")->execute([$id]);
        $stmt = $pdo->prepare("
          INSERT INTO template_collections (template_id, shop_domain, collection_id, collection_title, handle, products_per_row, max_products, display_mode, slider_speed, infinite_loop, autoplay, show_arrows, show_dots, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");
        foreach ($collections as $c) {
          $stmt->execute([
            $id, $shop,
            $c['collection_id'] ?? '', $c['collection_title'] ?? '', $c['handle'] ?? '',
            (int)($c['products_per_row'] ?? 3), (int)($c['max_products'] ?? 12),
            $c['display_mode'] ?? 'grid', (int)($c['slider_speed'] ?? 3000),
            $c['infinite_loop'] ? 1 : 0, $c['autoplay'] ? 1 : 0,
            $c['show_arrows'] ? 1 : 0, $c['show_dots'] ? 1 : 0,
            $c['sort_order'] ?? 'manual'
          ]);
        }
      }

      // Save banners
      $banners = $input['banners'] ?? [];
      if ($banners) {
        $stmt = $pdo->prepare("
          INSERT INTO template_banners (template_id, shop_domain, desktop_image, desktop_height, desktop_width, desktop_border_radius, desktop_overlay_color, desktop_overlay_opacity, mobile_image, mobile_height, mobile_width, mobile_border_radius, mobile_overlay_color, mobile_overlay_opacity)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            desktop_image=VALUES(desktop_image), desktop_height=VALUES(desktop_height), desktop_width=VALUES(desktop_width),
            desktop_border_radius=VALUES(desktop_border_radius), desktop_overlay_color=VALUES(desktop_overlay_color),
            desktop_overlay_opacity=VALUES(desktop_overlay_opacity), mobile_image=VALUES(mobile_image),
            mobile_height=VALUES(mobile_height), mobile_width=VALUES(mobile_width),
            mobile_border_radius=VALUES(mobile_border_radius), mobile_overlay_color=VALUES(mobile_overlay_color),
            mobile_overlay_opacity=VALUES(mobile_overlay_opacity)
        ");
        $stmt->execute([
          $id, $shop,
          $banners['desktop_image'] ?? null, $banners['desktop_height'] ?? '400px', $banners['desktop_width'] ?? '100%',
          $banners['desktop_border_radius'] ?? '12px', $banners['desktop_overlay_color'] ?? 'rgba(0,0,0,0.3)',
          $banners['desktop_overlay_opacity'] ?? 0.30,
          $banners['mobile_image'] ?? null, $banners['mobile_height'] ?? '250px', $banners['mobile_width'] ?? '100%',
          $banners['mobile_border_radius'] ?? '8px', $banners['mobile_overlay_color'] ?? 'rgba(0,0,0,0.3)',
          $banners['mobile_overlay_opacity'] ?? 0.30
        ]);
      }

      // Save typography
      $typography = $input['typography'] ?? [];
      if ($typography) {
        $pdo->prepare("DELETE FROM template_typography WHERE template_id = ?")->execute([$id]);
        $stmt = $pdo->prepare("
          INSERT INTO template_typography (template_id, shop_domain, section_key, font_family, font_size, font_weight, font_color, alignment)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ");
        foreach ($typography as $key => $t) {
          $stmt->execute([
            $id, $shop, $key,
            $t['font_family'] ?? 'Inter', $t['font_size'] ?? '16px', $t['font_weight'] ?? '400',
            $t['font_color'] ?? '#202223', $t['alignment'] ?? 'left'
          ]);
        }
      }

      // Save progress bar
      $progress = $input['progressbar'] ?? [];
      $progressbarId = null;
      if ($progress) {
        $stmt = $pdo->prepare("
          INSERT INTO template_progressbars (template_id, shop_domain, is_enabled, bar_color, filled_color, text_color, milestone_color, success_color, background_color, border_radius, animation_enabled, popup_enabled, popup_success_color, popup_reached_message, popup_styling)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            is_enabled=VALUES(is_enabled), bar_color=VALUES(bar_color), filled_color=VALUES(filled_color),
            text_color=VALUES(text_color), milestone_color=VALUES(milestone_color), success_color=VALUES(success_color),
            background_color=VALUES(background_color), border_radius=VALUES(border_radius),
            animation_enabled=VALUES(animation_enabled), popup_enabled=VALUES(popup_enabled),
            popup_success_color=VALUES(popup_success_color), popup_reached_message=VALUES(popup_reached_message),
            popup_styling=VALUES(popup_styling)
        ");
        $stmt->execute([
          $id, $shop,
          $progress['is_enabled'] ? 1 : 0,
          $progress['bar_color'] ?? '#e1e3e5', $progress['filled_color'] ?? '#008060',
          $progress['text_color'] ?? '#202223', $progress['milestone_color'] ?? '#008060',
          $progress['success_color'] ?? '#2e7d32', $progress['background_color'] ?? '#f6f6f7',
          $progress['border_radius'] ?? '8px', $progress['animation_enabled'] ? 1 : 0,
          $progress['popup_enabled'] ? 1 : 0, $progress['popup_success_color'] ?? '#2e7d32',
          $progress['popup_reached_message'] ?? 'Congratulations!',
          isset($progress['popup_styling']) ? json_encode($progress['popup_styling']) : null
        ]);
        $progressbarId = (int) $pdo->lastInsertId();
      }

      // Save milestones
      $milestones = $input['milestones'] ?? [];
      if ($milestones && $progressbarId) {
        $pdo->prepare("DELETE FROM template_milestones WHERE progressbar_id = ?")->execute([$progressbarId]);
        $stmt = $pdo->prepare("
          INSERT INTO template_milestones (progressbar_id, template_id, shop_domain, milestone_value, label, message, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        ");
        foreach ($milestones as $i => $m) {
          $stmt->execute([
            $progressbarId, $id, $shop,
            $m['value'] ?? 0, $m['label'] ?? null, $m['message'] ?? '', $i
          ]);
        }
      }

      // Save AI block
      $aiBlock = $input['ai_block'] ?? [];
      if ($aiBlock) {
        $stmt = $pdo->prepare("
          INSERT INTO template_ai_blocks (template_id, shop_domain, is_enabled, heading, sub_heading, recommendation_count, layout_style, background_color, text_color)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            is_enabled=VALUES(is_enabled), heading=VALUES(heading), sub_heading=VALUES(sub_heading),
            recommendation_count=VALUES(recommendation_count), layout_style=VALUES(layout_style),
            background_color=VALUES(background_color), text_color=VALUES(text_color)
        ");
        $stmt->execute([
          $id, $shop,
          $aiBlock['is_enabled'] ? 1 : 0, $aiBlock['heading'] ?? 'You Might Also Like',
          $aiBlock['sub_heading'] ?? null, (int)($aiBlock['recommendation_count'] ?? 4),
          $aiBlock['layout_style'] ?? 'grid', $aiBlock['background_color'] ?? '#ffffff',
          $aiBlock['text_color'] ?? '#202223'
        ]);
      }

      // Save custom CSS
      $customCss = $input['custom_css'] ?? null;
      if ($customCss !== null) {
        $stmt = $pdo->prepare("
          INSERT INTO template_custom_css (template_id, shop_domain, css_content, is_valid, compiled_hash)
          VALUES (?, ?, ?, 1, ?)
          ON DUPLICATE KEY UPDATE css_content=VALUES(css_content), is_valid=1, compiled_hash=VALUES(compiled_hash)
        ");
        $stmt->execute([$id, $shop, $customCss, md5($customCss)]);
      }

      // Log activity
      $actionLog = $id ? 'template_updated' : 'template_created';
      $logStmt = $pdo->prepare("
        INSERT INTO activity_logs (shop_domain, action, entity_type, entity_id, details, created_at)
        VALUES (?, ?, 'template', ?, ?, NOW())
      ");
      $logStmt->execute([$shop, $actionLog, $id, json_encode(['name' => $name, 'type' => $templateType])]);

      $pdo->commit();

      echo json_encode([
        "status" => "success",
        "message" => $id ? "Template updated" : "Template created",
        "id" => $id
      ]);
    } catch (Exception $e) {
      $pdo->rollBack();
      http_response_code(500);
      echo json_encode(["status" => "error", "message" => $e->getMessage()]);
    }
    exit;
  }

  // ===== DELETE =====
  if ($method === 'DELETE') {
    $id = $input['id'] ?? $_GET['id'] ?? null;
    if (!$id) {
      http_response_code(400);
      echo json_encode(["status" => "error", "message" => "id required"]);
      exit;
    }
    $stmt = $pdo->prepare("DELETE FROM combo_templates WHERE id = ? AND shop_domain = ?");
    $stmt->execute([$id, $shop]);

    echo json_encode(["status" => "success", "message" => "Template deleted"]);
    exit;
  }

  http_response_code(405);
  echo json_encode(["status" => "error", "message" => "Method not allowed"]);

} catch (PDOException $e) {
  http_response_code(500);
  echo json_encode(["status" => "error", "message" => $e->getMessage()]);
}
