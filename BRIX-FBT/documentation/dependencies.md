# Dependencies

## Shared files copied (`shared/`)
shopify.server, db.server (app + services), plans config, plan-permissions / plan-schema, ai-credits, ai-llm (AI pairing and instructions),
analytics-schema (past-order pairs), cart-config-writes (mixed with the cart drawer; keep `saveFbtWidgetSettings`), PlanContext,
CurrencyContext, PlanGate, AppSaveBar, ColorField, SliderField, ProductPickerBody (+ `api.product-search.jsx`), `ContentSection`
(only `HEADING_FONT_OPTIONS` is used), color.shared, with-timeout, api-helpers, internal-auth, product-sample validator,
php `internal_auth.php` / `plan_helpers.php`, package.json, shopify.app.toml (committed version).
Reference only (mixed with other modules): `cart-config-writes.server.js`, `config/plans.js`, `shopify.app.toml`, `ContentSection.jsx`.

## Unavoidable dependencies NOT copied (need adapting)
| Missing | Used by | Adaptation |
|---|---|---|
| `components/ai-agent/BrixBar` (copied for reference; it pulls in the whole AI agent) | `app.fbt.jsx` | Drop the `<BrixBar />` mount, or bring the AI agent along |
| AI agent FBT tools (`ai-agent-tools.server.js`, `ai-tool-schemas.js`, `ai-module-routes.js`) | BrixBar | Not part of this copy |
| `app/i18n/en.json` + `locales/*.json` (FBT texts are mixed in) | widget `bxT(...)` calls, admin | The widget falls back to the English written at each call site |
| `price-display.server.js` / `window.__brixWholePrices` | widget `money()` | "Hide decimals in prices" store setting; optional |
| `app.productwidget.jsx`, `product-widget.shared.js` | Coupon Banner page shares the widget area | Not FBT |
| App embed `cart_drawer.liquid` / Home status / billing pages that mention FBT | module toggles, plan names | Keep only the FBT parts |

## Database tables the code expects (no schema shipped)
- `fbt_widget_settings` (incl. `offer_enabled`, `offer_type`, `offer_value`, `offer_text`, `offer_min_items`, `offer_create_discount`,
  `offer_state`, `offer_message`, `ai_instructions`, `ai_instruction_rules`), `fbt_rules` (incl. `offer_mode`, `offer_value`, `backup_products`).
  The code creates missing columns itself (`ensureFbtOfferColumns` and the other self-healing helpers).
- Plans: `shops` via plan-permissions. Past-order pairs read `store_order_line_items` (webhook-recorded orders).
Map these onto Combo Forge's database layer; services call `db.server` directly.

## Shopify
Scopes used: read/write_discounts (the automatic discount), read_products, read_orders (past-order pairs). The Function needs
`api_version = 2026-07` and `npm run deploy`; storefront data via App Proxy `/apps/cart-app/*`.
