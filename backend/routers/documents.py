from pathlib import Path

from fastapi import APIRouter, UploadFile, File, Form, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from config import settings
from db import crud, models
from db.database import get_db, SessionLocal
from ingestion.pipeline import ingest_document
from logger import get_logger
from retrieval.vector_store import vector_store
from retrieval.bm25_store import bm25_store
from security import get_current_user

logger = get_logger(__name__)
router = APIRouter()

# Allowed extensions -> the first bytes a real file of that type starts with.
# (Checking the content, not just the name, stops "virus.exe" renamed to "x.pdf".)
ALLOWED_TYPES = {".pdf": b"%PDF", ".docx": b"PK"}
MEDIA_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def _file_path(doc: models.Document) -> Path:
    # Files are stored as <doc_id>.<ext> — the user's filename never touches the disk path.
    return Path(settings.upload_dir) / f"{doc.id}{Path(doc.filename).suffix.lower()}"


def _run_ingestion_in_new_session(doc_id: str, file_path: str, filename: str):
    """BackgroundTasks run after the request's own DB session is closed,
    so ingestion opens its own session rather than reusing the request's."""
    with SessionLocal() as db:
        ingest_document(db, doc_id, file_path, filename)


@router.post("/upload", status_code=201)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    author: str | None = Form(None, max_length=100),
    year: int | None = Form(None, ge=1900, le=2100),
    topic: str | None = Form(None, max_length=100),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    safe_name = Path(file.filename or "").name[:200]
    ext = Path(safe_name).suffix.lower()
    if ext not in ALLOWED_TYPES:
        raise HTTPException(400, "Only PDF and DOCX files are supported.")

    if crud.count_documents(db, user.id) >= settings.max_docs_per_user:
        raise HTTPException(400, f"Document limit reached ({settings.max_docs_per_user}). Delete one to upload more.")

    doc_id = models.gen_id()
    dest = Path(settings.upload_dir) / f"{doc_id}{ext}"
    max_bytes = settings.max_upload_mb * 1024 * 1024

    # Stream to disk in 1 MB pieces so a huge upload can't fill memory, and stop at the limit.
    size = 0
    first_bytes = b""
    try:
        with open(dest, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                if not first_bytes:
                    first_bytes = chunk[:8]
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(413, f"File too large (max {settings.max_upload_mb} MB).")
                out.write(chunk)
        if size == 0 or not first_bytes.startswith(ALLOWED_TYPES[ext]):
            raise HTTPException(400, "File content doesn't match its type. Is it a real PDF/DOCX?")
    except HTTPException:
        dest.unlink(missing_ok=True)
        raise
    except Exception:
        dest.unlink(missing_ok=True)
        logger.exception("Upload failed for user=%s", user.id)
        raise HTTPException(500, "Could not save the file. Please try again.")

    doc = crud.create_document(
        db, doc_id=doc_id, owner_id=user.id, filename=safe_name,
        author=(author or "").strip() or None, year=year, topic=(topic or "").strip() or None,
    )
    logger.info("Upload accepted: doc=%s user=%s size=%dKB", doc.id, user.id, size // 1024)
    background_tasks.add_task(_run_ingestion_in_new_session, doc.id, str(dest), safe_name)

    return {"id": doc.id, "filename": doc.filename, "status": doc.status}


@router.get("")
def get_documents(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    docs = crud.list_documents(db, user.id)
    return [
        {
            "id": d.id, "filename": d.filename, "author": d.author,
            "year": d.year, "topic": d.topic, "status": d.status,
            "num_pages": d.num_pages, "uploaded_at": d.uploaded_at.isoformat(),
        }
        for d in docs
    ]


@router.get("/{doc_id}/file")
def get_document_file(doc_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Serves the original uploaded file so the frontend citation viewer can open it."""
    doc = crud.get_document(db, doc_id, user.id)
    if not doc:
        raise HTTPException(404, "Document not found")
    path = _file_path(doc)
    if not path.exists():
        raise HTTPException(404, "File not found on disk")
    return FileResponse(path, media_type=MEDIA_TYPES[path.suffix], filename=doc.filename)


@router.delete("/{doc_id}")
def delete_document(doc_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    doc = crud.get_document(db, doc_id, user.id)
    if not doc:
        raise HTTPException(404, "Document not found")

    faiss_ids = [c.faiss_index_pos for c in doc.child_chunks]
    path = _file_path(doc)

    crud.delete_document(db, doc)  # cascades chunks in SQLite
    if faiss_ids:
        vector_store.remove(faiss_ids)
    path.unlink(missing_ok=True)
    bm25_store.rebuild(db)

    logger.info("Document deleted: doc=%s user=%s", doc_id, user.id)
    return {"deleted": doc_id}
