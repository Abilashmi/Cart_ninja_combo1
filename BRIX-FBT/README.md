# BRIX-FBT

Copy of the **FBT (Frequently Bought Together)** module from BRIX Convert, for later integration into Combo Forge.
Created by copying only; no original file was moved or changed.

- `fbt/`: the module's UI and functionality. Files keep their original paths (e.g. `app/routes/...`) inside each
  folder, so relative imports still resolve once the folders are merged back into one `app/` tree.
- `shared/`: the generic pieces the FBT files import (plans, Shopify auth, db helpers, contexts, pickers, colour and
  slider fields, the AI credit and LLM helpers, ...).
- No database schema or migration files are included on purpose. See `documentation/dependencies.md` for the tables the code expects.
- Not integrated into Combo Forge. Not runnable on its own (no build); tests were run in the original project.
- `.copied-files.txt`: the exact list of files copied.

Docs: `documentation/architecture.md`, `dependencies.md`, `integration-guide.md`, and the full FBT notes from
the project guide in `fbt/documentation/fbt-notes.md`.
