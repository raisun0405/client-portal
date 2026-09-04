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

## The two billing models

This is the biggest source of mistakes. Check `billing_mode` before touching money.

- **`per_feature`** — each feature carries a price. `payment_confirmed = false` means the feature shows as **"Rate Pending"** and contributes **₹0** to all totals until you confirm a rate.
- **`package`** — the client pays a recurring retainer (`package_fee`, cadence, anchor day). Their **features must stay at ₹0** — the work is "covered". All money lives in `billing_periods`. Putting a price on a package client's feature double-charges them.

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
