// The same document at its path-specific address (RFC 9728 §3.1), which some
// clients ask for first because the resource lives at /mcp.
import { baseUrl, SCOPE } from '@/lib/connector/auth';
import { json, preflight } from '@/lib/connector/http';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
    const base = baseUrl(req);
    return json({
        resource: `${base}/mcp`,
        authorization_servers: [base],
        scopes_supported: [SCOPE],
        bearer_methods_supported: ['header'],
        resource_name: 'Rai Sun client portal',
    });
}

export const OPTIONS = preflight;
