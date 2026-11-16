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
        trial_days  INT NOT NULL DEFAULT 14,
        expires_at  DATETIME NULL DEFAULT NULL,
        is_active   TINYINT(1) NOT NULL DEFAULT 1,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_code (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
");
// CREATE TABLE IF NOT EXISTS above is a no-op on a table that already
// existed before trial_days was added — mirrors promo-schema.server.js's
// same defensive column check on the Node side.
$existingCols = $pdo->query("SHOW COLUMNS FROM promo_codes")->fetchAll(PDO::FETCH_COLUMN);
if (!in_array('trial_days', $existingCols, true)) {
    $pdo->exec('ALTER TABLE promo_codes ADD COLUMN trial_days INT NOT NULL DEFAULT 14');
}

// Per-shop trial override ("Shop trials" below): the trial length one store
// gets instead of the standard 7 days, read by the Node plan page
// (getShopTrialDays in app/services/promo.server.js, which adds the same
// column). NULL = standard trial.
$shopCols = $pdo->query("SHOW COLUMNS FROM shops")->fetchAll(PDO::FETCH_COLUMN);
if (!in_array('trial_days_override', $shopCols, true)) {
    $pdo->exec('ALTER TABLE shops ADD COLUMN trial_days_override INT NULL DEFAULT NULL');
}

// Longest trial a shop override may set; mirrors MAX_SHOP_TRIAL_DAYS in app/config/plans.js.
const MAX_SHOP_TRIAL_DAYS = 365;

// "1fd597-3", "1fd597-3.myshopify.com", "https://1fd597-3.myshopify.com/" or
// "admin.shopify.com/store/1fd597-3" -> "1fd597-3.myshopify.com"; null if it
// isn't a store handle.
function normalize_shop_domain(string $input): ?string {
    $s = strtolower(trim($input));
    if (preg_match('~admin\.shopify\.com/store/([a-z0-9][a-z0-9-]*)~', $s, $m)) {
        $s = $m[1];
    }
    $s = preg_replace('~^https?://~', '', $s);
    $s = rtrim(explode('/', $s)[0], '.');
    if (strpos($s, '.') === false) {
        $s .= '.myshopify.com';
    }
    return preg_match('~^[a-z0-9][a-z0-9-]*\.myshopify\.com$~', $s) ? $s : null;
}

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
    $trialDays = trim($_POST['trial_days'] ?? '');
    $expiresAt = trim($_POST['expires_at'] ?? '');

    if ($code === '') {
        $flash = ['type' => 'error', 'text' => 'Code is required.'];
    } else {
        try {
            $stmt = $pdo->prepare('INSERT INTO promo_codes (code, max_uses, trial_days, expires_at) VALUES (?, ?, ?, ?)');
            $stmt->execute([
                $code,
                $maxUses === '' ? null : (int) $maxUses,
                $trialDays === '' ? 14 : (int) $trialDays,
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
} elseif ($isAuthed && ($_POST['action'] ?? null) === 'shop_trial') {
    $shopDomain = normalize_shop_domain($_POST['shop'] ?? '');
    $daysRaw = trim($_POST['trial_days'] ?? '');
    $days = $daysRaw === '' ? 0 : (int) $daysRaw;

    if ($shopDomain === null) {
        $flash = ['type' => 'error', 'text' => 'Enter a store like 1fd597-3 or 1fd597-3.myshopify.com.'];
    } elseif ($days < 0 || $days > MAX_SHOP_TRIAL_DAYS) {
        $flash = ['type' => 'error', 'text' => 'Trial days must be between 1 and ' . MAX_SHOP_TRIAL_DAYS . ' (0 or blank removes it).'];
    } else {
        // Same upsert redeemPromoCode uses, so a store not installed yet
        // still gets its trial when it installs and picks a plan.
        $stmt = $pdo->prepare(
            'INSERT INTO shops (shop_domain, trial_days_override, updated_at) VALUES (?, ?, NOW())
             ON DUPLICATE KEY UPDATE trial_days_override = VALUES(trial_days_override), updated_at = NOW()'
        );
        $stmt->execute([$shopDomain, $days > 0 ? $days : null]);
        $flash = ['type' => 'success', 'text' => $days > 0
            ? "$shopDomain now gets a $days-day trial on its next paid plan."
            : "$shopDomain is back on the standard trial."];
    }
} elseif ($isAuthed && ($_POST['action'] ?? null) === 'extend_trial') {
    $shopDomain = normalize_shop_domain($_POST['shop'] ?? '');
    $days = (int) trim($_POST['extra_days'] ?? '');

    if ($shopDomain === null) {
        $flash = ['type' => 'error', 'text' => 'Enter a store like 1fd597-3 or 1fd597-3.myshopify.com.'];
    } elseif ($days < 1 || $days > MAX_SHOP_TRIAL_DAYS) {
        $flash = ['type' => 'error', 'text' => 'Extra days must be between 1 and ' . MAX_SHOP_TRIAL_DAYS . '.'];
    } else {
        $result = extend_current_trial($shopDomain, $days);
        if (!empty($result['success'])) {
            $ends = !empty($result['trialEndsOn']) ? ' It now ends on ' . $result['trialEndsOn'] . '.' : '';
            $flash = ['type' => 'success', 'text' => "Added $days days to $shopDomain's trial on " . ($result['plan'] ?? 'its plan') . ".$ends"];
        } else {
            $flash = ['type' => 'error', 'text' => $result['error'] ?? 'Could not extend the trial.'];
        }
    }
}

// A running trial can only be changed through Shopify (appSubscriptionTrialExtend),
// and only the Node app holds the shop's access token, so this asks it to:
// app/routes/api.admin.trial-extend.jsx. BRIX_ADMIN_SECRET must be set on
// both servers (same value).
function extend_current_trial(string $shop, int $days): array {
    $secret = getenv('BRIX_ADMIN_SECRET') ?: '';
    if ($secret === '') {
        return ['success' => false, 'error' => 'BRIX_ADMIN_SECRET is not set on this server.'];
    }
    $appUrl = rtrim(getenv('BRIX_APP_URL') ?: 'https://cartdrawer.fly.dev', '/');
    $ch = curl_init($appUrl . '/api/admin/trial-extend');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode(['shop' => $shop, 'days' => $days]),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Accept: application/json',
            'X-Brix-Admin-Secret: ' . $secret,
            'ngrok-skip-browser-warning: 1',
        ],
    ]);
    $response = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    $json = is_string($response) ? json_decode($response, true) : null;
    if (!is_array($json)) {
        error_log("[promo_admin] trial extend for $shop: HTTP $status" . ($error ? " ($error)" : '') . ': ' . substr((string) $response, 0, 200));
        return ['success' => false, 'error' => "The app server did not answer (HTTP $status)."];
    }
    if ($status === 401) {
        return ['success' => false, 'error' => 'The app server refused the request: BRIX_ADMIN_SECRET differs between the two servers.'];
    }
    return $json;
}

$codes = $isAuthed ? $pdo->query('SELECT * FROM promo_codes ORDER BY created_at DESC')->fetchAll() : [];
$shopTrials = $isAuthed ? $pdo->query(
    'SELECT shop_domain, trial_days_override, plan_key, updated_at FROM shops
     WHERE trial_days_override IS NOT NULL ORDER BY updated_at DESC'
)->fetchAll() : [];
// Stores in a free trial right now (trial_ends_on / subscription_status are
// synced by update-subscription-status.php from the subscriptions webhook).
$inTrial = ($isAuthed && in_array('trial_ends_on', $shopCols, true) && in_array('subscription_status', $shopCols, true))
    ? $pdo->query(
        "SELECT shop_domain, plan_key, trial_ends_on FROM shops
         WHERE trial_ends_on >= CURDATE() AND LOWER(subscription_status) = 'active'
         ORDER BY trial_ends_on ASC"
    )->fetchAll()
    : [];
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
  .hint { font-size:13px; color:#6b7280; margin:0 0 14px; }
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
            <label>Trial days</label>
            <input type="number" name="trial_days" min="1" value="14" required>
            <label>Expires at (blank = never)</label>
            <input type="date" name="expires_at">
            <button type="submit">Create code</button>
        </form>
    </div>

    <div class="card">
        <table>
            <thead>
                <tr><th>Code</th><th>Uses</th><th>Trial</th><th>Expires</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
            <?php foreach ($codes as $c): ?>
                <tr>
                    <td><?= htmlspecialchars($c['code']) ?></td>
                    <td><?= (int) $c['uses_count'] ?> / <?= $c['max_uses'] !== null ? (int) $c['max_uses'] : 'Unlimited' ?></td>
                    <td><?= (int) $c['trial_days'] ?> days</td>
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
                <tr><td colspan="6">No promo codes yet.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>

    <h1>Shop Trials</h1>
    <div class="card">
        <p class="hint">Give one store its own trial length instead of the standard 7 days, without a promo code. It applies the next time the store picks a paid plan (monthly or yearly). A promo code the store redeems can only make it longer. Set 0 to remove it. For a store already in a trial, use Extend a Current Trial below.</p>
        <form method="POST">
            <input type="hidden" name="action" value="shop_trial">
            <label>Store</label>
            <input type="text" name="shop" placeholder="e.g. 1fd597-3 or 1fd597-3.myshopify.com" required>
            <label>Trial days</label>
            <input type="number" name="trial_days" min="0" max="<?= MAX_SHOP_TRIAL_DAYS ?>" value="14" required>
            <button type="submit">Save shop trial</button>
        </form>
    </div>

    <div class="card">
        <table>
            <thead>
                <tr><th>Store</th><th>Trial</th><th>Plan</th><th>Updated</th><th></th></tr>
            </thead>
            <tbody>
            <?php foreach ($shopTrials as $s): ?>
                <tr>
                    <td><?= htmlspecialchars($s['shop_domain']) ?></td>
                    <td><?= (int) $s['trial_days_override'] ?> days</td>
                    <td><?= htmlspecialchars($s['plan_key'] ?? '') ?></td>
                    <td><?= htmlspecialchars($s['updated_at'] ?? '') ?></td>
                    <td class="row-actions">
                        <form method="POST">
                            <input type="hidden" name="action" value="shop_trial">
                            <input type="hidden" name="shop" value="<?= htmlspecialchars($s['shop_domain']) ?>">
                            <input type="hidden" name="trial_days" value="0">
                            <button type="submit" class="secondary">Remove</button>
                        </form>
                    </td>
                </tr>
            <?php endforeach; ?>
            <?php if (!$shopTrials): ?>
                <tr><td colspan="5">No shop trials yet.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>

    <h1>Extend a Current Trial</h1>
    <div class="card">
        <p class="hint">For a store already in its free trial on a paid plan. Adds days to that trial in Shopify, so the merchant is billed later. Shopify only allows this while the trial is still running.</p>
        <form method="POST">
            <input type="hidden" name="action" value="extend_trial">
            <label>Store</label>
            <input type="text" name="shop" placeholder="e.g. 1fd597-3 or 1fd597-3.myshopify.com" required>
            <label>Extra days</label>
            <input type="number" name="extra_days" min="1" max="<?= MAX_SHOP_TRIAL_DAYS ?>" value="7" required>
            <button type="submit">Extend trial</button>
        </form>
    </div>

    <div class="card">
        <table>
            <thead>
                <tr><th>Store in trial</th><th>Plan</th><th>Trial ends</th><th></th></tr>
            </thead>
            <tbody>
            <?php foreach ($inTrial as $t): ?>
                <tr>
                    <td><?= htmlspecialchars($t['shop_domain']) ?></td>
                    <td><?= htmlspecialchars($t['plan_key'] ?? '') ?></td>
                    <td><?= htmlspecialchars($t['trial_ends_on'] ?? '') ?></td>
                    <td class="row-actions">
                        <form method="POST">
                            <input type="hidden" name="action" value="extend_trial">
                            <input type="hidden" name="shop" value="<?= htmlspecialchars($t['shop_domain']) ?>">
                            <input type="number" name="extra_days" min="1" max="<?= MAX_SHOP_TRIAL_DAYS ?>" value="7" style="width:70px;margin:0 6px 0 0;" required>
                            <button type="submit" class="secondary">Extend</button>
                        </form>
                    </td>
                </tr>
            <?php endforeach; ?>
            <?php if (!$inTrial): ?>
                <tr><td colspan="4">No store is in a trial right now.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>
<?php endif; ?>

</div>
</body>
</html>
