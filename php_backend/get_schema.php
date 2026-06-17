<?php
// get_schema.php
require_once __DIR__ . '/config.php';

$conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
if ($conn->connect_error) {
    die(json_encode(["error" => "Connection failed: " . $conn->connect_error]));
}

header('Content-Type: application/json');

$res = $conn->query("SHOW TABLES");
$tables = [];
while($r = $res->fetch_array()) {
    $table = $r[0];
    $desc = $conn->query("DESCRIBE `$table`");
    $columns = [];
    while($c = $desc->fetch_assoc()) {
        $columns[] = $c;
    }
    $tables[$table] = $columns;
}

echo json_encode(["tables" => $tables]);
?>
