"""Q&A REST endpoints (F-108)."""

from __future__ import annotations
from typing import Annotated

from uuid import UUID

from fastapi import APIRouter, Response, status, Depends

from app.api.deps import Principal, require_permission, get_current_principal
from app.core.audit import audit
from app.core.security import AuthenticatedPrincipal
from app.schemas.project_intelligence import (
    QAAnswer,
    QAAskRequest,
    QAHistory,
    QAMessage,
    QASource,
)
from app.services.project_intelligence.qa import qa_service

router = APIRouter(prefix="/qa", tags=["qa"])


@router.post("/ask", response_model=QAAnswer)
@audit(action="qa.ask", target_type="qa")
async def ask(
    body: QAAskRequest,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("qa:ask"))
) -> QAAnswer:
    answer = await qa_service.answer_question(
        tenant_id=principal.tenant_id,
        project_id=body.project_id,
        question=body.question,
        session_id=body.session_id,
        context_filters=body.context_filters,
        actor_id=principal.user_id,
    )
    return QAAnswer(
        answer=answer.answer,
        sources=[
            QASource(
                kind=s.kind,
                reference=s.reference,
                snippet=s.snippet,
                score=s.score,
                metadata=s.metadata,
            )
            for s in answer.sources
        ],
        confidence=answer.confidence,
        follow_ups=answer.follow_ups,
        session_id=answer.session_id,
        model=answer.model,
    )


@router.get("/sessions/{session_id}", response_model=QAHistory)
@audit(action="qa.history", target_type="qa_session")
async def history(
    session_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("qa:read"))
) -> QAHistory:
    messages = qa_service.get_conversation_history(session_id)
    return QAHistory(
        session_id=session_id,
        project_id=principal.project_id or UUID("00000000-0000-0000-0000-000000000000"),
        messages=[
            QAMessage(
                id=m.id,
                role=m.role,
                content=m.content,
                sources=[
                    QASource(
                        kind=s.kind,
                        reference=s.reference,
                        snippet=s.snippet,
                        score=s.score,
                        metadata=s.metadata,
                    )
                    for s in m.sources
                ],
                created_at=m.created_at,
            )
            for m in messages
        ],
    )


@router.delete(
    "/sessions/{session_id}",
    response_model=None,
    response_class=Response,
)
@audit(action="qa.clear", target_type="qa_session")
@audit(action="qa.clear", target_type="qa_session")
async def clear(
    session_id: UUID,
    principal: Annotated[AuthenticatedPrincipal, Depends(get_current_principal)],
    _perm: AuthenticatedPrincipal = Depends(require_permission("qa:write"))
):
    qa_service.clear_conversation(session_id)


__all__ = ["router"]