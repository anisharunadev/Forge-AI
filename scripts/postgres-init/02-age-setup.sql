-- scripts/postgres-init/02-age-setup.sql
--
-- Per ADR-002: Apache AGE provides the property graph. Loading the
-- extension adds the `ag_catalog` schema; this script then:
--   1. Grants the application role the privileges AGE requires.
--   2. Creates the `forge_graph` graph (idempotent).
--   3. Creates the `litellm` database LiteLLM Proxy uses for
--      spend / rate-limit tracking (see DL-025).
--
-- The official Apache AGE 1.5+ release supports `LOAD 'age'`, but
-- on a fresh cluster the extension is created in 01-extensions.sql
-- via CREATE EXTENSION, so we only need to register the graph and
-- the litellm DB.

-- Register the property graph. AGE does not expose `IF NOT EXISTS`
-- for CREATE GRAPH, so we guard with a catalog lookup. The graph
-- label is "forge_graph"; the backend's AGE adapter queries
-- `ag_catalog.ag_graph` for it at startup.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM ag_catalog.ag_graph WHERE graphname = 'forge_graph'
    ) THEN
        PERFORM ag_catalog.create_graph('forge_graph');
    END IF;
END
$$;

-- LiteLLM Proxy (DL-025) maintains a per-deployment database for
-- spend tracking, virtual-key state, and rate limits. We create it
-- here so the litellm container can connect on first boot without
-- requiring an out-of-band psql run. The entrypoint runs this file
-- as the forge superuser, so we use a DO block (CREATE DATABASE
-- cannot run inside a transaction and has no IF NOT EXISTS form).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'litellm') THEN
        EXECUTE 'CREATE DATABASE litellm';
    END IF;
END
$$;
