<?php
require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];
$input = json_decode(file_get_contents('php://input'), true);
$shop = $input['shop_domain'] ?? $_GET['shop'] ?? '';

if (!$shop) {
  http_response_code(400);
  echo json_encode(["status" => "error", "message" => "shop_domain required"]);
  exit;
}

if ($method !== 'POST') {
  http_response_code(405);
  echo json_encode(["status" => "error", "message" => "Only POST allowed"]);
  exit;
}

$templateId = $input['template_id'] ?? null;
$pageTitle = $input['page_title'] ?? 'Combo Page';
$pageHandle = $input['page_handle'] ?? 'combo-' . time();
$previewUrl = $input['preview_url'] ?? '';
$publishedUrl = $input['published_url'] ?? '';
$adminUrl = $input['admin_url'] ?? '';
$pageId = $input['page_id'] ?? '';

if (!$templateId) {
  http_response_code(400);
  echo json_encode(["status" => "error", "message" => "template_id required"]);
  exit;
}

try {
  $stmt = $pdo->prepare("
    INSERT INTO template_pages (template_id, shop_domain, page_id, page_handle, page_title, preview_url, published_url, admin_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      page_id=VALUES(page_id), page_handle=VALUES(page_handle), page_title=VALUES(page_title),
      preview_url=VALUES(preview_url), published_url=VALUES(published_url), admin_url=VALUES(admin_url),
      updated_at=NOW()
  ");
  $stmt->execute([$templateId, $shop, $pageId, $pageHandle, $pageTitle, $previewUrl, $publishedUrl, $adminUrl]);

  $pageStmt = $pdo->prepare("SELECT * FROM template_pages WHERE template_id = ? AND shop_domain = ?");
  $pageStmt->execute([$templateId, $shop]);
  $page = $pageStmt->fetch();

  echo json_encode([
    "status" => "success",
    "message" => "Page saved",
    "page" => $page
  ]);
} catch (PDOException $e) {
  http_response_code(500);
  echo json_encode(["status" => "error", "message" => $e->getMessage()]);
}
