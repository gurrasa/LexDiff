-- PostgreSQL schema for a future authenticated server adapter.
-- Do NOT expose direct client INSERT/SELECT privileges on these tables.
BEGIN;
CREATE TABLE IF NOT EXISTS lexdiff_evidence (
 hash TEXT PRIMARY KEY CHECK (hash ~ '^0x[0-9a-f]{64}$'),
 kind TEXT NOT NULL CHECK (kind IN ('terms','agreement-document','report','decision-note')),
 ciphertext BYTEA NOT NULL,
 encryption_key_id TEXT NOT NULL,
 created_by TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (octet_length(ciphertext) > 0)
);
CREATE TABLE IF NOT EXISTS lexdiff_legal_events (
 event_id UUID PRIMARY KEY,
 agreement_id NUMERIC(78,0) NOT NULL CHECK (agreement_id >= 0),
 actor TEXT NOT NULL,
 event_type TEXT NOT NULL,
 statement_hash TEXT NOT NULL CHECK (statement_hash ~ '^0x[0-9a-f]{64}$'),
 previous_event_id UUID,
 occurred_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lexdiff_case_snapshots (
 snapshot_id UUID PRIMARY KEY,
 agreement_id NUMERIC(78,0) NOT NULL,
 manifest_hash TEXT NOT NULL CHECK (manifest_hash ~ '^0x[0-9a-f]{64}$'),
 cutoff_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lexdiff_access_audit (
 audit_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_hmac TEXT NOT NULL,
 resource_hmac TEXT NOT NULL,
 action TEXT NOT NULL,
 allowed BOOLEAN NOT NULL,
 occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Application identity must not own tables; revoke PUBLIC access.
REVOKE ALL ON lexdiff_evidence, lexdiff_legal_events, lexdiff_case_snapshots, lexdiff_access_audit FROM PUBLIC;
-- Restrict mutation even if an application role is later granted INSERT/SELECT.
CREATE OR REPLACE FUNCTION lexdiff_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'LexDiff append-only table'; END; $$;
DROP TRIGGER IF EXISTS evidence_immutable ON lexdiff_evidence;
CREATE TRIGGER evidence_immutable BEFORE UPDATE OR DELETE ON lexdiff_evidence FOR EACH ROW EXECUTE FUNCTION lexdiff_reject_mutation();
DROP TRIGGER IF EXISTS legal_events_immutable ON lexdiff_legal_events;
CREATE TRIGGER legal_events_immutable BEFORE UPDATE OR DELETE ON lexdiff_legal_events FOR EACH ROW EXECUTE FUNCTION lexdiff_reject_mutation();
DROP TRIGGER IF EXISTS snapshots_immutable ON lexdiff_case_snapshots;
CREATE TRIGGER snapshots_immutable BEFORE UPDATE OR DELETE ON lexdiff_case_snapshots FOR EACH ROW EXECUTE FUNCTION lexdiff_reject_mutation();
DROP TRIGGER IF EXISTS audit_immutable ON lexdiff_access_audit;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON lexdiff_access_audit FOR EACH ROW EXECUTE FUNCTION lexdiff_reject_mutation();
COMMIT;
