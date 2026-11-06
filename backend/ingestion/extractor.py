"""
Extracts text per-page (PDF) so citations can point to an actual page.
DOCX has no native pages, so we approximate "pages" by splitting on a
fixed character budget — flagged clearly in metadata as approximate.
"""
import fitz  # PyMuPDF
from docx import Document as DocxDocument


def extract_pdf(path: str) -> list[dict]:
    """Returns [{"page_num": int, "text": str}, ...], 1-indexed pages."""
    pages = []
    with fitz.open(path) as doc:
        for i, page in enumerate(doc):
            text = page.get_text("text").strip()
            if text:
                pages.append({"page_num": i + 1, "text": text})
    return pages


def extract_docx(path: str, approx_chars_per_page: int = 3000) -> list[dict]:
    """DOCX has no page boundaries at the text-extraction level, so we
    bucket paragraphs into approximate pages of ~3000 chars each."""
    doc = DocxDocument(path)
    full_text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())

    pages = []
    page_num = 1
    for i in range(0, len(full_text), approx_chars_per_page):
        chunk = full_text[i:i + approx_chars_per_page].strip()
        if chunk:
            pages.append({"page_num": page_num, "text": chunk})
            page_num += 1
    return pages


def extract(path: str, filename: str) -> list[dict]:
    lower = filename.lower()
    if lower.endswith(".pdf"):
        return extract_pdf(path)
    elif lower.endswith(".docx"):
        return extract_docx(path)
    else:
        raise ValueError(f"Unsupported file type: {filename}")
