import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from chains.citation_resolver import resolve_citations
from chains.qa_chain import build_context_block, format_chat_history, stream_answer
from config import settings
from db import crud, models
from db.database import get_db, SessionLocal
from logger import get_logger
from retrieval.hybrid_retriever import hybrid_retrieve
from retrieval.reranker import rerank
from security import get_current_user, limit_chat

logger = get_logger(__name__)
router = APIRouter()


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=settings.max_question_chars)
    author: str | None = Field(None, max_length=100)
    year: int | None = Field(None, ge=1900, le=2100)
    topic: str | None = Field(None, max_length=100)

    @field_validator("question")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Question cannot be empty")
        return v


def _sse(payload: dict) -> str:
    """One Server-Sent Event line."""
    return f"data: {json.dumps(payload)}\n\n"


@router.post("/session")
def create_session(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    crud.delete_stale_empty_sessions(db, user.id)
    if crud.count_chat_sessions(db, user.id) >= settings.max_chats_per_user:
        raise HTTPException(400, f"Chat limit reached ({settings.max_chats_per_user}). Delete an old chat to start a new one.")
    session = crud.create_chat_session(db, user.id)
    return {"session_id": session.id}


@router.get("/sessions")
def list_sessions(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Previous chats for the sidebar (newest first)."""
    return [
        # SQLite gives back times without a timezone; they are UTC, so say so with 'Z'
        {"id": s.id, "title": s.title, "updated_at": s.updated_at.isoformat() + "Z"}
        for s in crud.list_chat_sessions(db, user.id)
    ]


@router.delete("/{session_id}")
def delete_session(session_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    session = crud.get_chat_session(db, session_id, user.id)
    if not session:
        raise HTTPException(404, "Chat not found")
    crud.delete_chat_session(db, session)
    logger.info("Chat deleted: session=%s user=%s", session_id, user.id)
    return {"deleted": session_id}


@router.get("/{session_id}/history")
def get_history(session_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    if not crud.get_chat_session(db, session_id, user.id):
        raise HTTPException(404, "Session not found")
    result = []
    for m in crud.get_chat_history(db, session_id):
        citations = []
        if m.citations_json:
            citations = json.loads(m.citations_json).get("citations", [])
        result.append({
            "id": m.id, "role": m.role, "content": m.content,
            "citations": citations, "created_at": m.created_at.isoformat(),
        })
    return result


@router.post("/{session_id}", dependencies=[Depends(limit_chat)])
async def ask(
    session_id: str,
    request: AskRequest,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    user_id = user.id  # plain value: safe to use inside the streaming generator below
    if not crud.get_chat_session(db, session_id, user_id):
        raise HTTPException(404, "Session not found. Create one via POST /chat/session first.")

    logger.info("Question: user=%s session=%s chars=%d", user_id, session_id, len(request.question))

    # --- Retrieval + reranking happen BEFORE streaming starts, since the
    # LLM needs the full context up front. Only token generation streams.
    # They are slow CPU work, so run them in a thread to keep the server responsive. ---
    candidates = await run_in_threadpool(
        hybrid_retrieve, db, request.question, user_id, request.author, request.year, request.topic
    )
    top_child_chunks = await run_in_threadpool(rerank, request.question, candidates)

    if not top_child_chunks:
        async def empty_stream():
            yield _sse({"token": "No relevant information was found in your uploaded documents."})
            yield _sse({"done": True, "citations": [], "message_id": None})
        return StreamingResponse(empty_stream(), media_type="text/event-stream")

    filenames: dict[str, str] = {}
    sources = []
    for c in top_child_chunks:
        if c.doc_id not in filenames:
            doc = db.get(models.Document, c.doc_id)
            filenames[c.doc_id] = doc.filename if doc else "unknown document"
        sources.append({"filename": filenames[c.doc_id], "page_num": c.page_num, "doc_id": c.doc_id})

    parent_chunks = [crud.get_parent_chunk(db, c.parent_id) for c in top_child_chunks]
    context_block = build_context_block(parent_chunks, sources)
    history_text = format_chat_history(crud.get_chat_history(db, session_id))
    question = request.question

    async def event_stream():
        full_answer = ""
        try:
            async for token in stream_answer(question, context_block, history_text):
                full_answer += token
                yield _sse({"token": token})
            if not full_answer.strip():
                raise RuntimeError("LLM returned an empty answer")
        except Exception:
            logger.exception("Answer generation failed: user=%s session=%s", user_id, session_id)
            yield _sse({"error": "The AI service had a problem. Please try again in a moment."})
            return

        try:
            citations = await run_in_threadpool(resolve_citations, full_answer, top_child_chunks, sources)
        except Exception:
            logger.exception("Citation resolving failed: session=%s", session_id)
            citations = []

        # Bundle citations + retrieval debug info together so /eval can
        # show retrieved chunks + context + answer for this exact turn.
        stored_payload = {
            "citations": citations,
            "debug": {
                "context": context_block,
                "retrieved_chunks": [
                    {"child_id": c.id, "page_num": c.page_num, "text": c.text, "filename": s["filename"]}
                    for c, s in zip(top_child_chunks, sources)
                ],
            },
        }
        # Own DB session: the request's session may already be closed while streaming.
        with SessionLocal() as stream_db:
            crud.add_chat_message(stream_db, session_id, role="user", content=question)
            msg = crud.add_chat_message(
                stream_db, session_id, role="assistant", content=full_answer,
                citations_json=json.dumps(stored_payload),
            )
            message_id = msg.id

        yield _sse({"done": True, "citations": citations, "message_id": message_id})

    return StreamingResponse(event_stream(), media_type="text/event-stream")
