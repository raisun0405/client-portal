// Single source of truth for a project's status.
//
// A project's status is DERIVED from its feature statuses, so it can never drift
// from reality. An optional manual override ('On Hold' / 'Cancelled') locks the
// status for business situations that feature progress can't express.

export type DerivedStatus = 'Not Started' | 'In Progress' | 'Completed';
export type StatusOverride = 'On Hold' | 'Cancelled';
export type DisplayStatus = DerivedStatus | StatusOverride;

type FeatureLike = { status?: string | null };

// Feature statuses that mean real work has begun on the project.
const STARTED_STATUSES = ['Working', 'Updating', 'Completed'];

/**
 * Derive a project's status purely from its features:
 *  - No features, or every feature still Requested/Approved → 'Not Started'
 *  - Has features and every one is Completed                → 'Completed'
 *  - Otherwise                                              → 'In Progress'
 * An empty project is never 'Completed' (no features !== done).
 */
export function deriveProjectStatus(features: FeatureLike[] = []): DerivedStatus {
    if (features.length === 0) return 'Not Started';

    const completed = features.filter(f => f.status === 'Completed').length;
    if (completed === features.length) return 'Completed';

    const started = features.filter(f => STARTED_STATUSES.includes(f.status ?? '')).length;
    return started === 0 ? 'Not Started' : 'In Progress';
}

/**
 * Resolve the status to display: a manual override wins; otherwise derive from features.
 */
export function resolveProjectStatus(
    statusOverride: string | null | undefined,
    features: FeatureLike[] = []
): DisplayStatus {
    if (statusOverride === 'On Hold' || statusOverride === 'Cancelled') return statusOverride;
    return deriveProjectStatus(features);
}

/** Soft pill classes (client portal cards). */
export function statusPillClasses(status: string): string {
    switch (status) {
        case 'Completed': return 'bg-green-50 text-green-700';
        case 'In Progress': return 'bg-amber-50 text-amber-700';
        case 'Not Started': return 'bg-slate-100 text-slate-600';
        case 'On Hold': return 'bg-orange-50 text-orange-700';
        case 'Cancelled': return 'bg-rose-50 text-rose-700';
        default: return 'bg-amber-50 text-amber-700';
    }
}

/** Bordered pill variant (project detail modal header). */
export function statusPillClassesBordered(status: string): string {
    switch (status) {
        case 'Completed': return 'bg-emerald-50 text-emerald-600 border-emerald-100';
        case 'In Progress': return 'bg-amber-50 text-amber-600 border-amber-100';
        case 'Not Started': return 'bg-slate-50 text-slate-500 border-slate-200';
        case 'On Hold': return 'bg-orange-50 text-orange-600 border-orange-100';
        case 'Cancelled': return 'bg-rose-50 text-rose-600 border-rose-100';
        default: return 'bg-amber-50 text-amber-600 border-amber-100';
    }
}
