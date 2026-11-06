import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from db import crud, models
from db.database import get_db
from security import get_current_user

router = APIRouter()


@router.get("/{message_id}")
def get_eval_trace(message_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """
    Returns the retrieved chunks, assembled LLM context, and final answer
    for one assistant message — the transparency panel from the spec.
    Only the owner of the chat can see it.
    """
    message = crud.get_message(db, message_id)
    if not message or message.role != "assistant":
        raise HTTPException(404, "Assistant message not found")
    if not crud.get_chat_session(db, message.session_id, user.id):
        raise HTTPException(404, "Assistant message not found")  # same error: don't reveal it exists

    payload = json.loads(message.citations_json) if message.citations_json else {}
    debug = payload.get("debug", {})

    return {
        "message_id": message.id,
        "final_answer": message.content,
        "retrieved_chunks": debug.get("retrieved_chunks", []),
        "llm_context": debug.get("context", ""),
        "citations": payload.get("citations", []),
    }
