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

### Two Separate AI Systems

There are **two distinct AI UIs** in this app — do not confuse them:

| System | Component | Scope | Purpose |
|---|---|---|---|
| **BrixBar** | `app/components/ai-agent/BrixBar.jsx` | Combo builder pages only | Inline prompt bar mounted directly in page JSX. Used in `app.bundles.customize.jsx` and `app.bundles._index.jsx`. |
| **CartNinja** | `app/components/ai-agent/CartNinjaAgentV2.jsx` | All `/app/*` pages | Full floating chat panel launched via `CartNinjaFloatingLauncher` in `app/routes/app.jsx`. |

`BrixBar` must be mounted **once per page** — `app.bundles.customize.jsx` has historically had duplicate `<BrixBar />` instances that cause double-UI bugs. Always check for this when editing that file.

### Cart Editor (app/routes/app.cartdrawer.jsx)

The cart editor is a live-preview builder split into:

- **`CartEditorContext`** (`app/context/CartEditorContext.jsx`) — single source of truth for all editor state. Exposes `updateGeneral`, `updateDesign`, `updateHeader`, `updateAnnouncements`, `updateEmptyCart`, etc.
- **`CartEditorSidebar`** → renders section panels from `app/components/sections/`. Each section component pulls state from context. Sections: `design`, `general`, `header`, `announcements`, `progressBar`, `couponSlider`, `upsellProducts`, `emptyCart`, `checkoutButton`, `customCSS`.
- **`CartPreview`** — right-side live preview, also reads from context.
- **Save flow** (`CartEditorPage.handleSave`): fires two parallel saves — a legacy blob to `POST /app/cartdrawer` and normalized saves to `/api/cart-drawer-config`, `/api/progress-bar`, `/api/coupon-slider-settings`, `/api/upsell-settings`.

The `cart_drawer_config` MySQL table is the canonical store for announcement, general, header, design, and empty cart fields (the newer normalized path). The legacy `cart_drawer` table (on the PHP backend MySQL) holds JSON blobs and is still written for backward compatibility.

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

### AI Agent (CartNinja)

A floating AI assistant embedded in all `/app/*` pages via `CartNinjaFloatingLauncher` in `app/routes/app.jsx`.

- Chat UI: `app/components/ai-agent/CartNinjaAgentV2.jsx`
- Action engine: `app/services/ai-agent-actions.server.js` — interprets structured `actions[]` from the LLM and applies them to the MySQL/JSON stores. Supported actions are listed in `SUPPORTED_ACTIONS`.
- Conversation history persisted in MySQL via `app/services/ai-agent-history.server.js` (PHP backend tables: `ai_conversations`, `ai_messages`).
- AI route: `app/routes/api.ai-agent.generate.jsx` → calls NVIDIA NIM.

### Route Naming

React Router v7 file-based routing. Patterns:
- `app.*.jsx` — embedded Shopify admin pages (authenticated via `authenticate.admin`)
- `api.*.jsx` — JSON API endpoints used by the frontend fetchers
- `webhooks.*.jsx` — Shopify webhook handlers
- `*.php.jsx` — PHP-compatible endpoint proxies (e.g., `save_cart_drawer[.]php.jsx` accepts POST from the storefront extension)

### Shopify Extension

`extensions/cart-drawer/` — a Theme App Extension with Liquid blocks. The cart drawer block (`cart_drawer.liquid`) renders on the storefront and POSTs config/click data back to `*.php.jsx` routes. Extension settings sync happens via the Shopify CLI (`npm run deploy`).

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
