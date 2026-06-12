<?php
require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];

switch ($method) {
    case 'GET':
        $stmt = $pdo->query("SELECT id, shopDomain, title, createdAt, updatedAt FROM ai_conversations ORDER BY updatedAt DESC");
        echo json_encode(["success" => true, "conversations" => $stmt->fetchAll()]);
        break;

    case 'POST':
        $input = json_decode(file_get_contents('php://input'), true);
        $shopDomain = $input['shopDomain'] ?? '';
        $title = $input['title'] ?? 'New Chat';
        if (!$shopDomain) {
            http_response_code(400);
            echo json_encode(["success" => false, "error" => "shopDomain required"]);
            exit;
        }
        $stmt = $pdo->prepare("INSERT INTO ai_conversations (shopDomain, title, createdAt, updatedAt) VALUES (?, ?, NOW(), NOW())");
        $stmt->execute([$shopDomain, $title]);
        echo json_encode(["success" => true, "conversationId" => (int)$pdo->lastInsertId()]);
        break;

    default:
        http_response_code(405);
        echo json_encode(["success" => false, "error" => "Method not allowed"]);
}
