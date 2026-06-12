<?php
require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'GET') {
    http_response_code(405);
    echo json_encode(["success" => false, "error" => "Method not allowed"]);
    exit;
}

$page = $_GET['page'] ?? '';
if ($page) {
    $stmt = $pdo->prepare("SELECT id, page, title, prompt, priority FROM ai_suggestions WHERE active = 1 AND page = ? ORDER BY priority ASC");
    $stmt->execute([$page]);
} else {
    $stmt = $pdo->query("SELECT id, page, title, prompt, priority FROM ai_suggestions WHERE active = 1 ORDER BY priority ASC");
}
echo json_encode(["success" => true, "suggestions" => $stmt->fetchAll()]);
