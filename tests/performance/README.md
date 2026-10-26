# BRIX performance tests

Load and concurrency tests for the PHP storefront and COD layer. Every script
starts its own **isolated environment**, like `tests/cod/php-harness.mjs` does:

- a throwaway MariaDB from XAMPP's binaries (a new data folder in `%TEMP%`, port 3460, slow query log at 50 ms)
- 4 `php -S` workers serving copies of the real `php_backend/*.php` files, with OPcache on
- a fake BRIX app server in place of Fly

These tests never touch the shared hosted MySQL, `int.thebrix.io`, Fly, Shopify, MSG91, GA4 or Meta.
They send no SMS and create no orders. All shops are synthetic: `perf-shop-NNNN.myshopify.com`.

Requirements: XAMPP at `C:/xampp` (or set `XAMPP_DIR`) and Node 20+. The tests need nothing beyond the repo's
existing dependencies (`mysql2`).

## Commands

```bash
# 1. Single-user diagnostics: per-endpoint latency and DB work, join plan, OPcache A/B (~2 min)
node tests/performance/diagnose.mjs

# 2. Storefront read load (page-view mix). Start with smoke and check it before going higher.
node tests/performance/storefront-read.mjs smoke      # 2 VUs, 30 s
node tests/performance/storefront-read.mjs baseline   # 10 VUs, 60 s
node tests/performance/storefront-read.mjs load25     # 25 VUs, 60 s
node tests/performance/storefront-read.mjs load50     # 50 VUs, 60 s
node tests/performance/storefront-read.mjs load100    # 100 VUs, 80 s
PERF_ALLOW_STRESS=1 node tests/performance/storefront-read.mjs stress   # 150→200 VUs, needs approval
PERF_ALLOW_SOAK=1   node tests/performance/storefront-read.mjs soak     # 25 VUs, 30 min, needs approval

# Same load against the experiment copy of the drawer config GET without per-request
# SHOW COLUMNS (written only into the temp folder, never into php_backend/)
PERF_VARIANT=no-schema-checks node tests/performance/storefront-read.mjs load100

# 3. COD duplicate-action / limit checks under concurrency (~40 s)
node tests/performance/cod-concurrency.mjs

# 4. COD relay (cod_checkout.php → app) with a simulated 800 ms app/Shopify latency (~3 min)
node tests/performance/cod-relay.mjs
```

PowerShell: set variables with `$env:PERF_VARIANT='no-schema-checks'` and so on. Remove them afterwards
with `Remove-Item Env:PERF_VARIANT`.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PERF_SHOPS` | 2000 | synthetic shops seeded |
| `PERF_PHP_WORKERS` | 4 | PHP worker processes (≈ PHP-FPM / LiteSpeed workers) |
| `PERF_OPCACHE` | 1 | `0` = PHP without OPcache |
| `PERF_THINK_MS` | `1000-3000` | pause between one VU's requests |
| `PERF_P95_MS` / `PERF_MAX_FAIL_PCT` | 500 / 1 | acceptance criteria for the storefront reads |
| `PERF_BURST` | 12 | simultaneous requests per COD concurrency check |
| `PERF_UPSTREAM_MS` / `PERF_RELAY_STEPS` | 800 / `2,4,8,16` | COD relay: simulated app latency / VUs per step |
| `PERF_TARGET_URLS` + `PERF_TARGET_SHOPS` | — | point `storefront-read.mjs` at an already running **staging** PHP backend and its test shops instead of the local environment. Never point it at production without approval. |
| `PERF_BASE_PORT` | 3460 | first port used (DB; PHP workers at +101…, fake app at +100) |

## Results

Each run writes a JSON summary to `reports/results/<UTC date>T<time>-<test>.json`. A summary holds the
overall and per-endpoint request count, req/s, p50/p90/p95/p99/max, failures by reason, timeouts and 429s.
It also holds the CPU seconds and peak memory of the PHP and MariaDB processes, MariaDB counters
(statements, `SHOW COLUMNS`, on-disk temp tables, slow queries, connections) and the PASS/FAIL verdict.
The write-up is `reports/brix-stress-test-report.md`, and the plan is `reports/brix-stress-test-plan.md`.

The load generator runs on the same machine as PHP and MariaDB. Compare runs on the same machine with
each other. Absolute numbers are not production capacity.

## Files

- `lib/runner.mjs`: closed-model load runner (ramping VUs, think time, exact percentiles, `burst()` for races)
- `lib/env.mjs`: isolated environment, process/DB metrics, slow log, the `no-schema-checks` experiment copy
- `lib/seed.mjs`: synthetic schema and data (tables follow the repo's DDL)
- `storefront-read.mjs`, `diagnose.mjs`, `cod-concurrency.mjs`, `cod-relay.mjs`: the tests
