// Shared project financial stats — the single source of truth for the
// total / paid / pending money math that was duplicated across the client and
// admin dashboards.
//
// Phase 0 of the monthly-package plan (see MONTHLY_PACKAGE_PLAN.md) extracts it
// here, behavior-unchanged, so later phases (coverage-aware sums, package
// billing periods) are written once instead of in 3+ places.

type FeatureLike = {
    amount?: number | null;
    paid_amount?: number | null;
    payment_confirmed?: boolean | null;
};

export type ProjectStats = {
    total: number;
    paid: number;
    pending: number;
};

// Per-project feature money. Only payment-confirmed features count (unconfirmed
// "rate pending" features are stored with amount 0 anyway, so this is also a
// safety net). Used for per-feature clients; package clients bill via the
// client-level retainer (billing_periods) instead.
export function computeProjectStats(features: FeatureLike[] = []): ProjectStats {
    const confirmed = features.filter(f => f.payment_confirmed !== false);
    const total = confirmed.reduce((s, f) => s + (Number(f.amount) || 0), 0);
    const paid = confirmed.reduce((s, f) => s + (Number(f.paid_amount) || 0), 0);
    return { total, paid, pending: total - paid };
}
