-- Migration 0001 (DOWN) — revert auto-derived project status
--
-- PRE-REQUISITE: revert the APPLICATION CODE FIRST (e.g. `git revert 90b3919`
-- or check out a ref before it), because the running code reads
-- `status_override`. Dropping the column while that code is live will break
-- project queries. Order is always: revert code -> then run this.
--
-- Data impact: only the override values (On Hold / Cancelled) are lost.
-- The `status` text column and ALL other project/feature data are untouched.

ALTER TABLE projects
  DROP COLUMN IF EXISTS status_override;
