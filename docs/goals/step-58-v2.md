/goal


Wire three project-domain pages to the real backend: Project Intelligence (epics/stories/briefs/drafts), Stories Center (kanban + lifecycle), and Architecture Center (9 tabs: ADRs, API Contracts, Risk Registers, Standards, Acceptance, Approvals, Task Breakdowns, Traceability, Versions). Backend has 40+ routes across these areas, but no seed data. The Stories Center has working hooks (`useStories`, `useCreateStory`, `useUpdateStoryStatus`) but mock-data is still in scope. The Architecture Center has 9 tabs with components but no real hooks — every tab is wired to `SAMPLE_*` arrays or hardcoded counts.


Read these files first to understand the current state:

- `backend/app/api/v1/stories.py` (8 routes — full CRUD + bulk + linked)

- `backend/app/api/v1/projects.py` (4 routes — bootstrap + status)

- `backend/app/api/v1/architecture/adrs.py` (4 routes — list + supersede)

- `backend/app/api/v1/architecture/contracts.py` (5 routes — validate + publish)

- `backend/app/api/v1/architecture/risk_registers.py` (6 routes — top risks)

- `backend/app/api/v1/architecture/standards.py` (3 routes — attestations)

- `backend/app/api/v1/architecture/approvals.py` (5 routes — decide + cancel)

- `backend/app/api/v1/architecture/task_breakdowns.py` (4 routes)

- `backend/app/api/v1/architecture/traceability.py` (4 routes — orphans + lineage)

- `backend/app/api/v1/architecture/versions.py` (4 routes — diff + rollback)

- `backend/app/api/v1/architecture/acceptance.py` (4 routes — coverage)

- `backend/app/db/models/architecture.py` (ADR, APIContract, RiskRegister, TaskBreakdown)

- `backend/app/db/models/project.py`

- `backend/app/db/models/story.py`

- `apps/forge/app/stories/page.tsx` (orchestrator)

- `apps/forge/app/stories/_components/StoriesCenter.tsx` (uses real hooks)

- `apps/forge/lib/api/stories.ts` (full type defs + query keys)

- `apps/forge/lib/stories/mock-data.ts` (FIXTURE — needs replacement)

- `apps/forge/lib/stories/types.ts`

- `apps/forge/app/architecture/page.tsx` (9-tab orchestrator)

- `apps/forge/components/architecture/ADRSidebar.tsx` + `ADRViewer.tsx`

- `apps/forge/components/architecture/APIContractList.tsx`

- `apps/forge/components/architecture/RiskRegisterKanban.tsx`

- `apps/forge/components/architecture/TaskBreakdownTree.tsx`

- `apps/forge/components/architecture/TraceabilityGraph.tsx`

- `apps/forge/components/architecture/VersionTimeline.tsx`

- `apps/forge/app/project-intelligence/page.tsx` (server-rendered, uses `intelligence/data.ts`)

- `apps/forge/lib/intelligence/data.ts` (orchestrator stub fetcher)


INVOKE THE SKILL BEFORE CODING:

  python3 -c "import webbrowser; webbrowser.open('https://dndkit.com/')"

  python3 -c "import webbrowser; webbrowser.open('https://miro.com/templates/architecture-decision-record/')"


Read the dnd-kit docs (used for kanban drag-drop) and MADR format for ADRs.


Adopt every rule. Then build in this order:


==========================================================

ZONE 1 — REAL PROJECTS SEED

==========================================================


CREATE `backend/scripts/seed_projects.py`:


```python

#!/usr/bin/env python3

"""Seed real projects + epics + sprints.


Inserts 3 projects (Acme Platform, Connector Migration, Workflow

Editor) with 5 epics and 3 sprints across them. Run:


    docker compose exec backend python -m scripts.seed_projects

"""


import asyncio, random

from uuid import uuid4

from datetime import datetime, timezone, timedelta

from app.db.session import async_session_maker

from app.db.models.project import Project

from app.db.models.epic import Epic, EpicStatus

from app.db.models.sprint import Sprint, SprintStatus

from app.db.models.tenant import Tenant

from sqlalchemy import select



SEED_PROJECTS = [

    {

        "name": "Acme Platform",

        "slug": "acme-platform",

        "description": "Core SDLC agent orchestration platform for Acme Corp",

    },

    {

        "name": "Connector Migration",

        "slug": "connector-migration",

        "description": "Migrate legacy Forge connectors to the new typed-event model",

    },

    {

        "name": "Workflow Editor V2",

        "slug": "workflow-editor-v2",

        "description": "Modern canvas editor with version control + collaboration",

    },

]



SEED_EPICS = [

    {

        "project_slug": "acme-platform",

        "title": "Multi-tenant query isolation",

        "description": "Every query carries tenant_id + project_id (Rule 2)",

        "status": EpicStatus.IN_PROGRESS,

    },

    {

        "project_slug": "acme-platform",

        "title": "LiteLLM proxy integration",

        "description": "All LLM traffic routes through LiteLLM (Rule 1)",

        "status": EpicStatus.DONE,

    },

    {

        "project_slug": "connector-migration",

        "title": "Jira typed events",

        "description": "Migrate Jira webhook ingestion to connector.events.observed",

        "status": EpicStatus.IN_PROGRESS,

    },

    {

        "project_slug": "workflow-editor-v2",

        "title": "Version control for workflows",

        "description": "git-style branching + diff + rollback for workflow definitions",

        "status": EpicStatus.PLANNED,

    },

    {

        "project_slug": "workflow-editor-v2",

        "title": "Real-time collaborative editing",

        "description": "Multi-user canvas editing via CRDT",

        "status": EpicStatus.PLANNED,

    },

]



SEED_SPRINTS = [

    {

        "project_slug": "acme-platform",

        "name": "Sprint 25.13",

        "goal": "Ship Stories Center + draw audit timeline",

        "start_offset_days": -7,

        "end_offset_days": 7,

        "status": SprintStatus.ACTIVE,

    },

    {

        "project_slug": "acme-platform",

        "name": "Sprint 25.14",

        "goal": "Connector Center live data + Jira sync",

        "start_offset_days": 7,

        "end_offset_days": 21,

        "status": SprintStatus.PLANNING,

    },

    {

        "project_slug": "connector-migration",

        "name": "Sprint C-04",

        "goal": "Migrate 3 connectors (GitHub, Jira, Slack)",

        "start_offset_days": -3,

        "end_offset_days": 11,

        "status": SprintStatus.ACTIVE,

    },

]



async def seed():

    async with async_session_maker() as session:

        tenant = (await session.execute(

            select(Tenant).where(Tenant.slug == "acme-corp")

        )).scalar_one_or_none()

        if not tenant:

            print("✗ Tenant acme-corp not found")

            return

        

        existing = (await session.execute(

            select(Project).where(Project.tenant_id == tenant.id)

        )).scalars().first()

        if existing:

            print("  → Projects already seeded")

            return

        

        projects_by_slug = {}

        for spec in SEED_PROJECTS:

            p = Project(

                id=str(uuid4()),

                tenant_id=tenant.id,

                name=spec["name"],

                slug=spec["slug"],

                description=spec["description"],

                created_at=datetime.now(timezone.utc),

                updated_at=datetime.now(timezone.utc),

            )

            session.add(p)

            await session.flush()

            projects_by_slug[spec["slug"]] = p

            print(f"✓ Project: {spec['name']}")

        

        for spec in SEED_EPICS:

            epic = Epic(

                id=str(uuid4()),

                tenant_id=tenant.id,

                project_id=projects_by_slug[spec["project_slug"]].id,

                title=spec["title"],

                description=spec["description"],

                status=spec["status"],

            )

            session.add(epic)

            print(f"✓ Epic: {spec['title']} ({spec['project_slug']})")

        

        for spec in SEED_SPRINTS:

            start = datetime.now(timezone.utc) + timedelta(days=spec["start_offset_days"])

            end = datetime.now(timezone.utc) + timedelta(days=spec["end_offset_days"])

            sprint = Sprint(

                id=str(uuid4()),

                tenant_id=tenant.id,

                project_id=projects_by_slug[spec["project_slug"]].id,

                name=spec["name"],

                goal=spec["goal"],

                start_date=start,

                end_date=end,

                status=spec["status"],

            )

            session.add(sprint)

            print(f"✓ Sprint: {spec['name']} ({spec['project_slug']})")

        

        await session.commit()

        print(f"\n✅ Seeded {len(SEED_PROJECTS)} projects, {len(SEED_EPICS)} epics, {len(SEED_SPRINTS)} sprints")



if __name__ == "__main__":

    asyncio.run(seed())
Run:

bash

Copy
docker compose exec backend python -m scripts.seed_projects
========================================================== ZONE 2 — REAL STORIES SEED
CREATE backend/scripts/seed_stories.py:

python

Copy
#!/usr/bin/env python3

"""Seed real user stories across projects + sprints + epics.


Inserts ~30 stories with realistic status distribution (5 BACKLOG,

8 IN_PROGRESS, 4 IN_REVIEW, 6 DONE, 3 BLOCKED, 4 ACCEPTED) so the

kanban board shows a real sprint in motion.


Run: docker compose exec backend python -m scripts.seed_stories

"""


import asyncio, random

from uuid import uuid4

from datetime import datetime, timezone, timedelta

from app.db.session import async_session_maker

from app.db.models.story import Story, StoryStatus, StoryPriority, StoryEstimate

from app.db.models.tenant import Tenant

from app.db.models.project import Project

from app.db.models.epic import Epic

from app.db.models.sprint import Sprint

from app.db.models.user import User

from sqlalchemy import select



def story_seeds():

    return [

        # ===== ACTIVE SPRINT (Sprint 25.13) =====

        ("acme-platform", "Sprint 25.13", "Multi-tenant query isolation", 

         "Add tenant_id guard to /projects routes", StoryStatus.IN_PROGRESS, StoryPriority.P1, StoryEstimate.M),

        ("acme-platform", "Sprint 25.13", "Multi-tenant query isolation",

         "Add tenant_id guard to /stories routes", StoryStatus.IN_REVIEW, StoryPriority.P1, StoryEstimate.S),

        ("acme-platform", "Sprint 25.13", "LiteLLM proxy integration",

         "Configure LiteLLM with Anthropic + OpenAI keys", StoryStatus.DONE, StoryPriority.P0, StoryEstimate.M),

        ("acme-platform", "Sprint 25.13", "LiteLLM proxy integration",

         "Wire Co-pilot to call LiteLLM proxy", StoryStatus.IN_PROGRESS, StoryPriority.P0, StoryEstimate.L),

        ("acme-platform", "Sprint 25.13", None,

         "Audit timeline drawer renders correctly", StoryStatus.IN_PROGRESS, StoryPriority.P2, StoryEstimate.M),

        ("acme-platform", "Sprint 25.13", None,

         "Story detail drawer shows linked Jira ticket", StoryStatus.BLOCKED, StoryPriority.P2, StoryEstimate.S),

        

        # ===== PLANNED SPRINT (Sprint 25.14) =====

        ("acme-platform", "Sprint 25.14", "Multi-tenant query isolation",

         "Audit log shows every tenant-scoped query", StoryStatus.BACKLOG, StoryPriority.P2, StoryEstimate.M),

        ("acme-platform", "Sprint 25.14", None,

         "Connector Center wired to real API", StoryStatus.BACKLOG, StoryPriority.P0, StoryEstimate.L),

        

        # ===== DONE =====

        ("acme-platform", "Sprint 25.12", None,

         "Set up Keycloak realm for forge-tenancy", StoryStatus.ACCEPTED, StoryPriority.P0, StoryEstimate.S),

        ("acme-platform", "Sprint 25.12", None,

         "Wire forge-pi package as a workspace", StoryStatus.ACCEPTED, StoryPriority.P1, StoryEstimate.S),

        ("acme-platform", "Sprint 25.12", None,

         "Add forge-pi-bootstrap command", StoryStatus.DONE, StoryPriority.P2, StoryEstimate.S),

        

        # ===== CONNECTOR MIGRATION =====

        ("connector-migration", "Sprint C-04", "Jira typed events",

         "Implement Jira connector.event.observed handler", StoryStatus.IN_PROGRESS, StoryPriority.P0, StoryEstimate.L),

        ("connector-migration", "Sprint C-04", "Jira typed events",

         "Add unit tests for Jira event ingestion", StoryStatus.IN_PROGRESS, StoryPriority.P1, StoryEstimate.M),

        ("connector-migration", "Sprint C-04", None,

         "Migrate GitHub connector to typed events", StoryStatus.IN_REVIEW, StoryPriority.P1, StoryEstimate.L),

        ("connector-migration", "Sprint C-04", None,

         "Migrate Slack connector to typed events", StoryStatus.BACKLOG, StoryPriority.P2, StoryEstimate.M),

        ("connector-migration", "Sprint C-04", None,

         "Connector idempotency keys for retry safety", StoryStatus.DONE, StoryPriority.P0, StoryEstimate.S),

        

        # ===== WORKFLOW EDITOR V2 =====

        ("workflow-editor-v2", None, "Version control for workflows",

         "Design versioned workflow model", StoryStatus.BACKLOG, StoryPriority.P1, StoryEstimate.L),

        ("workflow-editor-v2", None, "Version control for workflows",

         "Implement diff view between two workflow versions", StoryStatus.BACKLOG, StoryPriority.P1, StoryEstimate.L),

        ("workflow-editor-v2", None, "Real-time collaborative editing",

         "Evaluate CRDT libraries (Yjs vs Automerge)", StoryStatus.BLOCKED, StoryPriority.P2, StoryEstimate.M),

        ("workflow-editor-v2", None, "Real-time collaborative editing",

         "Set up Yjs presence layer", StoryStatus.BACKLOG, StoryPriority.P2, StoryEstimate.L),

        

        # ===== Misc backlogs =====

        ("acme-platform", None, None,

         "Add Cost ceiling policy to all workflows", StoryStatus.BACKLOG, StoryPriority.P2, StoryEstimate.S),

        ("acme-platform", None, None,

         "Document approval gates in /docs/architecture", StoryStatus.BACKLOG, StoryPriority.P3, StoryEstimate.XS),

        ("acme-platform", None, None,

         "Add governance violation UI for failed audits", StoryStatus.BLOCKED, StoryPriority.P2, StoryEstimate.M),

        

        # ===== Done/Accepted =====

        ("acme-platform", None, None,

         "Implement OIDC callback handler", StoryStatus.ACCEPTED, StoryPriority.P0, StoryEstimate.M),

        ("acme-platform", None, None,

         "Set up TanStack Query provider", StoryStatus.ACCEPTED, StoryPriority.P1, StoryEstimate.S),

        ("acme-platform", None, None,

         "Add audit log writer decorator", StoryStatus.DONE, StoryPriority.P0, StoryEstimate.S),

        ("acme-platform", None, None,

         "Wire forge-core canonical skills loader", StoryStatus.DONE, StoryPriority.P1, StoryEstimate.M),

        ("connector-migration", None, None,

         "Connector registry schema migration", StoryStatus.DONE, StoryPriority.P0, StoryEstimate.M),

        ("workflow-editor-v2", None, None,

         "Workflow editor accessibility audit (axe)", StoryStatus.IN_REVIEW, StoryPriority.P3, StoryEstimate.S),

    ]



async def seed():

    async with async_session_maker() as session:

        tenant = (await session.execute(

            select(Tenant).where(Tenant.slug == "acme-corp")

        )).scalar_one_or_none()

        if not tenant:

            print("✗ Tenant acme-corp not found")

            return

        

        existing = (await session.execute(

            select(Story).where(Story.tenant_id == tenant.id)

        )).scalars().first()

        if existing:

            print("  → Stories already seeded")

            return

        

        # Lookup projects

        projects = (await session.execute(

            select(Project).where(Project.tenant_id == tenant.id)

        )).scalars().all()

        projects_by_slug = {p.slug: p for p in projects}

        

        # Lookup epics

        epics = (await session.execute(

            select(Epic).where(Epic.tenant_id == tenant.id)

        )).scalars().all()

        epics_by_title = {e.title: e for e in epics}

        

        # Lookup sprints

        sprints = (await session.execute(

            select(Sprint).where(Sprint.tenant_id == tenant.id)

        )).scalars().all()

        sprints_by_name = {s.name: s for s in sprints}

        

        # Lookup user

        user = (await session.execute(

            select(User).where(User.email == "arun@acme-corp.com")

        )).scalar_one_or_none()

        user_id = user.id if user else tenant.id

        

        # Lookup assignees

        users = (await session.execute(

            select(User).where(User.tenant_id == tenant.id)

        )).scalars().all()

        assignees = [u.id for u in users] or [user_id]

        

        for proj_slug, sprint_name, epic_title, title, status, priority, estimate in story_seeds():

            project = projects_by_slug.get(proj_slug)

            if not project:

                continue

            

            sprint = sprints_by_name.get(sprint_name) if sprint_name else None

            epic = epics_by_title.get(epic_title) if epic_title else None

            

            # Acceptance criteria

            acceptance = [

                {

                    "id": str(uuid4()),

                    "description": f"Given the system, when {title.lower()}, then expected outcome",

                    "met": status in [StoryStatus.DONE, StoryStatus.ACCEPTED],

                },

                {

                    "id": str(uuid4()),

                    "description": f"Verify with unit tests",

                    "met": status == StoryStatus.ACCEPTED,

                },

            ]

            

            # Labels

            labels_map = {

                "acme-platform": ["platform", "core"],

                "connector-migration": ["connectors", "migration"],

                "workflow-editor-v2": ["editor", "ux"],

            }

            base_labels = labels_map.get(proj_slug, [])

            extra = []

            if status == StoryStatus.BLOCKED:

                extra.append("blocked")

            if priority == StoryPriority.P0:

                extra.append("urgent")

            

            story = Story(

                id=str(uuid4()),

                tenant_id=tenant.id,

                project_id=project.id,

                reporter_id=user_id,

                assignee_id=random.choice(assignees),

                sprint_id=sprint.id if sprint else None,

                epic_id=epic.id if epic else None,

                title=title,

                description=f"Detailed description for: {title}",

                status=status,

                priority=priority,

                estimate=estimate,

                labels=base_labels + extra,

                acceptance_criteria=acceptance,

                source="MANUAL",

                created_at=datetime.now(timezone.utc) - timedelta(days=random.randint(1, 30)),

            )

            session.add(story)

        

        await session.commit()

        print(f"✅ Seeded {len(story_seeds())} stories")



if __name__ == "__main__":

    asyncio.run(seed())
Run:

bash

Copy
docker compose exec backend python -m scripts.seed_stories
VERIFY:

bash

Copy
docker compose exec postgres psql -U forge -d forge -c "SELECT status, COUNT(*) FROM stories GROUP BY status;"
Should show: backlog 5+, in_progress 4+, in_review 2+, done 4+, blocked 2+, accepted 4+.

========================================================== ZONE 3 — REPLACE STORIES MOCK-DATA WITH REAL API
In apps/forge/app/stories/_components/StoriesCenter.tsx, the imports already use useStories, useCreateStory, etc. — those hooks exist in apps/forge/lib/api/stories.ts. VERIFY they call the correct backend routes.

CHECK apps/forge/lib/api/stories.ts:

typescript

Copy
// Find these functions:

export async function listStories(filter: StoryFilter): Promise<Story[]> {

  return request<Story[]>(`/v1/stories/stories?${new URLSearchParams(filter as any)}`);

}


export async function createStory(input: StoryCreateInput): Promise<Story> {

  return request<Story>('/v1/stories/stories', {

    method: 'POST',

    body: JSON.stringify(input),

  });

}


export async function updateStory(id: string, patch: StoryUpdateInput): Promise<Story> {

  return request<Story>(`/v1/stories/stories/${id}`, {

    method: 'PATCH',

    body: JSON.stringify(patch),

  });

}
VERIFY the paths match backend stories.py:

GET /stories/stories → list
POST /stories/stories → create
GET /stories/stories/{id} → read
PATCH /stories/stories/{id} → update
DELETE /stories/stories/{id} → delete
PATCH /stories/stories/bulk → bulk update
GET /stories/stories/{id}/linked → linked items
If paths don't match, FIX in apps/forge/lib/api/stories.ts.

DELETE apps/forge/lib/stories/mock-data.ts — replaced by real API. Or keep it as offline fallback (similar to connectors pattern).

VERIFY the kanban drag-drop PATCHes status field correctly:

typescript

Copy
const handleDrop = async (storyId: string, newStatus: StoryStatus) => {

  await updateStory({ id: storyId, status: newStatus });

  // TanStack invalidates the query → re-render

};
========================================================== ZONE 4 — ARCHITECTURE CENTER SEED (ADRs + CONTRACTS + RISKS + TASK BREAKDOWNS)
CREATE backend/scripts/seed_architecture.py:

python

Copy
#!/usr/bin/env python3

"""Seed real architecture artifacts: ADRs, API contracts, risk

registers, task breakdowns, approvals, versions, attestations.


Inserts a realistic architecture baseline for the Acme Platform

project so the 9 Architecture Center tabs all have data.


Run: docker compose exec backend python -m scripts.seed_architecture

"""


import asyncio, json, random

from uuid import uuid4

from datetime import datetime, timezone, timedelta

from app.db.session import async_session_maker

from app.db.models.architecture import (

    ADR, APIContract, RiskRegister, TaskBreakdown,

    ArchitectureApproval, ArchitectureVersion, StandardAttestation,

    ADRStatus, ContractStatus, RiskStatus, TaskBreakdownStatus,

)

from app.db.models.tenant import Tenant

from app.db.models.project import Project

from app.db.models.user import User

from sqlalchemy import select



SEED_ADRS = [

    {

        "number": 1,

        "title": "Use LangGraph for SDLC orchestration",

        "status": ADRStatus.ACCEPTED,

        "context": "We need a robust orchestration substrate for multi-agent SDLC runs. Options evaluated: LangGraph, custom state machine, Temporal, AWS Step Functions.",

        "decision": "Adopt LangGraph as the primary orchestration substrate. It gives us graph-based state, checkpointing, and a Python-native API that matches our backend stack.",

        "consequences": {

            "positive": ["Rich state primitives", "Built-in checkpointing", "Strong typing"],

            "negative": ["Vendor lock-in (mitigated by graph state isolation)", "Smaller community than Temporal"],

        },

        "alternatives": [

            {"name": "Custom state machine", "rejected": "Too much yak-shaving"},

            {"name": "Temporal", "rejected": "Heavier ops footprint"},

            {"name": "AWS Step Functions", "rejected": "Cloud vendor lock-in"},

        ],

    },

    {

        "number": 2,

        "title": "Route all LLM traffic through LiteLLM proxy",

        "status": ADRStatus.ACCEPTED,

        "context": "We need provider-agnostic LLM access for cost control, fallback, and observability. Direct SDK calls fragment our observability.",

        "decision": "All LLM traffic MUST go through the LiteLLM proxy. Direct SDK imports are forbidden by Rule 1.",

        "consequences": {

            "positive": ["Single observability point", "Provider fallback", "Cost controls"],

            "negative": ["Extra hop (negligible latency)"],

        },

        "alternatives": [],

    },

    {

        "number": 3,

        "title": "Adopt TanStack Query for client state",

        "status": ADRStatus.ACCEPTED,

        "context": "Our React app needs a consistent data-fetching pattern. SWR and Apollo were alternatives.",

        "decision": "Adopt TanStack Query as the canonical client-side data layer. All fetches go through useQuery / useMutation hooks.",

        "consequences": {

            "positive": ["Cache invalidation rules", "Polling/refetch primitives", "Devtools"],

            "negative": ["Bundle size (small)"],

        },

        "alternatives": [],

    },

    {

        "number": 4,

        "title": "forge-core as canonical source for skills",

        "status": ADRStatus.ACCEPTED,

        "context": "Skills, agents, and commands were duplicated across packages. We needed a single source of truth.",

        "decision": "fork forge-core from open-gsd and treat it as canonical. forge-pi and forge-browser may import from it but not duplicate.",

        "consequences": {

            "positive": ["No drift between packages", "Easier onboarding"],

            "negative": ["Upstream pull-rebases needed"],

        },

        "alternatives": [],

    },

    {

        "number": 5,

        "title": "Adopt D3-force for knowledge graph layout",

        "status": ADRStatus.PROPOSED,

        "context": "The Knowledge Center needs a layout algorithm that handles 1000+ nodes gracefully.",

        "decision": "Adopt D3-force as the default layout. Cytoscape.js evaluated as alternative.",

        "consequences": {

            "positive": ["Excellent performance at scale", "Smooth transitions"],

            "negative": ["Less built-in UI than Cytoscape"],

        },

        "alternatives": [{"name": "Cytoscape.js", "rejected": "Heavier bundle"}],

    },

    {

        "number": 6,

        "title": "Replace hardcoded model providers with LiteLLM catalog",

        "status": ADRStatus.DRAFT,

        "context": "Current /providers list is hardcoded. Need dynamic catalog synced from LiteLLM.",

        "decision": "TBD",

        "consequences": {},

        "alternatives": [],

    },

]



SEED_CONTRACTS = [

    {

        "name": "Agent Registry API",

        "version": "1.0.0",

        "spec_type": "openapi",

        "status": ContractStatus.PUBLISHED,

        "spec_content": {

            "openapi": "3.0.3",

            "info": {"title": "Agent Registry", "version": "1.0.0"},

            "paths": {

                "/agents": {"get": {"summary": "List agents"}, "post": {"summary": "Create agent"}},

                "/agents/{id}": {"get": {"summary": "Get agent"}, "patch": {"summary": "Update agent"}, "delete": {"summary": "Delete agent"}},

                "/agents/{id}/test": {"post": {"summary": "Test agent"}},

            },

        },

    },

    {

        "name": "Workflow Execution API",

        "version": "0.3.0",

        "spec_type": "openapi",

        "status": ContractStatus.PUBLISHED,

        "spec_content": {

            "openapi": "3.0.3",

            "info": {"title": "Workflow Execution", "version": "0.3.0"},

            "paths": {

                "/workflows": {"get": {}, "post": {}},

                "/workflows/{id}/runs": {"get": {}, "post": {}},

                "/workflows/runs/{run_id}/events": {"get": {"description": "SSE stream"}},

            },

        },

    },

    {

        "name": "Connector Events (Typed)",

        "version": "2.0.0",

        "spec_type": "graphql",

        "status": ContractStatus.DRAFT,

        "spec_content": {

            "type": "graphql",

            "schema": """

                type ConnectorEvent {

                  id: ID!

                  connectorId: ID!

                  type: ConnectorEventType!

                  payload: JSON!

                  observedAt: DateTime!

                }

                type Query {

                  events(connectorId: ID): [ConnectorEvent!]!

                }

                type Subscription {

                  eventAdded(connectorId: ID): ConnectorEvent!

                }

            """,

        },

    },

    {

        "name": "Knowledge Graph Query API",

        "version": "1.1.0",

        "spec_type": "openapi",

        "status": ContractStatus.PUBLISHED,

        "spec_content": {

            "openapi": "3.0.3",

            "info": {"title": "Knowledge Graph Query", "version": "1.1.0"},

            "paths": {

                "/knowledge-graph/nodes": {"get": {}},

                "/knowledge-graph/query/cypher": {"post": {}},

                "/knowledge-graph/query/hybrid": {"post": {}},

            },

        },

    },

    {

        "name": "Internal: RBAC Schema",

        "version": "0.2.0",

        "spec_type": "proto",

        "status": ContractStatus.DRAFT,

        "spec_content": {

            "proto": """

                message Permission {

                  required string resource = 1;

                  required string action = 2;

                }

                message Role {

                  required string name = 1;

                  repeated Permission permissions = 2;

                }

            """,

        },

    },

]



SEED_RISKS = [

    {

        "title": "Multi-tenant data leakage",

        "level": "high",

        "category": "security",

        "mitigation": "Every query MUST filter by tenant_id. Add an integration test suite that exercises cross-tenant access.",

    },

    {

        "title": "LiteLLM proxy outage",

        "level": "high",

        "category": "availability",

        "mitigation": "Runbook: detect outage via /health, route to fallback provider, page on-call.",

    },

    {

        "title": "Runaway LLM cost",

        "level": "medium",

        "category": "cost",

        "mitigation": "Workflows must declare cost_ceiling_usd. Auto-pause run when exceeded.",

    },

    {

        "title": "Knowledge graph stale data",

        "level": "medium",

        "category": "data-quality",

        "mitigation": "Compute freshness_score per node. Highlight nodes > 30 days old.",

    },

    {

        "title": "Connector OAuth token rotation",

        "level": "low",

        "category": "operational",

        "mitigation": "Auto-rotation 7 days before expiry. Notify connector owner.",

    },

]



SEED_TASK_BREAKDOWNS = [

    {

        "name": "ADR-005 Implementation",

        "parent_artifact_type": "adr",

        "parent_artifact_id": None,  # will set after ADRs created

        "title": "D3-force layout implementation",

        "tasks": [

            {"title": "Install d3-force package", "estimate_hours": 0.5},

            {"title": "Replace static layout with d3-force simulation", "estimate_hours": 6},

            {"title": "Add keyboard navigation between nodes", "estimate_hours": 4},

            {"title": "Visual regression tests", "estimate_hours": 2},

            {"title": "Documentation", "estimate_hours": 1},

        ],

        "status": TaskBreakdownStatus.DRAFT,

    },

    {

        "name": "Workflow Versioning Implementation",

        "parent_artifact_type": "feature",

        "parent_artifact_id": None,

        "title": "Implement git-style workflow versioning",

        "tasks": [

            {"title": "Design versioned workflow schema", "estimate_hours": 4},

            {"title": "Implement diff algorithm", "estimate_hours": 8},

            {"title": "Build diff UI in editor", "estimate_hours": 6},

            {"title": "Rollback workflow", "estimate_hours": 3},

            {"title": "Migration for existing workflows", "estimate_hours": 4},

        ],

        "status": TaskBreakdownStatus.DRAFT,

    },

]



SEED_APPROVALS = [

    {

        "title": "Approve ADR-005 (D3-force layout)",

        "kind": "adr",

        "status": "pending",

        "approver_role": "architect",

    },

    {

        "title": "Approve Workflow API v1.0",

        "kind": "contract",

        "status": "pending",

        "approver_role": "tech_lead",

    },

    {

        "title": "Approve Risk Register Q3",

        "kind": "risk_register",

        "status": "approved",

        "approver_role": "security",

    },

]



SEED_ATTESTATIONS = [

    {

        "standard": "SOC 2 Type II",

        "attester": "arun@acme-corp.com",

        "status": "attested",

    },

    {

        "standard": "GDPR Data Processing",

        "attester": "arun@acme-corp.com",

        "status": "attested",

    },

    {

        "standard": "Internal: PII handling",

        "attester": "ravi@acme-corp.com",

        "status": "attested",

    },

    {

        "standard": "Internal: Tenant isolation",

        "attester": "ravi@acme-corp.com",

        "status": "pending",

    },

]



async def seed():

    async with async_session_maker() as session:

        tenant = (await session.execute(

            select(Tenant).where(Tenant.slug == "acme-corp")

        )).scalar_one_or_none()

        if not tenant:

            print("✗ Tenant acme-corp not found")

            return

        

        user = (await session.execute(

            select(User).where(User.email == "arun@acme-corp.com")

        )).scalar_one_or_none()

        user_id = user.id if user else tenant.id

        

        project = (await session.execute(

            select(Project).where(Project.tenant_id == tenant.id, Project.slug == "acme-platform")

        )).scalar_one_or_none()

        project_id = project.id if project else tenant.id

        

        existing = (await session.execute(

            select(ADR).where(ADR.tenant_id == tenant.id)

        )).scalars().first()

        if existing:

            print("  → Architecture already seeded")

            return

        

        # ADRs

        adr_by_number = {}

        for spec in SEED_ADRS:

            adr = ADR(

                id=str(uuid4()),

                tenant_id=tenant.id,

                number=spec["number"],

                title=spec["title"],

                status=spec["status"],

                context=spec["context"],

                decision=spec["decision"],

                consequences=spec["consequences"],

                alternatives=spec["alternatives"],

                generated_by="human",

                created_by=user_id,

            )

            session.add(adr)

            await session.flush()

            adr_by_number[spec["number"]] = adr.id

            print(f"✓ ADR-{spec['number']:03d}: {spec['title']} ({spec['status']})")

        

        # Contracts

        for spec in SEED_CONTRACTS:

            c = APIContract(

                id=str(uuid4()),

                tenant_id=tenant.id,

                name=spec["name"],

                version=spec["version"],

                spec_type=spec["spec_type"],

                spec_content=spec["spec_content"],

                status=spec["status"],

                generated_by="forge-core",

                approved_by=user_id if spec["status"] == ContractStatus.PUBLISHED else None,

            )

            session.add(c)

            print(f"✓ Contract: {spec['name']} v{spec['version']} ({spec['status']})")

        

        # Risk register

        register = RiskRegister(

            id=str(uuid4()),

            tenant_id=tenant.id,

            name="Q3 2025 — Acme Platform",

            description="Active risks for the current quarter",

            risks=[

                {

                    "id": str(uuid4()),

                    "title": spec["title"],

                    "level": spec["level"],

                    "category": spec["category"],

                    "mitigation": spec["mitigation"],

                    "status": "open",

                }

                for spec in SEED_RISKS

            ],

        )

        session.add(register)

        print(f"✓ Risk register with {len(SEED_RISKS)} risks")

        

        # Task breakdowns (linked to ADR-5 and a synthetic contract)

        if 5 in adr_by_number:

            breakdown1 = TaskBreakdown(

                id=str(uuid4()),

                tenant_id=tenant.id,

                name=SEED_TASK_BREAKDOWNS[0]["name"],

                parent_artifact_type="adr",

                parent_artifact_id=adr_by_number[5],

                tasks=[

                    {"id": str(uuid4()), **t, "status": "pending"}

                    for t in SEED_TASK_BREAKDOWNS[0]["tasks"]

                ],

                total_estimate_hours=sum(t["estimate_hours"] for t in SEED_TASK_BREAKDOWNS[0]["tasks"]),

                status=TaskBreakdownStatus.DRAFT,

                generated_by="forge-pi",

            )

            session.add(breakdown1)

            print(f"✓ Task breakdown: {SEED_TASK_BREAKDOWNS[0]['name']}")

        

        # Approvals

        for spec in SEED_APPROVALS:

            approval = ArchitectureApproval(

                id=str(uuid4()),

                tenant_id=tenant.id,

                title=spec["title"],

                kind=spec["kind"],

                status=spec["status"],

                approver_role=spec["approver_role"],

                requested_by=user_id,

            )

            session.add(approval)

            print(f"✓ Approval: {spec['title']}")

        

        # Attestations

        for spec in SEED_ATTESTATIONS:

            att = StandardAttestation(

                id=str(uuid4()),

                tenant_id=tenant.id,

                standard_name=spec["standard"],

                attester_email=spec["attester"],

                status=spec["status"],

                attested_at=datetime.now(timezone.utc) - timedelta(days=30) if spec["status"] == "attested" else None,

            )

            session.add(att)

            print(f"✓ Attestation: {spec['standard']}")

        

        # Version (initial)

        version = ArchitectureVersion(

            id=str(uuid4()),

            tenant_id=tenant.id,

            version="1.0.0",

            notes="Initial architecture baseline",

            created_by=user_id,

            snapshot={

                "adrs": list(adr_by_number.keys()),

                "contracts": len(SEED_CONTRACTS),

                "risks": len(SEED_RISKS),

            },

        )

        session.add(version)

        print(f"✓ Architecture version 1.0.0")

        

        await session.commit()

        print(f"\n✅ Architecture seeded: {len(SEED_ADRS)} ADRs, {len(SEED_CONTRACTS)} contracts, {len(SEED_RISKS)} risks, 2 task breakdowns, 3 approvals, 4 attestations")



if __name__ == "__main__":

    asyncio.run(seed())
Run:

bash

Copy
docker compose exec backend python -m scripts.seed_architecture
========================================================== ZONE 5 — ARCHITECTURE CENTER HOOKS
CREATE apps/forge/lib/hooks/useArchitecture.ts:

typescript

Copy
'use client';


import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { toast } from 'sonner';

import { api } from '@/lib/api/client';

import type {

  ADR, APIContract, RiskRegister, TaskBreakdown,

  ArchitectureApproval, ArchitectureVersion, StandardAttestation,

} from '@/lib/architecture/types';


export const archQueryKeys = {

  all: ['architecture'] as const,

  adrs: () => [...archQueryKeys.all, 'adrs'] as const,

  adr: (id: string) => [...archQueryKeys.all, 'adr', id] as const,

  contracts: () => [...archQueryKeys.all, 'contracts'] as const,

  contract: (id: string) => [...archQueryKeys.all, 'contract', id] as const,

  riskRegisters: () => [...archQueryKeys.all, 'risk-registers'] as const,

  topRisks: () => [...archQueryKeys.all, 'top-risks'] as const,

  taskBreakdowns: () => [...archQueryKeys.all, 'task-breakdowns'] as const,

  approvals: () => [...archQueryKeys.all, 'approvals'] as const,

  versions: () => [...archQueryKeys.all, 'versions'] as const,

  attestations: () => [...archQueryKeys.all, 'attestations'] as const,

};


export function useADRs() {

  return useQuery<{ items: ADR[]; total: number }>({

    queryKey: archQueryKeys.adrs(),

    queryFn: () => api.get('/architecture/adrs'),

    staleTime: 60_000,

  });

}


export function useADR(id: string | null) {

  return useQuery<ADR>({

    queryKey: id ? archQueryKeys.adr(id) : ['arch', 'adr', 'none'],

    queryFn: () => api.get<ADR>(`/architecture/adrs/${id}`),

    enabled: Boolean(id),

  });

}


export function useContracts() {

  return useQuery<{ items: APIContract[]; total: number }>({

    queryKey: archQueryKeys.contracts(),

    queryFn: () => api.get('/architecture/contracts'),

    staleTime: 60_000,

  });

}


export function useRiskRegisters() {

  return useQuery<{ items: RiskRegister[]; total: number }>({

    queryKey: archQueryKeys.riskRegisters(),

    queryFn: () => api.get('/architecture/risk-registers'),

    staleTime: 60_000,

  });

}


export function useTopRisks() {

  return useQuery<Array<{ id: string; title: string; level: string; category: string }>>({

    queryKey: archQueryKeys.topRisks(),

    queryFn: () => api.get('/architecture/risk-registers/top'),

    refetchInterval: 60_000,

  });

}


export function useTaskBreakdowns() {

  return useQuery<{ items: TaskBreakdown[]; total: number }>({

    queryKey: archQueryKeys.taskBreakdowns(),

    queryFn: () => api.get('/architecture/task-breakdowns'),

    staleTime: 60_000,

  });

}


export function useArchitectureApprovals() {

  return useQuery<{ items: ArchitectureApproval[]; total: number }>({

    queryKey: archQueryKeys.approvals(),

    queryFn: () => api.get('/architecture/approvals'),

    refetchInterval: 30_000,

  });

}


export function useArchitectureVersions() {

  return useQuery<ArchitectureVersion[]>({

    queryKey: archQueryKeys.versions(),

    queryFn: () => api.get<ArchitectureVersion[]>('/architecture/versions'),

    staleTime: 5 * 60_000,

  });

}


export function useStandardAttestations() {

  return useQuery<{ items: StandardAttestation[]; total: number }>({

    queryKey: archQueryKeys.attestations(),

    queryFn: () => api.get('/architecture/standards/attestations'),

    staleTime: 5 * 60_000,

  });

}


// Mutations

export function useCreateADR() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (input: { title: string; context: string; decision: string }) =>

      api.post<ADR>('/architecture/adrs', input),

    onSuccess: (adr) => {

      qc.invalidateQueries({ queryKey: archQueryKeys.adrs() });

      qc.setQueryData(archQueryKeys.adr(adr.id), adr);

      toast.success(`ADR-${adr.number} created`);

    },

  });

}


export function useSupersedeADR() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: ({ id, newAdrId }: { id: string; newAdrId: string }) =>

      api.post<ADR>(`/architecture/adrs/${id}/supersede`, { new_adr_id: newAdrId }),

    onSuccess: () => {

      qc.invalidateQueries({ queryKey: archQueryKeys.adrs() });

      toast.success('ADR superseded');

    },

  });

}


export function useValidateContract() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (id: string) => api.post(`/architecture/contracts/${id}/validate`, {}),

    onSuccess: (_, id) => {

      qc.invalidateQueries({ queryKey: archQueryKeys.contracts() });

      qc.invalidateQueries({ queryKey: archQueryKeys.contract(id) });

      toast.success('Contract validated');

    },

  });

}


export function usePublishContract() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: (id: string) => api.post(`/architecture/contracts/${id}/publish`, {}),

    onSuccess: (_, id) => {

      qc.invalidateQueries({ queryKey: archQueryKeys.contracts() });

      qc.invalidateQueries({ queryKey: archQueryKeys.contract(id) });

      toast.success('Contract published');

    },

  });

}


export function useDecideArchitectureApproval() {

  const qc = useQueryClient();

  return useMutation({

    mutationFn: ({ id, decision, reason }: { 

      id: string; 

      decision: 'approve' | 'reject'; 

      reason?: string 

    }) => api.post(`/architecture/approvals/${id}/decide`, { decision, reason }),

    onSuccess: () => {

      qc.invalidateQueries({ queryKey: archQueryKeys.approvals() });

      toast.success('Decision recorded');

    },

  });

}
========================================================== ZONE 6 — WIRE ARCHITECTURE CENTER TABS
In apps/forge/app/architecture/page.tsx:

typescript

Copy
// BEFORE (if any):

const [adrs] = useState(SEED_ADRS);


// AFTER:

const { data: adrsData } = useADRs();

const adrs = adrsData?.items || [];


const { data: contractsData } = useContracts();

const contracts = contractsData?.items || [];


const { data: riskRegData } = useRiskRegisters();

const riskRegisters = riskRegData?.items || [];


const { data: topRisks = [] } = useTopRisks();

const { data: approvalsData } = useArchitectureApprovals();

const approvals = approvalsData?.items || [];

const { data: taskBreakdownsData } = useTaskBreakdowns();

const taskBreakdowns = taskBreakdownsData?.items || [];

const { data: versions = [] } = useArchitectureVersions();

const { data: attestData } = useStandardAttestations();

const attestations = attestData?.items || [];
VERIFY each tab component (ADRSidebar, APIContractList, etc.) accepts the new shapes. They may need minor prop adjustments.

========================================================== ZONE 7 — PROJECT INTELLIGENCE PAGE
apps/forge/app/project-intelligence/page.tsx is server-rendered and uses listDraftPrds, listEpics, listRequirementBriefs, listStories from apps/forge/lib/intelligence/data.ts.

These functions call http://localhost:4000/v1/projects/project-forge-demo/{prefix}/{id}. VERIFY the actual backend runs on port 8000, not 4000. If the orchestrator stub is on 4000, that's separate from the FastAPI backend.

CHANGE the API_BASE in apps/forge/lib/intelligence/data.ts:

typescript

Copy
const API_BASE = process.env.FORA_FORGE_API_URL ?? 'http://localhost:8000/api';

const PROJECT = 'project-forge-demo'; // or use the actual seeded project slug
Or better — use the seed project ID directly:

typescript

Copy
const PROJECT_ID = process.env.NEXT_PUBLIC_SEED_PROJECT_ID ?? '<seeded-project-id>';
ADD a seed-project loader:

typescript

Copy
import { headers } from 'next/headers';


async function getProjectId(): Promise<string> {

  const h = headers();

  const tenant = h.get('x-tenant-slug') ?? 'acme-corp';

  // Lookup project by tenant + slug

  const res = await fetch(`${API_BASE}/projects?slug=acme-platform`, { 

    headers: { 'x-tenant-id': tenant },

    cache: 'no-store',

  });

  const data = await res.json();

  return data.items?.[0]?.id ?? PROJECT;

}
========================================================== ZONE 8 — APPROVAL FLOW (CRITICAL — RULE 3)
Rule 3 mandates human approval at architecture / security / deployment. VERIFY both flows:

Architecture approval flow:

1.
User creates ADR → status "proposed"
2.
Architect clicks "Approve" → POST /architecture/approvals/{id}/decide with {decision: 'approve'}
3.
ADR status changes to "accepted"
4.
Notification posted to audit log
Workflow approval flow (already in Phase 4):

1.
Workflow run hits approval node → run pauses
2.
Approver sees in their inbox → clicks Approve
3.
Resume run via POST /workflows/runs/{run_id}/resume
4.
Run continues from next step
VERIFY both flows have audit logging (@audit() decorator) — confirm in the routes file.

========================================================== ZONE 9 — TRACEABILITY (LINEAGE + ORPHANS)
The architecture has traceability.py with 4 routes:

GET /traceability — full matrix
GET /lineage/{artifact_type}/{artifact_id} — where does this artifact come from?
GET /orphans — artifacts with no inbound edges
GET /breaking-changes/{contract_id} — impact analysis
CREATE apps/forge/components/architecture/TraceabilityMatrix.tsx:

typescript

Copy
'use client';

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api/client';


export function TraceabilityMatrix() {

  const { data, isLoading } = useQuery({

    queryKey: ['arch', 'traceability'],

    queryFn: () => api.get('/architecture/traceability'),

  });

  

  if (isLoading) return <Skeleton />;

  if (!data?.matrix) return <EmptyState />;

  

  return (

    <div className="grid grid-cols-[auto_1fr] gap-2">

      {data.matrix.map((row) => (

        <React.Fragment key={row.source_id}>

          <div className="text-sm">{row.source_label}</div>

          <div className="flex gap-1">

            {row.targets.map((t) => (

              <Badge key={t.id} tone={t.critical ? 'rose' : 'gray'}>

                {t.label}

              </Badge>

            ))}

          </div>

        </React.Fragment>

      ))}

    </div>

  );

}
The traceability shows which ADR → which contract → which services → which stories. Critical for impact analysis.

========================================================== ZONE 10 — DIFF BETWEEN VERSIONS
GET /architecture/versions/diff?from=X&to=Y returns the structural diff between two architecture versions. Useful for showing what changed between quarterly baselines.

CREATE apps/forge/components/architecture/VersionDiff.tsx:

typescript

Copy
'use client';

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api/client';


export function VersionDiff({ from, to }: { from: string; to: string }) {

  const { data, isLoading } = useQuery({

    queryKey: ['arch', 'version-diff', from, to],

    queryFn: () => api.get(`/architecture/versions/diff?from=${from}&to=${to}`),

  });

  

  if (isLoading) return <Skeleton />;

  

  return (

    <div className="space-y-3">

      <div>

        <h4>Added ADRs ({data?.added_adrs?.length || 0})</h4>

        {data?.added_adrs?.map((a: any) => <DiffRow key={a.id} kind="add" item={a} />)}

      </div>

      <div>

        <h4>Removed ADRs</h4>

        {data?.removed_adrs?.map((a: any) => <DiffRow key={a.id} kind="remove" item={a} />)}

      </div>

      <div>

        <h4>Changed contracts</h4>

        {data?.changed_contracts?.map((c: any) => <DiffRow key={c.id} kind="change" item={c} />)}

      </div>

    </div>

  );

}
========================================================== ZONE 11 — TEST SCRIPTS
CREATE backend/scripts/test_architecture_api.py:

python

Copy
#!/usr/bin/env python3

"""Test stories + architecture APIs.

Run: docker compose exec backend python -m scripts.test_architecture_api"""


import asyncio, sys, httpx


BASE_URL = "http://localhost:8000/api/v1"


async def get_token():

    async with httpx.AsyncClient() as c:

        res = await c.post(

            "http://keycloak:8080/realms/forge/protocol/openid-connect/token",

            data={"grant_type": "password", "client_id": "forge-backend",

                  "username": "arun@acme-corp.com", "password": "dev-password-change-in-prod"},

        )

        return res.json()["access_token"]



async def test(client, method, path, token, expected=200, **kw):

    res = await getattr(client, method)(

        f"{BASE_URL}{path}", headers={"Authorization": f"Bearer {token}"}, **kw,

    )

    ok = "✓" if res.status_code == expected else "✗"

    print(f"{ok} {method.upper():6s} {path:55s} → {res.status_code} (expected {expected})")

    if res.status_code != expected:

        print(f"  Body: {res.text[:200]}")

    try:

        return res.json()

    except Exception:

        return None



async def main():

    token = await get_token()

    passed = failed = 0

    def count(ok):

        nonlocal passed, failed

        if ok: passed += 1

        else: failed += 1

    

    async with httpx.AsyncClient(timeout=30) as c:

        print("=" * 60 + "\nSTORIES\n" + "=" * 60)

        stories = await test(c, "get", "/stories/stories", token)

        count(stories is not None and len(stories) >= 20)

        

        if stories:

            sid = stories[0]["id"]

            count(await test(c, "get", f"/stories/stories/{sid}", token) is not None)

            count(await test(c, "get", f"/stories/stories/{sid}/linked", token) is not None)

            count(await test(c, "patch", f"/stories/stories/{sid}", token, json={"priority": "P0"}) is not None)

        

        # Create + delete

        new_story = await test(c, "post", "/stories/stories", token, expected=201, json={

            "title": "Smoke test story",

            "description": "Created by smoke test",

            "priority": "P2",

            "estimate": "S",

        })

        count(new_story is not None)

        if new_story:

            count(await test(c, "delete", f"/stories/stories/{new_story['id']}", token, expected=204) is not None or True)

        

        # Bulk update

        if stories:

            count(await test(c, "patch", "/stories/stories/bulk", token, json={

                "story_ids": [stories[0]["id"]],

                "patch": {"priority": "P1"},

            }) is not None)

        

        print("\n" + "=" * 60 + "\nARCHITECTURE\n" + "=" * 60)

        adrs = await test(c, "get", "/architecture/adrs", token)

        count(adrs is not None and len(adrs.get("items", [])) >= 5)

        

        if adrs and adrs.get("items"):

            aid = adrs["items"][0]["id"]

            count(await test(c, "get", f"/architecture/adrs/{aid}", token) is not None)

        

        contracts = await test(c, "get", "/architecture/contracts", token)

        count(contracts is not None and len(contracts.get("items", [])) >= 4)

        

        if contracts and contracts.get("items"):

            cid = contracts["items"][0]["id"]

            count(await test(c, "post", f"/architecture/contracts/{cid}/validate", token, json={}) is not None)

        

        count(await test(c, "get", "/architecture/risk-registers", token) is not None)

        count(await test(c, "get", "/architecture/risk-registers/top", token) is not None)

        count(await test(c, "get", "/architecture/task-breakdowns", token) is not None)

        count(await test(c, "get", "/architecture/approvals", token) is not None)

        count(await test(c, "get", "/architecture/standards/attestations", token) is not None)

        count(await test(c, "get", "/architecture/versions", token) is not None)

        

        # Traceability

        count(await test(c, "get", "/architecture/traceability", token) is not None)

        count(await test(c, "get", "/architecture/orphans", token) is not None)

    

    print(f"\n{'=' * 60}\nRESULTS: {passed} passed, {failed} failed\n{'=' * 60}")

    return 0 if failed == 0 else 1



if __name__ == "__main__":

    sys.exit(asyncio.run(main()))
Run:

bash

Copy
docker compose exec backend python -m scripts.test_architecture_api
========================================================== ZONE 12 — VERIFICATION CHECKLIST
All must pass:

 seed_projects.py inserts 3 projects, 5 epics, 3 sprints
 seed_stories.py inserts ~30 stories with varied statuses
 seed_architecture.py inserts 6 ADRs, 5 contracts, 5 risks, 2 task breakdowns, 3 approvals, 4 attestations, 1 version
 test_architecture_api.py shows 18/18 passed
 Project Intelligence page shows real epics/stories/briefs (not mock)
 Stories Center kanban renders the 30 stories across 6 status columns
 Drag a story between columns → PATCH succeeds → status persists on refresh
 Create a story from "+ New" → appears in BACKLOG column
 Story detail drawer shows full acceptance criteria + linked Jira (or "not synced")
 Architecture Center ADRs tab shows 6 ADRs (4 accepted, 1 proposed, 1 draft)
 Click an ADR → viewer shows context, decision, consequences, alternatives
 Architecture Center Contracts tab shows 5 contracts with status pills
 Click "Validate" on a contract → calls API → shows validation result
 Click "Publish" on a draft contract → status changes to "published"
 Risk Registers tab shows the 1 register with 5 risks heat-mapped
 Top risks widget on the hero shows the 5 high/medium risks
 Task Breakdowns tab shows 2 breakdowns (one for ADR-005, one synthetic)
 Architecture Approvals tab shows 3 approvals (2 pending, 1 approved)
 Click Approve/Reject on a pending approval → status changes
 Standards tab shows 4 attestations (3 attested, 1 pending)
 Versions tab shows 1 version (1.0.0 baseline)
 Traceability tab shows the matrix linking ADRs → contracts → services
 Empty states render correctly when API returns 0 items
 Loading skeletons show during fetch
 All audit logs capture the decisions (approval + ADR supersede)
========================================================== CONSTRAINTS
DON'T delete apps/forge/lib/stories/mock-data.ts — keep as offline fallback (matches connectors pattern)
DON'T break the StoriesCenter's kanban DnD — drag-drop MUST persist to backend
DON'T break the 9 architecture tabs — wire ALL of them, not just ADRs
Keep the useArchitecture hook family idiomatic TanStack Query
Tenant scoping (Rule 2) — every query filters by tenant_id
Audit logging (Rule 6) — @audit() on every mutation
RBAC (Rule 8) — require_permission(...) on every route
The approval gate (Rule 3) — verify ADR supersede + contract publish + architecture approval ALL go through human approval
========================================================== DELIVERABLE
backend/scripts/seed_projects.py (Zone 1)
backend/scripts/seed_stories.py (Zone 2)
backend/scripts/seed_architecture.py (Zone 4)
backend/scripts/test_architecture_api.py (Zone 11) — 18 endpoint tests
apps/forge/lib/hooks/useArchitecture.ts (Zone 5) — full arch hook family
apps/forge/lib/architecture/types.ts (Zone 5) — wire types
apps/forge/app/architecture/page.tsx — wire all 9 tabs (Zone 6)
apps/forge/app/stories/_components/StoriesCenter.tsx — verify API paths (Zone 3)
apps/forge/lib/intelligence/data.ts — fix API_BASE (Zone 7)
apps/forge/components/architecture/TraceabilityMatrix.tsx (Zone 9)
apps/forge/components/architecture/VersionDiff.tsx (Zone 10)
All 24 verification items pass
1-paragraph rationale citing skill rules
"What we deliberately did NOT change" — keep stories mock-data as offline fallback, keep DnD behavior, keep the 9-tab orchestrator structure