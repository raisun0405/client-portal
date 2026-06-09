// Pure date math for monthly-package billing.
//
// All functions are deterministic — `today` is always passed in, never read from
// the clock — so they are trivially testable and safe in SSR. Dates are handled
// as 'YYYY-MM-DD' strings (which compare correctly with <, >, ===), and all
// arithmetic uses UTC to avoid timezone drift.
//
// Model: a package has a start date (the first billing date) and an anchor day
// (the day-of-month it recurs; defaults to the start date's day). Each "period"
// is one billing window. Months that lack the anchor day (e.g. the 31st in
// April) bill on that month's LAST day; the intended day returns in longer
// months. See MONTHLY_PACKAGE_PLAN.md.

export type Cadence = 'monthly' | 'quarterly' | 'annual';

// Today's date as a LOCAL 'YYYY-MM-DD' string. Avoids the UTC off-by-one that
// `new Date().toISOString().slice(0,10)` causes for IST users in the early hours.
export function todayLocalISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type Period = { start: string; end: string };

export type PackageSchedule = {
    anchorDay: number;
    currentPeriod: Period | null;   // the window containing `today` (null if package starts in the future)
    nextChargeDate: string;         // the next billing date strictly after the current period
    duePeriodStarts: string[];      // start dates of every period that has begun as of `today`
};

const CADENCE_MONTHS: Record<Cadence, number> = { monthly: 1, quarterly: 3, annual: 12 };

function parse(iso: string): { y: number; m: number; d: number } {
    const [y, m, d] = iso.split('-').map(Number);
    return { y, m, d };
}

function iso(y: number, m: number, d: number): string {
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Last day of a 1-based month.
export function daysInMonth(y: number, m: number): number {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// The actual billing day in a given month: the anchor, clamped to month length.
export function billingDayFor(y: number, m: number, anchorDay: number): string {
    return iso(y, m, Math.min(anchorDay, daysInMonth(y, m)));
}

// Advance a 1-based (year, month) by n months.
function addMonths(y: number, m: number, n: number): { y: number; m: number } {
    const total = (m - 1) + n;
    return { y: y + Math.floor(total / 12), m: (((total % 12) + 12) % 12) + 1 };
}

function addDays(isoDate: string, days: number): string {
    const { y, m, d } = parse(isoDate);
    const t = Date.UTC(y, m - 1, d) + days * 86400000;
    const dt = new Date(t);
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

// The start date of period k (k=0 is the package start date itself).
function periodStart(startedOn: string, anchorDay: number, cadence: Cadence, k: number): string {
    if (k === 0) return startedOn;
    const s = parse(startedOn);
    const { y, m } = addMonths(s.y, s.m, k * CADENCE_MONTHS[cadence]);
    return billingDayFor(y, m, anchorDay);
}

// Resolve the schedule relative to `today`. anchorDay defaults to the start day.
export function packageSchedule(
    startedOn: string,
    anchorDay: number | null | undefined,
    cadence: Cadence,
    today: string,
): PackageSchedule {
    const anchor = anchorDay ?? parse(startedOn).d;

    // Find the index of the current period: the largest k whose start is <= today.
    // Bounded, monotonic scan from the start date.
    let k = 0;
    if (today < startedOn) {
        // Package hasn't started yet.
        return { anchorDay: anchor, currentPeriod: null, nextChargeDate: startedOn, duePeriodStarts: [] };
    }
    const duePeriodStarts: string[] = [];
    // Walk forward while the next period has also already started.
    // Hard cap guards against any pathological input (e.g. ~80 years of months).
    for (let i = 0; i < 1200; i++) {
        const start = periodStart(startedOn, anchor, cadence, i);
        if (start > today) break;
        duePeriodStarts.push(start);
        k = i;
    }

    const currentStart = periodStart(startedOn, anchor, cadence, k);
    const nextStart = periodStart(startedOn, anchor, cadence, k + 1);
    return {
        anchorDay: anchor,
        currentPeriod: { start: currentStart, end: addDays(nextStart, -1) },
        nextChargeDate: nextStart,
        duePeriodStarts,
    };
}
