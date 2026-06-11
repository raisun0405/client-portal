-- 0004_client_pinned (up)
-- Adds a per-client "pinned" flag so the admin can pin important clients to the
-- top of the directory regardless of the active sort/filter. Additive + defaulted,
-- so existing rows are unaffected (all default to false).

ALTER TABLE clients ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
