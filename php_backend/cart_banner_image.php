<?php
require_once __DIR__ . '/config.php';

/**
 * BRIX Cart Drawer "Cart Image Banner": serves an image the merchant uploaded
 * in BRIX (stored as a data URL in cart_drawer_config.banner_desktop_image /
 * banner_mobile_image) as a real image file, so the storefront never has to
 * download it inside the drawer's settings JSON.
 *
 *   GET ?shop=<shop>.myshopify.com&slot=desktop|mobile&v=<hash>
 *
 * save_cart_drawer.php builds these URLs with v = the image's hash, so a URL
 * always points at one exact image and can be cached for a year. An https
 * image URL (not uploaded) is redirected to. Public and read-only, like the
 * drawer settings themselves.
 */

function cbi_fail($status) {
    http_response_code($status);
    header('Cache-Control: no-store');
    header('Content-Type: text/plain; charset=utf-8');
    echo $status === 404 ? 'Not found' : 'Bad request';
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') cbi_fail(400);

$shop = strtolower(trim((string)($_GET['shop'] ?? '')));
$slot = (string)($_GET['slot'] ?? '');
if (!preg_match('/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/', $shop)) cbi_fail(400);
if (!in_array($slot, ['desktop', 'mobile'], true)) cbi_fail(400);
$column = $slot === 'mobile' ? 'banner_mobile_image' : 'banner_desktop_image';

try {
    $stmt = $pdo->prepare("SELECT $column AS img FROM cart_drawer_config WHERE shop_domain = ? LIMIT 1");
    $stmt->execute([$shop]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
} catch (Throwable $e) {
    error_log('[cart_banner_image] ' . $e->getMessage()); // column not created yet, DB hiccup
    cbi_fail(404);
}
$value = (string)($row['img'] ?? '');
if ($value === '') cbi_fail(404);

if (preg_match('#^https://[^\s"\'<>()\\\\]{1,1000}$#', $value)) {
    header('Cache-Control: public, max-age=300');
    header('Location: ' . $value, true, 302);
    exit;
}

if (!preg_match('#^data:image/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$#', $value, $m)) cbi_fail(404);
$bytes = base64_decode($m[2], true);
if ($bytes === false || $bytes === '') cbi_fail(404);

// A request for an older version (stale v) still gets the current image, but
// only briefly cached, so the browser picks up the new URL soon.
$current = substr(md5($value), 0, 12) === (string)($_GET['v'] ?? '');
header('Content-Type: image/' . $m[1]);
header('Content-Length: ' . strlen($bytes));
header('X-Content-Type-Options: nosniff');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: ' . ($current ? 'public, max-age=31536000, immutable' : 'public, max-age=300'));
echo $bytes;
