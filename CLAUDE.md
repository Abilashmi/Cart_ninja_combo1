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
