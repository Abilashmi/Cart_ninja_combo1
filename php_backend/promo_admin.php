<?php
// Internal-only admin page for creating/managing the promo codes redeemed
// on the Node app's /app/subscribe page (see app/services/promo.server.js
// on the Node side — this table is the shared source of truth both sides
// read). Session-gated by a single shared password (PROMO_ADMIN_PASSWORD
// env var, set via .htaccess on Hostinger) rather than per-user accounts,
// matching this backend's existing shared-secret pattern (db_proxy.php's
// X-Forge-Secret).

require_once __DIR__ . '/config.php';
header('Content-Type: text/html; charset=utf-8');
header_remove('Access-Control-Allow-Origin'); // this is a browser-visited HTML page, not a fetch API endpoint

session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax', 'secure' => true]);
session_start();

$pdo->exec("
    CREATE TABLE IF NOT EXISTS promo_codes (
        id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        code        VARCHAR(64) NOT NULL,
        max_uses    INT NULL DEFAULT NULL,
        uses_count  INT NOT NULL DEFAULT 0,
        expires_at  DATETIME NULL DEFAULT NULL,
        is_active   TINYINT(1) NOT NULL DEFAULT 1,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_code (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
");

$adminPassword = getenv('PROMO_ADMIN_PASSWORD') ?: '';
$loginError = null;

if (isset($_GET['logout'])) {
    $_SESSION = [];
    session_destroy();
    header('Location: promo_admin.php');
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

if ($isAuthed && ($_POST['action'] ?? null) === 'create') {
    $code = trim($_POST['code'] ?? '');
    $maxUses = trim($_POST['max_uses'] ?? '');
    $expiresAt = trim($_POST['expires_at'] ?? '');

    if ($code === '') {
        $flash = ['type' => 'error', 'text' => 'Code is required.'];
    } else {
        try {
            $stmt = $pdo->prepare('INSERT INTO promo_codes (code, max_uses, expires_at) VALUES (?, ?, ?)');
            $stmt->execute([
                $code,
                $maxUses === '' ? null : (int) $maxUses,
                // The date input submits a bare YYYY-MM-DD with no time,
                // which MySQL stores as midnight — meaning a code expiring
                // "today" would already be dead on arrival the moment it's
                // created. Appending end-of-day makes the picked date mean
                // "valid through the end of that day," matching what an
                // admin actually intends when picking an expiry date.
                $expiresAt === '' ? null : $expiresAt . ' 23:59:59',
            ]);
            $flash = ['type' => 'success', 'text' => "Promo code \"$code\" created."];
        } catch (PDOException $e) {
            $isDuplicate = strpos($e->getMessage(), 'Duplicate') !== false;
            $flash = ['type' => 'error', 'text' => $isDuplicate ? "A code named \"$code\" already exists." : 'Failed to create code.'];
        }
    }
} elseif ($isAuthed && ($_POST['action'] ?? null) === 'toggle') {
    $id = (int) ($_POST['id'] ?? 0);
    $pdo->prepare('UPDATE promo_codes SET is_active = NOT is_active WHERE id = ?')->execute([$id]);
    $flash = ['type' => 'success', 'text' => 'Updated.'];
}

$codes = $isAuthed ? $pdo->query('SELECT * FROM promo_codes ORDER BY created_at DESC')->fetchAll() : [];
?>
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<title>Promo Codes</title>
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
  a.logout { float:right; font-size:13px; color:#6b7280; }
</style>
</head>
<body>
<div class="wrap">

<?php if (!$isAuthed): ?>
    <h1>Promo Codes &mdash; Login</h1>
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
    <h1>Promo Codes <a class="logout" href="?logout=1">Log out</a></h1>

    <?php if ($flash): ?><div class="flash <?= $flash['type'] ?>"><?= htmlspecialchars($flash['text']) ?></div><?php endif; ?>

    <div class="card">
        <form method="POST">
            <input type="hidden" name="action" value="create">
            <label>Code</label>
            <input type="text" name="code" placeholder="e.g. WELCOME1" required>
            <label>Max uses (blank = unlimited)</label>
            <input type="number" name="max_uses" min="1" placeholder="e.g. 1">
            <label>Expires at (blank = never)</label>
            <input type="date" name="expires_at">
            <button type="submit">Create code</button>
        </form>
    </div>

    <div class="card">
        <table>
            <thead>
                <tr><th>Code</th><th>Uses</th><th>Expires</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
            <?php foreach ($codes as $c): ?>
                <tr>
                    <td><?= htmlspecialchars($c['code']) ?></td>
                    <td><?= (int) $c['uses_count'] ?> / <?= $c['max_uses'] !== null ? (int) $c['max_uses'] : 'Unlimited' ?></td>
                    <td><?= $c['expires_at'] ? htmlspecialchars($c['expires_at']) : 'Never' ?></td>
                    <td><span class="badge <?= $c['is_active'] ? 'active' : 'inactive' ?>"><?= $c['is_active'] ? 'Active' : 'Inactive' ?></span></td>
                    <td class="row-actions">
                        <form method="POST">
                            <input type="hidden" name="action" value="toggle">
                            <input type="hidden" name="id" value="<?= (int) $c['id'] ?>">
                            <button type="submit" class="secondary"><?= $c['is_active'] ? 'Deactivate' : 'Activate' ?></button>
                        </form>
                    </td>
                </tr>
            <?php endforeach; ?>
            <?php if (!$codes): ?>
                <tr><td colspan="5">No promo codes yet.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>
<?php endif; ?>

</div>
</body>
</html>
