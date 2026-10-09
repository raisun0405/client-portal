// What a client's Claude is told: the client's own portal, worded and priced
// exactly as the client portal shows it (app/dashboard/page.tsx), so the two
// never disagree. See docs/PORTAL_DOMAIN.md, "Billing".
//
// Money rules, in the portal's order:
//   1. A feature absorbed when the client moved to a package (coveredFeatureIds),
//      or any ₹0 feature of a package client  → "Covered by your monthly package".
//      Covered beats Rate pending: a package client never sees "Rate pending".
//   2. payment_confirmed = false               → "Rate pending" (no number, and
//      left out of every total until Rai Sun confirms it).
//   3. otherwise                               → the price, what's paid, and
//      Paid / Partial / Pending.
// Package clients are billed by the retainer (billing_periods, in arrears: an
// invoice for September is raised in October); per-feature totals are hidden
// for them unless they still carry one-time money from before the switch.
import { computeProjectStats, paidPercent } from '@/lib/billing';
import { coveragePeriod, monthYearLabel, packageSchedule, todayLocalISO, type Cadence } from '@/lib/packageDates';
import { resolveProjectStatus } from '@/lib/projectStatus';
import { readActivityLogs, readPendingChanges, readPortalCore, readProjectsWithFeatures, MAX_OPEN, MAX_PENDING_CHANGES } from '@/lib/clientPortalOps';
import type { ConnectorClient } from './auth';

const inr = (n: number | null | undefined) => `₹${(Number(n) || 0).toLocaleString('en-IN')}`;
const COVERED = 'Covered by your monthly package';

// The columns these views read (the reads return whole rows).
type FeatureRow = {
    id: string;
    project_id: string;
    description: string;
    status: string;
    is_new_request?: boolean | null;
    estimation?: string | null;
    amount?: number | null;
    paid_amount?: number | null;
    payment_status?: string | null;
    payment_confirmed?: boolean | null;
    origin?: string | null;
    created_at: string;
};
type ProjectRow = {
    id: string;
    description: string;
    category: string;
    status_override?: string | null;
    origin?: string | null;
    links?: { title: string; url: string }[] | null;
    created_at: string;
};
type InvoiceRow = { period_start?: string | null; fee_amount?: number | null; paid_amount?: number | null; payment_status?: string | null };
type PackageRow = {
    billing_mode?: string | null;
    package_fee?: number | null;
    package_cadence?: string | null;
    package_status?: string | null;
    package_started_on?: string | null;
    package_anchor_day?: number | null;
};
type LogRow = { created_at: string; title: string; description?: string | null };

type Raw = Awaited<ReturnType<typeof load>>;

/** Everything the views need, read once, scoped to this one client. */
export async function load(client: ConnectorClient) {
    const [core, data, changes] = await Promise.all([readPortalCore(client.id), readProjectsWithFeatures(client.id), readPendingChanges(client.id)]);
    const packageInfo = (core?.packageInfo ?? null) as PackageRow | null;
    return {
        client,
        isPackage: packageInfo?.billing_mode === 'package',
        packageInfo,
        invoices: (core?.billingPeriods ?? []) as InvoiceRow[],
        coveredFeatures: new Set<string>(core?.coveredFeatureIds ?? []),
        coveredProjects: new Set<string>(core?.coveredProjectIds ?? []),
        projects: (data?.projects ?? []) as ProjectRow[],
        features: (data?.features ?? []) as FeatureRow[],
        changes,
    };
}

function featureCovered(raw: Raw, f: FeatureRow): boolean {
    return raw.coveredFeatures.has(f.id) || (raw.isPackage && (Number(f.amount) || 0) === 0);
}

function priceOf(raw: Raw, f: FeatureRow) {
    if (featureCovered(raw, f)) return { price: COVERED };
    if (f.payment_confirmed === false) return { price: 'Rate pending', note: 'Rai Sun has not confirmed the price yet, so it is not counted in any total.' };
    return { price: inr(f.amount), paid: inr(f.paid_amount), payment: f.payment_status || 'Pending' };
}

function featureView(raw: Raw, f: FeatureRow) {
    const change = raw.changes.find((c) => c.target_type === 'feature' && c.target_id === f.id);
    return {
        id: f.id,
        name: f.description,
        status: f.status,
        type: f.is_new_request ? 'Extra request' : 'Core feature',
        ...(f.estimation ? { estimate: f.estimation } : {}),
        ...priceOf(raw, f),
        ...(f.origin === 'client' && f.status === 'Requested' ? { yourRequest: 'Waiting for Rai Sun to review. You can still edit or withdraw it.' } : {}),
        ...(change ? { renameRequested: { to: change.proposed?.description ?? null, renameRequestId: change.id } } : {}),
        added: String(f.created_at).slice(0, 10),
    };
}

function projectMoney(raw: Raw, project: ProjectRow, features: FeatureRow[]) {
    const { total, paid, pending } = computeProjectStats(features);
    if (raw.coveredProjects.has(project.id) || (raw.isPackage && total === 0)) return COVERED;
    return { total: inr(total), paid: inr(paid), toPay: inr(pending), paidPercent: `${paidPercent(total, paid)}%` };
}

function projectView(raw: Raw, project: ProjectRow, withFeatures: boolean) {
    const features = raw.features.filter((f) => f.project_id === project.id);
    const done = features.filter((f) => f.status === 'Completed').length;
    const status = resolveProjectStatus(project.status_override, features);
    return {
        id: project.id,
        name: project.description,
        category: project.category,
        status,
        ...(project.origin === 'client' && status === 'Requested' ? { yourRequest: 'Waiting for Rai Sun to accept this project. You can still rename or withdraw it.' } : {}),
        progress: features.length ? `${done} of ${features.length} features done` : 'No features yet',
        money: projectMoney(raw, project, features),
        links: (project.links || []).map((l) => ({ title: l.title, url: l.url })),
        started: String(project.created_at).slice(0, 10),
        ...(withFeatures ? { features: features.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).map((f) => featureView(raw, f)) } : { features: features.length }),
    };
}

function invoiceView(b: InvoiceRow) {
    return {
        for: b.period_start ? monthYearLabel(b.period_start) : null,
        amount: inr(b.fee_amount),
        paid: inr(b.paid_amount),
        status: b.payment_status,
    };
}

function retainer(raw: Raw) {
    const p = raw.packageInfo;
    if (!raw.isPackage || !p) return null;
    const cadence = (p.package_cadence || 'monthly') as Cadence;
    const unpaid = raw.invoices.filter((b) => b.payment_status !== 'Paid');
    const owed = unpaid.reduce((s, b) => s + Math.max((Number(b.fee_amount) || 0) - (Number(b.paid_amount) || 0), 0), 0);
    let nextCharge: { date: string; covers: string } | null = null;
    if (p.package_started_on && p.package_status !== 'ended') {
        const sched = packageSchedule(p.package_started_on, p.package_anchor_day, cadence, todayLocalISO());
        nextCharge = { date: sched.nextChargeDate, covers: monthYearLabel(coveragePeriod(sched.nextChargeDate, cadence).start) };
    }
    return {
        fee: `${inr(p.package_fee)} ${cadence === 'monthly' ? 'a month' : cadence === 'quarterly' ? 'a quarter' : 'a year'}`,
        status: p.package_status || 'active',
        billedInArrears: 'Each invoice covers the month before it is raised.',
        ...(nextCharge ? { nextCharge } : {}),
        ...(raw.invoices[0] ? { latestInvoice: invoiceView(raw.invoices[0]) } : {}),
        unpaid: { invoices: unpaid.length, amount: inr(owed) },
    };
}

/** "Start here": billing, money, projects at a glance, and what's waiting. */
export function overview(raw: Raw) {
    const groups = raw.projects.map((p) => resolveProjectStatus(p.status_override, raw.features.filter((f) => f.project_id === p.id)));
    const count = (s: string) => groups.filter((g) => g === s).length;
    const openRequests =
        raw.projects.filter((p) => p.origin === 'client' && p.status_override === 'Requested').length +
        raw.features.filter((f) => f.origin === 'client' && f.status === 'Requested').length;
    const ratePending = raw.features.filter((f) => !featureCovered(raw, f) && f.payment_confirmed === false).length;

    // Per-feature money (for a package client: only one-time work they still carry).
    const confirmed = raw.projects.map((p) => computeProjectStats(raw.features.filter((f) => f.project_id === p.id && !featureCovered(raw, f))));
    const total = confirmed.reduce((s, x) => s + x.total, 0);
    const paid = confirmed.reduce((s, x) => s + x.paid, 0);

    return {
        client: raw.client.name,
        billing: raw.isPackage ? 'Monthly package: a fixed fee covers all work, so features have no price.' : 'Per-feature: each feature has its own price.',
        ...(raw.isPackage ? { package: retainer(raw) } : {}),
        ...(!raw.isPackage || total > 0
            ? { [raw.isPackage ? 'oneTimeWork' : 'money']: { total: inr(total), paid: inr(paid), toPay: inr(Math.max(total - paid, 0)), paidPercent: `${paidPercent(total, paid)}%` } }
            : {}),
        projects: {
            total: raw.projects.length,
            inProgress: count('In Progress'),
            notStarted: count('Not Started'),
            completed: count('Completed'),
            ...(count('On Hold') ? { onHold: count('On Hold') } : {}),
            ...(count('Cancelled') ? { cancelled: count('Cancelled') } : {}),
            ...(count('Requested') ? { waitingForRaiSun: count('Requested') } : {}),
        },
        waiting: {
            yourOpenRequests: `${openRequests} of ${MAX_OPEN} allowed at a time`,
            renameRequests: `${raw.changes.length} of ${MAX_PENDING_CHANGES} allowed at a time`,
            ...(ratePending ? { featuresWithRatePending: ratePending } : {}),
        },
    };
}

export function projectList(raw: Raw) {
    return raw.projects.map((p) => projectView(raw, p, false));
}

/** One project with every feature, or null if it isn't this client's. */
export function projectDetail(raw: Raw, projectId: string) {
    const project = raw.projects.find((p) => p.id === projectId);
    return project ? projectView(raw, project, true) : null;
}

/** The client's own features whose name contains `query`. */
export function findFeatures(raw: Raw, query: string) {
    const q = query.trim().toLowerCase();
    return raw.features
        .filter((f) => String(f.description).toLowerCase().includes(q))
        .slice(0, 25)
        .map((f) => {
            const project = raw.projects.find((p) => p.id === f.project_id);
            return { ...featureView(raw, f), project: { id: project?.id, name: project?.description } };
        });
}

export function invoices(raw: Raw) {
    if (!raw.isPackage) return { note: 'This account is billed per feature, so there are no package invoices. Ask for the overview to see what is paid and what is left.' };
    return { package: retainer(raw), invoices: raw.invoices.map(invoiceView) };
}

/** Open requests (not yet accepted) and pending renames, with the ids to act on them. */
export function requests(raw: Raw) {
    const projects = raw.projects
        .filter((p) => p.origin === 'client' && p.status_override === 'Requested')
        .map((p) => ({ projectId: p.id, name: p.description, requested: String(p.created_at).slice(0, 10) }));
    const features = raw.features
        .filter((f) => f.origin === 'client' && f.status === 'Requested')
        .map((f) => ({ featureId: f.id, name: f.description, project: raw.projects.find((p) => p.id === f.project_id)?.description, requested: String(f.created_at).slice(0, 10) }));
    const renames = raw.changes.map((c) => {
        const f = raw.features.find((x) => x.id === c.target_id);
        return { renameRequestId: c.id, feature: f?.description ?? null, featureId: c.target_id, to: c.proposed?.description ?? null, note: c.note };
    });
    return {
        projectRequests: projects,
        featureRequests: features,
        renameRequests: renames,
        limits: `Up to ${MAX_OPEN} open requests (10 an hour, 30 a day) and ${MAX_PENDING_CHANGES} pending renames.`,
    };
}

/**
 * What the client owes right now, the way the payment reminder email counts it
 * (lib/portalOps getClientBalance): unpaid package invoices plus confirmed
 * per-feature balances. Rate pending and Covered work are never owed.
 */
export function outstanding(raw: Raw): { total: number; lines: string[] } {
    const lines: string[] = [];
    let total = 0;
    for (const b of raw.invoices) {
        if (b.payment_status === 'Paid') continue;
        const owed = Math.max((Number(b.fee_amount) || 0) - (Number(b.paid_amount) || 0), 0);
        if (owed <= 0) continue;
        total += owed;
        lines.push(`${b.period_start ? monthYearLabel(b.period_start) : 'Package'} invoice: ${inr(owed)}`);
    }
    for (const p of raw.projects) {
        const { pending } = computeProjectStats(raw.features.filter((f) => f.project_id === p.id && !featureCovered(raw, f)));
        if (pending <= 0) continue;
        total += pending;
        lines.push(`${p.description}${raw.isPackage ? ' (one-time work)' : ''}: ${inr(pending)}`);
    }
    return { total, lines };
}

/** The client's activity feed (what the portal shows; hidden entries never appear). */
export async function activity(client: ConnectorClient, limit: number) {
    const logs = await readActivityLogs(client.id, limit);
    return (logs as LogRow[]).map((l) => ({ when: l.created_at, what: l.title, ...(l.description ? { details: l.description } : {}) }));
}
