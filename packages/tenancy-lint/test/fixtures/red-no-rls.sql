-- FORA-165 acceptance fixture: CI RED.
-- Multi-tenant table created without ENABLE ROW LEVEL SECURITY.
-- The lint must warn (multi-tenant table needs RLS) and the build must pass
-- for warnings; reviewers see the warning in the PR.

CREATE TABLE app.projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  name        text NOT NULL
);
