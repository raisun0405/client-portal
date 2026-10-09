// Sign-in for the client Claude connector (OAuth 2.1 with PKCE, as claude.ai
// expects), and the check every connector request goes through.
//
// The one rule everything here serves: a token belongs to exactly ONE client,
// fixed at the moment that client typed their access key, and it only works
// while all of these still hold —
//   - the client's "Claude access" switch is on,
//   - their access key is the same one they signed in with (changing the key
//     cuts every connected Claude off), and
//   - they haven't been disconnected since (claude_epoch unchanged).
// Tokens, codes and the access key are never stored in the clear: tokens and
// codes as SHA-256, the key as an HMAC keyed by SESSION_SECRET.
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { supabaseService } from '@/lib/supabaseServer';
import { PUBLIC_ORIGIN } from '@/lib/hosts';

export const ACCESS_TTL_S = 60 * 60; // 1 hour
const REFRESH_TTL_S = 30 * 24 * 60 * 60; // 30 days
const CODE_TTL_S = 5 * 60; // 5 minutes
export const SCOPE = 'portal';

// Sign-in guard: per network address, and overall, so nobody can guess keys.
const MAX_FAILS_PER_IP = 5;
const MAX_FAILS_OVERALL = 30;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

// Where Claude (web, desktop, phone) sends the sign-in result. Anything else is
// refused at registration. Local test runs may also use localhost.
const CLAUDE_CALLBACKS = ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'];

export type ConnectorClient = { id: string; name: string; billingMode: 'package' | 'per_feature' };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const newSecret = (prefix: string) => `${prefix}${randomBytes(32).toString('base64url')}`;

function keyHash(accessKey: string): string {
    const secret = process.env.SESSION_SECRET;
    if (!secret) throw new Error('SESSION_SECRET is not configured.');
    return createHmac('sha256', secret).update(`connector-key:${accessKey.trim()}`).digest('hex');
}

const isProduction = () => process.env.NODE_ENV === 'production';

// The public address of the connector: the client portal's domain in
// production, whatever the dev server answers on locally.
export function baseUrl(req: Request): string {
    return isProduction() ? PUBLIC_ORIGIN : new URL(req.url).origin;
}

export function clientIp(req: Request): string {
    const real = req.headers.get('x-real-ip');
    if (real) return real.trim();
    const fwd = req.headers.get('x-forwarded-for');
    return fwd ? fwd.split(',')[0].trim() : 'unknown';
}

export function redirectAllowed(uri: string): boolean {
    if (CLAUDE_CALLBACKS.includes(uri)) return true;
    if (isProduction()) return false;
    try {
        const u = new URL(uri);
        return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
    } catch {
        return false;
    }
}

// ---- App registration (RFC 7591) ----

export async function registerApp(input: { client_name?: unknown; redirect_uris?: unknown }): Promise<{ clientId: string; clientName: string | null; redirectUris: string[] } | { error: string }> {
    const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
    if (uris.length === 0 || uris.length > 5) return { error: 'redirect_uris must list one to five addresses.' };
    if (!uris.every(redirectAllowed)) return { error: 'Only Claude can connect to this portal.' };
    const clientName = typeof input.client_name === 'string' ? input.client_name.slice(0, 100) : null;
    const clientId = `rsc_${randomUUID()}`;
    const { error } = await supabaseService().from('connector_oauth_clients').insert({ client_id: clientId, client_name: clientName, redirect_uris: uris });
    if (error) return { error: 'Could not register.' };
    return { clientId, clientName, redirectUris: uris };
}

export async function getApp(clientId: string): Promise<{ client_id: string; client_name: string | null; redirect_uris: string[] } | null> {
    if (!clientId || clientId.length > 100) return null;
    const { data } = await supabaseService().from('connector_oauth_clients').select('client_id, client_name, redirect_uris').eq('client_id', clientId).maybeSingle();
    return data ?? null;
}

// ---- Sign-in with an access key ----

export async function tooManyAttempts(ip: string): Promise<boolean> {
    const db = supabaseService();
    const since = new Date(Date.now() - FAIL_WINDOW_MS).toISOString();
    const [mine, all] = await Promise.all([
        db.from('connector_signin_attempts').select('id', { count: 'exact', head: true }).eq('ip', ip).eq('ok', false).gte('created_at', since),
        db.from('connector_signin_attempts').select('id', { count: 'exact', head: true }).eq('ok', false).gte('created_at', since),
    ]);
    return (mine.count ?? 0) >= MAX_FAILS_PER_IP || (all.count ?? 0) >= MAX_FAILS_OVERALL;
}

export async function recordAttempt(ip: string, ok: boolean): Promise<void> {
    await supabaseService().from('connector_signin_attempts').insert({ ip, ok });
}

export type SignInOutcome =
    | { ok: true; client: { id: string; name: string; epoch: number; keyHash: string } }
    | { ok: false; reason: 'wrong_key' | 'not_enabled' };

// The same check as the portal's own login: the key, trimmed, matched exactly.
export async function checkAccessKey(accessKey: string): Promise<SignInOutcome> {
    const key = accessKey.trim();
    if (key.length < 3 || key.length > 200) return { ok: false, reason: 'wrong_key' };
    const { data } = await supabaseService().from('clients').select('id, name, access_key, claude_access, claude_epoch').eq('access_key', key).maybeSingle();
    if (!data) return { ok: false, reason: 'wrong_key' };
    if (!data.claude_access) return { ok: false, reason: 'not_enabled' };
    return { ok: true, client: { id: data.id, name: data.name, epoch: data.claude_epoch ?? 0, keyHash: keyHash(data.access_key) } };
}

export async function issueCode(input: {
    appId: string;
    redirectUri: string;
    codeChallenge: string;
    scope: string;
    client: { id: string; epoch: number; keyHash: string };
}): Promise<string> {
    const code = newSecret('rsa_');
    const { error } = await supabaseService().from('connector_auth_codes').insert({
        code_hash: sha256(code),
        oauth_client_id: input.appId,
        portal_client_id: input.client.id,
        redirect_uri: input.redirectUri,
        code_challenge: input.codeChallenge,
        scope: input.scope,
        key_hash: input.client.keyHash,
        epoch: input.client.epoch,
        expires_at: new Date(Date.now() + CODE_TTL_S * 1000).toISOString(),
    });
    if (error) throw new Error('Could not start the sign-in.');
    return code;
}

// ---- Tokens ----

type Tokens = { access_token: string; refresh_token: string; token_type: 'Bearer'; expires_in: number; scope: string };
export type TokenError = { error: 'invalid_request' | 'invalid_grant' | 'invalid_client' | 'unsupported_grant_type'; error_description: string };

async function issueTokens(grant: { grantId: string; appId: string; clientId: string; keyHash: string; epoch: number; scope: string }): Promise<Tokens> {
    const access = newSecret('rst_');
    const refresh = newSecret('rsr_');
    const now = Date.now();
    const base = { grant_id: grant.grantId, oauth_client_id: grant.appId, portal_client_id: grant.clientId, scope: grant.scope, key_hash: grant.keyHash, epoch: grant.epoch };
    const { error } = await supabaseService()
        .from('connector_tokens')
        .insert([
            { ...base, token_hash: sha256(access), kind: 'access', expires_at: new Date(now + ACCESS_TTL_S * 1000).toISOString() },
            { ...base, token_hash: sha256(refresh), kind: 'refresh', expires_at: new Date(now + REFRESH_TTL_S * 1000).toISOString() },
        ]);
    if (error) throw new Error('Could not issue tokens.');
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: ACCESS_TTL_S, scope: grant.scope };
}

// The client must still be allowed: switch on, same key, not disconnected since.
async function stillAllowed(clientId: string, keyHashAtSignIn: string, epochAtSignIn: number) {
    const { data } = await supabaseService().from('clients').select('id, name, access_key, claude_access, claude_epoch, billing_mode').eq('id', clientId).maybeSingle();
    if (!data || !data.claude_access) return null;
    if ((data.claude_epoch ?? 0) !== epochAtSignIn) return null;
    if (keyHash(data.access_key) !== keyHashAtSignIn) return null;
    return data;
}

const pkceMatches = (verifier: string, challenge: string) =>
    /^[A-Za-z0-9\-._~]{43,128}$/.test(verifier) && createHash('sha256').update(verifier).digest('base64url') === challenge;

export async function redeemCode(input: { code: string; appId: string; redirectUri: string; codeVerifier: string }): Promise<Tokens | TokenError> {
    const db = supabaseService();
    // Mark it used in the same statement that finds it, so a code works once.
    const { data: rows } = await db
        .from('connector_auth_codes')
        .update({ used_at: new Date().toISOString() })
        .eq('code_hash', sha256(input.code))
        .is('used_at', null)
        .select('*');
    const row = rows?.[0];
    const bad = (d: string): TokenError => ({ error: 'invalid_grant', error_description: d });
    if (!row) return bad('This sign-in code is invalid or was already used.');
    if (new Date(row.expires_at).getTime() < Date.now()) return bad('This sign-in code has expired. Connect again.');
    if (row.oauth_client_id !== input.appId) return bad('This sign-in code was issued to another app.');
    if (row.redirect_uri !== input.redirectUri) return bad('The redirect address does not match.');
    if (!pkceMatches(input.codeVerifier, row.code_challenge)) return bad('The PKCE check failed.');
    if (!(await stillAllowed(row.portal_client_id, row.key_hash, row.epoch))) return bad('Claude access is not available for this account.');
    return issueTokens({ grantId: randomUUID(), appId: row.oauth_client_id, clientId: row.portal_client_id, keyHash: row.key_hash, epoch: row.epoch, scope: row.scope || SCOPE });
}

// Refresh tokens rotate: each one works once. Presenting one that was already
// rotated means it leaked, so the whole sign-in is ended.
export async function refreshTokens(input: { refreshToken: string; appId: string }): Promise<Tokens | TokenError> {
    const db = supabaseService();
    const bad = (d: string): TokenError => ({ error: 'invalid_grant', error_description: d });
    const { data: row } = await db.from('connector_tokens').select('*').eq('token_hash', sha256(input.refreshToken)).eq('kind', 'refresh').maybeSingle();
    if (!row) return bad('Unknown refresh token. Connect again.');
    if (row.oauth_client_id !== input.appId) return bad('This refresh token belongs to another app.');
    if (row.revoked_at) {
        await db.from('connector_tokens').update({ revoked_at: new Date().toISOString() }).eq('grant_id', row.grant_id).is('revoked_at', null);
        return bad('This refresh token was already used. Connect again.');
    }
    if (new Date(row.expires_at).getTime() < Date.now()) return bad('This sign-in has expired. Connect again.');
    if (!(await stillAllowed(row.portal_client_id, row.key_hash, row.epoch))) return bad('Claude access is not available for this account.');
    const { data: claimed } = await db.from('connector_tokens').update({ revoked_at: new Date().toISOString() }).eq('token_hash', row.token_hash).is('revoked_at', null).select('token_hash');
    if (!claimed?.length) return bad('This refresh token was already used. Connect again.');
    return issueTokens({ grantId: row.grant_id, appId: row.oauth_client_id, clientId: row.portal_client_id, keyHash: row.key_hash, epoch: row.epoch, scope: row.scope || SCOPE });
}

// ---- Every connector request ----

// The client this request acts for, or null (no token, or it no longer works).
export async function authenticate(req: Request): Promise<ConnectorClient | null> {
    const header = req.headers.get('authorization') || '';
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    if (!m) return null;
    const db = supabaseService();
    const { data: row } = await db
        .from('connector_tokens')
        .select('token_hash, portal_client_id, key_hash, epoch, expires_at, revoked_at')
        .eq('token_hash', sha256(m[1]))
        .eq('kind', 'access')
        .maybeSingle();
    if (!row || row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) return null;
    const client = await stillAllowed(row.portal_client_id, row.key_hash, row.epoch);
    if (!client) return null;
    void db.from('connector_tokens').update({ last_used_at: new Date().toISOString() }).eq('token_hash', row.token_hash).then(() => {});
    return { id: client.id, name: client.name, billingMode: client.billing_mode === 'package' ? 'package' : 'per_feature' };
}
