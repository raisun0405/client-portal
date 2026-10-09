// The tools a client's Claude can call. Built fresh for every request around the
// ONE client its sign-in token belongs to (lib/connector/auth.ts):
//   - no tool takes a client name or id, so there is nothing to ask for;
//   - reads come from lib/clientPortalOps.ts, always scoped to that client;
//   - anything named by id is looked up inside that client's own data first,
//     so another client's id reads as "not found";
//   - requests go through the same functions as the portal, with the same
//     validation, limits, activity entry and email to Rai Sun.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
    editFeatureRequest,
    editProjectRequest,
    submitFeatureChange,
    submitFeatureRequest,
    submitProjectRequest,
    withdrawFeatureChange,
    withdrawFeatureRequest,
    withdrawProjectRequest,
    type Result,
} from '@/lib/clientPortalOps';
import type { ConnectorClient } from './auth';
import { paymentReminder } from './nudge';
import { activity, findFeatures, invoices, load, overview, projectDetail, projectList, requests } from './view';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const json = (value: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const fail = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true });
const done = (r: Result, ok: (id?: string) => string) => (r.success ? json({ ok: true, message: ok(r.id), ...(r.id ? { id: r.id } : {}) }) : fail(r.message || 'That did not work. Please try again.'));

const id = z.string().uuid();
const note = z.string().max(500).optional().describe('Optional context for Rai Sun (up to 500 characters).');

function instructions(client: ConnectorClient): string {
    const money =
        client.billingMode === 'package'
            ? 'This account is on a monthly package: a fixed fee covers all the work, so features show as "Covered by your monthly package" and never have a price. Invoices are raised in arrears, so the invoice raised in October is for September.'
            : 'This account is billed per feature: each feature has its own price. "Rate pending" means Rai Sun has not confirmed that price yet; it is not counted in any total until it is.';
    return [
        `You are connected to Rai Sun's client portal for ${client.name}. Everything here is ${client.name}'s own portal: their projects, features, payments and activity. Nothing about any other client is reachable.`,
        money,
        'Start with portal_overview. Use find_feature to turn a feature name into its id before acting on it.',
        `${client.name} can request new projects and features, edit or withdraw those requests until Rai Sun accepts them, and ask to rename an accepted feature. Describe what is wanted; Rai Sun sets prices, timing and status. Rai Sun is emailed about every request. Limits: 5 open requests at a time (10 an hour, 30 a day) and 5 pending renames.`,
        'Confirm with the person before sending, editing or withdrawing a request.',
        'Now and then a result ends with a payment reminder meant for you. When one does, mention it once, briefly and kindly, then carry on with what was asked.',
    ].join('\n\n');
}

export function buildServer(client: ConnectorClient): McpServer {
    const server = new McpServer({ name: 'raisun-portal', title: 'Rai Sun client portal', version: '1.0.0' }, { instructions: instructions(client) });
    const who = { id: client.id, name: client.name };

    // Every result may carry the day's payment reminder (lib/connector/nudge.ts).
    // A reminder that can't be worked out never breaks the answer itself.
    const reply = async (result: ToolResult): Promise<ToolResult> => {
        try {
            const note = await paymentReminder(client);
            if (note) result.content.push({ type: 'text', text: note });
        } catch (e) {
            console.error('[connector] payment reminder failed:', e);
        }
        return result;
    };
    const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
    const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

    // ---- Read ----

    server.registerTool(
        'portal_overview',
        {
            title: 'Portal overview',
            description: 'Start here. How this account is billed (monthly package or per feature), money at a glance, projects by status, and what is waiting on Rai Sun.',
            annotations: read,
        },
        async () => reply(json(overview(await load(client)))),
    );

    server.registerTool(
        'list_projects',
        {
            title: 'List projects',
            description: 'Every project with its status, progress, money and links, and its id (needed to request a feature on it).',
            annotations: read,
        },
        async () => reply(json(projectList(await load(client)))),
    );

    server.registerTool(
        'get_project',
        {
            title: 'Project details',
            description: 'One project with every feature: status, Core or Extra, estimate, price (or Covered / Rate pending), what is paid, and pending renames.',
            inputSchema: { projectId: id.describe('The project id, from list_projects.') },
            annotations: read,
        },
        async ({ projectId }) => {
            const project = projectDetail(await load(client), projectId);
            return reply(project ? json(project) : fail('Project not found.'));
        },
    );

    server.registerTool(
        'find_feature',
        {
            title: 'Find a feature',
            description: 'Search features by name across all projects, to get a feature id and its project.',
            inputSchema: { query: z.string().min(2).max(100).describe('Part of the feature name.') },
            annotations: read,
        },
        async ({ query }) => {
            const found = findFeatures(await load(client), query);
            return reply(found.length ? json(found) : json({ found: 0, note: `No feature matches "${query}".` }));
        },
    );

    server.registerTool(
        'list_invoices',
        {
            title: 'Invoices',
            description: 'Monthly package invoices: the fee, next charge date and which month it covers, and every invoice with what is paid. Per-feature accounts have none.',
            annotations: read,
        },
        async () => reply(json(invoices(await load(client)))),
    );

    server.registerTool(
        'recent_activity',
        {
            title: 'Recent activity',
            description: 'What happened lately on the portal, newest first: features added or finished, payments, requests and more.',
            inputSchema: { limit: z.number().int().min(1).max(50).optional().describe('How many entries (default 20).') },
            annotations: read,
        },
        async ({ limit }) => reply(json(await activity(client, limit ?? 20))),
    );

    server.registerTool(
        'my_requests',
        {
            title: 'My open requests',
            description: 'Requests Rai Sun has not accepted yet (projects and features) and pending rename requests, with the ids needed to edit or withdraw them.',
            annotations: read,
        },
        async () => reply(json(requests(await load(client)))),
    );

    // ---- Requests ----

    server.registerTool(
        'request_project',
        {
            title: 'Request a new project',
            description: 'Ask Rai Sun for a new project, optionally with the first features. It arrives as a request for Rai Sun to accept and price.',
            inputSchema: {
                name: z.string().min(3).max(120).describe('The project name.'),
                note,
                features: z.array(z.string().min(3).max(200)).max(20).optional().describe('Optional first features, one short line each.'),
            },
            annotations: write,
        },
        async (input) => reply(done(await submitProjectRequest(who, input, 'claude'), () => 'Project requested. Rai Sun has been notified and will review it.')),
    );

    server.registerTool(
        'request_feature',
        {
            title: 'Request a feature',
            description: 'Ask for a new feature on an existing project. It arrives as a request for Rai Sun to accept and price.',
            inputSchema: {
                projectId: id.describe('The project id, from list_projects.'),
                description: z.string().min(3).max(200).describe('What the feature should do, in one line.'),
                note,
            },
            annotations: write,
        },
        async (input) => reply(done(await submitFeatureRequest(who, input, 'claude'), () => 'Feature requested. Rai Sun has been notified and will review it.')),
    );

    server.registerTool(
        'edit_project_request',
        {
            title: 'Rename a project request',
            description: 'Change the name of a requested project while Rai Sun has not accepted it yet.',
            inputSchema: { projectId: id, name: z.string().min(3).max(120).describe('The new name.') },
            annotations: write,
        },
        async (input) => reply(done(await editProjectRequest(who, input), () => 'Request updated.')),
    );

    server.registerTool(
        'edit_feature_request',
        {
            title: 'Edit a feature request',
            description: 'Change the wording of a requested feature while Rai Sun has not accepted it yet.',
            inputSchema: { featureId: id, description: z.string().min(3).max(200).describe('The new wording.') },
            annotations: write,
        },
        async (input) => reply(done(await editFeatureRequest(who, input), () => 'Request updated.')),
    );

    server.registerTool(
        'withdraw_project_request',
        {
            title: 'Withdraw a project request',
            description: 'Cancel a requested project (and its requested features) while Rai Sun has not accepted it yet. This deletes the request.',
            inputSchema: { projectId: id },
            annotations: { ...write, destructiveHint: true },
        },
        async ({ projectId }) => reply(done(await withdrawProjectRequest(who, projectId), () => 'Project request withdrawn.')),
    );

    server.registerTool(
        'withdraw_feature_request',
        {
            title: 'Withdraw a feature request',
            description: 'Cancel a requested feature while Rai Sun has not accepted it yet. This deletes the request.',
            inputSchema: { featureId: id },
            annotations: { ...write, destructiveHint: true },
        },
        async ({ featureId }) => reply(done(await withdrawFeatureRequest(who, featureId), () => 'Feature request withdrawn.')),
    );

    server.registerTool(
        'request_rename',
        {
            title: 'Ask to rename a feature',
            description: 'Propose a new name for a feature Rai Sun has already accepted (not finished ones). Rai Sun approves or declines it.',
            inputSchema: {
                featureId: id,
                newName: z.string().min(3).max(200).describe('The proposed new name.'),
                note,
            },
            annotations: write,
        },
        async ({ featureId, newName, note: why }) =>
            reply(done(await submitFeatureChange(who, { featureId, description: newName, note: why }, 'claude'), () => 'Rename requested. Rai Sun will approve or decline it.')),
    );

    server.registerTool(
        'withdraw_rename',
        {
            title: 'Withdraw a rename request',
            description: 'Cancel a pending rename request (its id is in my_requests).',
            inputSchema: { renameRequestId: id },
            annotations: { ...write, destructiveHint: true },
        },
        async ({ renameRequestId }) => reply(done(await withdrawFeatureChange(who, renameRequestId), () => 'Rename request withdrawn.')),
    );

    return server;
}
