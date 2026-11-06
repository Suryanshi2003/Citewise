"""
All database reads/writes live here. Every query that touches documents or
chats takes the owner's user id, so one user can never see another user's data.
"""
from datetime import timedelta
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import select, func, update, delete

from db import models


# ---------- Users ----------

def get_user(db: Session, user_id: str) -> Optional[models.User]:
    return db.get(models.User, user_id)


def get_user_by_email(db: Session, email: str) -> Optional[models.User]:
    return db.execute(select(models.User).where(models.User.email == email)).scalar_one_or_none()


def create_user(db: Session, email: str, password_hash: str, email_verified: bool = False) -> models.User:
    user = models.User(email=email, password_hash=password_hash, email_verified=email_verified)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def mark_email_verified(db: Session, user: models.User, new_password_hash: Optional[str] = None):
    """Google proved ownership of this email. Optionally replace the password hash too."""
    user.email_verified = True
    if new_password_hash:
        user.password_hash = new_password_hash
    db.commit()


# ---------- Documents ----------

def create_document(db: Session, doc_id: str, owner_id: str, filename: str, author: Optional[str],
                    year: Optional[int], topic: Optional[str]) -> models.Document:
    doc = models.Document(id=doc_id, owner_id=owner_id, filename=filename, author=author,
                          year=year, topic=topic, status="processing")
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return doc


def set_document_status(db: Session, doc_id: str, status: str, num_pages: int = None):
    doc = db.get(models.Document, doc_id)
    if doc:
        doc.status = status
        if num_pages is not None:
            doc.num_pages = num_pages
        db.commit()


def fail_stuck_documents(db: Session) -> int:
    """On server start, anything still 'processing' was interrupted by a restart."""
    result = db.execute(
        update(models.Document).where(models.Document.status == "processing").values(status="failed")
    )
    db.commit()
    return result.rowcount


def list_documents(db: Session, owner_id: str) -> list[models.Document]:
    return db.execute(
        select(models.Document).where(models.Document.owner_id == owner_id)
        .order_by(models.Document.uploaded_at.desc())
    ).scalars().all()


def get_document(db: Session, doc_id: str, owner_id: str) -> Optional[models.Document]:
    return db.execute(
        select(models.Document).where(models.Document.id == doc_id, models.Document.owner_id == owner_id)
    ).scalar_one_or_none()


def count_documents(db: Session, owner_id: str) -> int:
    return db.execute(
        select(func.count()).select_from(models.Document).where(models.Document.owner_id == owner_id)
    ).scalar_one()


def delete_document(db: Session, doc: models.Document):
    db.delete(doc)  # cascades to parent/child chunks
    db.commit()


# ---------- Chunks ----------

def create_parent_chunk(db: Session, doc_id: str, page_num: int, text: str) -> models.ParentChunk:
    pc = models.ParentChunk(doc_id=doc_id, page_num=page_num, text=text)
    db.add(pc)
    db.commit()
    db.refresh(pc)
    return pc


def create_child_chunk(db: Session, parent_id: str, doc_id: str, page_num: int,
                       text: str, faiss_index_pos: int) -> models.ChildChunk:
    cc = models.ChildChunk(
        parent_id=parent_id, doc_id=doc_id, page_num=page_num,
        text=text, faiss_index_pos=faiss_index_pos,
    )
    db.add(cc)
    db.commit()
    db.refresh(cc)
    return cc


def get_next_faiss_pos(db: Session) -> int:
    """FAISS IndexIDMap ids must be unique ints. We just increment past the max used so far."""
    max_pos = db.execute(select(func.max(models.ChildChunk.faiss_index_pos))).scalar()
    return 0 if max_pos is None else max_pos + 1


def get_child_chunks_by_faiss_pos(db: Session, positions: list[int]) -> dict[int, models.ChildChunk]:
    if not positions:
        return {}
    rows = db.execute(
        select(models.ChildChunk).where(models.ChildChunk.faiss_index_pos.in_(positions))
    ).scalars().all()
    return {row.faiss_index_pos: row for row in rows}


def get_all_child_chunks(db: Session):
    """Used to (re)build the BM25 corpus."""
    return db.execute(select(models.ChildChunk)).scalars().all()


def get_parent_chunk(db: Session, parent_id: str) -> Optional[models.ParentChunk]:
    return db.get(models.ParentChunk, parent_id)


def get_faiss_ids_for_user(db: Session, owner_id: str, author: Optional[str] = None,
                           year: Optional[int] = None, topic: Optional[str] = None) -> list[int]:
    """
    FAISS ids of every searchable chunk this user is allowed to see, optionally
    narrowed by author/year/topic. Retrieval ALWAYS goes through this, which is
    what keeps users' documents private from each other.
    """
    stmt = (
        select(models.ChildChunk.faiss_index_pos)
        .join(models.Document, models.ChildChunk.doc_id == models.Document.id)
        .where(models.Document.owner_id == owner_id, models.Document.status == "ready")
    )
    if author:
        stmt = stmt.where(func.lower(models.Document.author) == author.lower())
    if year:
        stmt = stmt.where(models.Document.year == year)
    if topic:
        stmt = stmt.where(func.lower(models.Document.topic) == topic.lower())
    return list(db.execute(stmt).scalars().all())


# ---------- Chat ----------

def create_chat_session(db: Session, user_id: str) -> models.ChatSession:
    session = models.ChatSession(user_id=user_id)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def get_chat_session(db: Session, session_id: str, user_id: str) -> Optional[models.ChatSession]:
    return db.execute(
        select(models.ChatSession).where(models.ChatSession.id == session_id,
                                         models.ChatSession.user_id == user_id)
    ).scalar_one_or_none()


def list_chat_sessions(db: Session, user_id: str) -> list[models.ChatSession]:
    """The sidebar list. Only chats that have a title (= at least one question), newest first."""
    return db.execute(
        select(models.ChatSession)
        .where(models.ChatSession.user_id == user_id, models.ChatSession.title.is_not(None))
        .order_by(models.ChatSession.updated_at.desc())
    ).scalars().all()


def count_chat_sessions(db: Session, user_id: str) -> int:
    return db.execute(
        select(func.count()).select_from(models.ChatSession).where(models.ChatSession.user_id == user_id)
    ).scalar_one()


def delete_stale_empty_sessions(db: Session, user_id: str) -> None:
    """Empty chats (created but never asked anything) older than 1 hour are garbage.
    The 1-hour wait avoids deleting a chat that another browser tab just opened."""
    cutoff = models.now() - timedelta(hours=1)
    db.execute(
        delete(models.ChatSession).where(
            models.ChatSession.user_id == user_id,
            models.ChatSession.title.is_(None),
            models.ChatSession.created_at < cutoff,
        )
    )
    db.commit()


def delete_chat_session(db: Session, session: models.ChatSession) -> None:
    db.delete(session)  # cascades to its messages
    db.commit()


def get_message(db: Session, message_id: str) -> Optional[models.ChatMessage]:
    return db.get(models.ChatMessage, message_id)


def add_chat_message(db: Session, session_id: str, role: str, content: str,
                     citations_json: Optional[str] = None) -> models.ChatMessage:
    msg = models.ChatMessage(session_id=session_id, role=role, content=content, citations_json=citations_json)
    db.add(msg)
    session = db.get(models.ChatSession, session_id)
    if session:
        session.updated_at = models.now()
        if role == "user" and not session.title:
            # The chat is named after its first question
            one_line = " ".join(content.split())
            session.title = one_line if len(one_line) <= 60 else one_line[:57].rstrip() + "…"
    db.commit()
    db.refresh(msg)
    return msg


def get_chat_history(db: Session, session_id: str) -> list[models.ChatMessage]:
    return db.execute(
        select(models.ChatMessage)
        .where(models.ChatMessage.session_id == session_id)
        .order_by(models.ChatMessage.created_at.asc())
    ).scalars().all()
