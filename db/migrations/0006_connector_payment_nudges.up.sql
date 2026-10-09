-- 0006_connector_payment_nudges (up)
-- When a client's Claude uses the connector and money is owed, the connector
-- reminds Claude to mention it: on the first use of the day, at most twice a
-- day. Each reminder is recorded here so the limit holds (and so you can see
-- when a client was reminded). Additive only; server-only like the other
-- connector tables.

CREATE TABLE IF NOT EXISTS connector_payment_nudges (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    portal_client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    amount numeric NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS connector_payment_nudges_client_idx ON connector_payment_nudges (portal_client_id, created_at);

ALTER TABLE connector_payment_nudges ENABLE ROW LEVEL SECURITY;
