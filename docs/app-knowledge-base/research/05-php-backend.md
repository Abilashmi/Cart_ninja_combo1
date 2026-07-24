# PHP Backend — Complete Endpoint Reference

Scope: every `.php` file under `php_backend/` (38 files, confirmed via `find php_backend -type f -name "*.php"`). Deployed at `https://int.thecomboforge.com/<filename>.php` unless otherwise noted. Called from Node primarily via `app/utils/api-helpers.js` (`sendToPhp(payload, endpoint)`, `BASE_PHP_URL`) or directly via `fetch(`${BASE_PHP_URL}/...`)`, authenticated (where present) with an `X-Forge-Secret` header whose expected value is `getenv('SHOPIFY_API_KEY')`.

## IMPORTANT discrepancies found during this audit

1. **`ai_upsell.php` does not exist in this checkout.** CLAUDE.md states "`php_backend/ai_upsell.php` already patched" with NVIDIA NIM key-prefix detection. A recursive search (`find php_backend -type f -name "*.php"`) and a case-insensitive filename grep for `*upsell*` found only `upsell_settings.php` (a plain CRUD settings endpoint with no AI/LLM logic at all). No file under `php_backend/` contains an NVIDIA/`nvapi`/LLM chat-completion call of any kind. **This part of CLAUDE.md could not be verified from source and is likely stale** (the file may have existed on the deployed server only, or been removed/renamed since CLAUDE.md was written). All actual AI-agent LLM calls found in this codebase live in Node (`app/routes/api.ai-agent.generate.jsx` per CLAUDE.md) — the PHP side (`ai_conversations.php`, `ai_messages.php`, `ai_agent_apply.php`) only stores chat history and applies already-decided actions to MySQL; none of them call an LLM.
2. **`install_shop.php` and `uninstall_shop.php` are called at a *different* domain**: `https://int.thecartninja.com/install_shop.php` and `https://int.thecartninja.com/uninstall_shop.php` (see `app/routes/app._index.jsx` and `app/routes/webhooks.app.uninstalled.jsx`), not `int.thecomboforge.com` like every other endpoint in this document. This is either a legacy domain still in production use or an inconsistency — flagging for verification.
3. **Several endpoints referenced by `app/utils/api-helpers.js` do not exist in this local `php_backend/` checkout**: `templates.php`, `discount.php`, `shop.php`, `visitors.php`, `orders.php` are all fetched via `BASE_PHP_URL` in `api-helpers.js` but have no corresponding file under `php_backend/`. They presumably exist only on the deployed server (`int.thecomboforge.com`) and were not pulled into this repo, or the repo is out of sync with production. Not documented below since there is no source to read — noted here so the gap is explicit rather than silently missing.
4. **`cart_drawer_config.php`, `progress_bar.php`, `upsell_settings.php`, `coupon_slider_settings.php` are NOT called by the current Node admin routes** (`app/routes/api.cart-drawer-config.jsx`, `api.progress-bar.jsx`, `api.upsell-settings.jsx`, `api.coupon-slider-settings.jsx` all use `getDb()` from `app/services/db.server.js` — a direct-SQL client that itself proxies over HTTPS through `db_proxy.php` — rather than calling these standalone PHP files). These four files appear to be an earlier/parallel REST-style API surface for the same tables, still fully functional and covered by Playwright specs in `tests/specs/api/*.spec.ts`, and `coupon_slider_settings.php` GET is still actively called by `app/routes/app.productwidget.jsx`. Documented below as-is; "Called by" notes this discrepancy per-file.
5. **`analytics.php` uses `mysqli` (`$conn->query(...)`, `$conn->prepare(...)`) but `config.php` (the file it `require_once`s) only ever defines a PDO `$pdo` object — it never defines `$conn`.** No other file in `php_backend/` defines a global `$conn` mysqli connection either. As written, `analytics.php` would fatal-error on `$conn->query(...)` (call to a method on null/undefined variable) unless a `$conn` mysqli connection is defined by something not present in this checkout (e.g. a server-level auto-prepend file). **Flagged as likely broken/dead code — not verified working.**
6. **`get_schema.php` and `uninstall_shop.php` open a *second*, separate DB connection** in addition to the `$pdo` from `config.php`: `get_schema.php` opens `new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME)` (works, since those constants exist), while `uninstall_shop.php` does `new PDO($dsn, $user, $pass, $options)` where `$user` and `$pass` are **undefined variables** (config.php defines `DB_USER`/`DB_PASS` constants and a `$dsn` string, but never `$user`/`$pass` variables). This re-connection in `uninstall_shop.php` is dead/redundant code (a working `$pdo` already exists from `config.php`) and, because `$user`/`$pass` are undefined, would connect with an empty username/password — flagged as a latent bug, though it may still work if the schema also happens to accept anonymous/passwordless root locally.
7. **Four files are named for specific features but are actually a generic, identical webhook-logging stub** with no DB access and no feature-specific logic: `test.php` (logs to `webhook_logs/`), `test2.php` (`webhook2_logs/`), `fbt.php` (`webhook3_logs/`), `createdcoupon.php` (`webhook4_logs/`). Despite the names `fbt.php` and `createdcoupon.php` suggesting FBT or coupon-creation business logic, they contain **only** CORS headers + "dump the raw request body to a timestamped JSON file on disk" — no relation to the FBT widget (`fbt_widget` table, `save_fbt_widget.php`) or coupon creation (`save_coupon.php`) functionality documented elsewhere. Treat these four as generic inbound-webhook capture endpoints, not the features their names imply.

---

## `config.php`

**File path:** `php_backend/config.php`
**Endpoint URL:** Not directly callable as an API endpoint — this is a shared include, `require_once`'d by nearly every other file in `php_backend/`.
**HTTP Method(s):** N/A (include file). Sets CORS headers for `GET, POST, OPTIONS` and handles `OPTIONS` preflight with `200` + `exit`.
**Purpose:** Central bootstrap: sets `Content-Type: application/json`, permissive CORS (`Access-Control-Allow-Origin: *`), disables displaying PHP errors while keeping `error_reporting(E_ALL)` (errors are logged, not shown), defines DB constants, and opens the shared PDO MySQL connection used by (almost) every other endpoint.
**Parameters/body fields:** None (no request data read here).
**Authentication/verification:** None in this file — auth (X-Forge-Secret check) is repeated individually in each file that needs it, *after* including this one.
**Database queries:** None directly; establishes the connection object other files use.
**Response shape:** On DB connection failure only: `{"status":"error","message":"DB Connection Failed"}` with HTTP 500.
**Validation performed:** None.
**Error handling:** Catches `PDOException` on connect only; downstream query errors are each file's own responsibility (mix of caught/uncaught depending on file).
**Business logic:** Defines:
```php
define('DB_HOST',    'localhost');
define('DB_NAME',    'cart_drawer_ninja');
define('DB_USER',    'root');
define('DB_PASS',    '');
define('DB_CHARSET', 'utf8mb4');
```
Builds `$dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=" . DB_CHARSET;` and connects via `new PDO($dsn, DB_USER, DB_PASS, $options)` with `PDO::ERRMODE_EXCEPTION`, `PDO::FETCH_ASSOC` default, `PDO::ATTR_EMULATE_PREPARES => false`. The resulting `$pdo` variable is what every other file in this directory uses for all queries.
**Called by:** Included by (`require_once __DIR__ . '/config.php'`) essentially every other `.php` file in this directory except the four generic webhook-logger stubs (`test.php`, `test2.php`, `fbt.php`, `createdcoupon.php`), which have no DB access at all.

---

## `plan_config.php`

**File path:** `php_backend/plan_config.php`
**Endpoint URL:** Not an HTTP endpoint — a shared include of pure constants/functions.
**HTTP Method(s):** N/A
**Purpose:** PHP-side mirror of `app/config/plans.js`, the single source of truth for plan tiers, order caps, overage rates, AI BRIX credit caps, and per-feature gating state (`enabled` / `preview` / `locked`) per plan. Exists because PHP endpoints are hit directly by the storefront via the Shopify App Proxy and cannot import Node modules, so the plan/feature matrix has to be duplicated here. The file's own docblock warns: *"keep this file structurally identical to app/config/plans.js. Any change to plan tiers, prices, caps, or feature states must be made in BOTH files."*
**Parameters/body fields:** None.
**Authentication:** None (constants/functions only).
**Database queries:** None.
**Response shape:** N/A.
**Validation:** N/A.
**Error handling:** N/A.
**Business logic:**
- `PLAN_KEYS = ['free', 'starter', 'pro']`.
- `PLANS` array: `free` (orderCap 50, overageRate 0.30, aiBrixCredits 10, comboTemplateLimit 0, watermarkRemovable false), `starter` (orderCap 500, overageRate 0.10, aiBrixCredits 30, comboTemplateLimit 3, watermarkRemovable true), `pro` (orderCap null/unlimited, overageRate 0.0, aiBrixCredits null/unlimited, comboTemplateLimit null/unlimited, watermarkRemovable true).
- `FEATURES` array maps ~18 feature keys (`cart_drawer`, `announcement_bar`, `empty_cart_customization`, `ai_brix`, `fbt`, `coupon_lock_pro`, `progress_bar`, `ai_cart_upsell`, `full_analytics`, `confetti`, `mobile_swipe_checkout`, `build_a_combo`, `open_countdown`, `custom_css`, `priority_email_support`, `ai_support_247`, `ai_analytics`, `advanced_ai_analytics`, `unlimited_ai_agents`) to a state per plan tier.
- Helper functions: `plan_is_valid_key()`, `plan_get_feature_state($planKey, $featureKey)` (defaults to `'locked'` if plan/feature unknown), `plan_can_access_feature()` (true if `enabled` or `preview`), `plan_can_publish_feature()` (true only if `enabled` — i.e. actually renders on storefront), `plan_can_preview_feature()` (true only if `preview` — merchant can design/save but it won't render), `plan_get_config($planKey)`.
**Called by:** `require_once`'d by `plan_helpers.php`, which is in turn used by `save_cart_drawer.php`, `save_fbt_widget.php`, `save_coupon_slider_widget.php`, `upsell_settings.php`, `update-subscription-status.php`.

---

## `plan_helpers.php`

**File path:** `php_backend/plan_helpers.php`
**Endpoint URL:** Not an HTTP endpoint — shared include.
**HTTP Method(s):** N/A
**Purpose:** PHP-side plan *resolution* (looking up a shop's actual plan from the `shops` table), mirroring `app/services/plan-permissions.server.js`. Described in its own comment as "the actual gate for storefront-facing endpoints (FBT, coupon slider, cart drawer GET handlers) since those are hit directly by the storefront via the Shopify App Proxy and cannot go through Node."
**Parameters/body fields:** N/A (functions take `$pdo`/`$shopDomain` as arguments).
**Authentication:** None (helper functions only).
**Database queries:**
- `plan_ensure_columns($pdo)`: `SHOW COLUMNS FROM shops`; if missing, `ALTER TABLE shops ADD COLUMN plan_key VARCHAR(20) NOT NULL DEFAULT 'free'` and/or `ADD COLUMN pending_plan_key VARCHAR(20) NULL DEFAULT NULL`. Uses a `static $ensured` flag so it only runs once per request.
- `resolve_plan_key($pdo, $shopDomain)`: `SELECT plan_key, plan_name FROM shops WHERE shop_domain = :shop LIMIT 1`.
**Response shape:** N/A.
**Validation:** N/A.
**Error handling:** None explicit — relies on PDO's exception mode propagating to the caller.
**Business logic:**
- `plan_alias_legacy_plan_name($planName)`: maps legacy free-text `plan_name` values to a canonical key — exact `'free'` → `free`; anything containing `'pro'` (case-insensitive) → `pro`; everything else → `starter`. This is the fallback path for rows saved before the `plan_key` column existed.
- `resolve_plan_key()`: returns `'free'` if no shop domain or no matching row; otherwise prefers `shops.plan_key` if it's a valid key, else falls back to alias-mapping `shops.plan_name`.
**Called by:** `require_once`'d by `save_cart_drawer.php`, `save_fbt_widget.php`, `save_coupon_slider_widget.php`, `upsell_settings.php`, `update-subscription-status.php`.

---

## `ai_agent_apply.php`

**File path:** `php_backend/ai_agent_apply.php`
**Endpoint URL:** `https://int.thecomboforge.com/ai_agent_apply.php`
**HTTP Method(s):** POST only (others rejected with 405).
**Purpose:** Applies a pre-decided plan of discrete actions (already interpreted by the Node-side LLM layer) to the relevant MySQL tables, then reads back the current per-shop state across all cart-drawer subsystems so the caller can sync its UI. This is *action execution*, not LLM inference — no AI/LLM call happens in this file.
**Parameters/body fields (JSON body):**
- `shop` (string, required)
- `plan.actions` (array of action-name strings, required, non-empty) — recognized values: `enableDrawer`, `disableDrawer`, `enableGoalBar`, `disableGoalBar`, `enableUpsell`, `disableUpsell`, `enableFBT`, `disableFBT`, `applyTheme`. Anything else is accepted into the request but reported back as `unsupported`.
- `plan.settings` (object, optional) — sub-fields read depending on which actions are present: `cartDrawerPosition` (`'left'|'right'`), `goalMessage`, `placement` (`'top'|'bottom'`), `goalAmount`, `rewardType` (default `'free_shipping'`), `iconPreset` (default `'shipping'`), `fbtTemplate`, `fbtMode`, `theme.headerBgColor`, `theme.headerTextColor` (default `#1a1a1a`), `theme.checkoutBgColor`, `theme.checkoutTextColor` (default `#ffffff`).
**Authentication/verification:** `X-Forge-Secret` header checked against `getenv('SHOPIFY_API_KEY')` — 403 if mismatched (skipped only if the server has no `SHOPIFY_API_KEY` env var set).
**Database queries (all upsert-style, `shop`/`shop_domain` scoped):**
- `enableDrawer`/`disableDrawer`: `INSERT ... ON DUPLICATE KEY UPDATE` into `cart_drawer_config.is_enabled` AND `cart_drawer.cartStatus` (writes both tables); optionally `UPDATE cart_drawer_config SET position = ?`.
- `enableGoalBar`/`disableGoalBar`: upsert `progress_bar_settings.is_enabled`; optional `UPDATE ... completion_text`; optional `UPDATE ... placement`; if `goalAmount > 0`, sets `progress_bar_settings.mode = 'amount'` and either updates the first tier (by `sort_order`) in `progress_bar_tiers` or inserts a new one (`min_value`, `reward_type`, `icon_preset`, `is_active=1`, `sort_order=0`).
- `enableUpsell`/`disableUpsell`: upsert `upsell_widget_settings.is_enabled`.
- `enableFBT`/`disableFBT`: upsert `fbt_widget_settings.is_enabled`; optional `UPDATE ... selected_template`; optional `UPDATE ... mode`.
- `applyTheme`: conditionally updates `cart_drawer_config.header_bg_color`/`header_text_color`, and `cart_drawer_config.checkout_button_bg_color`/`checkout_button_text_color`; for the checkout color case it *also* reads `cart_drawer.checkout_button_style` (JSON), merges in `backgroundColor`/`textColor`, and writes it back — because the storefront's real checkout-button styling is driven by that JSON blob column, not the `cart_drawer_config` columns (which only feed the admin live preview).
- Read-back ("after" state, all `SELECT`s scoped to `shop`/`shop_domain`): `cart_drawer_config` (`is_enabled`, `announcement_enabled`, header/checkout colors, `updated_at`), `progress_bar_settings` (`is_enabled`, `updated_at`), `upsell_widget_settings` (`is_enabled`, `updated_at`), `coupon_slider_settings` (`is_enabled`), `fbt_widget_settings` (`is_enabled`, `updated_at`).
**Response shape:**
```json
{
  "status": "success" | "partial" | "unsupported",
  "applied": ["enableDrawer", ...],
  "unsupported": ["matchTheme", ...],
  "after": {
    "cart": { "drawerEnabled": true, "updatedAt": "...", "announcement": {"enabled": false}, "header": {...}, "checkoutButton": {...}, "goalBar": {...}, "upsell": {...}, "couponSlider": {...} },
    "fbt": { "widgetEnabled": true, "updatedAt": "..." }
  }
}
```
`status` is `success` if nothing unsupported, `unsupported` if nothing at all applied, else `partial`.
**Validation performed:** Requires non-empty `shop` and non-empty `plan.actions` (400 otherwise). A local `flag($v, $default=1)` helper coerces truthy-ish values (`true`/`1`/`'1'`) to `1`, else `0`.
**Error handling:** No `try/catch` around the DB writes — relies on PDO's exception mode (would surface as an uncaught fatal error / 500 HTML, not a clean JSON error, if a query fails).
**Business logic (plain English):** This is the execution backend for the AI agent's "confirm and apply" flow — the LLM (in Node) has already decided *what* to change; this endpoint is a big switch statement translating each named action into the correct DB writes, deliberately keeping unrecognized/unsupported actions (e.g. trust badges, `matchTheme`, `optimizeMobile` — mentioned in the code's own comment as client-recognized-but-not-backed) out of the `applied` list so the caller doesn't falsely report success. It explicitly avoids clobbering fields the merchant didn't ask to change (every settings field is applied only if present/non-null).
**Called by:** `app/routes/api.ai-agent.apply.jsx` (direct fetch to `${BASE_PHP_URL}/ai_agent_apply.php`), `app/routes/api.ai-agent.progress-bar-turn.jsx` and `app/routes/api.ai-agent.match-theme.jsx` (via `sendToPhp(..., 'ai_agent_apply.php')`).

---

## `ai_conversations.php`

**File path:** `php_backend/ai_conversations.php`
**Endpoint URL:** `https://int.thecomboforge.com/ai_conversations.php`
**HTTP Method(s):** GET (list), POST (create). Others → 405.
**Purpose:** CRUD persistence for AI-agent chat conversation records (not the messages themselves — see `ai_messages.php`). Pure storage; no LLM call.
**Parameters/body fields:**
- GET: `shop` query param (required).
- POST (JSON body): `shop` (required), `title` (optional, defaults to `'New Chat'`).
**Authentication/verification:** `X-Forge-Secret` header checked against `getenv('SHOPIFY_API_KEY')` — 403 if mismatched (skipped if env var unset).
**Database queries:**
- GET: `SELECT id, shopDomain as shop_domain, title, createdAt as created_at, updatedAt as updated_at FROM ai_conversations WHERE shopDomain = ? ORDER BY updatedAt DESC LIMIT 50`. Note: the table's actual columns are camelCase (`shopDomain`, `createdAt`, `updatedAt`) and are aliased to snake_case in the SELECT.
- POST: `INSERT INTO ai_conversations (id, shopDomain, title, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`. `id` is generated with PHP's `uniqid('', true)`, not a DB auto-increment or UUID library.
**Response shape:**
- GET: `{"status":"success","conversations":[{id, shop_domain, title, created_at, updated_at}, ...]}`
- POST: `{"status":"success","conversation":{id, shop_domain, title, created_at, updated_at}}`
**Validation performed:** `shop` required on both GET (400 if missing) and POST (400 if missing).
**Error handling:** No try/catch — relies on PDO exception mode; a DB failure would be an uncaught fatal, not a clean JSON error.
**Business logic:** Straightforward list/create. No update/delete verbs implemented in this file.
**Called by:** `app/routes/api.ai.conversations.jsx` (per file-naming convention and CLAUDE.md's PHP backend description; conversation history is described as persisted via `app/services/ai-agent-history.server.js` against these PHP tables).

---

## `ai_messages.php`

**File path:** `php_backend/ai_messages.php`
**Endpoint URL:** `https://int.thecomboforge.com/ai_messages.php`
**HTTP Method(s):** GET (list messages for a conversation), POST (append a message). Others → 405.
**Purpose:** Pure storage for individual chat turns within a conversation (role + message text). No LLM call — the actual AI generation happens in Node (`app/routes/api.ai-agent.generate.jsx` per CLAUDE.md).
**Parameters/body fields:**
- GET: `conversationId` query param. If absent, returns `{"status":"success","messages":[]}` rather than erroring.
- POST (JSON body): `conversationId`, `role`, `message` — all three required.
**Authentication/verification:** Same `X-Forge-Secret` vs `SHOPIFY_API_KEY` check as `ai_conversations.php`.
**Database queries:**
- GET: `SELECT id, conversationId as conversation_id, role, message, createdAt as created_at FROM ai_messages WHERE conversationId = ? ORDER BY createdAt ASC`.
- POST: `INSERT INTO ai_messages (id, conversationId, role, message, createdAt) VALUES (?, ?, ?, ?, ?)` (id via `uniqid('', true)`), followed by `UPDATE ai_conversations SET updatedAt = ? WHERE id = ?` to bump the parent conversation's `updatedAt` so conversation lists sort correctly by recency.
**Response shape:**
- GET: `{"status":"success","messages":[{id, conversation_id, role, message, created_at}, ...]}`
- POST: `{"status":"success","message":{id, conversation_id, role, message, created_at}}`
**Validation performed:** POST requires all of `conversationId`, `role`, `message` (400 if any missing).
**Error handling:** No try/catch; relies on PDO exception mode.
**Business logic:** Simple append-only message log per conversation, with a side-effect touch of the parent's `updatedAt`.
**Called by:** `app/routes/api.ai.messages.jsx`. Per the user's memory notes (`project_brixbar_message_persistence_gap.md`), this is the path that was fixed on 2026-07-11 so BrixBar chat messages persist via `saveMessage`.

---

## `analytics.php`

**File path:** `php_backend/analytics.php`
**Endpoint URL:** `https://int.thecomboforge.com/analytics.php`
**HTTP Method(s):** Implicitly GET (reads `$_GET` only; no method check/branch at all — would attempt to run against any verb).
**Purpose:** Aggregates click-event counts and revenue from `cart_click_events`, bucketed into checkout/coupon/upsell categories, for a given shop and optional date range.
**Parameters/body fields (query string):** `shop` (required), `startDate` (optional, `YYYY-MM-DD`), `endDate` (optional, `YYYY-MM-DD`).
**Authentication/verification:** **None** — no `X-Forge-Secret` check in this file at all.
**Database queries:** **Uses `mysqli` (`$conn`), not the PDO `$pdo` from `config.php`.** `config.php` never defines a `$conn` variable — see "IMPORTANT discrepancies" item 5 above; this file is likely broken as checked into this repo unless a `$conn` mysqli global is defined elsewhere (not found anywhere else in `php_backend/`).
- Helper `tableHasColumn($conn, $table, $column)`: `SHOW COLUMNS FROM \`$table\` LIKE '$column'`.
- Main query (dynamically built, parameterized): `SELECT event_type, COUNT(*) as total, [COALESCE(SUM(revenue),0) as revenue | 0 as revenue] FROM cart_click_events WHERE domain = ? [AND created_at >= ?] [AND created_at <= ?] GROUP BY event_type`. Revenue column is conditionally included only if `cart_click_events.revenue` exists (checked via `tableHasColumn`).
**Response shape:** `{"success": true, "data": {"checkout_click": n, "coupon_click": n, "upsell_click": n, "upsell_revenue_generated": n, "cartdrawer_total_revenue": n, "cartdrawer_total_coupon_applied": n}}`. On missing `shop`: `{"success": false, "message": "shop parameter required"}` (400). On query prepare failure: `{"success": false, "error": ...}` (500).
**Validation performed:** `shop` required (400 if missing). Date filters use `startDate 00:00:00` / `endDate 23:59:59` string bounds (no format/date validity check).
**Error handling:** Checks `$stmt = $conn->prepare(...)` for falsy and returns 500 with `$conn->error`; also `error_log()`s the query, params, and shop/date for debugging.
**Business logic:** Categorizes `event_type` values by substring match (`strpos($type, 'checkout')`, `'coupon'`, `'upsell'`) — case-insensitive via `strtolower(trim(...))` — and accumulates counts/revenue into a fixed-shape response object regardless of what event types actually exist.
**Called by:** `app/utils/api-helpers.js` (per its own comment: "Unified Analytics Fetcher (Uses analytics.php)", constructing `${BASE_PHP_URL}/analytics.php` with `shop`/date params).

---

## `cart_drawer_config.php`

**File path:** `php_backend/cart_drawer_config.php`
**Endpoint URL:** `https://int.thecomboforge.com/cart_drawer_config.php`
**HTTP Method(s):** GET, POST. Others → 405.
**Purpose:** Standalone REST-style read/write endpoint for the `cart_drawer_config` table (the newer normalized cart-editor table per CLAUDE.md). **Not currently called by the live Node admin routes** — see discrepancy #4 above; `app/routes/api.cart-drawer-config.jsx` writes to the same table directly via `getDb()`/raw SQL instead. Still exercised by `tests/specs/api/cart-drawer-config.spec.ts`.
**Parameters/body fields:**
- GET: `shop` query param (required).
- POST (JSON body): `shop` (required), plus every column of `cart_drawer_config`: `is_enabled`, `checkout_button_text` (default `'Checkout Now'`), `checkout_footer_text` (default `'Shipping and taxes calculated at checkout'`), `checkout_button_bg_color` (default `#111827`), `checkout_button_text_color` (default `#ffffff`), `checkout_button_border_radius` (default `4`), `custom_css`, `announcement_enabled` (default `0`), `announcement_text`, `announcement_bg_color` (default `#111827`), `announcement_text_color` (default `#ffffff`), `announcement_font_size` (default `13`), `open_on_add` (default `1`), `open_on_icon_click` (default `1`), `position` (default `'right'`), `header_title` (default `'Your Cart'`), `header_close_style` (default `'icon'`), `header_bg_color` (default `#ffffff`), `header_text_color` (default `#1a1a1a`), `header_border_bottom` (default `1`), `design_width` (default `'normal'`), `design_border_radius` (default `8`), `design_shadow` (default `1`), `design_animation` (default `'slide'`), `empty_cart_message` (default `'Your cart is empty'`), `empty_cart_show_continue_shopping` (default `1`), `empty_cart_show_recommendations` (default `1`).
**Authentication/verification:** `X-Forge-Secret` vs `SHOPIFY_API_KEY` (403 if mismatched; skipped if env var unset — comment notes this is intentional "skipped in local when SHOPIFY_API_KEY not set").
**Database queries:**
- GET: `SELECT * FROM cart_drawer_config WHERE shop_domain = ? LIMIT 1`.
- POST: single large `INSERT ... ON DUPLICATE KEY UPDATE` covering all columns above, keyed on `shop_domain`, then re-`SELECT`s the row to return it.
**Response shape:** `{"status":"success","data": {...row...} | null}`. Errors: `{"status":"error","message":"..."}` with 400/403/405 as appropriate.
**Validation performed:** `shop` required on both verbs. A local `flag($v, $default=1)` helper normalizes boolean-ish values.
**Error handling:** No try/catch around the INSERT — relies on PDO exception mode.
**Business logic:** Simple full-row upsert; every field has a sensible default so a partial POST still produces a complete, sane row on first insert.
**Called by:** Not found in current Node route code (see discrepancy #4); exercised directly by `tests/specs/api/cart-drawer-config.spec.ts`.

---

## `check_schema.php`

**File path:** `php_backend/check_schema.php`
**Endpoint URL:** `https://int.thecomboforge.com/check_schema.php`
**HTTP Method(s):** Any (no method branching) — effectively GET, since it only reads.
**Purpose:** Debug/ops utility — dumps the column list of the `cart_drawer` table as plain text, with a hard-coded reminder about a truncation footgun.
**Parameters/body fields:** None.
**Authentication/verification:** None.
**Database queries:** `DESCRIBE cart_drawer` (read-only).
**Response shape:** Not JSON — `Content-Type: text/plain`, prints a formatted column table (`Field | Type | Null | Key`) followed by a hardcoded warning: *"IMPORTANT: 'progress_data', 'coupon_data', and 'upsell_data' should be 'text' or 'longtext'. If they are 'varchar(255)', they will truncate and break the cart drawer functionality."*
**Validation performed:** None.
**Error handling:** try/catch around the `DESCRIBE`, prints `"Error: " . $e->getMessage()` on failure.
**Business logic:** Pure schema-inspection debug tool; not part of any product feature.
**Called by:** Not referenced anywhere in `app/` — appears to be a manually-invoked ops/debug script only.

---

## `click.php`

**File path:** `php_backend/click.php`
**Endpoint URL:** `https://int.thecomboforge.com/click.php`
**HTTP Method(s):** Implicitly POST (reads raw JSON body; no method check).
**Purpose:** Records a single storefront click/interaction event (checkout click, coupon click, upsell click, etc.) into `cart_click_events` — the raw data source `analytics.php` aggregates from.
**Parameters/body fields (JSON body):** `shop_id`, `domain` (required), `event_type` (required), `session_id`.
**Authentication/verification:** None.
**Database queries:** `INSERT INTO cart_click_events (shop_id, domain, event_type, session_id, created_at) VALUES (?, ?, ?, ?, NOW())`.
**Response shape:** `{"status":"success"}` on success; `{"status":"error","message":"domain and event_type required"}` (400) if missing required fields.
**Validation performed:** `domain` and `event_type` required.
**Error handling:** No try/catch — relies on PDO exception mode.
**Business logic:** Pure event-sink insert, no dedup/rate-limiting.
**Called by:** Likely the storefront extension (`extensions/cart-drawer/`) directly via the Shopify App Proxy, based on `domain`/`session_id` shape matching storefront click tracking (not found referenced in `app/` Node routes — consistent with it being a storefront-only fire-and-forget call). Not directly verified from source beyond this inference.

---

## `combo_forge_init.php`

**File path:** `php_backend/combo_forge_init.php`
**Endpoint URL:** `https://int.thecomboforge.com/combo_forge_init.php`
**HTTP Method(s):** Any (no method check) — a one-shot schema-bootstrap script.
**Purpose:** Idempotently creates (via `CREATE TABLE IF NOT EXISTS`) the entire Combo Forge MySQL schema: `shops`, `combo_templates`, `template_pages`, `template_collections`, `template_banners`, `template_typography`, `template_progressbars`, `template_milestones`, `template_ai_blocks`, `template_custom_css`, `template_settings`, `template_revisions`, `activity_logs` — 13 tables total, with foreign keys cascading from `combo_templates.id`.
**Parameters/body fields:** None.
**Authentication/verification:** None.
**Database queries:** 13 `CREATE TABLE IF NOT EXISTS` DDL statements (see file for full column lists — notable: `combo_templates.template_type` ENUM `grid|carousel|premium`, `status` ENUM `draft|published|archived`; `template_progressbars` and `template_milestones` mirror the same reward/milestone shape as the main `progress_bar_settings`/`progress_bar_tiers` tables but scoped per-template instead of per-shop).
**Response shape:** `{"status":"success","message":"All Combo Forge tables initialized","tables":[...names...]}`; on failure `{"status":"error","message":"Schema initialization failed: ..."}` (500).
**Validation performed:** None.
**Error handling:** Single try/catch around the whole block of `exec()` calls.
**Business logic:** Pure schema migration/bootstrap — meant to be run once (or safely re-run) to ensure the Combo Forge MySQL schema exists. Note this is a *different* table family from `combo_templates` as accessed via `combo_save.php`/`combo_pages.php`, though those files write to some of the same tables this one creates (e.g. `combo_templates`, `template_pages`).
**Called by:** Not referenced in `app/` — manual/ops bootstrap script, run directly against the URL when setting up a fresh environment.

---

## `combo_pages.php`

**File path:** `php_backend/combo_pages.php`
**Endpoint URL:** `https://int.thecomboforge.com/combo_pages.php`
**HTTP Method(s):** POST only (others → 405, method not allowed).
**Purpose:** Records/updates the published Shopify page metadata (page id, handle, title, preview/published/admin URLs) associated with a Combo Forge template, once that template has been published as a live storefront page.
**Parameters/body fields (JSON body, or `shop` via query string as fallback):** `shop_domain` or `shop` (required), `template_id` (required), `page_title` (default `'Combo Page'`), `page_handle` (default `'combo-' . time()`), `preview_url`, `published_url`, `admin_url`, `page_id`.
**Authentication/verification:** None.
**Database queries:** `INSERT INTO template_pages (template_id, shop_domain, page_id, page_handle, page_title, preview_url, published_url, admin_url, created_at, updated_at) VALUES (...) ON DUPLICATE KEY UPDATE ...`, then `SELECT * FROM template_pages WHERE template_id = ? AND shop_domain = ?` to return the saved row.
**Response shape:** `{"status":"success","message":"Page saved","page": {...}}`; errors: `{"status":"error","message":"shop_domain required"}` (400), `{"status":"error","message":"template_id required"}` (400), or PDOException message (500).
**Validation performed:** `shop_domain`/`shop` required, `template_id` required.
**Error handling:** try/catch around the whole DB block, returns PDOException message directly to the client (potential info leak, but consistent with the rest of this codebase's error style).
**Business logic:** Straightforward upsert of one `template_pages` row per `(template_id, shop_domain)`.
**Called by:** Combo Forge builder (`app/routes/app.bundles.customize.jsx`) — inferred from filename/table correspondence with the "publish combo page" flow described in CLAUDE.md; not confirmed via direct grep match on `combo_pages.php` in `app/` (the builder's PHP sync calls found in this audit used `discount.php`, not `combo_pages.php` — this endpoint's exact Node caller was not directly located in this audit and should be verified by whoever documents the Node side).

---

## `combo_save.php`

**File path:** `php_backend/combo_save.php`
**Endpoint URL:** `https://int.thecomboforge.com/combo_save.php`
**HTTP Method(s):** GET (fetch one template by `id`, or list all for a shop), POST (create/update a full template with all sub-sections), DELETE (delete a template). Others → 405.
**Purpose:** The primary Combo Forge template persistence endpoint — a single endpoint that reads/writes the full template graph (`combo_templates` + 8 related child tables) in one call. This is the PHP-side counterpart to the `combo_templates` SQLite/Prisma table CLAUDE.md describes as the Node-side canonical store — i.e. Combo Forge templates are written to **both** SQLite (via Prisma in `app.bundles.customize.jsx`/`app.bundles._index.jsx`) **and** this MySQL schema via `sendToPhp`, per CLAUDE.md's description of `combo_save.php`.
**Parameters/body fields:**
- All verbs: `shop_domain` (body) or `shop` (query) required; `action` optional (read but not branched on in the code shown — `$action` is computed but not used to alter GET/POST/DELETE routing, which is driven by `$method` instead).
- GET: optional `id` (query) — if present, fetches one full template with joins; if absent, lists all templates for the shop (lighter query, joined only to `template_pages` for `published_url`/`page_title`).
- POST (JSON body): `id` (optional — presence means update, absence means create), `name` (default `'Untitled Template'`), `template_type` (default `'grid'`), `status` (default `'draft'`), `is_active` (default `1`), `slug` (default: slugified name + timestamp), `description`, `features` (array, JSON-encoded), `settings` (object: `main_title`, `subtitle`, `description`, `cta_text` default `'Shop Now'`, `cta_link`, `cta_bg_color` default `#008060`, `cta_text_color` default `#ffffff`, `cta_border_radius` default `6px`, `cta_hover_color` default `#006e52`, `content_width` default `1200px`, `section_gap` default `40px`), `collections` (array of `{collection_id, collection_title, handle, products_per_row, max_products, display_mode, slider_speed, infinite_loop, autoplay, show_arrows, show_dots, sort_order}`), `banners` (object with `desktop_*`/`mobile_*` image/height/width/border_radius/overlay_color/overlay_opacity), `typography` (object keyed by `section_key`, each with `font_family`, `font_size`, `font_weight`, `font_color`, `alignment`), `progressbar` (object matching `template_progressbars` columns), `milestones` (array of `{value, label, message}`), `ai_block` (object matching `template_ai_blocks` columns), `custom_css` (string).
- DELETE: `id` (body or query, required).
**Authentication/verification:** None in this file.
**Database queries (all transactional on POST via `$pdo->beginTransaction()`/`commit()`/`rollBack()`):**
- GET (single): large `LEFT JOIN` across `combo_templates`, `template_pages`, `template_collections`, `template_banners`, `template_settings`, `template_ai_blocks`, `template_custom_css`, `template_progressbars`, plus separate queries for `template_milestones` (by `progressbar_id`) and `template_typography` (by `template_id`, reassembled into an object keyed by `section_key`).
- GET (list): `SELECT ct.*, tp.published_url, tp.page_title FROM combo_templates ct LEFT JOIN template_pages tp ... WHERE ct.shop_domain = ? ORDER BY ct.updated_at DESC`.
- POST: `UPDATE combo_templates ... version=version+1 ...` (if `id` present) or `INSERT INTO combo_templates ...` (if not), then per-section upserts into `template_settings`, `template_collections` (delete-all-then-reinsert), `template_banners` (upsert), `template_typography` (delete-all-then-reinsert), `template_progressbars` (upsert), `template_milestones` (delete-all-then-reinsert, tied to the just-saved `progressbar_id`), `template_ai_blocks` (upsert), `template_custom_css` (upsert, stores an `md5()` hash of the CSS content alongside it). Also inserts an `activity_logs` row (`action`: `template_created`/`template_updated`).
- DELETE: `DELETE FROM combo_templates WHERE id = ? AND shop_domain = ?` (cascades to child tables via FK `ON DELETE CASCADE`, per `combo_forge_init.php`'s schema).
**Response shape:**
- GET (single): `{"status":"success","template": {...joined row...}, "milestones": [...], "typography": {...}}`; 404 if not found.
- GET (list): `{"status":"success","templates": [...]}`.
- POST: `{"status":"success","message":"Template created"|"Template updated","id": <int>}`.
- DELETE: `{"status":"success","message":"Template deleted"}`.
- Errors: `{"status":"error","message":"..."}` with 400/404/405/500 as appropriate.
**Validation performed:** `shop_domain` required on all verbs (400). `id` required for DELETE (400). No other field validation — defaults fill in everything else.
**Error handling:** POST wraps the whole multi-table write in a transaction with explicit `rollBack()` on any `Exception`; outer try/catch also catches `PDOException` for GET/DELETE paths.
**Business logic:** This is the most complex file in `php_backend/` — a full aggregate-root save operation for a Combo Forge bundle template, replacing child collections/typography/milestones wholesale on every save (delete-then-reinsert) while upserting the singleton child rows (settings, banners, progress bar, AI block, custom CSS) in place. Every save also appends an `activity_logs` audit row.
**Called by:** Combo Forge builder (`app/routes/app.bundles.customize.jsx`) per CLAUDE.md's description ("Templates are saved to SQLite via `prisma.$queryRawUnsafe` into `combo_templates`, and to the PHP backend via `sendToPhp`"); exact call site not directly grepped in this audit (search for `sendToPhp` calls targeting `'combo_save.php'` would confirm — a different agent covering the Node side should verify this).

---

## `coupon_slider_settings.php`

**File path:** `php_backend/coupon_slider_settings.php`
**Endpoint URL:** `https://int.thecomboforge.com/coupon_slider_settings.php`
**HTTP Method(s):** GET, POST. Others → 405.
**Purpose:** Standalone REST-style read/write endpoint for the `coupon_slider_settings` table (design/behavior config for the coupon slider widget — separate from the actual coupon-template *content*, which lives in `coupon_slider_widget` via `save_coupon_slider_widget.php`). Runs a self-healing migration on every request. **Its GET path is actively used** by `app/routes/app.productwidget.jsx`; its POST path does not appear to be called by current Node admin routes (which write this table via `getDb()` in `api.coupon-slider-settings.jsx` instead — see discrepancy #4).
**Parameters/body fields:**
- GET: `shop` query param (required).
- POST (JSON body): `shop` (required), `is_enabled` (default `0`), `selected_template`/`template` (default `'template1'`), `title_text`/`sectionTitle` (default `'Apply Coupon'`), `title_color`/`titleColor` (default `#1e293b`), `title_font_size`/`titleFontSize` (default `14`), `title_font_weight` (default `700`), `title_alignment`/`titleTextAlign` (default `'left'`), `section_bg_color` (default `#ffffff`), `card_bg_color` (default `#ffffff`), `card_border_color` (default `#e5e7eb`), `card_border_width` (default `1`), `card_border_radius` (default `8`), `card_shadow` (default `0`), `auto_slide` (default `0`), `slide_interval` (default `5`), `position` (default `'above_cart'`), `layout` (default `'grid'`), `selectedCoupons` (array → JSON-encoded), `display_condition` (default `'all'`), `product_handles`, `collection_handles`, `tag_handles`.
**Authentication/verification:** `X-Forge-Secret` vs `SHOPIFY_API_KEY` (403 if mismatched, skipped if env var unset).
**Database queries:**
- Startup migration (every request, errors swallowed): `ALTER TABLE coupon_slider_settings ADD COLUMN IF NOT EXISTS display_condition VARCHAR(50) NOT NULL DEFAULT 'all', ADD COLUMN IF NOT EXISTS product_handles TEXT, ADD COLUMN IF NOT EXISTS collection_handles TEXT, ADD COLUMN IF NOT EXISTS tag_handles TEXT`.
- GET: `SELECT * FROM coupon_slider_settings WHERE shop_domain = ? LIMIT 1`; `selected_coupons` JSON-decoded before returning.
- POST: full-row `INSERT ... ON DUPLICATE KEY UPDATE` across all columns above, then re-`SELECT`s and returns the row.
**Response shape:** `{"status":"success","data": {...row, selected_coupons: [...] } | null}`.
**Validation performed:** `shop` required on both verbs. Local `flag()` helper as in other files.
**Error handling:** No try/catch around the main INSERT (migration ALTER is separately caught-and-ignored).
**Business logic:** Standard full-row upsert with dual camelCase/snake_case field-name fallbacks (e.g. `sectionTitle` OR `title_text`) to tolerate different caller shapes.
**Called by:** GET — `app/routes/app.productwidget.jsx` (direct `fetch` with `X-Forge-Secret` header, both for reading current settings and, per the file's second reference at line ~207, also POSTing). POST path not otherwise confirmed against current admin routes (see discrepancy #4); also exercised by `tests/specs/api/coupon-slider-settings.spec.ts`.

---

## `create_shops_table.php`

**File path:** `php_backend/create_shops_table.php`
**Endpoint URL:** `https://int.thecomboforge.com/create_shops_table.php`
**HTTP Method(s):** Any (no method check) — one-shot schema bootstrap.
**Purpose:** Idempotently creates the `shops` table if it doesn't exist (a narrower/older version of the schema than what `combo_forge_init.php` also creates for `shops` — this one only has `id`, `shop_domain`, `is_active`, `plan_name`, `created_at`, `updated_at`; other files like `plan_helpers.php` and `update-subscription-status.php` `ALTER TABLE` additional columns onto it as needed).
**Parameters/body fields:** None.
**Authentication/verification:** None.
**Database queries:** `CREATE TABLE IF NOT EXISTS shops (id INT AUTO_INCREMENT PRIMARY KEY, shop_domain VARCHAR(255) NOT NULL, is_active TINYINT(1) DEFAULT 1, plan_name VARCHAR(100) DEFAULT 'free', created_at, updated_at, UNIQUE KEY shop_domain_UNIQUE (shop_domain))`.
**Response shape:** `{"status":"success","message":"Table 'shops' created successfully or already exists."}`; on failure `{"status":"error","message":"Failed to create table: ..."}` (500).
**Validation performed:** None.
**Error handling:** try/catch around the single `exec()`.
**Business logic:** Pure schema bootstrap, safe to re-run.
**Called by:** Not referenced in `app/` — manual/ops bootstrap script.

---

## `createdcoupon.php`

**File path:** `php_backend/createdcoupon.php`
**Endpoint URL:** `https://int.thecomboforge.com/createdcoupon.php`
**HTTP Method(s):** GET, POST, OPTIONS (OPTIONS returns 200 immediately for CORS preflight; GET/POST both fall through to the same generic logging logic).
**Purpose:** **Despite the name, this is a generic inbound-webhook capture stub with no coupon-specific logic whatsoever.** See discrepancy #7 above. It logs every incoming request (headers, method, IP, raw/decoded JSON body) to a timestamped file under `php_backend/webhook4_logs/`.
**Parameters/body fields:** None read/validated — the entire raw body is captured verbatim (JSON-decoded if possible, else stored as the raw string).
**Authentication/verification:** None.
**Database queries:** None — file-based logging only (`mkdir`/`file_put_contents`).
**Response shape:** `{"status":"received"}`, HTTP 200, regardless of payload content.
**Validation performed:** None.
**Error handling:** None (no try/catch; would fatal on filesystem errors).
**Business logic:** Write-every-request-to-disk debug capture. Not connected to `coupons` table, `save_coupon.php`, or any real coupon-creation flow.
**Called by:** Unknown / not found referenced in `app/`. Given the generic logging shape and matching sibling files (`test.php`, `test2.php`, `fbt.php`), likely a leftover webhook-inspection tool from initial integration debugging (e.g. inspecting a Shopify discount/coupon webhook payload once), not part of the live request path.

---

## `customers-data-request.php`

**File path:** `php_backend/customers-data-request.php`
**Endpoint URL:** `https://int.thecomboforge.com/customers-data-request.php`
**HTTP Method(s):** POST only (others → 405).
**Purpose:** Shopify GDPR mandatory webhook handler — `customers/data_request`. Per its own docblock: *"Log a customer data request so the shop owner can respond. Shopify does NOT expect this endpoint to return data — it expects the merchant to be notified so they can manually provide the data."*
**Parameters/body fields (JSON body):** `shop_domain` (required), `customer_id`, `customer_email`, `orders_requested` (array), `data_request_id`.
**Authentication/verification:** None in this file (Shopify webhook HMAC verification, if any, would need to happen upstream in the Node webhook route before this is called — not verifiable from this file alone).
**Database queries:** `CREATE TABLE IF NOT EXISTS gdpr_data_requests (id, shop_domain, customer_id BIGINT, customer_email, orders_requested TEXT, data_request_id BIGINT, requested_at TIMESTAMP)` (idempotent), then `INSERT INTO gdpr_data_requests (shop_domain, customer_id, customer_email, orders_requested, data_request_id) VALUES (...)` (`orders_requested` JSON-encoded).
**Response shape:** `{"success": true, "message": "Data request logged"}`; errors `{"success": false, "error": "shop_domain required"}` (400) or exception message (500).
**Validation performed:** `shop_domain` required.
**Error handling:** try/catch around table-create + insert, catches generic `Exception`.
**Business logic:** Compliance logging only — no automated data export; a human must act on the logged row.
**Called by:** `app/routes/webhooks.customers.data_request.jsx` (Shopify webhook route, per matching GDPR-webhook naming convention and file reference found in `app/`).

---

## `customers-redact.php`

**File path:** `php_backend/customers-redact.php`
**Endpoint URL:** `https://int.thecomboforge.com/customers-redact.php`
**HTTP Method(s):** POST only (others → 405).
**Purpose:** Shopify GDPR mandatory webhook handler — `customers/redact`. Per its docblock: *"Anonymize / delete all personal data for the given customer. Must be completed within 30 days of receiving this request."*
**Parameters/body fields (JSON body):** `shop_domain` (required), `customer_id` (required), `customer_email`, `customer_phone`, `orders_to_redact` (array).
**Authentication/verification:** None in this file.
**Database queries:**
- `SHOW TABLES` to get the full table list.
- For each table in a hardcoded list (`$emailTables = ['analytics']` — the code comment says "add any tables that store customer email", implying this list is intentionally minimal/incomplete today), checks (via `SHOW COLUMNS`) if it has both `customer_email` and `shop_domain` columns, and if so: `UPDATE \`$table\` SET customer_email = '[redacted]' WHERE shop_domain = :shop AND customer_email = :email`.
- `CREATE TABLE IF NOT EXISTS gdpr_redactions (id, shop_domain, customer_id BIGINT, customer_email, redacted_at)` (idempotent), then `INSERT INTO gdpr_redactions (shop_domain, customer_id, customer_email) VALUES (...)`.
**Response shape:** `{"success": true, "message": "Customer data redacted", "tables_updated": [...]}`; errors as `{"success": false, "error": "..."}` (400/500).
**Validation performed:** `shop_domain` and `customer_id` required.
**Error handling:** try/catch, generic `Exception`.
**Business logic:** **Only actually anonymizes the `analytics` table** (the sole entry in `$emailTables`) — no other table in the schema (e.g. `cart_click_events`, `ai_messages`) is touched even if it happened to store a customer email, because they're not in the hardcoded list. This is a narrow/partial GDPR redaction implementation as currently written; every redaction attempt is logged to `gdpr_redactions` regardless of whether any row was actually found/updated.
**Called by:** `app/routes/webhooks.customers.redact.jsx`.

---

## `db_proxy.php`

**File path:** `php_backend/db_proxy.php`
**Endpoint URL:** `https://int.thecomboforge.com/db_proxy.php`
**HTTP Method(s):** POST only (others → 405).
**Purpose:** A generic parameterized-SQL-over-HTTPS proxy that lets the Node app's "direct MySQL" layer (`app/services/db.server.js` / `app/db.server.js`) execute arbitrary SQL against the same MySQL database when a direct TCP MySQL connection isn't available (e.g. connection-limit constraints, or Node hosted somewhere that can't reach MySQL directly, like Fly.io — per the file's own docblock). This is effectively the transport underneath most of the Node app's "direct MySQL pool" calls once you account for discrepancy #4 above.
**Parameters/body fields (JSON body):** `sql` (string, required — a full parameterized SQL statement using `?` placeholders), `params` (array, required — bind values, positional).
**Authentication/verification:** `X-Forge-Secret` vs `SHOPIFY_API_KEY` — 403 if mismatched (same shared-secret gate as every other authenticated file). The file's own comment is explicit about the trust model: *"Node already fully controls every SQL string sent here (it's the same trust boundary a direct MySQL connection would have) — this endpoint just changes the transport."*
**Database queries:** Whatever `sql`/`params` the caller sends — executed via `$pdo->prepare($sql); $stmt->execute(array_values($params));`. A regex guard (`preg_match('/;\s*\S/', ...)`) rejects **stacked statements** (more than one SQL statement per call), matching the semantics of a single `mysql2` pool `.execute()` call on the Node side.
**Response shape:**
- For `SELECT`/`SHOW`/`DESCRIBE`/`DESC`/`EXPLAIN` (detected via regex on the SQL prefix): `{"success": true, "rows": [...]}`.
- For everything else (INSERT/UPDATE/DELETE/DDL): `{"success": true, "insertId": <int>, "affectedRows": <int>}`.
- Errors: `{"success": false, "error": "sql (string) is required"}` / `"params must be an array"` / `"Multiple statements are not allowed"` (400), or the raw exception message (500).
**Validation performed:** `sql` must be a non-empty string; `params` must be an array; single-statement-only guard.
**Error handling:** try/catch around prepare+execute, returns the raw `Exception` message to the client (again, an info-leak tradeoff consistent with the rest of the codebase).
**Business logic:** This is effectively a raw SQL-execution-as-a-service endpoint, deliberately unrestricted in *what* SQL it runs (full trust in the Node caller, gated only by the shared secret) but restricted in *shape* (one statement, parameterized only). Given its power, the `X-Forge-Secret` check here is the single most security-critical auth check in the whole `php_backend/` directory — if `SHOPIFY_API_KEY` is ever unset on the deployed server, this endpoint would accept arbitrary SQL from anyone.
**Called by:** `app/services/db.server.js` and `app/db.server.js` (both explicitly document, in code comments, that "this pool is actually an HTTPS proxy to `php_backend/db_proxy.php`"). This is the underlying transport for essentially every `getDb()`-based Node route in the app (`api.cart-drawer-config.jsx`, `api.progress-bar.jsx`, `api.upsell-settings.jsx`, `api.coupon-slider-settings.jsx`, and many more).

---

## `fbt.php`

**File path:** `php_backend/fbt.php`
**Endpoint URL:** `https://int.thecomboforge.com/fbt.php`
**HTTP Method(s):** GET, POST, OPTIONS (OPTIONS → 200 for CORS preflight; GET/POST share identical generic logging logic).
**Purpose:** **Despite the name, this is a generic inbound-webhook capture stub with no FBT (frequently-bought-together) logic whatsoever** — identical in structure to `createdcoupon.php`, `test.php`, `test2.php`, differing only in its log directory. See discrepancy #7 above. Logs every request to `php_backend/webhook3_logs/`.
**Parameters/body fields:** None read/validated — raw body captured verbatim.
**Authentication/verification:** None.
**Database queries:** None — file-based logging only.
**Response shape:** `{"status":"received"}`, HTTP 200.
**Validation performed:** None.
**Error handling:** None.
**Business logic:** Write-every-request-to-disk. **Not** the real FBT widget config endpoint — that is `save_fbt_widget.php` (writes to `fbt_widget`/`fbt_widget_settings`/`fbt_rules` tables).
**Called by:** Unknown / not referenced in `app/`. Likely a leftover webhook-inspection tool.

---

## `get_schema.php`

**File path:** `php_backend/get_schema.php`
**Endpoint URL:** `https://int.thecomboforge.com/get_schema.php`
**HTTP Method(s):** Any (no method check) — read-only debug tool.
**Purpose:** Dumps the full database schema (every table and every column's `DESCRIBE` output) as JSON. Ops/debug tool.
**Parameters/body fields:** None.
**Authentication/verification:** None.
**Database queries:** Opens its own **separate mysqli connection** (`new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME)`, distinct from the `$pdo` that `config.php` already provides — redundant but functional since `DB_HOST`/`DB_USER`/`DB_PASS`/`DB_NAME` constants are all defined by `config.php`). Runs `SHOW TABLES`, then `DESCRIBE \`$table\`` for every table found.
**Response shape:** `{"tables": {"<table_name>": [<column info objects from DESCRIBE>, ...], ...}}`. On connection failure: `{"error": "Connection failed: ..."}` (via `die()`, no explicit HTTP status code set).
**Validation performed:** None.
**Error handling:** Only the initial `connect_error` check via `die()`; no try/catch around the loop.
**Business logic:** Pure schema-introspection debug tool, functionally overlapping with `check_schema.php` (single table) and `test_db.php` (table names only, via PDO).
**Called by:** Not referenced in `app/` — manual/ops debug script.

---

## `install_shop.php`

**File path:** `php_backend/install_shop.php`
**Endpoint URL:** `https://int.thecomboforge.com/install_shop.php` — **but see discrepancy #2**: the actual live caller (`app/routes/app._index.jsx`) fetches `https://int.thecartninja.com/install_shop.php`, a different domain than every other endpoint documented here.
**HTTP Method(s):** POST, OPTIONS (OPTIONS → `exit(0)` with 200-ish empty response for CORS preflight).
**Purpose:** Registers/reactivates a shop in the `shops` table on app install, then fires a one-way notification to an external logging endpoint.
**Parameters/body fields (JSON body):** `shop` (required), `accessToken`.
**Authentication/verification:** None.
**Database queries:** `INSERT INTO shops (shop_domain, access_token, is_active, created_at, updated_at) VALUES (...) ON DUPLICATE KEY UPDATE access_token = VALUES(access_token), is_active = 1, updated_at = NOW()`.
**Response shape:** `{"success": true, "message": "Shop installed and marked active"}`; error `{"error": "Shop parameter is required"}` (400) or `{"error": "Failed to install shop: ..."}` (500).
**Validation performed:** `shop` required.
**Error handling:** try/catch around the DB write, generic `Exception`.
**Business logic:** After the upsert, fires an async-ish (result ignored) `curl` POST to `https://int.thecartninja.com/shop_logger.php` (note: yet another reference to the `thecartninja.com` domain, alongside `shop_logger.php` in this same directory which is presumably the *actual* production handler for that call — this file calls an external URL rather than including `shop_logger.php` locally) with `{shop, action: 'shop_installed', details: '...'}`. The curl response is not checked or awaited meaningfully.
**Called by:** `app/routes/app._index.jsx` — but note it's called at `https://int.thecartninja.com/install_shop.php`, not the `int.thecomboforge.com` domain this repo's own `install_shop.php` would deploy to. Whether the `int.thecartninja.com` server runs the same code as this local file could not be verified from source.

---

## `migrate.php`

**File path:** `php_backend/migrate.php`
**Endpoint URL:** `https://int.thecomboforge.com/migrate.php`
**HTTP Method(s):** Any (no method check) — "run via browser or CLI" per its own comment; safe to re-run.
**Purpose:** Ad-hoc, hand-maintained column-migration script (not a formal migration framework) — adds specific columns to specific tables if they don't already exist.
**Parameters/body fields:** None.
**Authentication/verification:** None.
**Database queries:**
- Migration 1: checks `INFORMATION_SCHEMA.COLUMNS` for `coupon_slider_settings.selected_coupons`; if absent, `ALTER TABLE coupon_slider_settings ADD COLUMN selected_coupons LONGTEXT NULL AFTER layout`.
- Migration 2: checks for `upsell_widget_settings.manual_rules`; if absent, `ALTER TABLE upsell_widget_settings ADD COLUMN manual_rules LONGTEXT NULL AFTER active_template`.
Uses a shared `runMigration($pdo, $label, $checkSql, $checkParams, $alterSql)` helper that returns `status: skipped|applied|error` per migration.
**Response shape:** `{"success": bool, "migrations": [{"label", "status", "note"}, ...], "summary": {"applied": n, "skipped": n, "errors": n}}` (pretty-printed JSON).
**Validation performed:** None.
**Error handling:** Each migration individually try/catches `PDOException` and records `status: 'error'` rather than aborting the whole script.
**Business logic:** A manually-curated, append-only list of ad-hoc `ALTER TABLE` migrations — these two migrations correspond exactly to the `selected_coupons`/`manual_rules` fields referenced throughout `coupon_slider_settings.php` and `upsell_settings.php`/`save_fbt_widget.php` respectively, confirming those columns were added after initial schema creation.
**Called by:** Not referenced in `app/` — manual/ops migration script.

---

## `progress_bar.php`

**File path:** `php_backend/progress_bar.php`
**Endpoint URL:** `https://int.thecomboforge.com/progress_bar.php`
**HTTP Method(s):** GET, POST. Others → 405.
**Purpose:** Standalone REST-style read/write endpoint for `progress_bar_settings` + `progress_bar_tiers` (free-shipping/reward-tier progress bar config). **Not called by current Node admin routes** (`app/routes/api.progress-bar.jsx` uses `getDb()`/raw SQL against the same tables instead — see discrepancy #4). Still exercised by `tests/specs/api/progress-bar.spec.ts`.
**Parameters/body fields:**
- GET: `shop` query param (required).
- POST (JSON body): `shop` (required), settings fields — `is_enabled` (default `0`), `mode` (default `'amount'`), `show_on_empty` (default `1`), `bar_background_color` (default `#e5e7eb`), `bar_foreground_color` (default `#2563eb`), `icon_color` (default `#2563eb`), `border_radius` (default `8`), `placement` (default `'top'`), `completion_text` (default `"You've unlocked free shipping!"`), `completion_text_color` (default `#10b981`), `enable_confetti` (default `1`); plus `tiers` (array, each with `min_value`/`minValue`, `min_quantity`/`minQuantity`, `description` default `'Milestone'`, `reward_type`/`rewardType` default `'free_shipping'`, `icon_type`/`iconType` default `'preset'`, `icon_preset`/`iconPreset` default `'gift'`, `icon_custom_svg`/`iconCustomSvg`, `products` array).
**Authentication/verification:** `X-Forge-Secret` vs `SHOPIFY_API_KEY` (403 if mismatched, skipped if unset).
**Database queries:**
- GET: `SELECT * FROM progress_bar_settings WHERE shop_domain = ? LIMIT 1`; if found, `SELECT * FROM progress_bar_tiers WHERE settings_id = ? AND is_active = 1 ORDER BY sort_order ASC`, with each tier's `reward_products` JSON-decoded.
- POST: `INSERT INTO progress_bar_settings (...) VALUES (...) ON DUPLICATE KEY UPDATE ...` (full-row upsert of the settings columns above), resolves `settingsId` (via `lastInsertId()` on true insert, or a follow-up `SELECT id ... WHERE shop_domain = ?` on update), then **deletes all existing tiers** (`DELETE FROM progress_bar_tiers WHERE settings_id = ?`) and re-inserts every tier from the request body in order (`sort_order` = array index), each with `is_active = 1`.
**Response shape:** `{"status":"success","data": {...settings row, "tiers": [...]} | null}`.
**Validation performed:** `shop` required on both verbs. `flag()` helper as elsewhere.
**Error handling:** No try/catch around the writes — relies on PDO exception mode.
**Business logic:** Same delete-then-reinsert pattern for tiers as `combo_save.php` uses for its child collections — full replace on every save, not a diff/merge.
**Called by:** Not found in current Node admin routes (see discrepancy #4); exercised by `tests/specs/api/progress-bar.spec.ts`.

---

## `save_cart_drawer.php`

**File path:** `php_backend/save_cart_drawer.php`
**Endpoint URL:** `https://int.thecomboforge.com/save_cart_drawer.php` (via app proxy from the storefront: `/apps/cart-app/save_cart_drawer.php`, per CLAUDE.md's App Proxy description).
**HTTP Method(s):** GET (storefront widget config fetch), POST (admin/legacy blob save). Others → 405.
**Purpose:** The most heavily-loaded endpoint in the backend — reads/writes the **legacy** `cart_drawer` table (JSON-blob columns: `progress_data`, `coupon_data`, `upsell_data`, `checkout_button_style`), the table CLAUDE.md describes as "distinct from `cart_drawer_config` (newer normalized table)". GET is what the storefront widget actually consumes (via the App Proxy); it also joins in several `cart_drawer_config` columns, merges upsell rules from `upsell_widget_settings`, and applies plan-based feature gating before returning.
**Parameters/body fields:**
- GET: `shopdomain` query param (required).
- POST: accepts several body shapes (`file_get_contents('php://input')` JSON-decoded, or urlencoded form-decoded as fallback, or `$_POST`; and supports either a flat body or one wrapped in a top-level `payload` key, which may itself be a JSON string). Shop is read from `shop`, `shopDomain`, `Id`, or `id` (first non-null wins). Fields read: `cartstatus`/`cartStatus`, `progress_data`/`progressData`, `coupon_data`/`couponData`, `upsell_data`/`upsellData`, `settings_data` (object or JSON string, itself containing `checkoutName`, `checkoutFooterText`, `customCSS`, `checkout_button_style`), `checkoutName`, `checkoutFooterText`, `customCSS`, `checkout_button_style`, `progress_status`/`progressStatus`, `coupon_status`/`couponStatus`, `upsell_status`/`upsellStatus`, `watermark_enabled`/`settingsData.watermarkEnabled`.
**Authentication/verification:** **None** on either GET or POST in this file (no `X-Forge-Secret` check) — despite this being the endpoint that actually persists cart-drawer config and is reachable both from the Node admin and, per CLAUDE.md, from the storefront App Proxy.
**Database queries:**
- GET: `SELECT cd.*, cdc.announcement_enabled, cdc.announcement_text, cdc.announcement_bg_color, cdc.announcement_text_color, cdc.announcement_font_size, cdc.header_title, cdc.header_bg_color, cdc.header_text_color, cdc.header_border_bottom, cdc.design_animation, cdc.design_border_radius, cdc.design_shadow, cdc.design_width, cdc.empty_cart_message, cdc.empty_cart_show_continue_shopping, cdc.empty_cart_show_recommendations FROM cart_drawer cd LEFT JOIN cart_drawer_config cdc ON cdc.shop_domain = cd.shop COLLATE utf8mb4_unicode_ci WHERE cd.shop = :shop LIMIT 1`. Also calls `ensureWatermarkColumn($pdo)` (lazily `ALTER TABLE cart_drawer ADD COLUMN watermark_enabled TINYINT(1) NOT NULL DEFAULT 1` if missing), `mergeUpsellWidgetSettings()` (reads `upsell_widget_settings.is_enabled`/`manual_rules` and merges into the `upsell_data` JSON), and `resolve_plan_key()` + `applyPlanGatingToCartDrawerResult()` (strips/mutates gated fields in the response only).
- POST: single large `INSERT INTO cart_drawer (shop, cartStatus, progress_data, coupon_data, upsell_data, checkoutName, checkoutFooterText, customCSS, checkout_button_style, progress_status, coupon_status, upsell_status, watermark_enabled, progress_updated_at, coupon_updated_at, upsell_updated_at, updated_at) VALUES (...) ON DUPLICATE KEY UPDATE ...`, keyed on `shop`. The `*_updated_at` columns are conditionally bumped only if the corresponding `*_data` field was actually present in this save (`IF(VALUES(progress_data) IS NOT NULL, CURRENT_TIMESTAMP(3), progress_updated_at)`), so an unrelated save doesn't falsely mark, e.g., the progress bar as "just updated."
**Response shape:**
- GET: `{"status":"success","data": {...merged/gated row...}}`; `{"status":"error","message":"No data found for this shop"}` if no row; `{"status":"error","message":"shopdomain parameter required"}` (400); `{"status":"error","message":"Fetch failed: ..."}` (500).
- POST: `{"status":"success","message":"Cart drawer data saved successfully"}`; errors for missing shop (400), invalid/empty payload (400), or DB failure (500, `"Database save failed: ..."`).
**Validation performed:** `shopdomain`/`shop` required on both verbs. Payload must decode to an array/object (checked at multiple fallback stages: raw JSON → urlencoded form → `$_POST`).
**Error handling:** GET wrapped in try/catch (`PDOException`); POST wrapped in try/catch around the final `execute()` only (earlier parsing errors exit directly with 400, not via catch).
**Business logic (plain English):**
1. **GET (storefront read path)**: Fetch the legacy blob row, merge in newer normalized-table data (`cart_drawer_config` announcement/header/design/empty-cart columns via JOIN; `upsell_widget_settings` manual rules via a dedicated merge function — because, per the code's own comment, "a rule created via the admin (or the AI agent) is correctly persisted but the storefront widget, which only ever reads `cart_drawer.upsell_data` here, never sees it" without this merge), then strip anything the shop's current plan doesn't allow to *publish* (progress bar, confetti, AI cart upsell, custom CSS, mobile swipe checkout, open countdown timers) — all via `applyPlanGatingToCartDrawerResult()`, which only mutates the outgoing array, never the stored row, so a downgrade-then-upgrade cycle doesn't lose the merchant's actual saved design.
2. **POST (save path)**: Normalize a wide variety of possible payload shapes/field-name variants into canonical values, then re-apply the *exact same* plan-gating rules as GET but on the way *in* — described in the code's own comment as defense-in-depth: *"The admin UI lets a Free merchant fully customize/save these design-type fields ... but never lets them publish. This endpoint is what actually enforces that ... even a row saved while on a paid plan won't leak these to the storefront after a downgrade"* (the GET-side stripping is the second layer of that same defense). Free-plan shops always get `watermark_enabled` forced to `1` regardless of what was submitted.
**Called by:** `app/routes/save_cart_drawer[.]php.jsx` (the `.php.jsx` proxy-route pattern CLAUDE.md describes as "PHP-compatible endpoint proxies... accepts POST from the storefront extension"), and `app/services/cart-drawer-record.server.js` / `app/services/store-config-snapshot.server.js` for reads (inferred from grep match; exact call shape not individually re-verified in this audit).

---

## `save_coupon.php`

**File path:** `php_backend/save_coupon.php`
**Endpoint URL:** `https://int.thecomboforge.com/save_coupon.php`
**HTTP Method(s):** GET (list coupons for a shop), POST (upsert one coupon). Others → 405.
**Purpose:** Persists Shopify discount/coupon metadata (as an opaque JSON blob) into the `coupons` table, separate from the coupon *slider widget display* config (`coupon_slider_widget`/`coupon_slider_settings`).
**Parameters/body fields:**
- GET: `shopdomain` query param (required).
- POST (JSON body, optionally wrapped in `payload`): `id` (required, → `internal_id`), `shopifyId` (→ `shopify_id`), `code` (required), `shopDomain` (required). The **entire POST payload** is also re-`json_encode()`d in full and stored verbatim as `discount_config` (i.e. every field the caller sends, not just the four named ones, ends up persisted).
**Authentication/verification:** None.
**Database queries:**
- GET: `SELECT internal_id, shopify_id, shop_domain, code, discount_config, is_active FROM coupons WHERE shop_domain = :shop_domain` (all rows for the shop); `discount_config` JSON-decoded per row before returning.
- POST: `INSERT INTO coupons (internal_id, shopify_id, shop_domain, code, discount_config, is_active) VALUES (...) ON DUPLICATE KEY UPDATE shopify_id = VALUES(shopify_id), code = VALUES(code), discount_config = VALUES(discount_config), is_active = 1` (upsert keyed on `internal_id`, presumably a unique key).
**Response shape:**
- GET: `{"status":"success","data": [...]}`; `{"status":"error","message":"No coupons found for this shop"}` if empty (note: no HTTP error status set for this "not found" case — it's a 200 with an error-shaped body); `{"status":"error","message":"shopdomain parameter required"}` (400).
- POST: `{"status":"success","message":"Coupon saved successfully"}`; `{"status":"error","message":"Missing required fields: id, code, shopDomain"}` (400, lists exactly which are missing); `{"status":"error","message":"Invalid JSON: ..."}` (400); `{"status":"error","message":"Empty payload"}` (400); `{"status":"error","message":"Database save failed: ..."}` (500).
**Validation performed:** GET requires `shopdomain`. POST requires `id`, `code`, `shopDomain` (individually checked, all missing ones reported together).
**Error handling:** try/catch around each DB operation, catching `PDOException`.
**Business logic:** A generic "save whatever discount config the caller has" endpoint — `discount_config` is not a fixed schema, it's whatever JSON the Node side constructed for a given discount type, making this endpoint schema-agnostic on the discount-shape side while still requiring the three identifying fields.
**Called by:** Likely the Node discount-creation flow described in the user's memory (`project_ai_discount_creation.md` — "create a discount X, N% off... creates a real Shopify discountCodeBasicCreate via chat") persisting a local record of that discount; exact Node call site not directly grepped in this audit (filename doesn't appear in the `app/` grep results collected here — worth the Node-side documenter double-checking whether this endpoint is still actively called or has been superseded by `discount.php`, which api-helpers.js does actively call but which does not exist in this local `php_backend/` checkout — see discrepancy #3).

---

## `save_coupon_slider_widget.php`

**File path:** `php_backend/save_coupon_slider_widget.php`
**Endpoint URL:** `https://int.thecomboforge.com/save_coupon_slider_widget.php` (storefront reads it via the App Proxy per CLAUDE.md: "`save_coupon_slider_widget.php`... widget config read by the storefront via app proxy").
**HTTP Method(s):** GET, POST. Others → 405.
**Purpose:** The actively-used persistence layer for the coupon slider's **per-template display content** (`coupon_slider_widget` table: up to 3 templates' styles/coupon-styles/coupon-conditions, plus which coupon(s) are selected) — distinct from `coupon_slider_settings.php`'s general widget behavior/position config. Extensive request/response logging to disk for debugging.
**Parameters/body fields:**
- GET: `shopdomain` or `shopDomain` query param (required).
- POST (JSON body, optionally wrapped in `payload`): `shopDomain`/`shopdomain`/`shop` (required), `template1`, `template2`, `template3` (each an object, possibly containing nested `styles`, `couponStyles`/`couponStyle`, `couponConditions`/`conditions`), `selectedTemplate`/`selectedTemp`, `selectedTemplateCoupon`/`selectedCouponsGlobal`/`selectedCoupon`/`selectedCoupons` (accepts a single coupon identifier, an array, or a JSON-encoded string of either), and flat fallback keys `temp1DefaultStyle`/`temp2DefaultStyle`/`temp3DefaultStyle`, `temp1CouponStyle`/`temp2CouponStyle`/`temp3CouponStyle`, `temp1CouponCondition`/`temp2CouponCondition`/`temp3CouponCondition` if the nested-per-template shape isn't used.
**Authentication/verification:** None.
**Database queries:**
- GET: `SELECT * FROM coupon_slider_widget WHERE shopDomain = :shopDomain LIMIT 1`; JSON-decodes `temp1DefaultStyle`, `temp2DefaultStyle`, `temp3DefaultStyle`, `selectedTemplateCoupon`, `temp1CouponStyle`, `temp2CouponStyle`, `temp3CouponStyle`, `temp1CouponCondition`, `temp2CouponCondition`, `temp3CouponCondition`; also does a secondary `SELECT position, is_enabled, layout FROM coupon_slider_settings WHERE shop_domain = ? LIMIT 1` to pull in placement/enabled/layout, defaulting to `above_cart`/`list` if that row is missing; applies `resolve_plan_key()` + `plan_can_publish_feature($planKey, 'coupon_lock_pro')` to zero out `is_enabled` on plans that can't publish the feature.
- POST: `INSERT INTO coupon_slider_widget (shopDomain, temp1DefaultStyle, temp2DefaultStyle, temp3DefaultStyle, selectedTemplate, selectedTemplateCoupon, temp1CouponStyle, temp2CouponStyle, temp3CouponStyle, temp1CouponCondition, temp2CouponCondition, temp3CouponCondition, updated_at) VALUES (...) ON DUPLICATE KEY UPDATE ...` (full-row upsert keyed on `shopDomain`).
**Response shape:**
- GET: `{"status":"success","data": {...row, selectedCouponsGlobal: [...ids], selectedTemplateCoupon: <first id or null>, widgetPlacement, is_enabled, layout}}`; errors as `{"status":"error","message":"..."}`.
- POST: `{"status":"success","message":"Coupon slider widget saved successfully"}`; errors for missing method/payload/JSON/shopDomain (400/405) or DB failure (500).
**Validation performed:** `shopDomain` required on both verbs (multiple key-name fallbacks accepted).
**Error handling:** try/catch on both GET and POST DB operations; every branch also calls `logRequest()`/`logError()` (writing to `php_backend/logs/coupon_slider_request.log` / `coupon_slider_error.log`) — this file has by far the most verbose diagnostic logging of any file in the directory.
**Business logic:** Heavy normalization layer reconciling many possible caller payload shapes (flat legacy field names vs. nested-per-template objects; single coupon vs. array of coupons) into one canonical stored representation, and reversing that normalization on the way out (e.g. `selectedCouponsGlobal` array always returned, with `selectedTemplateCoupon` kept as a single-value alias "for older consumers" per the code's own comment). Also cross-references `coupon_slider_settings` for placement/enabled/layout so a single GET gives the storefront everything it needs from two tables in one call.
**Called by:** Storefront extension, via the App Proxy (`/apps/cart-app/save_coupon_slider_widget.php` per CLAUDE.md), and Node's `app/routes/save_coupon_slider_widget[.]php.jsx` proxy route.

---

## `save_fbt_widget.php`

**File path:** `php_backend/save_fbt_widget.php`
**Endpoint URL:** `https://int.thecomboforge.com/save_fbt_widget.php` (storefront reads via App Proxy per CLAUDE.md).
**HTTP Method(s):** GET, POST. Others → 405.
**Purpose:** Persists the "Frequently Bought Together" widget's legacy per-template config (`fbt_widget` table: up to 3 templates as JSON, selected template/mode, manual-rule "condition" JSON) **and**, on every POST, also writes the newer normalized tables `fbt_widget_settings` (flat design columns) and `fbt_rules` (structured trigger→offer rules) — keeping both representations in sync in one call.
**Parameters/body fields:**
- GET: `shopdomain` query param (required).
- POST (JSON body, optionally wrapped in `payload`): `shop` (required), `fbt.templates.fbt1`/`fbt2`/`fbt3` (objects, JSON-encoded for storage), `fbt.selectedTemplate`, `fbt.mode`, `fbt.manualRules` (array — JSON-encoded into the `condition` column AND separately exploded into `fbt_rules` rows), `fbt.widgetPlacement` (default `'above_cart'`), `fbt.isEnabled` (default `true`), and an AI-recommendation product count under any of several accepted key spellings: `aiProductCount`, `ai_product_count`, `aiProductsCount`, `aiProductLimit`, `productCount` (checked first inside `fbt`, then at the top level of the payload).
**Authentication/verification:** None.
**Database queries:**
- `detectAiProductCountColumn($pdo)`: `SHOW COLUMNS FROM fbt_widget`, then picks the first matching column name from a preferred list (`aiProductCount`, `ai_product_count`, `AIProductCount`, `aiProductsCount`) or, failing that, any column whose lowercased name contains `ai`, `product`, and `count` as substrings — i.e. the actual DB column name for this field is discovered dynamically rather than hardcoded, presumably because it varies across environments/migrations. Cached in a `static` variable for the life of the request.
- GET: `SELECT * FROM fbt_widget WHERE shopDomain = :shopDomain LIMIT 1`; JSON-decodes `temp1`, `temp2`, `temp3`, `condition`; maps the dynamically-detected AI-count column onto a canonical `aiProductCount` response key; falls back to `fbt_widget_settings.widget_placement` if `widgetPlacement` isn't present in the legacy `temp1` JSON; applies `resolve_plan_key()` + `plan_can_publish_feature($planKey, 'fbt')` — if not publishable, forces `isEnabled: false` at the top level and inside each of `temp1`/`temp2`/`temp3` if present, and reports `publishable: false`.
- POST: dynamically-built `INSERT INTO fbt_widget (shopDomain, temp1, temp2, temp3, selectedTemp, selectedMode, \`condition\` [, <detected AI column>], updated_at) VALUES (...) ON DUPLICATE KEY UPDATE ...` (the AI-count column is only included in the query at all if `detectAiProductCountColumn()` found one). Then, in a nested try/catch (failure here is logged but does not fail the overall save): upserts `fbt_widget_settings` (`shop_domain`, `is_enabled`, `selected_template`, `mode`, `ai_product_count`, `bg_color`, `text_color`, `price_color`, `button_color`, `button_text_color`, `border_color`, `border_radius`, `layout`, `interaction_type`, `show_prices`, `show_add_all_button`, `widget_placement` — values pulled from the active template's styling object, each with a sane default), and replaces `fbt_rules` wholesale (`DELETE FROM fbt_rules WHERE shop_domain = ?` then re-insert one row per rule: `name`, `trigger_scope`/`displayScope`, `trigger_products` (JSON), `trigger_collections` (JSON), `fbt_products` (JSON), `is_active=1`, `sort_order`).
**Response shape:**
- GET: `{"status":"success","data": {...row, aiProductCount, widgetPlacement, publishable}}`; errors as usual pattern.
- POST: `{"status":"success","message":"FBT widget saved successfully"}`; errors for missing method/payload/JSON/shop (400/405) or DB failure (500).
**Validation performed:** `shopdomain`/`shop` required on both verbs.
**Error handling:** GET/POST both try/catch around their primary DB ops; the *secondary* normalized-table writes on POST are wrapped in their own inner try/catch that only `error_log()`s on failure (`'[save_fbt_widget] normalized write failed: ' . $eNorm->getMessage()`) rather than surfacing an error to the client — i.e. the legacy save can succeed while the normalized-table sync silently fails.
**Business logic:** Same dual-write pattern CLAUDE.md flags generally for this app (write to both a legacy blob table and a newer normalized table) — explicitly so both the old widget code path and any newer admin/AI-agent code path that reads `fbt_widget_settings`/`fbt_rules` directly stay in sync. The dynamic-column-detection logic for the AI product count is the most defensive/unusual piece of code in this file, suggesting the column name changed across deployments/migrations at some point.
**Called by:** Storefront extension via App Proxy, and Node's `app/routes/save_fbt_widget[.]php.jsx` proxy route; also read by `app/routes/app.fbt.jsx` (admin FBT settings page) per grep match.

---

## `session_ping.php`

**File path:** `php_backend/session_ping.php`
**Endpoint URL:** `https://int.thecomboforge.com/session_ping.php`
**HTTP Method(s):** Implicitly POST (reads raw JSON body; no explicit method check).
**Purpose:** Lightweight visitor/session heartbeat for analytics — approximates unique sessions and pageviews per shop, independent of full order/click tracking. Its own comment cross-references "analytics plan section 1.6" and notes the same `analytics_sessions` table is also lazily created Node-side by `app/services/analytics-schema.server.js`, with this file creating it too "so this endpoint works independently of whether the Node process has started yet."
**Parameters/body fields (JSON body):** `domain` (required), `session_id` (required), `page_type`.
**Authentication/verification:** None.
**Database queries:** `CREATE TABLE IF NOT EXISTS analytics_sessions (id, shop_domain, session_id, page_type, first_seen_at, last_seen_at, pageview_count, UNIQUE KEY uniq_shop_session (shop_domain, session_id), ...)` (idempotent, runs every request), then `INSERT INTO analytics_sessions (shop_domain, session_id, page_type) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE last_seen_at = NOW(), pageview_count = pageview_count + 1`.
**Response shape:** `{"status":"success"}`; `{"status":"error","message":"domain and session_id required"}` (400).
**Validation performed:** `domain` and `session_id` required.
**Error handling:** No try/catch — relies on PDO exception mode.
**Business logic:** Upsert-and-increment session tracking — first ping for a `(shop_domain, session_id)` pair creates the row (`pageview_count` starts at the column default of `1`), every subsequent ping in the same session bumps `last_seen_at` and increments `pageview_count`.
**Called by:** Storefront extension (session/pageview heartbeat), not found referenced in `app/` Node routes — consistent with being a direct storefront→PHP call via the App Proxy.

---

## `shop-redact.php`

**File path:** `php_backend/shop-redact.php`
**Endpoint URL:** `https://int.thecomboforge.com/shop-redact.php`
**HTTP Method(s):** POST only (others → 405).
**Purpose:** Shopify GDPR mandatory webhook handler — `shop/redact`. Per its docblock: *"Permanently delete ALL data for a shop. Triggered 48 hours after the merchant uninstalls the app."*
**Parameters/body fields (JSON body):** `shop_domain` (required), `shop_id`.
**Authentication/verification:** None in this file.
**Database queries:** `SHOW TABLES` to get the existing table list, then for each of a hardcoded list — `cart_drawer` (col `shop`), `shops` (col `shop_domain`), `billing_usage` (col `shop_domain`), `billing_charges` (col `shop_domain`), `analytics` (col `shop_domain`), `gdpr_data_requests` (col `shop_domain`), `gdpr_redactions` (col `shop_domain`) — if the table exists, runs `DELETE FROM \`table\` WHERE \`column\` = :shop`. Then `CREATE TABLE IF NOT EXISTS gdpr_shop_redactions (id, shop_domain, shop_id BIGINT, redacted_at)` and inserts a log row.
**Response shape:** `{"success": true, "message": "All data deleted for $shop", "deleted": ["cart_drawer (3 rows)", ...]}`; errors `{"success": false, "error": "shop_domain required"}` (400) or exception message (500).
**Validation performed:** `shop_domain` required.
**Error handling:** try/catch, generic `Exception`.
**Business logic:** **Notably incomplete relative to the app's actual schema** — the hardcoded table list does *not* include `cart_drawer_config`, `progress_bar_settings`, `progress_bar_tiers`, `upsell_widget_settings`, `fbt_widget`, `fbt_widget_settings`, `fbt_rules`, `coupon_slider_settings`, `coupon_slider_widget`, `coupons`, `combo_templates` and its child tables, `ai_conversations`, `ai_messages`, `cart_click_events`, or `analytics_sessions` — all of which are shop-scoped tables documented elsewhere in this file and clearly store shop-specific (and in some cases customer-adjacent, e.g. `ai_messages`) data. As currently written, a `shop/redact` webhook would leave the vast majority of a departed merchant's data in place. The file's own comment even says *"Adjust table/column names to match your actual schema"* — implying this was scaffolded once and never updated as the schema grew. **This is a compliance gap worth flagging explicitly**, not just an implementation detail.
**Called by:** `app/routes/webhooks.shop.redact.jsx`.

---

## `shop_logger.php`

**File path:** `php_backend/shop_logger.php`
**Endpoint URL:** `https://int.thecomboforge.com/shop_logger.php` (though `install_shop.php` in this same directory actually calls `https://int.thecartninja.com/shop_logger.php` instead — see discrepancy #2; whether that remote copy matches this local file's code could not be verified).
**HTTP Method(s):** POST, OPTIONS (OPTIONS → `exit(0)`).
**Purpose:** Generic append-only action/event logger to a local file (not a DB table) — used to record shop-lifecycle events like installs.
**Parameters/body fields (JSON body):** `shop` (default `'unknown_shop'`), `action` (default `'log'`), `details` (any shape).
**Authentication/verification:** None.
**Database queries:** None — this file only writes to `php_backend/logs/shop_handle_error.log` (`file_put_contents(..., FILE_APPEND | LOCK_EX)`), despite `config.php` being included (its `$pdo` connection is unused here).
**Response shape:** `{"success": true, "message": "Log successfully written to shop_handle_error.log"}`; `{"error": "Failed to write to log file"}` (500) if the file write fails.
**Validation performed:** None (all fields optional with defaults).
**Error handling:** Checks the `file_put_contents` return value for `false` and reports 500 accordingly; no try/catch (no DB calls to fail).
**Business logic:** Pure append-only text logger, formatted as pretty-printed JSON blocks separated by `---`.
**Called by:** `install_shop.php` (via `curl`, fire-and-forget, at `int.thecartninja.com` rather than `int.thecomboforge.com` — see discrepancy #2). No other file in this directory or `app/` was found calling it.

---

## `test.php`

**File path:** `php_backend/test.php`
**Endpoint URL:** `https://int.thecomboforge.com/test.php`
**HTTP Method(s):** GET, POST, OPTIONS.
**Purpose:** Generic inbound-webhook capture stub — identical structure to `test2.php`/`fbt.php`/`createdcoupon.php`, logs to `php_backend/webhook_logs/`.
**Parameters/body fields:** None read/validated.
**Authentication/verification:** None.
**Database queries:** None.
**Response shape:** `{"status":"received"}`.
**Validation performed:** None.
**Error handling:** None.
**Business logic:** Write-every-request-to-disk debug capture.
**Called by:** Unknown / not referenced in `app/`.

---

## `test2.php`

**File path:** `php_backend/test2.php`
**Endpoint URL:** `https://int.thecomboforge.com/test2.php`
**HTTP Method(s):** GET, POST, OPTIONS.
**Purpose:** Generic inbound-webhook capture stub, identical structure to `test.php`, logs to `php_backend/webhook2_logs/` (the most populated log directory found on disk during this audit, suggesting it was the most recently/actively used of the four generic loggers).
**Parameters/body fields:** None read/validated.
**Authentication/verification:** None.
**Database queries:** None.
**Response shape:** `{"status":"received"}`.
**Validation performed:** None.
**Error handling:** None.
**Business logic:** Write-every-request-to-disk debug capture.
**Called by:** Unknown / not referenced in `app/`.

---

## `test_db.php`

**File path:** `php_backend/test_db.php`
**Endpoint URL:** `https://int.thecomboforge.com/test_db.php`
**HTTP Method(s):** Any (no method check) — read-only debug tool.
**Purpose:** Minimal DB connectivity/introspection check — confirms which database `$pdo` is actually connected to and lists its tables.
**Parameters/body fields:** None.
**Authentication/verification:** None.
**Database queries:** `SELECT DATABASE() AS db`; `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`.
**Response shape:** `{"status":"ok","database": "cart_drawer_ninja","tables": [...]}` (pretty-printed); on failure `{"status":"error","message":"..."}`.
**Validation performed:** None.
**Error handling:** try/catch, generic `Exception`.
**Business logic:** Pure connectivity/ops sanity check.
**Called by:** `app/routes/api.test-php.jsx` (per grep match — a Node-side "ping the PHP backend" diagnostic route).

---

## `uninstall_shop.php`

**File path:** `php_backend/uninstall_shop.php`
**Endpoint URL:** `https://int.thecomboforge.com/uninstall_shop.php` — **but see discrepancy #2**: the actual live caller (`app/routes/webhooks.app.uninstalled.jsx`) fetches `https://int.thecartninja.com/uninstall_shop.php`, a different domain than this repo would deploy this file to.
**HTTP Method(s):** POST, OPTIONS (OPTIONS → `exit(0)`).
**Purpose:** Marks a shop inactive (`is_active = 0`) on app uninstall.
**Parameters/body fields (JSON body):** `shop` (required).
**Authentication/verification:** None.
**Database queries:** `UPDATE shops SET is_active = 0, updated_at = NOW() WHERE shop_domain = :shop_domain`. A second, commented-out line hints at an intended-but-unimplemented `UPDATE cart_drawer SET cartStatus = 0 WHERE shop = :shop` (i.e. the widget itself is not actually disabled on uninstall, only the `shops.is_active` flag is set — the storefront-facing `cart_drawer.cartStatus` is left as-is).
**Response shape:** `{"success": true, "message": "Shop $shop marked inactive"}`; errors `{"error": "Shop parameter is required"}` (400) or `{"error": "Failed to process uninstallation: ..."}` (500).
**Validation performed:** `shop` required.
**Error handling:** try/catch, generic `Exception`.
**Business logic:** **Contains a latent bug** (see discrepancy #6 above): before doing anything else, this file redundantly re-opens a **second** PDO connection — `new PDO($dsn, $user, $pass, $options)` — where `$dsn` is defined by the already-`require_once`'d `config.php`, but `$user` and `$pass` are **undefined variables** (never set anywhere in this file or in `config.php`, which only defines `DB_USER`/`DB_PASS` *constants*, not `$user`/`$pass` *variables*). This reconnection attempt is also entirely unnecessary — `config.php` already provides a working `$pdo`. Depending on the MySQL server's auth configuration, connecting with empty username/password could either fail outright (masking the real error behind a generic 500) or silently succeed against a passwordless local root account, overwriting the properly-authenticated `$pdo` from `config.php` with a second, differently-authenticated connection object of the same name.
**Called by:** `app/routes/webhooks.app.uninstalled.jsx` — but again called at `int.thecartninja.com`, not `int.thecomboforge.com` (see discrepancy #2).

---

## `update-subscription-status.php`

**File path:** `php_backend/update-subscription-status.php`
**Endpoint URL:** `https://int.thecomboforge.com/update-subscription-status.php`
**HTTP Method(s):** POST, OPTIONS (OPTIONS → 200). Others → 405.
**Purpose:** Keeps the `shops` table's subscription/plan state in sync with Shopify, called from the Node app when a Shopify `app_subscriptions/update` webhook fires. Per its own docblock: *"Called by Shopify webhook (app_subscriptions/update) via the Node app."*
**Parameters/body fields (JSON body):** `shop_domain` (required), `subscription_id` (Shopify GID), `subscription_status` (required — one of `active|cancelled|declined|expired|frozen|pending`), `plan_name` (default `'Cart Ninja Pro'`), `plan_key` (optional — one of `free|starter|pro`), `trial_ends_on` (ISO date or null), `billing_on` (ISO date or null).
**Authentication/verification:** None in this file.
**Database queries:**
- Safe-migration block: `SHOW COLUMNS FROM shops`, then conditionally `ALTER TABLE shops ADD COLUMN subscription_id VARCHAR(255) DEFAULT NULL`, `subscription_status VARCHAR(50) DEFAULT 'free'`, `trial_ends_on DATE DEFAULT NULL`, `billing_on DATE DEFAULT NULL`, `subscription_updated_at TIMESTAMP DEFAULT NULL` for whichever are missing, plus `plan_helpers.php`'s `plan_ensure_columns($pdo)` for `plan_key`/`pending_plan_key`.
- `INSERT INTO shops (shop_domain, subscription_id, subscription_status, plan_name[, plan_key], trial_ends_on, billing_on, subscription_updated_at, updated_at) VALUES (...) ON DUPLICATE KEY UPDATE subscription_id=..., subscription_status=..., plan_name=...[, plan_key=...], trial_ends_on=..., billing_on=..., subscription_updated_at=NOW(), updated_at=NOW()` — the `plan_key` column/value is included in the query only if the caller explicitly provided a valid `plan_key`.
**Response shape:** `{"success": true, "message": "Subscription status updated for $shop", "data": {"shop", "subscription_status", "plan_name", "trial_ends_on"}}`; errors `{"success": false, "error": "shop_domain and subscription_status are required"}` (400) or exception message (500).
**Validation performed:** `shop_domain` and `subscription_status` required. `plan_key`, if provided, is validated via `plan_is_valid_key()` before being used in the query at all — an invalid `plan_key` is silently ignored (not an error), leaving the existing stored value untouched.
**Error handling:** try/catch, generic `Exception`.
**Business logic:** Maps Shopify's subscription status to a legacy human-readable `plan_name`: `active`/`pending` → the provided `plan_name` (paid plan), anything else (`cancelled`/`declined`/`expired`/`frozen`) → hardcoded `'free'`. The file's comment is explicit that `plan_key` (the canonical value) is **never inferred by parsing `$planName`** here — "Node's `confirmPlanFromWebhook()` already wrote it directly to this same MySQL database, so this PHP sync only needs to mirror it when the caller explicitly provides it," meaning this endpoint is intentionally a secondary/best-effort sync of the legacy `plan_name` display column, not the source of truth for `plan_key`.
**Called by:** `app/routes/webhooks.app_subscriptions_update.jsx` (confirmed via grep: `const PHP_URL = \`${BASE_PHP_URL}/update-subscription-status.php\`;`).

---

## `upsell_settings.php`

**File path:** `php_backend/upsell_settings.php`
**Endpoint URL:** `https://int.thecomboforge.com/upsell_settings.php`
**HTTP Method(s):** GET, POST. Others → 405.
**Purpose:** Standalone REST-style read/write endpoint for `upsell_widget_settings` (cart-drawer upsell widget design + manual rules). **Not called by current Node admin routes** (`app/routes/api.upsell-settings.jsx` uses `getDb()`/raw SQL against the same table instead — see discrepancy #4). Still exercised by `tests/specs/api/upsell-settings.spec.ts`.
**Parameters/body fields:**
- GET: `shop` query param (required).
- POST (JSON body): `shop` (required), `is_enabled` (default `0`), `title`/`upsellTitle.text` (default `'Recommended for you'`), `title_color`/`titleColor` (default `#111827`), `title_font_weight` (default `'700'`), `show_on_empty_cart`/`showOnEmptyCart` (default `0`), `layout`/`activeTemplate` (default `'grid'`), `button_text`/`buttonText` (default `'Add to Cart'`), `button_bg_color`/`buttonColor` (default `#111827`), `button_text_color`/`buttonTextColor` (default `#ffffff`), `button_border_radius`/`buttonBorderRadius` (default `6`), `show_price` (default `1`), `position` (default `'bottom'`), `display_limit`/`limit` (default `3`), `active_template`/`layout` (default `'grid'`), `manualRules` (array → JSON-encoded).
**Authentication/verification:** `X-Forge-Secret` vs `SHOPIFY_API_KEY` (403 if mismatched, skipped if unset).
**Database queries:**
- GET: `SELECT * FROM upsell_widget_settings WHERE shop_domain = ? LIMIT 1`; `manual_rules` JSON-decoded before returning; if the shop's plan can't publish `ai_cart_upsell` (via `resolve_plan_key()` + `plan_can_publish_feature()`), forces `is_enabled = 0` in the response only.
- POST: full-row `INSERT ... ON DUPLICATE KEY UPDATE` across all columns above, keyed on `shop_domain`, then re-`SELECT`s and returns the row.
**Response shape:** `{"status":"success","data": {...row, manual_rules: [...]} | null}`.
**Validation performed:** `shop` required on both verbs. `flag()` helper as elsewhere.
**Error handling:** No try/catch around the writes — relies on PDO exception mode.
**Business logic:** Standard full-row upsert with dual camelCase/snake_case field-name fallbacks, same pattern as `coupon_slider_settings.php`.
**Called by:** Not found in current Node admin routes (see discrepancy #4); exercised by `tests/specs/api/upsell-settings.spec.ts`.

---

## `_inspect_fbt_schema.php`

**File path:** `php_backend/_inspect_fbt_schema.php`
**Endpoint URL:** `https://int.thecomboforge.com/_inspect_fbt_schema.php`
**HTTP Method(s):** Any (no method check) — read-only debug tool.
**Purpose:** Narrow schema-inspection debug tool, scoped to exactly two tables (`fbt_widget`, `posts`) rather than the whole database (contrast with `get_schema.php`/`test_db.php` which cover everything).
**Parameters/body fields:** None.
**Authentication/verification:** None.
**Database queries:** `SHOW COLUMNS FROM \`fbt_widget\`` and `SHOW COLUMNS FROM \`posts\`` (one at a time, in a loop).
**Response shape:** **Not JSON** — plain-text, pipe-delimited lines: `TABLE:fbt_widget`, then one `Field|Type` line per column, then `TABLE:posts`, then its columns. On a query error for a given table: `ERROR|<message>` in place of the column list for that table.
**Validation performed:** None.
**Error handling:** Per-table try/catch (`PDOException`), so one table failing (e.g. `posts` not existing) doesn't block reporting the other.
**Business logic:** One-off ad-hoc debug script, likely written while diagnosing an `fbt_widget` schema question (its inclusion of an unrelated `posts` table — not referenced by any other file in this audit — suggests it was reused/copied from a different investigation rather than purpose-built for FBT alone).
**Called by:** Not referenced in `app/` — manual/ops debug script, leading-underscore filename itself signaling "internal/scratch tool" convention.

---

## `check_schema.php` / `get_schema.php` / `test_db.php` / `_inspect_fbt_schema.php` / `migrate.php` / `combo_forge_init.php` / `create_shops_table.php` — as a group

These seven files are all **manual ops/debug/bootstrap scripts**, not part of any live application request path (none were found referenced anywhere under `app/`). They share: no authentication, mostly no or minimal input validation, and direct unguarded schema introspection or DDL execution. They are safe to leave in place (mostly idempotent or read-only) but should not be treated as part of the "real" API surface when reasoning about what the storefront or admin app actually calls at runtime.

---

# Summary Table

| Endpoint | Method | File | One-line Purpose | Auth Method |
|---|---|---|---|---|
| `/config.php` | (include) | `config.php` | Shared DB connection (PDO) + CORS bootstrap, included by nearly every other file | None |
| `/plan_config.php` | (include) | `plan_config.php` | PHP mirror of plan tiers + feature-gate matrix | None |
| `/plan_helpers.php` | (include) | `plan_helpers.php` | Resolves a shop's plan key from the `shops` table | None |
| `/ai_agent_apply.php` | POST | `ai_agent_apply.php` | Applies AI-agent-decided actions (enable/disable widgets, apply theme) to MySQL, returns fresh state | X-Forge-Secret |
| `/ai_conversations.php` | GET, POST | `ai_conversations.php` | List/create AI chat conversation records | X-Forge-Secret |
| `/ai_messages.php` | GET, POST | `ai_messages.php` | List/append AI chat messages within a conversation | X-Forge-Secret |
| `/analytics.php` | GET | `analytics.php` | Aggregates click/revenue counts by event type | None (also likely broken — uses undefined `$conn`) |
| `/cart_drawer_config.php` | GET, POST | `cart_drawer_config.php` | Standalone CRUD for `cart_drawer_config` (not called by current Node admin routes) | X-Forge-Secret (skipped if unset) |
| `/check_schema.php` | any | `check_schema.php` | Debug: dumps `cart_drawer` column schema as text | None |
| `/click.php` | POST (implicit) | `click.php` | Records a single storefront click/interaction event | None |
| `/combo_forge_init.php` | any | `combo_forge_init.php` | Bootstraps all 13 Combo Forge MySQL tables | None |
| `/combo_pages.php` | POST | `combo_pages.php` | Saves published-page metadata for a Combo Forge template | None |
| `/combo_save.php` | GET, POST, DELETE | `combo_save.php` | Full read/write/delete of a Combo Forge template + all child sections | None |
| `/coupon_slider_settings.php` | GET, POST | `coupon_slider_settings.php` | Coupon slider behavior/position config; GET actively used by admin | X-Forge-Secret (skipped if unset) |
| `/create_shops_table.php` | any | `create_shops_table.php` | Bootstraps the `shops` table | None |
| `/createdcoupon.php` | GET, POST, OPTIONS | `createdcoupon.php` | Generic webhook-request logger (name is misleading — no coupon logic) | None |
| `/customers-data-request.php` | POST | `customers-data-request.php` | Shopify GDPR `customers/data_request` webhook handler | None |
| `/customers-redact.php` | POST | `customers-redact.php` | Shopify GDPR `customers/redact` webhook handler (partial — only `analytics` table) | None |
| `/db_proxy.php` | POST | `db_proxy.php` | Generic parameterized-SQL-over-HTTPS proxy for Node's "direct MySQL" layer | X-Forge-Secret |
| `/fbt.php` | GET, POST, OPTIONS | `fbt.php` | Generic webhook-request logger (name is misleading — no FBT logic) | None |
| `/get_schema.php` | any | `get_schema.php` | Debug: dumps full DB schema (all tables/columns) as JSON | None |
| `/install_shop.php` | POST, OPTIONS | `install_shop.php` | Registers/reactivates a shop on install (actually called at `int.thecartninja.com`) | None |
| `/migrate.php` | any | `migrate.php` | Ad-hoc column-migration script (2 hardcoded migrations) | None |
| `/progress_bar.php` | GET, POST | `progress_bar.php` | Standalone CRUD for progress bar settings + tiers (not called by current Node admin routes) | X-Forge-Secret (skipped if unset) |
| `/save_cart_drawer.php` | GET, POST | `save_cart_drawer.php` | Legacy `cart_drawer` blob table read (storefront) / write (admin), with plan gating | None |
| `/save_coupon.php` | GET, POST | `save_coupon.php` | Saves/lists Shopify discount/coupon metadata as JSON blob | None |
| `/save_coupon_slider_widget.php` | GET, POST | `save_coupon_slider_widget.php` | Saves/reads coupon slider per-template display content | None |
| `/save_fbt_widget.php` | GET, POST | `save_fbt_widget.php` | Saves/reads FBT widget config; dual-writes legacy + normalized tables | None |
| `/session_ping.php` | POST (implicit) | `session_ping.php` | Visitor/session heartbeat for analytics | None |
| `/shop-redact.php` | POST | `shop-redact.php` | Shopify GDPR `shop/redact` webhook handler (incomplete table coverage) | None |
| `/shop_logger.php` | POST, OPTIONS | `shop_logger.php` | Generic append-only file logger for shop lifecycle events | None |
| `/test.php` | GET, POST, OPTIONS | `test.php` | Generic webhook-request logger | None |
| `/test2.php` | GET, POST, OPTIONS | `test2.php` | Generic webhook-request logger | None |
| `/test_db.php` | any | `test_db.php` | Debug: confirms DB connection + lists tables | None |
| `/uninstall_shop.php` | POST, OPTIONS | `uninstall_shop.php` | Marks a shop inactive on uninstall (actually called at `int.thecartninja.com`); has a dead/buggy second DB connection | None |
| `/update-subscription-status.php` | POST, OPTIONS | `update-subscription-status.php` | Syncs Shopify subscription status into `shops` table | None |
| `/upsell_settings.php` | GET, POST | `upsell_settings.php` | Standalone CRUD for upsell widget settings (not called by current Node admin routes) | X-Forge-Secret (skipped if unset) |
| `/_inspect_fbt_schema.php` | any | `_inspect_fbt_schema.php` | Debug: dumps `fbt_widget`/`posts` column schema as text | None |

**Auth pattern summary:** Of the 38 files, only **8** check the `X-Forge-Secret` header (`ai_agent_apply.php`, `ai_conversations.php`, `ai_messages.php`, `cart_drawer_config.php`, `coupon_slider_settings.php`, `db_proxy.php`, `progress_bar.php`, `upsell_settings.php`) — and even those skip the check entirely if `SHOPIFY_API_KEY` is unset server-side (`if ($expected && $secret !== $expected)`), which is fail-open rather than fail-closed. The remaining 30 files, including the most sensitive ones (`save_cart_drawer.php`, `save_coupon.php`, `save_fbt_widget.php`, `save_coupon_slider_widget.php`, all four GDPR webhook handlers, `install_shop.php`, `uninstall_shop.php`, `update-subscription-status.php`), have **no authentication check at all** in this codebase — they rely entirely on network-level protection (obscurity of the URL, and/or a reverse proxy or firewall rule not visible in this repo) or on Shopify webhook HMAC verification happening upstream in the Node layer before these are ever called (not verifiable from the PHP source alone).
