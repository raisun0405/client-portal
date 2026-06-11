-- 0004_client_pinned (down)
-- Removes the pinned flag. Safe: the column is purely a UI convenience, no other
-- table references it.

ALTER TABLE clients DROP COLUMN IF EXISTS pinned;
