<?php
require_once __DIR__ . '/config.php';

$secret = $_SERVER['HTTP_X_FORGE_SECRET'] ?? '';
$expected = getenv('SHOPIFY_API_KEY') ?: '';
if ($expected && $secret !== $expected) {
    http_response_code(403);
    echo json_encode(['status' => 'error', 'message' => 'Forbidden']);
    exit;
}

// ── GET — messages for a conversation ────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $convId = $_GET['conversationId'] ?? null;
    if (!$convId) {
        echo json_encode(['status' => 'success', 'messages' => []]);
        exit;
    }

    $stmt = $pdo->prepare('
        SELECT id, conversationId as conversation_id, role, message, createdAt as created_at
        FROM ai_messages
        WHERE conversationId = ?
        ORDER BY createdAt ASC
    ');
    $stmt->execute([$convId]);
    echo json_encode(['status' => 'success', 'messages' => $stmt->fetchAll()]);
    exit;
}

// ── POST — save a message ─────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['status'=>'error','message'=>'Method not allowed']); exit;
}

$body   = json_decode(file_get_contents('php://input'), true) ?? [];
$convId = $body['conversationId'] ?? null;
$role   = $body['role']           ?? null;
$msg    = $body['message']        ?? null;

if (!$convId || !$role || !$msg) {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => 'conversationId, role, message required']);
    exit;
}

$id  = uniqid('', true);
$now = date('Y-m-d H:i:s');

$pdo->prepare('
    INSERT INTO ai_messages (id, conversationId, role, message, createdAt)
    VALUES (?, ?, ?, ?, ?)
')->execute([$id, $convId, $role, $msg, $now]);

// Bump conversation updatedAt
$pdo->prepare('UPDATE ai_conversations SET updatedAt = ? WHERE id = ?')->execute([$now, $convId]);

echo json_encode(['status' => 'success', 'message' => ['id' => $id, 'conversation_id' => $convId, 'role' => $role, 'message' => $msg, 'created_at' => $now]]);
