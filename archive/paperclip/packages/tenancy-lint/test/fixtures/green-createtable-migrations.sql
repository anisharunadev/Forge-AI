-- FORA-165 acceptance fixture: CI GREEN.
-- The migration runner emits the CREATE TABLE here. RLS + tenant_isolation
-- are also in the file, so the warning check does NOT fire either.
CREATE TABLE app.projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  name        text NOT NULL
);

ALTER TABLE app.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app.projects
  USING (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
