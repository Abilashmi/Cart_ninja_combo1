<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// Get JSON Input
$input = json_decode(file_get_contents('php://input'), true);

$shop = $input['shop'] ?? 'unknown_shop';
$action = $input['action'] ?? 'log';
$details = $input['details'] ?? null;

// Determine log directory and file
$logDir = __DIR__ . '/logs';
if (!is_dir($logDir)) {
    mkdir($logDir, 0755, true);
}
$logFile = $logDir . '/shop_handle_error.log';

// Format the log entry as JSON to match your other logs
$timestamp = date('Y-m-d H:i:s');
$logData = [
    'timestamp' => $timestamp,
    'message' => "Shop Action: $action",
    'context' => [
        'shop' => $shop,
        'details' => $details
    ]
];

// Format as a nicely indented JSON block, followed by ---
$logString = json_encode($logData, JSON_PRETTY_PRINT) . PHP_EOL . "---" . PHP_EOL;

// Append to file
if (file_put_contents($logFile, $logString, FILE_APPEND | LOCK_EX) !== false) {
    echo json_encode(['success' => true, 'message' => 'Log successfully written to shop_handle_error.log']);
} else {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to write to log file']);
}
?>
