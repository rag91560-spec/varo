"""PyInstaller entry point — starts the FastAPI backend via uvicorn.run()."""

import argparse
import logging
import logging.handlers
import multiprocessing
import os
import sys


def _setup_file_logging(data_dir: str):
    """Configure file-based logging for production debugging."""
    log_dir = data_dir or os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, "backend.log")

    handler = logging.handlers.RotatingFileHandler(
        log_path, maxBytes=5 * 1024 * 1024, backupCount=2, encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)s [%(name)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S",
    ))
    root = logging.getLogger()
    root.addHandler(handler)
    root.setLevel(logging.INFO)


def main():
    parser = argparse.ArgumentParser(description="Game Translator Backend")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--data-dir", default="", help="Path to data/ directory")
    args = parser.parse_args()

    if args.data_dir:
        os.environ["GT_DATA_DIR"] = os.path.abspath(args.data_dir)

    _setup_file_logging(args.data_dir)

    import uvicorn
    from backend.server import app  # noqa: E402

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
