'use server';

// Server actions that back the client portal's data layer. Every action derives
// the caller's client_id from the signed session cookie (never from an argument)
// and queries with the server-only secret key, scoped to that client_id. This is
// what lets us deny the anon browser at the RLS layer without the portal losing
// access to its own data.
import { supabaseService } from '@/lib/supabaseServer';
import { getClientSession } from '@/app/actions';

// Supabase can return null-prototype objects that Next's server-action
// serializer chokes on; round-trip through JSON to hand back plain objects.
function plain<T>(value: T): T {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

async function requireClientId(): Promise<string | null> {
    const session = await getClientSession();
    return session?.id ?? null;
}

// Client-level package/retainer info + billing periods + covered-feature sets.
// Mirrors the old fetchPackageInfo() query set.
export async function getPortalCore() {
    const clientId = await requireClientId();
    if (!clientId) return null;
    const db = supabaseService();

    const { data: c } = await db
        .from('clients')
        .select('billing_mode, package_fee, package_cadence, package_status, package_started_on, package_anchor_day')
        .eq('id', clientId)
        .single();

    const { data: bps } = await db
        .from('billing_periods')
        .select('*')
        .eq('client_id', clientId)
        .order('period_start', { ascending: false });

    let coveredFeatureIds: string[] = [];
    let coveredProjectIds: string[] = [];
    if (c?.billing_mode === 'package') {
        const { data: migs } = await db
            .from('package_migrations')
            .select('affected_feature_ids, pending_disposition')
            .eq('client_id', clientId)
            .eq('status', 'committed')
            .order('performed_at', { ascending: false })
            .limit(1);
        const mig = migs && migs[0];
        const ids: string[] = (mig && mig.pending_disposition !== 'keep_one_time') ? (mig.affected_feature_ids || []) : [];
        coveredFeatureIds = ids;
        if (ids.length > 0) {
            const { data: feats } = await db.from('features').select('id, project_id').in('id', ids);
            coveredProjectIds = [...new Set((feats || []).map((f: any) => f.project_id))];
        }
    }

    return plain({ packageInfo: c || null, billingPeriods: bps || [], coveredFeatureIds, coveredProjectIds });
}

// All of the client's projects plus every feature under them (raw rows — the UI
// computes per-project stats). Mirrors the old fetchProjects() query set.
export async function getProjectsWithFeatures() {
    const clientId = await requireClientId();
    if (!clientId) return null;
    const db = supabaseService();

    const { data: projects, error } = await db
        .from('projects')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);

    const ids = (projects || []).map((p: any) => p.id);
    let features: any[] = [];
    if (ids.length > 0) {
        const { data: f, error: fErr } = await db.from('features').select('*').in('project_id', ids);
        if (fErr) throw new Error(fErr.message);
        features = f || [];
    }
    return plain({ projects: projects || [], features });
}

// Features for a single project — with an ownership check so a client can't read
// another client's project by guessing its id.
export async function getProjectFeatures(projectId: string) {
    const clientId = await requireClientId();
    if (!clientId) return null;
    const db = supabaseService();

    const { data: owned } = await db
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('client_id', clientId)
        .single();
    if (!owned) return null;

    const { data } = await db
        .from('features')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
    return plain(data || []);
}

// Timeline logs (non-hidden). Mirrors fetchActivityLogs for the portal.
export async function getPortalActivityLogs(limit = 25) {
    const clientId = await requireClientId();
    if (!clientId) return [];
    const db = supabaseService();
    const { data } = await db
        .from('activity_logs')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(limit);
    return plain((data || []).filter((l: any) => !l.is_hidden));
}

// Lightweight momentum data since `sinceISO` (window computed client-side from
// local midnight, then passed in — it's only a date filter, and the action is
// already scoped to the caller's own logs).
export async function getPortalPulseLogs(sinceISO: string) {
    const clientId = await requireClientId();
    if (!clientId) return [];
    const db = supabaseService();
    const { data, error } = await db
        .from('activity_logs')
        .select('created_at, action_type, is_hidden')
        .eq('client_id', clientId)
        .gte('created_at', sinceISO);
    if (error) return [];
    return plain((data || []).filter((l: any) => !l.is_hidden).map((l: any) => ({ created_at: l.created_at, action_type: l.action_type })));
}
