"""
Hybrid retrieval = FAISS (semantic) + BM25 (keyword), merged with
Reciprocal Rank Fusion (RRF). RRF is used instead of raw score averaging
because FAISS cosine scores and BM25 scores live on incomparable scales —
RRF only needs each list's *rank order*, which sidesteps that problem.
This is the same principle LangChain's EnsembleRetriever uses internally.
"""
from sqlalchemy.orm import Session

from config import settings
from db import crud, models
from retrieval.embeddings import embed_query
from retrieval.vector_store import vector_store
from retrieval.bm25_store import bm25_store

RRF_K = 60  # standard smoothing constant for RRF


def _reciprocal_rank_fusion(
    vector_results: list[tuple[int, float]],
    bm25_results: list[tuple[int, float]],
) -> list[int]:
    """Takes two ranked (faiss_id, score) lists, returns fused faiss_id ranking."""
    scores: dict[int, float] = {}
    for rank, (faiss_id, _) in enumerate(vector_results):
        scores[faiss_id] = scores.get(faiss_id, 0.0) + 1.0 / (RRF_K + rank + 1)
    for rank, (faiss_id, _) in enumerate(bm25_results):
        scores[faiss_id] = scores.get(faiss_id, 0.0) + 1.0 / (RRF_K + rank + 1)

    return [fid for fid, _ in sorted(scores.items(), key=lambda x: x[1], reverse=True)]


def hybrid_retrieve(
    db: Session,
    query: str,
    owner_id: str,
    author: str | None = None,
    year: int | None = None,
    topic: str | None = None,
) -> list[models.ChildChunk]:
    """
    Runs owner + metadata filter -> hybrid (vector + BM25) retrieval -> RRF fusion.
    Only chunks belonging to `owner_id` can ever be returned.
    Returns ChildChunk ORM rows ready for reranking.
    """
    # 1. Which chunks may this user see? (their own, "ready", matching filters)
    allowed_faiss_ids = crud.get_faiss_ids_for_user(db, owner_id, author, year, topic)
    if not allowed_faiss_ids:
        return []

    # 2. Vector search
    query_vec = embed_query(query)
    vector_results = vector_store.search(query_vec, settings.vector_top_k, allowed_faiss_ids)

    # 3. BM25 search
    bm25_results = bm25_store.search(query, settings.bm25_top_k, allowed_faiss_ids)

    # 4. Fuse
    fused_faiss_ids = _reciprocal_rank_fusion(vector_results, bm25_results)
    if not fused_faiss_ids:
        return []

    # 5. Resolve faiss ids -> ChildChunk rows, preserving fused order
    chunk_map = crud.get_child_chunks_by_faiss_pos(db, fused_faiss_ids)
    return [chunk_map[fid] for fid in fused_faiss_ids if fid in chunk_map]
