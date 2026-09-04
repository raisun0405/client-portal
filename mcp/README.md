# Client Portal MCP Server

A **local** MCP server that lets Claude Code operate the client portal — read what needs attention and make changes — from any session, without pasting context.

**Server name:** `client-portal` · **Transport:** stdio · **Entry:** [`mcp/server.mts`](./server.mts)

---

## Why this exists

Portal changes have side effects. Updating a feature status doesn't just write a row — it also writes an **activity log** entry (which is what the client sees and what you can email), and may cascade a *"Project Completed"* entry.

That logic used to live **only inside `app/admin/dashboard/page.tsx`**, in React `onClick` handlers. So when Claude edited the database directly with SQL, it wasn't forgetting the activity log — **the rule didn't exist anywhere it could reach.** Results were inconsistent: sometimes right, sometimes missing pieces.

This server fixes that by construction:

```
mcp/server.mts        ← thin: typed tools, zero business logic
      ↓ imports
lib/portalOps.ts      ← THE single source of truth (write + activity log + cascades)
      ↓ uses
lib/supabaseServer.ts ← server-only secret key
```

Every write goes through `portalOps`, so a step **cannot** be skipped.

> ⚠️ **Known gap:** the admin UI still contains its own inline copy of the feature-update logic (`handleSaveFeature`). Until that's rewired to call `portalOps`, two implementations exist and could drift. Finishing that migration is the top follow-up.

---

## Privacy

**Local only.** Claude Code spawns this as a child process on your machine. It is **not hosted** and **not a claude.ai connector** — nothing is exposed to the website. Your `SUPABASE_SECRET_KEY` stays in the repo's gitignored `.env`.

*(Inherent caveat: tool **results** travel to the model as conversation context, like any file you show Claude.)*

---

## Tools

### Read

| Tool | Purpose |
|---|---|
| `portal_pending` | Everything awaiting action, using the portal's real definition: rate-pending features, open client project/feature requests, pending change requests, unpaid package invoices, and updates not yet emailed. Optional `clientId`. |
| `portal_find_feature` | Resolve plain language → IDs. Substring match on the description, optionally scoped by `clientName`. Returns status, project, client and money state. **Use this first**, then pass `featureId` to a write tool. |

### Write

| Tool | Purpose |
|---|---|
| `portal_set_feature_status` | Move along `Requested → Approved → Working → Updating → Completed`. Logs it and cascades project completion. Moving a client-requested feature off `Requested` **accepts** it and locks the client out of editing. |
| `portal_confirm_rate` | Set a per-feature price and confirm it (clears *Rate Pending*). **Refuses on package clients.** |
| `portal_record_feature_payment` | Record the new **cumulative** amount paid; derives Paid/Partial/Pending and logs the difference. |
| `portal_update_feature` | General edit — pass only fields you want changed. |

### Resource

`portal://domain` — the full domain model ([`docs/PORTAL_DOMAIN.md`](../docs/PORTAL_DOMAIN.md)), also injected as the server's `instructions` so every session knows the vocabulary and rules automatically.

---

## Safety

- **Package clients are protected** — pricing their feature is refused (the retainer already covers it; a price would double-charge).
- **Attribution** — every agent change is stamped `metadata.via = 'agent'` in the activity log, so it's auditable and reversible.
- **No deletes exposed.**
- **Emails stay manual** — these tools never email a client. They create the activity entry; you send it from the admin activity feed.

---

## Setup

Already registered. To reproduce on a new machine:

```bash
npm install                    # installs @modelcontextprotocol/sdk + tsx (devDeps)

claude mcp add client-portal --scope user -- \
  npx tsx "<ABSOLUTE_PATH_TO_REPO>/mcp/server.mts"
```

`--scope user` writes to `~/.claude.json`, which **both the CLI and the VS Code extension** read — one registration covers every session and directory.

**Requires** a `.env` at the repo root with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`. The server loads it by absolute path (derived from `import.meta.url`), so it works regardless of your working directory.

### Verify

```bash
claude mcp list          # → client-portal: ✔ Connected
```

Then restart Claude Code and run `/mcp`, or just ask *"what's pending?"*

---

## Usage

Talk normally — no need to name the server:

- *"what's pending?"* / *"what's pending for Ritika?"*
- *"mark the dark mode feature as completed"*
- *"confirm the rate for the login page at 15000"*
- *"record 5000 paid on the contact form"*

Claude resolves names to IDs via `portal_find_feature` and asks you to disambiguate when several match.

---

## Gotchas

- **Don't move or rename the repo** — the registration hardcodes the absolute path. If you do: `claude mcp remove client-portal`, then re-add.
- Registering mid-session doesn't load it; **restart Claude Code**.
- `server.mts` uses the `.mts` extension deliberately — the package isn't `"type": "module"`, and `.mts` forces ESM so top-level `await` works under `tsx`.
- It imports `../lib/portalOps.js` (`.js`, not `.ts`) to satisfy `tsc`; `tsx` resolves it to the TypeScript source at runtime.

---

## Extending

Add an operation in **`lib/portalOps.ts`** (never in the server), then expose it in `server.mts` with a description that explains the domain rule it enforces.

Still to add: `update_client`, `add_feature`, `record_package_payment`, `accept_request`, `send_update`.

Run `npx tsx scripts/check-domain-doc.mts` to catch the domain doc drifting from the code.
