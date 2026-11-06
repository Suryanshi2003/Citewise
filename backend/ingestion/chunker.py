"""
Parent-child chunking (LangChain text splitters).

Design:
- Parent chunks are built PER PAGE, so a parent chunk never crosses a
  page boundary — this keeps citations ("page 14") always accurate.
- Child chunks are split from each parent chunk, and carry the same
  page number (they're a subset of the parent's text).
- This mirrors LangChain's ParentDocumentRetriever idea, but we manage
  the parent/child linkage ourselves in SQLite so it's persistent
  without needing an InMemoryStore.
"""
from langchain.text_splitter import RecursiveCharacterTextSplitter
from config import settings

parent_splitter = RecursiveCharacterTextSplitter(
    chunk_size=settings.parent_chunk_size,
    chunk_overlap=settings.parent_chunk_overlap,
    separators=["\n\n", "\n", ". ", " ", ""],
)

child_splitter = RecursiveCharacterTextSplitter(
    chunk_size=settings.child_chunk_size,
    chunk_overlap=settings.child_chunk_overlap,
    separators=["\n\n", "\n", ". ", " ", ""],
)


def chunk_pages(pages: list[dict]) -> list[dict]:
    """
    Input: [{"page_num": int, "text": str}, ...]
    Output: [{"page_num": int, "parent_text": str, "children": [str, ...]}, ...]
    """
    result = []
    for page in pages:
        parent_texts = parent_splitter.split_text(page["text"])
        for parent_text in parent_texts:
            children = child_splitter.split_text(parent_text)
            if not children:
                continue
            result.append({
                "page_num": page["page_num"],
                "parent_text": parent_text,
                "children": children,
            })
    return result
