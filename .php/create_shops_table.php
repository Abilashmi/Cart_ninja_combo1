<?php
require_once __DIR__ . '/config.php';

try {
    // SQL to create the shops table
    $sql = "
    CREATE TABLE IF NOT EXISTS `shops` (
        `id` int(11) NOT NULL AUTO_INCREMENT,
        `shop_domain` varchar(255) NOT NULL,
        `is_active` tinyint(1) DEFAULT 1,
        `plan_name` varchar(100) DEFAULT 'free',
        `created_at` timestamp NULL DEFAULT current_timestamp(),
        `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
        PRIMARY KEY (`id`),
        UNIQUE KEY `shop_domain_UNIQUE` (`shop_domain`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    ";

    // Execute the query
    $pdo->exec($sql);

    echo json_encode([
        "status" => "success",
        "message" => "Table 'shops' created successfully or already exists."
    ]);

}
catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        "status" => "error",
        "message" => "Failed to create table: " . $e->getMessage()
    ]);
}
?>
