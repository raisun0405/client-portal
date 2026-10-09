// RFC 7591 dynamic registration: Claude registers itself once before the first
// sign-in. Only Claude's own sign-in callback addresses are accepted.
import { registerApp } from '@/lib/connector/auth';
import { json, preflight } from '@/lib/connector/http';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'invalid_client_metadata', error_description: 'Send the registration as JSON.' }, 400);
    }
    const app = await registerApp(body ?? {});
    if ('error' in app) return json({ error: 'invalid_redirect_uri', error_description: app.error }, 400);
    return json(
        {
            client_id: app.clientId,
            client_id_issued_at: Math.floor(Date.now() / 1000),
            ...(app.clientName ? { client_name: app.clientName } : {}),
            redirect_uris: app.redirectUris,
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
        },
        201,
    );
}

export const OPTIONS = preflight;
