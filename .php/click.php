<?php
require_once __DIR__ . '/config.php';

$data = json_decode(file_get_contents("php://input"), true);

$shop_id = $data['shop_id'];
$domain = $data['domain'];
$event_type = $data['event_type'];

$stmt = $conn->prepare("
INSERT INTO cart_click_events (shop_id, domain, event_type, created_at)
VALUES (?, ?, ?, NOW())
");

$stmt->bind_param("sss", $shop_id, $domain, $event_type);
$stmt->execute();

echo json_encode(["status"=>"success"]);