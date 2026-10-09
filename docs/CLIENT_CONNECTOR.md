# Client Claude connector

A hosted MCP connector that lets a **client's own Claude** (web, desktop or phone) read **their** portal and send requests. The client signs in with their portal access key.

**Address:** `https://track.raisun.dev/mcp` · **Sign-in:** OAuth 2.1 + PKCE; the client types their access key · **Off by default:** only clients you switch on can connect.

> This is not the local admin server in [`mcp/README.md`](../mcp/README.md). That one runs only on your machine and can change anything. This one is public, for clients, and each sign-in is locked to one client. It has no admin tools.

---

## Connecting (the client)

1. You switch **Claude access** on for them (see below) and send them the address.
2. In Claude they open **Settings → Connectors → Add custom connector**, paste `https://track.raisun.dev/mcp`, and press **Connect**.
3. A Rai Sun page opens on `track.raisun.dev`. They type their **access key**, the same one they use for the portal, and press **Connect**.
4. That's it. They can now ask things like *"what's pending on my projects?"*, *"how much do I owe?"* or *"request a dark mode feature on the website project"*.

If something is off, the sign-in page tells them:

| Situation | The page says |
|---|---|
| Wrong key | That access key isn't right. Check it and try again. (401) |
| A real key, but access isn't switched on | Claude access isn't switched on for your portal yet. Ask Rai Sun to turn it on, then try again. (403) |
| 5 wrong keys from one address, or 30 in total, within 15 minutes | Too many attempts. Please wait 15 minutes, then try again. (429) |

## Switching access (you)

On the **admin website**, use the client's menu on the overview. In **Folio**, use the menu on the client screen; the on/off switch is also in the long-press menu on Clients.

| Action | Effect |
|---|---|
| **Turn on Claude access** | The client can connect. The client gets a **Claude** badge. |
| **Turn off Claude access** | Every Claude connected for that client stops working at its next request. Turning access back on lets the same connection work again. |
| **Disconnect Claude** | Ends every connection now by bumping `claude_epoch`. The client can connect again while access is on. |

Changing a client's **access key** also ends every connection. They reconnect with the new key.

To stop it for everyone at once, with no deploy: `update clients set claude_access = false;`

---

## What their Claude can do

Every tool works on the signed-in client only. **No tool takes a client name or id.**

### Read

| Tool | What it returns |
|---|---|
| `portal_overview` | Start here. How the account is billed, money at a glance, projects by status, and what is waiting on Rai Sun. |
| `list_projects` | Every project with its status, progress, money, links and id. |
| `get_project` | One project with every feature: status, Core or Extra, estimate, price (or *Covered* / *Rate pending*), what is paid, and pending renames. |
| `find_feature` | Features whose name contains the given text, to get an id. |
| `list_invoices` | Package invoices: the fee, the next charge, the month each invoice covers, and what is paid. Per-feature accounts have none. |
| `recent_activity` | The portal's activity feed, newest first. Hidden entries never appear. |
| `my_requests` | Requests you haven't accepted yet and pending renames, with their ids. |

### Requests

| Tool | What it does |
|---|---|
| `request_project` | Asks for a new project, optionally with up to 20 first features. |
| `request_feature` | Asks for a new feature on one of their projects. |
| `edit_project_request` / `edit_feature_request` | Rewords a request while it is still *Requested*. |
| `withdraw_project_request` / `withdraw_feature_request` | Deletes a request while it is still *Requested*. |
| `request_rename` / `withdraw_rename` | Proposes a new name for an accepted feature (not a completed one), or takes the proposal back. You approve or decline it as usual. |

Requests run through **the same code as the portal** ([`lib/clientPortalOps.ts`](../lib/clientPortalOps.ts)), so the same rules apply:

- They land as `origin='client'`, *Requested* and rate pending.
- A client can have at most 5 open requests (10 an hour, 30 a day) and 5 pending renames.
- Each one writes the activity entry and emails you.

There are two differences. The activity entry is stamped `metadata.via = 'claude'`, and your email says *"(from their Claude)"*.

Claude is told to confirm with the person before it sends, edits or withdraws anything. Clients still never set price, status or category.

---

## Money: the portal's rules, unchanged

Everything follows `clients.billing_mode` ([`lib/connector/view.ts`](../lib/connector/view.ts)). The full model is in [PORTAL_DOMAIN.md](PORTAL_DOMAIN.md).

- **Per-feature:** each feature shows its price, what is paid, and Paid, Partial or Pending. *Rate pending* (`payment_confirmed = false`) shows those words, never a number, and counts in no total.
- **Package:** features read **"Covered by your monthly package"** and never show a price. Covered beats Rate pending, as on the portal. Invoices are `billing_periods`, billed in arrears, so the invoice raised in October is for September.
- **What's owed** = unpaid package invoices + confirmed per-feature balances. This is the same figure as `getClientBalance` and your payment-reminder email.

## Payment reminders

When the client owes money, a tool result sometimes ends with a note **for Claude**, asking it to mention the amount once, briefly and kindly ([`lib/connector/nudge.ts`](../lib/connector/nudge.ts)):

- The first use of the day carries one. After that, at most **two a day** (India time), at least **4 hours** apart.
- There is never one when nothing is owed.
- Each reminder is recorded in `connector_payment_nudges`. That record is what keeps the limit, even when Claude makes several calls at once.

It is only words in their conversation. Nothing is emailed, and it is separate from your manual **Send payment reminder**.

---

## Security

Everything serves one rule: **a sign-in belongs to exactly one client, fixed at the moment that client typed their key.**

- **One client per sign-in.** The token decides the client, and the tools are built around that client on every request ([`lib/connector/tools.ts`](../lib/connector/tools.ts)). Anything named by id is looked up inside that client's own data first, so another client's id reads as *not found*.
- **Every request is checked:**
  - the token is valid, unexpired and not revoked;
  - the client's `claude_access` is on;
  - `claude_epoch` is unchanged;
  - the access key is still the one they signed in with.
- **Only Claude can sign in.** App registration (`/oauth/register`) accepts only Claude's callbacks, `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback`. The callback is checked again at sign-in. Localhost callbacks are accepted only outside production, for tests.
- **Codes and tokens:**
  - A sign-in code works once, lasts 5 minutes and needs PKCE (S256).
  - An access token lasts 1 hour.
  - A refresh token lasts 30 days and is replaced every time it is used. Presenting one that was already used ends the whole sign-in.
- **Nothing is stored in the clear.** Codes and tokens are stored as SHA-256. The access key is stored as an HMAC keyed by `SESSION_SECRET`, so changing `SESSION_SECRET` disconnects every client.
- **Key guessing is blocked** after 5 failed keys from one address, or 30 in total, within 15 minutes. A real key that just isn't switched on doesn't count as a failure.
- **The tables are server-only.** The connector tables have RLS on with no policies, so only the server's secret key can read them.
- **The sign-in page** can't be shown inside another site, isn't cached, and can only send the form to itself or to Claude's callback.

---

## How it fits together

```
Claude ──► /.well-known/oauth-protected-resource    where to sign in
       ──► /.well-known/oauth-authorization-server  how to sign in
       ──► /oauth/register                          Claude registers itself
       ──► /oauth/authorize                         the client types their key → a one-time code
       ──► /oauth/token                             code → tokens; refresh
       ──► /mcp                                     the tools (POST; stateless JSON replies)
```

| File | Role |
|---|---|
| `app/.well-known/*`, `app/oauth/*`, `app/mcp/route.ts` | The routes above |
| `lib/connector/auth.ts` | Registration, sign-in, tokens, and the check on every request |
| `lib/connector/tools.ts` | The 15 tools, and Claude's instructions for each billing mode |
| `lib/connector/view.ts` | Reads and money, shaped the way the portal shows them |
| `lib/connector/nudge.ts` | Payment reminders |
| `lib/connector/page.ts`, `lib/connector/http.ts` | The sign-in page; CORS and JSON helpers |
| `lib/clientPortalOps.ts` | The portal's own reads and requests, shared by the portal's server actions and the connector |
| `db/migrations/0005_client_connector`, `0006_connector_payment_nudges` | The access switch columns and the connector tables |

In the database:

- `clients.claude_access` (default `false`) and `clients.claude_epoch`.
- The tables `connector_oauth_clients`, `connector_auth_codes`, `connector_tokens`, `connector_signin_attempts` and `connector_payment_nudges`.

---

## Testing

```bash
PORTAL_SKIP_ADMIN_ALERTS=1 npx next dev --port 3000   # turns off the request emails to you
npx tsx scripts/test-connector.mts
```

The test runs against the **real database** with three throwaway clients: A (per-feature), B (package) and C (access off). It signs A and B in exactly as Claude does, then makes 54 checks:

- A and B can't see or touch each other's data, on every read and write;
- the money rules and the payment reminders;
- the sign-in guards;
- switching access off, disconnecting and changing the key;
- reusing an old refresh token.

It deletes everything it made at the end. It prints results only, never keys or tokens.

After a deploy, switch on a test client, connect from a separate Claude account, and ask *"what's on my portal?"*.

## Rollback

1. **Stop it without a deploy:** turn Claude access off, for one client or for everyone with the `update` above.
2. **Remove the code:** `git revert` the connector commit and push.
3. **Then the database, newest first:** run `0006_connector_payment_nudges.down.sql`, then `0005_client_connector.down.sql` (see [`db/ROLLBACK.md`](../db/ROLLBACK.md)). Revert the code before this step, because the connector reads these tables.
