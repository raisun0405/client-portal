// SINGLE SOURCE OF TRUTH for portal mutations that carry side effects.
//
// Every operation here does the database write AND everything the admin UI
// would do alongside it — the activity_logs entry, the derived-status cascade,
// the right action_type — in one place. Both consumers import this:
//   - the admin UI, through the server actions in app/admin/actions.ts
//   - the local MCP server (mcp/server.ts), so an agent physically cannot
//     forget a step the UI performs.
//
// Framework-agnostic on purpose: no next/headers, no React. It writes with the
// server-only secret key, so it works from a plain Node process too.
import { supabaseService } from './supabaseServer';
import { deriveProjectStatus } from './projectStatus';

export type OpResult<T = any> = { ok: boolean; message: string; data?: T };

const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`;

// Every agent-made change is stamped so it can be audited and rolled back.
type Via = 'admin' | 'agent';

async function writeActivity(db: any, a: {
    clientId: string; projectId: string | null; actionType: string;
    title: string; description: string; metadata?: Record<string, any>; via: Via;
}) {
    const { error } = await db.from('activity_logs').insert({
        client_id: a.clientId,
        project_id: a.projectId,
        action_type: a.actionType,
        title: a.title,
        description: a.description,
        metadata: { ...(a.metadata || {}), via: a.via },
    });
    if (error) console.error('portalOps: activity log failed:', error.message);
}

// Resolve a feature to its project + client (agents pass only a feature id).
async function featureContext(db: any, featureId: string) {
    const { data: feature } = await db.from('features').select('*').eq('id', featureId).single();
    if (!feature) return null;
    const { data: project } = await db.from('projects')
        .select('id, description, status_override, client_id').eq('id', feature.project_id).single();
    if (!project) return null;
    const { data: client } = await db.from('clients')
        .select('id, name, billing_mode').eq('id', project.client_id).single();
    if (!client) return null;
    return { feature, project, client };
}

// Fire "Project Completed" when a change makes every feature Completed (and it
// was not before). Skipped while a manual override is in effect — mirrors the UI.
async function cascadeProjectCompleted(db: any, ctx: any, before: any[], after: any[], via: Via) {
    if (ctx.project.status_override) return;
    if (deriveProjectStatus(after) === 'Completed' && deriveProjectStatus(before) !== 'Completed') {
        await writeActivity(db, {
            clientId: ctx.client.id, projectId: ctx.project.id, actionType: 'project_completed',
            title: 'Project Completed',
            description: `"${ctx.project.description}" was completed — all features are done`,
            metadata: { auto: true }, via,
        });
    }
}

/**
 * Update a feature. Only the fields you pass change; the rest are preserved.
 * Derives payment_status, picks the right action_type by the same priority the
 * admin UI uses (rate change > completion > payment > amount > general), writes
 * the activity log with a structured diff, and cascades project completion.
 */
export async function updateFeature(input: {
    featureId: string;
    description?: string;
    estimation?: string;
    status?: string;
    amount?: number;
    paidAmount?: number;
    paymentConfirmed?: boolean;
    isNewRequest?: boolean;
    via?: Via;
}): Promise<OpResult> {
    const db = supabaseService();
    const via: Via = input.via || 'agent';

    const ctx = await featureContext(db, input.featureId);
    if (!ctx) return { ok: false, message: 'Feature not found.' };
    const { feature, project, client } = ctx;

    // Old state (for the diff)
    const oldAmount = Number(feature.amount) || 0;
    const oldPaid = Number(feature.paid_amount) || 0;
    const oldStatus = feature.status || '';
    const oldConfirmed = feature.payment_confirmed !== false;

    // New state — unspecified fields keep their current value
    const description = input.description ?? feature.description;
    const estimation = input.estimation ?? (feature.estimation || '');
    const status = input.status ?? oldStatus;
    const isNewRequest = input.isNewRequest ?? !!feature.is_new_request;
    const confirmed = input.paymentConfirmed ?? oldConfirmed;
    const isPackage = client.billing_mode === 'package';
    const amount = !confirmed ? 0 : (input.amount ?? oldAmount);
    const paidAmount = !confirmed ? 0 : (input.paidAmount ?? oldPaid);

    // Package clients bill via the retainer — features must stay at zero.
    if (isPackage && amount > 0) {
        return { ok: false, message: `${client.name} is on a monthly package — features are covered by the retainer and must not carry a price. Record money against the billing period instead.` };
    }

    let paymentStatus = 'Pending';
    if (confirmed) {
        if (amount === 0) paymentStatus = 'Paid';
        else if (paidAmount >= amount) paymentStatus = 'Paid';
        else if (paidAmount > 0) paymentStatus = 'Partial';
    }

    const { error } = await db.from('features').update({
        description, estimation, status, amount, paid_amount: paidAmount,
        payment_status: paymentStatus, is_new_request: isNewRequest, payment_confirmed: confirmed,
    }).eq('id', feature.id);
    if (error) return { ok: false, message: error.message };

    // ---- Activity log: same priority ladder as the admin UI ----
    const confirmedChanged = confirmed !== oldConfirmed;
    const isCompleted = status === 'Completed' && oldStatus !== 'Completed';
    const amountChanged = amount !== oldAmount;
    const paymentChanged = paidAmount !== oldPaid;

    const changes: string[] = [];
    const structured: Record<string, { old: any; new: any }> = {};
    if (confirmedChanged) {
        changes.push(confirmed ? 'Rate confirmed' : 'Rate set to pending');
        structured['Payment Status'] = { old: oldConfirmed ? 'Confirmed' : 'Pending', new: confirmed ? 'Confirmed' : 'Pending' };
    }
    if (confirmed && amountChanged) {
        changes.push(`Amount: ${inr(oldAmount)} → ${inr(amount)}`);
        structured['Total Amount'] = { old: inr(oldAmount), new: inr(amount) };
    }
    if (confirmed && paymentChanged) {
        changes.push(`Payment: ${inr(oldPaid)} → ${inr(paidAmount)}`);
        structured['Amount Paid'] = { old: inr(oldPaid), new: inr(paidAmount) };
    }
    if (status !== oldStatus) {
        if (!isCompleted) changes.push(`Status: ${oldStatus} → ${status}`);
        structured['Status'] = { old: oldStatus, new: status };
    }

    let actionType = 'feature_updated';
    let title = 'Feature Updated';
    let desc = `"${description}" in "${project.description}" was updated`;

    if (confirmedChanged && confirmed) {
        actionType = 'rate_confirmed';
        title = amount > 0 ? `Rate Confirmed — ${inr(amount)}` : 'Rate Confirmed';
        desc = `Rate for "${description}" in "${project.description}" has been confirmed${amount > 0 ? ` at ${inr(amount)}` : ''}`;
    } else if (confirmedChanged && !confirmed) {
        actionType = 'rate_pending';
        title = 'Rate Set to Pending';
        desc = `Rate for "${description}" in "${project.description}" is now pending confirmation`;
    } else if (isCompleted) {
        actionType = 'feature_completed';
        title = 'Feature Completed';
        desc = `"${description}" in "${project.description}" was completed`;
        if (confirmed && amount > 0) desc += ` (${inr(amount)})`;
    } else if (confirmed && paymentChanged && paidAmount > oldPaid) {
        actionType = 'payment_received';
        title = `Payment Received — ${inr(paidAmount - oldPaid)}`;
        desc = `${inr(paidAmount - oldPaid)} received for "${description}" (Total paid: ${inr(paidAmount)}/${inr(amount)})`;
    } else if (confirmed && amountChanged) {
        title = 'Amount Updated';
        desc = `"${description}" — ${inr(oldAmount)} → ${inr(amount)}`;
    } else if (changes.length > 0) {
        desc = `"${description}" — ${changes.join(', ')}`;
    }

    if (changes.length > 0 || isCompleted) {
        await writeActivity(db, {
            clientId: client.id, projectId: project.id, actionType, title, description: desc,
            metadata: { feature: description, amount: confirmed ? amount : null, paidAmount: confirmed ? paidAmount : null, changes: structured },
            via,
        });
    }

    // Cascade: did this complete the whole project?
    const { data: allFeatures } = await db.from('features').select('id, status').eq('project_id', project.id);
    const after = (allFeatures || []);
    const before = after.map((f: any) => f.id === feature.id ? { ...f, status: oldStatus } : f);
    await cascadeProjectCompleted(db, ctx, before, after, via);

    return {
        ok: true,
        message: changes.length ? `Updated "${description}": ${changes.join(', ')}` : 'No changes were needed.',
        data: { featureId: feature.id, client: client.name, project: project.description, status, amount, paymentStatus },
    };
}

/**
 * Resolve plain language ("the dark mode feature for Ritika") to concrete ids.
 * Case-insensitive substring match across features, with their project + client.
 */
export async function findFeatures(query: string, clientName?: string): Promise<OpResult> {
    const db = supabaseService();
    const q = (query || '').trim().toLowerCase();
    if (q.length < 2) return { ok: false, message: 'Give at least 2 characters to search for.' };

    const { data: clients } = await db.from('clients').select('id, name, billing_mode');
    const { data: projects } = await db.from('projects').select('id, description, client_id');
    const projById = new Map<string, any>((projects || []).map((p: any) => [p.id, p]));
    const clientById = new Map<string, any>((clients || []).map((c: any) => [c.id, c]));

    const { data: features } = await db.from('features')
        .select('id, description, project_id, status, amount, paid_amount, payment_confirmed')
        .ilike('description', `%${q}%`);

    let matches = (features || []).map((f: any) => {
        const p = projById.get(f.project_id);
        const c = p ? clientById.get(p.client_id) : null;
        return {
            featureId: f.id, feature: f.description, status: f.status,
            project: p?.description, projectId: p?.id,
            client: c?.name, clientId: c?.id, billingMode: c?.billing_mode,
            amount: Number(f.amount) || 0, paid: Number(f.paid_amount) || 0,
            ratePending: f.payment_confirmed === false,
        };
    });
    if (clientName) {
        const cn = clientName.trim().toLowerCase();
        matches = matches.filter((m: any) => (m.client || '').toLowerCase().includes(cn));
    }

    return {
        ok: true,
        message: matches.length === 0 ? `No feature matches "${query}".`
            : matches.length === 1 ? `1 match.`
            : `${matches.length} matches — confirm which one before writing.`,
        data: matches.slice(0, 25),
    };
}

/** Everything awaiting action, using the portal's real definition of "pending". */
export async function getPending(clientId?: string): Promise<OpResult> {
    const db = supabaseService();

    const { data: clients } = await db.from('clients').select('id, name, billing_mode');
    const nameOf = new Map<string, string>((clients || []).map((c: any) => [c.id, c.name]));
    const scope = (id?: string) => !clientId || id === clientId;

    const { data: projects } = await db.from('projects').select('id, description, client_id, status_override, origin');
    const projById = new Map<string, any>((projects || []).map((p: any) => [p.id, p]));

    const { data: features } = await db.from('features').select('id, description, project_id, status, payment_confirmed, origin');
    const { data: periods } = await db.from('billing_periods').select('id, client_id, period_start, period_end, fee_amount, paid_amount, payment_status');
    const { data: changes } = await db.from('change_requests').select('id, client_id, proposed, note').eq('status', 'pending');
    const { data: unsent } = await db.from('activity_logs').select('id, client_id, title, created_at').is('notified_at', null).eq('is_hidden', false).order('created_at', { ascending: false });

    // IDs are included so an agent can go straight from a listing to a write tool.
    const label = (f: any) => {
        const p = projById.get(f.project_id);
        return { featureId: f.id, feature: f.description, project: p?.description, client: p ? nameOf.get(p.client_id) : undefined };
    };

    const ratePending = (features || []).filter((f: any) => f.payment_confirmed === false && scope(projById.get(f.project_id)?.client_id)).map(label);
    const requestedProjects = (projects || []).filter((p: any) => p.origin === 'client' && p.status_override === 'Requested' && scope(p.client_id))
        .map((p: any) => ({ projectId: p.id, project: p.description, client: nameOf.get(p.client_id) }));
    const requestedFeatures = (features || []).filter((f: any) => f.origin === 'client' && f.status === 'Requested' && scope(projById.get(f.project_id)?.client_id)).map(label);
    const unpaidInvoices = (periods || []).filter((b: any) => b.payment_status !== 'Paid' && scope(b.client_id))
        .map((b: any) => ({ client: nameOf.get(b.client_id), period: `${b.period_start} to ${b.period_end}`, due: (Number(b.fee_amount) || 0) - (Number(b.paid_amount) || 0), status: b.payment_status }));
    const changeRequests = (changes || []).filter((c: any) => scope(c.client_id))
        .map((c: any) => ({ client: nameOf.get(c.client_id), proposed: c.proposed?.description, note: c.note }));
    const unsentUpdates = (unsent || []).filter((l: any) => scope(l.client_id))
        .map((l: any) => ({ client: nameOf.get(l.client_id), title: l.title, at: l.created_at }));

    return {
        ok: true,
        message: `${ratePending.length} rate-pending · ${requestedProjects.length + requestedFeatures.length} client requests · ${changeRequests.length} change requests · ${unpaidInvoices.length} unpaid invoices · ${unsentUpdates.length} un-sent updates`,
        data: { ratePending, requestedProjects, requestedFeatures, changeRequests, unpaidInvoices, unsentUpdates },
    };
}
