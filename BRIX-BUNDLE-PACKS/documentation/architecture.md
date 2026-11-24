# Architecture

## Bundle (Combo Forge)
- Admin: `app.bundles.*` routes (dashboard, templates, customize builder, plan, analytics); builder sections in `components/customization/`.
- Storefront: `combo-page[.]js.jsx` serves `combo-page.js`, loaded by the app embed (`shared/dependencies/.../cart_drawer.liquid`); draws layout1-7 itself.
- Pricing: `utils/combo-weight.shared.js` (one copy of the rules, ES5, injected into the storefront script and used by the checkout Function), `combo-quickshop.shared.js` (box design kit), `combo-loader.shared.js`, `combo-align.shared.js`, `combo-design.shared.js`.
- Server: `services/combo-*.server.js`, API routes `api.bundle-*`, `api.combo-*`, PHP `combo_save.php` / `combo_pages.php`.
- Checkout: Shopify Function `shopify-functions/brix-combo-weight-discount` (trusts only the app metafield `$app:combo_weight_config`).

## Packs
- Admin: `app.packs.*` routes, `components/packs/` (PackBuilder, PackPreview, usePackDraft).
- Storefront: `assets/packs_widget.js` + `Packs.liquid` / `packs_position.liquid` blocks; data from `php_backend/packs_storefront.php` (also `api.packs-storefront.jsx`).
- Rules: `utils/packs.shared.js`, `utils/packs-discount.shared.js` (shared by the Function).
- Server: `services/packs*.server.js`, `api.packs.jsx`.
- Checkout: Function `shopify-functions/brix-packs-discount` (`$app:packs_config`, input variables `$app:packs_vars`).

The two modules do not import each other.
