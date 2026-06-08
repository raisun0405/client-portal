-- Migration 0003 (UP) — move the package model from PROJECT-level to CLIENT-level.
--
-- A package is a per-CLIENT monthly retainer covering ALL of that client's
-- projects. The fee covers everything, so there is NO per-feature 'coverage'
-- concept. This supersedes 0002 (which put the package on projects).
--
-- Status: NOT YET APPLIED.
-- ORDER: deploy the matching client-level app code FIRST (it must stop writing
-- features.coverage and projects.billing_mode before those columns are dropped),
-- then run this. Safe otherwise: no package data exists yet.

-- 1. Remove the project-level package columns from 0002 (unused).
ALTER TABLE projects
  DROP COLUMN IF EXISTS billing_mode,
  DROP COLUMN IF EXISTS package_fee,
  DROP COLUMN IF EXISTS package_cadence,
  DROP COLUMN IF EXISTS package_status,
  DROP COLUMN IF EXISTS package_started_on,
  DROP COLUMN IF EXISTS package_anchor_day;

-- 2. Remove the per-feature coverage flag (the retainer covers everything).
ALTER TABLE features DROP COLUMN IF EXISTS coverage;

-- 3. The package contract now lives on the client.
ALTER TABLE clients
  ADD COLUMN billing_mode       text NOT NULL DEFAULT 'per_feature'
    CHECK (billing_mode IN ('per_feature','package')),
  ADD COLUMN package_fee        numeric NOT NULL DEFAULT 0,
  ADD COLUMN package_cadence    text NOT NULL DEFAULT 'monthly'
    CHECK (package_cadence IN ('monthly','quarterly','annual')),
  ADD COLUMN package_status     text NOT NULL DEFAULT 'active'
    CHECK (package_status IN ('active','paused','ended')),
  ADD COLUMN package_started_on date,
  ADD COLUMN package_anchor_day int
    CHECK (package_anchor_day BETWEEN 1 AND 31);

-- 4. Rebuild the package tables keyed on CLIENT (drop the project-based 0002 ones).
DROP TRIGGER IF EXISTS trg_billing_periods_client_id ON billing_periods;
DROP FUNCTION IF EXISTS set_billing_period_client_id();
DROP TABLE IF EXISTS package_migrations;
DROP TABLE IF EXISTS billing_periods;

-- One row per month per client. The client's whole monthly bill.
CREATE TABLE billing_periods (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_start   date NOT NULL,
  period_end     date NOT NULL,
  fee_amount     numeric NOT NULL DEFAULT 0,          -- snapshot of package_fee at creation
  paid_amount    numeric NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'Pending' CHECK (payment_status IN ('Paid','Partial','Pending')),
  origin         text NOT NULL DEFAULT 'auto' CHECK (origin IN ('auto','manual')),
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_billing_periods_client_start ON billing_periods(client_id, period_start);

-- Reversible record of a per-feature -> package shift, per client.
CREATE TABLE package_migrations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status               text NOT NULL DEFAULT 'committed' CHECK (status IN ('committed','reverted')),
  pending_disposition  text NOT NULL DEFAULT 'writeoff' CHECK (pending_disposition IN ('writeoff','settle','roll_into_first','keep_one_time')),
  pending_snapshot     numeric NOT NULL DEFAULT 0,
  affected_feature_ids uuid[] NOT NULL DEFAULT '{}',
  before_state         jsonb NOT NULL,
  performed_at         timestamptz NOT NULL DEFAULT now(),
  reverted_at          timestamptz
);
CREATE INDEX idx_package_migrations_client ON package_migrations(client_id, performed_at DESC);
