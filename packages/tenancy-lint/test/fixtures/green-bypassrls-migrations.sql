-- FORA-165 acceptance fixture: CI GREEN.
-- The migration runner is the ONLY path allowed to grant BYPASSRLS.
-- The lint must NOT fire on this file because it lives under `migrations/`.
CREATE ROLE migration_runner BYPASSRLS;
