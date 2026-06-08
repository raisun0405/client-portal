-- Migration 0003 (DOWN) — remove the client-level package feature entirely.
--
-- Returns the schema to its pre-package baseline. It does NOT restore the
-- superseded project-level 0002 columns (those were a wrong-model dead end).
--
-- ORDER: revert the app code FIRST, then run this. Data impact: drops package
-- data only (periods, migration audit, client package settings). All client /
-- project / feature data is untouched.

DROP TABLE IF EXISTS package_migrations;
DROP TABLE IF EXISTS billing_periods;

ALTER TABLE clients
  DROP COLUMN IF EXISTS billing_mode,
  DROP COLUMN IF EXISTS package_fee,
  DROP COLUMN IF EXISTS package_cadence,
  DROP COLUMN IF EXISTS package_status,
  DROP COLUMN IF EXISTS package_started_on,
  DROP COLUMN IF EXISTS package_anchor_day;
