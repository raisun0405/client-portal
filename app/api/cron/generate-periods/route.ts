// Scheduled endpoint: generate any due monthly-package invoices. Runs entirely
// server-side with no login — point a scheduler (Supabase pg_cron, Vercel Cron,
// or any external cron) at it once a day. Protected by CRON_SECRET.
import { NextResponse } from 'next/server';
import { generateDuePackagePeriods } from '@/lib/packageBilling';
import { todayLocalISO } from '@/lib/packageDates';
import { supabaseService } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

function authorized(req: Request): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret) return false; // fail closed until a secret is configured
    const auth = req.headers.get('authorization');
    const token = new URL(req.url).searchParams.get('token');
    return auth === `Bearer ${secret}` || token === secret;
}

async function run(req: Request) {
    if (!authorized(req)) {
        return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
    // Secret-key server client — bypasses RLS for the scheduled write.
    try {
        const result = await generateDuePackagePeriods(supabaseService(), todayLocalISO());
        return NextResponse.json({ ok: true, ...result });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || 'error' }, { status: 500 });
    }
}

export const GET = run;
export const POST = run;
