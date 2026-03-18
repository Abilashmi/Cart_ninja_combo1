<?php
require __DIR__ . '/config.php';

$tables = ['fbt_widget', 'posts'];

foreach ($tables as $table) {
    echo "TABLE:" . $table . PHP_EOL;

    try {
        $stmt = $pdo->query("SHOW COLUMNS FROM `{$table}`");
        foreach ($stmt as $row) {
            echo $row['Field'] . '|' . $row['Type'] . PHP_EOL;
        }
    } catch (PDOException $e) {
        echo 'ERROR|' . $e->getMessage() . PHP_EOL;
    }
}
