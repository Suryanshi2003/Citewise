from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import sessionmaker, declarative_base
from config import settings

# check_same_thread=False is required because FastAPI can hit SQLite
# from different threads within one process.
engine = create_engine(
    f"sqlite:///{settings.sqlite_path}",
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_connection, _):
    # WAL lets readers and the background ingestion writer work at the same time
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# create_all() only creates MISSING TABLES, it never adds columns to a table that already
# exists. So when we add a column later, a database that is already deployed (with real
# users in it) would break. This list is a tiny, safe migration: add the column if absent.
_NEW_COLUMNS = [
    ("users", "email_verified", "BOOLEAN DEFAULT 0"),
    ("chat_sessions", "title", "VARCHAR"),
    ("chat_sessions", "updated_at", "DATETIME"),
]


def _add_missing_columns():
    insp = inspect(engine)
    with engine.begin() as conn:
        for table, column, ddl in _NEW_COLUMNS:
            existing = {c["name"] for c in insp.get_columns(table)}
            if column not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))


def init_db():
    from db import models  # noqa: F401  (ensure models are registered)
    Base.metadata.create_all(bind=engine)
    _add_missing_columns()
