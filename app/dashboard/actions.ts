'use server';

// Server actions that back the client portal's data layer. Every action derives
// the caller's client_id from the signed session cookie (never from an argument)
// and reads through lib/clientPortalOps.ts, which queries with the server-only
// secret key scoped to that client_id. This is what lets us deny the anon
// browser at the RLS layer without the portal losing access to its own data.
// (The Claude connector reads through the same functions.)
import { getClientSession } from '@/app/actions';
import { readActivityLogs, readPortalCore, readProjectFeatures, readProjectsWithFeatures, readPulseLogs } from '@/lib/clientPortalOps';

async function requireClientId(): Promise<string | null> {
    const session = await getClientSession();
    return session?.id ?? null;
}

// Client-level package/retainer info + billing periods + covered-feature sets.
export async function getPortalCore() {
    const clientId = await requireClientId();
    if (!clientId) return null;
    return readPortalCore(clientId);
}

// All of the client's projects plus every feature under them (raw rows — the UI
// computes per-project stats).
export async function getProjectsWithFeatures() {
    const clientId = await requireClientId();
    if (!clientId) return null;
    return readProjectsWithFeatures(clientId);
}

// Features for a single project — with an ownership check so a client can't read
// another client's project by guessing its id.
export async function getProjectFeatures(projectId: string) {
    const clientId = await requireClientId();
    if (!clientId) return null;
    return readProjectFeatures(clientId, projectId);
}

// Timeline logs (non-hidden).
export async function getPortalActivityLogs(limit = 25) {
    const clientId = await requireClientId();
    if (!clientId) return [];
    return readActivityLogs(clientId, limit);
}

// Lightweight momentum data since `sinceISO` (window computed client-side from
// local midnight, then passed in — it's only a date filter, and the action is
// already scoped to the caller's own logs).
export async function getPortalPulseLogs(sinceISO: string) {
    const clientId = await requireClientId();
    if (!clientId) return [];
    return readPulseLogs(clientId, sinceISO);
}
