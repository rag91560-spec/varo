"""Build the backend into a standalone exe using PyInstaller."""

import subprocess
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC_FILE = ROOT / "backend.spec"
DIST_DIR = ROOT / "dist" / "backend-dist"


def main():
    # Ensure all dependencies are installed
    req_file = ROOT / "backend" / "requirements.txt"
    if req_file.exists():
        print("[build-backend] Installing backend requirements...")
        subprocess.check_call([
            sys.executable, "-m", "pip", "install", "-r", str(req_file),
        ])

    # Ensure PyInstaller is installed
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print("[build-backend] Installing PyInstaller...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller"])

    # Clean previous build
    if DIST_DIR.exists():
        print(f"[build-backend] Cleaning {DIST_DIR}")
        shutil.rmtree(DIST_DIR)

    # Run PyInstaller
    print("[build-backend] Running PyInstaller...")
    result = subprocess.run(
        [
            sys.executable, "-m", "PyInstaller",
            str(SPEC_FILE),
            "--distpath", str(ROOT / "dist"),
            "--workpath", str(ROOT / "build"),
            "--noconfirm",
        ],
        cwd=str(ROOT),
    )

    if result.returncode != 0:
        print("[build-backend] PyInstaller failed!", file=sys.stderr)
        sys.exit(1)

    # Verify output
    exe_path = DIST_DIR / "backend.exe"
    if not exe_path.exists():
        print(f"[build-backend] ERROR: {exe_path} not found!", file=sys.stderr)
        sys.exit(1)

    size_mb = exe_path.stat().st_size / (1024 * 1024)
    print(f"[build-backend] Success: {exe_path} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
