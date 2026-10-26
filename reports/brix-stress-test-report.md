 # BRIX stress test report

**Date:** 2026-10-21 (times in result filenames are UTC) · **Scope:** PHP storefront read path and COD
storage/relay, on an isolated local environment · **Plan:** `reports/brix-stress-test-plan.md` ·
**Raw results:** `reports/results/` · **Scripts:** `tests/performance/`

Every number below was measured. Values that are simulated (fake upstream) or derived (worked out from a
measured value) are labelled. Nothing ran against production, and nothing was deployed.

## 1. Executive summary

- **Storefront reads pass up to 50 virtual users and are unstable at 100** on this machine (4 PHP workers).
  At 100 VUs the same test passed once (p95 395 ms) and failed once (p95 727 ms, criterion 500 ms). There were no errors or
  timeouts at any level; the failure is latency.
- **Main bottleneck (measured): schema checks on every request.** The drawer config GET (`save_cart_drawer.php`, fetched on every
  storefront page view) runs **5 `SHOW COLUMNS` per request**. Each one creates an on-disk temp table in MariaDB and
  costs 8.6–12.5 ms (p50). In a local experiment copy without them, the 100-VU test went from p95 **395 / 727 ms** to **53 / 36 ms**,
  and MariaDB CPU from 48 to 12–14 CPU-seconds. Every other endpoint got faster too, because they share the workers and the database.
- **COD daily order limit can be bypassed (measured, 8 of 8 runs).** With a limit of 1 order per phone, 5 checkouts
  started together placed **5 orders**. `count_recent` only counts orders already `placed`, so attempts still in progress are invisible to it.
- **OTP limits can race (measured).** In 4 of 8 runs a burst for one phone got 2 codes accepted instead of 1, which means 2 SMS.
  In 1 of 8 runs the 5-guess limit compared 6 wrong codes.
- **Slow COD calls block the whole PHP backend (measured with a simulated 800 ms app latency).** `cod_checkout.php`
  holds a PHP worker for as long as Fly/Shopify take. With 4 workers, relay throughput topped out at ~4.7 req/s, and an
  unrelated request went from p50 **5 ms to 1,588 ms** while 16 shoppers used COD.
- Holding up under concurrency (8 of 8 runs): double-tap order idempotency (1 row out of 12 simultaneous taps) and
  single-use OTP codes. A clean 503 came back in ~10 ms when the app was down.
- **Not tested (BLOCKED):** all Node/Fly routes (admin dashboard, analytics, settings saves, AI, COD in Node, combo pages),
  Shopify API throttling and real Fly/Shopify latency. They need a staging app, its own database and a dev store (see §13).

## 2. Project and environment

| Item | Value |
|---|---|
| App | Shopify embedded app, React Router v7 on Fly (`fly.toml`: bom, `cpus = 1`, 1 GB) + PHP backend (`php_backend/`, 39 files, `int.thebrix.io`) + shared hosted MySQL |
| Test machine | Windows 10, Intel Core i3-7020U 2.3 GHz, 4 logical CPUs, 7.9 GB RAM. **The load generator, PHP and MariaDB all share this machine** |
| PHP | 8.2.12 ZTS (XAMPP), built-in server ×4 processes (≈ 4 PHP-FPM / LiteSpeed workers), OPcache on (`opcache_get_status` confirmed per run) |
| Database | MariaDB 10.4.32 (XAMPP binaries), throwaway data folder, default settings, slow query log ≥ 50 ms |
| Load generator | Node 20.19.4, `tests/performance/lib/runner.mjs` (closed model, ramping VUs, think time 1–3 s, 10 s timeout, exact percentiles). k6 is not installed, and the brief asked for no new installs |
| Data (synthetic) | 2000 shops `perf-shop-NNNN.myshopify.com`. Plans 50 % free / 30 % starter / 12 % growth / 8 % pro. 10 % have two 600,000-character banner images (the admin allows 700,000). Each shop has 5 coupons, an FBT widget with 60 rules, 20 upsell rules and 20 days of analytics rollup. COD settings on every 3rd shop, 3 Packs per paid shop |
| External services | none. Fly is a local fake server with a fixed delay. No Shopify, MSG91, India Post, GA4 or Meta |

Real production numbers (Hostinger PHP worker limits, MySQL hardware, network between PHP and MySQL, Fly
latency) are unknown. The results are best used to compare runs and to find bottlenecks. They are not a production capacity figure.

## 3. Modules and endpoints tested

| Module | Endpoint | Kind of test |
|---|---|---|
| Cart drawer (+ upsell rules, banner, plan gating, Shiprocket flag) | `save_cart_drawer.php` GET | real PHP + DB, load |
| Drawer coupons | `save_coupon.php` GET | real PHP + DB, load |
| FBT | `save_fbt_widget.php` GET | real PHP + DB, load |
| COD config | `cod_storefront.php?action=config` | real PHP + DB, load |
| Packs | `packs_storefront.php` GET | real PHP + DB, load |
| COD OTP | `cod_otp.php` create / verify | real PHP + DB, concurrency |
| COD orders | `cod_orders.php` begin / find / count_recent / complete | real PHP + DB, concurrency. C5 replays Node's call sequence (`cod.server.js` `placeCodOrder`, lines 917-1009) with a simulated 1.5 s Shopify step |
| COD relay | `cod_checkout.php` → `/api/cod/quote` | real PHP, **simulated** app (800 ms) |

## 4. Scenarios, dates, durations, concurrency

| Test | UTC start | VUs | Duration | Request mix |
|---|---|---|---|---|
| Diagnostics ×2 | 2026-10-21 before 10:54 (run 1), 10:54 (run 2) | 1 | 40 requests per endpoint | one endpoint at a time |
| Smoke ×2 | 10:50, 11:20 | 2 | 30 s | page-view mix: config 31.5 · config with banners 3.5 · coupons 35 · FBT 15 · COD config 10 · Packs 5 |
| Baseline | 11:03 | 10 | 60 s (10 s ramp) | same |
| Load 25 | 11:05 | 25 | 60 s (15 s ramp) | same |
| Load 50 | 11:07 | 50 | 60 s (15 s ramp) | same |
| Load 100 ×2 | 11:09, 11:14 | 100 | 80 s (20 s ramp) | same |
| Load 100, experiment copy ×2 | 11:12, 11:16 | 100 | 80 s | same, drawer config without per-request schema checks |
| COD concurrency ×8 | 10:56–10:57 (3 runs), 11:25–11:28 (5 runs) | burst 12 / 24 / 5 | ~10–15 s per run | see §6.3 |
| COD relay ×2 | 10:57, 11:00 | 2 → 4 → 8 → 16 | 30 s per step | quote relay, 800 ms simulated app |

Each storefront run starts with a functional preflight: every scenario is requested 3 times and its body checked. All runs passed it.

## 5. Configuration and commands

```bash
node tests/performance/diagnose.mjs
node tests/performance/storefront-read.mjs smoke        # then baseline, load25, load50, load100
PERF_VARIANT=no-schema-checks node tests/performance/storefront-read.mjs load100
node tests/performance/cod-concurrency.mjs
node tests/performance/cod-relay.mjs
```

All runs used the defaults: `PERF_SHOPS=2000`, `PERF_PHP_WORKERS=4`, `PERF_OPCACHE=1`, `PERF_THINK_MS=1000-3000`,
`PERF_P95_MS=500`, `PERF_MAX_FAIL_PCT=1`, `PERF_BURST=12`, `PERF_UPSTREAM_MS=800`.

## 6. Results

### 6.1 Storefront reads, whole mix

| Scenario | VUs | Duration | Total requests | Throughput | p95 | Failure rate | Outcome |
|---|---|---|---|---|---|---|---|
| Smoke (run 1) | 2 | 32.2 s | 25 | 0.8 req/s | 232.5 ms | 0 % | PASS |
| Smoke (run 2, final scripts) | 2 | 30.8 s | 27 | 0.9 req/s | 78.3 ms | 0 % | PASS |
| Baseline | 10 | 62.7 s | 271 | 4.3 req/s | 170.8 ms | 0 % | PASS |
| Load 25 | 25 | 62.5 s | 659 | 10.5 req/s | 153.2 ms | 0 % | PASS |
| Load 50 | 50 | 63.0 s | 1,295 | 20.6 req/s | 178.4 ms | 0 % | PASS |
| Load 100 (run 1) | 100 | 82.9 s | 3,395 | 40.9 req/s | 394.8 ms | 0 % | PASS |
| Load 100 (run 2) | 100 | 81.9 s | 3,290 | 40.2 req/s | **726.8 ms** | 0 % | **FAIL** |
| Load 100, no schema checks (run 1) | 100 | 82.7 s | 3,510 | 42.4 req/s | 53.3 ms | 0 % | PASS (experiment) |
| Load 100, no schema checks (run 2) | 100 | 82.7 s | 3,494 | 42.3 req/s | 36.4 ms | 0 % | PASS (experiment) |
| Stress 150 → 200 | — | — | — | — | — | — | NOT RUN (needs approval) |
| Soak 25 VUs × 30 min | — | — | — | — | — | — | NOT RUN (needs approval) |

No timeouts, no 429s and no invalid bodies in any run. The drawer config never contained banner image data.

Rough traffic equivalent (derived): at 100 VUs about 35 % of requests were drawer config loads, ~14.4 per second.
That is roughly 14 storefront page views per second across all shops, or ~52,000 an hour.

### 6.2 Per endpoint (p50 / p95, ms)

| Endpoint | Baseline 10 | Load 50 | Load 100 run 1 | Load 100 run 2 | 100, experiment run 1 | 100, experiment run 2 |
|---|---|---|---|---|---|---|
| Drawer config | 128.7 / 186.4 | 112.6 / 209.8 | 103.1 / 435.9 | 124.8 / 759.0 | 9.4 / 36.5 | 7.4 / 24.9 |
| Drawer config, 2 banners | 140.3 / 218.2 | 127.6 / 234.3 | 122.9 / 449.0 | 144.7 / 754.6 | 29.7 / 60.8 | 24.7 / 48.7 |
| Coupons | 18.3 / 39.3 | 12.5 / 63.9 | 16.3 / 359.8 | 35.1 / 694.1 | 6.6 / 30.2 | 5.4 / 22.2 |
| FBT | 73.2 / 124.6 | 59.7 / 146.4 | 56.4 / 392.3 | 81.9 / 737.6 | 30.5 / 91.6 | 26.3 / 52.1 |
| COD config | 16.2 / 57.9 | 20.1 / 72.2 | 23.3 / 349.1 | 37.4 / 572.5 | 10.5 / 34.6 | 8.2 / 27.8 |
| Packs | 53.4 / 77.2 | 30.9 / 120.6 | 33.4 / 344.5 | 46.0 / 524.8 | 20.5 / 49.7 | 15.0 / 38.7 |

At 100 VUs the cheap endpoints (coupons p50 16–35 ms) get p95s of 360–700 ms. They are waiting for a free PHP worker
behind slower requests, not doing more work. The experiment changes only the drawer config file, yet every endpoint gets faster.

### 6.3 COD under concurrency (4 PHP workers, requests released at the same moment)

| Check | Rule | Runs passed | Failing observations | Outcome |
|---|---|---|---|---|
| C1 OTP create, same phone, 12 at once | 1 code per phone per 30 s | 4 of 8 | **2 codes accepted and stored** (2 SMS) in runs 1, 5, 6, 7 | **FAIL** (intermittent, 4/8) |
| C2 OTP verify, 24 wrong codes at once | ≤ 5 tries per code | 7 of 8 | **attempts = 6** in run 6 (6 guesses compared) | **FAIL** (intermittent, 1/8) |
| C3 OTP verify, right code 12 at once | verified once | 8 of 8 | — (always 1 "ok", 11 "expired") | PASS |
| C4 Place order, same idempotency key 12 at once | 1 order attempt | 8 of 8 | — (always 1 row, 11 × 409 duplicate) | PASS |
| C5 5 checkouts at once for one phone, daily limit 1 | 1 placed | 0 of 8 | **5 placed** every run | **FAIL** (8/8) |

C5 replays Node's storage calls; Shopify isn't called. In the real app, Node's in-process limiter
(`api.cod.order.jsx:41`, 5 per phone per 10 min per process) would still let up to 5 through. With only 4 PHP workers,
at most 4 requests can be inside the check at once. A server with more workers can let more through C1 and C2.
Runs 2-8 are saved (`reports/results/*-cod-concurrency.json`; runs 5-8 = `T112554`, `T112606`, `T112638`, `T112835`). Run 1's file
was overwritten by run 2, which finished in the same minute (filenames now include seconds), so run 1's C1 failure
is recorded from its console output only.

### 6.4 COD relay (simulated app latency 800 ms, 4 PHP workers)

| VUs | Requests (run 1 / run 2) | Throughput | p50 | p95 | App requests in flight, max | Failure rate |
|---|---|---|---|---|---|---|
| 2 | 24 / 24 | 0.8 req/s | 830 / 828 ms | 858 / 846 ms | 2 | 0 % |
| 4 | 48 / 50 | 1.5–1.6 req/s | 823 / 823 ms | 849 / 843 ms | 3 | 0 % |
| 8 | 99 / 98 | 3.1 req/s | 826 / 825 ms | 1,003 / 1,063 ms | 4 | 0 % |
| 16 | 147 / 149 | 4.6–4.7 req/s | **1,725 / 1,704 ms** | 2,113 / 2,005 ms | **4** | 0 % |

- Ceiling (derived): workers ÷ upstream latency = 4 ÷ 0.8 s = 5 req/s. The measured 4.7 req/s is just under it.
  The app never saw more than 4 requests at once, so the extra ~900 ms p50 at 16 VUs is time spent waiting for a worker.
- Head-of-line blocking (run 2): a PHP-only request with no database took p50 **5 ms** / p95 9 ms when idle
  (38 samples). While 16 VUs used COD it took p50 **1,588 ms** / p95 1,641 ms (12 samples).
- App down (HTML 502 from the app): the relay answered `503 app_unavailable` in 10–12 ms. PASS.

## 7. Response time and error analysis

- **Errors:** 0 failed requests in 15,966 storefront requests and about 640 relay requests (the stepped runs). None of the latency growth came with errors,
  because PHP queues requests rather than rejecting them. In production a queue that long would show up as slow drawers. If the host
  caps waiting requests, it would show up as 503/508 instead (behaviour unknown, not tested).
- **Unloaded cost per request** (diagnostics, 1 worker, 40 requests each; run 1 / run 2):

| Endpoint | p50 ms | p95 ms | Statements | `SHOW COLUMNS` | On-disk temp tables | Bytes from MariaDB | Response |
|---|---|---|---|---|---|---|---|
| Drawer config, no banner | 91.2 / 68.1 | 133.1 / 128.4 | 10.5 | 5 | 5 | 20 KB | 13 KB |
| Drawer config, 2 banners | 96.3 / 112.8 | 147.3 / 154.0 | 10.5 | 5 | 5 | **1,192 KB** | 13 KB |
| Coupons | 9.4 / 10.4 | 24.4 / 30.8 | 2 | 0 | 0 | 1 KB | 2 KB |
| FBT | 45.6 / 40.2 | 69.9 / 73.0 | 6.5 | 2 | 2 | 17 KB | 30 KB |
| COD config (COD on) | 24.6 / 15.2 | 53.2 / 34.1 | 4 | 1 | 1 | 2 KB | 1 KB |
| COD config (no settings) | 9.8 / 8.3 | 24.9 / 29.0 | 2 | 0 | 0 | 0 KB | 0 KB |
| Packs | 20.3 / 22.6 | 42.1 / 45.5 | 4.1 | 1 | 1 | 3 KB | 0 KB |

  One `SHOW COLUMNS FROM cart_drawer_config` on its own took p50 12.5 / 8.6 ms (p95 32.4 / 21.2 ms). The drawer
  `SELECT` itself took p50 1.2–1.8 ms without banners and 10.9–15.4 ms with two banners. Run-to-run spread on this laptop is
  about ±25 ms at p50, so treat single values as approximate.
- **OPcache** (A/B on the same database, interleaved): drawer config p50 59.6 ms on vs 66.8 ms off. That is not a meaningful
  lever here; the time is in the database.

## 8. Resource utilization (process CPU seconds used during the run, peak working set)

| Run | PHP CPU s | MariaDB CPU s | `SHOW COLUMNS` run | Statements / request | Max DB connections | Slow queries ≥ 50 ms | Peak memory PHP / MariaDB |
|---|---|---|---|---|---|---|---|
| Baseline 10 | 1.2 | 6.8 | 569 | 5.7 | 4 | 0 | 104 / 256 MB |
| Load 25 | 2.7 | 13.6 | 1,325 | 5.6 | 5 | 5 | 104 / 256 MB |
| Load 50 | 5.6 | 24.6 | 2,725 | 5.7 | 7 | 6 | 104 / 256 MB |
| Load 100 run 1 | 9.9 | 48.3 | 7,231 | 5.8 | 8 | 22 | 104 / 256 MB |
| Load 100 run 2 | 9.9 | 48.3 | 7,001 | 5.8 | 8 | 38 | 104 / 256 MB |
| Load 100 experiment run 1 | 8.9 | 14.4 | 1,300 | 4.0 | 7 | 7 | 104 / 256 MB |
| Load 100 experiment run 2 | 6.4 | 11.8 | 1,260 | 4.1 | 6 | 0 | 104 / 256 MB |

- MariaDB used about 5× the CPU of PHP. At 100 VUs that is 48 CPU-seconds in 83 s, about 0.6 of a core. Every
  `SHOW COLUMNS` also created an on-disk temp table (`Created_tmp_disk_tables` equals the `SHOW COLUMNS` count in every run).
- Memory was flat. There's no sign of a leak in runs this short (the soak test was not run).
- Connections stayed low (≤ 8; PHP opens one per request and closes it).
- The slow-query counts come from MariaDB's own counter for the run window. The slow-log statement lists saved
  in the JSON for these runs also contain the seeding INSERTs from before the load. The script now reads only the run window.
- Not measured: CPU of the whole machine (the load generator shares it), disk I/O, and anything on Hostinger or Fly.

## 9. Failed tests and how to reproduce them

| Failure | Reproduce | Evidence |
|---|---|---|
| Load 100 run 2: p95 726.8 ms > 500 ms | `node tests/performance/storefront-read.mjs load100` (passed once, failed once) | `reports/results/2026-10-21T1114-storefront-load100.json` |
| C5 daily COD limit: 5 placed, limit 1 | `node tests/performance/cod-concurrency.mjs` (8 of 8 runs) | every `reports/results/*-cod-concurrency.json` |
| C1 OTP resend: 2 codes accepted in one burst | same script (4 of 8 runs; run it a few times) | `reports/results/2026-10-21T112554-cod-concurrency.json`, `T112606`, `T112638` |
| C2 OTP guess limit: 6 wrong codes compared | same script (1 of 8 runs) | `reports/results/2026-10-21T112606-cod-concurrency.json` |

## 10. Bottlenecks and severity

| # | Finding | Evidence | Severity |
|---|---|---|---|
| B1 | Per-request schema checks. `save_cart_drawer.php` GET calls `ensureWatermarkColumn`, `ensureAnnouncementStyleColumns`, `ensureCountdownColumns`, `ensureBannerColumns` (`save_cart_drawer.php:281-284`) and `plan_ensure_columns` (`plan_helpers.php:11`). Their `static $ensured` lasts only one PHP request, so it's 5 `SHOW COLUMNS` on every page view. FBT has 2 (`save_fbt_widget.php:63` + plan); COD and Packs have 1 (plan). Every `cod_*.php` storage call also runs 4 `CREATE TABLE IF NOT EXISTS` + 2 `SHOW COLUMNS` (`cod_helpers.php:67-129`) | §6.2, §7, §8: 5 × 8.6–12.5 ms ≈ 60–70 % of the config GET's unloaded time (derived); MariaDB CPU 48 → 12–14 s and 100-VU p95 395/727 → 53/36 ms without them | **High** |
| B2 | COD daily limit is check-then-act on `placed` rows only (`cod_orders.php:76`, `cod.server.js:930-939`), so concurrent checkouts for one phone all pass | C5, 8/8 runs | **High** (abuse: fake COD orders, RTO cost) |
| B3 | Synchronous COD relay holds a PHP worker for the whole Fly + Shopify call (`cod_checkout.php:60-79`, timeout 45 s). The workers are shared with every storefront endpoint | §6.4: throughput capped at workers ÷ latency; an unrelated request went 5 → 1,588 ms | **High** on shops with COD traffic. Production worker count and real latency unknown |
| B4 | OTP limits are read-then-write with no lock: resend = a count then an insert (`cod_otp.php:35-47`); guesses = read `attempts` then increment (`cod_otp.php:64-79`) | C1, 4/8 runs: 2 SMS for one phone. C2, 1/8 runs: 6 guesses on a 5-guess code | **Medium** (SMS cost; a little extra brute-force room on a 6-digit code; Node's per-IP limits of 10 sends/hour and 30 verifies/10 min help only for one IP) |
| B5 | Banner images read on every config GET. Both data-URL columns (up to 700,000 characters each) are selected, MD5'd and dropped (`save_cart_drawer.php:294`, `bannerImageSrc`) | §7: 1,192 KB from MariaDB per request vs 20 KB; SELECT 1–2 → 11–15 ms locally | **Medium**. The effect over production's PHP↔MySQL network is not measured |
| B6 | Join collation. The config join compares `cdc.shop_domain = cd.shop COLLATE utf8mb4_unicode_ci`. If production's `cart_drawer_config` is `utf8mb4_general_ci`, the unique index can't be used for a lookup | EXPLAIN on 2000 rows: unicode_ci → `const`, 1 row; general_ci → `index`, 2000 rows (full index scan per page view) | **Unknown until checked**; High if general_ci |
| B7 | Drawer config and coupons are fetched on every page view with no HTTP caching (`cart_drawer_inline.js:481-484`; no `Cache-Control` in `save_cart_drawer.php` / `save_coupon.php`; `cod_storefront.php` already sends `max-age=30`) | code reading (not load-tested) | Medium (multiplies B1/B5) |

Other observations from reading the code (not measured):
- The 500 responses in `save_cart_drawer.php`, `save_fbt_widget.php` and `save_coupon.php` return the PDO exception text to the browser (`"Fetch failed: " . $e->getMessage()`).
- Node's rate limits (`cod.server.js:230`) live in process memory: they reset on every restart and are per machine.
- Running the Node app locally starts the billing cron jobs (`scheduler.server.js`). That makes safe local testing of Node impossible today.

## 11. Recommended fixes, by impact

1. **B1: run schema checks once, not per request.** Remove the `ensure*` calls from the GET handlers and run them in the POST/save path or a
   one-off migration (`migrations/` already exists). Or remember "schema ok" across requests with APCu, a small `schema_version`
   row, or a flag file. Same for `cod_ensure_tables` and `plan_ensure_columns`. Expected effect, measured on the local copy:
   ~10× lower p95 at 100 VUs and ~4× less MariaDB CPU. Retest with `storefront-read.mjs load100` after the change.
2. **B2: make the daily COD limit atomic.** Count recent `creating` rows too (e.g. created in the last 15 min) in `count_recent`, or check and
   insert in one step inside `begin` (`GET_LOCK('cod:'+shop+phone)`, or a transaction that locks the phone's rows). Retest: `cod-concurrency.mjs` C5.
3. **B3: stop COD relays from starving storefront reads.** Options: send `/api/cod/*` from the browser straight to Fly (CORS + the
   existing per-IP limits), serve `cod_checkout.php` from a separate PHP pool, or at least confirm and raise the host's PHP worker limit.
   Also watch Fly's own capacity (1 CPU, one machine) once COD orders grow. Retest: `cod-relay.mjs` with the real worker count and `PERF_UPSTREAM_MS` set to Fly's measured p95.
4. **B6: check the collation (read-only, 1 query)** on the production database: `SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_NAME IN ('cart_drawer','cart_drawer_config');` plus
   `SHOW INDEX FROM cart_drawer_config`. If it's general_ci, align the collations (needs a planned migration, not an ad-hoc ALTER).
5. **B5: stop reading the images in the GET.** Store a short hash/version column when the banner is saved and select that instead of the two image columns.
6. **B4: lock per phone in `cod_otp.php`** (`GET_LOCK` on shop+phone, or a transaction with `SELECT … FOR UPDATE` on the latest row)
   for create. For verify, make the increment the check: `UPDATE cod_otp SET attempts = attempts + 1 WHERE id = ? AND attempts < 5`,
   and compare only when one row changed. Retest: `cod-concurrency.mjs` C1/C2, several runs.
7. **B7: allow short caching** of the drawer config/coupons (`Cache-Control: public, max-age=30` like `cod_storefront.php`, or an ETag),
   after checking that the editor's "Save" still shows up on the storefront fast enough.

None of these fixes were applied to the repo. The only code written is test code under `tests/performance/`.

## 12. Retest results and remaining risks

- **Retest of B1 (experiment only):** a copy of `save_cart_drawer.php` without its 5 schema checks, written only into the temp
  folder (`lib/env.mjs` `writeNoSchemaVariant`). Two 100-VU runs: p95 53.3 and 36.4 ms (PASS), against 394.8 and 726.8 ms for the
  unmodified file. This shows the potential gain. It is not a tested fix: the real change has to keep the columns being added on new installs.
- B2–B7 were not retested; there are no fixes yet.
- Remaining risks: production PHP worker limits and MySQL hardware are unknown. The PHP↔MySQL network cost of B5 is unknown.
  Real Fly and Shopify latency, and Shopify API throttling during COD bursts, are unknown. Nothing above 100 VUs was tested, and no soak test was run.

## 13. Limitations and untested components

| Component | Status | Why | Next step |
|---|---|---|---|
| Admin dashboard, analytics, settings saves, BrixBar AI (Node) | BLOCKED | local Node uses the shared hosted DB (`.env`) and starts billing cron jobs; needs Shopify admin sessions | staging Fly app + own DB + dev store + a flag that turns off `scheduler.server.js` |
| COD OTP / quote / order in Node, Shopify draft orders, MSG91 | BLOCKED | would call Shopify/MSG91 | dev store, `COD_OTP_DEV_LOG=1`, no MSG91 key, approval for test orders |
| Shopify API throttling, real Fly latency | BLOCKED | needs a dev store / staging | as above, measure Fly p95 for `/api/cod/quote` first |
| Build a Combo pages and box codes (Node) | BLOCKED | Node + Shopify Admin API | staging |
| Cart add / quantity / totals | BLOCKED (out of scope) | served by Shopify, not BRIX; correctness is covered by the existing browser checks | — |
| PHP settings saves (POST) | NOT RUN | merchant-rate traffic, lower priority | can run on the isolated environment if wanted |
| Stress 150–200 VUs, 30-min soak | NOT RUN | need explicit approval | `PERF_ALLOW_STRESS=1` / `PERF_ALLOW_SOAK=1` |
| PIN code lookup (`cod_storefront.php?action=pincode`) | NOT RUN | calls the public India Post API | mock it before load-testing |

Method limitations: one laptop runs everything. `php -S` stands in for the production PHP server. The DDL comes from the repo
(`live cart ninja.sql`, `migrations/`, the `CREATE TABLE` statements in code), not from production. The banner data is filler of the right size. Runs are short (≤ 83 s).

## 14. Final assessment

| Area | Criterion | Result |
|---|---|---|
| Storefront reads ≤ 50 VUs | p95 ≤ 500 ms, ≤ 1 % failed, 0 timeouts | **PASS** (smoke ×2, baseline, 25, 50) |
| Storefront reads at 100 VUs | same | **FAIL**: unstable, 1 pass (395 ms) and 1 fail (727 ms) |
| COD duplicate-action and limits | each documented rule holds under bursts | **FAIL**: daily limit (8/8 runs), OTP resend (4/8), OTP guess limit (1/8). Order idempotency and single-use codes PASS (8/8) |
| COD relay | none set in advance | reported: capped at workers ÷ latency, and it blocks other requests |
| Node routes, Shopify, real COD, combo pages | — | **BLOCKED** |

On this machine the PHP storefront path is comfortable up to 50 concurrent shoppers. It reaches its limit around 100, mostly
because of per-request schema checks rather than real work. Fixing B1 is the single biggest gain. B2 and B3 are the correctness and
availability risks to fix before COD traffic grows. These are local, isolated results, not a production capacity guarantee.
