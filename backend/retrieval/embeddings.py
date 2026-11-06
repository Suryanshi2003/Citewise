"""
Embedding model wrapper. Uses LangChain's HuggingFaceEmbeddings so the
rest of the app (retrievers, ensemble, etc.) can talk to it through the
standard LangChain Embeddings interface.
"""
from langchain_huggingface import HuggingFaceEmbeddings
from config import settings

embedding_model = HuggingFaceEmbeddings(
    model_name=settings.embedding_model,
    encode_kwargs={"normalize_embeddings": True},  # so inner product == cosine similarity
)


def embed_texts(texts: list[str]) -> list[list[float]]:
    return embedding_model.embed_documents(texts)


def embed_query(text: str) -> list[float]:
    return embedding_model.embed_query(text)
