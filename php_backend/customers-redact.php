<?php
/**
 * POST /customers-redact.php  (internal secret; from webhooks.compliance.jsx)
 * Body: { shop_domain, cod_phone_hash, orders_to_redact: [ids] }
 * Shopify customers/redact: anonymise this shopper's data (gdpr_lib.php).
 */
require_once __DIR__ . '/gdpr_lib.php';
$body = gdpr_request();
require_once __DIR__ . '/config.php';

try {
    $changed = gdpr_redact_customer($pdo, $body['shop_domain'], (string) ($body['cod_phone_hash'] ?? ''), (array) ($body['orders_to_redact'] ?? []));
    echo json_encode(['success' => true, 'changed' => $changed]);
} catch (Throwable $e) {
    error_log('[customers-redact] ' . $e->getMessage());
    gdpr_fail(500, 'Redaction failed');
}
