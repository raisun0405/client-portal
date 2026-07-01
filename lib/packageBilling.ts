// Server-safe generation of due monthly-package billing periods (arrears).
//
// Creates any coverage month that has already been billed-through as of `today`
// but has no billing_periods row yet, as a Pending invoice. Idempotent — only
// missing coverage months are inserted. This is the single source of truth,
// reused by the scheduled cron endpoint AND the admin dashboard fallback, so the
// money math never drifts between the two.
import { packageSchedule, coveragePeriod, shiftDaysISO, shiftMonthsISO, type Cadence } from './packageDates';

export async function generateDuePackagePeriods(
    supabase: { from: (table: string) => any },
    today: string,
): Promise<{ created: number }> {
    const { data: clients } = await supabase
        .from('clients')
        .select('id, billing_mode, package_started_on, package_fee, package_cadence, package_anchor_day')
        .eq('billing_mode', 'package');

    const pkg = (clients || []).filter((c: any) => c.package_started_on);
    if (pkg.length === 0) return { created: 0 };

    const { data: existing } = await supabase
        .from('billing_periods')
        .select('client_id, period_start')
        .in('client_id', pkg.map((c: any) => c.id));

    const have = new Map<string, Set<string>>();
    (existing || []).forEach((p: any) => {
        if (!have.has(p.client_id)) have.set(p.client_id, new Set());
        have.get(p.client_id)!.add(p.period_start);
    });

    const rows: any[] = [];
    for (const c of pkg) {
        const cadence = (c.package_cadence || 'monthly') as Cadence;
        const startedOn = c.package_started_on as string;
        const anchor = c.package_anchor_day ?? Number(startedOn.split('-')[2]);
        const dueBillingDates = packageSchedule(startedOn, anchor, cadence, today).duePeriodStarts;
        const existingStarts = have.get(c.id) || new Set<string>();
        const missing = Array.from(new Set(dueBillingDates.map((d) => coveragePeriod(d, cadence).start)))
            .filter((s) => !existingStarts.has(s));
        for (const start of missing) {
            rows.push({
                client_id: c.id,
                period_start: start,
                period_end: shiftDaysISO(shiftMonthsISO(start, 1), -1),
                fee_amount: Number(c.package_fee) || 0,
                paid_amount: 0,
                payment_status: 'Pending',
                origin: 'auto',
            });
        }
    }

    if (rows.length === 0) return { created: 0 };
    const { error } = await supabase.from('billing_periods').insert(rows);
    if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
    return { created: rows.length };
}
