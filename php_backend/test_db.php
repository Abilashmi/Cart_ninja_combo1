<?php
require_once __DIR__ . '/config.php';

try {
    $stmt = $pdo->query("SELECT DATABASE() AS db");
    $row = $stmt->fetch();

    $stmt2 = $pdo->query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME");
    $tables = $stmt2->fetchAll(PDO::FETCH_COLUMN);

    echo json_encode([
        "status"   => "ok",
        "database" => $row['db'],
        "tables"   => $tables,
    ], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    echo json_encode(["status" => "error", "message" => $e->getMessage()]);
}
?>
