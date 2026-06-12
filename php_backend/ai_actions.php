<?php
require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'POST') {
    http_response_code(405);
    echo json_encode(["success" => false, "error" => "Method not allowed"]);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
$convId = $input['conversationId'] ?? 0;
$module = $input['module'] ?? '';
$actionName = $input['actionName'] ?? '';
$payload = $input['payload'] ?? '';
$status = $input['status'] ?? 'pending';

if (!$convId || !$actionName) {
    http_response_code(400);
    echo json_encode(["success" => false, "error" => "conversationId and actionName required"]);
    exit;
}

$stmt = $pdo->prepare("INSERT INTO ai_actions (conversationId, module, actionName, payload, status, createdAt) VALUES (?, ?, ?, ?, ?, NOW())");
$stmt->execute([$convId, $module, $actionName, is_string($payload) ? $payload : json_encode($payload), $status]);
echo json_encode(["success" => true, "actionId" => (int)$pdo->lastInsertId()]);
