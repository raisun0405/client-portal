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
    coverage?: string | null;
};

type ProjectStatsOpts = {
    // The parent project's billing_mode. Coverage is only applied for 'package'
    // projects; per-feature projects ignore it entirely (unchanged behavior).
    billingMode?: string | null;
};

export type ProjectStats = {
    total: number;
    paid: number;
    pending: number;
};

// Money rules:
//  - Only payment-confirmed features count (unconfirmed are stored with amount 0
//    anyway, so this is also a safety net).
//  - On a PACKAGE project, 'included' features are covered by the monthly fee and
//    contribute 0 to the separate feature totals. On per-feature projects the
//    coverage flag is ignored, so existing projects are byte-for-byte unchanged.
export function computeProjectStats(features: FeatureLike[] = [], opts: ProjectStatsOpts = {}): ProjectStats {
    const isPackage = opts.billingMode === 'package';
    const billable = features.filter(f =>
        f.payment_confirmed !== false && !(isPackage && f.coverage === 'included')
    );
    const total = billable.reduce((s, f) => s + (Number(f.amount) || 0), 0);
    const paid = billable.reduce((s, f) => s + (Number(f.paid_amount) || 0), 0);
    return { total, paid, pending: total - paid };
}
