<?php
require_once __DIR__ . '/config.php';

// Visitor/session approximation (see analytics plan section 1.6). Table is
// also created lazily by app/services/analytics-schema.server.js on the Node
// side — created here too so this endpoint works independently of whether
// the Node process has started yet.
$pdo->exec("
    CREATE TABLE IF NOT EXISTS analytics_sessions (
      id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop_domain    VARCHAR(255) NOT NULL,
      session_id     VARCHAR(255) NOT NULL,
      page_type      VARCHAR(50)  NULL,
      first_seen_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      pageview_count INT NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_shop_session (shop_domain, session_id),
      INDEX idx_shop_last_seen (shop_domain, last_seen_at),
      INDEX idx_shop_first_seen (shop_domain, first_seen_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
");

$data = json_decode(file_get_contents("php://input"), true);

$domain = $data['domain'] ?? null;
$session_id = $data['session_id'] ?? null;
$page_type = $data['page_type'] ?? null;

if (!$domain || !$session_id) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "domain and session_id required"]);
    exit;
}

$stmt = $pdo->prepare("
    INSERT INTO analytics_sessions (shop_domain, session_id, page_type)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE
      last_seen_at = NOW(),
      pageview_count = pageview_count + 1
");
$stmt->execute([$domain, $session_id, $page_type]);

echo json_encode(["status" => "success"]);
