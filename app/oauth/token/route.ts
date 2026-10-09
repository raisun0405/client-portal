// Swaps a one-time sign-in code (with its PKCE verifier) for tokens, and
// rotates refresh tokens. Public clients: no secrets, PKCE instead.
import { getApp, redeemCode, refreshTokens } from '@/lib/connector/auth';
import { json, preflight } from '@/lib/connector/http';

export const dynamic = 'force-dynamic';

async function readBody(req: Request): Promise<URLSearchParams> {
    if ((req.headers.get('content-type') || '').includes('application/json')) {
        const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        return new URLSearchParams(Object.entries(body ?? {}).map(([k, v]) => [k, String(v)]));
    }
    return new URLSearchParams(await req.text());
}

export async function POST(req: Request) {
    const params = await readBody(req);
    let appId = params.get('client_id') || '';
    // Some clients send the id as HTTP Basic (with an empty secret) instead.
    const basic = /^Basic\s+(.+)$/i.exec(req.headers.get('authorization') || '');
    if (!appId && basic) {
        try {
            appId = decodeURIComponent(Buffer.from(basic[1], 'base64').toString('utf8').split(':')[0]);
        } catch {
            appId = '';
        }
    }
    const app = await getApp(appId);
    if (!app) return json({ error: 'invalid_client', error_description: 'Unknown app.' }, 401);

    const grant = params.get('grant_type');
    if (grant === 'authorization_code') {
        const code = params.get('code');
        const redirectUri = params.get('redirect_uri');
        const codeVerifier = params.get('code_verifier');
        if (!code || !redirectUri || !codeVerifier) return json({ error: 'invalid_request', error_description: 'code, redirect_uri and code_verifier are required.' }, 400);
        const result = await redeemCode({ code, appId: app.client_id, redirectUri, codeVerifier });
        return 'error' in result ? json(result, 400) : json(result);
    }
    if (grant === 'refresh_token') {
        const refreshToken = params.get('refresh_token');
        if (!refreshToken) return json({ error: 'invalid_request', error_description: 'refresh_token is required.' }, 400);
        const result = await refreshTokens({ refreshToken, appId: app.client_id });
        return 'error' in result ? json(result, 400) : json(result);
    }
    return json({ error: 'unsupported_grant_type', error_description: 'Use authorization_code or refresh_token.' }, 400);
}

export const OPTIONS = preflight;
