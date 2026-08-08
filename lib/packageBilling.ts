// Server-safe generation of due monthly-package billing periods (arrears).
//
// Creates any coverage month that has already been billed-through as of `today`
// but has no billing_periods row yet, as a Pending invoice. Idempotent — only
// missing coverage months are inserted. This is the single source of truth,
// reused by the scheduled cron endpoint AND the admin dashboard fallback, so the
// money math never drifts between the two.
import {
    packageSchedule, coveragePeriod, shiftDaysISO, shiftMonthsISO,
    monthYearLabel, humanDateRange, planLabel, type Cadence,
} from './packageDates';

export async function generateDuePackagePeriods(
    supabase: { from: (table: string) => any },
    today: string,
): Promise<{ created: number }> {
    const { data: clients } = await supabase
        .from('clients')
        .select('id, name, billing_mode, package_started_on, package_fee, package_cadence, package_anchor_day')
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
    // .select() returns only the rows THIS call actually inserted. On a
    // concurrent run the unique constraint rejects the whole (atomic) batch, so
    // `inserted` is null and we neither over-count nor double-log.
    const { data: inserted, error } = await supabase
        .from('billing_periods')
        .insert(rows)
        .select('client_id, period_start, period_end, fee_amount');
    if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);

    const created = inserted || [];
    if (created.length > 0) {
        // Mirror each new invoice into the activity feed so it shows up for the
        // admin and can be sent as a manual notification. Best-effort: a logging
        // failure must never break billing, so errors are swallowed.
        const cadenceById = new Map<string, Cadence>(
            (clients || []).map((c: any) => [c.id, (c.package_cadence || 'monthly') as Cadence]),
        );
        const logRows = created.map((p: any) => {
            const fee = Number(p.fee_amount) || 0;
            const cadence = cadenceById.get(p.client_id) || 'monthly';
            const month = monthYearLabel(p.period_start);
            const period = humanDateRange(p.period_start, p.period_end);
            return {
                client_id: p.client_id,
                project_id: null,
                action_type: 'invoice_generated',
                title: `Invoice — ${month}`,
                description: `Your ${planLabel(cadence).toLowerCase()} invoice for ${month} is ready — ₹${fee.toLocaleString('en-IN')} due for the service period ${period}.`,
                metadata: {
                    amount: fee,
                    period_start: p.period_start,
                    period_end: p.period_end,
                    cadence,
                    payment_status: 'Pending',
                    origin: 'auto',
                },
            };
        });
        const { error: logError } = await supabase.from('activity_logs').insert(logRows);
        if (logError) console.error('generateDuePackagePeriods: activity log insert failed:', logError.message);
    }

    return { created: created.length };
}
