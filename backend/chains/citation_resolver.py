"""
Turns generic citations ("Source: paper.pdf") into precise ones
(page + exact highlighted sentence), the "even better" feature from
the spec. Approach: for each [n] marker, take the answer's sentence
that contains it, embed it, embed every sentence in the *child chunk*
that was actually retrieved for source n, and pick the closest match
by cosine similarity. Child chunks are already small (~300 tokens),
so this is cheap and precise — no need to re-search the whole parent.
"""
import re
import numpy as np

from db import models
from retrieval.embeddings import embed_texts

CITATION_MARKER_RE = re.compile(r"\[(\d+)]")
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def _split_sentences(text: str) -> list[str]:
    return [s.strip() for s in SENTENCE_SPLIT_RE.split(text) if s.strip()]


def _cosine_sim(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8))


def resolve_citations(
    answer_text: str,
    numbered_child_chunks: list[models.ChildChunk],
    numbered_sources: list[dict],
) -> list[dict]:
    """
    numbered_child_chunks[i] / numbered_sources[i] correspond to citation [i+1].
    Returns a list of citation objects actually used in the answer, each with
    the best-matching highlighted sentence from its source child chunk.
    """
    answer_sentences = _split_sentences(answer_text)

    # Map citation number -> list of answer sentences that cite it
    citation_to_claims: dict[int, list[str]] = {}
    for sentence in answer_sentences:
        markers = CITATION_MARKER_RE.findall(sentence)
        for m in markers:
            citation_to_claims.setdefault(int(m), []).append(sentence)

    results = []
    for n, claims in sorted(citation_to_claims.items()):
        idx = n - 1
        if idx < 0 or idx >= len(numbered_child_chunks):
            continue
        chunk = numbered_child_chunks[idx]
        source = numbered_sources[idx]

        candidate_sentences = _split_sentences(chunk.text) or [chunk.text]
        claim_text = " ".join(claims)

        # Batch-embed claim + candidates together (one call instead of N)
        vectors = embed_texts([claim_text] + candidate_sentences)
        claim_vec = np.array(vectors[0])
        best_sentence = candidate_sentences[0]
        best_score = -1.0
        for sent, vec in zip(candidate_sentences, vectors[1:]):
            score = _cosine_sim(claim_vec, np.array(vec))
            if score > best_score:
                best_score = score
                best_sentence = sent

        results.append({
            "marker": n,
            "filename": source["filename"],
            "page_num": source["page_num"],
            "doc_id": source["doc_id"],
            "highlighted_sentence": best_sentence,
        })

    return results
