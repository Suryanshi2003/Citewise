import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import settings
from logger import setup_logging, get_logger

setup_logging()  # must run before the other modules start logging

from db import crud  # noqa: E402
from db.database import init_db, SessionLocal  # noqa: E402
from retrieval.bm25_store import bm25_store  # noqa: E402
from retrieval.vector_store import vector_store  # noqa: E402
from routers import auth, chat, documents, eval as eval_router  # noqa: E402

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    vector_store.load_or_create()
    with SessionLocal() as db:
        stuck = crud.fail_stuck_documents(db)
        if stuck:
            logger.warning("Marked %d interrupted document(s) as failed", stuck)
        bm25_store.rebuild(db)
    if not settings.groq_api_key:
        logger.warning("GOOGLE_API_KEY is not set — chat answers will fail")
    logger.info("CiteWise API started (environment=%s, data_dir=%s)", settings.environment, settings.data_dir)
    yield
    logger.info("CiteWise API shutting down")


app = FastAPI(
    title="CiteWise API",
    version="0.2.0",
    lifespan=lifespan,
    # Hide the interactive API docs on the public internet
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None,
    openapi_url=None if settings.is_production else "/openapi.json",
)


@app.middleware("http")
async def log_requests_and_catch_errors(request: Request, call_next):
    """Logs every request, and turns any unexpected crash into a clean 500
    (the real error goes to the log, never to the user)."""
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse({"detail": "Something went wrong on our side."}, status_code=500)
    if request.url.path != "/health":
        ms = (time.perf_counter() - start) * 1000
        logger.info("%s %s -> %d (%.0f ms)", request.method, request.url.path, response.status_code, ms)
    return response


# Added AFTER the middleware above so it wraps it: even the 500 reply gets CORS headers.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,  # we use an Authorization header, not cookies
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(documents.router, prefix="/documents", tags=["documents"])
app.include_router(chat.router, prefix="/chat", tags=["chat"])
app.include_router(eval_router.router, prefix="/eval", tags=["eval"])


@app.get("/health")
def health():
    return {"status": "ok"}
