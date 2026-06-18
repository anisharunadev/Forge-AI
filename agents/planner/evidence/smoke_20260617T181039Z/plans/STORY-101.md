# Plan — STORY-101

- **Plan id:** `plan-c3d61fff62`
- **Story shape:** `crud_entity`
- **Generated at:** 2026-06-17T18:10:39Z
- **Schema version:** 0.1.0
- **Task count:** 6

## Task list

### t-001 — Create add_user_entity table migration

- **Type:** `migration`
- **Effort:** S
- **Depends on:** —
- **Acceptance criteria:** ac-1, ac-2, ac-3
- **Files touched:** `apps/api/src/db/migrations/add_user_entity_table.sql`

Add the database table for Add User entity. Include id (uuid), audit columns (created_at, updated_at), and the per-AC columns derived from the acceptance criteria.

### t-002 — Implement add_user_entity model

- **Type:** `model`
- **Effort:** M
- **Depends on:** t-001
- **Acceptance criteria:** ac-1, ac-2, ac-3
- **Files touched:** `apps/api/src/models/add_user_entity.py`

Implement the add_user_entity entity with field validation and the to_dict / from_row converters used by the service layer.

### t-003 — Implement add_user_entity service

- **Type:** `service`
- **Effort:** M
- **Depends on:** t-002
- **Acceptance criteria:** ac-1, ac-2, ac-3
- **Files touched:** `apps/api/src/services/add_user_entity_service.py`

Implement the add_user_entity business logic — CRUD + any side-effects called out in the AC descriptions.

### t-004 — Wire add_user_entity controller

- **Type:** `controller`
- **Effort:** M
- **Depends on:** t-003
- **Acceptance criteria:** ac-1, ac-2, ac-3
- **Files touched:** `apps/api/src/controllers/add_user_entity_controller.py`

Expose add_user_entity over the HTTP surface — RESTful routes that delegate to the service. Validate request bodies, shape responses, and surface typed errors.

### t-005 — Add add_user_entity unit tests

- **Type:** `test`
- **Effort:** M
- **Depends on:** t-002, t-003, t-004
- **Acceptance criteria:** ac-1, ac-2, ac-3
- **Files touched:** `apps/api/test/unit/add_user_entity/`

Unit tests for the add_user_entity model, service, and controller. Cover the happy path and the AC failure cases.

### t-006 — Add add_user_entity integration tests

- **Type:** `test`
- **Effort:** L
- **Depends on:** t-005
- **Acceptance criteria:** ac-1, ac-2, ac-3
- **Files touched:** `apps/api/test/integration/add_user_entity/`

Integration tests for add_user_entity end-to-end against a real (test-container) DB. Verifies migration + service + controller wiring.
