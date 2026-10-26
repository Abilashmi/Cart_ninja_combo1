# BRIX stress test plan

Prepared 2026-10-21. Scripts: `tests/performance/` (see its README). Results: `reports/brix-stress-test-report.md`.

## 1. What exists (checked in the code)

| Part | Where | How the storefront / admin reaches it |
|---|---|---|
| Admin app (React Router v7, Polaris) | `app/routes/app.*`, `api.*` on Fly (`fly.toml`: region bom, `cpus = 1`, 1 GB, `min_machines_running = 0`) | Shopify admin iframe, `authenticate.admin` |
| PHP backend (39 files) | `php_backend/` on `int.thebrix.io` | storefront via the Shopify App Proxy and direct `fetch`; Node via `X-Forge-Secret` |
| MySQL | shared hosted MySQL. Node reaches it through `php_backend/db_proxy.php`; the local `.env` points at the same hosted database | PHP `PDO`, Node `db.server.js` |
| SQLite (Prisma) | Shopify sessions, combo templates | Node only |
| Cart drawer | `extensions/cart-drawer/assets/cart_drawer_inline.js` → `save_cart_drawer.php` GET + `save_coupon.php` GET, **on every page view, uncached** (`cart_drawer_inline.js:481-484`, no `Cache-Control` in either PHP file) | storefront |
| Upsell | inside the drawer config response (`mergeUpsellWidgetSettings`) + Shopify's `/recommendations` | storefront |
| FBT | `save_fbt_widget.php` GET (product pages) | storefront |
| COD + OTP | `cod_storefront.php` (config, PIN lookup → India Post API) and `cod_checkout.php` (relay → Fly `/api/cod/{otp,quote,order}` → Shopify draft orders, MSG91). Storage in `cod_otp.php` / `cod_orders.php` | storefront → PHP → Node → Shopify |
| Packs | `packs_storefront.php` GET | storefront |
| Build a Combo (Combo Forge) | `combo-page[.]js.jsx`, `api.combo-loader`, `api.combo-box-code` on Node → Shopify Admin API | storefront → Node |
| Admin dashboard, analytics, settings saves, BrixBar AI | `app.*`, `api.analytics.*`, `api.*-settings`, `api.ai.chat` on Node | admin |
| Cart operations (add, quantity change, totals) | Shopify's own `/cart/*.js`, priced by Shopify and BRIX discount Functions | storefront → Shopify |

Existing tests: `node:test` unit tests, PHP-harness tests on a throwaway MariaDB (`tests/cod/php-harness.mjs`),
Playwright browser checks with mocked networks, and Playwright specs. The `storefront` project in
`playwright.config.ts` runs against the **live** storefront. Before this work the repo had **no**
performance tests, k6 scripts, CI pipeline (`.github` absent) or monitoring dashboards.

## 2. Safety rules for every test

- Nothing runs against production: not the hosted MySQL, `int.thebrix.io`, the Fly app or a live store. Nothing is deployed.
- The local Node app is **not** started for load. It would use the shared hosted database (`.env`), and importing
  `shopify.server.js` starts the cron jobs in `scheduler.server.js`, including the daily Shopify overage billing job.
- Every test builds its own isolated environment (`tests/performance/lib/env.mjs`): a throwaway MariaDB, copies of
  `php_backend/*.php`, and a fake app server instead of Fly. That means no SMS, no Shopify calls and no orders.
- Data is synthetic: `perf-shop-NNNN.myshopify.com`, hashes in place of phone numbers and codes.
- Stages run one at a time, and each result is reviewed before going higher. Stress (more than 100 VUs) and soak need
  explicit approval (`PERF_ALLOW_STRESS=1` / `PERF_ALLOW_SOAK=1`).
- No new dependencies. k6 is not installed on this machine, so the load runner is Node (`lib/runner.mjs`, a closed
  model with ramping VUs like k6's `ramping-vus`). For a staging run from another machine, k6 or this runner with
  `PERF_TARGET_URLS` both work.

## 3. Acceptance criteria (set before running)

| Area | Criterion |
|---|---|
| Storefront reads (drawer config, coupons, FBT, COD config, Packs) | p95 ≤ **500 ms**, failed ≤ **1 %**, **0** timeouts (10 s), every body valid, the drawer config never carries banner image data |
| COD concurrency | each rule the code documents holds when the requests arrive together (details per check below) |
| COD relay | no pass/fail threshold set in advance (simulated upstream). Reported for capacity: throughput, queueing, effect on other requests |

These criteria are targets for **this local environment**, not statements about production capacity.

## 4. Test matrix

| # | Module / flow | Endpoint | Test data | Concurrency, duration | Expected outcome | Safety | Status |
|---|---|---|---|---|---|---|---|
| D | All storefront reads | 5 PHP GETs | 2000 shops | 1 user, 40 requests each | explain cost per request (statements, `SHOW COLUMNS`, bytes) | isolated | run |
| S1 | Drawer + upsell + coupons + FBT + COD config + Packs | page-view mix (35 / 35 / 15 / 10 / 5) | 2000 shops, 10 % with two 600 000-char banners | **smoke** 2 VUs, 30 s | criteria in §3 | isolated | run |
| S2 | same | same | same | **baseline** 10 VUs, 60 s | criteria in §3 | isolated | run |
| S3 | same | same | same | **load** 25 / 50 / 100 VUs, 60–80 s each | criteria in §3 | isolated | run |
| S4 | same | same | same | **stress** 150 → 200 VUs, 2 min | find the breaking point | isolated, approval | NOT RUN |
| S5 | same | same | same | **soak** 25 VUs, 30 min | no drift in p95 / memory | isolated, approval | NOT RUN |
| C1 | COD OTP send | `cod_otp.php` create | one phone | burst of 12 | 1 accepted (1 code per 30 s) | hashes only, no SMS | run |
| C2 | COD OTP verify, wrong codes | `cod_otp.php` verify | one code | burst of 24 | ≤ 5 guesses compared | hashes only | run |
| C3 | COD OTP verify, right code | `cod_otp.php` verify | one code | burst of 12 | verified once | hashes only | run |
| C4 | Double tap on Place order | `cod_orders.php` begin | one idempotency key | burst of 12 | 1 row, the rest 409 | no Shopify | run |
| C5 | Daily COD limit per phone | `placeCodOrder`'s storage sequence | one phone, limit 1, 5 sheets | 5 at once, 1.5 s simulated Shopify | 1 placed | no Shopify | run |
| R1 | COD relay capacity | `cod_checkout.php` → fake app (800 ms) | quote requests | 2 / 4 / 8 / 16 VUs, 30 s each | report only | fake app | run |
| R2 | Relay blocking other requests | PHP-only probe during R1 at 16 VUs | — | 20 s | report only | fake app | run |
| R3 | App (Fly) down | `cod_checkout.php` → HTML 502 | — | 1 request | clean 503 quickly | fake app | run |
| N1 | Admin dashboard, analytics, settings save, AI chat | Node `app.*`, `api.*` | dev store | 5–25 VUs | — | needs staging | BLOCKED |
| N2 | COD OTP / quote / order in Node, Shopify throttling | `api.cod.*` → Shopify | dev store, test SMS route | 1–10 VUs | — | needs staging + approval | BLOCKED |
| N3 | Combo pages, box codes | `combo-page.js`, `api.combo-box-code` | dev store | 5–25 VUs | — | needs staging | BLOCKED |
| N4 | Cart add / update / totals | Shopify `/cart/*.js` | — | — | — | Shopify's servers, not ours to load | BLOCKED (out of scope) |
| P1 | Settings saves (PHP POST) | `save_cart_drawer.php` POST etc. | — | — | — | could run isolated | NOT RUN (merchant-rate traffic, low priority) |

## 5. Next steps to unblock N1–N3

1. A staging Fly app with its own MySQL (not the shared one) and a Shopify development store with synthetic products.
2. An environment flag that stops `scheduler.server.js` from starting its cron jobs (no overage billing in tests).
3. COD with `COD_OTP_DEV_LOG=1` and no MSG91 key, so no SMS is sent. Orders only on the dev store.
4. Run `storefront-read.mjs` with `PERF_TARGET_URLS` against the staging PHP backend, and k6 or this runner
   against the staging Node routes, while Fly metrics and the database's slow log are watched.
