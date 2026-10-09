'use server';

// Client-portal WRITE actions: submitting, editing, and withdrawing requests.
// Every action derives the client from the signed session (never an argument)
// and hands it to lib/clientPortalOps.ts, which enforces ownership, the "still
// Requested" gate (so a client can never touch work you've already accepted),
// validation and the request limits. The Claude connector uses the same
// functions, so both paths follow identical rules.
import { getClientSession } from '@/app/actions';
import {
    editFeatureRequest,
    editProjectRequest,
    readPendingChanges,
    submitFeatureChange,
    submitFeatureRequest,
    submitProjectRequest,
    withdrawFeatureChange,
    withdrawFeatureRequest,
    withdrawProjectRequest,
    type PortalClient,
    type Result,
} from '@/lib/clientPortalOps';

async function requireSession(): Promise<PortalClient | null> {
    const s = await getClientSession();
    return s?.id ? (s as PortalClient) : null;
}

const SIGN_IN_AGAIN: Result = { success: false, message: 'Please sign in again.' };

// ---- Submit ----

export async function requestProject(input: { name: string; note?: string; features?: string[] }): Promise<Result> {
    const s = await requireSession();
    return s ? submitProjectRequest(s, input) : SIGN_IN_AGAIN;
}

export async function requestFeature(input: { projectId: string; description: string; note?: string }): Promise<Result> {
    const s = await requireSession();
    return s ? submitFeatureRequest(s, input) : SIGN_IN_AGAIN;
}

// ---- Edit (only while still Requested) ----

export async function editRequestedProject(input: { projectId: string; name: string }): Promise<Result> {
    const s = await requireSession();
    return s ? editProjectRequest(s, input) : SIGN_IN_AGAIN;
}

export async function editRequestedFeature(input: { featureId: string; description: string }): Promise<Result> {
    const s = await requireSession();
    return s ? editFeatureRequest(s, input) : SIGN_IN_AGAIN;
}

// ---- Withdraw (hard delete, only while still Requested) ----

export async function withdrawRequestedProject(projectId: string): Promise<Result> {
    const s = await requireSession();
    return s ? withdrawProjectRequest(s, projectId) : SIGN_IN_AGAIN;
}

export async function withdrawRequestedFeature(featureId: string): Promise<Result> {
    const s = await requireSession();
    return s ? withdrawFeatureRequest(s, featureId) : SIGN_IN_AGAIN;
}

// ---- Change requests on LOCKED (accepted, non-completed) features ----

export async function requestFeatureChange(input: { featureId: string; description: string; note?: string }): Promise<Result> {
    const s = await requireSession();
    return s ? submitFeatureChange(s, input) : SIGN_IN_AGAIN;
}

export async function withdrawChangeRequest(changeRequestId: string): Promise<Result> {
    const s = await requireSession();
    return s ? withdrawFeatureChange(s, changeRequestId) : SIGN_IN_AGAIN;
}

// The caller's pending change requests, keyed by target — the portal uses this
// to mark rows "change pending" and to offer withdraw.
export async function getMyPendingChanges(): Promise<Awaited<ReturnType<typeof readPendingChanges>>> {
    const s = await requireSession();
    return s ? readPendingChanges(s.id) : [];
}
