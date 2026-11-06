"""
BM25 has no persistence layer in LangChain/rank_bm25 — the index lives
in memory and is rebuilt from the source-of-truth (SQLite child_chunks).
We rebuild once at server startup and again after every successful
ingestion (cheap at portfolio scale — hundreds to low thousands of chunks).
"""
import threading
from rank_bm25 import BM25Okapi
from sqlalchemy.orm import Session

from db import crud


def _tokenize(text: str) -> list[str]:
    return text.lower().split()


class BM25Store:
    def __init__(self):
        self._lock = threading.Lock()
        self.bm25: BM25Okapi | None = None
        self.child_ids: list[str] = []       # index-aligned with bm25 corpus
        self.faiss_positions: list[int] = []  # index-aligned, for id-space fusion

    def rebuild(self, db: Session):
        with self._lock:
            chunks = crud.get_all_child_chunks(db)
            if not chunks:
                self.bm25 = None
                self.child_ids = []
                self.faiss_positions = []
                return

            corpus = [_tokenize(c.text) for c in chunks]
            self.bm25 = BM25Okapi(corpus)
            self.child_ids = [c.id for c in chunks]
            self.faiss_positions = [c.faiss_index_pos for c in chunks]

    def search(self, query: str, top_k: int,
               allowed_faiss_ids: list[int] | None = None) -> list[tuple[int, float]]:
        """Returns [(faiss_index_pos, score), ...] sorted descending."""
        if self.bm25 is None:
            return []

        scores = self.bm25.get_scores(_tokenize(query))
        allowed_set = set(allowed_faiss_ids) if allowed_faiss_ids is not None else None

        scored = []
        for pos, score in zip(self.faiss_positions, scores):
            if allowed_set is not None and pos not in allowed_set:
                continue
            scored.append((pos, float(score)))

        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:top_k]


bm25_store = BM25Store()
