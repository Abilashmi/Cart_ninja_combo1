-- BRIX Packs: one Pack used on more products and collections (appliesTo).
-- The app adds these columns itself the first time such a Pack is saved
-- (app/services/packs.server.js ensureAppliesColumns); this file is the same
-- change for running by hand. Safe to run more than once.
ALTER TABLE brix_packs
  ADD COLUMN IF NOT EXISTS applies_json LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS applies_ids TEXT NULL,
  ADD COLUMN IF NOT EXISTS applies_collection_ids VARCHAR(2000) NULL;
