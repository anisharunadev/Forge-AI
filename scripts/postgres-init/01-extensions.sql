-- scripts/postgres-init/01-extensions.sql
--
-- Per ADR-002: PostgreSQL 17 carries pgvector (vectors), Apache AGE
-- (graph), and the standard crypto / UUID extensions. Every CREATE
-- EXTENSION is idempotent (IF NOT EXISTS) so re-running this file
-- against an existing volume is a no-op.
--
-- This file is mounted to /docker-entrypoint-initdb.d/ in
-- docker-compose.yml and runs *only* on the first boot of a fresh
-- data volume. Schema changes for existing databases belong in
-- Alembic migrations (scripts/db-migrate.sh).

-- pgcrypto: gen_random_uuid() and digest() for hashing tokens/secrets.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- uuid-ossp: secondary UUID source for libraries that prefer it
-- over pgcrypto. Harmless to have both.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- pgvector: vector and halfvec types used for embedding search.
-- ADR-002: vectors live alongside the OLTP rows.
CREATE EXTENSION IF NOT EXISTS vector;

-- Apache AGE: graph database extension (Cypher queries).
-- ADR-002: the property graph is a peer of the relational tables.
CREATE EXTENSION IF NOT EXISTS age;
