/* eslint-disable @typescript-eslint/no-explicit-any -- a test script reading arbitrary JSON replies */
// End-to-end tests for the client Claude connector, against a local dev server:
//
//   PORTAL_SKIP_ADMIN_ALERTS=1 npm run dev            (no request emails to Rohan)
//   npx tsx scripts/test-connector.mts                (BASE defaults to http://localhost:3000)
//
// It creates throwaway clients — A (per-feature), B (monthly package) and C
// (Claude access off) — signs A and B in exactly as Claude does (registration,
// sign-in page, PKCE code, tokens), then checks that neither can see or touch
// the other's data, that money reads as the client portal shows it, that the
// sign-in guards hold, and that switching off / disconnecting / changing the key
// cuts a connected Claude off. Everything it created is deleted at the end,
// whatever happens. It prints results only, never keys or tokens.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const BASE = process.env.BASE || 'http://localhost:3000';
const IP = '198.51.100.7'; // documentation address ranges, so test traffic is recognisable
const GUESS_IP = '203.0.113.9';
const CALLBACK = 'http://localhost/connector-test/callback';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });

// ---- tiny test harness ----
let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
    if (ok) passed++;
    else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` — ${detail}` : ''}`);
}

const rand = () => randomBytes(6).toString('hex');
const tag = rand();
const created = { clients: [] as string[], apps: [] as string[] };

async function insert(table: string, row: Record<string, unknown>) {
    const { data, error } = await db.from(table).insert(row).select('*').single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data as any;
}

// ---- sign-in, the way Claude does it ----
const pkce = () => {
    const verifier = randomBytes(48).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

async function registerApp(): Promise<string> {
    const res = await fetch(`${BASE}/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-real-ip': IP },
        body: JSON.stringify({ client_name: 'Connector test', redirect_uris: [CALLBACK] }),
    });
    const body = await res.json();
    if (res.status !== 201 || !body.client_id) throw new Error(`register failed: ${res.status}`);
    created.apps.push(body.client_id);
    return body.client_id;
}

function authorizeParams(appId: string, challenge: string, extra: Record<string, string> = {}) {
    return new URLSearchParams({ response_type: 'code', client_id: appId, redirect_uri: CALLBACK, state: 'st-123', code_challenge: challenge, code_challenge_method: 'S256', scope: 'portal', ...extra });
}

async function submitKey(appId: string, challenge: string, key: string, ip = IP): Promise<Response> {
    const form = authorizeParams(appId, challenge);
    form.delete('response_type');
    form.set('access_key', key);
    return fetch(`${BASE}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-real-ip': ip }, body: form });
}

async function exchange(appId: string, code: string, verifier: string) {
    const res = await fetch(`${BASE}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: appId, code, redirect_uri: CALLBACK, code_verifier: verifier }),
    });
    return { status: res.status, body: (await res.json()) as any };
}

async function signIn(appId: string, key: string) {
    const { verifier, challenge } = pkce();
    const res = await submitKey(appId, challenge, key);
    const location = res.headers.get('location') || '';
    const code = new URL(location, BASE).searchParams.get('code');
    if (res.status !== 303 || !code) throw new Error(`sign-in failed: ${res.status}`);
    const t = await exchange(appId, code, verifier);
    if (t.status !== 200) throw new Error(`token exchange failed: ${t.status} ${t.body.error}`);
    return t.body as { access_token: string; refresh_token: string };
}

// ---- talking to the connector ----
async function connect(token: string) {
    const c = new Client({ name: 'connector-test', version: '1.0.0' });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}`, 'x-real-ip': IP } } }));
    return c;
}
const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
const body = (r: { content: { text: string }[] }) => JSON.parse(r.content[0].text);
const allText = (r: { content: { text: string }[] }) => r.content.map((x) => x.text).join('\n');

async function mcpStatus(token: string): Promise<number> {
    const res = await fetch(`${BASE}/mcp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    return res.status;
}

async function main() {
    // ---- throwaway data ----
    const A = await insert('clients', { name: `ZZ Connector Test A ${tag}`, access_key: `zz-conn-a-${rand()}`, billing_mode: 'per_feature', claude_access: true });
    const B = await insert('clients', {
        name: `ZZ Connector Test B ${tag}`, access_key: `zz-conn-b-${rand()}`, billing_mode: 'package', package_fee: 15000, package_cadence: 'monthly',
        package_status: 'active', package_started_on: '2026-08-01', package_anchor_day: 1, claude_access: true,
    });
    const C = await insert('clients', { name: `ZZ Connector Test C ${tag}`, access_key: `zz-conn-c-${rand()}`, billing_mode: 'per_feature', claude_access: false });
    created.clients.push(A.id, B.id, C.id);

    const A1 = await insert('projects', { client_id: A.id, category: 'Web', description: `A Website ${tag}`, status: 'In Progress', links: [{ title: 'Staging', url: 'https://example.com' }] });
    const B1 = await insert('projects', { client_id: B.id, category: 'App', description: `B App ${tag}`, status: 'In Progress', links: [] });
    const B2 = await insert('projects', { client_id: B.id, category: 'Uncategorized', description: `B Requested project ${tag}`, status: 'Requested', status_override: 'Requested', origin: 'client', links: [] });
    const f = (row: Record<string, unknown>) => insert('features', { origin: 'admin', is_new_request: false, estimation: '', ...row });
    await f({ project_id: A1.id, description: `A login page ${tag}`, amount: 10000, paid_amount: 4000, payment_confirmed: true, payment_status: 'Partial', status: 'Working', estimation: '2 days' });
    await f({ project_id: A1.id, description: `A dark mode ${tag}`, amount: 0, paid_amount: 0, payment_confirmed: false, payment_status: 'Pending', status: 'Approved' });
    await f({ project_id: A1.id, description: `A client idea ${tag}`, amount: 0, paid_amount: 0, payment_confirmed: false, payment_status: 'Pending', status: 'Requested', origin: 'client' });
    const Bonb = await f({ project_id: B1.id, description: `B onboarding ${tag}`, amount: 0, paid_amount: 0, payment_confirmed: false, payment_status: 'Pending', status: 'Working' });
    await f({ project_id: B1.id, description: `B payments ${tag}`, amount: 0, paid_amount: 0, payment_confirmed: true, payment_status: 'Paid', status: 'Completed' });
    const Bwish = await f({ project_id: B1.id, description: `B wish ${tag}`, amount: 0, paid_amount: 0, payment_confirmed: false, payment_status: 'Pending', status: 'Requested', origin: 'client' });
    await insert('billing_periods', { client_id: B.id, period_start: '2026-08-01', period_end: '2026-08-31', fee_amount: 15000, paid_amount: 15000, payment_status: 'Paid', origin: 'manual' });
    await insert('billing_periods', { client_id: B.id, period_start: '2026-09-01', period_end: '2026-09-30', fee_amount: 15000, paid_amount: 5000, payment_status: 'Partial', origin: 'manual' });
    await insert('activity_logs', { client_id: A.id, project_id: A1.id, action_type: 'feature_added', title: `A visible entry ${tag}`, metadata: {} });
    await insert('activity_logs', { client_id: A.id, project_id: A1.id, action_type: 'feature_added', title: `A hidden entry ${tag}`, metadata: {}, is_hidden: true });
    await insert('activity_logs', { client_id: B.id, project_id: B1.id, action_type: 'feature_added', title: `B private entry ${tag}`, metadata: {} });

    // ---- discovery documents ----
    const unauth = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    check('no token: /mcp answers 401 with where to sign in', unauth.status === 401 && /resource_metadata=/.test(unauth.headers.get('www-authenticate') || ''));
    const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json();
    check('protected-resource document names /mcp and the sign-in server', prm.resource === `${BASE}/mcp` && prm.authorization_servers?.[0] === BASE);
    const asm = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
    check('sign-in server document requires PKCE S256', JSON.stringify(asm.code_challenge_methods_supported) === '["S256"]' && !!asm.registration_endpoint);

    // ---- registration and the sign-in page ----
    const badReg = await fetch(`${BASE}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'] }) });
    check('registration refuses a non-Claude callback', badReg.status === 400);
    const appId = await registerApp();
    const { challenge: ch0 } = pkce();
    const page = await fetch(`${BASE}/oauth/authorize?${authorizeParams(appId, ch0)}`);
    const pageHtml = await page.text();
    check('sign-in page shows', page.status === 200 && pageHtml.includes('Connect Claude') && page.headers.get('x-frame-options') === 'DENY');
    const wrongRedirect = await fetch(`${BASE}/oauth/authorize?${authorizeParams(appId, ch0, { redirect_uri: 'http://localhost/elsewhere' })}`, { redirect: 'manual' });
    check('an unregistered redirect gets an error page, never a redirect', wrongRedirect.status === 400 && !wrongRedirect.headers.get('location'));
    const noPkce = await fetch(`${BASE}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: appId, redirect_uri: CALLBACK, state: 's' })}`, { redirect: 'manual' });
    check('sign-in without PKCE is refused', noPkce.status === 302 && (noPkce.headers.get('location') || '').includes('error=invalid_request'));

    const wrongKey = await submitKey(appId, ch0, 'definitely-not-a-key');
    check('a wrong key is refused', wrongKey.status === 401 && (await wrongKey.text()).includes('isn’t right'));
    const offKey = await submitKey(appId, ch0, C.access_key);
    check('a client with Claude access off is refused', offKey.status === 403 && (await offKey.text()).includes('switched on'));

    // ---- sign A and B in ----
    const tA = await signIn(appId, A.access_key);
    const tB = await signIn(appId, B.access_key);
    check('A and B sign in and get tokens', !!tA.access_token && !!tB.access_token);

    // a code works once, and only with its own verifier
    {
        const { verifier, challenge } = pkce();
        const res = await submitKey(appId, challenge, A.access_key);
        const code = new URL(res.headers.get('location') || '', BASE).searchParams.get('code')!;
        const wrongVerifier = await exchange(appId, code, pkce().verifier);
        check('a sign-in code with the wrong PKCE verifier is refused', wrongVerifier.status === 400 && wrongVerifier.body.error === 'invalid_grant');
        const replay = await exchange(appId, code, verifier);
        check('a sign-in code cannot be used twice', replay.status === 400);
    }

    const a = await connect(tA.access_token);
    const b = await connect(tB.access_token);

    // ---- no tool can even be asked about another client ----
    const tools = (await a.listTools()).tools;
    const clientParams = tools.flatMap((t) => Object.keys((t.inputSchema as any)?.properties || {})).filter((k) => /client/i.test(k));
    check(`no tool takes a client parameter (${tools.length} tools)`, clientParams.length === 0, clientParams.join(', '));

    // ---- payment reminder: first use of the day mentions what's owed, then quiet ----
    const firstA = await call(a, 'portal_overview');
    check('A: first call carries the payment reminder (₹6,000)', firstA.content.length === 2 && /₹6,000 outstanding/.test(firstA.content[1].text), allText(firstA).slice(-200));
    const secondA = await call(a, 'portal_overview');
    check('A: the next call does not repeat it', secondA.content.length === 1);
    const firstB = await call(b, 'portal_overview');
    check('B: package client is reminded of the unpaid invoice (₹10,000)', firstB.content.length === 2 && /₹10,000 outstanding/.test(firstB.content[1].text) && /September 2026 invoice/.test(firstB.content[1].text));

    // ---- money reads as the portal shows it ----
    const ovA = body(secondA);
    check('A (per-feature): totals leave out rate-pending work', ovA.money?.total === '₹10,000' && ovA.money?.paid === '₹4,000' && ovA.money?.toPay === '₹6,000', JSON.stringify(ovA.money));
    check('A: counts its rate-pending features', ovA.waiting?.featuresWithRatePending === 2);
    const pA = body(await call(a, 'get_project', { projectId: A1.id }));
    const darkMode = pA.features.find((x: any) => x.name.startsWith('A dark mode'));
    const login = pA.features.find((x: any) => x.name.startsWith('A login page'));
    check('A: a rate-pending feature says "Rate pending", no number', darkMode?.price === 'Rate pending');
    check('A: a priced feature shows price, paid and Partial', login?.price === '₹10,000' && login?.paid === '₹4,000' && login?.payment === 'Partial');

    const ovB = body((await call(b, 'portal_overview')));
    check('B (package): shows the retainer and what is unpaid', ovB.package?.fee === '₹15,000 a month' && ovB.package?.unpaid?.amount === '₹10,000' && !ovB.money, JSON.stringify(ovB.package));
    const pB = body(await call(b, 'get_project', { projectId: B1.id }));
    check('B: features say Covered (even with the rate flag off)', pB.features.every((x: any) => x.price === 'Covered by your monthly package'), JSON.stringify(pB.features.map((x: any) => x.price)));
    check('B: project money reads Covered', pB.money === 'Covered by your monthly package');
    const invB = body(await call(b, 'list_invoices'));
    check('B: both invoices listed', invB.invoices?.length === 2 && invB.invoices[0].for === 'September 2026');

    // ---- isolation: A cannot see or touch B (and the other way round) ----
    const listA = body(await call(a, 'list_projects'));
    check("A's project list has only A's projects", listA.length === 1 && listA[0].id === A1.id);
    const listB = body(await call(b, 'list_projects'));
    check("B's project list has only B's projects", listB.length === 2 && listB.every((p: any) => p.id !== A1.id));
    const peek = await call(a, 'get_project', { projectId: B1.id });
    check("A asking for B's project by id gets 'not found'", peek.isError === true && /not found/i.test(allText(peek)));
    const search = body(await call(a, 'find_feature', { query: `B onboarding ${tag}` }));
    check("A searching for B's feature by name finds nothing", search.found === 0);
    const feed = body(await call(a, 'recent_activity', { limit: 50 }));
    check("A's activity has only A's visible entries", feed.length === 1 && feed[0].what.startsWith('A visible entry'), JSON.stringify(feed.map((x: any) => x.what)));

    const before = await db.from('features').select('id', { count: 'exact', head: true }).eq('project_id', B1.id);
    const intrude = await call(a, 'request_feature', { projectId: B1.id, description: 'Sneaky feature' });
    const after = await db.from('features').select('id', { count: 'exact', head: true }).eq('project_id', B1.id);
    check("A cannot add a feature to B's project", intrude.isError === true && before.count === after.count);
    const rename = await call(a, 'request_rename', { featureId: Bonb.id, newName: 'Hijacked name' });
    check("A cannot ask to rename B's feature", rename.isError === true);
    const withdraw = await call(a, 'withdraw_feature_request', { featureId: Bwish.id });
    const stillThere = await db.from('features').select('id').eq('id', Bwish.id).maybeSingle();
    check("A cannot withdraw B's feature request", withdraw.isError === true && !!stillThere.data);
    const editB = await call(a, 'edit_project_request', { projectId: B2.id, name: 'Hijacked project' });
    check("A cannot edit B's project request", editB.isError === true);
    const killB = await call(a, 'withdraw_project_request', { projectId: B2.id });
    const b2There = await db.from('projects').select('id').eq('id', B2.id).maybeSingle();
    check("A cannot withdraw B's project request", killB.isError === true && !!b2There.data);
    const peekBack = await call(b, 'get_project', { projectId: A1.id });
    check("B asking for A's project by id gets 'not found'", peekBack.isError === true);

    // ---- requests work for the client's own work, through the portal's rules ----
    const req = await call(a, 'request_feature', { projectId: A1.id, description: `A new request ${tag}`, note: 'From the test' });
    const reqId = req.isError ? null : body(req).id;
    const row = reqId ? await db.from('features').select('origin, status, payment_confirmed').eq('id', reqId).maybeSingle() : null;
    check('A can request a feature on its own project (lands as a client request)', !!row?.data && row.data.origin === 'client' && row.data.status === 'Requested' && row.data.payment_confirmed === false);
    const log = await db.from('activity_logs').select('metadata').eq('client_id', A.id).eq('action_type', 'feature_requested').order('created_at', { ascending: false }).limit(1).maybeSingle();
    check("the request is logged as sent by the client's Claude", log.data?.metadata?.via === 'claude');
    const edited = await call(a, 'edit_feature_request', { featureId: reqId, description: `A new request edited ${tag}` });
    check('A can edit its own request', !edited.isError);
    const gone = await call(a, 'withdraw_feature_request', { featureId: reqId });
    const goneRow = await db.from('features').select('id').eq('id', reqId).maybeSingle();
    check('A can withdraw its own request', !gone.isError && !goneRow.data);
    const proj = await call(a, 'request_project', { name: `A new project ${tag}`, features: ['First thing', 'Second thing'] });
    const projId = proj.isError ? null : body(proj).id;
    check('A can request a new project with features', !!projId);
    const projGone = await call(a, 'withdraw_project_request', { projectId: projId });
    check('A can withdraw that project request', !projGone.isError);
    const renameOwn = await call(b, 'request_rename', { featureId: Bonb.id, newName: `B onboarding v2 ${tag}` });
    const mine = body(await call(b, 'my_requests'));
    check('B can ask to rename its own accepted feature', !renameOwn.isError && mine.renameRequests.length === 1);
    const unrename = await call(b, 'withdraw_rename', { renameRequestId: mine.renameRequests[0]?.renameRequestId });
    check('B can withdraw that rename request', !unrename.isError);

    // ---- switching off, disconnecting and changing the key cut access at once ----
    await db.from('clients').update({ claude_access: false }).eq('id', A.id);
    check("switching A's Claude access off cuts A off", (await mcpStatus(tA.access_token)) === 401);
    await db.from('clients').update({ claude_access: true }).eq('id', A.id);
    check('switching it back on lets the same sign-in work again', (await mcpStatus(tA.access_token)) === 200);
    await db.from('clients').update({ claude_epoch: 1 }).eq('id', A.id);
    check('Disconnect (epoch bump) cuts A off', (await mcpStatus(tA.access_token)) === 401);
    const tA2 = await signIn(appId, A.access_key);
    check('A can sign in again after a disconnect', (await mcpStatus(tA2.access_token)) === 200);
    await db.from('clients').update({ access_key: `zz-conn-a2-${rand()}` }).eq('id', A.id);
    check("changing A's access key cuts A off", (await mcpStatus(tA2.access_token)) === 401);
    check("…and B is unaffected throughout", (await mcpStatus(tB.access_token)) === 200);

    // ---- refresh tokens rotate; a reused one ends the sign-in ----
    const r1 = await fetch(`${BASE}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: appId, refresh_token: tB.refresh_token }) });
    const fresh = (await r1.json()) as any;
    check('B refreshes its sign-in', r1.status === 200 && (await mcpStatus(fresh.access_token)) === 200);
    const r2 = await fetch(`${BASE}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: appId, refresh_token: tB.refresh_token }) });
    check('reusing an old refresh token is refused', r2.status === 400);
    check('…and ends that sign-in (the new token stops working)', (await mcpStatus(fresh.access_token)) === 401);

    // ---- guessing keys gets blocked ----
    const { challenge: chG } = pkce();
    for (let i = 0; i < 5; i++) await submitKey(appId, chG, `guess-${i}-${rand()}`, GUESS_IP);
    const blocked = await submitKey(appId, chG, B.access_key, GUESS_IP);
    check('after 5 wrong keys from one address, even a right key is blocked for 15 minutes', blocked.status === 429);

    // ---- production only accepts Claude's own callbacks ----
    const { redirectAllowed } = await import('../lib/connector/auth');
    const env = process.env as Record<string, string | undefined>;
    const prev = env.NODE_ENV;
    env.NODE_ENV = 'production';
    check('in production, only claude.ai / claude.com callbacks are accepted (at registration and again at sign-in)',redirectAllowed('https://claude.ai/api/mcp/auth_callback') && !redirectAllowed(CALLBACK) && !redirectAllowed('https://evil.example/cb'));
    env.NODE_ENV = prev;

    await a.close();
    await b.close();
}

async function cleanup() {
    const ids = created.clients;
    if (ids.length) {
        const { data: projects } = await db.from('projects').select('id').in('client_id', ids);
        const pids = (projects || []).map((p: any) => p.id);
        await db.from('change_requests').delete().in('client_id', ids);
        await db.from('activity_logs').delete().in('client_id', ids);
        await db.from('billing_periods').delete().in('client_id', ids);
        if (pids.length) await db.from('features').delete().in('project_id', pids);
        await db.from('projects').delete().in('client_id', ids);
        await db.from('clients').delete().in('id', ids); // connector codes, tokens and reminders go with them
    }
    if (created.apps.length) await db.from('connector_oauth_clients').delete().in('client_id', created.apps);
    await db.from('connector_signin_attempts').delete().in('ip', [IP, GUESS_IP]);
    const left = ids.length ? await db.from('clients').select('id', { count: 'exact', head: true }).in('id', ids) : { count: 0 };
    console.log(`cleanup: removed the test clients and everything they made (${left.count ?? 0} left)`);
}

try {
    await main();
} catch (e) {
    failures.push(`crashed: ${e instanceof Error ? e.message : String(e)}`);
    console.log(`FAIL  crashed: ${e instanceof Error ? e.stack : String(e)}`);
} finally {
    await cleanup();
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
        for (const f of failures) console.log(`  - ${f}`);
        process.exitCode = 1;
    }
}
