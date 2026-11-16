<?php
/**
 * POST /shop-redact.php  (internal secret; from webhooks.compliance.jsx)
 * Body: { shop_domain }
 * Shopify shop/redact (48 h after uninstall): order stats made anonymous, the rest of the shop's data deleted (gdpr_lib.php).
 */
require_once __DIR__ . '/gdpr_lib.php';
$body = gdpr_request();
require_once __DIR__ . '/config.php';

try {
    $result = gdpr_redact_shop($pdo, $body['shop_domain']);
    echo json_encode(['success' => true, 'anonymised' => $result['anonymised'], 'deleted' => $result['deleted']]);
} catch (Throwable $e) {
    error_log('[shop-redact] ' . $e->getMessage());
    gdpr_fail(500, 'Redaction failed');
}
