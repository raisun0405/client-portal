// Scheduled endpoint: generate any due monthly-package invoices. Runs entirely
// server-side with no login — point a scheduler (Supabase pg_cron, Vercel Cron,
// or any external cron) at it once a day. Protected by CRON_SECRET.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateDuePackagePeriods } from '@/lib/packageBilling';
import { todayLocalISO } from '@/lib/packageDates';

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
    // billing_periods has RLS disabled, so the anon key can write; prefer the
    // service-role key if it's configured.
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    try {
        const result = await generateDuePackagePeriods(supabase, todayLocalISO());
        return NextResponse.json({ ok: true, ...result });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || 'error' }, { status: 500 });
    }
}

export const GET = run;
export const POST = run;
