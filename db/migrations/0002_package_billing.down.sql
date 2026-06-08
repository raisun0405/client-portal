-- Migration 0002 (DOWN) — revert monthly-package billing schema
--
-- PRE-REQUISITE: revert the application code FIRST (any phase that reads these
-- columns/tables), then run this. Order is always: revert code -> then drop.
--
-- Data impact: drops package data only (billing_periods rows, package_migrations
-- audit, and the per-project package_* / coverage settings). All original
-- per-feature project & feature data (amount, paid_amount, status, etc.) is
-- untouched, because migration 0002 never modified existing rows.
--
-- WARNING: if any project was already shifted onto a package and you want to
-- preserve its history, run the in-app "Undo migration" for those projects
-- BEFORE dropping (that replays package_migrations.before_state). Dropping here
-- discards the package tables outright.

DROP TRIGGER IF EXISTS trg_billing_periods_client_id ON billing_periods;
DROP FUNCTION IF EXISTS set_billing_period_client_id();

DROP TABLE IF EXISTS package_migrations;
DROP TABLE IF EXISTS billing_periods;

ALTER TABLE features
  DROP COLUMN IF EXISTS coverage;

ALTER TABLE projects
  DROP COLUMN IF EXISTS billing_mode,
  DROP COLUMN IF EXISTS package_fee,
  DROP COLUMN IF EXISTS package_cadence,
  DROP COLUMN IF EXISTS package_status,
  DROP COLUMN IF EXISTS package_started_on,
  DROP COLUMN IF EXISTS package_anchor_day;
