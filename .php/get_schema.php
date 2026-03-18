<?php
// get_schema.php
// Please replace these with your actual Hostinger database credentials!
$host = "localhost";
$user = "u218702675_cartdrawer"; 
$pass = "Digi2025#cart";
$db   = "u218702675_cartdrawer";

$conn = new mysqli($host, $user, $pass, $db);
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
