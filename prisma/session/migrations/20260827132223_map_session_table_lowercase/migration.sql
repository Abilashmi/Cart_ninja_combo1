-- Renames the Session table to lowercase `session` to match what
-- @shopify/shopify-app-session-storage-prisma's pollForTable() expects
-- (a case-sensitive raw check against SQLite's sqlite_master catalog).
-- SQLite disallows a same-name-different-case ALTER TABLE ... RENAME TO
-- directly, so this goes through an intermediate name.
ALTER TABLE "Session" RENAME TO "session_tmp_case_migration";
ALTER TABLE "session_tmp_case_migration" RENAME TO "session";
