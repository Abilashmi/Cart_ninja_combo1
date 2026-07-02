<?php
require_once __DIR__ . '/config.php';

$data = json_decode(file_get_contents("php://input"), true);

$shop_id = $data['shop_id'] ?? null;
$domain = $data['domain'] ?? null;
$event_type = $data['event_type'] ?? null;
$session_id = $data['session_id'] ?? null;

if (!$domain || !$event_type) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "domain and event_type required"]);
    exit;
}

$stmt = $pdo->prepare("
INSERT INTO cart_click_events (shop_id, domain, event_type, session_id, created_at)
VALUES (?, ?, ?, ?, NOW())
");

$stmt->execute([$shop_id, $domain, $event_type, $session_id]);

echo json_encode(["status" => "success"]);