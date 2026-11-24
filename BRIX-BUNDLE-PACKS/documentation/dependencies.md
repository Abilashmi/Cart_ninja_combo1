# Dependencies

## Shared files copied (`shared/`)
shopify.server, db.server (app + services), plans config, plan-permissions / plan-schema, currency, swr-cache, admin-graphql,
collection-members, billing, shop-integrations, webhook-queue, theme-embed, theme-extension config, scheduler, ai-llm (combo AI suggestions),
PlanContext, CurrencyContext, AppSaveBar, ColorField, LogoUploader, PlanGate, TourPointer, internal-auth, api-helpers,
php config / plan_helpers / internal_auth, `cart_drawer.liquid` (only its combo-page loader + Packs parts matter), package.json, shopify.app.toml.
Reference only (mixed with other modules, keep just the Bundle/Packs parts): `webhooks.orders.paid`, `webhooks.orders.cancelled`,
`webhooks.app_subscriptions_update`, `config/plans.js`, `scheduler.server.js`, `shopify.app.toml`, `cart_drawer.liquid`.

## Unavoidable dependencies NOT copied (need adapting)
| Missing import | Used by | Adaptation |
|---|---|---|
| `services/cod.server`, `utils/cod.shared` | builder (`app.bundles.customize`), QuickShopPreview, `codButtonLook`, combo-box-code | COD button/Shiprocket box code; replace with Combo Forge equivalents or remove the COD button |
| `components/ai-agent/BrixBar` | `app.bundles.customize`, `app.bundles._index` | AI prompt bar; drop the `<BrixBar />` mounts |
| `utils/partial-cod.shared.js` | `price-tags.shared.js` | COD price tags |
| `order-ingest`, `analytics-aggregator`, `billable-orders` services | order webhooks, scheduler | Order analytics; keep only the combo/pack bits of the webhooks |
| COD checkout reading Bundle/Packs rules (`cod.server` `packAdjustments`, `comboWeightAdjustments`) | stays in COD | Not part of this copy |
| `brix_cart_ui.css` / cart drawer pack card (`cart_drawer_inline.js` `ccPackCards`) | drawer shows packs as one card | Cart Drawer module, not copied |

## Database tables the code expects (no schema shipped)
- Packs: `brix_packs` (incl. `applies_json`, `applies_ids`, `applies_collection_ids`, extra-products and variant-scope columns), `brix_packs_shop_state`.
- Bundle: `combo_templates`, `combo_analytics`; read-only: store orders / plan tables.
- Plans: `shops` (plan, billing interval) via plan-permissions.
Map these onto Combo Forge's database layer; services call `db.server` directly.

## Shopify
Scopes used: read/write_discounts, read_products, read_themes, read/write_online_store_pages, read_orders. Functions need `api_version = 2026-07`
and `npm run deploy`; storefront data via App Proxy `/apps/cart-app/*`.
