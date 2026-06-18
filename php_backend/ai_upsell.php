<?php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

function readRequestData() {
    $rawInput = file_get_contents('php://input');

    if ($rawInput !== false && trim($rawInput) !== '') {
        $decoded = json_decode($rawInput, true);
        if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
            return $decoded;
        }

        $formData = [];
        parse_str($rawInput, $formData);
        if (!empty($formData)) {
            return $formData;
        }
    }

    if (!empty($_POST) && is_array($_POST)) {
        return $_POST;
    }

    return null;
}

function unwrapPayload($data) {
    $payload = $data;

    if (is_array($data) && array_key_exists('payload', $data)) {
        $payload = $data['payload'];
    }

    if (is_string($payload) && trim($payload) !== '') {
        $decoded = json_decode($payload, true);
        if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
            $payload = $decoded;
        }
    }

    return is_array($payload) ? $payload : null;
}

function firstNonEmptyString(...$values) {
    foreach ($values as $value) {
        if (!is_string($value)) {
            continue;
        }

        $trimmed = trim($value);
        if ($trimmed !== '') {
            return $trimmed;
        }
    }

    return '';
}

function nestedArrayValue($data, $path) {
    $current = $data;

    foreach ($path as $segment) {
        if (!is_array($current) || !array_key_exists($segment, $current)) {
            return null;
        }

        $current = $current[$segment];
    }

    return $current;
}

function readHeaderValue($headerName) {
    $normalizedTarget = strtolower($headerName);

    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $value) {
            if (strtolower($name) === $normalizedTarget) {
                return is_string($value) ? trim($value) : '';
            }
        }
    }

    $serverKey = 'HTTP_' . strtoupper(str_replace('-', '_', $headerName));
    if (isset($_SERVER[$serverKey]) && is_string($_SERVER[$serverKey])) {
        return trim($_SERVER[$serverKey]);
    }

    return '';
}

function normalizeArrayValue($value) {
    if (is_array($value)) {
        return $value;
    }

    if (is_string($value) && trim($value) !== '') {
        $decoded = json_decode($value, true);
        if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
            return $decoded;
        }
    }

    return [];
}

function extractBearerApiKey() {
    $authorization = firstNonEmptyString(
        readHeaderValue('Authorization'),
        $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? null
    );

    if ($authorization === '' || stripos($authorization, 'Bearer ') !== 0) {
        return '';
    }

    $token = trim(substr($authorization, 7));
    if ($token === '') {
        return '';
    }

    // OpenAI keys use sk-* prefixes, including project-scoped keys (sk-proj-*).
    return stripos($token, 'sk-') === 0 ? $token : '';
}

function extractApiKeyFromPayload($payload) {
    $aiData = normalizeArrayValue($payload['ai'] ?? null);
    $upsellData = normalizeArrayValue($payload['upsellData'] ?? ($payload['upsell_data'] ?? ($payload['upsell'] ?? null)));
    $fbtData = normalizeArrayValue($payload['fbt'] ?? null);
    $settingsData = normalizeArrayValue($payload['settings'] ?? ($payload['settings_data'] ?? null));

    return firstNonEmptyString(
        $payload['apiKey'] ?? null,
        $payload['api_key'] ?? null,
        $payload['openaiKey'] ?? null,
        $payload['openai_key'] ?? null,
        $payload['openAiKey'] ?? null,
        $payload['openaiApiKey'] ?? null,
        $payload['openai_api_key'] ?? null,
        $payload['OPENAI_API_KEY'] ?? null,
        nestedArrayValue($payload, ['ai', 'apiKey']),
        nestedArrayValue($payload, ['ai', 'api_key']),
        nestedArrayValue($payload, ['ai', 'openaiKey']),
        nestedArrayValue($payload, ['ai', 'openai_api_key']),
        $aiData['apiKey'] ?? null,
        $aiData['api_key'] ?? null,
        $aiData['openaiKey'] ?? null,
        $aiData['openai_api_key'] ?? null,
        nestedArrayValue($payload, ['upsell', 'apiKey']),
        nestedArrayValue($payload, ['upsell', 'openaiKey']),
        nestedArrayValue($payload, ['upsellData', 'apiKey']),
        nestedArrayValue($payload, ['upsellData', 'openaiKey']),
        $upsellData['apiKey'] ?? null,
        $upsellData['api_key'] ?? null,
        $upsellData['openaiKey'] ?? null,
        $upsellData['openai_api_key'] ?? null,
        nestedArrayValue($payload, ['settings', 'apiKey']),
        nestedArrayValue($payload, ['settings', 'openaiKey']),
        $settingsData['apiKey'] ?? null,
        $settingsData['openaiKey'] ?? null,
        nestedArrayValue($payload, ['fbt', 'openaiKey']),
        $fbtData['openaiKey'] ?? null,
        readHeaderValue('X-OpenAI-Key'),
        readHeaderValue('OpenAI-API-Key'),
        extractBearerApiKey()
    );
}

function extractApiKeyFromEnvironment() {
    return firstNonEmptyString(
        getenv('OPENAI_API_KEY') ?: null,
        $_ENV['OPENAI_API_KEY'] ?? null,
        $_SERVER['OPENAI_API_KEY'] ?? null,
        getenv('OPENAI_KEY') ?: null,
        $_ENV['OPENAI_KEY'] ?? null,
        $_SERVER['OPENAI_KEY'] ?? null
    );
}

function extractEnvFileValue($allowedNames) {
    if (!is_array($allowedNames) || empty($allowedNames)) {
        return '';
    }

    $allowedSet = array_fill_keys($allowedNames, true);
    $envFiles = glob(__DIR__ . DIRECTORY_SEPARATOR . '.env*');

    if (!is_array($envFiles)) {
        return '';
    }

    foreach ($envFiles as $envFile) {
        if (!is_file($envFile)) {
            continue;
        }

        $envContent = file_get_contents($envFile);
        if ($envContent === false) {
            continue;
        }

        $lines = preg_split("/\r\n|\n|\r/", $envContent);

        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || strpos($line, '#') === 0) {
                continue;
            }

            $parts = explode('=', $line, 2);
            if (count($parts) !== 2) {
                continue;
            }

            $name = trim($parts[0]);
            $value = trim($parts[1], " \t\n\r\0\x0B\"'");

            if (isset($allowedSet[$name]) && $value !== '') {
                return $value;
            }
        }
    }

    return '';
}

function extractApiKeyFromEnvFiles() {
    return extractEnvFileValue(['OPENAI_API_KEY', 'OPENAI_KEY']);
}

function extractShopifyAppSecretFromEnvironment() {
    return firstNonEmptyString(
        getenv('SHOPIFY_API_SECRET') ?: null,
        $_ENV['SHOPIFY_API_SECRET'] ?? null,
        $_SERVER['SHOPIFY_API_SECRET'] ?? null,
        getenv('SHOPIFY_API_SECRET_KEY') ?: null,
        $_ENV['SHOPIFY_API_SECRET_KEY'] ?? null,
        $_SERVER['SHOPIFY_API_SECRET_KEY'] ?? null,
        getenv('SHOPIFY_APP_SECRET') ?: null,
        $_ENV['SHOPIFY_APP_SECRET'] ?? null,
        $_SERVER['SHOPIFY_APP_SECRET'] ?? null,
        extractEnvFileValue(['SHOPIFY_API_SECRET', 'SHOPIFY_API_SECRET_KEY', 'SHOPIFY_APP_SECRET'])
    );
}

function parseQueryStringWithDuplicates($queryString) {
    $params = [];

    if (!is_string($queryString) || $queryString === '') {
        return $params;
    }

    $pairs = explode('&', $queryString);
    foreach ($pairs as $pair) {
        if ($pair === '') {
            continue;
        }

        $kv = explode('=', $pair, 2);
        $rawKey = $kv[0] ?? '';
        $rawValue = $kv[1] ?? '';

        $key = urldecode($rawKey);
        $value = urldecode($rawValue);

        if ($key === '') {
            continue;
        }

        if (!array_key_exists($key, $params)) {
            $params[$key] = [];
        }

        $params[$key][] = $value;
    }

    return $params;
}

function calculateShopifyAppProxySignature($params, $sharedSecret) {
    if (!is_array($params) || $sharedSecret === '') {
        return '';
    }

    $signatureValues = $params['signature'] ?? [];
    $signature = is_array($signatureValues) ? ($signatureValues[0] ?? '') : '';
    if (!is_string($signature) || $signature === '') {
        return '';
    }

    unset($params['signature']);

    $parts = [];
    foreach ($params as $key => $values) {
        if (!is_string($key) || $key === '') {
            continue;
        }

        if (!is_array($values)) {
            $values = [$values];
        }

        $parts[] = $key . '=' . implode(',', $values);
    }

    sort($parts, SORT_STRING);
    $message = implode('', $parts);

    return hash_hmac('sha256', $message, $sharedSecret);
}

function verifyShopifyAppProxyRequest($sharedSecret) {
    $queryString = $_SERVER['QUERY_STRING'] ?? '';
    $params = parseQueryStringWithDuplicates($queryString);

    $signatureValues = $params['signature'] ?? [];
    $signature = is_array($signatureValues) ? ($signatureValues[0] ?? '') : '';
    if (!is_string($signature) || $signature === '') {
        return false;
    }

    $calculated = calculateShopifyAppProxySignature($params, $sharedSecret);
    if ($calculated === '') {
        return false;
    }

    return hash_equals($signature, $calculated);
}

function normalizeMyShopifyDomain($candidate) {
    if (!is_string($candidate)) {
        return '';
    }

    $candidate = trim($candidate);
    if ($candidate === '') {
        return '';
    }

    if (preg_match('/^https?:\/\//i', $candidate)) {
        $host = parse_url($candidate, PHP_URL_HOST);
        $candidate = is_string($host) ? $host : '';
    } else {
        $candidate = explode('/', $candidate, 2)[0];
    }

    $candidate = strtolower(trim($candidate));
    $candidate = preg_replace('/:\d+$/', '', $candidate);
    $candidate = trim($candidate, '.');

    if (!preg_match('/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/', $candidate)) {
        return '';
    }

    return $candidate;
}

function extractShopDomainFromEnvironment() {
    $candidate = firstNonEmptyString(
        getenv('SHOPIFY_SHOP_DOMAIN') ?: null,
        $_ENV['SHOPIFY_SHOP_DOMAIN'] ?? null,
        $_SERVER['SHOPIFY_SHOP_DOMAIN'] ?? null,
        getenv('SHOP_DOMAIN') ?: null,
        $_ENV['SHOP_DOMAIN'] ?? null,
        $_SERVER['SHOP_DOMAIN'] ?? null,
        getenv('MYSHOPIFY_DOMAIN') ?: null,
        $_ENV['MYSHOPIFY_DOMAIN'] ?? null,
        $_SERVER['MYSHOPIFY_DOMAIN'] ?? null,
        extractEnvFileValue(['SHOPIFY_SHOP_DOMAIN', 'SHOP_DOMAIN', 'MYSHOPIFY_DOMAIN'])
    );

    return normalizeMyShopifyDomain($candidate);
}

function extractShopDomain($payload) {
    $candidates = [
        $payload['shopDomain'] ?? null,
        $payload['shopdomain'] ?? null,
        $payload['shop_domain'] ?? null,
        $payload['shop'] ?? null,
        $payload['storeDomain'] ?? null,
        $payload['store_domain'] ?? null,
        $payload['shopUrl'] ?? null,
        $payload['shop_url'] ?? null,
        $payload['storeUrl'] ?? null,
        $payload['store_url'] ?? null,
        $payload['domain'] ?? null,
        nestedArrayValue($payload, ['shop', 'shopDomain']),
        nestedArrayValue($payload, ['shop', 'domain']),
        nestedArrayValue($payload, ['store', 'shopDomain']),
        nestedArrayValue($payload, ['store', 'domain']),
        readHeaderValue('X-Shopify-Shop-Domain'),
        readHeaderValue('X-Shop-Domain'),
        readHeaderValue('Shop-Domain'),
        $_GET['shopDomain'] ?? null,
        $_GET['shopdomain'] ?? null,
        $_GET['shop'] ?? null,
        extractShopDomainFromEnvironment()
    ];

    foreach ($candidates as $candidate) {
        if (!is_string($candidate) || trim($candidate) === '') {
            continue;
        }

        $normalized = normalizeMyShopifyDomain($candidate);
        if ($normalized !== '') {
            return $normalized;
        }
    }

    return '';
}

function extractShopifyAccessToken($payload) {
    return firstNonEmptyString(
        $payload['shopifyAccessToken'] ?? null,
        $payload['shopify_access_token'] ?? null,
        $payload['adminAccessToken'] ?? null,
        $payload['admin_access_token'] ?? null,
        $payload['accessToken'] ?? null,
        $payload['access_token'] ?? null,
        nestedArrayValue($payload, ['shopify', 'accessToken']),
        nestedArrayValue($payload, ['shopify', 'adminAccessToken']),
        nestedArrayValue($payload, ['shop', 'accessToken']),
        readHeaderValue('X-Shopify-Access-Token')
    );
}

function normalizeShopifyProducts($products) {
    $normalized = [];

    if (!is_array($products)) {
        return $normalized;
    }

    foreach ($products as $product) {
        if (!is_array($product)) {
            continue;
        }

        if (!isset($product['id']) || !isset($product['title'])) {
            continue;
        }

        $normalized[] = [
            'id' => (string)$product['id'],
            'title' => (string)$product['title']
        ];
    }

    return $normalized;
}

function fetchShopifyProducts($shopDomain, $accessToken = '') {
    if ($shopDomain === '') {
        return [];
    }

    $fetchJson = function($url, $headers = []) {
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);

        if (!empty($headers)) {
            curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        }

        $body = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($body === false || $httpCode !== 200) {
            return [];
        }

        $decoded = json_decode($body, true);
        if (json_last_error() !== JSON_ERROR_NONE || !is_array($decoded)) {
            return [];
        }

        return $decoded;
    };

    // Preferred path: authenticated Admin API if token is provided.
    if ($accessToken !== '') {
        $adminUrl = 'https://' . $shopDomain . '/admin/api/2024-10/products.json?fields=id,title&limit=250';
        $adminResult = $fetchJson($adminUrl, ['X-Shopify-Access-Token: ' . $accessToken]);

        $adminProducts = normalizeShopifyProducts($adminResult['products'] ?? []);
        if (!empty($adminProducts)) {
            return $adminProducts;
        }
    }

    // Fallback path: public storefront products endpoint.
    $publicUrl = 'https://' . $shopDomain . '/products.json?limit=250';
    $publicResult = $fetchJson($publicUrl);

    return normalizeShopifyProducts($publicResult['products'] ?? []);
}

$input = readRequestData();
$payload = unwrapPayload($input);

if (!is_array($payload)) {
    echo json_encode(['error' => 'Invalid JSON input']);
    exit();
}

$shopifyAppSecret = extractShopifyAppSecretFromEnvironment();
if ($shopifyAppSecret === '') {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => 'Shopify app secret not configured on the server (SHOPIFY_API_SECRET).',
    ]);
    exit();
}

if (!verifyShopifyAppProxyRequest($shopifyAppSecret)) {
    http_response_code(401);
    echo json_encode([
        'success' => false,
        'error' => 'Unauthorized (invalid Shopify App Proxy signature).',
    ]);
    exit();
}

$apiKey = extractApiKeyFromEnvironment();
if (empty($apiKey)) {
    $apiKey = extractApiKeyFromEnvFiles();
}

$cartProducts = normalizeArrayValue(
    $payload['cartProducts'] ??
    ($payload['cart_products'] ?? nestedArrayValue($payload, ['cart', 'products']))
);

$allProducts = normalizeArrayValue(
    $payload['allProducts'] ??
    ($payload['all_products'] ??
    ($payload['products'] ??
    (nestedArrayValue($payload, ['catalog', 'products']) ?? nestedArrayValue($payload, ['store', 'products']))))
);

$shopDomain = extractShopDomain($payload);
$shopifyAccessToken = extractShopifyAccessToken($payload);
$allProductsSource = empty($allProducts) ? 'payload_empty' : 'payload';

$rawLimit = $payload['limit'] ?? null;
$limit = is_numeric($rawLimit) ? (int)$rawLimit : 3;
$limit = max(3, min(5, $limit));

if (empty($allProducts) && $shopDomain !== '') {
    $fetchedProducts = fetchShopifyProducts($shopDomain, $shopifyAccessToken);
    if (!empty($fetchedProducts)) {
        $allProducts = $fetchedProducts;
        $allProductsSource = $shopifyAccessToken !== '' ? 'shopify_admin_api' : 'shopify_public_products_json';
    } else {
        $allProductsSource = $shopifyAccessToken !== '' ? 'shopify_admin_or_public_failed' : 'shopify_public_failed';
    }
} elseif (empty($allProducts) && $shopDomain === '') {
    $allProductsSource = 'payload_empty_no_shop_domain';
}

// Report all missing requirements at once to make integration debugging easier.
$validationErrors = [];
if (empty($apiKey)) {
    $validationErrors[] = 'OpenAI API Key is missing';
}
if (empty($cartProducts)) {
    $validationErrors[] = 'Cart is empty or cartProducts missing';
}
if (empty($allProducts)) {
    $validationErrors[] = 'Store products list is missing';
}

if (!empty($validationErrors)) {
    $response = [
        'success' => false,
        'error' => $validationErrors[0],
        'diagnostics' => [
            'hasApiKey' => !empty($apiKey),
            'cartProductsCount' => is_array($cartProducts) ? count($cartProducts) : 0,
            'allProductsCount' => is_array($allProducts) ? count($allProducts) : 0,
            'allProductsSource' => $allProductsSource,
            'shopDomain' => $shopDomain !== '' ? $shopDomain : null,
            'hasShopifyAccessToken' => $shopifyAccessToken !== ''
        ]
    ];

    if (count($validationErrors) > 1) {
        $response['errors'] = $validationErrors;
    }

    echo json_encode($response);
    exit();
}

// Build the prompt for OpenAI
$cartContext = [];
foreach ($cartProducts as $p) {
    if (isset($p['title'])) {
         $cartContext[] = $p['title'];
    }
}
$cartString = implode(", ", $cartContext);

// Get available products to recommend from
$storeCatalog = [];
foreach ($allProducts as $p) {
    if (isset($p['title']) && isset($p['id'])) {
         $storeCatalog[] = $p['title'] . " (ID: " . $p['id'] . ")";
    }
}
$catalogString = implode("\n", $storeCatalog);

$prompt = "The customer currently has the following items in their cart: $cartString.
Based on these items, recommend up to $limit complementary products from this store catalog:
$catalogString

IMPORTANT: Your response MUST be valid JSON. Return an array of recommended product IDs exactly matching the IDs provided in the catalog.
Example output format:
[\"123456789\", \"987654321\"]";

$isNvidiaKey = strpos($apiKey, 'nvapi-') === 0;
$aiApiUrl = $isNvidiaKey
    ? 'https://integrate.api.nvidia.com/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
$aiModel = $isNvidiaKey ? 'meta/llama-3.1-8b-instruct' : 'gpt-4o-mini';

$data = [
    'model' => $aiModel,
    'messages' => [
        ['role' => 'system', 'content' => 'You are an expert e-commerce recommendation engine.'],
        ['role' => 'user', 'content' => $prompt]
    ],
    'temperature' => 0.6,
    'max_tokens' => 140
];

$ch = curl_init($aiApiUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'Authorization: Bearer ' . $apiKey
]);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);

if ($httpCode !== 200 || $response === false) {
    echo json_encode([
        'error' => 'OpenAI API request failed',
        'httpCode' => $httpCode,
        'details' => $response,
        'curl_error' => $error
    ]);
    exit();
}

$result = json_decode($response, true);
if (isset($result['choices'][0]['message']['content'])) {
    $content = $result['choices'][0]['message']['content'];
    // Try to parse JSON from the response
    try {
        $jsonStart = strpos($content, '[');
        $jsonEnd = strrpos($content, ']');
        if ($jsonStart !== false && $jsonEnd !== false) {
            $jsonStr = substr($content, $jsonStart, $jsonEnd - $jsonStart + 1);
            $recommendedIds = json_decode($jsonStr, true);
            if (is_array($recommendedIds)) {
                echo json_encode(['success' => true, 'recommendations' => $recommendedIds]);
                exit();
            }
        }
    } catch (Exception $e) {}
    
    echo json_encode(['success' => false, 'error' => 'Failed to parse JSON from AI response', 'raw' => $content]);
} else {
    echo json_encode(['error' => 'Invalid response structure from OpenAI']);
}
?>
