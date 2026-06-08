# Monthly-Package Billing - Implementation Plan

> **Status:** PLANNING - not yet implemented. No application code has been changed.  
> **Generated:** 2026-06-08 from a multi-agent deep-research workflow (run wf_798280a2-596).  
> **Foundation verified:** tables (clients, projects, features, activity_logs) and fields (amount, paid_amount, payment_confirmed, status) confirmed against the live codebase.  
> **Caveat:** 3 of 4 automated readers crashed mid-run; the plan was reconciled by direct code reading. Run the Section 0 live-schema audit BEFORE the Section 2 DDL.

> **OPEN DECISION (choose before implementing):** the default pending-disposition when shifting an existing project onto a package - writeoff / settle / roll_into_first / keep_one_time.

---

# Implementation Plan: Monthly-Package Billing for the Client Portal

## 0. Pre-flight: Verify the security model and the live schema before writing any code

Two assumptions in the prior draft were wrong and are corrected throughout. **The developer must internalize these before reading the rest:**

1. **There is no Supabase Auth and no service-role key.** Clients log in via a custom `access_key` lookup against the `clients` table (`app/actions.ts`), and the browser holds the **anon key** (`lib/supabase.ts`). Both `supabase` and `supabaseAdmin` are constructed from the *same anon key* (`lib/supabase.ts`, `lib/notifications.ts`). There is no `auth.uid()` for a client. Consequently **RLS-based isolation is not available** and per-client safety is enforced only by manual `.eq('client_id', …)` filters against effectively-permissive tables. Any new table is, in practice, readable by any browser that holds the anon key. This single fact drives the security decisions in §2.

2. **No SQL migration files exist in the repo** (`**/*.sql` → none); schema lives directly in Supabase, and three of four ground-truth readers (`admin-billing`, `schema-sweep`, `product-conventions`) returned no findings. The brief is therefore the *only* schema reference and is unaudited. **Action (blocking, before Phase 1):** dump the live schema and confirm the brief's columns exist before running additive DDL:

   ```sql
   select table_name, column_name, data_type, column_default, is_nullable
   from information_schema.columns
   where table_name in ('projects','features','activity_logs','clients')
   order by table_name, ordinal_position;
   ```
   Reconcile the output against the brief's `projects`/`features`/`activity_logs` column lists. Only then run the DDL in §2.

A note on **function names**: the realtime handlers call `fetchProjectsForClient` / `loadActivityLogsForClient` (`app/dashboard/page.tsx` realtime block), while the brief narrates them as `fetchProjects` / `fetchActivityLogs`. Wherever this plan says "fetchProjects," the developer must edit the **actual call sites** (`fetchProjectsForClient`, etc.), not the brief's narrative names. Same caution for `fetchActivityLogs` vs `loadActivityLogsForClient`.

---

## 1. Recommendation (one paragraph)

**Adopt the Hybrid Pragmatic approach ("Package-on-Project + Coverage-Tagged Features") with a real `billing_periods` table for monthly records, plus a lazy missing-period materializer — but NO `invoices`/`invoice_line_items`/`subscriptions` triad.** For *this* codebase — a ~5k-line solo-dev Next.js + Supabase portal where payments are logged manually (`features.paid_amount` + `activity_logs` of `action_type='payment_received'`), there is no payment processor, no cron, no service-role key, and the money math is hand-rolled `reduce()` blocks duplicated across `app/dashboard/page.tsx:190-207`, `app/admin/dashboard/page.tsx:179-182` and `:239-241` — the First-Class Subscriptions design (3 new tables + RLS + cron rollover) is over-built **and inoperable** here (RLS can't isolate clients without auth; cron doesn't exist). Conversely, the Two-Flag "synthetic feature row" design is too clever: overloading `features` with an `is_package_line` row destroys per-month history, pollutes the no-filter realtime `features` subscription, and muddies the `progress` denominator at `page.tsx:197`. The Hybrid wins because it keeps the recurring contract as plain columns on `projects` (no join to render the package header), tracks each month as a truthful `billing_periods` row that reuses the *exact* `amount`/`paid_amount`/`payment_status` vocabulary and the existing manual "record payment" UX, and makes the pending-balance migration a first-class, **reversible** `package_migrations` record (with a `before_state` jsonb undo buffer) because feature rows are only flag-updated, never destroyed. Crucially, because there is no working RLS, **`package_migrations` and `billing_periods` must be designed as client-readable** (no client-invisible secrets stored), and the silent-revenue-loss risk of a manual subscription is closed by a **lazy "missing periods" detector** computed on read. Every change is additive with safe defaults (`billing_mode='per_feature'`, `coverage='extra'`), so every existing project is byte-identical on day one.

---

## 2. Data Model Changes

All changes are additive. Existing per-feature projects need **zero backfill** because every new column has a default that reproduces today's behavior. (Run only after the §0 schema audit confirms the base columns.)

### Columns on `projects`
| Column | Type | Default | Purpose |
|---|---|---|---|
| `billing_mode` | `text` | `'per_feature'` | Discriminator: `'per_feature'` \| `'package'`. Read by `fetchProjectsForClient` and both admin stat blocks. |
| `package_fee` | `numeric` | `0` | Monthly amount in ₹ (same units as `features.amount`; no currency field — ₹ stays hard-coded). Source of "Monthly Fee" / "next charge" labels. |
| `package_cadence` | `text` | `'monthly'` | Future-proofs quarterly/annual. v1 only emits `'monthly'`. |
| `package_status` | `text` | `'active'` | `'active'` \| `'paused'` \| `'ended'`. Paused/ended stops new `billing_periods` accrual (and stops the lazy materializer in §3i). |
| `package_started_on` | `date` | `NULL` | When the package began (used for the first period and missing-period detection). |
| `package_anchor_day` | `int` | `NULL` | 1–28, day the period rolls. `NULL` ⇒ derive from `package_started_on`. **Capped at 28 to dodge month-length edge cases; this means a client onboarded on the 29th–31st bills on the anchor day, drifting earlier — documented limitation, see §11.** |

### Columns on `features`
| Column | Type | Default | Purpose |
|---|---|---|---|
| `coverage` | `text` | `'extra'` | `'included'` (covered by `package_fee`, excluded from separate money sums) \| `'extra'` (billed on top). **Ignored** on per-feature projects. Default `'extra'` is the revenue-safe default. Orthogonal to `is_new_request` (which stays a cosmetic Core/Extra badge). |

### New table `billing_periods`
One row = one month's invoice. Mirrors the `features` money shape so the admin reuses the same manual "record payment" input and the client reuses the same Paid/Partial/Pending badge logic (`page.tsx:1324-1329`). Carries an `origin` column so revert can distinguish system-generated empty periods from admin-authored ones.

### New table `package_migrations`
The auditable, reversible record of a per-feature → package shift. `before_state` jsonb is the undo buffer. **Security caveat (see §0): this table is readable by the anon key, i.e. by any logged-in client browser. It must contain no information we are unwilling to show the client.** Write-off/settle/carryover decisions and prior pending are *already surfaced to the client* via activity logs and the post-migration dashboard, so storing them here leaks nothing new — but the developer must not add private admin notes, margins, or internal pricing to this table.

### SQL DDL

```sql
-- 1. projects: package contract lives on the project row (no join to render header)
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

-- 2. features: coverage flag. Default 'extra' = safe, bills as today.
ALTER TABLE features
  ADD COLUMN coverage text NOT NULL DEFAULT 'extra'
    CHECK (coverage IN ('included','extra'));

-- 3. billing_periods: one row per monthly invoice. Reuses features' money vocabulary.
CREATE TABLE billing_periods (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  client_id      uuid NOT NULL,                       -- denormalized; set from projects.client_id only (never client input)
  period_start   date NOT NULL,
  period_end     date NOT NULL,
  fee_amount     numeric NOT NULL DEFAULT 0,          -- SNAPSHOT of package_fee at creation
  paid_amount    numeric NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'Pending'
    CHECK (payment_status IN ('Paid','Partial','Pending')),
  origin         text NOT NULL DEFAULT 'auto'         -- 'auto' = system-materialized; 'manual' = admin-authored
    CHECK (origin IN ('auto','manual')),
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_billing_periods_proj_start ON billing_periods(project_id, period_start);
CREATE INDEX idx_billing_periods_client  ON billing_periods(client_id);

-- 4. package_migrations: auditable + reversible shift record. NOTE: client-readable (anon key); no secrets.
CREATE TABLE package_migrations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'previewed'
    CHECK (status IN ('previewed','committed','reverted')),
  pending_disposition text NOT NULL
    CHECK (pending_disposition IN ('writeoff','settle','roll_into_first','keep_one_time')),
  pending_snapshot    numeric NOT NULL DEFAULT 0,     -- total - paid over CONFIRMED features at migration time
  affected_feature_ids uuid[] NOT NULL DEFAULT '{}',
  before_state        jsonb NOT NULL,                  -- undo buffer (see §5)
  performed_at        timestamptz NOT NULL DEFAULT now(),
  reverted_at         timestamptz
);
CREATE INDEX idx_package_migrations_project ON package_migrations(project_id, performed_at DESC);
```

The `UNIQUE` index on `(project_id, period_start)` is load-bearing: it lets the lazy materializer (§3i) use idempotent upserts so concurrent reads can never create duplicate months.

### Security / realtime (corrected — no RLS dependency)
- **There is no working RLS in this app** (§0). Do **not** write the plan around `auth.uid()` SELECT policies. Client isolation continues to rely on explicit `.eq('client_id', …)` filters in queries, exactly as the existing tables do.
- `billing_periods` carries a denormalized `client_id` **set exclusively from `projects.client_id` inside the server/RPC write path — never from client-supplied input.** The client realtime subscription adds a `billing_periods` channel filtered by `client_id` (mirroring the `activity_logs` channel at `page.tsx:154`); if `client_id` were ever inconsistent, the realtime filter would silently drop events, so the single-source-of-truth write rule is mandatory. Enforce with a DB trigger that sets `client_id := (select client_id from projects where id = new.project_id)` on insert/update, so even a hand-written insert can't desync it.
- `package_migrations` is **admin-facing only at the UI level**, but is *technically readable by the anon key*. It is therefore designed to hold nothing client-invisible (see table note). If true confidentiality is ever required, it must wait for a real service-role path + RLS (out of scope for v1; flagged in §11).
- No `activity_logs` schema change. New `ActivityAction` members are TypeScript-only additions in `lib/activityLogger.ts:3-17` (`action_type` is free `text` in the DB).

---

## 3. Billing Logic Changes

Core principle: **money sums become coverage-aware ONLY when `billing_mode === 'package'`, then fold in the `billing_periods` legs.** Per-feature projects fall through to today's code verbatim. There are **four mirrored stat blocks** that must change identically — extract a shared helper first (§10 Phase 0) so the package logic is written once.

**Decision that resolves the prior §3-vs-§11 contradiction (must-fix #2):** for a package project, the headline `total/paid/pending` fold in **all `billing_periods` rows that are due as of today** (i.e. already materialized for elapsed/current months), *not* future months. "Pending" therefore equals *unpaid arrears + the current period* — a real, collectable number — and never includes months that haven't started. Future months are surfaced only as "Next charge on …", never as debt. §3a and §3i below implement exactly this; there is no longer any place that sums not-yet-due periods into the headline.

### 3a. Client per-project stats — `app/dashboard/page.tsx:190-194`
Today (`:192-194`):
```js
const confirmedFeatures = projectFeatures.filter(f => f.payment_confirmed !== false);
const total = confirmedFeatures.reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
const paid  = confirmedFeatures.reduce((sum, f) => sum + (Number(f.paid_amount) || 0), 0);
```
New (in the shared helper):
```js
const confirmedFeatures = projectFeatures.filter(f => f.payment_confirmed !== false);
// coverage gate: on a package project, 'included' features contribute 0 to separate charges
const billable = project.billing_mode === 'package'
  ? confirmedFeatures.filter(f => f.coverage !== 'included')
  : confirmedFeatures;
const featureTotal = billable.reduce((s, f) => s + (Number(f.amount) || 0), 0);
const featurePaid  = billable.reduce((s, f) => s + (Number(f.paid_amount) || 0), 0);

// package leg: ONLY periods that are due as of today (period_start <= today). Future months excluded.
const duePeriods = project.billing_mode === 'package'
  ? (billingPeriodsByProject[project.id] || []).filter(p => p.period_start <= today)
  : [];
const periodTotal = duePeriods.reduce((s, p) => s + (Number(p.fee_amount) || 0), 0);
const periodPaid  = duePeriods.reduce((s, p) => s + (Number(p.paid_amount) || 0), 0);

const total = featureTotal + periodTotal;          // arrears + current period only
const paid  = featurePaid  + periodPaid;
```
Because only **due** periods are summed, `pending = total − paid` (`:207`, unchanged) is exactly "unpaid extras + unpaid arrears + current period" — finite and collectable, consistent with §11.

### 3b. Client per-project `pending` + stats object — `app/dashboard/page.tsx:204-210`
`pending: total - paid` unchanged (`:207`). **Add** package-only stats the UI reads:
```js
stats.monthlyFee     = project.package_fee;
stats.currentPeriod  = duePeriods.find(p => p.period_start <= today && today <= p.period_end) || null;
stats.nextChargeOn   = nextAnchorDate(project, today);   // computed from anchor/cadence, not a stored row
stats.includedCount  = projectFeatures.filter(f => f.coverage === 'included').length;
stats.extraCount     = projectFeatures.filter(f => f.coverage === 'extra').length;
stats.missingPeriods = missingDuePeriods(project, billingPeriodsByProject[project.id], today); // §3i
```
Existing consumers of `stats.total/paid/pending` keep working.

### 3c. Client progress denominator — `app/dashboard/page.tsx:197-199`
**No change.** Progress is completion-based and uses ALL `projectFeatures` (brief note 3). Included features still count toward delivery progress — correct, since `coverage` is purely financial. No synthetic feature row exists in this design, so there is nothing to exclude.

### 3d. Client aggregate dashboard math — `app/dashboard/page.tsx:672-678`
**No formula change.** `totalInvestment`/`totalPaid`/`totalPending` (`:672-674`) reduce over `project.stats.total/paid/pending`, which now fold in *due* package fees only. Donut (`:681-685`), `paymentPercent` (`:678`) work automatically and — because future months are excluded — pending does not grow without bound.

### 3e. Admin per-client aggregate — `app/admin/dashboard/page.tsx:179-182`
The bulk feature fetch (`:158`, `select('project_id, amount, paid_amount, status, payment_confirmed')`) **must add `coverage`**, and the parent project's `billing_mode` must be available (carry it from the projects fetch and join in memory by `project_id`). Add a parallel `billing_periods` fetch keyed by the same project ids. The sum block (`:179-182`):
```js
const isConfirmed = f.payment_confirmed !== false;
if (isConfirmed) { totalValue += Number(f.amount)||0; paidValue += Number(f.paid_amount)||0; }
```
New: skip `f.coverage === 'included'` when the parent project is `billing_mode === 'package'`, then add each project's **due** `billing_periods` `fee_amount`/`paid_amount` into `totalValue`/`paidValue` (same `period_start <= today` gate as §3a).

### 3f. Admin per-project stats — `app/admin/dashboard/page.tsx:239-241`
Identical edit to §3a via the shared helper (same coverage gate, same due-period gate).

### 3g. Admin project-detail summary — `app/admin/dashboard/page.tsx:2007-2011` (corrected: this is NOT a clean parallel edit)
**Important correction (must-fix #5):** the detail summary at `:2007-2008` sums over **all** features with **no `payment_confirmed` filter**, whereas the client (`:192`) and admin per-project (`:239`) filter `payment_confirmed !== false`. These cards therefore **already diverge from the client today** on unconfirmed features — before any package work. Applying only the coverage gate would leave them mismatched.

Therefore §3g does **two** things, and the developer must treat the confirmed-filter as a deliberate behavior change, not a refactor:
1. **Add the `payment_confirmed !== false` filter** so the detail cards finally agree with the client/per-project math (route this block through the same shared helper).
2. Then apply the coverage gate + due-period fold.

Log/PR-note this as an intentional fix of a pre-existing admin/client discrepancy so it isn't mistaken for a regression. Detail cards are formatted via `formatINR` (`:2012`); no formatting change needed there.

### 3h. Core-vs-Extra split (requirement 1) — unchanged display, new sibling
The `is_new_request` → Core/Extra Type badge (`page.tsx:1290-1298`) stays exactly as-is (cosmetic, per brief note 1). `coverage` is rendered as a **separate** Included/Extra financial indicator (see §7). The two flags never conflate.

### 3i. Lazy missing-period detection — closes the silent-revenue-loss foot-gun (must-fix #4)
A manual "Add period" button with no overdue detection means a forgotten month simply never bills and pending reads ₹0 — a revenue loss that looks like correct behavior. To close this **without** a cron (which doesn't exist here):

- **Pure read-side detector** `missingDuePeriods(project, periods, today)`: from `package_started_on`, `package_anchor_day` (or derived), and `package_cadence`, enumerate every period boundary `<= today` while `package_status === 'active'`; subtract the periods already present; return the missing `{period_start, period_end}` list. This writes nothing.
- **Surface it in the admin UI** as a prominent "N period(s) not yet generated — generate now" banner on package projects (and a count badge in the project list). The admin can one-click materialize them.
- **Optional lazy auto-materialize** on the admin `fetchProjects` path: for `package_status === 'active'` projects, upsert any missing due periods via the `(project_id, period_start)` unique index (idempotent, `origin='auto'`, `fee_amount = package_fee` snapshot, `client_id` from the trigger). The unique index makes concurrent materialization safe. Keep this admin-only so client reads never write.
- The client side **does not** auto-create periods; it only *reads* `stats.missingPeriods` for an informational "next charge" hint and never bills a month the admin hasn't generated. The admin banner is the source of truth for action.

This makes "forgotten month" a visible, actionable state rather than silent ₹0.

---

## 4. New-Feature Classification (Included vs Extra)

- **Field:** `features.coverage` (`'included'` | `'extra'`), DB default `'extra'`.
- **Default:** on a `billing_mode='package'` project the admin's create form defaults the toggle to **`'extra'`** — the revenue-protecting choice. Making something free must be a *conscious* decision. (Diverges deliberately from the Two-Flag candidate's "included by default.")
- **Toggle:** in `app/admin/dashboard/page.tsx` feature modal (`handleSaveFeature` payload region `:586-604`), add a Coverage radio (**Included** | **Extra**) shown **only** when the parent project is `billing_mode==='package'`. Add `coverage: formData.coverage || 'extra'` to the payload (`:599-604`). On per-feature projects the toggle is hidden and `coverage` is irrelevant.
- **Feeds totals via §3a/§3f:** an `'included'` feature is filtered out of `billable`, contributing 0 to `total`/`paid` while still appearing in the list and counting toward `progress`. An `'extra'` feature behaves exactly like a normal feature today.
- **Included features and the payment badge (corrected):** `handleSaveFeature` (`:587-594`) computes `payment_status` from `amount`/`paid_amount` and forces `amount=0`/`payment_status='Paid'` when `payment_confirmed===false`. An `'included'` feature that still carries a nonzero `amount` for record-keeping would otherwise render a Paid/Partial/Pending badge that is now **meaningless** (it's excluded from sums). **Fix:** when `coverage==='included'` on a package project, **suppress the payment-status badge and the ₹ amount in the Cost cell** — reusing the existing suppression pattern at `:1320-1321` (the "Rate Pending" branch hides payment status) — and render **"Included"** in the Cost cell instead (see §7). The feature may retain its `amount` in the DB for history; the UI simply never shows a price or payment state for included work.
- When `coverage` flips on an existing feature, log a `feature_coverage_changed` activity (§9).

---

## 5. Migration: Shifting a Pending Project onto a Package

Triggered by an admin action **"Move to Monthly Package"** on the project detail view. The admin sets `package_fee`, `package_anchor_day`, `package_started_on`, and picks a **`pending_disposition`** for the existing PENDING balance.

**Affected set is defined once, unambiguously (must-fix correction):** the affected features are **confirmed features only** (`payment_confirmed !== false`) — the exact set the live pending formula sums. `payment_confirmed === false` ("Rate Pending") features were never in pending, are **never** placed in `affected_feature_ids`, and are **never** mutated by any disposition. This wording is now uniform across all four rows below.

**Pending is computed with the exact live formula** (`page.tsx:193-194,207`): `pending_snapshot = Σ(amount) − Σ(paid_amount)` over confirmed features. This guarantees the migrated figure matches what the client sees today.

### The four configurable dispositions
| Disposition | Existing pending becomes | Field mutations (confirmed features only) | Client sees |
|---|---|---|---|
| **`writeoff`** | Forgiven. | For each affected confirmed feature set `paid_amount = amount`, `payment_status = 'Paid'`. Log `package_started` + note "balance written off". | Outstanding → ₹0. |
| **`settle`** | Collected now. | Same field mutation as writeoff. **Log `payment_received` with `metadata.paidAmount = amount`, `metadata.oldPaidAmount = (prior paid_amount)`, so the badge delta `paidAmount − oldPaidAmount` (`page.tsx:899`) equals the *remaining* `amount − paid_amount` actually collected — NOT the full amount.** Doing this per-feature avoids double-reporting the portion already paid earlier. | "Payment received ₹(remaining)", pending → ₹0. |
| **`roll_into_first`** | Carried into month 1. | First `billing_periods` row: `fee_amount = package_fee + pending_snapshot`, `note = 'Includes carried-over balance ₹X'`, `origin='manual'`. Affected confirmed features zeroed to Paid so the balance isn't double-counted. | First charge larger; line note explains carryover. |
| **`keep_one_time`** | Left as standalone outstanding. | Confirmed features **untouched** (still pending, still per-feature). Package starts alongside. | Both a one-time outstanding amount AND a monthly package. |

**`settle` delta rule (explicit):** for a feature with `amount=10000, paid_amount=3000`, `settle` logs `metadata.paidAmount=10000, oldPaidAmount=3000` → badge shows the **₹7,000** delta, the genuinely-collected remainder, consistent with the existing `payment_received` delta convention. It must never log ₹10,000.

### Commit sequence (single Supabase RPC `migrate_project_to_package`, transactional)
1. Compute `pending_snapshot` from confirmed features **inside the transaction** (authoritative).
2. **Concurrency guard (must-fix #?):** compare the freshly-computed snapshot against the `pending_snapshot` the admin reviewed in preview (passed into the RPC). **If they diverge, abort and return "data changed since preview — please re-review"** rather than committing on stale numbers. This defends against the unfiltered `features` realtime channel (`page.tsx:149`) letting a concurrent feature edit slip between preview and confirm.
3. **Assertion:** `Σ(zeroed pending over affected confirmed features) === pending_snapshot` must hold; otherwise abort. This makes double-counting structurally impossible for `roll_into_first`.
4. Write a `package_migrations` row: `before_state` jsonb = `{ project: { billing_mode, package_fee, package_status, package_started_on, package_anchor_day }, features: [{ id, amount, paid_amount, payment_status, coverage }] }` for every affected confirmed feature; set `status='committed'`, `pending_disposition`, `affected_feature_ids`, `pending_snapshot`.
5. Apply the disposition's field mutations (table above).
6. Set `projects.billing_mode='package'`, `package_fee`, `package_status='active'`, `package_started_on`, `package_anchor_day`.
7. Create the first `billing_periods` row (`fee_amount` = package_fee, or +carryover for `roll_into_first`; `period_start = package_started_on`, `period_end` = start + 1 cadence − 1 day; `origin='manual'`; `client_id` via trigger).
8. Log a `migrated_to_package` activity (`metadata: { pendingBefore, disposition, monthlyAmount, amount: pendingBefore }` — note `amount` is set so the email/PDF amount-badge gate fires, see §9).

### Why it's reversible
Confirmed features are **flag/field-updated, never deleted**, and `before_state` jsonb is a complete undo buffer. An **"Undo migration"** button calls `revert_project_to_per_feature(project_id)`, which:
- replays `before_state` (restores each affected feature's original `amount`/`paid_amount`/`payment_status`/`coverage` and the project's prior `package_*` fields and `billing_mode='per_feature'`);
- **deletes only `billing_periods` rows with `origin='auto'` AND `paid_amount = 0`** — never `origin='manual'` periods (e.g. a deliberately-noted ₹0 prorated/paused first month) and never any period with a recorded payment. This closes the "delete any zero-paid period" over-reach (the prior plan could nuke a legitimately admin-noted ₹0 month);
- stamps `package_migrations.reverted_at` + `status='reverted'`.

Undo is offered only for the **most-recent committed** migration, and the state machine refuses to revert once any period carries a recorded payment. Because no destructive delete of paid data occurs, undo is lossless **for the auto-generated, unpaid state**; the plan no longer claims losslessness for admin-authored or paid periods (it preserves them instead).

---

## 6. Preview Mechanism

Preview is a **pure, read-only client-side computation that writes nothing** to any billing table — and, per the requirement-4 correction, **writes nothing at all**, including no `package_migrations` row. (The prior plan's "optional `status='previewed'` row" is **dropped**: persisting it would violate "nothing changes until the admin confirms." Audit of *committed* migrations is sufficient.) Preview lives in the "Move to Monthly Package" modal, between configuration and the Confirm button (disabled until reviewed).

`previewMigration(project, features, { fee, anchorDay, startedOn, disposition })` returns a diff object rendered as **three side-by-side panels**, computed via the same shared helper the live dashboard uses (§10 Phase 0), so previewed numbers provably match post-commit reality:

- **(A) BEFORE** — current `Total / Paid / Pending` from the *live* formula (`page.tsx:193-207`) plus the current feature list.
- **(B) AFTER** — recomputed under package rules: `'included'` features zeroed, the chosen `disposition` applied to `pending_snapshot`, the first month's fee, the projected `nextChargeOn`. The pending line states its fate explicitly, e.g. *"Pending ₹40,000 will be WRITTEN OFF (client sees ₹0 outstanding)"* vs *"rolled into first invoice → first charge ₹45,000 = ₹5,000 fee + ₹40,000 carryover."* For `settle`, the panel shows the **remaining** amount that will be logged as collected per feature (`amount − paid_amount`), matching the §5 delta rule.
- **(C) WHAT-RECURS** — monthly fee + cadence, plus a per-feature list auto-classified Included vs Extra that the admin can toggle **before** committing.

The preview also **captures the `pending_snapshot` it displayed** and passes it into the commit RPC, which re-checks it (§5 step 2). Re-opening recomputes from current DB state, so an aborted preview leaves zero trace — satisfying requirement 4 literally (nothing in any table changes until Confirm).

---

## 7. Client Portal Rendering

The client dashboard (`app/dashboard/page.tsx`) branches on `project.billing_mode`, with **every** package render guarded by `billing_mode==='package'` and a fallback to the existing view, so a project missing package fields can never break.

**Per-feature project:** pixel-identical to today. Zero visual change.

**Package project:**
- **Card + modal header (`page.tsx:1022` pill, `1094`):** a "Monthly Package" pill reusing the category pill component.
- **Financial Overview (`page.tsx:1119-1163`):** renders **Monthly Fee ₹X**, **Current Period** (e.g. "Jun 1 – Jun 30" from `stats.currentPeriod`), **Next Charge On** (`stats.nextChargeOn`), and the current period's Paid/Pending using the existing Paid/Partial/Pending badges.
- **% PAID / Funded bar — relabel for packages (must-fix correction):** the existing Funded bar is `paid / (total || 1) * 100` (`page.tsx:1125,1150,1155`), a *fixed-scope completion* metaphor. For a subscription `total` grows monthly, so "Funded %" oscillates and never approaches 100% — misleading. **For `billing_mode==='package'`, hide the fixed-scope Funded bar and instead render a "This period" meter: `currentPeriod.paid_amount / currentPeriod.fee_amount`, labeled e.g. "This month: ₹paid / ₹fee."** Per-feature projects keep the original Funded bar unchanged.
- **Feature table (`page.tsx:1244-1342`) + mobile cards (`:1345-1416`):** add a coverage indicator in **both** copies. `'included'` features show **"Included"** in the Cost cell in place of the ₹ amount — mirroring the existing **"Rate Pending"** branch (`:1310-1314` desktop, `:1370-1374` mobile) — and **suppress the payment-status badge** (reusing the `:1320-1321` / `:1392-1393` suppression), since an included feature has no separately-billed payment state (§4). `'extra'` features show their ₹ amount plus a small "Extra" tag. The `is_new_request` Core/Extra badge (`:1290-1298`) is left untouched alongside. Note the `amount` sort key (`:1262/1349`) sorts an `included` (amount 0) feature to the bottom under amount-desc — acceptable, documented.
- **Currency formatting — required, not "ideally" (must-fix correction):** package amounts must use `toLocaleString()` everywhere, **including** the project-card mini-table (`:1064-1066`) and mobile `Pd:` (`:1403`), which today print **raw** numbers (brief note 6). A monthly fee like ₹1,20,000 rendered as `₹120000` is a visible defect, so fixing those raw sites is a **required** part of the package work wherever a package amount can appear there — not optional.

**Mixed case (monthly base + extras):** handled natively — the fee flows through `billing_periods`, `'included'` features show "Included" (no price, no payment badge), `'extra'` features render with their own ₹ amount and badges. The single Total/Paid/Pending donut sums both legs (due periods only). Because only the *current/arrears* period counts toward pending (§3a), the recurring portion is labeled as recurring ("Monthly Fee" / "This month") so an open-ended subscription's pending isn't misread as a fixed debt.

**Aggregate cards + donut (`:695-727`, `:731-819`):** unchanged — due package fees fold into each project's `stats`.

**Activity Log:** monthly payments surface via the existing `payment_received` badge + mini progress bar (`page.tsx:897-956`).

---

## 8. Admin UI Changes

All in `app/admin/dashboard/page.tsx`:

1. **Billing section (project detail, near `:2007-2100`):** a Per-feature / Package segmented control. Switching to Package opens the **migration modal**: `package_fee`, `package_anchor_day`, `package_started_on`, the **pending-disposition dropdown** (Write off / Settle now / Roll into first invoice / Keep as one-time), the auto-classified coverage list, the three-panel before/after **preview** (§6), and a **Confirm & Migrate** button disabled until the preview is reviewed. The Confirm action passes the previewed `pending_snapshot` to the RPC for the divergence re-check (§5 step 2).
2. **Undo control:** an "Undo last migration" button appears once a `package_migrations` row with `status='committed'` exists and no period for the project carries a recorded payment (calls the revert RPC).
3. **Feature modal coverage toggle:** in `handleSaveFeature` (`:586-604`), an **Included | Extra** radio (default Extra) shown only in package mode; add `coverage` to the payload at `:599`. When Included, the save path should not synthesize a misleading `payment_status` (§4).
4. **`billing_periods` table UI:** for package projects, a per-month list reusing the **same manual "record payment" input** used for features — type a paid amount → update `billing_periods.paid_amount` + recompute `payment_status` (`'Paid'`/`'Partial'`/`'Pending'`, same logic as `:592-593`) → log `package_payment_received`.
5. **Missing-period banner + "Generate period" (must-fix #4):** show the §3i "N period(s) not yet generated — generate now" banner on package projects and a count badge in the project list. One click materializes the missing due periods (`origin='auto'`). A manual "Add period" row (`origin='manual'`) remains for proration/special months. **The combination of the overdue banner + optional lazy materialize is what prevents silent revenue loss** — a bare manual button is explicitly rejected.
6. **Select-statement updates:** add `coverage` to the bulk feature fetch (`:158`); carry `billing_mode` from the projects fetch; add parallel `billing_periods` fetches keyed by the same project ids in both admin and client `fetchProjects` paths.

---

## 9. Notifications / Activity-Log Impact

Reuse `logActivity({ clientId, projectId, actionType, title, description, metadata })` (`lib/activityLogger.ts:35-68`) and the manual email path `sendNotification(logId, client.email, client.name)` (`admin/dashboard/page.tsx:806`). Sending the client email stays a **manual admin action** (no auto-fire), consistent with the existing flow. Note `lib/notifications.ts` also runs on the anon key (§0) — no service role is introduced.

**New `ActivityAction` members** (TypeScript union at `lib/activityLogger.ts:3-17`; DB `action_type` is free text, so non-breaking; `getActivityMeta` `page.tsx:272-305` has a default branch):
- `migrated_to_package` — on commit. `metadata: { pendingBefore, disposition, monthlyAmount, amount: pendingBefore }`.
- `package_started` — package activated (writeoff/settle).
- `package_payment_received` — admin records a monthly period payment. Reuses `metadata.amount` / `paidAmount` / `oldPaidAmount` so the client delta badge (`page.tsx:899`) and mini progress bar (`page.tsx:949`) render with no new client UI.
- `feature_coverage_changed` — `metadata: { feature, oldCoverage, newCoverage }`.
- `package_ended` / `package_paused` — status change.

**Email rendering (corrected — "zero new code" was wrong):** `generateSingleActivityEmailHTML` derives the **label** via `action_type.replace(/_/g,' ')` (`notifications.ts:48`), so the new types auto-label as "Migrated To Package", "Package Payment Received", etc. — acceptable. **But the money line only renders when `metadata.amount > 0` (`notifications.ts:53`).** Therefore:
- Add color entries for each new `action_type` to `actionColors` (`notifications.ts:32-45`) — reuse `payment_received`'s amber for `package_payment_received`, `project_created`'s blue for `migrated_to_package`.
- **`package_payment_received` already carries `metadata.amount` → its amount line renders. `migrated_to_package` must set `metadata.amount = pendingBefore`** (done in §5 step 8 / above) so the amount badge actually fires; without it the email would show no money. Do **not** rely on `pendingBefore`/`monthlyAmount` alone — they don't trip the `amount > 0` gate.

**PDF export (`page.tsx:364-490`) — enumerate the keys (corrected):** the PDF hand-builds amount lines from *specific* metadata keys (`₹`→`Rs.` via `sanitize()` at `:358`), not a generic renderer. For the new types, explicitly add formatting for:
- `package_payment_received`: format `metadata.amount`, and the delta `paidAmount − oldPaidAmount`, exactly like `payment_received`.
- `migrated_to_package`: format `metadata.pendingBefore` (the pre-migration balance) and `metadata.monthlyAmount`; include a line for the chosen `disposition`.
Each new type also needs `getActivityMeta` icon/label/color entries on the client side.

---

## 10. Phased Rollout (each step independently safe)

- **Phase 0 — Refactor seam (no behavior change).** Extract the duplicated money math into one shared helper (`lib/billing.ts → computeProjectStats(project, features, periods, today)`) used by client `fetchProjectsForClient` (`page.tsx:190-207`), admin per-client (`:179-182`), admin per-project (`:239-241`), and admin detail (`:2007-2011`). **Target the real call sites/function names** (`fetchProjectsForClient`, `loadActivityLogsForClient`), not the brief's narrative names. Note: routing the admin detail block through the helper will *change* its numbers (it currently lacks the `payment_confirmed` filter, §3g) — land that as an explicit, called-out fix, then verify all other call sites are byte-identical.
- **Phase 1 — Schema.** After the §0 live-schema audit, run the §2 DDL. All defaults preserve current behavior; no app code reads the new columns yet. Add new fields to the explicit admin select at `:158`.
- **Phase 2 — Coverage-aware math + admin coverage toggle.** Add the `coverage` gate to the shared helper (§3) and the Coverage radio to the feature modal (§4), including the included-feature badge suppression. With all features `'extra'` and all projects `'per_feature'`, output is identical until opt-in. Ship.
- **Phase 3 — `billing_periods` + admin package UI + missing-period detector.** Add period reads, the `client_id` trigger, the "record payment"/"generate period" UI, the §3i overdue banner + lazy materializer, and `package_payment_received` logging. No client-facing change yet. Ship.
- **Phase 4 — Migration + preview + undo.** Build the migration modal, `previewMigration` (writes nothing), the transactional `migrate_project_to_package` (with snapshot re-check + assertion) and `revert_project_to_per_feature` (origin/paid-guarded) RPCs, and `package_migrations`. Ship.
- **Phase 5 — Client rendering.** Add the `billing_mode`-guarded package views (§7) incl. the relabeled "This month" meter and the required `toLocaleString()` fixes, the `billing_periods` realtime channel (filtered by `client_id`), new `getActivityMeta` entries, email `actionColors` + `amount` mapping, and PDF key formatting. Ship last. 

Each phase is independently revertible (drop columns / feature-flag the helper branch).

---

## 11. Edge Cases & Open Questions

- **Security model is the binding constraint (resolved, not deferred):** there is no Supabase Auth, no `auth.uid()`, no service-role key; the anon key is shipped to the browser (§0). RLS cannot isolate clients here. Therefore `billing_periods` and `package_migrations` are treated as **client-readable** and hold nothing client-invisible; client scoping continues via explicit `.eq('client_id', …)` filters. *If true admin-only confidentiality is ever required, it must be preceded by introducing a real service-role key + RLS — out of scope for v1.*
- **Open-ended "Pending" (resolved):** only **due** periods (`period_start <= today`) count toward `total/paid/pending` (§3a). Pending = unpaid arrears + current period — finite and collectable. Future months show only as "Next charge on …". This removes the §3-vs-§11 contradiction entirely; the donut/`paymentPercent`/Funded relabel all rest on this rule.
- **Silent revenue loss from a forgotten month (resolved):** the §3i lazy detector + admin overdue banner (+ optional lazy materialize) make missing periods a visible, one-click-fixable state instead of an invisible ₹0.
- **Partial-payment dispositions (resolved):** `settle` logs the **delta** `amount − paid_amount` per confirmed feature (not the full amount), so already-collected money isn't double-reported; `roll_into_first` is protected by the `Σ(zeroed) === pending_snapshot` assertion; all dispositions touch **confirmed features only**.
- **Concurrency between preview and commit (resolved):** the RPC recomputes `pending_snapshot` in-transaction and refuses to commit if it diverges from the previewed value, defending against the unfiltered `features` realtime channel.
- **Revert losslessness (scoped honestly):** undo restores `before_state` and deletes only `origin='auto'` + `paid_amount=0` periods; `origin='manual'` and any paid period are preserved. Undo is offered only for the most-recent committed migration and is blocked once a period has a recorded payment.
- **Proration / partial months:** no automatic proration in v1. A mid-month start or a paused package uses a manual `fee_amount` adjustment + `note` on an `origin='manual'` period. *Open: a helper to pre-fill a prorated first `fee_amount`?*
- **`package_anchor_day` capped at 28 → end-of-month drift:** a client onboarded on the 29th–31st bills on the anchor day and drifts earlier; acceptable for v1 but **documented** (not silent). *Alternative if needed later: store the raw start day and clamp at render time.*
- **Cancel / downgrade:** `package_status='ended'`/`'paused'` stops new period generation (and the §3i materializer); existing unpaid **due** periods remain as collectable arrears. Downgrade affects only *future* periods because `fee_amount` is snapshotted per period; log a `package_updated`-style activity to retain the prior headline fee.
- **Already-paid features at migration:** untouched by all dispositions (only *pending* confirmed features are affected); history intact.
- **Double-counting guard is convention-enforced (stated honestly):** an `'extra'` feature bills through `features.amount`; periods bill only `fee_amount`. The schema does **not** structurally forbid an admin from also itemizing the same work into a period note/fee — this is a **convention**, backed by the `roll_into_first` assertion for the migration path but not a general DB constraint. Acknowledged as such rather than over-claimed.
- **Realtime churn:** the client `features` channel has **no filter** (refetches on any features change, brief note 5). Migration mutations and coverage flips trigger broad refetches; acceptable at this scale. Worth filtering the `features` channel by `client_id` if churn becomes noticeable. The new `billing_periods` channel **is** filtered by `client_id`, which depends on the denormalized `client_id` being trigger-maintained (§2).
- **Enum CHECK vs typos:** CHECK constraints on all enum-by-convention columns close the typo risk.
- **Taxes:** no tax field today; amounts are pre-tax ₹ literals. Out of scope; if GST is later needed, add `tax_amount` to `billing_periods` (cheap additive change).
- **Multiple projects per client / mixed models:** fully supported — `billing_mode` is per-project; aggregates fold per-project stats.
- **Multiple concurrent packages per project:** not supported (one `package_*` block per project); would require promoting `package_*` to a `packages` child table — out of scope.

---

# Appendix A - Adversarial Critique

_The must-fixes below were folded into the plan above; kept for the reasoning / audit trail._

I have enough verified ground truth to write the adversarial review. No SQL/migration files exist in the repo (schema is managed in Supabase directly), confirming there's no existing source-of-truth to check column existence against — the brief is the only schema reference, which itself is a risk the plan glosses over.

Here is my review.

---

# Adversarial Review: Monthly-Package Billing Plan

## Critical defects (architecture / correctness)

- **The entire RLS design is built on an auth model that does not exist.** §2 proposes `billing_periods` SELECT policy `client_id = auth-resolved client` and `package_migrations` as "admin-only — no client SELECT policy; never exposed to the client portal." But clients do **not** authenticate via Supabase Auth — login is a custom `access_key` lookup against the `clients` table (`app/actions.ts:19-40`), and the browser holds the **anon key** (`lib/supabase.ts:5`). There is no `auth.uid()` for a client, so `auth-resolved client` is unresolvable. Worse, both `supabase` and `supabaseAdmin` are constructed from the **same anon key** (`lib/supabase.ts:10,18`; `lib/notifications.ts:6-8`) — there is no service-role client anywhere. Existing tables are queried with manual `.eq('client_id', …)` filters, which only works if RLS is effectively permissive. **Fix:** Drop the RLS-based security claims. Either (a) keep `package_migrations` reads gated only by the admin app boundary while acknowledging the anon key can technically read it (so it must contain no client-invisible secrets), or (b) introduce a real service-role key for admin/server paths and proper RLS before relying on it. As written, "never exposed to the client portal" is false security.

- **`package_migrations.before_state` undo buffer can be read by the client browser.** Because the anon key is shipped to the client and there's no working RLS, the "admin-only" migration audit table (including write-off decisions, carried-over balances, prior pending) is queryable by any logged-in client who knows the table name. The plan treats this as private. **Fix:** Do not store anything in `package_migrations` you wouldn't show the client, or implement real row security first.

- **Recurring accrual has no engine — "Generate next period" is a manual button the admin must remember forever.** §8.5 and §10 explicitly drop cron "matching the existing fully-manual workflow." But per-feature billing has no time dimension — nothing breaks if the admin forgets to act. A *subscription* silently stops billing the moment the admin forgets to click "Add period." The plan's own §11 "accrue only the current period into pending" assumes periods exist; if no one generates month 2, the client simply isn't billed and pending shows ₹0 — a **revenue-loss failure mode** that looks like correct behavior. **Fix:** At minimum, compute the set of *missing* periods on read (from `package_started_on` + `anchor_day` + cadence vs `now()`) and surface "N periods not yet generated" in the admin UI, or auto-materialize due periods lazily on `fetchProjects`. A purely manual button with no overdue indicator is a foot-gun, not a feature.

## Migration / reversibility defects

- **Partially-paid pending features are silently destroyed by `writeoff`/`settle`/`roll_into_first`.** All three dispositions "set `paid_amount = amount`, `payment_status = 'Paid'`." For a feature with `amount=10000, paid_amount=3000`, the disposition overwrites `paid_amount` from 3000 → 10000. The `before_state` jsonb does capture the original `paid_amount` (§5 step 2 lists it), so revert restores it — but the question asked specifically about partial payments, and the plan never calls out that **`settle` will log the full `amount` as "payment received" when only the unpaid remainder (`amount − paid_amount`) was actually collected**, double-reporting ₹3000 that was already logged earlier. **Fix:** `settle` must log only `paidAmount = amount − oldPaidAmount` (the delta), consistent with the existing `payment_received` delta convention (`page.tsx:899`: `paidAmount − oldPaidAmount`). As written, the activity timeline overstates collections.

- **`roll_into_first` double-counts unless the zeroing is precise.** It sets `fee_amount = package_fee + pending_snapshot` AND zeroes features to Paid. `pending_snapshot = total − paid` over confirmed features — correct. But if any affected feature is `payment_confirmed === false` (Rate Pending), it was **never in the pending sum** yet may be in `affected_feature_ids`. The plan's "affected confirmed feature" wording is inconsistent across the table (writeoff says "affected confirmed feature," roll says "Affected features zeroed"). **Fix:** Explicitly define affected set = confirmed features only, everywhere, and assert `Σ(zeroed pending) === pending_snapshot` in the RPC before commit.

- **Revert's "delete periods with `paid_amount = 0`" can still destroy a legitimate ₹0 period that the admin manually noted.** A paused/prorated first month could legitimately be `fee_amount=0, paid_amount=0` with a `note`. Revert nukes it. Minor, but the plan claims "lossless." **Fix:** Only delete auto-created periods flagged as system-generated (add an `origin text default 'auto'` column), not any zero-paid period.

- **No concurrency guard on the migration RPC.** The realtime `features` subscription has no filter (`page.tsx:149`), so the admin's own feature edits and the migration RPC can interleave. If the admin edits a feature's `amount` between preview and confirm, `pending_snapshot` is stale. **Fix:** Recompute snapshot inside the transaction (the plan does this in step 1 — good) AND store the preview's snapshot, then refuse commit if they diverge, surfacing "data changed, re-review."

## Financial-math defects

- **The `pending = total − paid` formula breaks for open-ended packages, and the plan half-acknowledges but doesn't resolve it.** §11 says "accrue only the current period into pending (recommended)" — but §3a literally sums **all** `billing_periods` rows: `periodTotal = periods.reduce(sum fee_amount)`, `periodPaid = periods.reduce(sum paid_amount)`, then `total = featureTotal + periodTotal`. If 6 monthly periods exist and the client paid 5, `total/paid/pending` reflect all 6 — directly contradicting the §11 "current period only" recommendation. These two sections are mutually inconsistent. **Fix:** Pick one. If "current-period-only pending" is the decision, §3a must NOT sum historical periods into the headline `total/pending`; historical unpaid periods need separate treatment (arrears) or the donut/`paymentPercent` (`page.tsx:678,681-685`) will show an ever-growing pending that the §11 decision explicitly tried to avoid.

- **`% PAID` / `Funded` bar will read nonsensically for packages.** The modal Funded bar is `paid / (total || 1) * 100` (`page.tsx:1125,1150,1155`). For a subscription where `total` grows every month, "Funded %" oscillates and never approaches 100% by design — it's a meaningful metric for fixed-scope projects but misleading for recurring. The plan says (§7) "The existing … Funded bar stays." **Fix:** Hide or relabel the Funded bar for `billing_mode==='package'` (e.g., show "This period: ₹paid / ₹fee"), don't reuse a fixed-scope completion metaphor for a subscription.

- **Admin project-detail summary (`:2007-2009`) is already inconsistent with the client and the plan's §3g fix won't reconcile it.** The plan says apply "the same coverage gate + period fold so the detail cards match the client." But `:2007-2008` sum over **all** features with **no `payment_confirmed` filter**, whereas the client (`:192`) and admin per-project (`:239`) filter `payment_confirmed !== false`. So today these cards already diverge from the client on unconfirmed features. Adding coverage logic on top, without also adding the confirmed-filter, leaves them mismatched. **Fix:** §3g must also add the `payment_confirmed !== false` filter (or the plan must note it's deliberately changing pre-existing behavior). The plan's premise that this is a clean parallel edit to §3a is wrong — the base code differs.

- **Aggregate `progress` denominator interaction with `coverage` is fine, but the plan's claim of "no double-counting" rests on an unstated invariant.** §11 "double-counting guard" says an `'extra'` feature must never be in a `billing_periods` row. Nothing in the schema or RPC enforces this — it's a convention. `coverage='included'` features are excluded from feature sums (§3a) and assumed covered by `fee_amount`; `coverage='extra'` flows through feature sums. But there's no constraint preventing an admin from also itemizing the same work into a `billing_periods.note`/fee. **Fix:** Acknowledge this is convention-only, or it's an over-claimed guarantee.

## Schema / backfill defects

- **No SQL migrations exist in the repo** (`**/*.sql` → none). The schema is managed directly in Supabase. The plan's "Phase 1 — Run the DDL" assumes a migration workflow that isn't in the codebase, and there's **no way to verify the brief's column list against ground truth** — the brief is the only schema reference and `admin-billing`/`schema-sweep`/`product-conventions` readers returned `null` (no findings). The plan asserts "Any column the plan references that does NOT exist" is safe, but every claim rests on an unaudited brief. **Fix:** Before Phase 1, dump the live Supabase schema (information_schema) to confirm `projects`/`features`/`activity_logs`/`clients` columns actually match the brief; the plan should not assert additivity against a schema no one has seen.

- **Backfill defaults are correct for behavior parity, with one gap: `billing_periods` realtime is added to the client channel, but the client `features` channel has no filter and already refetches on any change (`page.tsx:149`).** Adding a `billing_periods` channel filtered by `client_id` is fine, but the plan doesn't note that the `client_id` on `billing_periods` is denormalized and must be kept consistent on every insert/update or the realtime filter silently drops events. **Fix:** Set `client_id` from `projects.client_id` inside the RPC/insert, never from client input; add a trigger or RPC-only write path.

- **`package_anchor_day` capped at 28 loses end-of-month semantics.** A client onboarded on the 31st gets billed on the 28th forever, drifting earlier. Acceptable for v1, but the plan presents `1–28` as purely defensive without noting the billing-date regression. Minor. **Fix:** Document the drift, or store the raw start day and clamp at render time.

## Notifications / conventions defects

- **`notifications.ts` uses the anon key for server-side email sends (`lib/notifications.ts:6-8`), and new `action_type` values added only in TypeScript will render with a generic fallback in email.** The plan (§9) adds colors for new types to `actionColors` (`notifications.ts:32-45`) — good — but the `label` is auto-derived via `action_type.replace(/_/g,' ')` (`notifications.ts:48`), so `migrated_to_package` becomes "Migrated To Package" and `package_payment_received` → "Package Payment Received". The plan never checks the **amount badge gate**: `notifications.ts:53` only shows an amount when `metadata.amount > 0`. For `package_payment_received` the plan reuses `metadata.amount`/`paidAmount` — fine — but `migrated_to_package` uses `metadata.pendingBefore`/`monthlyAmount`, which **won't trigger the amount badge** and won't render any money in the email. **Fix:** Either map the new metadata keys into `amount` for the email, or add explicit email rendering; don't assume "reuses existing badge with zero new code."

- **PDF export currency: the plan adds new activity types but doesn't address the `₹` → `Rs.` sanitize path for new metadata.** The PDF (`page.tsx:364-490`) hand-builds amount lines from specific metadata keys. New `package_payment_received`/`migrated_to_package` logs carry new keys (`monthlyAmount`, `pendingBefore`); these won't appear in the PDF unless explicitly added. The plan says "PDF export … need icon/label/color entries" but money lines in the PDF are keyed by specific fields, not a generic renderer. **Fix:** Enumerate which metadata keys the PDF must format for each new type.

- **Currency formatting inconsistency is "ideally" fixed, not actually scoped.** §7 says "ideally fix the raw-number project-card mini-table (`:1064-1066`) and mobile `Pd:` (`:1403`)." Package amounts rendered there will inherit the separator-less bug for large monthly fees (e.g., `₹50000` not `₹50,000`). **Fix:** Make this a required edit for package rows, not "ideally" — a ₹1,20,000 fee printed as `₹120000` is a visible defect.

## Smaller gaps

- **Function naming mismatch:** the realtime handlers call `fetchProjectsForClient`/`loadActivityLogsForClient` (`page.tsx:145,155`), while the plan and the brief reference `fetchProjects`/`fetchActivityLogs`. There appear to be wrapper names. The Phase 0 helper extraction must target the actual call sites, not the names in the brief.
- **`previewMigration` "writes nothing" is true except for the optional `status='previewed'` row** (§6) — which writes to `package_migrations`, contradicting "Preview … writes nothing." Requirement 4 ("nothing changes until confirm") is technically violated if that row is persisted. **Fix:** Make the previewed-row strictly opt-in and clearly not a state change to billing, or drop it.
- **`coverage='included'` feature "may still carry an `amount`"** (§4) — but `handleSaveFeature` (`:587-594`) forces `amount=0` and `payment_status='Paid'` when `payment_confirmed===false`, and computes `payment_status` from amount/paid. An included feature with a nonzero `amount` but excluded from sums will still show a Paid/Partial/Pending badge driven by its own `paid_amount`, which is now meaningless. **Fix:** When `coverage==='included'` on a package project, suppress the payment badge (like the "Rate Pending" suppression at `:1320-1321`), or the client sees a confusing payment status on free work.
- **Sort comparator unaffected but feature-list `Cost` cell branching grows:** the plan adds an "Included" branch mirroring "Rate Pending" (`:1310-1314`). Note there are **two** copies (desktop `:1310`, mobile `:1370`) plus the sort key uses `amount` (`:1262,1349`) — an `included` feature with `amount=0` sorts to the bottom under amount-desc, which may surprise. Minor, worth a note.

---

## Must-fix before implementation

1. **RLS is fiction here.** Clients use access-key login + anon key (`actions.ts`, `supabase.ts`); there is no service role and no `auth.uid()`. `package_migrations`/`billing_periods` cannot be secured by the proposed policies — redesign the security model or add a real service-role path before storing anything client-invisible.
2. **Resolve the §3a-vs-§11 contradiction on what counts toward `pending`** (sum-all-periods vs current-period-only). The donut, `paymentPercent`, and Funded bar all depend on this and will misreport for subscriptions otherwise.
3. **`settle` disposition must log the payment *delta* (`amount − paid_amount`), not the full amount**, or it double-reports already-collected money for partially-paid features.
4. **No accrual engine = silent revenue loss.** A manual "Add period" button with no overdue detection means forgotten months simply don't bill. Add lazy/computed missing-period detection at minimum.
5. **§3g is not a clean parallel edit** — the admin detail summary (`:2007-2008`) lacks the `payment_confirmed` filter that the client uses, so it already diverges; the coverage fold alone won't make cards match the client.
6. **Audit the live Supabase schema** before running additive DDL — no `.sql` files exist in the repo and three of four ground-truth readers returned null, so column existence is unverified.

Relevant files: `c:\Users\rohan\Desktop\Client Portal\Version 1\lib\supabase.ts`, `c:\Users\rohan\Desktop\Client Portal\Version 1\app\actions.ts`, `c:\Users\rohan\Desktop\Client Portal\Version 1\lib\notifications.ts`, `c:\Users\rohan\Desktop\Client Portal\Version 1\lib\activityLogger.ts`, `c:\Users\rohan\Desktop\Client Portal\Version 1\app\dashboard\page.tsx`, `c:\Users\rohan\Desktop\Client Portal\Version 1\app\admin\dashboard\page.tsx`.