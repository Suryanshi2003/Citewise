# CiteWise Backend

FastAPI + LangChain RAG backend with login, per-user documents, SQLite + FAISS.

## Run locally

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # then edit: GROQ_API_KEY and SECRET_KEY
uvicorn main:app --reload --port 8000
```

> **Upgrading from the very first (no-login) version?** The database now has users, so delete the old
> `backend/storage/` folder once before starting (you'll re-upload your papers).
> Upgrading from the login version: nothing to do, new columns are added automatically on start-up.

API docs (local only): http://localhost:8000/docs

## What's where

| File | Job |
|---|---|
| `main.py` | App start-up, request logging, CORS, error catching |
| `config.py` | All settings (from environment variables) |
| `logger.py` | Logging to console + `DATA_DIR/logs/app.log` |
| `security.py` | Password hashing, login tokens, rate limiting |
| `routers/auth.py` | `/auth/register`, `/auth/login`, `/auth/google`, `/auth/me`, `/auth/config` |
| `routers/documents.py` | Upload / list / download / delete (own documents only) |
| `routers/chat.py` | Ask questions (streaming), list / reopen / delete past chats |
| `db/crud.py` | Every database query (all scoped to the logged-in user) |

## Guardrails built in

- Passwords stored as bcrypt hashes; login tokens expire after 1 day
- Every route except `/health` needs a login; users can only see their own documents/chats
- Rate limits: login/register per IP, questions per user
- Uploads: PDF/DOCX only, content checked, size and page limits, max docs per user
- Question length limit; prompt-injection-resistant system prompt
- Groq/LLM failures are caught and shown as a friendly message
- Production refuses to start with a weak `SECRET_KEY`; API docs hidden in production

## Storage

Everything that must survive restarts lives under one folder, `DATA_DIR`
(database, FAISS index, uploaded files, logs). Locally it's `backend/storage/`.
On Render it's the persistent disk mounted at `/data`.

## Known limits (by design)

- One server process only (FAISS/BM25 live in memory, SQLite has one writer)
- Rate limits are per-process in memory (reset on restart)
