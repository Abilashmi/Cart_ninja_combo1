<?php
require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'GET') {
    http_response_code(405);
    echo json_encode(["success" => false, "error" => "Method not allowed"]);
    exit;
}

$stmt = $pdo->query("SELECT id, name, description, parameters, active FROM ai_tools WHERE active = 1 ORDER BY name ASC");
echo json_encode(["success" => true, "tools" => $stmt->fetchAll()]);
