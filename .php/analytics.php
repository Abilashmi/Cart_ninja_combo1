<?php
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json');

require_once __DIR__ . '/config.php';

// =======================
// INPUTS
// =======================
$shop = $_GET['shop'] ?? '';
$startDate = $_GET['startDate'] ?? null;
$endDate = $_GET['endDate'] ?? null;

if (!$shop) {
    http_response_code(400);
    echo json_encode([
        "success" => false,
        "message" => "shop parameter required"
    ]);
    exit;
}

// =======================
// CONFIG
// =======================
$table = "cart_click_events";
$eventColumn = "event_type";
$domainColumn = "domain";
$dateColumn = "created_at";

// =======================
// CHECK REVENUE COLUMN
// =======================
function tableHasColumn(mysqli $conn, string $table, string $column): bool {
    $result = $conn->query("SHOW COLUMNS FROM `$table` LIKE '$column'");
    return $result && $result->num_rows > 0;
}

$hasRevenueColumn = tableHasColumn($conn, $table, "revenue");

$revenueSelect = $hasRevenueColumn
    ? "COALESCE(SUM(`revenue`), 0) as revenue"
    : "0 as revenue";

// =======================
// BUILD QUERY
// =======================
$query = "
    SELECT 
        `$eventColumn` AS event_type,
        COUNT(*) as total,
        $revenueSelect
    FROM `$table`
    WHERE `$domainColumn` = ?
";

$params = [$shop];
$types = "s";

// ✅ FIXED DATE FILTER (no DATE())
if (!empty($startDate)) {
    $query .= " AND `$dateColumn` >= ?";
    $params[] = $startDate . " 00:00:00";
    $types .= "s";
}

if (!empty($endDate)) {
    $query .= " AND `$dateColumn` <= ?";
    $params[] = $endDate . " 23:59:59";
    $types .= "s";
}

$query .= " GROUP BY `$eventColumn`";

// =======================
// PREPARE + EXECUTE
// =======================
$stmt = $conn->prepare($query);

if (!$stmt) {
    http_response_code(500);
    echo json_encode([
        "success" => false,
        "error" => $conn->error
    ]);
    exit;
}

error_log("[DEBUG] Query: " . $query);
error_log("[DEBUG] Params: " . json_encode($params));
error_log("[DEBUG] Shop: $shop | StartDate: $startDate | EndDate: $endDate");

$stmt->bind_param($types, ...$params);
$stmt->execute();

$result = $stmt->get_result();

// =======================
// DEFAULT RESPONSE
// =======================
$analyticsData = [
    'checkout_click' => 0,
    'coupon_click' => 0,
    'upsell_click' => 0,
    'upsell_revenue_generated' => 0,
    'cartdrawer_total_revenue' => 0,
    'cartdrawer_total_coupon_applied' => 0,
];

// =======================
// MAP DATA
// =======================
while ($row = $result->fetch_assoc()) {

    $type = strtolower(trim($row['event_type']));
    $total = (int)$row['total'];
    $revenue = (float)$row['revenue'];

    if (strpos($type, 'checkout') !== false) {
        $analyticsData['checkout_click'] += $total;
    }

    else if (strpos($type, 'coupon') !== false) {
        $analyticsData['coupon_click'] += $total;
        $analyticsData['cartdrawer_total_coupon_applied'] += $total;
    }

    else if (strpos($type, 'upsell') !== false) {
        $analyticsData['upsell_click'] += $total;
        $analyticsData['upsell_revenue_generated'] += $revenue;
    }

    // total revenue from all events
    $analyticsData['cartdrawer_total_revenue'] += $revenue;
}

// =======================
// RESPONSE
// =======================
echo json_encode([
    "success" => true,
    "data" => $analyticsData
]);
?>