<?php
require_once __DIR__ . '/config.php';

function normalizeAiProductCount($value) {
    if ($value === null || $value === '') {
        return null;
    }

    if (is_bool($value)) {
        return $value ? 1 : 0;
    }

    if (is_numeric($value)) {
        $count = (int)$value;
        return $count < 0 ? 0 : $count;
    }

    if (is_string($value)) {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return null;
        }

        if (is_numeric($trimmed)) {
            $count = (int)$trimmed;
            return $count < 0 ? 0 : $count;
        }
    }

    return null;
}

function extractAiProductCount($payload, $fbt) {
    $keys = ['aiProductCount', 'ai_product_count', 'aiProductsCount', 'aiProductLimit', 'productCount'];

    foreach ($keys as $key) {
        if (is_array($fbt) && array_key_exists($key, $fbt)) {
            return normalizeAiProductCount($fbt[$key]);
        }
    }

    foreach ($keys as $key) {
        if (is_array($payload) && array_key_exists($key, $payload)) {
            return normalizeAiProductCount($payload[$key]);
        }
    }

    return null;
}

function detectAiProductCountColumn($pdo) {
    static $resolvedColumn = null;
    static $wasResolved = false;

    if ($wasResolved) {
        return $resolvedColumn;
    }

    $wasResolved = true;

    try {
        $stmt = $pdo->query("SHOW COLUMNS FROM fbt_widget");
        $columns = $stmt->fetchAll(PDO::FETCH_COLUMN, 0);

        if (!is_array($columns)) {
            return null;
        }

        // Prefer explicit names first.
        $preferred = ['aiProductCount', 'ai_product_count', 'AIProductCount', 'aiProductsCount'];
        foreach ($preferred as $name) {
            if (in_array($name, $columns, true)) {
                $resolvedColumn = $name;
                return $resolvedColumn;
            }
        }

        // Fallback: match columns that clearly represent ai product count.
        foreach ($columns as $columnName) {
            $normalized = strtolower((string)$columnName);
            if (
                strpos($normalized, 'ai') !== false &&
                strpos($normalized, 'product') !== false &&
                strpos($normalized, 'count') !== false
            ) {
                $resolvedColumn = $columnName;
                return $resolvedColumn;
            }
        }
    } catch (PDOException $e) {
        return null;
    }

    return null;
}

/* ============================================================
   ======================= GET REQUEST ========================
   ============================================================ */

if ($_SERVER['REQUEST_METHOD'] === 'GET') {

    $shopDomain = $_GET['shopdomain'] ?? null;

    if (!$shopDomain) {
        http_response_code(400);
        echo json_encode([
            "status" => "error",
            "message" => "shopdomain parameter required"
        ]);
        exit;
    }

    try {
        $stmt = $pdo->prepare("
            SELECT *
            FROM fbt_widget
            WHERE shopDomain = :shopDomain
            LIMIT 1
        ");

        $stmt->execute([':shopDomain' => $shopDomain]);
        $result = $stmt->fetch();

        if (!$result) {
            echo json_encode([
                "status" => "error",
                "message" => "No data found for this shop"
            ]);
            exit;
        }

        // Decode JSON columns
        $jsonFields = ['temp1', 'temp2', 'temp3', 'condition'];

        foreach ($jsonFields as $field) {
            if (!empty($result[$field])) {
                $decoded = json_decode($result[$field], true);
                if (json_last_error() === JSON_ERROR_NONE) {
                    $result[$field] = $decoded;
                }
            }
        }

        $aiProductCountColumn = detectAiProductCountColumn($pdo);

        if (
            $aiProductCountColumn !== null &&
            array_key_exists($aiProductCountColumn, $result) &&
            !array_key_exists('aiProductCount', $result)
        ) {
            $result['aiProductCount'] = $result[$aiProductCountColumn];
        }

        if (array_key_exists('aiProductCount', $result) && $result['aiProductCount'] !== null && $result['aiProductCount'] !== '') {
            $result['aiProductCount'] = (int)$result['aiProductCount'];
        }

        echo json_encode([
            "status" => "success",
            "data" => $result
        ]);

    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode([
            "status" => "error",
            "message" => "Fetch failed: " . $e->getMessage()
        ]);
    }

    exit;
}

/* ============================================================
   ======================= POST REQUEST =======================
   ============================================================ */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode([
        "status" => "error",
        "message" => "Method not allowed"
    ]);
    exit;
}

// ===== READ RAW PAYLOAD =====
$rawInput = file_get_contents("php://input");

if (empty($rawInput)) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Empty payload"]);
    exit;
}

$data = json_decode($rawInput, true);

if (json_last_error() !== JSON_ERROR_NONE) {
    http_response_code(400);
    echo json_encode([
        "status" => "error",
        "message" => "Invalid JSON: " . json_last_error_msg()
    ]);
    exit;
}

// Support wrapped or flat
$payload = isset($data['payload']) ? $data['payload'] : $data;

$shopDomain = $payload['shop'] ?? null;

if (!$shopDomain) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Shop is required"]);
    exit;
}

// ===== EXTRACT FBT DATA =====
$fbt = $payload['fbt'] ?? [];
$templates = $fbt['templates'] ?? [];

$temp1 = isset($templates['fbt1']) ? json_encode($templates['fbt1']) : null;
$temp2 = isset($templates['fbt2']) ? json_encode($templates['fbt2']) : null;
$temp3 = isset($templates['fbt3']) ? json_encode($templates['fbt3']) : null;

$selectedTemp = $fbt['selectedTemplate'] ?? null;
$selectedMode = $fbt['mode'] ?? null;
$condition = isset($fbt['manualRules']) ? json_encode($fbt['manualRules']) : null;
$aiProductCount = extractAiProductCount($payload, $fbt);
$aiProductCountColumn = detectAiProductCountColumn($pdo);

// ===== INSERT / UPDATE =====
$insertColumns = [
    'shopDomain',
    'temp1',
    'temp2',
    'temp3',
    'selectedTemp',
    'selectedMode',
    '`condition`'
];

$insertValues = [
    ':shopDomain',
    ':temp1',
    ':temp2',
    ':temp3',
    ':selectedTemp',
    ':selectedMode',
    ':condition'
];

$updateColumns = [
    'temp1 = VALUES(temp1)',
    'temp2 = VALUES(temp2)',
    'temp3 = VALUES(temp3)',
    'selectedTemp = VALUES(selectedTemp)',
    'selectedMode = VALUES(selectedMode)',
    '`condition` = VALUES(`condition`)'
];

$params = [
    ':shopDomain'   => $shopDomain,
    ':temp1'        => $temp1,
    ':temp2'        => $temp2,
    ':temp3'        => $temp3,
    ':selectedTemp' => $selectedTemp,
    ':selectedMode' => $selectedMode,
    ':condition'    => $condition
];

if ($aiProductCountColumn !== null) {
    $quotedAiColumn = '`' . str_replace('`', '', $aiProductCountColumn) . '`';
    $insertColumns[] = $quotedAiColumn;
    $insertValues[] = ':aiProductCount';
    $updateColumns[] = $quotedAiColumn . ' = VALUES(' . $quotedAiColumn . ')';
    $params[':aiProductCount'] = $aiProductCount;
}

$insertColumns[] = 'updated_at';
$insertValues[] = 'CURRENT_TIMESTAMP(3)';
$updateColumns[] = 'updated_at = CURRENT_TIMESTAMP(3)';

$sql = "
INSERT INTO fbt_widget (
    " . implode(",\n    ", $insertColumns) . "
) VALUES (
    " . implode(",\n    ", $insertValues) . "
)
ON DUPLICATE KEY UPDATE
    " . implode(",\n    ", $updateColumns) . "
";

try {
    $stmt = $pdo->prepare($sql);

    $stmt->execute($params);

    echo json_encode([
        "status"  => "success",
        "message" => "FBT widget saved successfully"
    ]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        "status"  => "error",
        "message" => "Database save failed: " . $e->getMessage()
    ]);
}