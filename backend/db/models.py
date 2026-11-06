import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, String, Integer, Text, ForeignKey, DateTime, Boolean
from sqlalchemy.orm import relationship

from db.database import Base


def gen_id() -> str:
    return str(uuid.uuid4())


def now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=gen_id)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)  # bcrypt hash, never the real password
    # True once Google has proven this person owns the email. Google-only users get a
    # random password nobody knows (so password login can't work for them).
    email_verified = Column(Boolean, default=False)
    created_at = Column(DateTime, default=now)

    documents = relationship("Document", back_populates="owner", cascade="all, delete-orphan")
    chat_sessions = relationship("ChatSession", back_populates="user", cascade="all, delete-orphan")


class Document(Base):
    __tablename__ = "documents"

    id = Column(String, primary_key=True, default=gen_id)
    owner_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    filename = Column(String, nullable=False)
    author = Column(String, nullable=True, index=True)
    year = Column(Integer, nullable=True, index=True)
    topic = Column(String, nullable=True, index=True)
    num_pages = Column(Integer, default=0)
    status = Column(String, default="processing")  # processing | ready | failed
    uploaded_at = Column(DateTime, default=now)

    owner = relationship("User", back_populates="documents")
    parent_chunks = relationship("ParentChunk", back_populates="document", cascade="all, delete-orphan")
    child_chunks = relationship("ChildChunk", back_populates="document", cascade="all, delete-orphan")


class ParentChunk(Base):
    __tablename__ = "parent_chunks"

    id = Column(String, primary_key=True, default=gen_id)
    doc_id = Column(String, ForeignKey("documents.id"), nullable=False, index=True)
    page_num = Column(Integer, nullable=False)
    text = Column(Text, nullable=False)

    document = relationship("Document", back_populates="parent_chunks")
    child_chunks = relationship("ChildChunk", back_populates="parent_chunk", cascade="all, delete-orphan")


class ChildChunk(Base):
    __tablename__ = "child_chunks"

    id = Column(String, primary_key=True, default=gen_id)
    parent_id = Column(String, ForeignKey("parent_chunks.id"), nullable=False, index=True)
    doc_id = Column(String, ForeignKey("documents.id"), nullable=False, index=True)
    page_num = Column(Integer, nullable=False)
    text = Column(Text, nullable=False)
    # Position of this chunk's vector inside the FAISS IndexIDMap.
    # This is what keeps FAISS and SQLite in sync.
    faiss_index_pos = Column(Integer, unique=True, nullable=False, index=True)

    document = relationship("Document", back_populates="child_chunks")
    parent_chunk = relationship("ParentChunk", back_populates="child_chunks")


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(String, primary_key=True, default=gen_id)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    # Set from the first question. A chat with no title has no messages yet and is not listed.
    title = Column(String, nullable=True)
    created_at = Column(DateTime, default=now)
    updated_at = Column(DateTime, default=now)

    user = relationship("User", back_populates="chat_sessions")
    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(String, primary_key=True, default=gen_id)
    session_id = Column(String, ForeignKey("chat_sessions.id"), nullable=False, index=True)
    role = Column(String, nullable=False)  # "user" | "assistant"
    content = Column(Text, nullable=False)
    citations_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=now)

    session = relationship("ChatSession", back_populates="messages")
