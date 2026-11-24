# BRIX-BUNDLE-PACKS

Copy of the **Bundle** (Combo Forge builder, box templates, combo pages) and **Packs** modules from BRIX Convert,
for later integration into Combo Forge. Created by copying only; no original file was moved or changed.

- `bundle/` and `packs/`: each module's UI and functionality. Files keep their original paths (e.g. `app/routes/...`)
  inside each category folder, so relative imports still resolve once the folders are merged back into one `app/` tree.
- `shared/`: the generic pieces both modules import (plans, Shopify auth, db helper, currency, contexts, ...).
- No database schema or migration files are included on purpose. See `documentation/dependencies.md` for the tables the code expects.
- Not integrated into Combo Forge. Not runnable on its own (no package.json deps / build); tests were run in the original project.

Docs: `documentation/architecture.md`, `dependencies.md`, `integration-guide.md`.
