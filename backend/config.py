"""
Central configuration. Every value can be overridden with an environment
variable (or a line in backend/.env), e.g. SECRET_KEY=... or DATA_DIR=/data.

DATA_DIR is the ONE folder that holds everything that must survive a
restart: the SQLite database, the FAISS index, uploaded files and logs.
On Render you mount a persistent disk at /data and set DATA_DIR=/data.
"""
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent
INSECURE_SECRETS = {"", "change-me", "change-me-to-a-long-random-string"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- App ---
    environment: str = "development"  # set to "production" on Render
    log_level: str = "INFO"

    # --- Auth ---
    secret_key: str = "change-me"
    access_token_expire_minutes: int = 60 * 24  # 1 day
    allow_registration: bool = True  # set False later to close sign-ups
    # "Continue with Google": create an OAuth Web client in Google Cloud Console and
    # paste its Client ID here. Leave empty to hide the Google button.
    google_client_id: str = ""

    # --- LLM / Embeddings ---
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-20b"
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    reranker_model: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"
    embedding_dim: int = 384  # bge-small-en-v1.5 output dim

    # --- Storage ---
    data_dir: str = str(BASE_DIR / "storage")

    # --- Chunking ---
    parent_chunk_size: int = 1500
    parent_chunk_overlap: int = 100
    child_chunk_size: int = 500
    child_chunk_overlap: int = 50

    # --- Retrieval ---
    vector_top_k: int = 20
    bm25_top_k: int = 20
    rerank_top_k: int = 5

    # --- Guardrails ---
    max_upload_mb: int = 15
    max_pages_per_doc: int = 300
    max_docs_per_user: int = 20
    max_chats_per_user: int = 100
    max_question_chars: int = 1000
    chat_rate_limit_per_minute: int = 15
    auth_rate_limit_per_minute: int = 10

    # --- CORS: comma-separated list of frontend URLs ---
    frontend_origins: str = "https://citewise-ai-assistant-frontend.vercel.app"

    # Derived paths (all inside data_dir)
    @property
    def sqlite_path(self) -> str:
        return str(Path(self.data_dir) / "citewise.db")

    @property
    def faiss_index_path(self) -> str:
        return str(Path(self.data_dir) / "faiss_index" / "index.faiss")

    @property
    def upload_dir(self) -> str:
        return str(Path(self.data_dir) / "uploads")

    @property
    def log_dir(self) -> str:
        return str(Path(self.data_dir) / "logs")

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.frontend_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


settings = Settings()

# Refuse to start in production with a guessable signing key —
# anyone who knows the key can forge login tokens.
if settings.is_production and (settings.secret_key in INSECURE_SECRETS or len(settings.secret_key) < 32):
    raise RuntimeError("SECRET_KEY must be set to a random string of 32+ characters in production.")

# Ensure storage dirs exist at import time
for _d in (settings.upload_dir, settings.log_dir, str(Path(settings.faiss_index_path).parent)):
    Path(_d).mkdir(parents=True, exist_ok=True)
