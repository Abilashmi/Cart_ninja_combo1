<?php

/* ---------- CORS HEADERS ---------- */
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

/* Handle preflight request */
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

/* ---------- LOGIC ---------- */

// Folder where logs will be stored
$logDir = __DIR__ . '/webhook4_logs';

if (!is_dir($logDir)) {
    mkdir($logDir, 0755, true);
}

// Get raw JSON
$rawData = file_get_contents("php://input");

// Decode JSON (optional)
$jsonData = json_decode($rawData, true);

// File name
$timestamp = date("Y-m-d_H-i-s");
$filename = $logDir . "/webhook4_" . $timestamp . ".json";

// Log data
$logData = [
    "time" => date("Y-m-d H:i:s"),
    "ip" => $_SERVER['REMOTE_ADDR'] ?? '',
    "method" => $_SERVER['REQUEST_METHOD'],
    "headers" => getallheaders(),
    "payload" => $jsonData ?: $rawData
];

// Save log
file_put_contents(
    $filename,
    json_encode($logData, JSON_PRETTY_PRINT)
);

// Response
http_response_code(200);
echo json_encode([
    "status" => "received"
]);
