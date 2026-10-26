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
 *                            customer_name, pincode, total, currency,
 *                            shipping_amount?, shipping_option?, shipping_zone?, delivery_date? }  → {}  | 409 duplicate
 *   POST { action: 'complete', shop, idem_key, draft_order_id, order_id, order_name, total, currency } → {}
 *   POST { action: 'abandon', shop, idem_key }                  → {}   drops an unfinished attempt so it can be retried
 *   POST { action: 'list',   shop, limit (≤ 500), from_ts?, to_ts? } → { orders: row[], total }  newest first;
 *        from_ts / to_ts = Unix seconds of the dashboard's date filter, total = orders in that window
 *   POST { action: 'tracking', shop, idem_key, ga4_status, meta_status } → {}   result of the server-side Purchase
 *   POST { action: 'sync',   shop, order_id, financial_status, fulfillment_status, shipment_status,
 *                            cancelled_at, refunded_total }     → { matched, previous, lifecycle, order_name, total, currency }
 *        from Shopify's order webhooks (refunded_total = all refunds so far); matches nothing for
 *        orders BRIX didn't place
 *   POST { action: 'shipping_stats', shop, days, from_ts?, to_ts? } → { rows: [{ option, zone, orders, shipping, total, free }] }
 *        placed orders of the last `days` days (1–365), or of the from_ts / to_ts window, that recorded
 *        their shipping, by delivery option and zone
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
        'lifecycle' => $row['lifecycle'] ?? 'placed',
        'refunded_total' => isset($row['refunded_total']) ? (float)$row['refunded_total'] : 0,
        'ga4_status' => $row['ga4_status'] ?? null,
        'meta_status' => $row['meta_status'] ?? null,
        'shipping_amount' => isset($row['shipping_amount']) ? (float)$row['shipping_amount'] : null,
        'shipping_option' => $row['shipping_option'] ?? null,
        'shipping_zone' => $row['shipping_zone'] ?? null,
        'delivery_date' => $row['delivery_date'] ?? null,
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
    $deliveryDate = cod_str($body['delivery_date'] ?? '', 10);
    $values = [
        $shop, $idem, $source, $phoneHash, $masked, !empty($body['phone_verified']) ? 1 : 0,
        cod_str($body['customer_name'] ?? '', 120), cod_str($body['pincode'] ?? '', 10),
        cod_money($body['total'] ?? null), cod_str($body['currency'] ?? '', 8),
        cod_money($body['shipping_amount'] ?? null),
        cod_str($body['shipping_option'] ?? '', 60) ?: null,
        cod_str($body['shipping_zone'] ?? '', 60) ?: null,
        preg_match('/^\d{4}-\d{2}-\d{2}$/', $deliveryDate) ? $deliveryDate : null,
    ];
    cod_db($pdo, function ($pdo) use ($values) {
        $stmt = $pdo->prepare(
            "INSERT INTO cod_orders (shop, idem_key, status, source, phone_hash, phone_masked, phone_verified, customer_name, pincode, total, currency,
                                     shipping_amount, shipping_option, shipping_zone, delivery_date)
             VALUES (?, ?, 'creating', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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

// Optional time window from the dashboard's date filter: from_ts / to_ts are
// Unix seconds (from included, to not). FROM_UNIXTIME gives the session's
// time, the same clock NOW() wrote created_at with. Returns [sql, params].
function cod_window($body) {
    $from = $body['from_ts'] ?? null;
    $to = $body['to_ts'] ?? null;
    if (!is_numeric($from) || !is_numeric($to) || (int)$from < 0 || (int)$to <= (int)$from) return ['', []];
    return [' AND created_at >= FROM_UNIXTIME(?) AND created_at < FROM_UNIXTIME(?)', [(int)$from, (int)$to]];
}

if ($action === 'list') {
    $limit = max(1, min(500, (int)($body['limit'] ?? 50)));
    [$windowSql, $windowParams] = cod_window($body);
    cod_db($pdo, function ($pdo) use ($shop, $limit, $windowSql, $windowParams) {
        $stmt = $pdo->prepare("SELECT * FROM cod_orders WHERE shop = ? AND status = 'placed'$windowSql ORDER BY id DESC LIMIT " . $limit);
        $stmt->execute(array_merge([$shop], $windowParams));
        $orders = array_map('cod_public_order', $stmt->fetchAll(PDO::FETCH_ASSOC));
        // How many the window holds in all (more than `limit` = the list is cut).
        $count = $pdo->prepare("SELECT COUNT(*) FROM cod_orders WHERE shop = ? AND status = 'placed'$windowSql");
        $count->execute(array_merge([$shop], $windowParams));
        cod_ok(['orders' => $orders, 'total' => (int)$count->fetchColumn()]);
    });
}

if ($action === 'shipping_stats') {
    $days = max(1, min(365, (int)($body['days'] ?? 30)));
    [$windowSql, $windowParams] = cod_window($body);
    if ($windowSql === '') $windowSql = " AND created_at > DATE_SUB(NOW(), INTERVAL $days DAY)";
    cod_db($pdo, function ($pdo) use ($shop, $windowSql, $windowParams) {
        $stmt = $pdo->prepare(
            "SELECT COALESCE(shipping_option, '') AS opt, COALESCE(shipping_zone, '') AS zone, COUNT(*) AS orders,
                    SUM(shipping_amount) AS shipping, SUM(total) AS total, SUM(CASE WHEN shipping_amount = 0 THEN 1 ELSE 0 END) AS free
             FROM cod_orders
             WHERE shop = ? AND status = 'placed' AND shipping_amount IS NOT NULL$windowSql
             GROUP BY opt, zone ORDER BY orders DESC LIMIT 200"
        );
        $stmt->execute(array_merge([$shop], $windowParams));
        $rows = array_map(function ($r) {
            return [
                'option' => $r['opt'], 'zone' => $r['zone'], 'orders' => (int)$r['orders'],
                'shipping' => round((float)$r['shipping'], 2), 'total' => round((float)$r['total'], 2), 'free' => (int)$r['free'],
            ];
        }, $stmt->fetchAll(PDO::FETCH_ASSOC));
        cod_ok(['rows' => $rows]);
    });
}

const COD_TRACKING_STATUS_RE = '/^[a-z_]{1,24}$/';

if ($action === 'tracking') {
    $idem = cod_idem($body['idem_key'] ?? '');
    $ga4 = preg_match(COD_TRACKING_STATUS_RE, (string)($body['ga4_status'] ?? '')) ? $body['ga4_status'] : null;
    $meta = preg_match(COD_TRACKING_STATUS_RE, (string)($body['meta_status'] ?? '')) ? $body['meta_status'] : null;
    cod_db($pdo, function ($pdo) use ($shop, $idem, $ga4, $meta) {
        $pdo->prepare('UPDATE cod_orders SET ga4_status = ?, meta_status = ? WHERE shop = ? AND idem_key = ?')
            ->execute([$ga4, $meta, $shop, $idem]);
        cod_ok();
    });
}

/**
 * Where a placed COD order stands, from Shopify's own order fields.
 * Cancellation and refunds win over delivery; "paid" on a COD order means the
 * merchant marked the cash as collected.
 */
function cod_lifecycle($o, $total) {
    if (!empty($o['cancelled_at'])) return 'cancelled';
    if ($o['financial_status'] === 'refunded') return 'refunded';
    if ($total !== null && $total > 0 && $o['refunded_total'] >= $total - 0.005) return 'refunded';
    if ($o['financial_status'] === 'paid') return 'paid';
    if ($o['shipment_status'] === 'delivered') return 'delivered';
    if ($o['shipment_status'] === 'failure') return 'rto';
    if ($o['fulfillment_status'] === 'fulfilled' || $o['fulfillment_status'] === 'partial') return 'shipped';
    return 'placed';
}

if ($action === 'sync') {
    $orderId = cod_str($body['order_id'] ?? '', 64);
    if (!preg_match('/^\d{1,20}$/', $orderId)) cod_fail(400, 'invalid_order_id', 'order_id must be a numeric Shopify order id');
    // Only fields present in the body are applied; a missing one keeps its stored
    // value (orders/paid, for example, may arrive without fulfillment details).
    $update = [];
    foreach (['financial_status', 'fulfillment_status', 'shipment_status'] as $key) {
        if (array_key_exists($key, $body)) $update[$key] = preg_match('/^[a-z_]{1,32}$/', (string)$body[$key]) ? $body[$key] : null;
    }
    if (array_key_exists('cancelled_at', $body)) {
        $ts = $body['cancelled_at'] ? strtotime((string)$body['cancelled_at']) : false;
        $update['cancelled_at'] = $ts ? gmdate('Y-m-d H:i:s', $ts) : null;
    }
    if (array_key_exists('refunded_total', $body)) $update['refunded_total'] = max(0, (float)cod_money($body['refunded_total']));
    cod_db($pdo, function ($pdo) use ($shop, $orderId, $update) {
        // Shopify stores order ids as gid://shopify/Order/<n>; cod_orders keeps the gid.
        // Locked so two webhooks for the same change (orders/cancelled + orders/updated)
        // can't both see the move into "cancelled" and both trigger a GA4 refund.
        $pdo->beginTransaction();
        $stmt = $pdo->prepare("SELECT * FROM cod_orders WHERE shop = ? AND order_id IN (?, ?) AND status = 'placed' LIMIT 1 FOR UPDATE");
        $stmt->execute([$shop, $orderId, 'gid://shopify/Order/' . $orderId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) { $pdo->commit(); cod_ok(['matched' => false]); }
        $merged = array_merge(
            array_intersect_key($row, array_flip(['financial_status', 'fulfillment_status', 'shipment_status', 'cancelled_at', 'refunded_total'])),
            $update
        );
        $merged['refunded_total'] = (float)($merged['refunded_total'] ?? 0);
        $total = $row['total'] === null ? null : (float)$row['total'];
        $lifecycle = cod_lifecycle($merged, $total);
        $pdo->prepare('UPDATE cod_orders SET lifecycle = ?, financial_status = ?, fulfillment_status = ?, shipment_status = ?, cancelled_at = ?, refunded_total = ? WHERE id = ?')
            ->execute([$lifecycle, $merged['financial_status'], $merged['fulfillment_status'], $merged['shipment_status'], $merged['cancelled_at'], $merged['refunded_total'], $row['id']]);
        $pdo->commit();
        cod_ok([
            'matched' => true,
            'previous' => $row['lifecycle'] ?? 'placed',
            'lifecycle' => $lifecycle,
            'idem_key' => $row['idem_key'],
            'order_id' => $row['order_id'],
            'order_name' => $row['order_name'],
            'total' => $total,
            'refunded_total' => $merged['refunded_total'],
            'currency' => $row['currency'],
        ]);
    });
}

cod_fail(400, 'invalid_action', 'Unknown action');
