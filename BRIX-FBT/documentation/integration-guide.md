# Integration guide (into Combo Forge)

1. Merge `fbt/` and `shared/` into the target project's tree. Paths already match (`app/...`, `extensions/...`, `php_backend/...`);
   where a `shared/` file already exists in the target, keep the target's and check the FBT imports still resolve.
2. Routes: add `app.fbt.jsx`, `api.fbt-settings.jsx`, `api.fbt-widget.jsx`, `api.pairing-assistant.jsx`, `api.product-search.jsx`,
   `save_fbt_widget[.]php.jsx` and the nav link to `/app/fbt`.
3. Database: create `fbt_widget_settings` and `fbt_rules` (see `dependencies.md`); optional columns heal themselves on first save.
4. PHP: upload `php_backend/fbt.php` and `save_fbt_widget.php`; point the App Proxy `/apps/cart-app/*` at them.
5. Extension: add the three assets, the `Fbt.liquid` / `FbtSection.liquid` blocks and the `fbt-widget-render.liquid` snippet to the theme app
   extension. Keep each Liquid file small (the extension's Liquid total may not pass 100 KB); the big script stays in `assets/`.
6. Function: add `extensions/brix-fbt-discount`, keep `api_version = "2026-07"`, then `npm run deploy`. The bundle offer only applies
   once the automatic discount shows `active` in the FBT page.
7. Remove or replace the `<BrixBar />` mount in `app.fbt.jsx` if the AI agent is not part of the target.
8. Run the tests from `fbt/tests/` in the target project (`node --import ./tests/packs/register.mjs --test tests/fbt-offer tests/pairing`,
   then the browser checks named in `fbt/documentation/fbt-notes.md`).

Not tried on a store: never claim the bundle offer applies at checkout until one order is seen on a dev store.
