"""
One place that sets up logging for the whole app.

Logs go to two places:
  1. the console (stdout)  -> this is what you see in Render's "Logs" tab
  2. a rotating file in DATA_DIR/logs/app.log  -> kept on the persistent disk,
     max 2 MB per file, 3 old files kept, so it can never fill the disk

In any other file just do:
    from logger import get_logger
    logger = get_logger(__name__)
    logger.info("something happened")

Rule: never log passwords, tokens or full document text.
"""
import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

from config import settings

_configured = False


def setup_logging() -> None:
    global _configured
    if _configured:
        return
    _configured = True

    formatter = logging.Formatter("%(asctime)s | %(levelname)-8s | %(name)s | %(message)s")

    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(formatter)

    file_handler = RotatingFileHandler(
        Path(settings.log_dir) / "app.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8"
    )
    file_handler.setFormatter(formatter)

    root = logging.getLogger()
    root.setLevel(settings.log_level.upper())
    root.addHandler(console)
    root.addHandler(file_handler)

    # Keep noisy libraries quiet
    for noisy in ("httpx", "httpcore", "urllib3", "sentence_transformers", "faiss"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
