# Services, Utils, Context & Types — Deep Reference

Scope: `app/services/**`, `app/utils/**`, `app/context/**`, `app/types/**`, and root `app/db.server.js`. Does NOT cover `app/routes` or `app/components` (other agents own those) except as "consumed by" references discovered via grep.

All 26 files in `app/services/`, 5 files in `app/utils/`, 1 file in `app/context/`, 1 file in `app/types/`, plus the root `app/db.server.js` were read in full. Total: 34 files.

---

## app/services/

### app/services/ai-credits.server.js

**Purpose:** Tracks and gates the AI BRIX chat credit system — increments a shop's monthly usage counter and triggers Shopify usage billing once the shop's plan cap is exceeded. Chat is never hard-blocked; overage is billed per-credit instead.

**Exported functions:**
- `checkAndConsumeCredit(shop, admin)` → `Promise<{ allowed: true, remaining, limit, planKey, isOverage, overageRate, overageCharge }>`. Computes `currentPeriodKey()` (`YYYY-MM` UTC), upserts `ai_brix_credit_usage` (`credits_used = credits_used + 1`), re-reads the row, and if `credits_used > limit` calls `chargeAiCreditOverage()` from `billing.server.js`. `allowed` is always `true`.
- `getCreditStatus(shop)` → `Promise<{ planKey, limit, used, remaining, isOverage, overageRate }>`. Read-only status (does not consume a credit) — used for the credits pill UI.

**DB tables:** MySQL `ai_brix_credit_usage` (ensured via `ensurePlanTables` from `plan-schema.server.js`).

**External services:** None directly; delegates to `billing.server.js` → Shopify `appUsageRecordCreate` GraphQL mutation.

**Business logic:** Plan cap comes from `getAiBrixCreditLimit(planKey)` and overage rate from `getAiBrixOverageRate(planKey)` (`app/config/plans`). Period key resets monthly (calendar month, UTC). Overage credit number = `creditsUsedAfter - limit`.

**Error handling:** No try/catch at this layer; DB/billing errors propagate to caller.

**Consumed by:** `api.ai.chat.jsx`, `api.ai.credits.jsx` (per CLAUDE.md's BRIX credit system); confirmed via grep of routes importing `services/` files.

---

### app/services/ai-llm.server.js

**Purpose:** Centralized LLM call helper implementing the NVIDIA NIM / OpenAI provider-detection convention documented in CLAUDE.md.

**Exported functions:**
- `resolveProvider()` (internal, not exported) — reads `process.env.OPENAI_API_KEY`; if it starts with `nvapi-`, targets `https://integrate.api.nvidia.com/v1/chat/completions` with model `meta/llama-3.1-8b-instruct`; otherwise targets `https://api.openai.com/v1/chat/completions` with model `gpt-4o-mini`.
- `parseJsonReply(text, fallback = { unclear: true })` → parses an LLM's raw text reply as JSON after stripping ```` ```json ```` / ```` ``` ```` fences; returns `fallback` on parse failure.
- `callLlm(messages, opts)` → `Promise<string|null>`. `opts: { maxTokens = 150, temperature = 0 }`. Returns raw assistant text or `null` on non-OK HTTP response.
- `callLlmWithMeta(messages, opts)` → `Promise<{ content, finishReason, errorStatus }>`. Same as `callLlm` but also exposes `finish_reason` (e.g. `"length"` for truncation) and HTTP error status, used by the free-form chat route to auto-continue truncated replies.

**External services:** NVIDIA NIM or OpenAI chat-completions endpoint (POST with `Authorization: Bearer <apiKey>`).

**Error handling:** Non-OK response logs `[ai-llm] provider error` with status + truncated body, returns `{ content: null, ... }` rather than throwing.

**Consumed by:** All AI-turn routes (`api.ai-agent.*.jsx`, `api.ai.chat.jsx`) per grep.

---

### app/services/ai-safety.server.js

**Purpose:** Defense-in-depth guard for the free-form chat path (`api.ai.chat.jsx`) only. Since that path has no backend execution capability, this catches cases where the LLM still claims to have performed an action or promises future monitoring despite system-prompt instructions.

**Exported functions:**
- `guardChatReply(text)` → `string`. Tests `text` against `COMPLETION_CLAIM_RE` (matches phrases like "I've enabled/disabled/created/added/configured/updated/applied/fixed/set up/removed/deleted") and `FUTURE_PROMISE_RE` (matches "I'll notify/monitor/watch/keep an eye/follow up/check back/let you know"). If matched, appends a corrective note clarifying nothing was actually changed; logs a `console.warn`. Otherwise returns `text` unchanged.

**Business logic:** Pure regex-based text guard, no DB/network calls.

**Consumed by:** `api.ai.chat.jsx` (per file's own header comment).

---

### app/services/analytics-aggregator.server.js

**Purpose:** Maintains the `analytics_daily_rollup` MySQL table — both incremental (webhook-driven) updates and full reconciliation from raw tables.

**Exported functions:**
- `applyOrderDelta(shop, dateStr, revenueDelta, orderCountDelta)` → upserts `analytics_daily_rollup` incrementing `revenue` and `order_count` via `ON DUPLICATE KEY UPDATE ... = ... + VALUES(...)`. Called directly from order webhooks for near-real-time numbers.
- `applyCartActivityDelta(shop, dateStr, field, delta = 1)` → increments one of `cart_create_count` / `cart_update_count` (validated against `CART_ACTIVITY_FIELDS` Set; throws `Error` for any other field name).
- `reconcileDailyRollup(shopDomain, { days = 3 })` → `Promise<number>` (count of dates reconciled). Full recompute: runs 5 parallel aggregate queries (orders, clicks, bundles, visitors, cart activity) over the trailing `days`, buckets results by date in a `Map`, then upserts each date's full row into `analytics_daily_rollup` with `ON DUPLICATE KEY UPDATE` on every column (i.e. full overwrite, not increment — corrects drift from missed/retried webhooks).
- `reconcileAllShops({ days = 3 })` → `Promise<number>` (shop count processed). Finds distinct shops via `UNION` across `store_orders`, `cart_click_events`, `combo_analytics`, then calls `reconcileDailyRollup` per shop, catching and logging per-shop errors without aborting the batch.

**DB tables:** Reads: `store_orders`, `cart_click_events`, `combo_analytics`, `analytics_sessions`, `cart_activity_events`. Writes: `analytics_daily_rollup`.

**Business logic:** Revenue computed as `SUM(total_price - refunded_amount)` for non-cancelled orders. Coupon-click events are also counted as "coupon applied" (no separate applied signal exists yet — documented as mirroring php_backend's legacy semantics). Visitor count = `COUNT(DISTINCT session_id)` from `analytics_sessions.first_seen_at`.

**Error handling:** `reconcileAllShops` catches per-shop errors and continues; other functions propagate.

**Consumed by:** `scheduler.server.js` (cron jobs, every 15 min light / nightly deep reconcile); order/cart webhooks likely call `applyOrderDelta`/`applyCartActivityDelta` directly (webhooks.orders.*.jsx, webhooks.carts.*.jsx per grep).

---

### app/services/analytics-query.server.js

**Purpose:** Read-side query layer over `analytics_daily_rollup` and order/line-item tables — powers the Analytics dashboard.

**Exported functions:**
- `getPeriodTotals(shop, startDate, endDate)` → sums all rollup columns over the date range, then calls internal `deriveMetrics()` to add `aov = revenue/order_count`, `conversion_rate = order_count/visitor_count * 100`, `checkout_rate = checkout_click_count/visitor_count * 100` (all via `safeDivide` from `utils/analytics.shared.js`, safe against div-by-zero).
- `getDailyChart(shop, startDate, endDate)` → returns one row per calendar day in range (zero-filled for missing days via `toDayList`), each with revenue/upsell/coupons/clicks/conversion-rate/AOV etc.
- `getTopProducts(shop, startDate, endDate, limit = 10)` → joins `store_order_line_items` + `store_orders`, groups by `product_id`, orders by revenue DESC. Falls back to `Product #<id>` when title is blank.
- `getTopCollections(shop, startDate, endDate, limit = 10)` → joins `store_order_line_item_collections` + `store_order_line_items` + `store_orders`, groups by `collection_id`.
- `getFunnel(shop, startDate, endDate)` → `{ visitors, cart_creates, checkout_clicks, orders, rates: { visitor_to_cart, cart_to_checkout, checkout_to_order } }` (all rates rounded to 1 decimal, percentage).
- `getRecentActivity(shop, limit = 20)` → merges recent `store_orders` (financial_status='paid') and `combo_analytics` (event_type='order') rows, sorted by `occurred_at` DESC, sliced to `limit`.

**DB tables:** `analytics_daily_rollup`, `store_order_line_items`, `store_orders`, `store_order_line_item_collections`, `combo_analytics`.

**Consumed by:** `api.analytics.*.jsx` route family (`api.analytics.chart.jsx`, `api.analytics.funnel.jsx`, `api.analytics.top-products.jsx`, `api.analytics.top-collections.jsx`, `api.analytics.recent-activity.jsx`, `api.analytics.summary.jsx`, `api.analytics.insights.jsx`) per grep. Also imported by `upsell-recommendation.server.js` (`getTopProducts`).

---

### app/services/analytics-schema.server.js

**Purpose:** Idempotent DDL (CREATE TABLE IF NOT EXISTS) for the entire analytics subsystem — mirrors the `ensureStoreOrderEventsTable` convention rather than using Prisma migrations, explicitly to avoid the "orphaned-model problem" from `prisma/migrations/20260618000003_create_combo_forge_tables`.

**Exported functions:**
- `ensureAnalyticsTables(db)` → module-level `ensured` boolean guards against re-running DDL after the first call per process. Creates (if missing): `store_orders`, `store_order_line_items`, `product_collection_cache`, `store_order_line_item_collections`, `cart_activity_events`, `analytics_sessions`, `app_usage_events`, `analytics_daily_rollup`, `analytics_insights_cache`. Also calls internal `ensureDiscountCodeColumn(db)` which checks `INFORMATION_SCHEMA.COLUMNS` and `ALTER TABLE combo_analytics ADD COLUMN discount_code VARCHAR(100)` if missing.

**DB tables (full schema, MySQL, InnoDB/utf8mb4):**
- `store_orders` — PK `id`, unique `(shop_domain, order_id)`, holds financial/fulfillment status, totals, `cancelled_at`, `refunded_amount`, `is_test`.
- `store_order_line_items` — PK `id`, unique `(shop_domain, order_id, line_item_id)`, product/variant/sku/qty/price/discount/line_revenue.
- `product_collection_cache` — PK `id`, unique `(shop_domain, product_id, collection_id)`.
- `store_order_line_item_collections` — PK `id`, unique `(shop_domain, line_item_id, collection_id)`.
- `cart_activity_events` — PK `id`, `event_type ENUM('create','update')`.
- `analytics_sessions` — PK `id`, unique `(shop_domain, session_id)`, `first_seen_at`/`last_seen_at`/`pageview_count`.
- `app_usage_events` — PK `id`, `feature`/`action`/`metadata JSON`.
- `analytics_daily_rollup` — PK `id`, unique `(shop_domain, date)`, all the aggregate columns referenced by `analytics-aggregator.server.js`/`analytics-query.server.js`.
- `analytics_insights_cache` — PK `id`, unique `(shop_domain, period_key)`, `insights_json LONGTEXT`, `model`.
- `combo_analytics.discount_code` column added via `ALTER TABLE` if missing (this table itself is created elsewhere).

**Consumed by:** Every analytics/aggregator/billing/upsell-recommendation service that touches these tables calls `ensureAnalyticsTables(db)` first (guards against missing-table errors on a fresh DB).

---

### app/services/analytics.server.js

**Purpose:** Legacy/hybrid analytics fetcher — combines a PHP upstream (click/coupon/checkout counts) with local MySQL order data (`store_order_events` table, distinct from `store_orders`). Appears to be an older/parallel analytics path alongside `analytics-query.server.js`.

**Exported functions:**
- `getAnalyticsData(shop, startDate, endDate)` → `Promise<{ success, error?, data }>`. Tries each URL in `getAnalyticsUpstreamUrls()` (env `ANALYTICS_API_URLS`/`ANALYTICS_API_URL`/`EXTERNAL_ANALYTICS_API_URL`, deduped with a hardcoded default `https://int.thecartninja.com/analytics.php`), 5s timeout per attempt via `AbortSignal.timeout(5000)`. On success, normalizes the payload (`normalizeAnalyticsPayload` — handles both array and object shapes, tolerant of many alternate field-name spellings) and merges in local order stats (`getLocalOrderStats`) queried from `store_order_events`. On total upstream failure, still returns `success: true` with an `error` string describing the failure, plus local order stats.

**Internal helpers:** `toCount`, `toAmount` (numeric coercion, non-negative), `extractCounts`, `normalizeAnalyticsPayload`, `getLocalOrderStats(shop, startDate, endDate, checkoutClicks)` (queries `store_order_events`, computes `avg_order_value` and `conversion_rate = orderCount/checkoutClicks*100`), `getErrorBody`.

**DB tables:** `store_order_events` (local dev-time source of truth for revenue/AOV, populated by `webhooks.orders.paid.jsx` — distinct from the `store_orders`/`store_order_line_items` tables used by `analytics-query.server.js`/`analytics-schema.server.js`).

**External services:** `https://int.thecartninja.com/analytics.php` (default) or configured upstream(s).

**Business logic:** Click counts (checkout/coupon/upsell) always come from the PHP upstream; revenue/AOV/conversion always computed locally from `store_order_events`, regardless of upstream success/failure — so revenue numbers never depend on the external PHP call succeeding.

**Consumed by:** `api.analytics.jsx`, `app._index.jsx` (per the file's own header comment).

**Note:** This file's data model (`store_order_events`) appears to be a distinct/possibly-legacy table from `store_orders` used elsewhere in `app/services/analytics-*`. Not verified whether both are actively populated in production — flagged for cross-check against `webhooks.orders.paid.jsx`.

---

### app/services/api.cart-settings.jsx

**Status: EMPTY FILE.** Confirmed via Read — file exists but has zero bytes of content. No exports. Not currently a live module (any import of it would resolve to an empty module).

---

### app/services/api.cart-settings.shared.js

**Purpose:** Large static-data + pure-logic module for the (older/mock) coupon and upsell config system — sample data, style enum/metadata objects, default config shapes, and rule-evaluation logic. Appears to predate or run parallel to the normalized MySQL-backed upsell/coupon settings tables described elsewhere.

**Exported constants:** `COUPON_STYLES`, `COUPON_STYLE_METADATA`, `globalCouponStyle` (mutable `let`), `sampleCoupons` (3 mock coupons), `shopifyProducts` (8 mock products), `mockCollections` (5 mock collections), `UPSELL_STYLES` (`GRID`/`CAROUSEL`/`LIST`), `UPSELL_STYLE_METADATA`, `RULE_TYPES` (`GLOBAL`, `TRIGGERED`, `GLOBAL_EXCEPT`, `CART_CONDITIONS`), `RULE_TYPE_OPTIONS`, `SAMPLE_UPSELL_PRODUCTS` (6 mock products with `gid`), `DEFAULT_UPSELL_CONFIG`, `PRODUCT_COUPON_SLIDER_STYLES`, `PRODUCT_COUPON_SLIDER_STYLE_OPTIONS`, `PRODUCT_COUPON_SLIDER_ALIGNMENTS`, `DEFAULT_PRODUCT_COUPON_SLIDER_CONFIG`, `SAMPLE_APP_DATA` (a large composite mock object covering `productCouponSlider`, `progressBarSettings`, `couponSliderSettings`, `upsellSettings`, `cartData`, `milestones`).

**Exported functions:**
- `getUpsellConfig(shopId)` → `fetch('/api/upsell', { headers: { 'X-Shop-ID': shopId } })`, falls back to `{ config: DEFAULT_UPSELL_CONFIG }` on error.
- `saveUpsellConfig(configData)` → `POST /api/upsell`; throws on non-OK response.
- `reconstructUpsellConfig(rules = [])` → maps a flat DB `rules` array (each with `id`/`priority`) back into the UI's `rule1`/`rule2`/`rule3` slot shape, JSON-parsing `upsellProducts`/`upsellCollections`/`triggerProducts`/`triggerCollections` string columns.
- `validateUpsellRule(config, allRules = [])` → `{ valid, error? }`. Business rules: (1) a `GLOBAL` rule and a `GLOBAL_EXCEPT` rule cannot both be enabled among different rules; (2) a `TRIGGERED` rule requires ≥1 trigger product/collection; (3) a `GLOBAL_EXCEPT` rule requires ≥1 excluded product/collection; (4) every enabled rule requires ≥1 upsell product/collection; (5) `limit` must be 1–4.
- `evaluateUpsellRules(rules, cartProductIds = [], cartTotal = 0)` → priority order: `TRIGGERED` (any trigger match) > `CART_CONDITIONS` (cart total ≥ threshold) > `GLOBAL_EXCEPT` (no excluded product in cart) > `GLOBAL` (fallback). Returns the first matching enabled rule or `null`.
- `canEnableRuleType(ruleType, existingRules = [])` → `{ canEnable, reason? }`. Prevents enabling `GLOBAL` while a `GLOBAL_EXCEPT` rule is active and vice versa.
- `getProductById(productId)` / `getProductsByIds(productIds)` → lookups against `SAMPLE_UPSELL_PRODUCTS` only (mock data, not real catalog).
- `trackUpsellEvent(event, data = {})` → `console.log` + appends to `sessionStorage['upsell_events']` (client-only; no-op server-side since `sessionStorage` is undefined).
- `getTrackedEvents()` / `clearTrackedEvents()` → read/clear `sessionStorage['upsell_events']`.
- `addToCartViaShopifyAPI(productGid, quantity = 1)` → **mocked**, `setTimeout(500ms)` then returns a fake success payload; does not call a real Shopify endpoint.

**Business logic:** The `RULE_TYPES` priority hierarchy (`validateUpsellRule`/`evaluateUpsellRules`/`canEnableRuleType`) is the most substantive logic here — it encodes mutual-exclusivity and evaluation-order rules for upsell targeting that could plausibly still back some part of the UI even though the underlying data (mock products/collections) looks legacy.

**Consumed by:** Not confirmed via grep in this pass — likely imported by upsell-related route/component code outside this agent's scope. Given the mock/fake nature of much of its data (`sampleCoupons`, `SAMPLE_UPSELL_PRODUCTS`, `addToCartViaShopifyAPI` mock), treat contents cautiously; cross-reference with the live `upsell_widget_settings`/`coupon_slider_settings` MySQL-backed system documented via `api.upsell-settings.jsx`/`api.coupon-slider-settings.jsx` before assuming this is the active code path.

---

### app/services/cart-drawer-record.server.js

**Purpose:** Client for the legacy `cart_drawer` MySQL table (via PHP backend `save_cart_drawer.php`), with a local JSON-file fallback/cache.

**Exported functions:**
- `truthyFlag(value)` → `boolean`. Matches `1`, `"1"`, `true`.
- `fetchCartDrawerRecord(shop)` → `Promise<object|null>`. `GET {PHP_BASE}/save_cart_drawer.php?shopdomain=<shop>` with `X-Forge-Secret` header. On fetch failure or non-success response, falls back to reading `cartdrawer-config-data.json` (resolved via `path.resolve`) keyed by normalized (trimmed, lowercased) shop domain.
- `persistCartDrawerRecord(shop, record)` → `Promise<{ ok, response?, httpStatus?, error? }>`. `POST` the record (merged with `shop`/`shopDomain`) to the same PHP endpoint. **Only on PHP-confirmed success** does it update the local JSON file — explicitly designed so the local cache never drifts ahead of the DB.

**DB tables:** Legacy `cart_drawer` MySQL table (via PHP, not directly).

**External services:** `{PHP_BASE_URL}/save_cart_drawer.php` (`PHP_BASE_URL` env, default `http://localhost/cartdrawerv2_ui/php_backend`).

**Error handling:** All network calls wrapped in try/catch; failures logged via `console.warn`/`console.error`, never thrown to caller (returns `null` / `{ ok: false, error }`).

**Consumed by:** `save_cart_drawer[.]php.jsx`, `app.cartdrawer.jsx` (per grep of routes importing services; `save_cart_drawer[.]php.jsx` filename directly maps to this record's PHP endpoint).

---

### app/services/catalog-snapshot.server.js

**Purpose:** Bounded, non-persisted Shopify Admin GraphQL catalog read — a fallback reasoning source for AI insights when order/analytics history is too thin (new stores, low volume, or a plan without analytics access).

**Exported functions:**
- `getCatalogSnapshot(admin)` → `Promise<{ currencyCode, productCount, collectionCount, uncategorizedProductCount, outOfStockCount, avgPrice, minPrice, maxPrice, topVendors, topTags }>`. Queries up to 50 active products (`status:active`) and 20 collections in one GraphQL call. Computes vendor/tag frequency counts (top 5 each), out-of-stock count (`totalInventory <= 0`), uncategorized count (no collection edges), and price stats (min/max/avg from `minVariantPrice`).

**External services:** Shopify Admin GraphQL API (`admin.graphql`).

**Business logic:** Deliberately capped at 50 products / 20 collections; "every number returned here traces back to a real GraphQL field — nothing is estimated or invented" (per file header comment) — a truthfulness constraint tied to the BRIX truthfulness redesign work noted in project memory.

**Consumed by:** Likely `api.ai-agent.store-insights.jsx` (per grep of routes importing services files, though not confirmed at the specific-function level).

---

### app/services/collection-resolver.server.js

**Purpose:** Resolves a free-text collection name (extracted from a merchant's AI chat reply) against the shop's real Shopify catalog via Admin GraphQL search.

**Exported functions:**
- `resolveCollectionByName(admin, name)` → `Promise<{ status: 'found', id, title, handle } | { status: 'not_found' } | { status: 'ambiguous', candidates }>`. Builds a `title:*<cleaned>*` wildcard query (strips `"`, `*`, `\`, `:` from input via internal `toTitleQuery`), searches up to 10 collections. Prefers an exact case-insensitive title match; if exactly one match and no exact hit, returns that; if 2+ ambiguous matches, returns up to 5 candidates for the caller to disambiguate.

**External services:** Shopify Admin GraphQL (`collections(first: 10, query: ...)`).

**Business logic:** Mirrors `resolveProductByName` in `upsell-rules.server.js` — same three-way match/not-found/ambiguous contract, applied to collections instead of products.

**Consumed by:** AI-turn routes handling collection selection (likely `api.ai-agent.combo-turn.jsx`/`progress-bar-turn.jsx` per pattern; not individually confirmed by function-level grep).

---

### app/services/combo-templates.server.js

**Purpose:** Shared plan-gating + creation logic for Combo Forge templates, used by both the manual builder save path and the AI-chat-driven combo creation flow — explicitly designed so neither path can drift from or bypass the same gate.

**Exported functions:**
- `checkComboPlanGate(shop)` → `Promise<null | { error, limitReached: true }>`. Checks `canAccessFeature(planKey, 'build_a_combo')` (returns error if the shop's plan doesn't include Build a Combo); then checks `PLANS[planKey].comboTemplateLimit` against a live `COUNT(*) FROM combo_templates WHERE shop_domain = ?` — returns an error if at/over the limit. `null` return means creation is allowed.
- `createComboTemplate(shop, { name, template_type, status, is_active, customization_data, page_handle = null, page_id = null })` → `Promise<number>` (insertId). Single `INSERT INTO combo_templates` with defaults: `name` → `'Untitled'`, `template_type` → `'grid'`, `status` → `'draft'`, `is_active` normalized to `0`/`1`, `customization_data` → `'{}'`.

**DB tables:** `combo_templates` (MySQL, via `getDb()`/PHP proxy).

**Business logic:** Plan gating — `build_a_combo` feature flag must be enabled for the shop's plan; template count capped per plan (`comboTemplateLimit`, `null`/`undefined` = unlimited).

**Consumed by:** `api.bundle-templates.jsx` (confirmed by file's own header comment) and the AI combo-creation turn route (`api.ai-agent.combo-turn.jsx`, per grep pattern).

---

### app/services/coupon-sample.server.js

**Purpose:** Reads/prepares coupon records for a shop from the `coupons` MySQL table (a different table than the `cart_drawer_config`/legacy `cart_drawer` blob storage — appears to be a normalized coupons table used for sample/demo purposes or an early iteration of coupon storage).

**Exported functions:**
- `getStoredCoupons(shopDomain = "")` → `Promise<Array>`. `SELECT * FROM coupons WHERE shop_domain = ? AND is_active = 1 ORDER BY created_at DESC`. Parses each row's `discount_config` JSON column and spreads it into the returned object alongside `id` (falls back to `internal_id` or numeric `id`), `internal_id`, `shopify_id`, `shop_domain`, `code`. Returns `[]` on any DB error (caught, logged via `console.error`).
- `storeCoupon(couponData)` → `Promise<object>`. Pure object-shaping helper — adds `id` (via internal `genId()`, format `coupon_<timestamp>_<random5>`) and `createdAt` ISO timestamp. Does **not** itself write to the DB (no INSERT call in this function).
- Re-exports `genId`, `normalizeShop` (lowercase-trimmed shop domain).

**DB tables:** `coupons` (MySQL).

**Consumed by:** `api.create_coupon-sample.jsx` (per grep of routes importing services, filename strongly implies direct pairing).

---

### app/services/coupons.server.js

**Status: STUB / DEAD CODE.** Full file contents are exactly two lines:
```
getCoupons(shopId)
upsertCoupons(shopId, coupons)
```
This is **not valid, executable module code** — there are no `function`/`export` keywords, and `shopId`/`coupons` are undefined identifiers. If this file were ever imported and evaluated, it would throw a `ReferenceError` at module-load time (or, if the runtime treats bare identifiers followed by `(...)` as no-op expression statements that still reference undefined names, it would throw on `getCoupons` not being defined). **Confirmed via grep: nothing in `app/` imports `coupons.server`** — the file is not currently referenced anywhere in the codebase, so it never executes. Flagging as dead/placeholder code, likely a leftover stub for a coupons CRUD module that was never implemented (the actual coupon persistence lives in `coupon-sample.server.js` against the `coupons` table, and/or in `api.cart-settings.shared.js`'s mock data, and/or in `cart_drawer_config`/`coupon_slider_settings` for the live widget).

---

### app/services/db.server.js

**Purpose:** The MySQL connection layer referenced throughout CLAUDE.md as "direct mysql2/promise pool" — but **the actual implementation is an HTTPS proxy, not a direct TCP connection**. Per the file's own header comment: direct TCP MySQL access isn't available from where this app runs (Fly.io) to where MySQL lives (Hostinger, remote-MySQL connection-limited), so this "pool" is an HTTPS proxy to `php_backend/db_proxy.php`, which runs on the same server as MySQL and executes the statement locally.

**Exported functions:**
- `getDb()` → returns a singleton `{ execute: proxyExecute }` object. The shape (`db.execute(sql, params)` → `[rows]` for reads, `[{ insertId, affectedRows }]` for writes) intentionally mirrors `mysql2/promise`'s `pool.execute()` so the app's ~45 call sites (per file comment) didn't need to change when the proxy was introduced.

**Internal:** `isReadStatement(sql)` — regex test for `SELECT|SHOW|DESCRIBE|DESC|EXPLAIN` at the start of the statement (case-insensitive) to decide return shape. `proxyExecute(sql, params)` — `POST {BASE_PHP_URL}/db_proxy.php` with `{ sql, params }` body and `X-Forge-Secret: process.env.SHOPIFY_API_KEY` header; throws `Error` on non-JSON response, non-OK HTTP status, or `!json.success`.

**External services:** `{BASE_PHP_URL}/db_proxy.php` (imports `BASE_PHP_URL` from `app/utils/api-helpers.js`).

**Error handling:** Throws on any proxy failure (non-JSON body, HTTP error, or `success: false`) — callers must catch.

**IMPORTANT ARCHITECTURAL NOTE:** This is the module referenced by CLAUDE.md as "`app/services/db.server.js` — the production store. Direct `mysql2/promise` pool." That description is accurate as to *effect* (same call signature, same target DB `cart_drawer_ninja`) but **not as to mechanism** — there is no local TCP connection or connection pool; every query round-trips through PHP over HTTPS. This matters for latency/timeout reasoning and for understanding why `X-Forge-Secret` (= `SHOPIFY_API_KEY`) is required even for what look like "direct" DB reads.

**Consumed by:** 15+ files confirmed via grep: `ai-credits.server.js`, `analytics-query.server.js`, `analytics-aggregator.server.js`, `billing.server.js`, `analytics.server.js`, `upsell-rules.server.js`, `coupon-sample.server.js`, `upsell-recommendation.server.js`, `store-config-snapshot.server.js`, `combo-templates.server.js`, `plan-permissions.server.js`, plus route files directly.

---

### app/services/order-ingest.server.js

**Purpose:** Shared order-webhook-payload upsert logic — used by all four order webhook handlers (`create`/`updated`/`paid`/`cancelled`) so the upsert shape can't drift between them.

**Exported functions:**
- `upsertOrderFromPayload(db, shop, payload, { financialStatusOverride } = {})` → `Promise<{ dateStr, revenue, isNewOrder, cancelled }>`. Calls `ensureAnalyticsTables(db)` first. Determines `orderId` (stringified `payload.id`), `financialStatus` (override or `payload.financial_status` or `'pending'`), numeric totals via internal `toNum()` (parses float, defaults to 0 on NaN), and formats `created_at_shopify`/`cancelled_at` as MySQL datetime strings. Checks existing row (`isNewOrder` flag) via `SELECT id FROM store_orders WHERE shop_domain = ? AND order_id = ?`. Upserts `store_orders` (`ON DUPLICATE KEY UPDATE` on most fields, not `is_test`/`shop_domain`/`order_id`/`created_at_shopify`). Then loops `payload.line_items` and upserts each into `store_order_line_items`, computing `line_revenue = price * quantity - total_discount`.

**DB tables:** `store_orders`, `store_order_line_items` (writes); calls `ensureAnalyticsTables` which may create/alter several others.

**Business logic:** `isNewOrder` is determined by presence in `store_orders` **before** the upsert runs, so cancelled-order and repeat-webhook handling can distinguish "first time seeing this order" from "update to an existing order."

**Consumed by:** Per its own header comment — `webhooks.orders.create.jsx`, `webhooks.orders.updated.jsx`, `webhooks.orders.paid.jsx`, `webhooks.orders.cancelled.jsx` (all confirmed present via grep). The caller is expected to feed the returned `{ dateStr, revenue, isNewOrder }` into `analytics-aggregator.server.js`'s `applyOrderDelta()`.

---

### app/services/plan-permissions.server.js

**Purpose:** The plan/feature-gating resolution layer — determines a shop's current plan key and exposes feature-access helpers, backed by the `shops` MySQL table with an in-process cache.

**Exported functions:**
- `getShopPlan(shop)` → `Promise<string>` (plan key, default `'free'`). In-process cache (`planCache` Map, 30s TTL — `CACHE_TTL_MS = 30_000`) avoids redundant DB hits within one request cycle. Reads `SELECT plan_key, plan_name FROM shops WHERE shop_domain = ?`. If `plan_key` column is set and valid (`isValidPlanKey`), uses it directly; otherwise falls back to internal `aliasLegacyPlanName(planName)` (maps legacy `shops.plan_name` string values predating the `plan_key` column: `'free'` → `'free'`, contains `'pro'` → `'pro'`, anything else — including the historically mis-named "Cart Ninja Pro" which was actually the old $29 tier — → `'starter'`). On DB error, logs and defaults to `'free'`.
- `setPendingPlanKey(shop, planKey)` → upserts `shops.pending_plan_key`; invalidates the shop's plan cache entry. Called right after Shopify confirms subscription creation, before redirect, to record the *intended* plan (never inferred from parsing the subscription name string).
- `confirmPlanFromWebhook(shop, subscriptionStatus)` → `Promise<string>` (resolved plan key). Called by the `app_subscriptions/update` webhook. If status is `'active'` or `'pending'`, promotes `pending_plan_key` → `plan_key` (or keeps existing `plan_key` if no pending value, or falls back to `'free'`); any other status (cancelled/declined/expired) resets to `'free'`. Clears `pending_plan_key` in both branches. Invalidates cache.
- `getFeatureState(planKey, featureKey)`, `canAccessFeature(planKey, featureKey)`, `canPublishFeature(planKey, featureKey)`, `canPreviewFeature(planKey, featureKey)` — thin re-exports/pass-throughs to `app/config/plans` equivalents (`configGetFeatureState` etc., aliased on import).
- Re-exports `PLANS`, `PLAN_KEYS`, `getMinPlanForFeature` from `app/config/plans`.

**DB tables:** `shops` (columns `plan_key`, `pending_plan_key`, `plan_name` — first two added via `ensurePlanTables` if missing).

**Business logic:** The pending→confirmed plan promotion pattern exists specifically so plan_key is only ever set from either (a) an explicit merchant action (`setPendingPlanKey`) or (b) an explicit Shopify webhook confirmation (`confirmPlanFromWebhook`) — never inferred by string-matching a subscription name, which was the old (unreliable) approach still partially present via `aliasLegacyPlanName` for pre-migration rows.

**Consumed by:** `app.subscribe.jsx`, `app.billing.jsx`, `webhooks.app_subscriptions_update.jsx`, `combo-templates.server.js`, `ai-credits.server.js`, `billing.server.js`, plus most `api.*` routes that need feature gating (confirmed via broad grep of services importers).

---

### app/services/plan-schema.server.js

**Purpose:** Idempotent DDL for the pricing-plan/feature-gating and billing system — same convention as `analytics-schema.server.js`.

**Exported functions:**
- `ensurePlanTables(db)` → module-level `ensured` boolean guard. First checks/adds `shops.plan_key` (`VARCHAR(20) NOT NULL DEFAULT 'free'`) and `shops.pending_plan_key` (`VARCHAR(20) NULL`) via `SHOW COLUMNS FROM shops` + conditional `ALTER TABLE`. Then creates (if missing):
  - `order_overage_charges` — PK `id`, unique `(shop_domain, date)`; columns for `plan_key`, `order_count`, `order_cap`, `overage_orders`, `overage_rate DECIMAL(6,4)`, `charge_amount DECIMAL(10,2)`, `status`, `shopify_usage_record_id`, `error_message`.
  - `ai_brix_credit_usage` — PK `id`, unique `(shop_domain, period_key)`; `credits_used INT`.
  - `ai_brix_overage_charges` — PK `id`, unique `(shop_domain, period_key, credit_number)`; `plan_key`, `overage_rate DECIMAL(6,4)`, `charge_amount DECIMAL(10,2)`, `status`, `shopify_usage_record_id`, `error_message`.

**DB tables:** `shops` (altered), `order_overage_charges`, `ai_brix_credit_usage`, `ai_brix_overage_charges` (created).

**Consumed by:** `plan-permissions.server.js`, `billing.server.js`, `ai-credits.server.js` — every function that needs these tables calls `ensurePlanTables(db)` first.

---

### app/services/product-widget.server.js

**Purpose:** Loader/action pair for a "Product Widget" settings page (coupon config + FBT/"frequently bought together" config), backed by **Prisma `widgetSettings`** (not the MySQL `getDb()` path) — the one file in this scope that writes through the root `app/db.server.js` Prisma-shim client as `db.widgetSettings`.

**Exported functions:**
- `getProductWidgetData(request)` → `Promise<{ couponConfig, fbtConfig, products }>`. Authenticates via `authenticate.admin(request)`. Fetches up to 50 products via Admin GraphQL (`id`, `title`, `featuredImage.url`, first variant `price`). Reads `db.widgetSettings.findUnique({ where: { shop } })`; JSON-parses `settings.coupons`/`settings.fbt` if present, else falls back to `FAKE_COUPON_CONFIG`/`FAKE_FBT_CONFIG` from `product-widget.shared.js`.
- `saveProductWidgetData(request)` → handles two `actionType` form values:
  - `"saveCouponConfig"` — requires `activeTemplate` + `templateData`; parses `templateData`/`selectedActiveCoupons`/`couponOverrides` as JSON, builds a combined `couponConfig` object, `db.widgetSettings.upsert()`s it into the `coupons` column (creating the row with default FBT config if it doesn't exist).
  - `"saveFBTConfig"` — requires `mode` ∈ `['manual','ai']`; if `mode === 'ai'`, requires a non-empty `openaiKey` form field; upserts into the `fbt` column.
  - Any other `actionType` → `{ success: false, error: "Unknown action type" }`.

**DB tables/models:** Prisma model `widgetSettings` (SQLite, via root `app/db.server.js`), keyed by `shop`.

**External services:** Shopify Admin GraphQL (`products` query).

**Error handling:** Try/catch around DB writes returns `{ success: false, error: "Failed to save to database" }` and logs via `console.error`; missing required fields return `{ success: false, error: "Missing required fields" }` / `"Invalid mode"` / `"OpenAI API Key is required for AI mode"` without hitting the DB.

**Consumed by:** Not confirmed via grep in this pass (likely `app.productwidget.jsx`, which does appear in the broader `app/context`/`app/types` consumer grep list, suggesting a route of that name exists and is the probable caller).

---

### app/services/product-widget.shared.js

**Purpose:** Static mock/default config data + color-conversion utilities for the Product Widget feature (paired with `product-widget.server.js`).

**Exported constants:** `FAKE_COUPON_CONFIG` (3 templates: Classic Banner, Minimal Card, Bold & Vibrant — full styling fields), `FAKE_FBT_CONFIG` (3 templates: Classic Grid, Modern Cards, Vertical List, plus `aiSettings` defaults `{ aiEnabled: false, aiProductCount: 3, maxSuggestions: 3, customPrompt: "" }` and empty `manualRules`).

**Exported functions:**
- `hsbToHex({ hue, saturation, brightness })` → `string` (hex color). Standard HSB→RGB→hex conversion.
- `hexToHsb(hex)` → `{ hue, saturation, brightness }`. Handles 3-char shorthand hex. Standard RGB→HSB conversion.

**Consumed by:** `product-widget.server.js` (imports `FAKE_COUPON_CONFIG`, `FAKE_FBT_CONFIG`); the HSB/hex converters are presumably used by a Polaris color-picker component in the Product Widget UI (not confirmed in this scope).

---

### app/services/scheduler.server.js

**Purpose:** Registers all cron jobs for the app using `node-cron`, with an HMR-safe singleton guard.

**Exported functions:**
- `initScheduler()` → Uses `global.__analyticsSchedulerStarted` boolean (same idiom as `app/db.server.js`'s `global.prismaGlobal` pattern per the file's own comment) to prevent duplicate cron registration across Vite dev-server hot-reloads. Registers three jobs:
  1. `*/15 * * * *` (every 15 min) → `reconcileAllShops({ days: 3 })` — light reconciliation, catches recent drift/missed webhooks fast.
  2. `0 3 * * *` (3 AM daily) → `reconcileAllShops({ days: 35 })` — deep nightly reconciliation, catches late refunds/cancellations.
  3. `15 0 * * *` (00:15 UTC daily) → `runDailyOverageBilling()` — charges shops that exceeded their plan's order cap yesterday.
  All three wrap their async call in `.catch()` with `console.error` logging (never lets a cron callback throw unhandled).

**External services:** None directly (delegates to `analytics-aggregator.server.js` and `billing.server.js`).

**Consumed by:** Likely called once at app startup (server entry point) — not confirmed via grep in this scope, but its purpose and the `global.__analyticsSchedulerStarted` guard strongly imply a top-level bootstrap call site.

---

### app/services/store-config-snapshot.server.js

**Purpose:** Single-call read of every Brix widget's enabled/disabled flag — a reusable Node-side equivalent of what `php_backend/ai_agent_apply.php` already returns as its post-apply `after` payload, so read-only features (e.g. AOV/store-insights) don't need a PHP round-trip just to know current widget state.

**Exported functions:**
- `getStoreConfigSnapshot(shop)` → `Promise<{ cartDrawer, progressBar, upsells, fbt, couponSlider }>` (all booleans). Runs 5 parallel `SELECT is_enabled FROM <table> WHERE shop_domain = ? LIMIT 1` queries via `Promise.all` against `cart_drawer_config`, `progress_bar_settings`, `upsell_widget_settings`, `fbt_widget_settings`, `coupon_slider_settings`. Coerces each result to boolean via `!!row?.is_enabled`.

**DB tables:** `cart_drawer_config`, `progress_bar_settings`, `upsell_widget_settings`, `fbt_widget_settings`, `coupon_slider_settings` (reads only).

**Consumed by:** Likely `api.ai-agent.store-insights.jsx` (per grep pattern of AI routes importing services files; not individually confirmed at function level).

---

### app/services/storefront-upsell-integration.js

**Purpose:** **Reference/example client-side script**, not a server module — despite living in `app/services/`, this is plain browser JS meant to be copy-pasted into a Shopify theme (per its own header comment block: "This file demonstrates how to integrate the Upsell feature into your cart drawer... Add this script to your Shopify storefront theme"). No `.server.js` suffix, confirming it's not server-only code.

**Exported functions (for use if imported as an ES module in a theme bundle):** `fetchUpsellConfig()` (GET `/api/upsell`), `addUpsellProductToCart(productGid, quantity)` (POST Shopify's native `/cart/add.js`), `trackUpsellEvent(event, data)` (console.log + optional `window.gtag`/`window.Shopify.analytics` calls), `renderUpsellSection(containerSelector)` (fetches config, builds HTML via `buildUpsellHTML`, attaches click handlers), `initUpsellOnCartOpen()` (wires up listeners for `Shopify.CartDrawer` open event or a custom `cartDrawerOpen` DOM event).

**Also:** Injects a `<style>` block (`upsellStyles`) into `document.head` at module load time, and auto-runs `initUpsellOnCartOpen()` on `DOMContentLoaded` (or immediately if already loaded) — i.e. this file has side effects the moment it's evaluated in a browser context.

**External services:** Calls the app's own `/api/upsell` endpoint and Shopify's native `/cart/add.js` and `/cart.js` storefront AJAX API.

**Business logic:** None server-side — this is UI wiring/rendering logic for a theme integration example.

**Consumed by:** Not part of the Node/React Router build (no route or component imports found in this scope's grep). It is documentation-by-example for theme developers, likely superseded by the actual `extensions/cart-drawer/` Theme App Extension Liquid blocks described in CLAUDE.md.

---

### app/services/upsell-recommendation.server.js

**Purpose:** Generates a **real, data-driven** trigger/offer product pair for the "auto-pick the best upsell for me" AI flow — explicitly designed to never fabricate a recommendation.

**Exported functions:**
- `getBestUpsellPair(shop)` → `Promise<{ status: 'found', trigger: {id,title}, offer: {id,title}, basis: 'co-purchase'|'best-seller' } | { status: 'insufficient-data' }>`. Looks back 2 years (`todayMinusYears(2)`) to today. Calls `getTopProducts(shop, startDate, endDate, 10)` from `analytics-query.server.js`; if fewer than 2 products, returns `insufficient-data`. Otherwise calls internal `getTopCoPurchasedPair()` — a real basket-analysis SQL query self-joining `store_order_line_items` on `order_id` with `a.product_id < b.product_id` (string-dedup trick to count each pair once), joined to `store_orders` for non-cancelled filter, grouped by product pair, ordered by co-occurrence count DESC, `LIMIT 1`. If a pair is found, the product ranking higher among the top-10 best-sellers becomes the `trigger` (more likely to already be in a cart) and the other becomes the `offer`; `basis: 'co-purchase'`. If no co-purchase pair exists (too few multi-item orders), falls back to the top-2 best-selling products as trigger/offer with `basis: 'best-seller'` — still real revenue data, just not true basket analysis.

**DB tables:** `store_order_line_items`, `store_orders` (via the co-purchase query); delegates to `analytics-query.server.js`'s `getTopProducts` for best-seller ranking (`store_order_line_items` + `store_orders`).

**Business logic:** Two-tier recommendation strategy (co-purchase first, best-seller fallback), both grounded in real order data — never random or fabricated, consistent with the "BRIX truthfulness redesign" theme referenced in project memory.

**Consumed by:** `api.ai-agent.auto-upsell.jsx` (confirmed via grep: imports `getBestUpsellPair`).

---

### app/services/upsell-rules.server.js

**Purpose:** Product-name resolution (via Shopify Admin GraphQL) and manual upsell-rule mutation for the AI chat-driven upsell flow.

**Exported functions:**
- `resolveProductByName(admin, name)` → `Promise<{ status: 'found', id, title } | { status: 'not_found' } | { status: 'ambiguous', candidates }>`. Same three-way contract as `collection-resolver.server.js`'s `resolveCollectionByName`. Builds a `title:*<cleaned>*` query (internal `toTitleQuery`, strips `"`/`*`/`\`/`:` — the `:` strip is explicitly called out in a comment as necessary because Shopify's query DSL treats `:` as a field:value separator, and a literal colon in a product title like "The Collection Snowboard: Hydrogen" would otherwise break the query into something far looser than an exact wildcard match). Searches up to 10 products; prefers exact case-insensitive title match over flagging ambiguity (comment notes Shopify's search can return loosely-related products even for an exact merchant-provided name).
- `pickFromCandidates(message, candidates)` → resolves a merchant's disambiguation reply against a previously-shown candidate list. Match order: (1) ordinal words `['first','second','third','fourth','fifth']` matched against candidate index; (2) a bare digit 1-9 matched against `candidates[n-1]`; (3) exact lowercase title match; (4) substring containment match **only if exactly one candidate matches** (ambiguous substring matches return `null`). Returns `null` if nothing resolves.
- `appendUpsellRule(shop, { triggerProductId, triggerTitle, offerProductId, offerTitle })` → `Promise<{ rule, triggerTitle, offerTitle }>`. Reads existing `manual_rules` JSON column from `upsell_widget_settings`, appends a new rule (`{ id: 'rule-<timestamp>', triggerProductCount: 1, triggerProductIds: [triggerProductId], upsellProductCount: 1, upsellProductIds: [offerProductId] }`), then `INSERT ... ON DUPLICATE KEY UPDATE` — **deliberately touches only `manual_rules` and `is_enabled`** (forces `is_enabled = 1`). The INSERT branch (new-row case) supplies hardcoded defaults for title/colors/layout/etc. that only apply if no row exists yet; the UPDATE branch preserves all existing values except `manual_rules`/`is_enabled`/`updated_at`. Comment explicitly notes this asymmetry is intentional: the AI agent has no knowledge of the merchant's existing title/colors/layout, so writing those columns unconditionally would clobber real values with fallback defaults.

**DB tables:** `upsell_widget_settings` (read `manual_rules`, write `manual_rules` + `is_enabled`).

**External services:** Shopify Admin GraphQL (`products(first: 10, query: ...)`).

**Consumed by:** `api.ai-agent.combo-turn.jsx` (`pickFromCandidates`), `api.ai-agent.auto-upsell.jsx` (`appendUpsellRule`), `api.ai-agent.upsell-rule-turn.jsx` (`resolveProductByName`, `pickFromCandidates`, `appendUpsellRule`) — all confirmed via grep.

---

### app/services/billing.server.js

**Purpose:** Shopify usage-billing integration — records `AppUsageRecordCreate` charges for both order-count overage and AI BRIX credit overage, plus the daily cron entrypoint and manual "Record Usage Charge" trigger.

**Exported functions:**
- `chargeAiCreditOverage(admin, shop, periodKey, creditNumber, planKey, overageRate)` → `Promise<{ success, chargeAmount?, usageRecordId?, error? } | { skipped: true, reason }>`. Idempotent on `(shop, periodKey, creditNumber)` via a `SELECT status FROM ai_brix_overage_charges` pre-check — skips if already `'charged'`. Upserts a `pending` row, then (if `admin` client provided) calls internal `createUsageCharge()`. On success, updates row to `status = 'charged'` with `shopify_usage_record_id`; on failure, `status = 'failed'` with `error_message`. If no `admin` client is available, immediately marks `failed` with `"No admin client available for this shop"`.
- `runDailyOverageBilling(dateOverride)` → `Promise<Array<{shop, date, ...result}>>`. Defaults to yesterday's date (UTC). Queries `analytics_daily_rollup` for all `(shop_domain, order_count)` rows with `order_count > 0` on that date, and for each shop calls `unauthenticated.admin(shop)` (from `app/shopify.server`) to get an admin client, then internal `chargeOverageForShopDate()`. Per-shop errors are caught and pushed into results (does not abort the batch).
- `chargeOverageForToday(admin, shop)` → manual trigger variant of the above for "today," using an already-authenticated `admin` client (used by the Billing dashboard's "Record Usage Charge" button).
- `getTodayUsage(shop)` → `Promise<{ planKey, free_orders, total_orders, overage_orders, pending_charge, unlimited }>`. Reads today's `order_count` from `analytics_daily_rollup`; `unlimited` is `true` when `plan.orderCap === null`.
- `getChargeHistory(shop, limit = 30)` → `SELECT date, overage_orders, charge_amount, status FROM order_overage_charges WHERE shop_domain = ? ORDER BY date DESC LIMIT ?`.

**Internal functions:** `findUsageLineItem(admin, termsIncludes)` — queries `currentAppInstallation.activeSubscriptions`, finds the `ACTIVE` subscription, then finds the specific `AppUsagePricing` line item whose `terms` text includes `termsIncludes` (a shop can have multiple usage-pricing line items, e.g. one for order overage — matched via `'per order above'` — and one for AI credit overage — matched via `'per AI BRIX credit'`). `createUsageCharge(admin, { amount, description, termsIncludes })` — calls the `appUsageRecordCreate` GraphQL mutation with `price: { amount: amount.toFixed(2), currencyCode: 'USD' }`; checks `userErrors`. `chargeOverageForShopDate(db, admin, shop, date, orderCount)` — computes `overageOrders = orderCount - plan.orderCap`, `chargeAmount = overageOrders * plan.overageRate`; idempotent via a `SELECT status FROM order_overage_charges` pre-check (skips if already `'charged'`); if `plan.orderCap === null` (unlimited plan) or `orderCount <= plan.orderCap`, skips with `reason: 'within cap or unlimited plan'`.

**DB tables:** `order_overage_charges` (read/write), `ai_brix_overage_charges` (read/write), `analytics_daily_rollup` (read).

**External services:** Shopify Admin GraphQL — `currentAppInstallation.activeSubscriptions` query and `appUsageRecordCreate` mutation. Also `unauthenticated.admin(shop)` from `app/shopify.server` for the cron path (no live session available).

**Business logic:** All charges are hard-currency-USD (`'USD'` hardcoded in `createUsageCharge`, regardless of shop currency). All charge functions are idempotent by design (status-check-before-charge) since both the cron job and manual triggers might run against the same shop/date/credit more than once. Order overage = `(orderCount - orderCap) * overageRate` per plan (from `PLANS[planKey]`, `app/config/plans`). AI credit overage = flat `overageRate` per credit past the cap (computed by the caller in `ai-credits.server.js`, this file just charges it).

**Error handling:** GraphQL `userErrors` are surfaced as `{ success: false, error: userErrors[0].message }`. No admin client (e.g. shop token expired/app uninstalled) is treated as a clean failure path, not an exception — logged into the charge row's `error_message` and returned as `{ success: false, error }`.

**Consumed by:** `ai-credits.server.js` (`chargeAiCreditOverage`), `scheduler.server.js` (`runDailyOverageBilling` via cron), `app.billing.jsx`/`api.billing.trigger-charge.jsx`/`api.billing.get-usage.jsx`/`api.billing.charges.jsx` (per grep of routes importing services), `webhooks.app_subscriptions_update.jsx`.

---

## app/utils/

### app/utils/analytics.shared.js

**Purpose:** Small pure-function utilities for KPI comparison math, shared between client and server so delta calculations render identically everywhere.

**Exported functions:**
- `pctChange(curr, prev)` → `number` (rounded integer percent). Returns `100` if `prev` is falsy and `curr > 0`, else `0` if both are falsy/zero, else `Math.round(((curr-prev)/prev)*100)`.
- `safeDivide(numerator, denominator)` → `denominator > 0 ? numerator/denominator : 0`. Div-by-zero guard used throughout `analytics-query.server.js`.
- `previousPeriodRange(startDate, endDate)` → `{ startDate, endDate }` for the immediately preceding period of equal length (e.g. "last 7 days" → the 7 days before that), used for period-over-period comparison.

**Consumed by:** `analytics-query.server.js` (`safeDivide`); likely also client-side analytics dashboard components for the same delta math (not confirmed in this scope).

---

### app/utils/api-helpers.js

**Purpose:** The primary Node.js client for the PHP backend (`app/utils/api-helpers.js` per CLAUDE.md) — this is the largest/most heavily-used utils file, handling template/discount CRUD proxying, analytics fetching/transformation, and Shopify GraphQL helpers for discounts/orders/AI-usage stats. Defines `BASE_PHP_URL`, the constant referenced throughout CLAUDE.md and other services.

**Exported constants:** `BASE_PHP_URL = process.env.PHP_BASE_URL || 'http://localhost/cartdrawerv2_ui/php_backend'`.

**Exported functions:**
- `formatToIST(dateString = null, timeZone = 'Asia/Kolkata')` → `string`. Formats a date/now in a given timezone (default IST) as `DD/MM/YYYY, HH:MM:SS AM/PM`.
- `getDb(shop = null)` → `Promise<{ templates, discounts }>`. Fetches `templates.php` and `discount.php` from the PHP backend in parallel (both tolerant of parse failures, defaulting to `{ data: [] }`). **Note:** this is a *different* `getDb` than `services/db.server.js`'s — this one is Combo Forge template/discount data, not a generic SQL executor.
- `saveDb(data)` → no-op stub (logged only); legacy holdover from a `fake_db.json` era, kept to prevent crashes in old call sites.
- `sendToPhp(payload, endpoint)` → `Promise<object>`. `POST {BASE_PHP_URL}/{endpoint}` with `X-Forge-Secret: process.env.SHOPIFY_API_KEY` header. Throws on missing `endpoint`, non-OK HTTP status, or logs+rethrows on any fetch error. Non-JSON responses are wrapped as `{ text: resultText }` rather than throwing.
- `sendShopData(shopData, shopDomain = null)` → wraps `sendToPhp({ event: 'shop_sync', resource: 'shop', shop, data: shopData }, 'shop.php')`.
- `sendDiscountData(discountData, action = 'create')` → wraps `sendToPhp({ event: action, resource: 'discount', data }, 'discount.php')`.
- `sendTemplateData(templateData, action = 'create')` → wraps `sendToPhp({ event: action, resource: 'templates', data }, 'templates.php')`.
- `getVisitors(shop, start, end)` → `GET {BASE_PHP_URL}/visitors.php`; tolerant of several response shapes (`result.data`/`result.visitors`/bare array); returns `[]` on error.
- `getClicks(shop, start, end)` → same pattern against `clicks.php`.
- `transformAnalytics(visitors = [], clicks = [])` → pure function that joins visitor/click arrays by `template_name`/`template`/`layout` field (checks multiple possible field names), computes per-template conversion rate (`clicks/visitors*100`), identifies `topTemplate` (most clicks, excluding `'Unknown'`), and builds a daily `chartData` array (MM-DD shortened dates) from click timestamps.
- `getShopifyDiscounts(admin)` → `Promise<Array<{title,code,status,usedCount,usage}>>`. Admin GraphQL query for `discountNodes` (basic/BXGY/free-shipping discount types), extracts `asyncUsageCount` and `usageLimit`, formats `usage` as `"<used> / <limit or Unlimited>"`.
- `getShopifyOrders(admin, start, end)` → `Promise<{ordersCount, totalRevenue, currencyCode}>`. Admin GraphQL orders query filtered to `financial_status:paid AND tag:combo-builder` (i.e. **only counts orders that came through the combo builder page**) within a date range.
- `getAiUsageStats(prisma, shop, start, end)` → `Promise<{total, recommend, sparkleTitle, sparkleDescription, sparkleStep, sparkleCollection}>`. Raw SQL counts (`prisma.$queryRawUnsafe`) against a SQLite `"AiUsageLog"` table, filtered by `shop`/date range/`feature` column, run in parallel for each feature type. Each count query independently try/caught (defaults to 0, logged as warning).
- `getAnalytics(shop, start, end, dateRange, admin = null)` → `Promise<object|null>`. The most complex function in this file — a "Unified Analytics Fetcher" that combines: `analytics.php` (visitor/click data), `discount.php` (discount list), `orders.php` (revenue/AOV — explicitly documented as "the single source of truth" for revenue, never fetched from Shopify directly in this path), a stub `aiStats` placeholder, `templates.php` (for canonical template name resolution), and (if `admin` provided) a live Shopify `shop { currencyCode moneyFormat ianaTimezone }` query. Performs template-name canonicalization (normalizes aliases/handles/slugs to one canonical display name so duplicate template rows with different slug spellings merge), computes `aov`, `orderConversionRate = totalOrders/totalVisitors*100` ("CVR = confirmed combo orders ÷ combo page visitors × 100" per inline comment), and `revenueByDiscount`. Returns `null` on top-level fetch failure.

**External services:** PHP backend endpoints `templates.php`, `discount.php`, `shop.php`, `visitors.php`, `clicks.php`, `analytics.php`, `orders.php`; Shopify Admin GraphQL (`discountNodes`, `orders`, `shop`).

**Business logic:** Revenue/AOV data is explicitly documented (inline comments) as sourced exclusively from `orders.php` (PHP `combo_orders` table), never from Shopify Admin API directly — a deliberate single-source-of-truth decision for the Combo Forge analytics dashboard. The `getShopifyOrders` query is scoped to `tag:combo-builder` orders only.

**Error handling:** Nearly every fetch is wrapped in try/catch with fallback empty/zero values and `console.error`/`console.warn` logging — this file is defensive-by-default against PHP backend downtime, at the cost of silently returning empty data rather than surfacing errors to the UI in most functions (except `getAnalytics`, which returns `null` on total failure).

**Consumed by:** Widely imported — grep found 20+ route files (`app.subscribe.jsx`, `app.jsx`, `app.billing.jsx`, `app.additional.jsx`, `app._index.jsx`, `api.analytics.*.jsx` family, `app.discounts.create.jsx`, `api.cartdrawer-config.jsx`, `api.bundle-templates.jsx`, `save_cart_drawer[.]php.jsx`, `app.fbt.jsx`, various `api.ai-agent.*.jsx` turns, webhook handlers). `BASE_PHP_URL` specifically is re-exported/imported by `app/services/db.server.js` and root `app/db.server.js`.

---

### app/utils/bundle-api-helpers.js

**Purpose:** Client-side (browser `fetch`-based) helper module for the Combo Forge bundle-template CRUD and embed-status flows — a separate, smaller PHP client than `api-helpers.js`, pointed at a **different** PHP base URL.

**Exported constant/pattern:** Hardcoded `const PHP_BASE = 'https://int.thecartninja.com'` (not env-configurable, unlike `BASE_PHP_URL` in `api-helpers.js` — **inconsistency noted**: this file always hits the production `thecartninja.com` PHP host directly, regardless of `PHP_BASE_URL` env var).

**Exported functions:**
- `sendToPhp(endpoint, payload)` — note the **argument order is reversed** relative to `api-helpers.js`'s `sendToPhp(payload, endpoint)`; POSTs to `{PHP_BASE}/{endpoint}` with `ngrok-skip-browser-warning` header (no `X-Forge-Secret` auth header, unlike `api-helpers.js`'s version).
- `fetchBundleTemplates(shop)` → `GET /api/bundle-templates?shop=<shop>` (relative to `window.location.origin` — i.e. calls this app's own Node route, not PHP directly).
- `saveBundleTemplate(data, extraHeaders = {})` → `POST /api/bundle-templates` (own app route).
- `deleteBundleTemplate(id)` → `DELETE /api/bundle-templates`.
- `fetchBundleAnalytics(shop)` → `GET /api/bundle-analytics?shop=<shop>` (own app route).
- `getBundleEmbedStatus(shop)` → `GET https://int.thecartninja.com/combo_embed_status.php?shop=<shop>` — direct PHP call (bypasses the app's own API layer), returns `{ embedded: false }` on any failure.
- `setBundleEmbedStatus(shop, embedded)` → `POST https://int.thecartninja.com/combo_embed_status.php` — direct PHP call.

**External services:** This app's own `/api/bundle-templates`, `/api/bundle-analytics` routes; direct calls to `https://int.thecartninja.com/combo_embed_status.php`.

**Note — client-side file:** Uses `window.location.origin`, so this module is meant to run in the browser (not `.server.js` suffixed), imported by client components in the bundle builder UI.

**Consumed by:** Not confirmed via grep in this scope (likely `app.bundles.customize.jsx`/`app.bundles._index.jsx`/`TemplateManager.jsx` per CLAUDE.md's description of the Combo Forge builder, which is outside this agent's route/component scope).

---

### app/utils/currency.server.js

**Purpose:** Server-side currency-symbol resolution from the shop's Shopify `currencyCode`, with an in-process cache.

**Exported functions:**
- `getShopCurrencySymbol(admin, shop)` → `Promise<string>`. In-process cache (`currencyCache` Map, 5-minute TTL — `CURRENCY_CACHE_TTL_MS = 5 * 60_000`), keyed by `shop`, explicitly modeled on `plan-permissions.server.js`'s plan cache since this loader "runs on every `/app/*` navigation" (shared layout route) and a shop's currency essentially never changes. Queries `shop { currencyCode }` via Admin GraphQL, maps the code to a symbol via `getCurrencySymbolFromCode`. Returns `"$"` if no `admin` client, no `currencyCode` returned, or on any GraphQL error (all logged via `console.warn`/`console.error`).
- `getCurrencySymbolFromCode(currencyCode)` → `string`. Static lookup table covering 31 currency codes (USD, EUR, GBP, JPY, INR, AUD, CAD, CHF, CNY, SEK, NZD, MXN, SGD, HKD, NOK, KRW, TRY, RUB, BRL, ZAR, THB, MYR, PHP, IDR, VND, KES, NGN, PKR, BDT, AED, SAR, QAR); falls back to returning the code itself if unmapped.
- `formatCurrency(value, currencyCode = "USD", locale = "en-US")` → `string`. Formats via `toLocaleString` with a currency-specific locale map (12 explicit locale mappings) and 0 decimal places for JPY/KRW, 2 decimals otherwise. Wrapped in try/catch, falls back to plain `${value}` string on error.
- `createCurrencyContext(currencySymbol = "$", currencyCode = "USD")` → `{ symbol, code }` plain object constructor.

**External services:** Shopify Admin GraphQL (`shop { currencyCode }`).

**Consumed by:** Likely the shared `/app/*` layout loader per the file's own comment (probably `app.jsx`), and various components needing a formatted currency display — not individually confirmed via function-level grep in this scope.

---

### app/utils/currency.shared.js

**Purpose:** Client-and-server-safe currency utilities (no `admin`/network dependency) — the pure-logic counterpart to `currency.server.js`.

**Exported functions:**
- `getCurrencySymbol(currencyCode = "USD")` → same 31-entry symbol map as `currency.server.js`'s `getCurrencySymbolFromCode` (duplicated, not re-exported/shared — **two independent copies of the same lookup table exist in this codebase**).
- `formatAmount(value, currencySymbol = "$", currencyCode = "USD", locale = "en-US")` → same formatting logic as `currency.server.js`'s `formatCurrency`, but takes an already-resolved `currencySymbol` string as a parameter instead of deriving it internally — usable without a currency-code lookup at call time.
- `parseCurrencyToNumber(formatted)` → strips all non-numeric/non-`.`/non-`-` characters from a formatted currency string and parses as float; returns `0` on failure, passes through numbers unchanged.
- `toLocaleAmount(value, locale = "en-US", decimals = 2)` → thin wrapper around `toLocaleString` with fixed decimal places.
- `getLocaleForCurrency(currencyCode)` → locale map (14 entries, a superset of `currency.server.js`'s inline map — adds BRL→pt-BR, MXN→es-MX, ZAR→en-ZA not present in the server file's map).

**Consumed by:** Both server and client code (per file's "works on both client and server" header comment) — not individually confirmed via function-level grep in this scope, but its lack of `.server.js` suffix and lack of network/`admin` dependency confirm it's the shared/isomorphic variant.

---

## app/context/

### app/context/CartEditorContext.jsx

**Purpose:** The single source of truth for all Cart Editor state (per CLAUDE.md) — a React Context provider (`CartEditorProvider`) plus consumer hook (`useCartEditor`), backing `app/routes/app.cartdrawer.jsx`'s live-preview builder.

**Exported:**
- `CartEditorProvider({ children, availableCoupons = [], allProducts = [], initialStatus, initialRecord, initialConfigRecord, initialPbRecord, initialCsRecord, initialUpsellRecord })` — the provider component.
- `useCartEditor()` — consumer hook; throws `Error('useCartEditor must be used within CartEditorProvider')` if called outside the provider.

**State initialization (hydration pipeline, applied in order):**
1. `base` = `defaultCartEditorState` (from `cartEditorTypes.js`), with `status` overridden by `initialStatus` if provided.
2. `hydrateFromRecord(initialRecord, base)` — hydrates from the legacy `cart_drawer` blob record: `status` from `cartStatus`/`cart_status` flag; `body.progressBar`/`body.couponSlider`/`body.upsellProducts` from JSON-parsed `progress_data`/`coupon_data`/`upsell_data` columns plus their respective `*_status` enable flags; `footer.checkoutButton` from `checkoutName`/`checkoutFooterText`/JSON-parsed `checkout_button_style`; `footer.customCSS`/`footer.watermarkEnabled` from top-level columns.
3. `hydrateFromConfig(initialConfigRecord, base)` — hydrates from the normalized `cart_drawer_config` table: `settings.general` (`open_on_add`, `open_on_icon_click`, `position`), `settings.design` (`design_width`, `design_border_radius`, `design_shadow`, `design_animation`), `header` (`header_title`, `header_close_style`, `header_bg_color`, `header_text_color`, `header_border_bottom`), `body.announcements` (`announcement_*` columns), `body.emptyCart` (`empty_cart_*` columns), `footer.checkoutButton` (`checkout_button_*` columns), `footer.customCSS` (`custom_css`).
4. `hydrateFromProgressBar(initialPbRecord, base)` — hydrates from `progress_bar_settings`: `enabled` (`is_enabled`), `mode`, `showWhenEmpty` (`show_on_empty`), `position` (`placement`), `borderRadius`, `completionMessage` (`completion_text`), `confetti` (`enable_confetti`), `colors.{background,fill,icon,message}` (`bar_background_color`/`bar_foreground_color`/`icon_color`/`completion_text_color`), and `tiers` array mapped from the DB's `tiers` (each normalizing `min_value`/`minValue`/`minimumSpend` into both `minValue` and `minimumSpend` keys — kept in sync for DB/storefront vs. editor-UI/preview compatibility).
5. `hydrateFromCouponSlider(initialCsRecord, base)` — hydrates from `coupon_slider_settings`: `enabled` (`is_enabled`), `template` (`selected_template`), `sectionTitle`/`titleColor`/`titleFontSize`/`titleTextAlign`, `position` (normalized via `normalizeCouponPosition` — maps legacy Product Widget placement values `above_cart`/`above_atc`→`top`, `below_cart`/`below_atc`→`bottom`), `layout`. `selectedCoupons` is **only** overridden if every element of `selected_coupons` is a full object (not bare GID strings, which are incompatible with the Cart Editor's coupon-card format — this guards against Product-Widget-originated GID arrays leaking into the Cart Editor).
6. `hydrateFromUpsell(initialUpsellRecord, base)` — hydrates from `upsell_widget_settings`: `enabled` (`is_enabled`), `title`/`titleColor`, `showWhenEmpty` (`show_on_empty_cart`), `layout`, `buttonText`/`buttonColor`(`button_bg_color`)/`buttonTextColor`(`button_text_color`)/`buttonBorderRadius`(`button_border_radius`, default 6), `showPrice` (`show_price`), `position`, `limit` (`display_limit`), `manualRules` (array from `manual_rules`).

Console-logs the hydrated `couponSlider.enabled`/`progressBar.enabled`/`upsellProducts.enabled` values at init (debug logging left in place).

**Live-update side effects (useEffect hooks):**
- On mount, if none of `initialCsRecord`/`initialPbRecord`/`initialUpsellRecord` were provided (i.e. no fresh DB records), reads `localStorage['cartninja_cart_config']` and merges it via internal `mergeConfigIntoState()` (DB records are authoritative when present; localStorage is only a fallback for real-time AI-agent-driven updates when the editor loaded without a DB record).
- Listens for a `window` `"cartEditorConfigUpdated"` CustomEvent — applies AI-agent-driven color/config changes live to the editor state (drawer enabled/disabled, progress-bar color/enabled, upsell button/accent color/enabled, coupon-slider enabled, announcement text/colors/enabled, header colors, checkout-button style) without touching `isDirty`.
- Listens for `"featureStateChanged"` (custom) and `"storage"` (native) events — maps a `featureStore` key (`progress_bar`/`coupon_slider`/`upsells`/`announcements`) to the corresponding `body` key and toggles its `enabled` flag directly for a fast-path update; falls back to a full `mergeConfigIntoState(prev, loadCartConfig())` re-read for other event shapes.

**Exposed state (via context value):** All of `state` (spread) — `status`, `activeSection`, `previewMode`, `previewDevice`, `isDirty`, `settings.{design,general}`, `header`, `body.{announcements,progressBar,couponSlider,upsellProducts,countdownTimer,emptyCart}`, `footer.{checkoutButton,customCSS,watermarkEnabled}` — plus `availableCoupons`, `allProducts` (passed through from provider props, not part of `state`), and `openSection`.

**Exposed updater functions (all `useCallback`, all set `isDirty: true` except where noted):**
- `setActiveSection(section)` — no `isDirty` change.
- `navigateToSection(id)` — sets `openSection` + `activeSection`, and atomically switches `previewMode` to `'empty'` when navigating to `emptyCart`, or back to `'items'` when leaving `emptyCart` from `'empty'` mode. No `isDirty` change.
- `setPreviewMode(mode)`, `setPreviewDevice(device)` — no `isDirty` change.
- `setStatus(status)` — no `isDirty` change (comment: status toggles persist immediately outside the Save flow, so shouldn't mark the editor dirty).
- `updateDesign(design)` → merges into `settings.design`.
- `updateGeneral(general)` → merges into `settings.general`.
- `updateHeader(header)` → merges into `header`.
- `updateAnnouncements(data)` → merges into `body.announcements`.
- `updateProgressBar(data)` → merges into `body.progressBar`.
- `updateCouponSlider(data)` → merges into `body.couponSlider`.
- `updateUpsellProducts(data)` → merges into `body.upsellProducts`.
- `updateCountdownTimer(data)` → merges into `body.countdownTimer`.
- `updateEmptyCart(data)` → merges into `body.emptyCart`.
- `updateCheckoutButton(data)` → merges into `footer.checkoutButton`.
- `addCouponSliderItem(item)` / `removeCouponSliderItem(id)` / `updateCouponSliderItem(id, updates)` → array operations on `body.couponSlider.selectedCoupons`.
- `addUpsellRule(rule)` / `removeUpsellRule(id)` / `updateUpsellRule(id, updates)` → array operations on `body.upsellProducts.manualRules`.
- `updateCustomCSS(css)` → sets `footer.customCSS`.
- `updateWatermark(enabled)` → sets `footer.watermarkEnabled`.
- `resetDirty()` → sets `isDirty: false` (called after a successful save).
- `resetAll()` → resets entire state to `defaultCartEditorState` (discards `availableCoupons`/`allProducts`/hydration too, since it replaces the whole `state` — though those are provider props, not state, so they'd persist unless the provider itself re-mounts).

**Consumed by:** `app.cartdrawer.jsx` (the editor route itself), `CartEditorPage.jsx`, `CartEditorSidebar.jsx`, `CartPreview.jsx`, and section components `DesignSection.jsx`, `AnnouncementsSection.jsx`, `ProgressBarSection.jsx`, `CouponSliderSection.jsx`, `UpsellSection.jsx`, `CustomCSSSection.jsx`, `GeneralSection.jsx`, `EmptyCartSection.jsx`, `HeaderSection.jsx`, `CheckoutSection.jsx` — all confirmed via grep.

---

## app/types/

### app/types/cartEditorTypes.js

**Purpose:** Defines the default/initial shape of all Cart Editor state (`defaultCartEditorState`) and the sidebar's section/navigation metadata (`SECTION_GROUPS`), consumed directly by `CartEditorContext.jsx`.

**Exported constants:**

- `defaultTier` — a single default progress-bar milestone: `{ id: 'tier-1', minimumSpend: 500, title: 'First Reward', description: 'Unlock your first milestone reward', icon: 'gift', rewardProducts: [], rewardProductCount: 0 }`.

- `defaultCartEditorState` — full shape:
  ```
  {
    status: 'active',
    activeSection: 'general',
    previewMode: 'items',
    previewDevice: 'desktop',
    isDirty: false,
    settings: {
      design: { width: 'normal', borderRadius: 8, shadow: true, animation: 'slide' },
      general: { openOnAdd: true, openOnIconClick: true, showContinueShopping: true, position: 'right' },
    },
    header: { title: 'Your Cart', closeStyle: 'icon', bgColor: '#ffffff', textColor: '#1a1a1a', borderBottom: true },
    body: {
      announcements: { enabled: false, text: 'Free shipping on orders over ₹999!', bgColor: '#4f46e5', textColor: '#ffffff', fontSize: 14 },
      progressBar: {
        enabled: false, mode: 'amount', position: 'top', showWhenEmpty: false,
        tiers: [defaultTier],
        colors: { background: '#e5e7eb', fill: '#10b981', icon: '#2563eb', message: '#10b981' },
        borderRadius: 8, completionMessage: 'All Rewards Unlocked!',
        messageTemplate: "You're {amount} away", confetti: true,
      },
      couponSlider: {
        enabled: false, template: 'classic-banner', position: 'top', layout: 'grid',
        alignment: 'horizontal', singleCouponAlignment: 'left', showWhenEmpty: false,
        sectionTitle: 'Apply Coupon', titleFontSize: 14, titleTextAlign: 'left',
        titleColor: '#1e293b', selectedCoupons: [],
      },
      upsellProducts: {
        enabled: false, useAI: false, showWhenEmpty: false, title: 'Recommended For You',
        titleColor: '#1a1a1a', buttonText: 'Add', position: 'bottom', direction: 'horizontal',
        layout: 'carousel', limit: 3, showReviews: false, showIfInCart: false, manualRules: [],
      },
      countdownTimer: {
        enabled: false, mode: 'session', hours: 0, minutes: 15, label: 'Offer expires in',
        expiredLabel: 'Offer expired!', bgColor: '#fef2f2', textColor: '#991b1b',
        accentColor: '#dc2626', showOnProducts: true, showOnCoupons: true,
        couponCode: 'FLASH20', couponMode: 'manual',
      },
      emptyCart: { message: 'Your cart is empty', showContinueShopping: true, showRecommendations: true },
    },
    footer: {
      checkoutButton: {
        text: 'Checkout', footerText: 'Shipping and taxes calculated at checkout',
        bgColor: '#000000', textColor: '#ffffff', borderRadius: 8, mobileButtonType: 'standard',
      },
      customCSS: '',
      watermarkEnabled: true,
    },
  }
  ```
  Note: `body.countdownTimer` is present in the default state shape but is **not** one of the fields hydrated by any of `CartEditorContext.jsx`'s `hydrateFrom*` functions (no `hydrateFromCountdownTimer`) — it has an `updateCountdownTimer` setter in the context but no observed DB-backed hydration path in this scope, suggesting the countdown timer feature's persistence layer (if any) lives outside `cart_drawer_config`/the four hydrated tables, or is not yet wired to a save/load path.

- `SECTION_GROUPS` — sidebar navigation metadata, 4 groups:
  - **Settings**: `design` (Design), `general` (General).
  - **Header**: `header` (Header Style).
  - **Body**: `announcements` (toggleable, `enabledKey: 'announcements'`), `progressBar` (toggleable), `couponSlider` (toggleable), `upsellProducts` (toggleable), `emptyCart` (not toggleable).
  - **Footer**: `checkoutButton` (Checkout Button), `customCSS` (Custom CSS).
  Each item has `{ id, label, icon, toggleable?, enabledKey? }` — `toggleable`/`enabledKey` presumably drive an on/off switch rendered next to the section name in the sidebar, keyed against the matching `body.<enabledKey>.enabled` state.

**Consumed by:** `CartEditorContext.jsx` (imports `defaultCartEditorState` directly); `SECTION_GROUPS` is presumably consumed by `CartEditorSidebar.jsx` (outside this scope's route/component coverage, not confirmed by function-level grep, but strongly implied by its structure and CLAUDE.md's description of `CartEditorSidebar`).

---

## Root-level

### app/db.server.js (root — distinct from app/services/db.server.js)

**Purpose:** CLAUDE.md describes this as "SQLite via Prisma... Connection via `app/db.server.js` (exports default Prisma client)." **This description does not match the actual file contents.** The real implementation is **not a PrismaClient instance** — it's a hand-written shim object that mimics Prisma's raw-query interface (`$queryRawUnsafe`, `$executeRawUnsafe`) but proxies every call over HTTPS to `php_backend/db_proxy.php`, exactly like `app/services/db.server.js` does for MySQL.

Per the file's own header comment: this app's MySQL data (`combo_templates`, etc.) lives on Hostinger, and this Node app has no direct MySQL route to it — so the small number of routes that used Prisma's MySQL client for raw queries proxy through `db_proxy.php` over HTTPS instead. Prisma's raw-query provider (`mysql`) already used `?` placeholders and a `(sql, ...params)` call signature, matching this proxy 1:1, so callers needed no changes when this shim replaced whatever real Prisma client previously lived here. The comment also explicitly clarifies: **Shopify session storage does NOT use this file** — it has its own SQLite Prisma client (`app/session-db.server.js`, outside this scope), unaffected by any of this.

**Exported:** `export default prisma` — an object `{ $queryRawUnsafe: (sql, ...params) => rawExecute(sql, params), $executeRawUnsafe: (sql, ...params) => rawExecute(sql, params) }`.

**Internal:** `isReadStatement(sql)` (same regex as `services/db.server.js`), `rawExecute(sql, params)` — `POST {BASE_PHP_URL}/db_proxy.php` with `X-Forge-Secret` header; throws on non-JSON, non-OK, or `!json.success`; returns `json.rows` for reads or `json.affectedRows` for writes (note: **different return shape than `services/db.server.js`'s `[rows]`/`[{insertId,affectedRows}]` array-wrapping** — this one returns the raw value, matching Prisma's actual `$queryRawUnsafe`/`$executeRawUnsafe` return conventions instead of `mysql2`'s).

**IMPORTANT DISCREPANCY FLAG:** This file targets the **same MySQL database** (via the same `db_proxy.php` proxy and same `BASE_PHP_URL`) as `app/services/db.server.js` — it is **not** a connection to the SQLite database that Prisma's `schema.prisma` models (`combo_templates`, `combo_analytics`, `upsell_rules`, sessions) are defined against. Any route importing `prisma` from `app/db.server.js` and calling `$queryRawUnsafe('SELECT * FROM combo_templates ...')` is actually querying the **MySQL** `combo_templates` table over the PHP proxy, not a local SQLite file, despite the variable name `prisma` and CLAUDE.md's description implying local SQLite. This is confirmed by grep: `app.bundles.templates.jsx`, `app.bundles.customize.jsx`, `preview.$templateId.jsx` all import `prisma` from `../db.server` and (per CLAUDE.md's own architecture section) use `prisma.$queryRawUnsafe` against `combo_templates` — meaning **Combo Forge template storage is actually MySQL-backed via this proxy, not genuinely local SQLite**, despite being described as "SQLite via Prisma" in CLAUDE.md's Dual Database Pattern section. This should be treated as the most significant correction to the documented architecture found in this file set — flag prominently for whoever consumes this knowledge base. (Whether an actual `prisma/schema.prisma`-backed SQLite client exists and is used elsewhere for sessions was not verified in this scope — only this specific `app/db.server.js` file's contents were confirmed to be the PHP-proxy shim, not a real `PrismaClient`.)

**Consumed by:** `app.bundles.templates.jsx`, `app.bundles.customize.jsx`, `preview.$templateId.jsx` (all `import prisma from '../db.server'`), plus `product-widget.server.js` (`import db from "../db.server"`, used as `db.widgetSettings.findUnique`/`upsert` — **this call pattern is inconsistent with the shim's actual exported shape**, since the shim only exposes `$queryRawUnsafe`/`$executeRawUnsafe`, not a `widgetSettings` model accessor. This strongly suggests `product-widget.server.js` expects a genuine `PrismaClient` with a `WidgetSettings` model, not this raw-SQL shim — either this is dead/broken code, or there are two different `db.server.js` files depending on build alias/environment, or the file has changed since `product-widget.server.js` was last verified against it. **Not verified from source code** which is actually true at runtime; flagged as a likely bug or environment-specific behavior for a follow-up investigation.)

---

## Summary Table

| File | Directory | One-line Purpose | Key DB Tables |
|---|---|---|---|
| ai-credits.server.js | app/services | Tracks AI BRIX chat credit usage and triggers overage billing | `ai_brix_credit_usage` |
| ai-llm.server.js | app/services | Centralized NVIDIA NIM / OpenAI LLM call helper | none |
| ai-safety.server.js | app/services | Regex guard against false completion/promise claims in free-form chat | none |
| analytics-aggregator.server.js | app/services | Incremental + full-reconciliation rollup of daily analytics | `analytics_daily_rollup`, `store_orders`, `cart_click_events`, `combo_analytics`, `analytics_sessions`, `cart_activity_events` |
| analytics-query.server.js | app/services | Read-side analytics queries (totals, chart, top products/collections, funnel, activity) | `analytics_daily_rollup`, `store_order_line_items`, `store_orders`, `store_order_line_item_collections`, `combo_analytics` |
| analytics-schema.server.js | app/services | Idempotent DDL for all analytics tables | `store_orders`, `store_order_line_items`, `product_collection_cache`, `store_order_line_item_collections`, `cart_activity_events`, `analytics_sessions`, `app_usage_events`, `analytics_daily_rollup`, `analytics_insights_cache`, `combo_analytics` (ALTER) |
| analytics.server.js | app/services | Legacy hybrid analytics fetcher (PHP clicks + local order revenue) | `store_order_events` |
| api.cart-settings.jsx | app/services | Empty file (no content) | none |
| api.cart-settings.shared.js | app/services | Mock coupon/upsell data + rule validation/evaluation logic | none (client fetch + sessionStorage) |
| billing.server.js | app/services | Shopify usage-billing for order overage + AI credit overage | `order_overage_charges`, `ai_brix_overage_charges`, `analytics_daily_rollup` |
| cart-drawer-record.server.js | app/services | Legacy cart_drawer record client (PHP) with local JSON fallback | `cart_drawer` (via PHP) |
| catalog-snapshot.server.js | app/services | Bounded live catalog snapshot via Admin GraphQL (AI fallback data source) | none (GraphQL only) |
| collection-resolver.server.js | app/services | Resolves free-text collection name to a real collection via GraphQL | none (GraphQL only) |
| combo-templates.server.js | app/services | Shared Combo Forge plan-gate + template creation | `combo_templates` |
| coupon-sample.server.js | app/services | Reads active coupons for a shop | `coupons` |
| coupons.server.js | app/services | DEAD STUB — two invalid unexecuted lines, not imported anywhere | none |
| db.server.js | app/services | MySQL "pool" — actually an HTTPS proxy to php_backend/db_proxy.php | all MySQL tables (generic executor) |
| order-ingest.server.js | app/services | Shared order-webhook upsert logic | `store_orders`, `store_order_line_items` |
| plan-permissions.server.js | app/services | Resolves shop plan key + feature-gating helpers, with cache | `shops` |
| plan-schema.server.js | app/services | Idempotent DDL for plan/billing tables | `shops` (ALTER), `order_overage_charges`, `ai_brix_credit_usage`, `ai_brix_overage_charges` |
| product-widget.server.js | app/services | Loader/action for Product Widget coupon+FBT settings | Prisma `widgetSettings` |
| product-widget.shared.js | app/services | Mock Product Widget config data + HSB/hex color converters | none |
| scheduler.server.js | app/services | Registers all cron jobs (reconcile, overage billing) | none directly |
| store-config-snapshot.server.js | app/services | One-call read of all widget enabled/disabled flags | `cart_drawer_config`, `progress_bar_settings`, `upsell_widget_settings`, `fbt_widget_settings`, `coupon_slider_settings` |
| storefront-upsell-integration.js | app/services | Reference/example client-side theme script (not server code) | none |
| upsell-recommendation.server.js | app/services | Real basket-analysis-driven trigger/offer pair recommendation | `store_order_line_items`, `store_orders` |
| upsell-rules.server.js | app/services | Product name resolution (GraphQL) + manual upsell rule append | `upsell_widget_settings` |
| analytics.shared.js | app/utils | Shared pct-change / safe-divide / period-range math | none |
| api-helpers.js | app/utils | Primary PHP backend client — templates, discounts, analytics, orders, AI usage stats | none directly (PHP + GraphQL) |
| bundle-api-helpers.js | app/utils | Client-side Combo Forge bundle CRUD + embed-status helpers | none (own API routes + PHP) |
| currency.server.js | app/utils | Server-side currency symbol resolution with cache | none (GraphQL only) |
| currency.shared.js | app/utils | Isomorphic currency formatting utilities | none |
| CartEditorContext.jsx | app/context | Cart Editor single source of truth (React Context) | reads hydrated `cart_drawer`, `cart_drawer_config`, `progress_bar_settings`, `coupon_slider_settings`, `upsell_widget_settings` (via loader props, not direct DB access) |
| cartEditorTypes.js | app/types | Default Cart Editor state shape + sidebar section metadata | none |
| db.server.js (root) | app (root) | Mislabeled "Prisma client" — actually another MySQL-via-PHP-proxy shim | all MySQL tables (generic executor), notably `combo_templates` |

**Total files documented: 34** (26 `app/services`, 5 `app/utils`, 1 `app/context`, 1 `app/types`, 1 root `app/db.server.js`).

### Key findings worth flagging prominently

1. **`app/services/coupons.server.js` is dead/broken stub code** — two lines that aren't valid executable statements, confirmed unimported anywhere in `app/`.
2. **`app/services/api.cart-settings.jsx` is a completely empty file.**
3. **Root `app/db.server.js` is not a real PrismaClient** — it's an HTTPS-proxy shim to the same MySQL `db_proxy.php` backend as `app/services/db.server.js`, contradicting CLAUDE.md's "SQLite via Prisma" description for Combo Forge tables (`combo_templates` etc. appear to be MySQL-backed via this proxy in the routes that import it, not local SQLite).
4. **`product-widget.server.js` calls `db.widgetSettings.findUnique/upsert`** against the root `app/db.server.js` export, but that export's actual shape (`$queryRawUnsafe`/`$executeRawUnsafe` only) has no `widgetSettings` accessor — a likely latent bug or environment-specific mismatch, not verified further in this scope.
5. **Two independent copies of the currency-symbol lookup table** exist (`currency.server.js` and `currency.shared.js`), with a currency-symbol map duplicated verbatim and a locale map that has drifted (the `.shared.js` version has 3 more entries than `.server.js`).
6. **`app/utils/bundle-api-helpers.js` hardcodes `https://int.thecartninja.com`** (not env-configurable via `PHP_BASE_URL`, unlike `app/utils/api-helpers.js`'s `BASE_PHP_URL`), and its `sendToPhp(endpoint, payload)` argument order is reversed relative to `api-helpers.js`'s `sendToPhp(payload, endpoint)` of the same name — a naming collision risk for anyone importing both.
7. **`app/services/storefront-upsell-integration.js` is not server code** despite living in `app/services/` — it's a browser-side reference/example script with side effects on module evaluation (auto-injects styles, auto-runs on `DOMContentLoaded`), seemingly unused by the actual Node/React Router build.
8. All plan/billing/analytics/AI-credit tables are created via hand-written idempotent `CREATE TABLE IF NOT EXISTS` DDL functions (`ensureAnalyticsTables`, `ensurePlanTables`) rather than Prisma migrations — a deliberate choice per inline comments, to avoid an "orphaned-model problem" previously hit with `prisma/migrations/20260618000003_create_combo_forge_tables`.
