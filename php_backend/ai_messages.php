<?php
require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];

switch ($method) {
    case 'GET':
        $convId = $_GET['conversationId'] ?? '';
        if (!$convId) {
            http_response_code(400);
            echo json_encode(["success" => false, "error" => "conversationId required"]);
            exit;
        }
        $stmt = $pdo->prepare("SELECT id, conversationId, role, message, createdAt FROM ai_messages WHERE conversationId = ? ORDER BY createdAt ASC");
        $stmt->execute([$convId]);
        echo json_encode(["success" => true, "messages" => $stmt->fetchAll()]);
        break;

    case 'POST':
        $input = json_decode(file_get_contents('php://input'), true);
        $convId = $input['conversationId'] ?? 0;
        $role = $input['role'] ?? '';
        $message = $input['message'] ?? '';
        if (!$convId || !$role || !$message) {
            http_response_code(400);
            echo json_encode(["success" => false, "error" => "conversationId, role, message required"]);
            exit;
        }
        $stmt = $pdo->prepare("INSERT INTO ai_messages (conversationId, role, message, createdAt) VALUES (?, ?, ?, NOW())");
        $stmt->execute([$convId, $role, $message]);
        echo json_encode(["success" => true, "messageId" => (int)$pdo->lastInsertId()]);
        break;

    default:
        http_response_code(405);
        echo json_encode(["success" => false, "error" => "Method not allowed"]);
}
