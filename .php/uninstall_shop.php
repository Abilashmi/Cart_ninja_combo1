<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// Database Connection
$host = 'localhost'; // Update with actual DB host
$db   = 'u741492582_coupons'; // Update with actual DB name
$user = 'u741492582_coupons'; // Update with actual DB username
$pass = 'Digi2025#cart'; // Update with actual DB password
$charset = 'utf8mb4';

$dsn = "mysql:host=$host;dbname=$db;charset=$charset";
$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
];

try {
    $pdo = new PDO($dsn, $user, $pass, $options);
} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed']);
    exit;
}

// Get JSON Input
$input = json_decode(file_get_contents('php://input'), true);
$shop = $input['shop'] ?? null;

if (!$shop) {
    http_response_code(400);
    echo json_encode(['error' => 'Shop parameter is required']);
    exit;
}

try {
    // 1. Mark the shop as inactive in the shops table
    $stmt = $pdo->prepare("UPDATE shops SET is_active = 0, updated_at = NOW() WHERE shop_domain = :shop_domain");
    $stmt->execute([':shop_domain' => $shop]);
    
    // Optional (If relevant for your app logic): Deactivate cart drawer, coupons, etc. 
    // $stmt = $pdo->prepare("UPDATE cart_drawer SET cartStatus = 0 WHERE shop = :shop");
    // $stmt->execute([':shop' => $shop]);

    echo json_encode(['success' => true, 'message' => "Shop $shop marked inactive"]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to process uninstallation: ' . $e->getMessage()]);
}
?>
