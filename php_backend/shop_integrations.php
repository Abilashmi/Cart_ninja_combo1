<?php
// Per-shop third-party integration switches, managed from the internal
// integrations_admin.php page (not by merchants). Currently one switch:
// shiprocket_enabled — tells the storefront cart drawer and combo pages to
// hand checkout to Shiprocket Checkout (Fastrr) instead of navigating to
// Shopify's /checkout. Off for every shop that has no row here.
//
// Callers provide their own $pdo (config.php) — this file only defines
// functions so it's safe to require from any endpoint.

function ensureShopIntegrationsTable($pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS shop_integrations (
            shop               VARCHAR(255) NOT NULL,
            shiprocket_enabled TINYINT(1) NOT NULL DEFAULT 0,
            created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (shop)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
}

// Accepts whatever an admin is likely to paste (full URL, trailing slash,
// mixed case) and returns the bare xxx.myshopify.com domain the rest of the
// backend keys on.
function normalizeShopDomain(string $shop): string {
    $shop = strtolower(trim($shop));
    $shop = preg_replace('#^https?://#', '', $shop);
    $shop = preg_replace('#/.*$#', '', $shop);
    return $shop;
}

// Storefront read path — must never break the cart drawer config response,
// so any failure (table not created yet, DB hiccup) reads as "off".
function shiprocketEnabledForShop($pdo, $shop): bool {
    try {
        $stmt = $pdo->prepare('SELECT shiprocket_enabled FROM shop_integrations WHERE shop = ? LIMIT 1');
        $stmt->execute([normalizeShopDomain((string) $shop)]);
        $row = $stmt->fetch();
        return $row ? (int) $row['shiprocket_enabled'] === 1 : false;
    } catch (Throwable $e) {
        return false;
    }
}
