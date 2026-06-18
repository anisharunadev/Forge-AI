// FORA-165 acceptance fixture: CI GREEN.
// The audit-log writer is the ONLY application-side role allowed to BYPASSRLS
// (so it can read the audit log across tenants for the admin view).
// The lint must NOT fire on this file because it lives under `audit/`.
export const auditRole = `CREATE ROLE audit_writer BYPASSRLS`;
