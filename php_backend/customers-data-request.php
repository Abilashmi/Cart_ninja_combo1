<?php
/**
 * POST /customers-data-request.php  (internal secret; from webhooks.compliance.jsx)
 * Body: { shop_domain, data_request_id, orders_count }
 * Shopify customers/data_request: recorded in gdpr_log (no customer id, email
 * or phone) so the BRIX team can send the merchant what BRIX holds.
 */
require_once __DIR__ . '/gdpr_lib.php';
$body = gdpr_request();
require_once __DIR__ . '/config.php';

try {
    $ref = preg_replace('/[^0-9A-Za-z_-]/', '', (string) ($body['data_request_id'] ?? ''));
    gdpr_log($pdo, 'customers/data_request', $body['shop_domain'], (int) ($body['orders_count'] ?? 0), 0, $ref !== '' ? substr($ref, 0, 64) : null);
    gdpr_clear_legacy_logs($pdo);
    echo json_encode(['success' => true]);
} catch (Throwable $e) {
    error_log('[customers-data-request] ' . $e->getMessage());
    gdpr_fail(500, 'Could not record the request');
}
