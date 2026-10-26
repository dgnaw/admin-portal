CREATE TABLE IF NOT EXISTS audit_events (
  event_id     UUID PRIMARY KEY,
  event_type   TEXT NOT NULL,
  occurred_at  TIMESTAMPTZ NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id    TEXT NOT NULL,
  product_code TEXT NOT NULL,
  actor_type   TEXT NOT NULL,
  actor_id     TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT audit_actor_type_valid CHECK (actor_type IN ('user', 'service', 'system'))
);

CREATE INDEX IF NOT EXISTS audit_by_tenant_time ON audit_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_by_actor_time  ON audit_events (actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_by_type_time   ON audit_events (event_type, occurred_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_writer') THEN
    CREATE ROLE audit_writer LOGIN PASSWORD 'audit_writer';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_maintainer') THEN
    CREATE ROLE audit_maintainer LOGIN PASSWORD 'audit_maintainer';
  END IF;
END
$$;

REVOKE ALL ON audit_events FROM audit_writer, audit_maintainer;
GRANT SELECT, INSERT ON audit_events TO audit_writer;
GRANT SELECT, DELETE ON audit_events TO audit_maintainer;
GRANT USAGE ON SCHEMA public TO audit_writer, audit_maintainer;

CREATE OR REPLACE FUNCTION purge_audit_events(older_than INTERVAL)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE removed BIGINT;
BEGIN
  DELETE FROM audit_events WHERE occurred_at < now() - older_than;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END
$$;
