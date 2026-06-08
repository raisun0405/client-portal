-- Migration 0002 (UP) — monthly-package billing schema
--
-- Status: NOT YET APPLIED. Review, then run in the Supabase SQL editor.
--
-- 100% additive. Every existing per-feature project keeps working byte-for-byte
-- because every new column has a default reproducing today's behavior
-- (billing_mode='per_feature', coverage='extra'). No existing row is modified.
--
-- NOTE on legacy columns: projects.total_amount and projects.payment_status
-- exist in the live schema but are unused by the app (verified: zero code
-- references). This migration deliberately leaves them untouched.

-- 1. projects: the recurring-package contract lives on the project row.
ALTER TABLE projects
  ADD COLUMN billing_mode       text NOT NULL DEFAULT 'per_feature'
    CHECK (billing_mode IN ('per_feature','package')),
  ADD COLUMN package_fee        numeric NOT NULL DEFAULT 0,
  ADD COLUMN package_cadence    text NOT NULL DEFAULT 'monthly'
    CHECK (package_cadence IN ('monthly','quarterly','annual')),
  ADD COLUMN package_status     text NOT NULL DEFAULT 'active'
    CHECK (package_status IN ('active','paused','ended')),
  ADD COLUMN package_started_on date,
  ADD COLUMN package_anchor_day int
    CHECK (package_anchor_day BETWEEN 1 AND 28);

-- 2. features: coverage flag. Default 'extra' = bills exactly as today.
--    Ignored entirely on per-feature projects.
ALTER TABLE features
  ADD COLUMN coverage text NOT NULL DEFAULT 'extra'
    CHECK (coverage IN ('included','extra'));

-- 3. billing_periods: one row per monthly invoice. Mirrors the feature money
--    shape so the admin reuses the same manual "record payment" flow.
CREATE TABLE billing_periods (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  client_id      uuid NOT NULL,                       -- denormalized; set by trigger from projects.client_id
  period_start   date NOT NULL,
  period_end     date NOT NULL,
  fee_amount     numeric NOT NULL DEFAULT 0,          -- snapshot of package_fee at creation
  paid_amount    numeric NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'Pending'
    CHECK (payment_status IN ('Paid','Partial','Pending')),
  origin         text NOT NULL DEFAULT 'auto'         -- 'auto' = system-materialized, 'manual' = admin-authored
    CHECK (origin IN ('auto','manual')),
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_billing_periods_proj_start ON billing_periods(project_id, period_start);
CREATE INDEX idx_billing_periods_client ON billing_periods(client_id);

-- Keep billing_periods.client_id correct no matter how a row is written.
CREATE OR REPLACE FUNCTION set_billing_period_client_id()
RETURNS trigger AS $$
BEGIN
  SELECT client_id INTO NEW.client_id FROM projects WHERE id = NEW.project_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_billing_periods_client_id
  BEFORE INSERT OR UPDATE OF project_id ON billing_periods
  FOR EACH ROW EXECUTE FUNCTION set_billing_period_client_id();

-- 4. package_migrations: auditable + reversible record of a per-feature ->
--    package shift. before_state jsonb is the undo buffer.
--    NOTE: readable by the anon key (no RLS in this app) -> store nothing
--    client-invisible here. Default disposition chosen for the product: writeoff.
CREATE TABLE package_migrations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status               text NOT NULL DEFAULT 'committed'
    CHECK (status IN ('committed','reverted')),
  pending_disposition  text NOT NULL DEFAULT 'writeoff'
    CHECK (pending_disposition IN ('writeoff','settle','roll_into_first','keep_one_time')),
  pending_snapshot     numeric NOT NULL DEFAULT 0,
  affected_feature_ids uuid[] NOT NULL DEFAULT '{}',
  before_state         jsonb NOT NULL,
  performed_at         timestamptz NOT NULL DEFAULT now(),
  reverted_at          timestamptz
);
CREATE INDEX idx_package_migrations_project ON package_migrations(project_id, performed_at DESC);
