"""One-command launcher: starts FastAPI backend + Next.js frontend."""

import subprocess
import sys
import os
import time
import webbrowser
import signal

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_PORT = 8000
FRONTEND_PORT = 3100

processes = []


def start_backend():
    print("[*] Starting backend (FastAPI) on port", BACKEND_PORT)
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.server:app",
         "--host", "0.0.0.0", "--port", str(BACKEND_PORT), "--reload"],
        cwd=ROOT,
    )
    processes.append(proc)
    return proc


def start_frontend():
    print("[*] Starting frontend (Next.js) on port", FRONTEND_PORT)
    # Check if node_modules exists
    if not os.path.isdir(os.path.join(ROOT, "node_modules")):
        print("[*] Installing npm dependencies...")
        subprocess.run(["npm", "install"], cwd=ROOT, shell=True, check=True)

    proc = subprocess.Popen(
        ["npm", "run", "dev", "--", "--port", str(FRONTEND_PORT)],
        cwd=ROOT,
        shell=True,
    )
    processes.append(proc)
    return proc


def cleanup(*args):
    print("\n[*] Shutting down...")
    for proc in processes:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
    sys.exit(0)


if __name__ == "__main__":
    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    # Install Python deps if needed
    try:
        import fastapi  # noqa
        import uvicorn  # noqa
        import aiosqlite  # noqa
    except ImportError:
        print("[*] Installing Python dependencies...")
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "-r",
             os.path.join(ROOT, "backend", "requirements.txt")],
            check=True,
        )

    backend = start_backend()
    frontend = start_frontend()

    # Wait for servers to start, then open browser
    time.sleep(3)
    url = f"http://localhost:{FRONTEND_PORT}"
    print(f"[*] Opening browser: {url}")
    webbrowser.open(url)

    try:
        backend.wait()
    except KeyboardInterrupt:
        cleanup()
