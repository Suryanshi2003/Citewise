"""
Cross-encoder reranking. Bi-encoders (used for FAISS/BM25 retrieval) score
query and document independently, which is fast but imprecise. A
cross-encoder scores the (query, document) pair jointly — slower, so we
only run it on the ~20-40 candidates hybrid retrieval already narrowed
down, not the whole corpus.
"""
from sentence_transformers import CrossEncoder

from config import settings
from db import models

_reranker: CrossEncoder | None = None


def get_reranker() -> CrossEncoder:
    global _reranker
    if _reranker is None:
        _reranker = CrossEncoder(settings.reranker_model)
    return _reranker


def rerank(query: str, chunks: list[models.ChildChunk], top_k: int | None = None) -> list[models.ChildChunk]:
    if not chunks:
        return []
    top_k = top_k or settings.rerank_top_k

    model = get_reranker()
    pairs = [(query, c.text) for c in chunks]
    scores = model.predict(pairs)

    scored = list(zip(chunks, scores))
    scored.sort(key=lambda x: x[1], reverse=True)
    return [chunk for chunk, _ in scored[:top_k]]
