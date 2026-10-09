// RFC 8414: where Claude registers, sends the client to sign in, and swaps the
// sign-in code for tokens. PKCE (S256) is required; there are no client secrets.
import { baseUrl, SCOPE } from '@/lib/connector/auth';
import { json, preflight } from '@/lib/connector/http';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
    const base = baseUrl(req);
    return json({
        issuer: base,
        authorization_endpoint: `${base}/oauth/authorize`,
        token_endpoint: `${base}/oauth/token`,
        registration_endpoint: `${base}/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: [SCOPE],
    });
}

export const OPTIONS = preflight;
