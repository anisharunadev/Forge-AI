-- FORA-165 acceptance fixture: CI RED.
-- Application code MUST NOT run CREATE TABLE. The migration runner is the
-- only path that creates tables. The lint must fail the build.
CREATE TABLE app.audit_lookalike (
  id  uuid PRIMARY KEY
);
