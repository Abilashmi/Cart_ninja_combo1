<?php
require_once __DIR__ . '/config.php';

$secret = $_SERVER['HTTP_X_FORGE_SECRET'] ?? '';
$expected = getenv('SHOPIFY_API_KEY') ?: '';
if ($expected && $secret !== $expected) {
    http_response_code(403);
    echo json_encode(['status' => 'error', 'message' => 'Forbidden']);
    exit;
}

// ── GET — list conversations for shop ────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $shop = $_GET['shop'] ?? null;
    if (!$shop) { http_response_code(400); echo json_encode(['status'=>'error','message'=>'shop required']); exit; }

    // Column is shopDomain (camelCase) in this table
    $stmt = $pdo->prepare('
        SELECT id, shopDomain as shop_domain, title, createdAt as created_at, updatedAt as updated_at
        FROM ai_conversations
        WHERE shopDomain = ?
        ORDER BY updatedAt DESC
        LIMIT 50
    ');
    $stmt->execute([$shop]);
    echo json_encode(['status' => 'success', 'conversations' => $stmt->fetchAll()]);
    exit;
}

// ── POST — create a conversation ─────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['status'=>'error','message'=>'Method not allowed']); exit;
}

$body = json_decode(file_get_contents('php://input'), true) ?? [];
$shop  = $body['shop']  ?? null;
$title = $body['title'] ?? 'New Chat';

if (!$shop) { http_response_code(400); echo json_encode(['status'=>'error','message'=>'shop required']); exit; }

$id  = uniqid('', true);
$now = date('Y-m-d H:i:s');

$stmt = $pdo->prepare('
    INSERT INTO ai_conversations (id, shopDomain, title, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?)
');
$stmt->execute([$id, $shop, $title, $now, $now]);

echo json_encode([
    'status'       => 'success',
    'conversation' => ['id' => $id, 'shop_domain' => $shop, 'title' => $title, 'created_at' => $now, 'updated_at' => $now],
]);
