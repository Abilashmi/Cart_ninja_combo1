<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/cod_helpers.php';

/**
 * BRIX COD Checkout orders. Node-only, X-Forge-Secret.
 * One row per order attempt, keyed by (shop, idem_key) so a double tap can
 * never create two Shopify orders. The Shopify order itself is created by
 * Node; this file records it.
 *
 *   POST { action: 'find',   shop, idem_key }                  → { order: row|null }
 *   POST { action: 'count_recent', shop, phone_hash }           → { count }   placed orders in the last 24 h
 *   POST { action: 'begin',  shop, idem_key, source, phone_hash, phone_masked, phone_verified,
 *                            customer_name, pincode, total, currency }  → {}  | 409 duplicate
 *   POST { action: 'complete', shop, idem_key, draft_order_id, order_id, order_name, total, currency } → {}
 *   POST { action: 'abandon', shop, idem_key }                  → {}   drops an unfinished attempt so it can be retried
 *   POST { action: 'list',   shop, limit }                      → { orders: row[] }  newest first
 */

const COD_SOURCES = ['drawer', 'product', 'combo'];

cod_require_secret();
$body = cod_body();
$shop = cod_shop($body['shop'] ?? '');
$action = $body['action'] ?? '';

function cod_idem($value) {
    $key = (string)$value;
    if (!preg_match('/^[A-Za-z0-9_-]{8,64}$/', $key)) cod_fail(400, 'invalid_idem_key', 'Invalid idem_key');
    return $key;
}

function cod_money($value) {
    return is_numeric($value) ? round((float)$value, 2) : null;
}

function cod_public_order($row) {
    return [
        'status' => $row['status'],
        'source' => $row['source'],
        'phone_masked' => $row['phone_masked'],
        'phone_verified' => (int)$row['phone_verified'] === 1,
        'customer_name' => $row['customer_name'],
        'pincode' => $row['pincode'],
        'total' => $row['total'] === null ? null : (float)$row['total'],
        'currency' => $row['currency'],
        'order_id' => $row['order_id'],
        'order_name' => $row['order_name'],
        // MySQL DATETIME (server time) as ISO 8601 UTC for the admin list.
        'created_at' => gmdate('Y-m-d\TH:i:s\Z', strtotime($row['created_at'])),
    ];
}

if ($action === 'find') {
    $idem = cod_idem($body['idem_key'] ?? '');
    cod_db($pdo, function ($pdo) use ($shop, $idem) {
        $stmt = $pdo->prepare('SELECT * FROM cod_orders WHERE shop = ? AND idem_key = ? LIMIT 1');
        $stmt->execute([$shop, $idem]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        cod_ok(['order' => $row ? cod_public_order($row) : null]);
    });
}

if ($action === 'count_recent') {
    $phoneHash = cod_hash($body['phone_hash'] ?? '', 'phone_hash');
    cod_db($pdo, function ($pdo) use ($shop, $phoneHash) {
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM cod_orders WHERE shop = ? AND phone_hash = ? AND status = 'placed' AND created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)");
        $stmt->execute([$shop, $phoneHash]);
        cod_ok(['count' => (int)$stmt->fetchColumn()]);
    });
}

if ($action === 'begin') {
    $idem = cod_idem($body['idem_key'] ?? '');
    $source = in_array($body['source'] ?? '', COD_SOURCES, true) ? $body['source'] : cod_fail(400, 'invalid_source', 'Invalid source');
    $phoneHash = cod_hash($body['phone_hash'] ?? '', 'phone_hash');
    $masked = cod_str($body['phone_masked'] ?? '', 16);
    $values = [
        $shop, $idem, $source, $phoneHash, $masked, !empty($body['phone_verified']) ? 1 : 0,
        cod_str($body['customer_name'] ?? '', 120), cod_str($body['pincode'] ?? '', 10),
        cod_money($body['total'] ?? null), cod_str($body['currency'] ?? '', 8),
    ];
    cod_db($pdo, function ($pdo) use ($values) {
        $stmt = $pdo->prepare(
            "INSERT INTO cod_orders (shop, idem_key, status, source, phone_hash, phone_masked, phone_verified, customer_name, pincode, total, currency)
             VALUES (?, ?, 'creating', ?, ?, ?, ?, ?, ?, ?, ?)"
        );
        $stmt->execute($values);
        cod_ok();
    });
}

if ($action === 'complete') {
    $idem = cod_idem($body['idem_key'] ?? '');
    $values = [
        cod_str($body['draft_order_id'] ?? '', 64), cod_str($body['order_id'] ?? '', 64), cod_str($body['order_name'] ?? '', 32),
        cod_money($body['total'] ?? null), cod_str($body['currency'] ?? '', 8), $shop, $idem,
    ];
    cod_db($pdo, function ($pdo) use ($values) {
        $stmt = $pdo->prepare("UPDATE cod_orders SET status = 'placed', draft_order_id = ?, order_id = ?, order_name = ?, total = ?, currency = ? WHERE shop = ? AND idem_key = ?");
        $stmt->execute($values);
        if ($stmt->rowCount() === 0) cod_fail(404, 'not_found', 'No order attempt with that idem_key');
        cod_ok();
    });
}

if ($action === 'abandon') {
    $idem = cod_idem($body['idem_key'] ?? '');
    cod_db($pdo, function ($pdo) use ($shop, $idem) {
        $pdo->prepare("DELETE FROM cod_orders WHERE shop = ? AND idem_key = ? AND status = 'creating'")->execute([$shop, $idem]);
        cod_ok();
    });
}

if ($action === 'list') {
    $limit = max(1, min(200, (int)($body['limit'] ?? 50)));
    cod_db($pdo, function ($pdo) use ($shop, $limit) {
        $stmt = $pdo->prepare("SELECT * FROM cod_orders WHERE shop = ? AND status = 'placed' ORDER BY id DESC LIMIT " . $limit);
        $stmt->execute([$shop]);
        cod_ok(['orders' => array_map('cod_public_order', $stmt->fetchAll(PDO::FETCH_ASSOC))]);
    });
}

cod_fail(400, 'invalid_action', 'Unknown action');
