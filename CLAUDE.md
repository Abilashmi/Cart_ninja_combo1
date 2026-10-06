# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Local dev (starts tunnel + embedded app)
npm run dev          # alias: shopify app dev

# Build for production
npm run build        # react-router build

# Lint
npm run lint

# Type check
npm run typecheck    # react-router typegen && tsc --noEmit

# DB schema sync (after schema.prisma changes)
npm run setup        # prisma generate && prisma db push

# Push extension + app config changes to Shopify CDN (required after any
# change to extensions/cart-drawer/* or shopify.app.toml)
npm run deploy       # shopify app deploy
```

> **Windows Prisma issue:** If you see `query_engine-windows.dll.node` errors, set `PRISMA_CLIENT_ENGINE_TYPE=binary` in `.env`.

> **App Proxy / local dev:** `shopify.app.toml` has `automatically_update_urls_on_dev = false`. The `[app_proxy].url` points to a Cloudflare tunnel for the local PHP backend (`http://localhost/cartdrawerv2_ui/php_backend`). This URL is ephemeral — run `cloudflared tunnel --url http://localhost`, paste the new URL into `app_proxy.url`, then `npm run deploy`.

## Architecture Overview

This is a **Shopify embedded app** built with React Router v7, Polaris UI, and a dual-database setup. It provides cart drawer customization, upsell/FBT widgets, coupon sliders, and a bundle builder (Combo Forge).

### Dual Database Pattern

The app writes to **two separate databases simultaneously**:

1. **MySQL** (`cart_drawer_ninja`) via `app/services/db.server.js` — the production store. Direct `mysql2/promise` pool. Used for all normalized widget settings tables (`cart_drawer_config`, `progress_bar_settings`, `coupon_slider_settings`, `upsell_widget_settings`, `fbt_widget_settings`, etc.).

2. **SQLite via Prisma** (`prisma/schema.prisma`) — used for Shopify session storage, `combo_templates`, `combo_analytics`, `upsell_rules`, and Shopify-facing models. Connection via `app/db.server.js` (exports default Prisma client).

3. **PHP backend** at `https://int.thecomboforge.com` — a separate server handling legacy templates, discounts, analytics, and the `cart_drawer` table. Accessed through `app/utils/api-helpers.js` (`getDb`, `sendToPhp`). The `cart_drawer` table (MySQL, legacy) is distinct from `cart_drawer_config` (newer normalized table).

When adding new fields, you typically need:
- An `ALTER TABLE` on MySQL (via the PHP backend or direct query)
- An upsert update in the relevant `api.*` route
- State wired in `CartEditorContext` and `cartEditorTypes.js`

### AI API Key Convention

All AI routes use `process.env.OPENAI_API_KEY` to hold the **NVIDIA NIM key** (`nvapi-...`). The key's prefix determines the endpoint and model:
- `nvapi-*` → `https://integrate.api.nvidia.com/v1/chat/completions` + `meta/llama-3.1-8b-instruct`
- Anything else → `https://api.openai.com/v1/chat/completions` + `gpt-4o-mini`

This detection pattern must be applied in both Node.js routes and PHP files (`php_backend/ai_upsell.php` already patched).

### BrixBar — the one AI system

There is a **single** AI UI in this app: **BrixBar** (`app/components/ai-agent/BrixBar.jsx`), an inline prompt bar mounted directly in page JSX across most `/app/*` pages (`app.cartdrawer` via `CartEditorSidebar.jsx`, `app.bundles.customize.jsx`, `app.bundles._index.jsx`, `app.productwidget.jsx`, `app.additional.jsx`, `app.coupons.jsx`, `app.analytics.jsx`, `app.fbt.jsx`). A prior "CartNinja" floating-chat system has been fully removed — if you see it mentioned in old comments/memory, it's stale.

`BrixBar` must be mounted **once per page** — `app.bundles.customize.jsx` has historically had duplicate `<BrixBar />` instances that cause double-UI bugs. Always check for this when editing that file.

### Cart Editor (app/routes/app.cartdrawer.jsx)

The cart editor is a live-preview builder split into:

- **`CartEditorContext`** (`app/context/CartEditorContext.jsx`) — single source of truth for all editor state. Exposes `updateGeneral`, `updateDesign`, `updateHeader`, `updateAnnouncements`, `updateEmptyCart`, `updateCountdownTimer`, etc.
- **`CartEditorSidebar`** → renders section panels from `app/components/sections/`. Each section component pulls state from context. Sections: `design`, `general`, `header`, `announcements`, `progressBar`, `couponSlider`, `upsellProducts`, `countdownTimer`, `emptyCart`, `checkoutButton`, `customCSS`.
- **`CartPreview`** — right-side live preview, also reads from context.
- **Save flow** (`CartEditorPage.handleSave`): fires two parallel saves — a legacy blob to `POST /app/cartdrawer` and normalized saves to `/api/cart-drawer-config`, `/api/progress-bar`, `/api/coupon-slider-settings`, `/api/upsell-settings`, `/api/countdown-timer`.
- **Save layer** (`app/services/cart-config-writes.server.js`): every normalized route above is a thin wrapper around a shared save function here (`saveCartDrawerConfig`, `saveProgressBarSettings`, `saveUpsellWidgetSettings`, `saveCouponSliderSettings`, `saveFbtWidgetSettings`, `saveCountdownTimerSettings`). Each fetches the existing row first and merges — a field omitted from the caller's patch falls back to the current DB value, never a hardcoded default — so the AI agent's tool calls (which often touch one field at a time) can never silently reset unrelated fields. The AI tool executors (`ai-agent-tools.server.js`) call these same functions directly, in-process.

The `cart_drawer_config` MySQL table is the canonical store for announcement, general, header, design, empty cart, and countdown timer fields (the newer normalized path) — and is what the storefront reads live via a `LEFT JOIN` in `save_cart_drawer.php`'s GET handler for header/announcement/design/empty-cart fields. The legacy `cart_drawer` table (on the PHP backend MySQL) still owns `cartStatus` (drawer on/off), `checkout_button_style` (JSON blob — the storefront's *only* source for checkout button styling; `cart_drawer_config`'s `checkout_button_*` columns are admin-preview-only), and `custom_css`/`countdown_data` blobs. Any code path that changes checkout-button appearance or drawer on/off state must write **both** tables, or the change won't reach the storefront — see `ai-agent-tools.server.js`'s `syncCheckoutButtonToLegacyRecord`/`syncDrawerStatusToLegacyRecord` helpers (the manual editor's own `CartEditorPage.handleSave` already does this via its parallel legacy-blob POST).

Default state shape lives in `app/types/cartEditorTypes.js` (`defaultCartEditorState`).

**Free reward products.** A Progress Bar tier's reward products are auto-added by the storefront drawer (`syncRewardProducts` in `cart_drawer_inline.js`, line property `_brixReward=true`). Each tier has `reward_pricing` (`progress_bar_tiers`, self-healing column, default `'regular'` so nothing already live silently becomes free): `'free'` = made free at checkout by the `extensions/brix-reward-discount` Shopify Function, `'regular'` = added at its normal price. The Function trusts only the app-owned shop metafield `$app:reward_gift_config` (built from the saved bar by `app/services/reward-gift-shopify.server.js`, never from the browser) and only discounts marked lines whose product is in that config while the cart *without gifts* meets the milestone. `syncRewardGiftDiscount` runs after AI tool saves and `api.progress-bar` saves; it never throws and returns `{verified, state, message}` (`not_needed | active | not_deployed | inactive | failed`). The drawer shows FREE only when the cart line is really at 0, and if a free-priced reward line is still charged (discount not active) it removes it and stops offering it for that page load, so a shopper is never charged for a "free gift", and the preview cart (`utils/preview-cart.js`, `PreviewCartItems.jsx`) mirrors it from the tier's `rewardPricing`. **Never claim a reward is free unless `verified`.** The Function needs `npm run deploy` and has only had its logic unit-tested (`tests/ai-handoff/reward-function.test.mjs`), not a real checkout.

### BRIX COD Checkout

Cash on Delivery orders are placed **by BRIX**; prepaid orders never touch it and keep using Shopify (or Shiprocket) checkout. Admin page: `app/routes/app.cod.jsx` (plan feature `cod_checkout`: Free = preview, Starter/Pro = live).

- **Storefront sheet:** `extensions/cart-drawer/assets/brix_cod.js` (`window.BrixCod`), loaded by the Custom Cart Drawer app embed before `cart_drawer_inline.js`. One flow (phone OTP → address → review → order) for three entry points: the drawer (`initCodButton` fills `#cc-cod-slot` above the checkout button), product pages (auto-injected under Add to Cart, or into the optional `blocks/cod_button.liquid` slot; buys only that item), and combo pages (`combo-page[.]js.jsx` renders all four layouts directly, with a COD button; only a layout it doesn't know falls back to the `preview.$templateId.jsx` iframe, whose `CdoPreviewBar` shows the button through `ComboCodContext` and posts `brix-combo-cod-open` to the parent page, which opens the sheet). "Pay online" always hands back to that surface's normal checkout.
- **Storefront reads come from PHP, not Fly:** `brix_cod.js` loads COD settings and PIN code lookups from `php_backend/cod_storefront.php` (public, on `data-php` = `https://int.thebrix.io`, like the cart drawer's own settings; plan-gated there via `plan_config.php`'s `cod_checkout`). Node writes `_runtime.otpAvailable` into the stored settings (`saveCodSettings` / `syncCodRuntime`) so PHP knows whether to ask for an OTP.
- **The browser never calls Fly:** OTP, pricing and placing the order are POSTed to `php_backend/cod_checkout.php`, which relays them server-to-server to `<BRIX_APP_URL>/api/cod/{otp,quote,order}` (env, default `https://cartdrawer.fly.dev`) with `X-Forge-Secret` and the shopper's IP in `X-Brix-Client-Ip` (`clientIp()` trusts it only with the secret, so per-IP limits stay per shopper). PHP can't do this part itself: it has no Shopify access token (`install_shop.php` only receives the shop name).
- **Server:** `api.cod.{otp,quote,order}.jsx` (reached through the relay) → `services/cod-storefront.server.js` (shop/plan/settings context) → `services/cod.server.js`. Prices come from Shopify's `draftOrderCalculate`, never the browser. Orders are `draftOrderCreate` + `draftOrderComplete(paymentPending: true)` (deprecated arg, still works on 2025-10; recheck on API upgrades), tagged `COD`, `BRIX-COD`, `brix-src-<surface>`, with shipping + COD fee as one "Cash on Delivery" shipping line. Needs the `write_draft_orders` scope.
- **Abuse limits:** OTP (only when an SMS provider is configured: `MSG91_AUTH_KEY` + `MSG91_OTP_TEMPLATE_ID`; `COD_OTP_DEV_LOG=1` logs codes outside production), per-phone daily order limit, per-IP and per-phone rate limits, idempotency key per sheet. Phones are stored hashed (HMAC with `SHOPIFY_API_SECRET`).
- **Coupons in the popup:** configured in the admin's "Coupons" section (`allowCoupons` + `sheet.showCoupon/couponLabel/couponOpen/offers`; offers = up to 5 suggested codes, picked from the store's active Shopify codes via `listActiveDiscounts` or typed, shown as tap-to-apply cards). When on, the review step has a coupon field (type, Enter, or Paste = paste-and-apply). Applying re-runs `quote` with the code, and Shopify's `draftOrderCalculate` decides; only a code the quote marks `applied` is sent with the order. A code passed in from the drawer that Shopify rejects shows as a coupon error instead of being silently dropped.
- **Popup look:** `settings.sheet` (store logo, logo size, accent colour, corners, order summary / trust badges toggles, thank-you text), edited in the admin's "Checkout popup" section and sanitised in `cod.shared.js` + re-checked in `cod_storefront.php`'s `cods_sheet()`. The logo is an https URL or a small raster data URL (the admin resizes uploads in the browser; the app has no `write_files` scope), never SVG. The popup always opens with the BRIX loader and ends with "Secured & powered by BRIX", using `extensions/cart-drawer/assets/brix_logo.svg` (passed as `data-brix-logo`) and its admin copy `public/brix-logo.svg`; both are still a **placeholder** text mark until the real BRIX logo is dropped in under the same names.
- **Ads & analytics (GA4 + Meta Pixel):** COD orders skip Shopify checkout, so the store's Google/Meta apps never see them. The admin's "Ads & analytics" section stores public IDs in `settings.tracking` (`ga4Id`, `metaPixelId`, `metaContentId` = catalog ID format, `dataLayer`), served to the popup by `cod_storefront.php`'s `cods_tracking()`. `brix_cod.js`'s `Track` fires the funnel (begin_checkout / cod_otp_verified / add_shipping_info / add_payment_info / purchase, Meta InitiateCheckout / CodOtpVerified / CodAddressAdded / AddPaymentInfo / Purchase) with `send_to` / `trackSingle` so only the merchant's IDs get them. It reuses the theme's gtag/fbq, or loads them lazily on first use, and fires nothing without Shopify Customer Privacy consent (GA = analytics, Meta = marketing). The server sends its own Purchase after the order exists (`cod-tracking.server.js`: GA4 Measurement Protocol + Meta Conversions API, fire-and-forget from `placeCodOrder`, result in `cod_orders.ga4_status/meta_status`) with the same ids, so each order counts once: GA4 `transaction_id` = order name, Meta `event_id` = `brixcod_<order id>`. The GA4 API secret, CAPI token and Meta test code live in the PHP-owned `cod_secrets` table (`cod_settings.php` `secrets_*`), never in the settings blob or the storefront config; the admin only sees "set / last 4". The relay forwards the shopper's User-Agent as `X-Brix-Client-Ua` (trusted only with the secret, like the IP). Not yet tested against real GA4 / Meta accounts; never claim events arrive until seen in GA4 DebugView / Meta Test events.
- **Order lifecycle after placing:** the existing `orders/updated`, `orders/paid` and `orders/cancelled` webhooks call `syncCodOrderFromWebhook` (only for orders tagged `BRIX-COD`, not awaited), which stores `cod_orders.lifecycle` (`placed / shipped / delivered / paid / rto / cancelled / refunded`, from fulfillment `shipment_status`, `financial_status`, `cancelled_at` and summed refunds) via `cod_orders.php` `sync` (row-locked, so duplicate webhooks act once). Moving into cancelled/refunded sends one GA4 `refund`. `orders/updated` carries all refunds, so `refunds/create` isn't used for this.
- **Not allowed with COD:** carts holding Pack lines (`_brix_pack_id`) or free reward gifts (`_brixReward`), because their prices come from Shopify Functions that only run in Shopify checkout. COD is India-first (+91 phones, 6-digit PIN codes, `countryCode: IN`).
- **Storage is owned by the PHP backend:** `php_backend/cod_settings.php`, `cod_otp.php`, `cod_orders.php` (shared code in `cod_helpers.php`) create and own the `cod_settings` (JSON blob per shop), `cod_otp`, `cod_orders` and `cod_secrets` (GA4 / Meta keys) tables. Node calls them with `X-Forge-Secret` (never raw SQL through `db_proxy.php`) and sends only HMAC hashes of phones and OTP codes. OTP limits (30 s between codes, 5 per hour, 10 min expiry, 5 tries) are enforced in `cod_otp.php`. Upload these PHP files to `int.thebrix.io` along with the Node deploy.
- **Tests:** `node --import ./tests/packs/register.mjs --test tests/cod` (runs the real `cod_*.php` files on a throwaway MariaDB started from XAMPP's binaries by `tests/cod/php-harness.mjs`, with a fake Admin API and the harness's fake app server standing in for GA4 / Meta) and `node tests/cod/sheet-browser-check.mjs` (Playwright, all network mocked). Not yet tested against a real store; never claim COD orders work until one has been placed on a dev store.

### Combo Forge Bundle Builder

The bundle builder spans **two route files** and a shared component:

#### Dashboard — `app/routes/app.bundles._index.jsx`
The dashboard loader reads `combo_templates` from SQLite via `prisma.$queryRawUnsafe` and passes `templates`, `templateCount`, `publishedCount`, and `discounts` to the page. The **action** in this same file handles two intents submitted from `TemplateManager`:
- `intent: delete` — deletes by id
- `intent: toggle_active` — sets `is_active` on the template

`TemplateManager` (`app/components/bundles/TemplateManager.jsx`) is rendered inside the dashboard and uses `useFetcher` to POST to `/app/bundles` (the `_index` route). The **"Full Library"** table shows `paginatedTemplates` — a filtered/paginated slice of `templates` from loader data. If templates aren't appearing, the issue is usually the `isClient` guard (`useState(false)` / `useEffect → setIsClient(true)`) that prevents SSR hydration flashes, or the `deletedIds` ref optimistic-removal filter.

#### Builder — `app/routes/app.bundles.customize.jsx`
A 7200+ line route that is the builder for combo/bundle pages. Key internals:
- `DEFAULT_COMBO_CONFIG` — all builder config defaults (search this object first when a config key is missing).
- `ProductCardItem` — renders each product card in the preview. Variants show when `hasVariants` (`product.variants.length > 1`). Quantity selector shows when `config.show_quantity_selector !== false`.
- Layout types: `layout1` (Guided Architect), `layout2` (Velocity Stream / tab-switcher), `layout4` (Editorial Split). Mapped from Shopify block names via `LAYOUT_MAP`.
- Templates are saved to SQLite via `prisma.$queryRawUnsafe` into `combo_templates`, and to the PHP backend via `sendToPhp`.
- The builder has a **template-picker mode** (`?mode=template-picker`) that shows layout cards before entering the builder; navigating away from this sends `?templateId=<id>` to load an existing template.

Sidebar sections for the builder live in `app/components/customization/`. The coupon/discount panel is in `AdvancedSection.jsx`.

### AI Agent (BrixBar) — tool-calling architecture

BrixBar is a real tool-calling agent, not a keyword matcher: any request in its coverage (cart drawer design/header/announcements/progress bar/coupon slider/upsell products/FBT/countdown timer/empty cart/checkout button/custom CSS, theme matching, discounts, Combo Forge templates) gets executed directly — it does not punt to "go do this yourself in the admin."

- Client: `app/components/ai-agent/useAiAgent.js` — thin: conversation CRUD, localStorage cache, and one `sendMessage` path that POSTs to `/api/ai/chat`. The only client-side state beyond messages is `pendingConfirmTool` (`{name, args} | null`), set when the server returns `needsConfirmation: true` for a destructive action (disabling the whole cart drawer, clearing custom CSS, removing an upsell/FBT rule, deleting a discount) — a bare "no" cancels locally, anything else re-POSTs to let the server execute or reconsider.
- Server loop: `app/routes/api.ai.chat.jsx` — authenticates, consumes one AI credit per user message (`app/services/ai-credits.server.js`), then loops (capped at 6 iterations) calling `agentTurn()` and executing any tool calls the model returns via `TOOL_EXECUTORS`, feeding results back as `role: 'tool'` messages, until the model replies with plain text.
- Tool registry: `app/config/ai-tool-schemas.js` (`TOOL_REGISTRY`, ~28 tools + `isDestructiveToolCall`) — plain JSON-schema data shared between the OpenAI native-tools path and the NVIDIA prompted-JSON fallback.
- Tool executors: `app/services/ai-agent-tools.server.js` (`TOOL_EXECUTORS`) — one function per tool, calling into `app/services/cart-config-writes.server.js` (the safe merge-on-existing-row save layer shared with the manual Cart Editor's own API routes — never a hardcoded-default overwrite), `upsell-rules.server.js`, `collection-resolver.server.js`, `combo-templates.server.js`, `discounts.server.js`, `theme-detection.server.js`.
- LLM call layer: `app/services/ai-llm.server.js`'s `agentTurn()` — real OpenAI function-calling (`tools`/`tool_choice`) when `OPENAI_API_KEY` is a real `sk-...` key; a single-tool-per-turn prompted-JSON protocol when it's an `nvapi-...` NVIDIA NIM key (an 8B model isn't trusted with native multi-tool reasoning over a ~28-tool registry).
- Conversation history persisted in MySQL via `app/services/ai-agent-history.server.js` (PHP backend tables: `ai_conversations`, `ai_messages`) — unchanged by the tool-calling rework.

### Route Naming

React Router v7 file-based routing. Patterns:
- `app.*.jsx` — embedded Shopify admin pages (authenticated via `authenticate.admin`)
- `api.*.jsx` — JSON API endpoints used by the frontend fetchers
- `webhooks.*.jsx` — Shopify webhook handlers
- `*.php.jsx` — PHP-compatible endpoint proxies (e.g., `save_cart_drawer[.]php.jsx` accepts POST from the storefront extension)

### Shopify Extension

`extensions/cart-drawer/` — a Theme App Extension with Liquid blocks. The cart drawer block (`cart_drawer.liquid`) just mounts a `#cc-root` div; the entire drawer (header, announcement bar, countdown timer, progress bar, body, footer) is rendered client-side by `assets/cart_drawer_inline.js` (`renderDrawer()`), which fetches config from `/apps/cart-app/save_cart_drawer.php` — not a separate Liquid snippet per section. FBT and the coupon slider are the exception: those render as their own web components (`<ps-fbt-widget>`, coupon slider snippets) placed elsewhere on the page (e.g. near the product page's Add-to-Cart button), fetching their own config independently. Extension settings sync happens via the Shopify CLI (`npm run deploy`).

Storefront widgets (cart drawer, FBT, coupon slider) fetch their config via the **Shopify App Proxy** at `/apps/cart-app/save_*.php`. Shopify forwards these requests to the URL set in `[app_proxy].url` in `shopify.app.toml`. If widgets show nothing on the storefront, the proxy URL is the first thing to check.

### Environment Variables

| Variable | Purpose |
|---|---|
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | Shopify app credentials |
| `DATABASE_URL` | Prisma SQLite connection string |
| `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME` | Direct MySQL pool (`db.server.js`) — defaults to `cart_drawer_ninja` |
| `OPENAI_API_KEY` | Holds the NVIDIA NIM key (`nvapi-...`) for all AI features |
| `SHOPIFY_APP_URL` | Public tunnel URL for embedded app |
| `PHP_BASE_URL` | Override for PHP backend base URL (default: `http://localhost/cartdrawerv2_ui/php_backend`) |

### PHP Backend

`php_backend/` contains the server-side PHP scripts deployed at `https://int.thecomboforge.com`. They own:
- `save_cart_drawer.php` — writes to the legacy `cart_drawer` MySQL table
- `save_coupon_slider_widget.php`, `save_fbt_widget.php` — widget config read by the storefront via app proxy
- `analytics.php`, `orders.php`, `clicks.php` — analytics aggregation
- `combo_save.php`, `combo_pages.php` — Combo Forge template persistence
- `ai_conversations.php`, `ai_messages.php` — AI chat history

`app/utils/api-helpers.js` is the Node.js client for all PHP endpoints. `BASE_PHP_URL` is set there. The `X-Forge-Secret` header (set to `SHOPIFY_API_KEY`) authenticates Node → PHP calls.
