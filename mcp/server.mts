#!/usr/bin/env node
// Local stdio MCP server for the client portal.
//
// LOCAL ONLY: Claude Code spawns this as a child process on this machine. It is
// not hosted and is not a claude.ai connector. Secrets stay in this repo's .env.
//
// It contains NO business logic — every write delegates to lib/portalOps.ts, the
// same module the admin UI uses, so an agent cannot skip the activity log or any
// other side effect. Domain knowledge ships as the server `instructions` below,
// so any session gets the vocabulary without you pasting context.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// --- Load this repo's .env before importing anything that reads process.env ---
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { updateFeature, getPending } = await import('../lib/portalOps.js');
const DOMAIN = readFileSync(resolve(ROOT, 'docs/PORTAL_DOMAIN.md'), 'utf8');

const server = new McpServer(
    { name: 'client-portal', version: '1.0.0' },
    {
        instructions:
            'Operate the Rai Sun client portal. ALWAYS use these tools for portal changes — never raw SQL, ' +
            'because these tools also write the activity log and run the cascades the admin UI performs. ' +
            'Read portal://domain first if you are unsure about vocabulary or rules.\n\n' + DOMAIN,
    },
);

// Domain model as a resource, so it can be re-read on demand.
server.resource('portal-domain', 'portal://domain', async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: DOMAIN }],
}));

const fmt = (r: { ok: boolean; message: string; data?: any }) => ({
    content: [{ type: 'text' as const, text: r.ok ? `OK — ${r.message}\n\n${JSON.stringify(r.data, null, 2)}` : `FAILED — ${r.message}` }],
    isError: !r.ok,
});

server.tool(
    'portal_pending',
    'Everything awaiting action across the portal, using its real definition of pending: rate-pending features, ' +
    'open client project/feature requests, pending change requests, unpaid package invoices, and activity updates ' +
    'not yet emailed to the client. Start here for "what needs my attention?".',
    { clientId: z.string().uuid().optional().describe('Limit to one client. Omit for everything.') },
    async ({ clientId }) => fmt(await getPending(clientId)),
);

server.tool(
    'portal_set_feature_status',
    'Move a feature along the delivery ladder: Requested -> Approved -> Working -> Updating -> Completed. ' +
    'Also writes the matching activity log entry, and fires a "Project Completed" entry if this was the last ' +
    'outstanding feature. Moving a client-requested feature off "Requested" accepts it and locks the client out of editing it.',
    {
        featureId: z.string().uuid().describe('The feature to update.'),
        status: z.enum(['Requested', 'Approved', 'Working', 'Updating', 'Completed']),
    },
    async ({ featureId, status }) => fmt(await updateFeature({ featureId, status, via: 'agent' })),
);

server.tool(
    'portal_confirm_rate',
    'Set a per-feature client\'s price for a feature and confirm it (clears "Rate Pending", so the amount starts ' +
    'counting toward project totals). Refuses on package clients, whose work is covered by the retainer. ' +
    'Confirm the amount with the user before calling — this changes what the client is billed.',
    {
        featureId: z.string().uuid(),
        amount: z.number().nonnegative().describe('Price in rupees.'),
    },
    async ({ featureId, amount }) => fmt(await updateFeature({ featureId, amount, paymentConfirmed: true, via: 'agent' })),
);

server.tool(
    'portal_record_feature_payment',
    'Record the total amount paid so far against a per-feature charge. Derives Paid/Partial/Pending and logs a ' +
    '"Payment Received" entry for the difference. Pass the new cumulative total, not the increment.',
    {
        featureId: z.string().uuid(),
        paidAmount: z.number().nonnegative().describe('New cumulative amount paid, in rupees.'),
    },
    async ({ featureId, paidAmount }) => fmt(await updateFeature({ featureId, paidAmount, via: 'agent' })),
);

server.tool(
    'portal_update_feature',
    'General-purpose feature edit — pass only the fields you want changed; the rest are preserved. Use the more ' +
    'specific tools when they fit, since they read more clearly in the activity log.',
    {
        featureId: z.string().uuid(),
        description: z.string().min(3).max(200).optional(),
        estimation: z.string().max(100).optional(),
        status: z.enum(['Requested', 'Approved', 'Working', 'Updating', 'Completed']).optional(),
        amount: z.number().nonnegative().optional(),
        paidAmount: z.number().nonnegative().optional(),
        paymentConfirmed: z.boolean().optional().describe('false = show as Rate Pending and contribute 0.'),
    },
    async (args) => fmt(await updateFeature({ ...args, via: 'agent' })),
);

await server.connect(new StdioServerTransport());
