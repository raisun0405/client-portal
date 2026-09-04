# Client Portal — domain model

Two surfaces over one Supabase database:

- **Admin** (`admin.raisun.dev`) — Rohan runs the business here. Logs in with Supabase Auth.
- **Client portal** (`track.raisun.dev`) — the client's read-mostly view. Logs in with an `access_key`; all its data is served by server actions using the secret key (the anon browser key is denied by RLS).

## Entities

**Client** — a customer. Notifications go to `clients.email` **plus** every row in `client_recipients`; each person gets their own copy addressed to their own first name. `billing_mode` is `per_feature` or `package`.

**Project** — a container of work for one client. Has a free-text `category` (not a fixed list) and `description`, which is its **name**. Also `links[]`.
⚠️ **A project's status is derived, never stored.**

**Feature** — a single deliverable inside a project. **This is the unit of both work and money.**

**billing_periods** — monthly retainer invoices, package clients only. Generated **in arrears**: the invoice raised on 1 June covers May.

**package_migrations** — the record of converting a client from per-feature to package, including what happened to their outstanding balance (`writeoff` / `settle` / `roll_into_first` / `keep_one_time`) and which features were absorbed (those show as "covered").

**activity_logs** — the event feed. It is also the **outbox**: an entry is what makes something visible to the client and emailable.

**change_requests** — a client's proposed edit to already-accepted work, awaiting approve/decline.

## Billing — read this before touching money

**Always check `clients.billing_mode` first.** The two models are mutually exclusive and money lives in completely different places.

### `per_feature` — money lives on the feature

Each feature carries `amount` (the price) and `paid_amount`. Project and client totals are the sum of its features ([`lib/billing.ts`](../lib/billing.ts)):

```
total  = sum(amount)      over features where payment_confirmed !== false
paid   = sum(paid_amount) over the same
pending = total - paid
```

**`payment_confirmed` is the gate.** When `false`:
- the feature renders as **"Rate Pending"** (amber, pulsing dot) in both dashboards
- it contributes **₹0** to every total — it is filtered out of the math entirely
- `amount` is stored as `0` regardless of what you pass

That is the workflow: add the work now, agree the price later, confirm it when settled. Confirming is what makes it count and logs a client-visible **"Rate Confirmed"** entry.

**Derived `payment_status`** (never set it directly):
| Condition | Result |
|---|---|
| `payment_confirmed = false` | `Pending` |
| `amount = 0` | `Paid` |
| `paid_amount >= amount` | `Paid` |
| `paid_amount > 0` | `Partial` |
| otherwise | `Pending` |

### `package` — money lives on the retainer, never the feature

The client pays a recurring fee. Their **features are always ₹0** and are labelled **"Covered"**. Per-feature money math does not apply to them at all.

Client fields: `package_fee`, `package_cadence` (`monthly` \| `quarterly` \| `annual` = 1/3/12 months), `package_started_on`, `package_anchor_day`, `package_status` (`active` \| `paused` \| `ended`).

**Invoices are `billing_periods` rows, generated in arrears.** A charge raised on 1 June covers **May** (`coveragePeriod` shifts back by the cadence). The anchor day is clamped to the month length, so a 31st anchor bills on the 30th in April and returns to the 31st in May. Generation is idempotent — only missing coverage periods are inserted, with `fee_amount = package_fee`, `paid_amount = 0`, `payment_status = 'Pending'`, `origin = 'auto'` — and it runs from both the daily cron and an admin-dashboard fallback. Each new invoice writes an `invoice_generated` activity entry, which is what you can then email.

⚠️ `period_end` is always computed as `period_start + 1 month − 1 day`, so **only `monthly` cadence is fully exercised today**. Quarterly/annual would need that widened.

### ⚠️ The rule that catches everyone: Covered beats Rate Pending

Both dashboards decide a feature's cost cell in **this order**:

1. feature is in `coveredFeatureIds` (absorbed at package conversion) **OR** (`billing_mode = 'package'` **AND** `amount = 0`) → **"Covered"**
2. else `payment_confirmed = false` → **"Rate Pending"**
3. else → the amount

So a package client's ₹0 feature shows as **Covered even when `payment_confirmed` is `false`.** Its raw flag is meaningless — the client never sees "Rate Pending", and **it needs no action**. Do not "fix" these by confirming a rate: it changes nothing the client sees and logs a pointless client-visible "Rate Confirmed" entry.

**Never put a price on a package client's feature** — the retainer already covers it, so a price double-charges. `portalOps` refuses this.

### Switching a client to a package

Recorded in `package_migrations` with what happened to the outstanding balance (`pending_disposition`):

| Disposition | Meaning |
|---|---|
| `writeoff` | Forgive the outstanding balance (the default) |
| `settle` | Treat it as paid in full now |
| `roll_into_first` | Add it to the first retainer invoice |
| `keep_one_time` | Leave it as a separate balance the client still owes |

`affected_feature_ids` lists the features absorbed — those become **"Covered"** permanently via `coveredFeatureIds`. `keep_one_time` deliberately does **not** mark them covered, since that money is still owed.

Historical pre-conversion features keep whatever `amount` they already had — that billing history is preserved, not zeroed.

### Where each number shows up

- **Admin pipeline carousel** — for package clients, three slides: **Package** (retainer, from `billing_periods`), **Custom** (legacy per-feature money), **Total** (both). Each shows collected as the hero with billed/outstanding beneath.
- **Client portal** — package clients see the retainer, the latest invoice and earlier invoices; per-feature clients see the total/paid/pending table. A package project with no per-feature money shows a "Covered under monthly package" note instead of a ₹0 table.

## Status vocabulary

- **Feature:** `Requested → Approved → Working → Updating → Completed`
- **Project override:** `On Hold` | `Cancelled` | `Requested` | `null`

**Derivation rule** (override wins, else derived from the features):
- no features, or every feature still Requested/Approved → **Not Started**
- every feature Completed → **Completed**
- otherwise → **In Progress**

## Rules that are easy to get wrong

1. **An operation is not finished until an `activity_logs` row exists.** That row is what the client sees and what you can email.
2. **Emails are manual.** Writing a log notifies nobody — Rohan sends it from the activity feed, which stamps `notified_at`.
3. **Clients never set price, status, or category.** They describe what they want; Rohan prices and schedules it.
4. **Client-created items** are `origin='client'` and land as `Requested`, rate-pending. The client can edit or withdraw them **only while still Requested**.
5. **Changing the status off `Requested` = accepting it**, which locks the client out. For a requested *project*, accepting means clearing the `Requested` override.
6. Completed work cannot be change-requested.

## Sections

- **Admin:** clients → projects → features → links → activity. The pipeline card shows collected vs outstanding (package clients get Package / Custom / Total slices).
- **Client portal:** overview (package or per-feature snapshot), projects, activity log with PDF export, work-momentum chart.

## Conventions

- Money is rupees, formatted `en-IN`.
- Dates are `YYYY-MM-DD`; package date math lives in `lib/packageDates.ts` and is always passed `today` explicitly.
- Anything an agent changes is stamped `metadata.via = 'agent'` in the activity log, so it can be audited and reversed.
