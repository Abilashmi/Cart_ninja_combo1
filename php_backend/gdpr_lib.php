<?php
/**
 * Shopify's mandatory privacy webhooks, done for real. Called only by the
 * BRIX app on Fly (app/routes/webhooks.compliance.jsx), never by browsers:
 * customers-redact.php, shop-redact.php and customers-data-request.php all
 * require the internal secret (internal_auth.php).
 *
 * customers/redact: anonymise what BRIX holds about that shopper.
 *   - cod_orders: the rows for that phone (Node sends the same HMAC phone hash
 *     cod.server.js stores) or for the listed orders lose the name, PIN code,
 *     masked phone, phone hash and Shopify order references. Totals, dates
 *     and statuses stay, so the merchant's COD stats still add up.
 *   - cod_otp: that phone's codes are deleted.
 *   - partial_cod_orders: the listed orders lose name, PIN code and order refs.
 *   - store_orders / store_order_line_items / store_order_events: the listed
 *     orders get a random id instead of the Shopify order id, and no order
 *     number. Revenue and product analytics are unchanged.
 *   (customer_addresses is handled by Node, which holds its key.)
 * shop/redact (48 h after uninstall): every row for that shop, in every table
 *   with a shop column (found from the schema, so new tables are covered),
 *   plus child rows of the shop's AI and support chats. Kept: the billing
 *   records (order_overage_charges, ai_brix_overage_charges: accounting),
 *   addresses shoppers saved with BRIX themselves (customer_addresses scope
 *   'brix'), and gdpr_log.
 * gdpr_log records that a request was done: topic, shop, how many orders and
 * rows. Never the customer's id, email or phone.
 */

const GDPR_SHOP_COLUMNS = ['shop', 'shop_domain', 'shopDomain', 'domain'];
const GDPR_KEEP_ON_SHOP_REDACT = ['gdpr_log', 'order_overage_charges', 'ai_brix_overage_charges', '_prisma_migrations'];

function gdpr_valid_shop($shop) {
    return is_string($shop) && preg_match('/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/', $shop) === 1;
}

/** Numeric Shopify order ids (also accepts gid://shopify/Order/123), unique, at most 1000. */
function gdpr_order_ids($list) {
    $ids = [];
    foreach ((array) $list as $value) {
        if (preg_match('/^(?:gid:\/\/shopify\/Order\/)?(\d{1,20})$/', (string) $value, $m)) $ids[$m[1]] = true;
        if (count($ids) >= 1000) break;
    }
    return array_keys($ids);
}

function gdpr_table_exists(PDO $pdo, $table) {
    $stmt = $pdo->prepare('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?');
    $stmt->execute([$table]);
    return (bool) $stmt->fetchColumn();
}

function gdpr_ensure_log(PDO $pdo) {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS gdpr_log (
            id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            topic        VARCHAR(32)  NOT NULL,
            shop_domain  VARCHAR(255) NOT NULL,
            request_ref  VARCHAR(64)  NULL,
            orders_count INT UNSIGNED NOT NULL DEFAULT 0,
            rows_changed INT UNSIGNED NOT NULL DEFAULT 0,
            created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_gdpr_log_shop (shop_domain, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
}

function gdpr_log(PDO $pdo, $topic, $shop, $ordersCount, $rowsChanged, $requestRef = null) {
    gdpr_ensure_log($pdo);
    $stmt = $pdo->prepare('INSERT INTO gdpr_log (topic, shop_domain, request_ref, orders_count, rows_changed) VALUES (?, ?, ?, ?, ?)');
    $stmt->execute([$topic, $shop, $requestRef, (int) $ordersCount, (int) $rowsChanged]);
}

// The old handlers kept the redacted customer's email in plain text; clear it wherever it is.
function gdpr_clear_legacy_logs(PDO $pdo) {
    $n = 0;
    foreach (['gdpr_redactions', 'gdpr_data_requests'] as $table) {
        if (!gdpr_table_exists($pdo, $table)) continue;
        $cols = $pdo->query("SHOW COLUMNS FROM `$table`")->fetchAll(PDO::FETCH_COLUMN);
        if (in_array('customer_email', $cols, true)) $n += $pdo->exec("UPDATE `$table` SET customer_email = NULL WHERE customer_email IS NOT NULL");
    }
    return $n;
}

function gdpr_placeholders(array $values) {
    return implode(', ', array_fill(0, count($values), '?'));
}

/**
 * @param string $phoneHash cod.server.js phoneHash(shop, phone) of the customer's phone, or ''
 * @param array  $orderIds  orders_to_redact (numeric ids)
 * @return array rows changed per table
 */
function gdpr_redact_customer(PDO $pdo, $shop, $phoneHash, array $orderIds) {
    $orderIds = gdpr_order_ids($orderIds);
    $phoneHash = (is_string($phoneHash) && preg_match('/^[0-9a-f]{64}$/', $phoneHash)) ? $phoneHash : '';
    // Orders are stored as numeric ids or as gids, depending on the table and its age.
    $orderKeys = [];
    foreach ($orderIds as $id) { $orderKeys[] = $id; $orderKeys[] = 'gid://shopify/Order/' . $id; }
    $changed = [];

    $pdo->beginTransaction();
    try {
        if (gdpr_table_exists($pdo, 'cod_orders') && ($phoneHash !== '' || $orderKeys)) {
            $where = [];
            $params = [$shop];
            if ($phoneHash !== '') { $where[] = 'phone_hash = ?'; $params[] = $phoneHash; }
            if ($orderKeys) { $where[] = 'order_id IN (' . gdpr_placeholders($orderKeys) . ')'; array_push($params, ...$orderKeys); }
            $stmt = $pdo->prepare(
                "UPDATE cod_orders SET customer_name = NULL, pincode = NULL, phone_masked = '',
                    phone_hash = SHA2(CONCAT('redacted:', id, ':', UUID()), 256),
                    order_id = NULL, order_name = NULL, draft_order_id = NULL
                 WHERE shop = ? AND (" . implode(' OR ', $where) . ')'
            );
            $stmt->execute($params);
            $changed['cod_orders'] = $stmt->rowCount();
        }
        if ($phoneHash !== '' && gdpr_table_exists($pdo, 'cod_otp')) {
            $stmt = $pdo->prepare('DELETE FROM cod_otp WHERE shop = ? AND phone_hash = ?');
            $stmt->execute([$shop, $phoneHash]);
            $changed['cod_otp'] = $stmt->rowCount();
        }
        if ($orderKeys && gdpr_table_exists($pdo, 'partial_cod_orders')) {
            $stmt = $pdo->prepare(
                'UPDATE partial_cod_orders SET customer_name = NULL, pincode = NULL, order_id = NULL, order_name = NULL
                 WHERE shop = ? AND order_id IN (' . gdpr_placeholders($orderKeys) . ')'
            );
            $stmt->execute(array_merge([$shop], $orderKeys));
            $changed['partial_cod_orders'] = $stmt->rowCount();
        }
        // Analytics: same random id in all three tables, so an order's lines still belong to it.
        $orderTables = array_values(array_filter(['store_orders', 'store_order_line_items', 'store_order_events'], function ($t) use ($pdo) { return gdpr_table_exists($pdo, $t); }));
        foreach ($orderIds as $id) {
            $anon = 'redacted-' . bin2hex(random_bytes(12));
            foreach ($orderTables as $table) {
                $set = $table === 'store_orders' ? 'order_id = ?, order_number = NULL' : 'order_id = ?';
                $stmt = $pdo->prepare("UPDATE `$table` SET $set WHERE shop_domain = ? AND order_id IN (?, ?)");
                $stmt->execute([$anon, $shop, $id, 'gid://shopify/Order/' . $id]);
                $changed[$table] = ($changed[$table] ?? 0) + $stmt->rowCount();
            }
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    $changed['legacy_emails_cleared'] = gdpr_clear_legacy_logs($pdo);
    gdpr_log($pdo, 'customers/redact', $shop, count($orderIds), array_sum($changed));
    return $changed;
}

/** @return array rows deleted per table */
function gdpr_redact_shop(PDO $pdo, $shop) {
    $deleted = [];
    // Child rows that only point at a parent row of this shop.
    $children = [
        ['ai_messages', 'conversationId', 'ai_conversations', 'shopDomain'],
        ['ai_actions', 'conversationId', 'ai_conversations', 'shopDomain'],
        ['support_chat_messages', 'conversation_id', 'support_chat_conversations', 'shop'],
    ];
    foreach ($children as [$child, $fk, $parent, $col]) {
        if (!gdpr_table_exists($pdo, $child) || !gdpr_table_exists($pdo, $parent)) continue;
        $stmt = $pdo->prepare("DELETE FROM `$child` WHERE `$fk` IN (SELECT id FROM `$parent` WHERE `$col` = ?)");
        $stmt->execute([$shop]);
        $deleted[$child] = $stmt->rowCount();
    }
    $marks = gdpr_placeholders(GDPR_SHOP_COLUMNS);
    $stmt = $pdo->prepare("SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME IN ($marks) ORDER BY TABLE_NAME");
    $stmt->execute(GDPR_SHOP_COLUMNS);
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $table = $row['TABLE_NAME'];
        $col = $row['COLUMN_NAME'];
        if (in_array($table, GDPR_KEEP_ON_SHOP_REDACT, true)) continue;
        if (!preg_match('/^[A-Za-z0-9_]+$/', $table) || !preg_match('/^[A-Za-z0-9_]+$/', $col)) continue;
        $extra = $table === 'customer_addresses' ? " AND scope = 'store'" : '';
        $del = $pdo->prepare("DELETE FROM `$table` WHERE `$col` = ?$extra");
        $del->execute([$shop]);
        $deleted[$table] = ($deleted[$table] ?? 0) + $del->rowCount();
    }
    gdpr_clear_legacy_logs($pdo);
    gdpr_log($pdo, 'shop/redact', $shop, 0, array_sum($deleted));
    return $deleted;
}

/** Shared request handling for the three endpoints: POST, internal secret, JSON body with a valid shop. */
function gdpr_request() {
    header('Content-Type: application/json');
    require_once __DIR__ . '/internal_auth.php';
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') gdpr_fail(405, 'POST only');
    if (!brix_internal_request_ok()) gdpr_fail(403, 'Forbidden');
    $body = json_decode(file_get_contents('php://input') ?: '{}', true);
    if (!is_array($body)) gdpr_fail(400, 'Invalid JSON');
    $shop = strtolower(trim((string) ($body['shop_domain'] ?? '')));
    if (!gdpr_valid_shop($shop)) gdpr_fail(400, 'A valid shop_domain is required');
    $body['shop_domain'] = $shop;
    return $body;
}

function gdpr_fail($status, $error) {
    http_response_code($status);
    echo json_encode(['success' => false, 'error' => $error]);
    exit;
}
