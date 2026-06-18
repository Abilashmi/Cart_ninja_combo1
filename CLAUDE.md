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
```

> **Windows Prisma issue:** If you see `query_engine-windows.dll.node` errors, set `PRISMA_CLIENT_ENGINE_TYPE=binary` in `.env`.

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

### Cart Editor (app/routes/app.cartdrawer.jsx)

The cart editor is a live-preview builder split into:

- **`CartEditorContext`** (`app/context/CartEditorContext.jsx`) — single source of truth for all editor state. Exposes `updateGeneral`, `updateDesign`, `updateHeader`, `updateAnnouncements`, `updateEmptyCart`, etc.
- **`CartEditorSidebar`** → renders section panels from `app/components/sections/`. Each section component pulls state from context. Sections: `design`, `general`, `header`, `announcements`, `progressBar`, `couponSlider`, `upsellProducts`, `emptyCart`, `checkoutButton`, `customCSS`.
- **`CartPreview`** — right-side live preview, also reads from context.
- **Save flow** (`CartEditorPage.handleSave`): fires two parallel saves — a legacy blob to `POST /app/cartdrawer` and normalized saves to `/api/cart-drawer-config`, `/api/progress-bar`, `/api/coupon-slider-settings`, `/api/upsell-settings`.

The `cart_drawer_config` MySQL table is the canonical store for announcement, general, header, design, and empty cart fields (the newer normalized path). The legacy `cart_drawer` table (on the PHP backend MySQL) holds JSON blobs and is still written for backward compatibility.

Default state shape lives in `app/types/cartEditorTypes.js` (`defaultCartEditorState`).

### Combo Forge Bundle Builder (app/routes/app.bundles.customize.jsx)

A 7200+ line route that is the builder for combo/bundle pages. Key internals:
- `DEFAULT_COMBO_CONFIG` — all builder config defaults (search this object first when a config key is missing).
- `ProductCardItem` — renders each product card in the preview. Variants show when `hasVariants` (`product.variants.length > 1`). Quantity selector shows when `config.show_quantity_selector !== false`.
- Layout types: `layout1` (Guided Architect), `layout2` (Velocity Stream / tab-switcher), `layout4` (Editorial Split). Mapped from Shopify block names via `LAYOUT_MAP`.
- Templates are saved to MySQL via `prisma.$queryRawUnsafe` into `combo_templates`, and to the PHP backend via `sendToPhp`.

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

### Environment Variables

| Variable | Purpose |
|---|---|
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | Shopify app credentials |
| `DATABASE_URL` | Prisma MySQL connection string |
| `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME` | Direct MySQL pool (`db.server.js`) — defaults to `cart_drawer_ninja` |
| `OPENAI_API_KEY` | Holds the NVIDIA NIM key (`nvapi-...`) for all AI features |
| `SHOPIFY_APP_URL` | Public tunnel URL for embedded app |

### PHP Backend

`php_backend/` contains the server-side PHP scripts deployed at `https://int.thecomboforge.com`. They own:
- `save_cart_drawer.php` — writes to the legacy `cart_drawer` MySQL table
- `analytics.php`, `orders.php`, `clicks.php` — analytics aggregation
- `combo_save.php`, `combo_pages.php` — Combo Forge template persistence
- `ai_conversations.php`, `ai_messages.php` — AI chat history

`app/utils/api-helpers.js` is the Node.js client for all PHP endpoints. `BASE_PHP_URL` is set there. The `X-Forge-Secret` header (set to `SHOPIFY_API_KEY`) authenticates Node → PHP calls.
