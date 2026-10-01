<?php
// Internal-only admin page for switching per-shop integrations on/off —
// currently Shiprocket Checkout (see shop_integrations.php for what the
// switch does on the storefront). Same shared-password session gate as
// promo_admin.php (PROMO_ADMIN_PASSWORD), and the same session flag, so one
// login covers both pages.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/shop_integrations.php';
header('Content-Type: text/html; charset=utf-8');
header_remove('Access-Control-Allow-Origin'); // this is a browser-visited HTML page, not a fetch API endpoint

session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax', 'secure' => true]);
session_start();

ensureShopIntegrationsTable($pdo);

$adminPassword = getenv('PROMO_ADMIN_PASSWORD') ?: '';
$loginError = null;

if (isset($_GET['logout'])) {
    $_SESSION = [];
    session_destroy();
    header('Location: integrations_admin.php');
    exit;
}

if (($_POST['action'] ?? null) === 'login') {
    if ($adminPassword !== '' && hash_equals($adminPassword, $_POST['password'] ?? '')) {
        session_regenerate_id(true);
        $_SESSION['promo_admin_authed'] = true;
    } else {
        $loginError = 'Incorrect password.';
    }
}

// Fail closed if the env var was removed after this session was already
// authenticated — never trust a stale session over an absent secret.
$isAuthed = !empty($_SESSION['promo_admin_authed']) && $adminPassword !== '';

$flash = null;

if ($isAuthed && ($_POST['action'] ?? null) === 'add') {
    $shop = normalizeShopDomain($_POST['shop'] ?? '');

    if (!preg_match('/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/', $shop)) {
        $flash = ['type' => 'error', 'text' => 'Enter the shop as xxx.myshopify.com (the permanent domain, not the custom domain).'];
    } else {
        $stmt = $pdo->prepare('
            INSERT INTO shop_integrations (shop, shiprocket_enabled) VALUES (?, 1)
            ON DUPLICATE KEY UPDATE shiprocket_enabled = 1
        ');
        $stmt->execute([$shop]);
        $flash = ['type' => 'success', 'text' => "Shiprocket checkout enabled for $shop."];
    }
} elseif ($isAuthed && ($_POST['action'] ?? null) === 'toggle') {
    $shop = normalizeShopDomain($_POST['shop'] ?? '');
    $pdo->prepare('UPDATE shop_integrations SET shiprocket_enabled = NOT shiprocket_enabled WHERE shop = ?')->execute([$shop]);
    $flash = ['type' => 'success', 'text' => 'Updated.'];
}

$shops = $isAuthed ? $pdo->query('SELECT * FROM shop_integrations ORDER BY updated_at DESC')->fetchAll() : [];
?>
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<title>Shop Integrations</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#f5f5f5; margin:0; padding:40px 20px; color:#1a1a1a; }
  .wrap { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 20px; margin-bottom: 24px; }
  .card { background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:24px; margin-bottom:20px; }
  label { display:block; font-size:13px; font-weight:600; margin-bottom:4px; }
  input { width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid #d1d5db; border-radius:6px; font-size:14px; margin-bottom:14px; }
  button { background:#1a1a1a; color:#fff; border:none; border-radius:6px; padding:9px 18px; font-size:14px; font-weight:600; cursor:pointer; }
  button.secondary { background:#f3f4f6; color:#1a1a1a; border:1px solid #d1d5db; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:8px 6px; border-bottom:1px solid #e5e7eb; }
  .flash { padding:10px 14px; border-radius:6px; margin-bottom:16px; font-size:14px; }
  .flash.success { background:#ecfdf3; color:#027a48; }
  .flash.error { background:#fef3f2; color:#b42318; }
  .badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:700; }
  .badge.active { background:#ecfdf3; color:#027a48; }
  .badge.inactive { background:#f3f4f6; color:#6b7280; }
  .row-actions form { display:inline; }
  .hint { font-size:12px; color:#6b7280; margin:-8px 0 14px; }
  a.logout { float:right; font-size:13px; color:#6b7280; }
</style>
</head>
<body>
<div class="wrap">

<?php if (!$isAuthed): ?>
    <h1>Shop Integrations &mdash; Login</h1>
    <?php if ($loginError): ?><div class="flash error"><?= htmlspecialchars($loginError) ?></div><?php endif; ?>
    <div class="card">
        <form method="POST">
            <input type="hidden" name="action" value="login">
            <label>Password</label>
            <input type="password" name="password" autofocus required>
            <button type="submit">Log in</button>
        </form>
    </div>
<?php else: ?>
    <h1>Shop Integrations <a class="logout" href="?logout=1">Log out</a></h1>

    <?php if ($flash): ?><div class="flash <?= $flash['type'] ?>"><?= htmlspecialchars($flash['text']) ?></div><?php endif; ?>

    <div class="card">
        <form method="POST">
            <input type="hidden" name="action" value="add">
            <label>Enable Shiprocket checkout for shop</label>
            <input type="text" name="shop" placeholder="e.g. client-store.myshopify.com" required>
            <p class="hint">Only for shops that already have Shiprocket Checkout installed in their theme. The cart drawer and combo pages then open Shiprocket's checkout instead of Shopify's.</p>
            <button type="submit">Enable</button>
        </form>
    </div>

    <div class="card">
        <table>
            <thead>
                <tr><th>Shop</th><th>Shiprocket checkout</th><th>Updated</th><th></th></tr>
            </thead>
            <tbody>
            <?php foreach ($shops as $s): ?>
                <tr>
                    <td><?= htmlspecialchars($s['shop']) ?></td>
                    <td><span class="badge <?= $s['shiprocket_enabled'] ? 'active' : 'inactive' ?>"><?= $s['shiprocket_enabled'] ? 'On' : 'Off' ?></span></td>
                    <td><?= htmlspecialchars($s['updated_at']) ?></td>
                    <td class="row-actions">
                        <form method="POST">
                            <input type="hidden" name="action" value="toggle">
                            <input type="hidden" name="shop" value="<?= htmlspecialchars($s['shop']) ?>">
                            <button type="submit" class="secondary"><?= $s['shiprocket_enabled'] ? 'Turn off' : 'Turn on' ?></button>
                        </form>
                    </td>
                </tr>
            <?php endforeach; ?>
            <?php if (!$shops): ?>
                <tr><td colspan="4">No shops yet.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>
<?php endif; ?>

</div>
</body>
</html>
