# The Cart Ninja — Setup Guide

A complete walkthrough to get this Shopify embedded app running from scratch on a new machine.

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | `>=20.19 <22` or `>=22.12` | App runtime |
| npm | latest | Package manager |
| PHP | 8.x | PHP backend (XAMPP recommended) |
| MySQL | 5.7+ / 8.x | Primary database |
| [Shopify CLI](https://shopify.dev/docs/apps/tools/cli) | v3+ | App dev server & deploy |
| [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/) | latest | App Proxy tunnel to PHP backend |

Install Shopify CLI globally if not already installed:

```bash
npm install -g @shopify/cli @shopify/theme
```

---

## 1. Clone & Install

```bash
git clone <repo-url> cartdrawerv2_ui
cd cartdrawerv2_ui
npm install
```

---

## 2. Shopify Partner Setup

1. Go to [partners.shopify.com](https://partners.shopify.com) and create (or open) an app.
2. Copy the **Client ID** and **Client Secret** from the app credentials page.
3. Link the local config to your Shopify app:

```bash
npx shopify app config link
```

This updates `shopify.app.toml` with your app's `client_id`.

---

## 3. Environment Variables

Create a `.env` file in the project root:

```env
# Shopify credentials
SHOPIFY_API_KEY=your_client_id_here
SHOPIFY_API_SECRET=your_client_secret_here
SHOPIFY_APP_URL=https://your-ngrok-or-tunnel-url

# Prisma / MySQL (Shopify sessions + combo templates)
DATABASE_URL=mysql://root:@127.0.0.1:3306/cart_drawer_ninja

# Direct MySQL pool (widget settings)
DB_HOST=127.0.0.1
DB_USER=root
DB_PASS=
DB_NAME=cart_drawer_ninja

# PHP backend base URL (local XAMPP or production)
PHP_BASE_URL=http://localhost/cartdrawerv2_ui/php_backend

# AI features — holds the NVIDIA NIM key (nvapi-...) or an OpenAI key
OPENAI_API_KEY=nvapi-xxxxxxxxxxxx
```

> **Windows Prisma issue:** If you get `query_engine-windows.dll.node` errors, also add:
> ```env
> PRISMA_CLIENT_ENGINE_TYPE=binary
> ```

---

## 4. MySQL Database Setup

### 4a. Create the database

Open your MySQL client (phpMyAdmin, MySQL Workbench, or CLI):

```sql
CREATE DATABASE IF NOT EXISTS cart_drawer_ninja CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 4b. Sync the Prisma schema

This creates all tables defined in `prisma/schema.prisma` (sessions, combo templates, widget settings, etc.):

```bash
npm run setup
# runs: prisma generate && prisma db push
```

### 4c. PHP backend tables

The PHP backend at `php_backend/` expects additional tables in the same `cart_drawer_ninja` database (`cart_drawer`, `combo_orders`, `ai_conversations`, `ai_messages`, `visitors`, `clicks`, etc.). These are created/managed by the PHP scripts themselves on first use. If you are migrating from another environment, export and import the MySQL dump from the source server.

---

## 5. PHP Backend Setup (XAMPP)

1. Place the project folder inside `C:\xampp\htdocs\` so it is accessible at `http://localhost/cartdrawerv2_ui/`.
2. Start **Apache** and **MySQL** from the XAMPP Control Panel.
3. Verify the PHP backend responds:

```
http://localhost/cartdrawerv2_ui/php_backend/templates.php
```

Should return `{"data":[]}` or similar JSON (not a PHP error).

---

## 6. App Proxy Tunnel (Cloudflare)

The Shopify App Proxy forwards storefront requests (cart drawer config, FBT widget, coupon slider) to your local PHP backend. This requires a public HTTPS tunnel pointing at `http://localhost`.

### 6a. Start the tunnel

```bash
cloudflared tunnel --url http://localhost
```

Copy the generated URL (e.g. `https://example-random.trycloudflare.com`).

### 6b. Update `shopify.app.toml`

```toml
[app_proxy]
url = "https://example-random.trycloudflare.com/cartdrawerv2_ui/php_backend/"
prefix = "apps"
subpath = "cart-app"
```

### 6c. Deploy the updated config to Shopify

```bash
npm run deploy
```

> The Cloudflare tunnel URL changes every time you restart `cloudflared`. Repeat steps 6a–6c each session, or use a named persistent tunnel.

---

## 7. Run the Dev Server

```bash
npm run dev
# alias for: shopify app dev
```

On first run, the Shopify CLI will:
- Open a browser for OAuth (install the app on a development store).
- Assign an `application_url` (usually an ngrok tunnel).

The CLI outputs the tunnel URL — copy it to `SHOPIFY_APP_URL` in `.env`.

> `automatically_update_urls_on_dev = false` is set in `shopify.app.toml`, so the redirect URLs in `[auth]` are **not** updated automatically. If you switch tunnel providers (ngrok ↔ Cloudflare), manually update the `redirect_urls` in `shopify.app.toml` and re-run `npm run deploy`.

---

## 8. Deploy Shopify Extension

The `extensions/cart-drawer/` Theme App Extension must be deployed to Shopify's CDN after any change to its Liquid/JS/CSS files or to `shopify.app.toml`:

```bash
npm run deploy
# alias for: shopify app deploy
```

After deploying, merchants must enable the **Cart Ninja** app block in their theme via the Shopify Theme Editor.

---

## 9. Build for Production

```bash
npm run build
npm run start
```

Or with Docker:

```bash
npm run docker-start
# runs: npm run setup && npm run start
```

---

## 10. Other Commands

```bash
npm run lint          # ESLint
npm run typecheck     # react-router typegen + tsc --noEmit
npm run setup         # prisma generate + prisma db push (run after schema changes)
```

---

## Architecture Quick Reference

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React Router v7 + Polaris | Shopify embedded admin UI |
| Sessions + combos | Prisma → MySQL | `cart_drawer_ninja` DB (managed by this app) |
| Widget settings | mysql2 pool → MySQL | Same DB, direct queries via `app/services/db.server.js` |
| PHP backend | PHP + MySQL | Legacy cart drawer, analytics, AI chat history |
| Storefront | Theme App Extension (Liquid) | Cart drawer, FBT widget, coupon slider on storefront |
| AI | NVIDIA NIM (or OpenAI) | CartNinja agent + BrixBar bundle builder AI |

### Two database connections in Node.js

- `app/db.server.js` — exports the **Prisma client** (sessions, combo templates, upsell rules)
- `app/services/db.server.js` — exports `getDb()`, a **mysql2 pool** (widget settings, cart drawer config)

Both point to the same `cart_drawer_ninja` MySQL database via different credentials/methods.

### App Proxy flow

```
Storefront JS → /apps/cart-app/save_*.php
    → Shopify App Proxy
    → cloudflared tunnel
    → http://localhost/cartdrawerv2_ui/php_backend/save_*.php
```

If widgets show nothing on the storefront, the proxy URL in `shopify.app.toml` is the first thing to check.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `query_engine-windows.dll.node` error | Add `PRISMA_CLIENT_ENGINE_TYPE=binary` to `.env` |
| Storefront widgets load nothing | Cloudflare tunnel URL has changed — restart `cloudflared`, update `app_proxy.url`, `npm run deploy` |
| Auth redirect fails | Update `[auth] redirect_urls` in `shopify.app.toml` with current tunnel URL, then `npm run deploy` |
| PHP backend returns 404 | Verify XAMPP Apache is running and path is `http://localhost/cartdrawerv2_ui/php_backend/` |
| Prisma table not found | Run `npm run setup` after any `schema.prisma` changes |
| AI returns no response | Check `OPENAI_API_KEY` — must be an `nvapi-*` key for NVIDIA NIM endpoint |
| Extension changes not live | Run `npm run deploy` — extension assets must be pushed to Shopify CDN |
