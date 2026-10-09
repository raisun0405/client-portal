// The client Claude connector (MCP over Streamable HTTP, stateless). Every
// request must carry a sign-in token; it decides the ONE client this request
// acts for, and the tools are built around that client alone.
// See docs/CLIENT_CONNECTOR.md.
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { authenticate, baseUrl, SCOPE } from '@/lib/connector/auth';
import { CORS, json, preflight } from '@/lib/connector/http';
import { buildServer } from '@/lib/connector/tools';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// No (working) token: point Claude at the sign-in documents so it can connect.
function unauthorized(req: Request): Response {
    return json({ error: 'invalid_token', error_description: 'Sign in to connect your Rai Sun portal.' }, 401, {
        'WWW-Authenticate': `Bearer resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource", scope="${SCOPE}"`,
    });
}

export async function POST(req: Request) {
    const client = await authenticate(req);
    if (!client) return unauthorized(req);

    const server = buildServer(client);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
        const res = await transport.handleRequest(req);
        const headers = new Headers(res.headers);
        for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
        return new Response(res.body, { status: res.status, headers });
    } finally {
        await server.close();
    }
}

// Stateless: there is no server-to-client stream to open and no session to end.
async function notAllowed(req: Request): Promise<Response> {
    if (!(await authenticate(req))) return unauthorized(req);
    return json({ error: 'method_not_allowed', error_description: 'This connector only accepts POST.' }, 405, { Allow: 'POST' });
}

export const GET = notAllowed;
export const DELETE = notAllowed;
export const OPTIONS = preflight;
