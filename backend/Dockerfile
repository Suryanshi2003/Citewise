FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/app/.cache/huggingface

WORKDIR /app

# 1) Install dependencies first (Docker caches this layer, so rebuilds are fast).
#    CPU-only PyTorch: the default build is ~2 GB bigger because it bundles GPU code.
COPY requirements.txt .
RUN pip install --no-cache-dir torch==2.4.1 --extra-index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt

# 2) Download the AI models at BUILD time, so the server starts fast and
#    never has to download 100s of MB on its first request.
RUN python -c "from sentence_transformers import SentenceTransformer, CrossEncoder; \
SentenceTransformer('BAAI/bge-small-en-v1.5'); \
CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')"

# 3) Copy the app code
COPY . .

# On Render, DATA_DIR=/data is the persistent disk (see render.yaml).
# ONE worker on purpose: the FAISS and BM25 indexes live in this process's memory.
# --proxy-headers lets rate limiting see the real user IP behind Render's proxy.
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*' --no-access-log"]
