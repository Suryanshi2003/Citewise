"""
Raw FAISS index (not LangChain's FAISS wrapper) because we need explicit
control over vector ids so they stay in lockstep with
child_chunks.faiss_index_pos in SQLite. IndexIDMap lets us assign our
own integer id to every vector, and remove-by-id when a document is deleted.

Using IndexFlatIP (inner product) on normalized embeddings == cosine similarity.
"""
import threading
from pathlib import Path

import faiss
import numpy as np

from config import settings


class VectorStore:
    def __init__(self):
        self._lock = threading.Lock()
        self.index: faiss.IndexIDMap | None = None

    def load_or_create(self):
        index_path = Path(settings.faiss_index_path)
        if index_path.exists():
            self.index = faiss.read_index(str(index_path))
        else:
            flat = faiss.IndexFlatIP(settings.embedding_dim)
            self.index = faiss.IndexIDMap(flat)
            self._persist()

    def _persist(self):
        # Write to a temp file then rename, so a crash mid-write can't corrupt the index
        tmp_path = settings.faiss_index_path + ".tmp"
        faiss.write_index(self.index, tmp_path)
        Path(tmp_path).replace(settings.faiss_index_path)

    def add(self, vectors: list[list[float]], ids: list[int]):
        with self._lock:
            arr = np.array(vectors, dtype="float32")
            id_arr = np.array(ids, dtype="int64")
            self.index.add_with_ids(arr, id_arr)
            self._persist()

    def remove(self, ids: list[int]):
        with self._lock:
            id_arr = np.array(ids, dtype="int64")
            self.index.remove_ids(id_arr)
            self._persist()

    def search(self, query_vector: list[float], top_k: int,
               allowed_ids: list[int] | None = None) -> list[tuple[int, float]]:
        """
        Returns [(faiss_id, score), ...] sorted by descending similarity.
        If allowed_ids is given (always the case now: each user only searches
        their own documents) we search the WHOLE index and then filter.
        FAISS's flat index has no native pre-filtering, and a small over-fetch
        could return only other users' chunks. Exact search over everything is
        still fast at this scale (thousands of vectors).
        """
        if self.index.ntotal == 0:
            return []

        arr = np.array([query_vector], dtype="float32")
        k = top_k if allowed_ids is None else self.index.ntotal
        scores, ids = self.index.search(arr, k)

        results = []
        allowed_set = set(allowed_ids) if allowed_ids is not None else None
        for faiss_id, score in zip(ids[0], scores[0]):
            if faiss_id == -1:
                continue
            if allowed_set is not None and int(faiss_id) not in allowed_set:
                continue
            results.append((int(faiss_id), float(score)))
            if len(results) >= top_k:
                break
        return results


vector_store = VectorStore()
