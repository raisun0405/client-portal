-- Migration 0001 (UP) — auto-derived project status
--
-- Adds the optional manual override used by the project-status automation.
-- Status itself is DERIVED in code (lib/projectStatus.ts); this column only
-- holds 'On Hold' / 'Cancelled' overrides. NULL = follow feature progress.
--
-- Safety: additive + nullable, no default needed. Existing rows are unaffected
-- and keep working immediately (a NULL override means "derive from features").
--
-- Status: APPLIED (run by the project owner in Supabase, 2026-06-08).

ALTER TABLE projects
  ADD COLUMN status_override text
    CHECK (status_override IN ('On Hold','Cancelled'));
