<?php
require_once __DIR__ . '/config.php';

/**
 * Generic parameterized-SQL proxy for the Node app's direct-MySQL layer
 * (app/services/db.server.js / app/db.server.js), used when Node can't
 * open a direct MySQL connection to this server (e.g. remote-MySQL
 * connection limits, or the Node app is hosted elsewhere like Fly.io).
 *
 * Node already fully controls every SQL string sent here (it's the same
 * trust boundary a direct MySQL connection would have) — this endpoint
 * just changes the transport from TCP/MySQL-protocol to HTTPS, gated by
 * the same X-Forge-Secret shared-secret header used by every other
 * Node -> PHP endpoint in this backend.
 *
 * POST body: { sql: string, params: array }
 * Response:
 *   SELECT/SHOW/DESCRIBE/EXPLAIN -> { success, rows: [...] }
 *   INSERT/UPDATE/DELETE/DDL     -> { success, insertId, affectedRows }
 */

$secret = $_SERVER['HTTP_X_FORGE_SECRET'] ?? '';
$expected = getenv('SHOPIFY_API_KEY') ?: '';
// Fail closed: if SHOPIFY_API_KEY isn't configured server-side, this
// endpoint executes arbitrary SQL, so a missing secret must reject every
// request rather than skip the check (the previous `$expected &&` guard
// left this wide open whenever the env var was unset).
if (!$expected || !hash_equals($expected, $secret)) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Forbidden']);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'POST only']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true) ?: [];
$sql = $input['sql'] ?? null;
$params = $input['params'] ?? [];

if (!$sql || !is_string($sql)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'sql (string) is required']);
    exit;
}
if (!is_array($params)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'params must be an array']);
    exit;
}

// Reject stacked statements — this endpoint executes exactly one
// statement per call, same as a single mysql2 pool.execute() would.
if (preg_match('/;\s*\S/', trim(rtrim($sql, "; \t\n\r\0\x0B")))) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Multiple statements are not allowed']);
    exit;
}

try {
    $stmt = $pdo->prepare($sql);
    $stmt->execute(array_values($params));

    $isReadStatement = (bool) preg_match('/^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i', $sql);

    if ($isReadStatement) {
        echo json_encode([
            'success' => true,
            'rows' => $stmt->fetchAll(PDO::FETCH_ASSOC),
        ]);
    } else {
        echo json_encode([
            'success' => true,
            'insertId' => (int) $pdo->lastInsertId(),
            'affectedRows' => $stmt->rowCount(),
        ]);
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
