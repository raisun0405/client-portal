-- 0005_client_connector (up)
-- The client Claude connector: a client's own Claude (claude.ai, desktop, phone)
-- can read that client's portal and send requests, after the client signs in
-- with their access key. Additive only: two defaulted columns on clients and
-- four new server-only tables. Existing rows are untouched.

-- Per-client switch, off by default. `claude_epoch` is bumped by "Disconnect
-- Claude": every sign-in remembers the epoch it was issued under, so bumping it
-- cuts off every connected Claude for that client at once.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS claude_access boolean NOT NULL DEFAULT false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS claude_epoch integer NOT NULL DEFAULT 0;

-- Apps that registered themselves for sign-in (Claude does this once, by itself).
CREATE TABLE IF NOT EXISTS connector_oauth_clients (
    client_id text PRIMARY KEY,
    client_name text,
    redirect_uris text[] NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- One-time sign-in codes: valid for 5 minutes, used once, stored hashed.
CREATE TABLE IF NOT EXISTS connector_auth_codes (
    code_hash text PRIMARY KEY,
    oauth_client_id text NOT NULL REFERENCES connector_oauth_clients(client_id) ON DELETE CASCADE,
    portal_client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    redirect_uri text NOT NULL,
    code_challenge text NOT NULL,
    scope text,
    key_hash text NOT NULL,
    epoch integer NOT NULL,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Access tokens (1 hour) and refresh tokens (30 days), stored hashed. A token
-- works only while the client's switch is on, their access key is unchanged
-- (key_hash), and they haven't been disconnected since it was issued (epoch).
CREATE TABLE IF NOT EXISTS connector_tokens (
    token_hash text PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('access', 'refresh')),
    grant_id uuid NOT NULL,
    oauth_client_id text NOT NULL REFERENCES connector_oauth_clients(client_id) ON DELETE CASCADE,
    portal_client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    scope text,
    key_hash text NOT NULL,
    epoch integer NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    last_used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS connector_tokens_client_idx ON connector_tokens (portal_client_id);
CREATE INDEX IF NOT EXISTS connector_tokens_grant_idx ON connector_tokens (grant_id);

-- Sign-in attempts, to stop anyone guessing access keys.
CREATE TABLE IF NOT EXISTS connector_signin_attempts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ip text NOT NULL,
    ok boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS connector_signin_attempts_ip_idx ON connector_signin_attempts (ip, created_at);

-- Server-only: row level security on, with no policies, so neither the public
-- key nor a signed-in admin session can read or write these. Only the website's
-- secret key (server side) can.
ALTER TABLE connector_oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_auth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_signin_attempts ENABLE ROW LEVEL SECURITY;
