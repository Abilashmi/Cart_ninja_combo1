# App Structure Reference

Full architectural map of the Cart Drawer / Combo Forge Shopify app, generated for feeding into AI agent context (BrixBar) or onboarding. Companion to `CLAUDE.md` (keep that file's dev-workflow/commands section as the source of truth for how to run things — this file is the structural deep-dive).

Generated: 2026-07-14.

---

## 1. High-Level Shape

A **Shopify embedded app** (React Router v7 + Polaris) that ships four merchant-facing modules:

1. **Cart Drawer** — customizable slide-out cart (`/app/cartdrawer`)
2. **Combo Forge** — bundle/upsell page builder (`/app/bundles/*`)
3. **Upsell / FBT (Frequently Bought Together)** — product-page and cart widgets
4. **Coupon Slider** — carousel of active discount codes shown in the cart

Plus a floating AI assistant ("Brix") embedded on every admin page, and an admin analytics/billing suite.

Persistence is split across **three real stores** that all end up writing to the same MySQL database in practice, plus one isolated SQLite database for login sessions:

| Store | Tech | What it owns |
|---|---|---|
| MySQL `cart_drawer_ninja` (raw pool) | `mysql2/promise`, `app/services/db.server.js` | Most widget config tables — the primary data path for Node routes |
| MySQL `cart_drawer_ninja` (Prisma) | `@prisma/client`, `app/db.server.js`, `prisma/schema.prisma` | A handful of models (`Shop`, `Coupon`, `UpsellRule`, Combo Forge subscription/usage) |
| SQLite (Prisma, separate schema) | `@prisma/session-client`, `app/session-db.server.js`, `prisma/session/schema.prisma` | Shopify OAuth `Session` storage only — deliberately isolated so Fly.io doesn't need a live MySQL connection just to log a merchant in |
| PHP backend (`php_backend/`, deployed at `https://int.thecomboforge.com`) | PDO against the **same** `cart_drawer_ninja` MySQL DB | Legacy blob tables, AI chat history, Combo Forge template CRUD, GDPR webhook handlers, billing/plan sync |

Node ↔ PHP communication is a shared-secret HTTP bridge: every call carries header `X-Forge-Secret: process.env.SHOPIFY_API_KEY`, via `sendToPhp()` in `app/utils/api-helpers.js`.

**Known naming trap**: there are four different "get me a DB handle" things in this codebase — `app/services/db.server.js`'s `getDb()` (real MySQL pool), `app/db.server.js` (Prisma client, MySQL), `app/session-db.server.js` (Prisma client, SQLite), and `app/utils/api-helpers.js`'s `getDb(shop)` (actually two `fetch()` calls to the PHP backend, returns `{templates, discounts}` — not a DB handle at all). Don't assume `getDb` means the same thing across files.

---

## 2. Routes (`app/routes/`, React Router v7 flat-file convention)

~93 route files. Dots in filenames become path segments (`app.bundles.customize.jsx` → `/app/bundles/customize`).

### Embedded admin pages — `app.*.jsx`
| Route | Purpose |
|---|---|
| `/app` | Root layout: `authenticate.admin`, Polaris `AppProvider`, `CurrencyProvider`, `PlanProvider` |
| `/app` (index) | Dashboard — KPI cards from `getAnalyticsData` |
| `/app/additional` | Account/store settings + billing/usage summary |
| `/app/analytics` | Full analytics dashboard (recharts, date pickers, funnels) |
| `/app/billing` | Billing dashboard; reconciles `pending_plan_key` → `plan_key` |
| `/app/brix-ai` | Full-page Brix AI chat (`BrixAiPage`) |
| `/app/bundles` | Combo Forge layout/outlet |
| `/app/bundles` (index) | Bundles dashboard — reads `combo_templates`/`combo_analytics`; delete/toggle-active actions |
| `/app/bundles/analytics` | Per-bundle analytics |
| `/app/bundles/customize` | **The builder** — 7000+ line route, the biggest file in the app |
| `/app/bundles/plan` | Redirect stub → `/app/subscribe?highlight=build_a_combo` |
| `/app/bundles/templates` | Template manager panel |
| `/app/cartdrawer` | **Cart Drawer editor** — current/active implementation |
| `/app/cartdrawer/old` | Legacy backup of the cart drawer editor — not the active one, kept for reference |
| `/app/coupons` | Discount Creator (list/manage discount codes) |
| `/app/discount` | Older "Coupons" list page — re-exports `api.shopify-coupons`'s loader; overlaps with `/app/coupons`, unclear which is canonical |
| `/app/discounts/create` | Create/edit discount form |
| `/app/fbt` | FBT admin settings (rules + widget config) |
| `/app/productwidget` | Product-page widget settings (FBT/upsell/progress-bar on PDP) |
| `/app/setup` | Onboarding checklist, deep-links into theme editor |
| `/app/subscribe` | Plan/pricing selection; triggers Shopify `appSubscriptionCreate` |
| `/app/upsell` | Upsell rules config |
| `/` | Unauthenticated landing page |
| `/auth/*`, `/auth/login` | OAuth flow |

### JSON API endpoints — `api.*.jsx` (~48 files, grouped)
- **AI/Brix**: `api.ai.chat`, `api.ai.conversations`, `api.ai.messages`, `api.ai.credits`, `api.ai.suggestions`, `api.ai.tools`, `api.ai-agent.apply`, `api.ai-agent.auto-upsell`, `api.ai-agent.combo-turn`, `api.ai-agent.discount-turn`, `api.ai-agent.match-theme`, `api.ai-agent.progress-bar-turn`, `api.ai-agent.store-insights`, `api.ai-agent.upsell-rule-turn`
- **Analytics**: `api.analytics`, `api.analytics.chart`, `api.analytics.funnel`, `api.analytics.insights`, `api.analytics.recent-activity`, `api.analytics.summary`, `api.analytics.top-collections`, `api.analytics.top-products`
- **Billing**: `api.billing.charges`, `api.billing.get-usage`, `api.billing.trigger-charge`
- **Bundles**: `api.bundle-analytics`, `api.bundle-products`, `api.bundle-templates`
- **Cart drawer config** (two overlapping endpoints — flagged as a likely duplicate): `api.cart-drawer-config` (writes `cart_drawer_config` directly) vs `api.cartdrawer-config` (merged/broader config incl. legacy `cart_drawer` table)
- **Coupons/discounts**: `api.coupon-display-rules`, `api.coupon-slider-settings`, `api.coupon-slider`, `api.coupons-active`, `api.create_coupon-sample`, `api.shopify-coupons`
- **FBT**: `api.fbt-settings`, `api.fbt-widget`
- **Upsell**: `api.upsell`, `api.upsell-settings`
- **Progress bar**: `api.progress-bar`
- **Misc**: `api.products`, `api.feedback`, `api.suggestions`, `api.shophandler`, `api.test-db`, `api.test-php`

### Webhooks — `webhooks.*.jsx` (18 files)
`app.scopes_update`, `app.uninstalled`, `app_purchases_one_time_update`, `app_subscriptions_update`, `carts.create`, `carts.update`, `compliance` (combined 3-topic handler), `customers.data_request`, `customers.redact`, `orders.cancelled`, `orders.create`, `orders.paid` (authoritative revenue event), `orders.updated`, `refunds.create`, `shop.redact`.

### PHP-compatible proxy routes — `*[.]php.jsx` (bracket-escaped dot → literal `.php` URL, for the storefront extension / app proxy)
`click.php`, `save_cart_drawer.php`, `save_coupon.php`, `save_coupon_slider_widget.php`, `save_fbt_widget.php`.

### Other
`store.jsx` (`/store`) — unused demo boilerplate, not wired to real data. `preview.$templateId.jsx` (`/preview/:templateId`) — unauthenticated live preview of a bundle template.

---

## 3. Components (`app/components/`)

### Cart Drawer editor stack
- **`CartEditorContext.jsx`** (`app/context/`) — single source of truth for the cart drawer editor. State: `status`, `settings.general/design`, `header`, `body.announcements/progressBar/couponSlider/upsellProducts/emptyCart/countdownTimer`, `footer.checkoutButton/customCSS/watermarkEnabled`, plus `activeSection`/`previewMode`/`previewDevice`/`isDirty`. Hydrates from legacy blob + normalized DB records on mount; live-patches via `window` events (`cartEditorConfigUpdated`, `featureStateChanged`) so the AI agent can push changes into the editor without a reload. Exposes one `update*` setter per section plus array helpers for coupon/upsell rule CRUD.
- **`CartEditorPage.jsx`** — top-level page: wraps the context provider, renders sidebar + preview, owns the save flow (parallel POSTs to `/api/cart-drawer-config` + legacy `/app/cartdrawer` fetcher submit).
- **`CartEditorSidebar.jsx`** — accordion sidebar; maps each section key to its component via `SECTION_COMPONENT_MAP`; embeds `BrixBar`.
- **`CartPreview.jsx`** — live visual preview; clicking a preview region opens the matching sidebar accordion.
- **`app/components/sections/*.jsx`** — one file per editor section: `DesignSection`, `GeneralSection`, `HeaderSection`, `AnnouncementsSection`, `ProgressBarSection`, `CouponSliderSection`, `UpsellSection`, `EmptyCartSection`, `CheckoutSection`, `CustomCSSSection`, plus shared `ColorField.jsx`.
- **Orphaned/legacy** (no importers found — root-level `app/components/`): `CouponSliderEditor.jsx`, `MilestoneProgressBarPreview.jsx`, `ProgressBarEditor.jsx`, `UpsellComponents.jsx`, `UpsellProductEditor.jsx`. Superseded by the `sections/*` family; candidates for deletion after confirming with the team.

### Combo Forge builder stack (`app/components/customization/`)
- **`BuilderSidebar.jsx`** — 3-tab sidebar (Layout / Style / Advanced) with a settings search box.
- `SectionCard.jsx` (shared collapsible shell), `GeneralSection.jsx` (steps/collections, branches per layout type), `BannerSection.jsx`, `ProductsSection.jsx`, `ContentSection.jsx` (incl. AI-assisted title/description generation), `StylingSection.jsx`, `BehaviorSection.jsx`, `AdvancedSection.jsx` (progress bar, coupon, AI settings, custom CSS), `ThemePresets.jsx`, `ValidationPanel.jsx`, `BuilderActionBar.jsx` (undo/redo, save status, publish), `TemplatePreviewThumb.jsx`.
- **`app/components/bundles/TemplateManager.jsx`** — the template *library/dashboard* (list, search, activate/deactivate/delete with optimistic UI + rollback), distinct from the builder itself.

### AI agent UI (`app/components/ai-agent/`)
- **`BrixBar.jsx`** — compact search-bar-style widget, expandable into a floating or inline chat panel; embedded across most admin pages.
- **`BrixAiPage.jsx`** — full-page ChatGPT-style variant for `/app/brix-ai`.
- **`MarkdownMessage.jsx`** — lazy-loaded markdown renderer for chat bubbles (code-split to keep BrixBar's bundle small).
- **`useAiAgent.js`** — the real orchestrator/state machine (not a `.jsx` file) — see §5.
- **`api.js`** — fetch wrappers for `/api/ai/*`.
- **`featureStore.js`** — pub/sub store the AI agent writes into; `CartEditorContext` listens for its events to live-update the editor.

### Shared/cross-cutting
- `app/components/plan/PlanGate.jsx` — plan-gating primitives: `LockedOverlay`, `CustomizableLockedSection`, `ProBadge`, `PreviewLockBadge`, `LockedValue`, `LockedChartArea`.
- `app/components/PlanContext.jsx` — `PlanProvider`/`usePlan()`.
- `app/components/CurrencyContext.jsx` — `CurrencyProvider`/`useCurrency()`.
- `app/components/shared/FeatureToggle.jsx`, `SliderField.jsx` — reusable form primitives.
- `app/components/feature/FeatureHeaderBar.jsx`, `BrowserTabStrip.jsx`, `BundleStackMock.jsx` — page-header/nav chrome for feature pages.

---

## 4. Database Schema

### 4.1 SQLite — session storage only (`prisma/session/schema.prisma`)
`Session` — `id`, `shop`, `state`, `isOnline`, `scope`, `expires`, `accessToken`, `userId`, name/email fields, `accountOwner`, `locale`, `collaborator`, `emailVerified`, `refreshToken`, `refreshTokenExpires`. Deliberately isolated from MySQL so login doesn't depend on the app DB being reachable.

### 4.2 MySQL — Prisma-managed models (`prisma/schema.prisma`)
- `Session` (MySQL copy) — legacy/unused, superseded by the SQLite session above.
- `Shop` → table `shops` — `shopDomain` (unique), `accessToken`, `isActive`, `planName`, `orderCount`, `totalRevenue`. (`plan_key`/`pending_plan_key` were added later via raw ALTER — not reflected in this model, a known schema-drift spot.)
- `CartDrawer` → table `cart_drawer` — **legacy JSON-blob table**, superseded by the normalized tables in §4.3 but still actively written for backward compat.
- `CartClickEvent` → table `cart_click_events`.
- `Coupon` → table `coupons`.
- `CouponSliderWidget` → table `coupon_slider_widget` — **legacy**, superseded by `coupon_slider_settings`.
- `FbtWidget` → table `fbt_widget` — **legacy**, superseded by `fbt_widget_settings` + `fbt_rules`.
- `UpsellRule` → table `upsell_rules` — the "rule builder" model (trigger/upsell products & collections, layout, tracking flags). Distinct from `upsell_widget_settings.manual_rules` (a JSON column used by the AI agent's rule flow) — two different upsell-rule storage paths.
- `WidgetSettings` → table `WidgetSettings`.
- `ComboSubscription`, `ComboAIUsage` — Combo Forge plan/usage tracking.
- Explicit comment in the schema: do **not** re-add `ComboTemplate`/`ComboAnalytic` as Prisma models — they were dropped in favor of hand-written raw tables (next section) because they were orphaned and never queried.

### 4.3 MySQL — raw-SQL tables (created via `CREATE TABLE IF NOT EXISTS` in service files, not Prisma models)

**AI chat/agent**: `ai_conversations`, `ai_messages`, `ai_suggestions`, `ai_tools`, `ai_actions`, `activity_logs`, `ai_agent_history`, `ai_applied_configs`.

**Combo Forge** (also created independently by `php_backend/combo_forge_init.php`): `combo_templates`, `combo_analytics`, `template_pages`, `template_collections`, `template_banners`, `template_settings`, `template_typography`, `template_progressbars`, `template_milestones`, `template_ai_blocks`, `template_custom_css`, `template_revisions`.

**Normalized widget config** (the "new schema" that replaces the legacy JSON blobs — see migration table below): `cart_drawer_config`, `progress_bar_settings`, `progress_bar_tiers`, `coupon_slider_settings`, `coupon_display_rules`, `upsell_widget_settings` (incl. `manual_rules` JSON column), `fbt_widget_settings`, `fbt_rules`.

**Analytics** (`app/services/analytics-schema.server.js`): `store_orders`, `store_order_line_items`, `product_collection_cache`, `store_order_line_item_collections`, `cart_activity_events`, `analytics_sessions`, `app_usage_events`, `analytics_daily_rollup`, `analytics_insights_cache`.

**Billing/plan** (`app/services/plan-schema.server.js`): `order_overage_charges`, `ai_brix_credit_usage`, `ai_brix_overage_charges`. Plus `shops.plan_key`/`pending_plan_key` columns added via ALTER.

**Other**: `store_order_events` (write-only rollback safety net, superseded by `store_orders`), `app_feedback` (no DDL found in repo — assumed pre-existing).

### 4.4 Legacy → normalized migration map
| Legacy table (JSON blobs) | Superseded by |
|---|---|
| `cart_drawer` | `cart_drawer_config` + `progress_bar_settings`/`progress_bar_tiers` + `upsell_widget_settings` |
| `coupon_slider_widget` | `coupon_slider_settings` + `coupon_display_rules` |
| `fbt_widget` | `fbt_widget_settings` + `fbt_rules` |
| `store_order_events` | `store_orders` + `store_order_line_items` |
| `combotemplate`/`comboanalytic` (orphaned Prisma tables) | `combo_templates`/`combo_analytics` (hand-written) |

Legacy tables are **not decommissioned** — some routes (`save_cart_drawer[.]php.jsx`, `save_coupon_slider_widget[.]php.jsx`, `save_fbt_widget[.]php.jsx` and PHP equivalents) still write to both old and new tables in parallel. When adding a field, check whether it needs to go in the legacy blob too.

### 4.5 PHP backend (`php_backend/*.php`)
Same MySQL DB as above, accessed via PDO. Roughly 1:1 with Node routes: `save_cart_drawer.php`, `cart_drawer_config.php`, `progress_bar.php`, `save_coupon.php`, `coupon_slider_settings.php`, `save_fbt_widget.php`, `fbt.php`, `upsell_settings.php`, `ai_conversations.php`, `ai_messages.php`, `ai_agent_apply.php`, `combo_forge_init.php`, `combo_save.php`, `combo_pages.php`, `click.php`/`analytics.php`, GDPR handlers (`customers-data-request.php` → `gdpr_data_requests`, `customers-redact.php` → `gdpr_redactions`, `shop-redact.php` → `gdpr_shop_redactions`), `migrate.php` (idempotent ALTER runner), plan/subscription sync (`update-subscription-status.php`).

---

## 5. AI Agent (BrixBar) Pipeline

The floating "Brix" assistant embedded on every `/app/*` page.

**Frontend**: `BrixBar.jsx` / `BrixAiPage.jsx` (UI) → `useAiAgent.js` (the real orchestrator — client-side intent classification + a multi-turn "pending action" state machine) → `api.js` (fetch wrappers).

**NVIDIA NIM vs OpenAI branching** (`app/services/ai-llm.server.js`): `process.env.OPENAI_API_KEY` doubles as the credential for either provider. If it starts with `nvapi-` → NVIDIA NIM (`meta/llama-3.1-8b-instruct`); otherwise → real OpenAI (`gpt-4o-mini`). Every AI route funnels through `callLlm()`/`callLlmWithMeta()`.

**Conversation persistence** lives entirely in the PHP backend (`ai_conversations.php`, `ai_messages.php`), proxied by `api.ai.conversations.jsx`/`api.ai.messages.jsx` — there is no Node-side history table for chat.

**Action catalog** — no single array; it's the intersection of two lists that must stay in sync:
- Client-recognized (`MODULE_TO_ENGINE` in `useAiAgent.js`): enable/disable drawer, goal bar, upsell, FBT, trust badges; `applyTemplate`, `optimizeMobile`, `matchTheme`.
- Server-implemented (`php_backend/ai_agent_apply.php` switch): only `enableDrawer`/`disableDrawer`, `enableGoalBar`/`disableGoalBar`, `enableUpsell`/`disableUpsell`, `enableFBT`/`disableFBT`, `applyTheme` actually mutate data. Everything else (e.g. `enableTrustBadges`) falls into `unsupported[]` — the client must report these as "not available yet," never as success.

**Four multi-turn wizard flows**, each its own route with LLM-based slot extraction and a uniform status contract (`ask` → `clarify` → `confirm` → `saved`, or `locked`/`error`):
1. `upsellRule` (`api.ai-agent.upsell-rule-turn.jsx`) — resolves trigger + offer products, writes to `upsell_widget_settings.manual_rules`.
2. `discount` (`api.ai-agent.discount-turn.jsx`) — resolves code/%/dates, creates a real Shopify `discountCodeBasicCreate`.
3. `progressBar` (`api.ai-agent.progress-bar-turn.jsx`) — reward type/goal amount/placement, writes `progress_bar_tiers`.
4. `combo` (`api.ai-agent.combo-turn.jsx`) — resolves a collection, plan-gated, creates a `combo_templates` row.

**Credits**: every LLM-touching route calls `checkAndConsumeCredit()` first (`app/services/ai-credits.server.js`), incrementing `ai_brix_credit_usage` keyed by `(shop_domain, YYYY-MM)`. Chat is never blocked at the cap — overage bills per-credit via Shopify usage billing once the monthly plan cap is exceeded. `store-insights` is templated (non-LLM) and explicitly skipped from credit metering.

**End-to-end flow**: merchant types → optimistic local append + async persist to `ai_messages` → if mid-flow, forwarded as next turn of that flow; otherwise client-side classifiers run in priority order (auto-upsell → AOV/insights → combo → progress-bar → discount → revenue query → generic toggle actions → fallback to free chat) → matched route executes (instant toggle via `/api/ai-agent/apply`, or a wizard turn, or `/api/ai/chat` for free-form) → response funnels back through `syncAfterToFeatureStore` which dispatches a `cartEditorConfigUpdated` window event so open editor UI reflects the change live → rendered via `MarkdownMessage.jsx`, with success/failure wording generated strictly from the server's `applied`/`unsupported` arrays (never inferred from "no error thrown").

---

## 6. Services & Utils quick reference (`app/services/`, `app/utils/`)

Full one-line inventory (25 services, 5 utils) — grep these filenames for anything not covered above:

**Services**: `coupons.server.js` (stub, unimplemented), `product-widget.server.js`, `product-widget.shared.js`, `storefront-upsell-integration.js` (client-injected, not server-only despite the name), `db.server.js` (raw mysql2 pool), `api.cart-settings.shared.js` (style presets + rule validation), `analytics-schema.server.js`, `analytics-aggregator.server.js`, `order-ingest.server.js`, `analytics-query.server.js`, `plan-permissions.server.js`, `scheduler.server.js` (cron-style background jobs), `cart-drawer-record.server.js`, `plan-schema.server.js`, `billing.server.js`, `ai-credits.server.js`, `upsell-rules.server.js`, `collection-resolver.server.js`, `combo-templates.server.js`, `store-config-snapshot.server.js`, `coupon-sample.server.js`, `analytics.server.js`, `ai-llm.server.js`, `ai-safety.server.js`, `upsell-recommendation.server.js`.

**Utils**: `currency.shared.js`, `bundle-api-helpers.js`, `api-helpers.js` (the PHP bridge — see §1), `analytics.shared.js`, `currency.server.js`.

**Types**: `app/types/cartEditorTypes.js` — `defaultCartEditorState`, `defaultTier`, `SECTION_GROUPS` (JS constants, not TS types, used as the editor's shape documentation).

---

## 7. Known inconsistencies worth knowing before making changes

- **Duplicate cart-config endpoints**: `api.cart-drawer-config.jsx` vs `api.cartdrawer-config.jsx` (hyphenation differs) — overlapping responsibility, unclear which is canonical.
- **Duplicate coupon list pages**: `/app/coupons` vs `/app/discount` — the latter re-exports the former's Shopify-native-discount loader.
- **`app.cartdrawer.old.jsx`** (255KB) is a legacy parallel implementation of the cart editor — not the active route (`app.cartdrawer.jsx` is).
- **Five orphaned root-level components** (`CouponSliderEditor.jsx`, `MilestoneProgressBarPreview.jsx`, `ProgressBarEditor.jsx`, `UpsellComponents.jsx`, `UpsellProductEditor.jsx`) have no importers anywhere — pre-refactor leftovers.
- **Two different `combo_templates` DDL sources** (the migration script vs `app/routes/preview.$templateId.jsx`'s inline `CREATE TABLE IF NOT EXISTS`) may drift out of sync.
- **`getDb` means four different things** depending on which file you're in — see §1.
- **Two upsell-rule storage paths**: the Prisma `UpsellRule` table (`/app/upsell` admin page) vs `upsell_widget_settings.manual_rules` JSON (written by the AI agent's upsell-rule flow) — not the same data.
- Legacy blob tables (`cart_drawer`, `coupon_slider_widget`, `fbt_widget`) are still actively written in parallel with their normalized replacements, not yet decommissioned.
