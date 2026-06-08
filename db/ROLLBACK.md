# Rollback Procedure — Code + Database

This project has **no automated migration tooling**; schema changes are run by
hand in the Supabase SQL editor. To keep every change reversible, each schema
change ships as a **paired** `NNNN_name.up.sql` / `NNNN_name.down.sql` in
[db/migrations/](migrations/), and the rules below define how to undo work
safely at both layers.

## Golden rules

1. **Code first, DB second.** When rolling back, revert the *application code*
   before running a `.down.sql`. The running code reads the new columns/tables;
   dropping them while that code is live breaks queries. Forward order is the
   reverse: run `.up.sql`, then deploy the code that uses it.
2. **Additive-only schema.** Every forward migration only ADDS columns/tables
   with safe defaults. Existing rows are never altered by a migration, so a
   `DROP COLUMN` / `DROP TABLE` rollback never touches pre-existing data.
3. **One migration = one paired file set.** Never edit an applied `.up.sql`;
   write a new migration instead.

## Git layout (code rollback)

| Ref | What it is |
|---|---|
| `main` @ `b452434` | Pristine deployed baseline — the ultimate "undo everything" point. |
| `feature/monthly-package` | Working branch. Each step is its own commit so it can be reverted in isolation. |

Code rollback options:

- **Undo a single step** — `git revert <commit>` (keeps history) or
  `git reset --hard <commit>` (discards) to the commit before it.
- **Undo everything** — `git checkout main`. Nothing on `main` has changed.

Commits so far on `feature/monthly-package`:

| Commit | Step | DB change | Rollback |
|---|---|---|---|
| `90b3919` | Auto-derived project status | `0001` (status_override) | `git revert 90b3919` → then `0001_status_override.down.sql` |

## Database rollback (per migration)

| Migration | Forward | Reverse | Data lost on revert |
|---|---|---|---|
| `0001_status_override` | adds `projects.status_override` | `0001_status_override.down.sql` | only On Hold / Cancelled overrides; nothing else |
| `0002_package_billing` *(applied, then SUPERSEDED by 0003)* | put the package on `projects` + `features.coverage` (wrong model — package is per-client) | `0002_package_billing.down.sql` | n/a — 0003 cleans this up; do not run 0002 separately |
| `0003_client_package_billing` *(APPLIED 2026-06-09)* | moves the package to `clients`, drops `features.coverage` + project package columns, rebuilds `billing_periods` / `package_migrations` keyed on `client_id` | `0003_client_package_billing.down.sql` | package data only; client/project/feature data untouched |

> **0002 vs 0003:** 0002 was applied but the model was wrong (package is per-**client**, not per-project). 0003 supersedes it: its `.up` idempotently drops everything 0002 added and builds the correct client-level schema. Run **0003 up** (not 0002 down) — but only after the matching app code is deployed.

### To revert migration 0001 fully
1. Revert the code: `git revert 90b3919` (or check out `main`).
2. Run [db/migrations/0001_status_override.down.sql](migrations/0001_status_override.down.sql) in Supabase.

## Monthly-package phases (planned — not yet applied)

When the package feature is built (see [MONTHLY_PACKAGE_PLAN.md](../MONTHLY_PACKAGE_PLAN.md)),
each phase that touches the DB will add a new paired migration here (`0002+`).
Two extra reversibility guarantees from the plan apply there:

- **Schema** is all-additive (`billing_mode`, `package_*`, `coverage`, and the
  `billing_periods` / `package_migrations` tables), so a phase's DB rollback is
  just its `.down.sql` (drop the new columns/tables) with zero impact on
  existing per-feature projects.
- **Data operations** (shifting a project onto a package) are themselves
  reversible at the row level via `package_migrations.before_state` — an "Undo
  migration" action replays the saved prior state. That is separate from, and
  finer-grained than, the schema rollback here.
