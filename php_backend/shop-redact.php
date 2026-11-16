<?php
/**
 * POST /shop-redact.php  (internal secret; from webhooks.compliance.jsx)
 * Body: { shop_domain }
 * Shopify shop/redact (48 h after uninstall): delete the shop's data (gdpr_lib.php).
 */
require_once __DIR__ . '/gdpr_lib.php';
$body = gdpr_request();
require_once __DIR__ . '/config.php';

try {
    $deleted = gdpr_redact_shop($pdo, $body['shop_domain']);
    echo json_encode(['success' => true, 'deleted' => $deleted]);
} catch (Throwable $e) {
    error_log('[shop-redact] ' . $e->getMessage());
    gdpr_fail(500, 'Redaction failed');
}
