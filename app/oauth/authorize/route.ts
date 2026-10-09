// The sign-in step: Claude sends the client here; they type their portal access
// key; we send Claude a one-time code. An unknown app, or a redirect address the
// app didn't register, gets an error page, never a redirect.
import { checkAccessKey, clientIp, getApp, issueCode, recordAttempt, redirectAllowed, SCOPE, tooManyAttempts } from '@/lib/connector/auth';
import { errorPage, signInPage, type SignInParams } from '@/lib/connector/page';

export const dynamic = 'force-dynamic';

type App = NonNullable<Awaited<ReturnType<typeof getApp>>>;

function readParams(source: URLSearchParams | FormData): SignInParams {
    const get = (k: string) => {
        const v = source.get(k);
        return typeof v === 'string' ? v.slice(0, 2000) : '';
    };
    return {
        client_id: get('client_id'),
        redirect_uri: get('redirect_uri'),
        state: get('state'),
        code_challenge: get('code_challenge'),
        code_challenge_method: get('code_challenge_method'),
        scope: get('scope') || SCOPE,
        resource: get('resource'),
    };
}

function errorRedirect(p: SignInParams, error: string, description: string): Response {
    const to = new URL(p.redirect_uri);
    to.searchParams.set('error', error);
    to.searchParams.set('error_description', description);
    if (p.state) to.searchParams.set('state', p.state);
    return new Response(null, { status: 302, headers: { Location: to.toString(), 'Cache-Control': 'no-store' } });
}

async function validate(p: SignInParams, responseType: string | null): Promise<{ app: App } | { stop: Response }> {
    const app = await getApp(p.client_id);
    if (!app) return { stop: errorPage('This connection request isn’t recognised.') };
    // Registered AND still allowed: dev and production share one database, so an
    // app registered by a local test run (localhost callback) is refused live.
    if (!app.redirect_uris.includes(p.redirect_uri) || !redirectAllowed(p.redirect_uri)) return { stop: errorPage('This connection request isn’t valid.') };
    if (responseType !== null && responseType !== 'code') return { stop: errorRedirect(p, 'unsupported_response_type', 'Only the code flow is supported.') };
    if (p.code_challenge_method !== 'S256' || !/^[A-Za-z0-9\-._~]{43,128}$/.test(p.code_challenge)) {
        return { stop: errorRedirect(p, 'invalid_request', 'PKCE with S256 is required.') };
    }
    return { app };
}

export async function GET(req: Request) {
    const url = new URL(req.url);
    const p = readParams(url.searchParams);
    const v = await validate(p, url.searchParams.get('response_type'));
    if ('stop' in v) return v.stop;
    return signInPage(p, v.app.client_name);
}

export async function POST(req: Request) {
    let form: FormData;
    try {
        form = await req.formData();
    } catch {
        return errorPage('Something went wrong. Start again from Claude.');
    }
    const p = readParams(form);
    const v = await validate(p, null);
    if ('stop' in v) return v.stop;

    const ip = clientIp(req);
    if (await tooManyAttempts(ip)) return signInPage(p, v.app.client_name, 'Too many attempts. Please wait 15 minutes, then try again.', 429);

    const key = form.get('access_key');
    const outcome = await checkAccessKey(typeof key === 'string' ? key : '');
    // A real key that just isn't switched on yet is not a guess, so it doesn't count.
    await recordAttempt(ip, outcome.ok || outcome.reason === 'not_enabled');
    if (!outcome.ok) {
        return outcome.reason === 'not_enabled'
            ? signInPage(p, v.app.client_name, 'Claude access isn’t switched on for your portal yet. Ask Rai Sun to turn it on, then try again.', 403)
            : signInPage(p, v.app.client_name, 'That access key isn’t right. Check it and try again.', 401);
    }

    const code = await issueCode({ appId: v.app.client_id, redirectUri: p.redirect_uri, codeChallenge: p.code_challenge, scope: SCOPE, client: outcome.client });
    const to = new URL(p.redirect_uri);
    to.searchParams.set('code', code);
    if (p.state) to.searchParams.set('state', p.state);
    return new Response(null, { status: 303, headers: { Location: to.toString(), 'Cache-Control': 'no-store' } });
}
