"""WorkflowService — CRUD + DAG validation for custom workflows.

Tenant-scoped (Rule 2). The service is the only writer of
``workflows`` and ``workflow_runs`` rows; the API layer is a thin
adapter that maps service exceptions to ``HTTPException``s.

Cycle detection and trigger uniqueness live here, not in Pydantic
schemas, per the project convention (schemas use ``Field(...)`` only;
structural validation lives in the service).
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.workflow import Workflow, WorkflowRun, WorkflowRunStatus
from app.schemas.workflow import WorkflowCreate, WorkflowDefinition, WorkflowUpdate
from app.services.event_bus import EventType, bus


class WorkflowNotFound(LookupError):
    """Raised when a workflow or run row cannot be found for a tenant."""


class WorkflowValidationError(ValueError):
    """Raised when the submitted DAG is malformed (cycle, missing trigger,
    dangling edges, etc.)."""


class WorkflowConflictError(ValueError):
    """Raised when a name conflict occurs (UNIQUE on tenant/project/name)."""


class WorkflowService:
    """Stateless service; methods take a session explicitly so the FastAPI
    endpoint can compose it with `db: DbSession` and tests can drive it
    through the in-memory engine."""

    # ---- Validation helpers ------------------------------------------------

    @staticmethod
    def validate_definition(definition: WorkflowDefinition) -> None:
        """Reject malformed DAGs. Raises WorkflowValidationError."""

        # 1. Exactly one trigger.
        triggers = [n for n in definition.nodes if n.data.type == "trigger"]
        if len(triggers) != 1:
            raise WorkflowValidationError(
                f"workflow must have exactly 1 trigger node (got {len(triggers)})"
            )

        # 2. Node ids unique.
        ids = [n.id for n in definition.nodes]
        if len(set(ids)) != len(ids):
            duplicates = {i for i in ids if ids.count(i) > 1}
            raise WorkflowValidationError(f"duplicate node ids: {sorted(duplicates)}")

        # 3. Edge endpoints reference existing nodes.
        id_set = set(ids)
        for e in definition.edges:
            if e.source not in id_set or e.target not in id_set:
                raise WorkflowValidationError(
                    f"edge {e.id} references unknown node (source={e.source}, target={e.target})"
                )

        # 4. No self-loops.
        for e in definition.edges:
            if e.source == e.target:
                raise WorkflowValidationError(f"edge {e.id} is a self-loop on node {e.source}")

        # 5. Cycle detection via DFS on the adjacency map.
        adj: dict[str, list[str]] = {n.id: [] for n in definition.nodes}
        for e in definition.edges:
            adj[e.source].append(e.target)
        WHITE, GRAY, BLACK = 0, 1, 2
        color = {nid: WHITE for nid in ids}

        def dfs(start: str) -> None:
            stack: list[tuple[str, int]] = [(start, 0)]
            color[start] = GRAY
            while stack:
                node, idx = stack[-1]
                children = adj[node]
                if idx < len(children):
                    stack[-1] = (node, idx + 1)
                    nxt = children[idx]
                    if color[nxt] == GRAY:
                        raise WorkflowValidationError(f"cycle detected involving node {nxt}")
                    if color[nxt] == WHITE:
                        color[nxt] = GRAY
                        stack.append((nxt, 0))
                else:
                    color[node] = BLACK
                    stack.pop()

        for nid in ids:
            if color[nid] == WHITE:
                dfs(nid)

    # ---- CRUD --------------------------------------------------------------

    async def create_workflow(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        project_id: UUID,
        created_by: UUID,
        body: WorkflowCreate,
    ) -> Workflow:
        self.validate_definition(body.definition)

        # Soft-deleted rows still occupy the unique name slot, so we
        # look across both live and deleted rows.
        existing = (
            await db.execute(
                select(Workflow).where(
                    Workflow.tenant_id == tenant_id,
                    Workflow.project_id == project_id,
                    Workflow.name == body.name,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            raise WorkflowConflictError(f"name already in use: {body.name}")

        workflow = Workflow(
            id=uuid4(),
            tenant_id=tenant_id,
            project_id=project_id,
            name=body.name,
            description=body.description,
            definition=body.definition.model_dump(mode="json"),
            created_by=created_by,
        )
        db.add(workflow)
        await db.commit()
        await db.refresh(workflow)

        await bus.publish(
            EventType.WORKFLOW_CREATED,
            {"workflow_id": str(workflow.id), "name": workflow.name},
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=created_by,
        )
        return workflow

    async def list_workflows(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        project_id: UUID | None = None,
        include_deleted: bool = False,
    ) -> list[Workflow]:
        stmt = select(Workflow).where(Workflow.tenant_id == tenant_id)
        if project_id is not None:
            stmt = stmt.where(Workflow.project_id == project_id)
        if not include_deleted:
            stmt = stmt.where(Workflow.deleted_at.is_(None))
        stmt = stmt.order_by(Workflow.updated_at.desc())
        return list((await db.execute(stmt)).scalars().all())

    async def get_workflow(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        workflow_id: UUID,
        include_deleted: bool = False,
    ) -> Workflow:
        stmt = select(Workflow).where(
            Workflow.id == workflow_id,
            Workflow.tenant_id == tenant_id,
        )
        if not include_deleted:
            stmt = stmt.where(Workflow.deleted_at.is_(None))
        wf = (await db.execute(stmt)).scalar_one_or_none()
        if wf is None:
            raise WorkflowNotFound(f"workflow {workflow_id} not found")
        return wf

    async def update_workflow(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        actor_id: UUID,
        workflow_id: UUID,
        body: WorkflowUpdate,
    ) -> Workflow:
        wf = await self.get_workflow(db, tenant_id=tenant_id, workflow_id=workflow_id)
        if body.definition is not None:
            self.validate_definition(body.definition)
            wf.definition = body.definition.model_dump(mode="json")
        if body.name is not None:
            wf.name = body.name
        if body.description is not None:
            wf.description = body.description
        if body.status is not None:
            wf.status = body.status
        await db.commit()
        await db.refresh(wf)

        await bus.publish(
            EventType.WORKFLOW_UPDATED,
            {"workflow_id": str(wf.id), "name": wf.name},
            tenant_id=tenant_id,
            project_id=wf.project_id,
            actor_id=actor_id,
        )
        return wf

    async def soft_delete_workflow(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        actor_id: UUID,
        workflow_id: UUID,
    ) -> None:
        wf = await self.get_workflow(db, tenant_id=tenant_id, workflow_id=workflow_id)
        wf.deleted_at = datetime.now(UTC)
        await db.commit()

        await bus.publish(
            EventType.WORKFLOW_DELETED,
            {"workflow_id": str(wf.id), "name": wf.name},
            tenant_id=tenant_id,
            project_id=wf.project_id,
            actor_id=actor_id,
        )

    # ---- Run lifecycle (Phase B stubs; executor wires in Phase C) -----------

    async def create_run(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        project_id: UUID,
        triggered_by: UUID,
        workflow_id: UUID,
    ) -> WorkflowRun:
        wf = await self.get_workflow(db, tenant_id=tenant_id, workflow_id=workflow_id)
        run = WorkflowRun(
            id=uuid4(),
            workflow_id=wf.id,
            tenant_id=tenant_id,
            project_id=project_id,
            status=WorkflowRunStatus.PENDING,
            triggered_by=triggered_by,
            state={"stepResults": {}},
        )
        db.add(run)
        wf.latest_run_id = run.id
        await db.commit()
        await db.refresh(run)

        await bus.publish(
            EventType.WORKFLOW_RUN_STARTED,
            {"workflow_id": str(wf.id), "run_id": str(run.id)},
            tenant_id=tenant_id,
            project_id=project_id,
            actor_id=triggered_by,
        )
        return run

    async def list_runs(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        workflow_id: UUID,
        limit: int = 50,
        offset: int = 0,
    ) -> list[WorkflowRun]:
        stmt = (
            select(WorkflowRun)
            .where(
                WorkflowRun.tenant_id == tenant_id,
                WorkflowRun.workflow_id == workflow_id,
            )
            .order_by(WorkflowRun.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list((await db.execute(stmt)).scalars().all())

    async def list_all_runs(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        limit: int = 50,
        offset: int = 0,
    ) -> list[WorkflowRun]:
        """Tenant-wide run index for the Runs Center (separate from per-workflow)."""
        stmt = (
            select(WorkflowRun)
            .where(WorkflowRun.tenant_id == tenant_id)
            .order_by(WorkflowRun.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list((await db.execute(stmt)).scalars().all())

    async def get_run(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        run_id: UUID,
    ) -> WorkflowRun:
        run = (
            await db.execute(
                select(WorkflowRun).where(
                    WorkflowRun.id == run_id,
                    WorkflowRun.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        if run is None:
            raise WorkflowNotFound(f"run {run_id} not found")
        return run

    async def cancel_run(
        self,
        db: AsyncSession,
        *,
        tenant_id: UUID,
        actor_id: UUID,
        run_id: UUID,
    ) -> WorkflowRun:
        run = await self.get_run(db, tenant_id=tenant_id, run_id=run_id)
        if run.status in (
            WorkflowRunStatus.SUCCEEDED,
            WorkflowRunStatus.FAILED,
            WorkflowRunStatus.CANCELLED,
        ):
            raise WorkflowConflictError(
                f"run {run_id} is terminal ({run.status.value}); cannot cancel"
            )
        run.status = WorkflowRunStatus.CANCELLED
        run.finished_at = datetime.now(UTC)
        await db.commit()
        await db.refresh(run)
        await bus.publish(
            EventType.WORKFLOW_RUN_CANCELLED,
            {"run_id": str(run.id), "workflow_id": str(run.workflow_id)},
            tenant_id=tenant_id,
            project_id=run.project_id,
            actor_id=actor_id,
        )
        return run


# Module-level singleton — mirrors sdlc_run_manager.get_default_manager().
service = WorkflowService()


__all__ = [
    "WorkflowConflictError",
    "WorkflowNotFound",
    "WorkflowService",
    "WorkflowValidationError",
    "service",
]
