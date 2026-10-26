# BRIX test report

**Date:** 2026-10-22 · **Scope:** every automated test in `tests/` that can run without touching production ·
**Code tested:** `main` at `8c34194` plus uncommitted edits to the Coupon Banner files · **Raw results:**
`reports/results/2026-10-22-*`

No app bugs were found. 601 of 604 unit and PHP tests and 1,273 of 1,283 browser checks pass, and every failure
traces to a test that is out of date or a setup step skipped on purpose. Nothing touched production: no deploy, no
live database, no live store, and the code was left exactly as it was.

What was tested may differ from what is live, because deploys are done by hand.

## 1. Results at a glance

Every feature area passes except Packs admin, whose test predates the Packs redesign. Two suites could not run at
all (see §4).

| Suite | Files | Checks run | Passed | Failed | Verdict |
| --- | --- | --- | --- | --- | --- |
| Unit + PHP harness (all areas) | 56 | 604 | 601 | 3 | Pass: 3 out-of-date COD assertions |
| Cart drawer (browser) | 5 | 290 | 290 | 0 | Pass |
| BRIX COD (browser) | 6 | 336 | 336 | 0 | Pass |
| Combo Forge boxes (browser) | 6 | 402 | 402 | 0 | Pass |
| Combo AI suggestions (browser) | 2 | 32 | 32 | 0 | Pass |
| Coupon Banner + offer ladder (browser) | 5 | 55 | 55 | 0 | Pass |
| FBT widget (browser) | 1 | 75 | 75 | 0 | Pass |
| Pairing Assistant (browser) | 1 | 16 | 16 | 0 | Pass |
| Plans and billing page (browser) | 1 | 20 | 20 | 0 | Pass |
| Packs: PHP endpoint + preview (browser) | 2 | 43 | 43 | 0 | Pass |
| Packs: admin (browser) | 1 | 14 | 4 | 10 | Test out of date |
| Packs: storefront widget (browser) | 1 | 0 | – | – | Not run: needs a local app server |
| BrixBar AI handoff (browser) | 1 | 0 | – | – | Not run: test harness doesn't build |
| TypeScript typecheck | – | – | – | 0 errors | Pass |
| ESLint | 136 files | – | – | 6,085 errors | Mostly style, see §3 |

### Browser checks by file

| File | Passed | Time |
| --- | --- | --- |
| `billing/plans-browser-check.mjs` | 20/20 | 19 s |
| `cart-drawer/customization-browser-check.mjs` | 81/81  
 | 58 s |
| `cart-drawer/drawer-ui-browser-check.mjs` | 134/134 | 91 s |
| `cart-drawer/editor-preview-browser-check.mjs` | 46/46 | 26 s |
| `cart-drawer/money-browser-check.mjs` | 3/3 | 6 s |
| `cart-drawer/upsell-stock-browser-check.mjs` | 26/26 | 21 s |
| `cod/admin-page-browser-check.mjs` | 6/6 | 7 s |
| `cod/cart-discounts-browser-check.mjs` | 6/6 | 4 s |
| `cod/customize-page-browser-check.mjs` | 94/94 | 38 s |
| `cod/payment-options-browser-check.mjs` | 83/83 | 62 s |
| `cod/sheet-browser-check.mjs` | 75/75 | 24 s |
| `cod/theme-drawer-browser-check.mjs` | 72/72 | 48 s |
| `combo-ai/builder-browser-check.mjs` | 16/16 | 27 s |
| `combo-ai/storefront-browser-check.mjs` | 16/16 | 6 s |
| `combo-weight/builder-browser-check.mjs` | 39/39 | 30 s |
| `combo-weight/collection-bar-browser-check.mjs` | 19/19 | 6 s |
| `combo-weight/quickshop-browser-check.mjs` | 177/177 | 48 s |
| `combo-weight/quickshop-builder-check.mjs` | 92/92 | 41 s |
| `combo-weight/stock-browser-check.mjs` | 21/21 | 6 s |
| `combo-weight/storefront-browser-check.mjs` | 54/54 | 14 s |
| `coupon-banner/admin-browser-check.mjs` | 20/20 | 45 s |
| `coupon-banner/offer-ladder-admin-check.mjs` | 5/5 | 20 s |
| `coupon-banner/offer-ladder-browser-check.mjs` | 13/13 | 18 s |
| `coupon-banner/storefront-browser-check.mjs` | 7/7 | 5 s |
| `coupon-banner/timer-and-fbt-browser-check.mjs` | 10/10 | 4 s |
| `fbt-offer/widget-browser-check.mjs` | 75/75 | 18 s |
| `packs/admin-browser-check.mjs` | **4/14** | 354 s |
| `packs/php-endpoint-browser-check.mjs` | 38/38 | 41 s |
| `packs/preview-browser-check.mjs` | 5/5 | 10 s |
| `packs/widget-browser-check.mjs` | not run (0/15) | 4 s |
| `pairing/assistant-browser-check.mjs` | 16/16 | 36 s |
| `ai-handoff/browser-check.mjs` | not run (build failed) | 11 s |

## 2. Failures

All four failures are in the tests, not the app: the code moved on and the tests did not follow. Each still leaves a
gap, because that feature now has weaker automated cover.

| Failing check | What happened | Cause | App bug? |
| --- | --- | --- | --- |
| `tests/cod/cod-server.test.mjs` – "secrets: saved separately…" | Got two extra keys, `msg91AuthKey` and `msg91TemplateId` | The store's own MSG91 keys were added to `cod_secrets`; the test's expected list wasn't updated | No |
| `tests/cod/cod-server.test.mjs` – "storefront config: returns display settings only…" | Got an extra `termsUrl: ''` in the popup settings | The Terms and conditions link was added to the sheet settings | No |
| `tests/cod/cod-server.test.mjs` – "storefront config: each place gets its own button look…" | Got extra `paddingX: 16`, `paddingY: 14` on the button look | The COD button size setting (`COD_BUTTON_PADDING`) was added | No |
| `tests/packs/admin-browser-check.mjs` (10 of 14 cases) | The builder's "Variant" field, the list's "Enable Pack for …" buttons and old messages never appear | The Packs admin was redesigned in 4 commits (`packs_designnew_v4` to `packs_temp3`) after the test was last updated; e.g. the message is now "Choose a Shopify product first." | Probably not, but unconfirmed: the redesigned Packs admin has no working automated test |

One more failure showed up only when every test file ran at once: `banner-php.test.mjs` and `cod-server.test.mjs`
both start their throwaway database on the same ports and collide. Each passes when run alone (banner-php 8 of 8),
so this is a test setup issue.

## 3. Code health

Typecheck is clean (0 errors). Lint reports 6,085 errors, but 4,754 of them are `react/prop-types` and most of the
rest are style rules (unused variables, empty blocks) or generated test bundles under `tests/**/dist`. Three findings
are worth a look:

| Finding | Where | Risk | Live impact today |
| --- | --- | --- | --- |
| Legacy cart editor still shipped as a route | `app/routes/app.cartdrawer.old.jsx` (5,576 lines) is served at `/app/cartdrawer/old`; it uses undefined variables (`currentUpsellRule`, `upsellPickerMode`) and has unreachable code | Medium: a merchant who opens that URL gets an old editor that crashes on product picking | Only reachable by typing the URL; nothing in the app links to it |
| Duplicate keys with different values in the combo builder defaults | `DEFAULT_COMBO_CONFIG` in `app/routes/app.bundles.customize.jsx`: `products_gap` (16 vs 12), `title_container_margin_bottom` (12 vs 0), `description_container_margin_bottom` (20 vs 0), plus 14 duplicates with the same value | Low: the later value always wins, so behaviour is consistent; the earlier lines mislead whoever edits them | None: the later values (12, 0, 0) are what merchants already get |
| Broken stray file | `app/services/coupons.server.js` holds two bare lines (`getCoupons(shopId)`, `upsertCoupons(...)`) that would throw if imported | Low: nothing imports it | None |

The other `no-undef` hits are `process` in server files, which is an ESLint environment setting, not a bug.

Top lint rules by error count: `react/prop-types` 4,754 · `no-unused-vars` 424 · `no-empty` 188 ·
`no-prototype-builtins` 172 · `no-undef` 111 · `no-cond-assign` 97 · `no-dupe-keys` 51.

## 4. Not tested

Everything here was left out on purpose, either to keep off production or because it needs a real store. None of it
was checked in this run.

| Area | Why it was skipped | What it would take |
| --- | --- | --- |
| Playwright API specs (`tests/specs/api/`, 46 tests) | They POST to the PHP backend, which shares the live MySQL; running them writes to production data | A staging PHP backend with its own database |
| Playwright storefront specs (`tests/specs/storefront/`, 9 tests) | They add to cart on a real Shopify store and test what is deployed, not this code | Run on a dev store after a deploy |
| Packs storefront widget (15 cases) | Needs the built app running on `localhost:3999`, and the app reads `.env`, which points at the live database | A local build with a test-only `.env` |
| BrixBar AI handoff (browser) | Its stub (`tests/ai-handoff/harness/server-stub.js`) lacks `syncComboWeightIfNeeded`, which `app.bundles._index.jsx` now imports, so the Vite build fails | Add the missing export to the stub |
| Real checkout with the five discount Functions (rewards, FBT offer, prepaid, combo box, Packs) | Only their logic is unit-tested; Shopify must run them | An order on a dev store after `npm run deploy` |
| Real COD orders, MSG91 OTP, GA4 / Meta events, Shiprocket codes, yearly billing | Mocked in every test | A dev store, test SMS and ad accounts |

The embedded admin itself (behind Shopify login) is only covered by these mocked harnesses, never in the real
Shopify admin.

## 5. Next steps

The first four only touch test files, so they carry no production risk and need no deploy.

- [ ] Update the 3 expected objects in `tests/cod/cod-server.test.mjs` (MSG91 keys, `termsUrl`, button padding)
- [ ] Rewrite `tests/packs/admin-browser-check.mjs` for the redesigned Packs admin, then confirm the admin works
- [ ] Add `syncComboWeightIfNeeded` to `tests/ai-handoff/harness/server-stub.js` so the BrixBar handoff check builds again
- [ ] Give `tests/cart-drawer/banner-php.test.mjs` its own `portOffset` so the full suite can run in parallel
- [ ] Remove or unroute `app/routes/app.cartdrawer.old.jsx` (app change, needs a deploy)
- [ ] Delete the earlier duplicate keys in `DEFAULT_COMBO_CONFIG` and the stray `app/services/coupons.server.js` (no behaviour change)
- [ ] Set up a staging PHP backend + dev store so the API, storefront and checkout tests can run without touching live data

## 6. How production was kept safe

No request reached any live system, and the app code ended exactly as it started.

- **What ran:** Node unit tests, the PHP harness (copies of the real `php_backend` files on a throwaway MariaDB in a
  temp folder, with its own `config.php`), and 32 Playwright browser checks whose calls to `int.thebrix.io`,
  `cartdrawer.fly.dev` and Shopify are all answered by mocks.
- **Network guard:** every Node process was started with a preload that refuses any connection outside
  `127.0.0.1` / `localhost` (and to local port 80/443, so the XAMPP copy of the PHP backend was off limits too).
  It logged **0 blocked requests** across all runs.
- **No `.env`:** tests ran without loading `.env`, so the live MySQL proxy URL and the app keys were never in reach.
- **Repository:** two browser checks rebuild test harness bundles; those test files were put back afterwards and
  `git status` matched the starting snapshot exactly. No app code was changed, nothing was committed, nothing was
  deployed. The only files added are this report and its raw results.
- **Run on:** Windows 10, Node 20.19.4, Playwright 1.61.1, XAMPP PHP 8.2 / MariaDB 10.4.

### Commands used

```bash
# Unit + PHP harness, one file at a time (avoids the port clash)
node --import <net-guard.mjs> --import ./tests/packs/register.mjs --test --test-concurrency=1 $(find tests -name "*.test.mjs")

# Each browser check, one after another
node --import <net-guard.mjs> --import ./tests/packs/register.mjs tests/<area>/<name>-check.mjs

# Static checks
npx eslint --ignore-path .gitignore .
npx react-router typegen && npx tsc --noEmit
```
