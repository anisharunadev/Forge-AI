// FORA-165 acceptance fixture: CI RED.
// Application code MUST NOT mention BYPASSRLS. The lint must fail the build.
export const appRole = `CREATE ROLE app_user BYPASSRLS`;
