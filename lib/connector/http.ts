// Small response helpers for the connector's JSON endpoints. Auth is by bearer
// token, never cookies, so allowing any origin is safe (and lets browser-based
// MCP tools reach the discovery documents).
export const CORS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
    'Access-Control-Expose-Headers': 'WWW-Authenticate, mcp-session-id',
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...extra },
    });
}

export function preflight(): Response {
    return new Response(null, { status: 204, headers: CORS });
}
