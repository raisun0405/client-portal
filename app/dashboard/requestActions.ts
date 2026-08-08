'use server';

// Client-portal WRITE actions: submitting, editing, and withdrawing requests.
// Every action derives client_id from the signed session (never an argument),
// runs on the server-only secret key, and enforces ownership + a "still
// Requested" gate so a client can never touch work you've already accepted.
import { supabaseService } from '@/lib/supabaseServer';
import { getClientSession } from '@/app/actions';
import { notifyAdminOfRequest } from '@/lib/notifications';

type Result = { success: boolean; message?: string; id?: string };

// Guardrails
const MAX_OPEN = 5;          // concurrent un-accepted requests
const MAX_PER_HOUR = 10;
const MAX_PER_DAY = 30;
// Validation
const NAME_MIN = 3, NAME_MAX = 120;
const DESC_MIN = 3, DESC_MAX = 200;
const NOTE_MAX = 500;
const MAX_INITIAL_FEATURES = 20;

const clean = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');

async function requireSession(): Promise<{ id: string; name?: string } | null> {
    const s = await getClientSession();
    return s?.id ? (s as { id: string; name?: string }) : null;
}

// Cap concurrent open requests and rate-limit new ones. Returns an error message
// to show the client, or null if they're clear to submit.
async function checkGuardrails(db: any, clientId: string): Promise<string | null> {
    const { data: projects } = await db
        .from('projects')
        .select('id, origin, status_override, created_at')
        .eq('client_id', clientId);
    const projectIds = (projects || []).map((p: any) => p.id);

    let features: any[] = [];
    if (projectIds.length) {
        const { data: f } = await db
            .from('features')
            .select('status, created_at')
            .in('project_id', projectIds)
            .eq('origin', 'client');
        features = f || [];
    }

    const clientProjects = (projects || []).filter((p: any) => p.origin === 'client');
    const openCount =
        clientProjects.filter((p: any) => p.status_override === 'Requested').length +
        features.filter((f: any) => f.status === 'Requested').length;
    if (openCount >= MAX_OPEN) {
        return `You already have ${MAX_OPEN} open requests. Please wait for those to be reviewed before adding more.`;
    }

    const times = [...clientProjects, ...features].map((x: any) => new Date(x.created_at).getTime());
    const now = Date.now();
    if (times.filter(t => t >= now - 3_600_000).length >= MAX_PER_HOUR) {
        return 'You’re sending requests too quickly — please try again in a little while.';
    }
    if (times.filter(t => t >= now - 86_400_000).length >= MAX_PER_DAY) {
        return 'You’ve reached the daily request limit — please try again tomorrow.';
    }
    return null;
}

// Record the request in the activity feed (secret key — server-side; can't use
// the browser logActivity here) and email the admin. Both best-effort.
async function logAndNotify(
    db: any,
    args: { clientId: string; clientName?: string; projectId: string | null; actionType: string; title: string; description: string; metadata: Record<string, any> },
) {
    try {
        await db.from('activity_logs').insert({
            client_id: args.clientId,
            project_id: args.projectId,
            action_type: args.actionType,
            title: args.title,
            description: args.description,
            metadata: args.metadata,
        });
    } catch (e) { console.error('request log failed:', e); }
    try {
        await notifyAdminOfRequest({ clientName: args.clientName || 'A client', title: args.title, description: args.description });
    } catch (e) { console.error('request email failed:', e); }
}

// ---- Submit ----

export async function requestProject(input: { name: string; note?: string; features?: string[] }): Promise<Result> {
    const s = await requireSession();
    if (!s) return { success: false, message: 'Please sign in again.' };
    const db = supabaseService();

    const name = clean(input.name), note = clean(input.note);
    if (name.length < NAME_MIN || name.length > NAME_MAX) return { success: false, message: `Project name must be ${NAME_MIN}–${NAME_MAX} characters.` };
    if (note.length > NOTE_MAX) return { success: false, message: `Note must be ${NOTE_MAX} characters or fewer.` };
    const features = (input.features || []).map(clean).filter(Boolean).slice(0, MAX_INITIAL_FEATURES);

    const blocked = await checkGuardrails(db, s.id);
    if (blocked) return { success: false, message: blocked };

    const { data: proj, error } = await db.from('projects').insert({
        client_id: s.id,
        category: 'Uncategorized',        // you assign the real category on accept
        description: name,
        status: 'Requested',
        status_override: 'Requested',     // drives the "Requested" display until accepted
        origin: 'client',
        links: [],
        total_amount: 0,
        payment_status: 'Pending',
    }).select('id').single();
    if (error || !proj) return { success: false, message: error?.message || 'Could not submit your request.' };

    if (features.length) {
        await db.from('features').insert(features.map((description: string) => ({
            project_id: proj.id, description, status: 'Requested', origin: 'client',
            amount: 0, paid_amount: 0, payment_status: 'Pending', payment_confirmed: false,
        })));
    }

    const desc = `${s.name || 'A client'} requested a new project: “${name}”${note ? ` — ${note}` : ''}${features.length ? ` · ${features.length} feature${features.length > 1 ? 's' : ''}` : ''}`;
    await logAndNotify(db, { clientId: s.id, clientName: s.name, projectId: proj.id, actionType: 'project_requested', title: `Project requested: ${name}`, description: desc, metadata: { origin: 'client', note, features } });
    return { success: true, id: proj.id };
}

export async function requestFeature(input: { projectId: string; description: string; note?: string }): Promise<Result> {
    const s = await requireSession();
    if (!s) return { success: false, message: 'Please sign in again.' };
    const db = supabaseService();

    const description = clean(input.description), note = clean(input.note);
    if (description.length < DESC_MIN || description.length > DESC_MAX) return { success: false, message: `Feature must be ${DESC_MIN}–${DESC_MAX} characters.` };
    if (note.length > NOTE_MAX) return { success: false, message: `Note must be ${NOTE_MAX} characters or fewer.` };

    const { data: proj } = await db.from('projects').select('id, description').eq('id', input.projectId).eq('client_id', s.id).single();
    if (!proj) return { success: false, message: 'Project not found.' };

    const blocked = await checkGuardrails(db, s.id);
    if (blocked) return { success: false, message: blocked };

    const { data: feat, error } = await db.from('features').insert({
        project_id: proj.id, description, status: 'Requested', origin: 'client',
        amount: 0, paid_amount: 0, payment_status: 'Pending', payment_confirmed: false,
    }).select('id').single();
    if (error || !feat) return { success: false, message: error?.message || 'Could not submit your request.' };

    const desc = `${s.name || 'A client'} requested a feature on “${proj.description}”: “${description}”${note ? ` — ${note}` : ''}`;
    await logAndNotify(db, { clientId: s.id, clientName: s.name, projectId: proj.id, actionType: 'feature_requested', title: `Feature requested: ${description}`, description: desc, metadata: { origin: 'client', note } });
    return { success: true, id: feat.id };
}

// ---- Edit (only while still Requested) ----

export async function editRequestedProject(input: { projectId: string; name: string }): Promise<Result> {
    const s = await requireSession();
    if (!s) return { success: false, message: 'Please sign in again.' };
    const db = supabaseService();
    const name = clean(input.name);
    if (name.length < NAME_MIN || name.length > NAME_MAX) return { success: false, message: `Project name must be ${NAME_MIN}–${NAME_MAX} characters.` };

    const { data: proj } = await db.from('projects').select('id, origin, status_override').eq('id', input.projectId).eq('client_id', s.id).single();
    if (!proj) return { success: false, message: 'Project not found.' };
    if (proj.origin !== 'client' || proj.status_override !== 'Requested') return { success: false, message: 'This request has already been accepted and can no longer be edited.' };

    const { error } = await db.from('projects').update({ description: name }).eq('id', proj.id);
    if (error) return { success: false, message: error.message };
    return { success: true, id: proj.id };
}

export async function editRequestedFeature(input: { featureId: string; description: string }): Promise<Result> {
    const s = await requireSession();
    if (!s) return { success: false, message: 'Please sign in again.' };
    const db = supabaseService();
    const description = clean(input.description);
    if (description.length < DESC_MIN || description.length > DESC_MAX) return { success: false, message: `Feature must be ${DESC_MIN}–${DESC_MAX} characters.` };

    const { data: feat } = await db.from('features').select('id, origin, status, project_id').eq('id', input.featureId).single();
    if (!feat) return { success: false, message: 'Feature not found.' };
    const { data: proj } = await db.from('projects').select('client_id').eq('id', feat.project_id).single();
    if (!proj || proj.client_id !== s.id) return { success: false, message: 'Feature not found.' };
    if (feat.origin !== 'client' || feat.status !== 'Requested') return { success: false, message: 'This request has already been accepted and can no longer be edited.' };

    const { error } = await db.from('features').update({ description }).eq('id', feat.id);
    if (error) return { success: false, message: error.message };
    return { success: true, id: feat.id };
}

// ---- Withdraw (hard delete, only while still Requested) ----

export async function withdrawRequestedProject(projectId: string): Promise<Result> {
    const s = await requireSession();
    if (!s) return { success: false, message: 'Please sign in again.' };
    const db = supabaseService();

    const { data: proj } = await db.from('projects').select('id, origin, status_override').eq('id', projectId).eq('client_id', s.id).single();
    if (!proj) return { success: false, message: 'Project not found.' };
    if (proj.origin !== 'client' || proj.status_override !== 'Requested') return { success: false, message: 'This request can no longer be withdrawn.' };

    await db.from('features').delete().eq('project_id', proj.id);
    const { error } = await db.from('projects').delete().eq('id', proj.id);
    if (error) return { success: false, message: error.message };
    return { success: true };
}

// ---- Phase 2: change requests on LOCKED (accepted, non-completed) features ----
// The client can't touch the live row anymore, so a proposed edit is stored as
// a pending change_requests record that the admin approves (applies) or rejects.

const MAX_PENDING_CHANGES = 5;

// Ownership + eligibility: the feature must belong to the caller, be past
// Requested (locked), and not Completed.
async function loadOwnedFeature(db: any, clientId: string, featureId: string) {
    const { data: feat } = await db.from('features').select('id, description, status, project_id').eq('id', featureId).single();
    if (!feat) return null;
    const { data: proj } = await db.from('projects').select('client_id, description').eq('id', feat.project_id).single();
    if (!proj || proj.client_id !== clientId) return null;
    return { ...feat, projectName: proj.description };
}

export async function requestFeatureChange(input: { featureId: string; description: string; note?: string }): Promise<Result> {
    const s = await requireSession();
    if (!s) return { success: false, message: 'Please sign in again.' };
    const db = supabaseService();

    const description = clean(input.description), note = clean(input.note);
    if (description.length < DESC_MIN || description.length > DESC_MAX) return { success: false, message: `Feature must be ${DESC_MIN}–${DESC_MAX} characters.` };
    if (note.length > NOTE_MAX) return { success: false, message: `Note must be ${NOTE_MAX} characters or fewer.` };

    const feat = await loadOwnedFeature(db, s.id, input.featureId);
    if (!feat) return { success: false, message: 'Feature not found.' };
    if (feat.status === 'Requested') return { success: false, message: 'This is still a pending request — you can edit it directly.' };
    if (feat.status === 'Completed') return { success: false, message: 'Completed work can no longer be changed.' };
    if (description === feat.description && !note) return { success: false, message: 'No changes to propose.' };

    const { count } = await db.from('change_requests').select('id', { count: 'exact', head: true }).eq('client_id', s.id).eq('status', 'pending');
    if ((count || 0) >= MAX_PENDING_CHANGES) return { success: false, message: `You already have ${MAX_PENDING_CHANGES} pending change requests. Please wait for those to be reviewed.` };

    const { data: cr, error } = await db.from('change_requests').insert({
        client_id: s.id,
        target_type: 'feature',
        target_id: feat.id,
        proposed: { description },
        note: note || null,
    }).select('id').single();
    if (error) {
        if (/duplicate|unique/i.test(error.message)) return { success: false, message: 'A change request for this feature is already pending.' };
        return { success: false, message: error.message };
    }

    const desc = `${s.name || 'A client'} proposed a change on “${feat.projectName}”: “${feat.description}” → “${description}”${note ? ` — ${note}` : ''}`;
    await logAndNotify(db, { clientId: s.id, clientName: s.name, projectId: feat.project_id, actionType: 'change_requested', title: `Change requested: ${feat.description}`, description: desc, metadata: { origin: 'client', featureId: feat.id, proposed: description, note } });
    return { success: true, id: cr.id };
}

export async function withdrawChangeRequest(changeRequestId: string): Promise<Result> {
    const s = await requireSession();
    if (!s) return { success: false, message: 'Please sign in again.' };
    const db = supabaseService();

    const { data: cr } = await db.from('change_requests').select('id, client_id, status').eq('id', changeRequestId).single();
    if (!cr || cr.client_id !== s.id) return { success: false, message: 'Change request not found.' };
    if (cr.status !== 'pending') return { success: false, message: 'This change request has already been reviewed.' };

    const { error } = await db.from('change_requests').delete().eq('id', cr.id);
    if (error) return { success: false, message: error.message };
    return { success: true };
}

// The caller's pending change requests, keyed by target — the portal uses this
// to mark rows "change pending" and to offer withdraw.
export async function getMyPendingChanges(): Promise<{ id: string; target_id: string; target_type: string; proposed: any; note: string | null }[]> {
    const s = await requireSession();
    if (!s) return [];
    const db = supabaseService();
    const { data } = await db
        .from('change_requests')
        .select('id, target_id, target_type, proposed, note')
        .eq('client_id', s.id)
        .eq('status', 'pending');
    return JSON.parse(JSON.stringify(data || []));
}

export async function withdrawRequestedFeature(featureId: string): Promise<Result> {
    const s = await requireSession();
    if (!s) return { success: false, message: 'Please sign in again.' };
    const db = supabaseService();

    const { data: feat } = await db.from('features').select('id, origin, status, project_id').eq('id', featureId).single();
    if (!feat) return { success: false, message: 'Feature not found.' };
    const { data: proj } = await db.from('projects').select('client_id').eq('id', feat.project_id).single();
    if (!proj || proj.client_id !== s.id) return { success: false, message: 'Feature not found.' };
    if (feat.origin !== 'client' || feat.status !== 'Requested') return { success: false, message: 'This request can no longer be withdrawn.' };

    const { error } = await db.from('features').delete().eq('id', feat.id);
    if (error) return { success: false, message: error.message };
    return { success: true };
}
