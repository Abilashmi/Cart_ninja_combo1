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
$db   = 'u218702675_cartdrawer'; // Update with actual DB name
$user = 'u218702675_cartdrawer'; // Update with actual DB username
$pass = 'Digi2025#cart'; // Update with actual DB password, based on get_schema.php
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
    echo json_encode(['error' => 'Database connection failed: ' . $e->getMessage()]);
    exit;
}

// Get JSON Input
$input = json_decode(file_get_contents('php://input'), true);

$shop = $input['shop'] ?? null;
$accessToken = $input['accessToken'] ?? null;

if (!$shop) {
    http_response_code(400);
    echo json_encode(['error' => 'Shop parameter is required']);
    exit;
}

try {
    // Insert or update the shop
    $stmt = $pdo->prepare("
        INSERT INTO shops (shop_domain, access_token, is_active, created_at, updated_at) 
        VALUES (:shop_domain, :access_token, 1, NOW(), NOW())
        ON DUPLICATE KEY UPDATE 
            access_token = VALUES(access_token),
            is_active = 1,
            updated_at = NOW()
    ");

    $stmt->execute([
        ':shop_domain' => $shop,
        ':access_token' => $accessToken
    ]);
    
    // Send data to shop_logger.php
    $logData = [
        'shop' => $shop,
        'action' => 'shop_installed',
        'details' => 'Shop has been successfully installed and registered in the database.'
    ];

    $ch = curl_init('https://blueviolet-clam-512487.hostingersite.com/shop_logger.php');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($logData));
    curl_setopt($ch, CURLOPT_HTTPHEADER, array('Content-Type: application/json'));
    // Execute but we don't necessarily need to wait for or check the response
    curl_exec($ch);
    curl_close($ch);

    echo json_encode(['success' => true, 'message' => 'Shop installed and marked active']);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to install shop: ' . $e->getMessage()]);
}
?>
