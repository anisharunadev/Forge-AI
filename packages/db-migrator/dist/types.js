/**
 * Types for @fora/db-migrator.
 *
 * The runner is intentionally tiny: a model is a list of columns, and the
 * runner emits the SQL for the table, the RLS policy, and the role grants.
 * Keeping the shape flat makes the BYPASSRLS audit and the property-based
 * test trivial — there is no codegen, no DSL, no surprises.
 */
export {};
//# sourceMappingURL=types.js.map