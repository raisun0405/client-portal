-- 0005_client_connector (down)
-- Removes the client Claude connector's storage. Run only AFTER the code that
-- uses it has been reverted (db/ROLLBACK.md, rule 1).
-- Lost on revert: which clients had Claude access switched on, and every
-- connector sign-in (connected Claudes stop working). No client, project,
-- feature, payment or activity data is touched.

DROP TABLE IF EXISTS connector_signin_attempts;
DROP TABLE IF EXISTS connector_tokens;
DROP TABLE IF EXISTS connector_auth_codes;
DROP TABLE IF EXISTS connector_oauth_clients;
ALTER TABLE clients DROP COLUMN IF EXISTS claude_epoch;
ALTER TABLE clients DROP COLUMN IF EXISTS claude_access;
