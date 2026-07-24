<?php
// ===== CORS & HEADERS =====
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}
// ===== ERROR REPORTING =====
ini_set('display_errors', 0);
ini_set('display_startup_errors', 0);
error_reporting(E_ALL);

// ===== DATABASE CONFIG =====
define('DB_HOST',    'localhost');
define('DB_NAME',    'cart_drawer_ninja');
define('DB_USER',    'root');
define('DB_PASS',    '');
define('DB_CHARSET', 'utf8mb4');

// ===== PDO CONNECTION =====
$dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=" . DB_CHARSET;

$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
    // Reuses one MySQL connection per PHP-FPM worker instead of opening a
    // fresh one on every request — the remote (Hostinger) MySQL host has a
    // low max_connections ceiling, and this app's save flow fires several
    // parallel requests per action (see CLAUDE.md's Cart Editor save flow),
    // which was tripping that ceiling and surfacing as "DB Connection Failed".
    PDO::ATTR_PERSISTENT         => true,
];

try {
    $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "DB Connection Failed"]);
    exit;
}