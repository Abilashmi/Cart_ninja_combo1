<?php
require_once __DIR__ . '/config.php';
$res = $conn->query("SELECT * FROM cart_click_events LIMIT 5;");
$rows = [];
while($row = $res->fetch_assoc()) {
    $rows[] = $row;
}
echo json_encode($rows, JSON_PRETTY_PRINT);
?>
