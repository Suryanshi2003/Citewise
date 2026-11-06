import threading

from sqlalchemy.orm import Session

from config import settings
from db import crud
from ingestion.extractor import extract
from ingestion.chunker import chunk_pages
from logger import get_logger
from retrieval.embeddings import embed_texts
from retrieval.vector_store import vector_store
from retrieval.bm25_store import bm25_store

logger = get_logger(__name__)

# Two uploads processed at the same moment could be handed the same FAISS ids.
# This lock makes ingestion one-at-a-time (fine at this scale).
_ingest_lock = threading.Lock()


def ingest_document(db: Session, doc_id: str, file_path: str, filename: str):
    """
    Runs the full ingestion pipeline for one uploaded document.
    Designed to be called as a FastAPI BackgroundTask so upload responds
    immediately while processing happens after. Never raises: on any
    problem the document is marked "failed" and the error is logged.
    """
    with _ingest_lock:
        try:
            logger.info("Ingestion started: doc=%s", doc_id)
            pages = extract(file_path, filename)

            if len(pages) > settings.max_pages_per_doc:
                logger.warning("Doc %s rejected: %d pages (limit %d)", doc_id, len(pages), settings.max_pages_per_doc)
                crud.set_document_status(db, doc_id, status="failed", num_pages=len(pages))
                return

            chunked = chunk_pages(pages)

            all_child_texts: list[str] = []
            all_child_meta: list[dict] = []  # parent_id, page_num — filled after parent insert

            for entry in chunked:
                parent = crud.create_parent_chunk(
                    db, doc_id=doc_id, page_num=entry["page_num"], text=entry["parent_text"]
                )
                for child_text in entry["children"]:
                    all_child_texts.append(child_text)
                    all_child_meta.append({"parent_id": parent.id, "page_num": entry["page_num"]})

            if not all_child_texts:
                # e.g. a scanned PDF with no selectable text
                logger.warning("Doc %s has no extractable text", doc_id)
                crud.set_document_status(db, doc_id, status="failed", num_pages=len(pages))
                return

            # Embed all child chunks in one batch call (far faster than one-by-one)
            vectors = embed_texts(all_child_texts)

            # Assign FAISS ids up front so SQLite rows and FAISS vectors are
            # written with the same ids in the same pass.
            next_pos = crud.get_next_faiss_pos(db)
            faiss_ids = list(range(next_pos, next_pos + len(all_child_texts)))

            for text, meta, faiss_id in zip(all_child_texts, all_child_meta, faiss_ids):
                crud.create_child_chunk(
                    db,
                    parent_id=meta["parent_id"],
                    doc_id=doc_id,
                    page_num=meta["page_num"],
                    text=text,
                    faiss_index_pos=faiss_id,
                )

            vector_store.add(vectors, faiss_ids)

            crud.set_document_status(db, doc_id, status="ready", num_pages=len(pages))

            # Cheap at this scale — keeps BM25 corpus in sync with SQLite.
            bm25_store.rebuild(db)
            logger.info("Ingestion finished: doc=%s pages=%d chunks=%d", doc_id, len(pages), len(all_child_texts))

        except Exception:
            logger.exception("Ingestion failed: doc=%s", doc_id)
            db.rollback()
            crud.set_document_status(db, doc_id, status="failed")
