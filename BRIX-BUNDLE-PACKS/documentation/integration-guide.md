# Integration guide (for later)
1. Merge each module's folders back into one `app/` / `extensions/` / `php_backend/` tree (paths are preserved).
2. Provide the `shared/` pieces (or point imports at Combo Forge's own equivalents): shopify.server, db layer, plans, currency, contexts.
3. Resolve the table in `dependencies.md` (COD, BrixBar, analytics): remove or replace those imports.
4. Create the tables in Combo Forge's database (schemas intentionally not included).
5. Register the two Functions (`shopify-functions/`), the Packs blocks and `combo-page.js` loader in the theme extension; run `npm run deploy` yourself.
6. Port the tests (`*/tests`): run from the original project layout (`node --import ./tests/packs/register.mjs --test ...`).
