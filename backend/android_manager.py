"""Android emulator + ADB management module."""

import os
import re
import shutil
import socket
import subprocess
import zipfile
import asyncio
import logging
import threading
import time
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


def _safe_extractall(zf: zipfile.ZipFile, extract_dir: str):
    """Extract zip with ZipSlip path traversal prevention."""
    real_extract = os.path.realpath(extract_dir)
    for member in zf.namelist():
        target = os.path.realpath(os.path.join(extract_dir, member))
        if not target.startswith(real_extract + os.sep) and target != real_extract:
            raise ValueError(f"Zip path traversal detected: {member}")
    zf.extractall(extract_dir)


# Paths — use ASCII-only names to avoid Java/sdkmanager failures with non-ASCII paths
APPDATA = os.environ.get("APPDATA", "")
_BASE_DIR = os.path.join(APPDATA, "GameTranslator")
GAMES_DIR = os.path.join(_BASE_DIR, "games", "android")
COVERS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "covers")

# Embedded SDK paths
SDK_DIR = os.path.join(_BASE_DIR, "android-sdk")
CMDLINE_TOOLS_DIR = os.path.join(SDK_DIR, "cmdline-tools", "latest")
EMULATOR_DIR = os.path.join(SDK_DIR, "emulator")
PLATFORM_TOOLS_DIR = os.path.join(SDK_DIR, "platform-tools")
AVD_DIR = os.path.join(_BASE_DIR, "android-avd")

# Bundled portable JDK
JDK_DIR = os.path.join(_BASE_DIR, "jdk")
JDK_URL = "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse"

# cmdline-tools download URL (Windows)
CMDLINE_TOOLS_URL = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"


def _migrate_legacy_paths():
    """Migrate from old Korean path (게임번역기) to new ASCII path (GameTranslator)."""
    old_base = os.path.join(APPDATA, "게임번역기")
    new_base = os.path.join(APPDATA, "GameTranslator")
    if os.path.isdir(old_base) and not os.path.isdir(new_base):
        try:
            shutil.move(old_base, new_base)
            logger.info("Migrated legacy path %s -> %s", old_base, new_base)
        except Exception as e:
            logger.warning("Legacy path migration failed: %s", e)


# Run migration once on module load
_migrate_legacy_paths()


def _find_java() -> Optional[str]:
    """Find java executable. Check bundled JDK first, then system."""
    # Bundled JDK — look inside the extracted directory (may have a versioned subfolder)
    if os.path.isdir(JDK_DIR):
        # Direct: JDK_DIR/bin/java.exe
        direct = os.path.join(JDK_DIR, "bin", "java.exe")
        if os.path.isfile(direct):
            return direct
        # Subfolder: JDK_DIR/jdk-17.x.x+x/bin/java.exe
        for entry in os.scandir(JDK_DIR):
            if entry.is_dir():
                nested = os.path.join(entry.path, "bin", "java.exe")
                if os.path.isfile(nested):
                    return nested
    # System Java
    java = shutil.which("java")
    if java:
        return java
    return None


def _get_jdk_home() -> Optional[str]:
    """Get JAVA_HOME path from bundled or system Java."""
    java = _find_java()
    if java:
        return str(Path(java).parent.parent)
    return None


def _sdk_env() -> dict:
    """Build consistent env dict for all SDK tool calls."""
    env = os.environ.copy()
    env["ANDROID_SDK_ROOT"] = SDK_DIR
    env["ANDROID_HOME"] = SDK_DIR
    env["ANDROID_AVD_HOME"] = AVD_DIR
    jdk_home = _get_jdk_home()
    if jdk_home:
        env["JAVA_HOME"] = jdk_home
    return env

# SDK components to install
SDK_PACKAGES = [
    "emulator",
    "platform-tools",
    "system-images;android-34;google_apis;x86_64",
    "platforms;android-34",
]
AVD_NAME = "game_translator_avd"

# Emulator detection paths
EMULATOR_PATHS = {
    "MuMu Player": [
        r"C:\Program Files\Netease\MuMuPlayer-12.0",
        r"C:\Program Files\Netease\MuMuPlayer",
        r"C:\Program Files\MuMu\emulator\nemu",
        r"C:\Program Files\MuMuPlayerGlobal-12.0",
        r"D:\Program Files\Netease\MuMuPlayer-12.0",
        r"D:\MuMuPlayer-12.0",
    ],
    "LDPlayer": [
        r"C:\LDPlayer\LDPlayer9",
        r"C:\LDPlayer\LDPlayer4.0",
    ],
    "BlueStacks": [
        r"C:\Program Files\BlueStacks_nxt",
        r"C:\Program Files\BlueStacks",
    ],
    "MEmu": [
        r"C:\Program Files\Microvirt\MEmu",
    ],
    "NoxPlayer": [
        r"C:\Program Files\Nox\bin",
        r"D:\Program Files\Nox\bin",
    ],
}

# Default ADB ports per emulator
EMULATOR_ADB_PORTS = {
    "MuMu Player": [7555, 16384, 16416],
    "LDPlayer": [5555, 5556, 5557],
    "BlueStacks": [5555, 5556],
    "MEmu": [21503],
    "NoxPlayer": [62001, 62025],
}

DEFAULT_ADB_PORTS = [5555, 5554, 5556, 5557, 5558, 5559, 7555, 16384, 21503, 62001]


def _find_adb() -> Optional[str]:
    """Find adb.exe from embedded SDK, system PATH, ANDROID_HOME, or common emulator paths."""
    # 0. Embedded SDK (highest priority)
    embedded_adb = os.path.join(PLATFORM_TOOLS_DIR, "adb.exe")
    if os.path.isfile(embedded_adb):
        return embedded_adb

    # 1. System PATH
    adb_in_path = shutil.which("adb")
    if adb_in_path:
        return adb_in_path

    # 2. ANDROID_HOME / ANDROID_SDK_ROOT
    for env_var in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        sdk = os.environ.get(env_var)
        if sdk:
            adb = os.path.join(sdk, "platform-tools", "adb.exe")
            if os.path.isfile(adb):
                return adb

    # 3. Common emulator adb paths
    for name, paths in EMULATOR_PATHS.items():
        for base in paths:
            # Direct
            adb = os.path.join(base, "adb.exe")
            if os.path.isfile(adb):
                return adb
            # MuMu Player: shell/ subfolder
            adb = os.path.join(base, "shell", "adb.exe")
            if os.path.isfile(adb):
                return adb
            # Subfolder: vmonitor/bin/
            adb = os.path.join(base, "vmonitor", "bin", "adb.exe")
            if os.path.isfile(adb):
                return adb

    return None


def _run_adb(args: list[str], adb_path: Optional[str] = None, timeout: int = 30) -> tuple[int, str, str]:
    """Run adb command and return (returncode, stdout, stderr)."""
    adb = adb_path or _find_adb()
    if not adb:
        return (-1, "", "adb not found")
    try:
        proc = subprocess.run(
            [adb] + args,
            capture_output=True, text=True, timeout=timeout,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        return (proc.returncode, proc.stdout, proc.stderr)
    except subprocess.TimeoutExpired:
        return (-1, "", "adb command timed out")
    except Exception as e:
        return (-1, "", str(e))


def extract_apk_info(apk_path: str) -> dict:
    """Extract metadata from APK file.

    Uses pyaxmlparser if available, otherwise falls back to basic zipfile inspection.
    Returns: {package_name, app_name, version, icon_data}
    """
    result = {
        "package_name": "",
        "app_name": "",
        "version": "",
        "icon_data": None,
    }

    try:
        from pyaxmlparser import APK
        apk = APK(apk_path)
        result["package_name"] = apk.package or ""
        result["app_name"] = apk.application or ""
        result["version"] = apk.version_name or ""

        # Try to extract icon
        icon_name = apk.get_app_icon()
        if icon_name:
            try:
                with zipfile.ZipFile(apk_path, "r") as zf:
                    result["icon_data"] = zf.read(icon_name)
            except Exception:
                pass
    except ImportError:
        # Fallback: just use filename as name
        result["app_name"] = Path(apk_path).stem
        result["package_name"] = Path(apk_path).stem.replace(" ", ".").lower()
    except Exception as e:
        logger.warning(f"Failed to parse APK {apk_path}: {e}")
        result["app_name"] = Path(apk_path).stem
        result["package_name"] = Path(apk_path).stem.replace(" ", ".").lower()

    return result


def detect_emulators() -> list[dict]:
    """Detect installed Android emulators.

    Returns list of {name, path, adb_port, status}.
    """
    found = []

    for name, paths in EMULATOR_PATHS.items():
        for base_path in paths:
            if os.path.isdir(base_path):
                # Check for key executables
                exe_candidates = {
                    "MuMu Player": ["MuMuPlayer.exe", "MuMuVMMHeadless.exe", "NemuPlayer.exe"],
                    "LDPlayer": ["dnplayer.exe", "LDPlayer.exe"],
                    "BlueStacks": ["HD-Player.exe", "Bluestacks.exe"],
                    "MEmu": ["MEmu.exe"],
                    "NoxPlayer": ["Nox.exe"],
                }
                exe_found = False
                for exe_name in exe_candidates.get(name, []):
                    if os.path.isfile(os.path.join(base_path, exe_name)):
                        exe_found = True
                        break

                if exe_found or name == "LDPlayer":  # LDPlayer dir structure is enough
                    ports = EMULATOR_ADB_PORTS.get(name, [5555])
                    status = "stopped"

                    # Check if emulator is running by probing ADB port
                    for port in ports:
                        if _is_port_open(port):
                            status = "running"
                            break

                    found.append({
                        "name": name,
                        "path": base_path,
                        "adb_port": ports[0],
                        "status": status,
                    })
                    break  # Only report first match per emulator

    # Check for embedded SDK emulator (highest priority)
    embedded_emu = os.path.join(EMULATOR_DIR, "emulator.exe")
    if os.path.isfile(embedded_emu):
        found.insert(0, {
            "name": "Embedded Emulator",
            "type": "embedded",
            "path": SDK_DIR,
            "adb_port": 5554,
            "status": "running" if is_emulator_running() else "stopped",
        })
    else:
        # Check for Android SDK emulator from env
        for env_var in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
            sdk = os.environ.get(env_var)
            if sdk and os.path.isdir(sdk):
                emulator_exe = os.path.join(sdk, "emulator", "emulator.exe")
                if os.path.isfile(emulator_exe):
                    found.append({
                        "name": "Android SDK Emulator",
                        "path": sdk,
                        "adb_port": 5554,
                        "status": "running" if _is_port_open(5554) else "stopped",
                    })
                break

    return found


def _is_port_open(port: int, host: str = "127.0.0.1", timeout: float = 0.5) -> bool:
    """Check if a TCP port is open."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout)
            return sock.connect_ex((host, port)) == 0
    except Exception:
        return False


def connect_emulator(port: int = 5555) -> dict:
    """Connect to emulator via ADB.

    Returns {ok, device_id, message}.
    """
    rc, stdout, stderr = _run_adb(["connect", f"127.0.0.1:{port}"])
    if rc == 0 and ("connected" in stdout.lower() or "already" in stdout.lower()):
        return {"ok": True, "device_id": f"127.0.0.1:{port}", "message": stdout.strip()}
    return {"ok": False, "device_id": "", "message": stderr.strip() or stdout.strip() or "Connection failed"}


def list_devices() -> list[dict]:
    """List connected ADB devices.

    Returns list of {device_id, status}.
    """
    rc, stdout, stderr = _run_adb(["devices"])
    if rc != 0:
        return []

    devices = []
    for line in stdout.strip().split("\n")[1:]:  # Skip "List of devices attached"
        parts = line.strip().split("\t")
        if len(parts) >= 2:
            devices.append({"device_id": parts[0], "status": parts[1]})
    return devices


def install_apk(device_id: str, apk_path: str) -> dict:
    """Install APK to device/emulator.

    Returns {ok, message}.
    """
    if not os.path.isfile(apk_path):
        return {"ok": False, "message": f"APK file not found: {apk_path}"}

    rc, stdout, stderr = _run_adb(["-s", device_id, "install", "-r", apk_path], timeout=120)
    if rc == 0 and "success" in stdout.lower():
        return {"ok": True, "message": "Installed successfully"}
    return {"ok": False, "message": stderr.strip() or stdout.strip() or "Installation failed"}


_PACKAGE_NAME_RE = re.compile(r'^[a-zA-Z0-9_.]+$')


def _validate_package_name(package_name: str) -> bool:
    return bool(_PACKAGE_NAME_RE.match(package_name))


def launch_app(device_id: str, package_name: str) -> dict:
    """Launch an app on the device/emulator.

    Returns {ok, message}.
    """
    if not _validate_package_name(package_name):
        return {"ok": False, "message": "Invalid package name"}
    rc, stdout, stderr = _run_adb(
        ["-s", device_id, "shell", "monkey", "-p", package_name, "-c",
         "android.intent.category.LAUNCHER", "1"]
    )
    if rc == 0:
        return {"ok": True, "message": "App launched"}
    return {"ok": False, "message": stderr.strip() or stdout.strip() or "Launch failed"}


def uninstall_app(device_id: str, package_name: str) -> dict:
    """Uninstall an app from the device/emulator.

    Returns {ok, message}.
    """
    if not _validate_package_name(package_name):
        return {"ok": False, "message": "Invalid package name"}
    rc, stdout, stderr = _run_adb(["-s", device_id, "uninstall", package_name])
    if rc == 0 and "success" in stdout.lower():
        return {"ok": True, "message": "Uninstalled successfully"}
    return {"ok": False, "message": stderr.strip() or stdout.strip() or "Uninstall failed"}


def is_app_installed(device_id: str, package_name: str) -> bool:
    """Check if an app is installed on the device."""
    if not _validate_package_name(package_name):
        return False
    rc, stdout, _ = _run_adb(["-s", device_id, "shell", "pm", "list", "packages", package_name])
    return rc == 0 and f"package:{package_name}" in stdout


def import_apk(source_path: str) -> dict:
    """Import APK file to managed folder.

    1. Extract metadata (package_name, app_name, icon)
    2. Move APK to GAMES_DIR/{package_name}.apk
    3. Save icon to covers folder
    4. Delete original

    Returns {title, package_name, path, icon_path, original_path, size}.
    """
    if not os.path.isfile(source_path):
        raise FileNotFoundError(f"APK not found: {source_path}")

    # Extract metadata
    info = extract_apk_info(source_path)
    package_name = info["package_name"] or Path(source_path).stem.replace(" ", ".").lower()
    title = info["app_name"] or Path(source_path).stem

    # Ensure games dir exists
    os.makedirs(GAMES_DIR, exist_ok=True)

    # Move APK
    dest_path = os.path.join(GAMES_DIR, f"{package_name}.apk")
    file_size = os.path.getsize(source_path)

    # Copy then delete (supports cross-drive moves)
    shutil.copy2(source_path, dest_path)
    try:
        os.remove(source_path)
    except OSError:
        pass  # Original deletion is best-effort

    # Save icon if available
    icon_path = ""
    if info.get("icon_data"):
        os.makedirs(COVERS_DIR, exist_ok=True)
        icon_filename = f"android_{package_name}.png"
        icon_full_path = os.path.join(COVERS_DIR, icon_filename)
        try:
            with open(icon_full_path, "wb") as f:
                f.write(info["icon_data"])
            icon_path = icon_filename
        except Exception:
            pass

    return {
        "title": title,
        "package_name": package_name,
        "path": dest_path,
        "icon_path": icon_path,
        "original_path": source_path,
        "size": file_size,
    }


def get_apk_path(package_name: str) -> Optional[str]:
    """Get managed APK path for a package."""
    path = os.path.join(GAMES_DIR, f"{package_name}.apk")
    return path if os.path.isfile(path) else None


def scan_apks(folder_path: str) -> list[dict]:
    """Scan a folder for APK files.

    Returns list of {title, package_name, path, size}.
    """
    if not os.path.isdir(folder_path):
        return []

    results = []
    for entry in os.scandir(folder_path):
        if entry.is_file() and entry.name.lower().endswith(".apk"):
            try:
                info = extract_apk_info(entry.path)
                results.append({
                    "title": info["app_name"] or entry.name,
                    "package_name": info["package_name"] or Path(entry.name).stem,
                    "path": entry.path,
                    "size": entry.stat().st_size,
                })
            except Exception:
                results.append({
                    "title": Path(entry.name).stem,
                    "package_name": Path(entry.name).stem.replace(" ", ".").lower(),
                    "path": entry.path,
                    "size": entry.stat().st_size,
                })
    return results


def get_emulator_status() -> dict:
    """Get overall emulator/ADB status.

    Returns {adb_available, adb_path, emulators, devices}.
    """
    adb = _find_adb()
    emulators = detect_emulators()
    devices = list_devices() if adb else []

    return {
        "adb_available": adb is not None,
        "adb_path": adb or "",
        "emulators": emulators,
        "devices": devices,
    }


def _wait_for_adb_device(timeout: int = 30) -> Optional[str]:
    """Wait until at least one ADB device shows status 'device'. Returns device_id or None."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        devices = list_devices()
        active = [d for d in devices if d["status"] == "device"]
        if active:
            return active[0]["device_id"]
        time.sleep(2)
    return None


async def install_and_launch(game: dict) -> dict:
    """Install APK to emulator and launch it.

    1. Find running emulator/device
    2. Install APK if not already installed
    3. Launch the app

    Returns {ok, message, device_id}.
    """
    package_name = game.get("package_name", "")
    if not package_name:
        return {"ok": False, "message": "No package name", "device_id": ""}

    # Find APK path
    apk_path = game.get("path", "")
    if not apk_path or not os.path.isfile(apk_path):
        apk_path = get_apk_path(package_name)
    if not apk_path:
        return {"ok": False, "message": "APK file not found", "device_id": ""}

    # Find connected device
    devices = list_devices()
    active_devices = [d for d in devices if d["status"] == "device"]

    if not active_devices:
        # Try embedded emulator first
        if is_sdk_installed() and not is_emulator_running():
            start_result = start_emulator()
            if start_result["ok"]:
                booted = await asyncio.to_thread(wait_for_emulator_boot, 120)
                if booted:
                    # ADB daemon needs extra time after boot_completed
                    await asyncio.sleep(3)
                    # Explicitly connect to emulator ADB port
                    connect_emulator(5554)
                    device_id = await asyncio.to_thread(_wait_for_adb_device, 15)
                    if device_id:
                        active_devices = [{"device_id": device_id, "status": "device"}]

        # Try to connect to common ports
        if not active_devices:
            emulators = detect_emulators()
            for emu in emulators:
                if emu["status"] == "running":
                    result = connect_emulator(emu["adb_port"])
                    if result["ok"]:
                        # Wait briefly for ADB to register the device
                        await asyncio.sleep(1)
                        device_id = await asyncio.to_thread(_wait_for_adb_device, 10)
                        if device_id:
                            active_devices = [{"device_id": device_id, "status": "device"}]
                            break

    if not active_devices:
        return {"ok": False, "message": "No connected emulator found. Start an emulator first.", "device_id": ""}

    device_id = active_devices[0]["device_id"]

    # Install APK (use -r to allow reinstall)
    install_result = await asyncio.to_thread(install_apk, device_id, apk_path)
    if not install_result["ok"]:
        return {"ok": False, "message": f"Install failed: {install_result['message']}", "device_id": device_id}

    # Launch app
    launch_result = await asyncio.to_thread(launch_app, device_id, package_name)
    if not launch_result["ok"]:
        return {"ok": False, "message": f"Launch failed: {launch_result['message']}", "device_id": device_id}

    return {"ok": True, "message": "Game launched on emulator", "device_id": device_id}


# ═══════════════════════════════════════════════════════════════
# Embedded SDK Management
# ═══════════════════════════════════════════════════════════════

def get_sdk_status() -> dict:
    """Check SDK installation status."""
    cmdline = os.path.isdir(CMDLINE_TOOLS_DIR) and os.path.isfile(
        os.path.join(CMDLINE_TOOLS_DIR, "bin", "sdkmanager.bat")
    )
    emulator = os.path.isfile(os.path.join(EMULATOR_DIR, "emulator.exe"))
    platform_tools = os.path.isfile(os.path.join(PLATFORM_TOOLS_DIR, "adb.exe"))
    sys_img_dir = os.path.join(SDK_DIR, "system-images", "android-34", "google_apis", "x86_64")
    system_image = os.path.isdir(sys_img_dir)
    avd_ini = os.path.join(AVD_DIR, f"{AVD_NAME}.ini")
    avd_exists = os.path.isfile(avd_ini)

    installed = cmdline and emulator and platform_tools and system_image and avd_exists

    return {
        "installed": installed,
        "cmdline_tools": cmdline,
        "emulator": emulator,
        "platform_tools": platform_tools,
        "system_image": system_image,
        "avd_exists": avd_exists,
        "emulator_running": is_emulator_running(),
    }


def is_sdk_installed() -> bool:
    """Check if SDK is fully installed."""
    return get_sdk_status()["installed"]


# --- SDK Setup Task ---

_active_sdk_setup: Optional["SdkSetupTask"] = None
_sdk_setup_lock = threading.Lock()


class SdkSetupTask:
    """Background SDK download and installation task."""

    def __init__(self):
        self.status: str = "pending"
        self.progress: float = 0.0
        self.step: str = ""
        self.step_detail: str = ""
        self.downloaded_bytes: int = 0
        self.total_bytes: int = 0
        self.speed_bps: float = 0.0
        self.eta_seconds: float = 0.0
        self.error: str | None = None
        self._cancel_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    def start(self):
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def cancel(self):
        self._cancel_event.set()

    def to_dict(self) -> dict:
        with self._lock:
            return {
                "status": self.status,
                "progress": round(self.progress, 1),
                "step": self.step,
                "step_detail": self.step_detail,
                "downloaded_bytes": self.downloaded_bytes,
                "total_bytes": self.total_bytes,
                "speed_bps": round(self.speed_bps),
                "eta_seconds": round(self.eta_seconds, 1),
                "error": self.error,
            }

    def _update(self, **kwargs):
        with self._lock:
            for k, v in kwargs.items():
                setattr(self, k, v)

    def _run(self):
        global _active_sdk_setup
        try:
            # Step 0: Check/Download JDK (0-15%)
            self._update(status="downloading", step="jdk", step_detail="Checking Java...")
            self._ensure_jdk()
            if self._cancel_event.is_set():
                self._update(status="cancelled")
                return

            # Step 1: Download cmdline-tools (15-40%)
            self._update(progress=15, step="cmdline-tools", step_detail="Downloading SDK tools...")
            self._download_cmdline_tools()
            if self._cancel_event.is_set():
                self._update(status="cancelled")
                return

            # Step 2: Accept licenses (40-45%)
            self._update(progress=40, status="installing_sdk", step="licenses", step_detail="Accepting licenses...")
            self._accept_licenses()
            if self._cancel_event.is_set():
                self._update(status="cancelled")
                return

            # Step 3: Install SDK packages (45-90%)
            self._update(progress=45, step="sdk_packages", step_detail="Installing SDK components...")
            self._install_sdk_packages()
            if self._cancel_event.is_set():
                self._update(status="cancelled")
                return

            # Step 4: Create AVD (90-100%)
            self._update(progress=90, status="creating_avd", step="avd", step_detail="Creating virtual device...")
            self._create_avd()
            if self._cancel_event.is_set():
                self._update(status="cancelled")
                return

            self._update(progress=100, status="completed", step="done", step_detail="Setup complete")
            logger.info("SDK setup completed successfully")

        except Exception as exc:
            self._update(status="failed", error=str(exc))
            logger.error("SDK setup failed: %s", exc)
        finally:
            def _cleanup():
                time.sleep(5)
                global _active_sdk_setup
                if _active_sdk_setup is self:
                    _active_sdk_setup = None
            if self.status in ("completed", "failed", "cancelled"):
                threading.Thread(target=_cleanup, daemon=True).start()

    def _ensure_jdk(self):
        """Check for Java, download portable JDK if missing."""
        if _find_java():
            self._update(progress=15, step_detail="Java found")
            logger.info("Java found: %s", _find_java())
            return

        self._update(step_detail="Downloading JDK 17...")
        os.makedirs(JDK_DIR, exist_ok=True)
        zip_path = os.path.join(JDK_DIR, "jdk.zip")

        try:
            with httpx.Client(timeout=httpx.Timeout(30.0, read=600.0), follow_redirects=True) as client:
                with client.stream("GET", JDK_URL) as resp:
                    if resp.status_code != 200:
                        raise RuntimeError(f"JDK download failed: HTTP {resp.status_code}")
                    total = int(resp.headers.get("content-length", 0))

                    downloaded = 0
                    with open(zip_path, "wb") as f:
                        for chunk in resp.iter_bytes(256 * 1024):
                            if self._cancel_event.is_set():
                                return
                            f.write(chunk)
                            downloaded += len(chunk)
                            if total > 0:
                                pct = (downloaded / total) * 15
                                self._update(progress=pct, step_detail=f"Downloading JDK... {downloaded * 100 // total}%")

            if self._cancel_event.is_set():
                return

            self._update(step_detail="Extracting JDK...")
            with zipfile.ZipFile(zip_path, "r") as zf:
                _safe_extractall(zf, JDK_DIR)
            os.remove(zip_path)

            java = _find_java()
            if not java:
                raise RuntimeError("JDK extraction succeeded but java.exe not found")
            logger.info("JDK installed: %s", java)

        except Exception:
            if os.path.exists(zip_path):
                try:
                    os.remove(zip_path)
                except OSError:
                    pass
            raise

    def _download_cmdline_tools(self):
        """Download and extract cmdline-tools ZIP."""
        # Skip if already extracted
        if os.path.isfile(os.path.join(CMDLINE_TOOLS_DIR, "bin", "sdkmanager.bat")):
            self._update(progress=40, step_detail="cmdline-tools already present")
            return

        os.makedirs(SDK_DIR, exist_ok=True)
        zip_path = os.path.join(SDK_DIR, "cmdline-tools.zip")

        try:
            with httpx.Client(timeout=httpx.Timeout(30.0, read=600.0), follow_redirects=True) as client:
                with client.stream("GET", CMDLINE_TOOLS_URL) as resp:
                    if resp.status_code != 200:
                        raise RuntimeError(f"cmdline-tools download failed: HTTP {resp.status_code}")
                    self.total_bytes = int(resp.headers.get("content-length", 0))

                    chunk_size = 256 * 1024
                    last_time = time.monotonic()
                    last_bytes = 0
                    speed_window: list[float] = []

                    with open(zip_path, "wb") as f:
                        for chunk in resp.iter_bytes(chunk_size):
                            if self._cancel_event.is_set():
                                return
                            f.write(chunk)
                            with self._lock:
                                self.downloaded_bytes += len(chunk)
                                if self.total_bytes > 0:
                                    # Progress: 15% ~ 40%
                                    self.progress = 15 + (self.downloaded_bytes / self.total_bytes) * 25

                            now = time.monotonic()
                            elapsed = now - last_time
                            if elapsed >= 0.5:
                                bytes_delta = self.downloaded_bytes - last_bytes
                                current_speed = bytes_delta / elapsed
                                speed_window.append(current_speed)
                                if len(speed_window) > 10:
                                    speed_window.pop(0)
                                avg_speed = sum(speed_window) / len(speed_window)
                                with self._lock:
                                    self.speed_bps = avg_speed
                                    remaining = self.total_bytes - self.downloaded_bytes
                                    self.eta_seconds = remaining / avg_speed if avg_speed > 0 else 0
                                last_time = now
                                last_bytes = self.downloaded_bytes

            if self._cancel_event.is_set():
                return

            # Extract
            self._update(step_detail="Extracting SDK tools...")
            cmdline_parent = os.path.join(SDK_DIR, "cmdline-tools")
            os.makedirs(cmdline_parent, exist_ok=True)

            with zipfile.ZipFile(zip_path, "r") as zf:
                _safe_extractall(zf, cmdline_parent)

            # Google packages as cmdline-tools/latest but zip extracts as cmdline-tools/
            # The zip contains a "cmdline-tools" folder at root
            extracted = os.path.join(cmdline_parent, "cmdline-tools")
            latest = os.path.join(cmdline_parent, "latest")
            if os.path.isdir(extracted) and not os.path.isdir(latest):
                os.rename(extracted, latest)

            os.remove(zip_path)

        except Exception:
            if os.path.exists(zip_path):
                try:
                    os.remove(zip_path)
                except OSError:
                    pass
            raise

    def _accept_licenses(self):
        """Auto-accept SDK licenses."""
        # Pre-write known license hashes — these are stable SHA-1 hashes for standard Android SDK licenses.
        # This avoids sdkmanager --licenses failures (known Windows issue: returns rc=1 even on success).
        self._write_license_files()

        sdkmanager = os.path.join(CMDLINE_TOOLS_DIR, "bin", "sdkmanager.bat")
        if not os.path.isfile(sdkmanager):
            raise FileNotFoundError(f"sdkmanager not found: {sdkmanager}")

        env = _sdk_env()
        proc = subprocess.run(
            [sdkmanager, "--licenses", f"--sdk_root={SDK_DIR}"],
            input="y\n" * 20,
            capture_output=True, text=True, timeout=120,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            env=env,
        )
        # sdkmanager --licenses often returns rc=1 on Windows even when licenses are already accepted.
        # We consider it a success if the license files exist on disk.
        if proc.returncode != 0:
            logger.warning("sdkmanager --licenses rc=%d (stderr: %s)", proc.returncode, proc.stderr[:300])
            if not self._licenses_accepted():
                raise RuntimeError(f"License acceptance failed (rc={proc.returncode}): {proc.stderr[:500]}")
            logger.info("License acceptance: rc=%d but license files present — treating as success", proc.returncode)
        else:
            logger.info("License acceptance: rc=%d", proc.returncode)

    @staticmethod
    def _write_license_files():
        """Pre-write standard Android SDK license hashes to avoid sdkmanager interactive prompts."""
        licenses_dir = Path(SDK_DIR) / "licenses"
        licenses_dir.mkdir(parents=True, exist_ok=True)
        # These SHA-1 values are the stable accepted-license hashes for the Android SDK.
        license_hashes = {
            "android-sdk-license": "\n24333f8a63b6825ea9c5514f83c2829b004d1fee\nd56f5187479451eabf01fb78af6dfcb131a6481e",
            "android-sdk-preview-license": "\n84831b9409646a918e30573bab4c9c91346d8abd",
            "intel-android-extra-license": "\nd975f751698a77b662f1254ddbeed3901e976f5a",
            "android-sdk-arm-dbt-license": "\n859f317696f67ef3d7f30a50a5560e7834b43903",
            "google-gdk-license": "\n33b6a2b64607f11b759f320ef9dff4ae5c47d97a",
        }
        for name, content in license_hashes.items():
            lic_file = licenses_dir / name
            if not lic_file.exists():
                lic_file.write_text(content, encoding="utf-8")

    @staticmethod
    def _licenses_accepted() -> bool:
        """Check if the main Android SDK license file exists."""
        return (Path(SDK_DIR) / "licenses" / "android-sdk-license").is_file()

    def _install_sdk_packages(self):
        """Install SDK packages via sdkmanager."""
        sdkmanager = os.path.join(CMDLINE_TOOLS_DIR, "bin", "sdkmanager.bat")
        env = _sdk_env()

        total_packages = len(SDK_PACKAGES)
        for i, pkg in enumerate(SDK_PACKAGES):
            if self._cancel_event.is_set():
                return

            base_progress = 45 + (i / total_packages) * 45
            self._update(progress=base_progress, step_detail=f"Installing {pkg}...")

            proc = subprocess.Popen(
                [sdkmanager, f"--sdk_root={SDK_DIR}", pkg],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, env=env,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )

            for line in iter(proc.stdout.readline, ""):
                if self._cancel_event.is_set():
                    proc.kill()
                    return
                line = line.strip()
                if line:
                    # Parse progress from sdkmanager output like "[====>   ] 50%"
                    if "%" in line:
                        try:
                            pct_str = line.split("%")[0].rsplit(" ", 1)[-1].strip()
                            pct = float(pct_str)
                            pkg_progress = base_progress + (pct / 100) * (45 / total_packages)
                            self._update(progress=pkg_progress, step_detail=f"{pkg}: {pct:.0f}%")
                        except (ValueError, IndexError):
                            pass

            proc.wait(timeout=600)
            if proc.returncode != 0:
                stderr = proc.stderr.read() if proc.stderr else ""
                logger.error("Package install failed (%s): %s", pkg, stderr[:500])
                raise RuntimeError(f"Package install failed ({pkg}): {stderr[:300]}")

    def _create_avd(self):
        """Create AVD using avdmanager."""
        avdmanager = os.path.join(CMDLINE_TOOLS_DIR, "bin", "avdmanager.bat")
        if not os.path.isfile(avdmanager):
            raise FileNotFoundError(f"avdmanager not found: {avdmanager}")

        os.makedirs(AVD_DIR, exist_ok=True)
        env = _sdk_env()

        # Delete existing AVD if present
        subprocess.run(
            [avdmanager, "delete", "avd", "-n", AVD_NAME],
            capture_output=True, text=True, timeout=30,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            env=env,
        )

        proc = subprocess.run(
            [avdmanager, "create", "avd",
             "-n", AVD_NAME,
             "-k", "system-images;android-34;google_apis;x86_64",
             "--device", "pixel_6",
             "--force"],
            input="no\n",
            capture_output=True, text=True, timeout=60,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            env=env,
        )
        if proc.returncode != 0:
            logger.error("AVD creation stderr: %s", proc.stderr)
            raise RuntimeError(f"AVD creation failed: {proc.stderr[:300]}")

        self._update(progress=100)


def start_sdk_setup() -> SdkSetupTask:
    """Start SDK setup in background. Returns the task."""
    global _active_sdk_setup
    with _sdk_setup_lock:
        if _active_sdk_setup and _active_sdk_setup.status in ("downloading", "installing_sdk", "creating_avd"):
            return _active_sdk_setup
        task = SdkSetupTask()
        _active_sdk_setup = task
    task.start()
    return task


def get_active_sdk_setup() -> Optional[SdkSetupTask]:
    """Get the currently active SDK setup task."""
    with _sdk_setup_lock:
        return _active_sdk_setup


def cancel_sdk_setup() -> bool:
    """Cancel active SDK setup."""
    with _sdk_setup_lock:
        if _active_sdk_setup and _active_sdk_setup.status not in ("completed", "failed", "cancelled"):
            _active_sdk_setup.cancel()
            return True
    return False


# --- Emulator Process Management ---

_emulator_process: Optional[subprocess.Popen] = None
_emulator_lock = threading.Lock()


def start_emulator() -> dict:
    """Start embedded emulator."""
    global _emulator_process

    with _emulator_lock:
        if _emulator_process and _emulator_process.poll() is None:
            return {"ok": True, "message": "Emulator already running", "pid": _emulator_process.pid}

        emulator_exe = os.path.join(EMULATOR_DIR, "emulator.exe")
        if not os.path.isfile(emulator_exe):
            return {"ok": False, "message": "Emulator not installed", "pid": 0}

        avd_ini = os.path.join(AVD_DIR, f"{AVD_NAME}.ini")
        if not os.path.isfile(avd_ini):
            return {"ok": False, "message": "AVD not created", "pid": 0}

        env = _sdk_env()

        try:
            _emulator_process = subprocess.Popen(
                [emulator_exe, "-avd", AVD_NAME,
                 "-gpu", "auto",
                 "-no-snapshot-save",
                 "-no-boot-anim",
                 "-memory", "2048"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                env=env,
            )
            return {"ok": True, "message": "Emulator starting", "pid": _emulator_process.pid}
        except Exception as e:
            return {"ok": False, "message": str(e), "pid": 0}


def stop_emulator() -> dict:
    """Stop embedded emulator."""
    global _emulator_process

    with _emulator_lock:
        if _emulator_process and _emulator_process.poll() is None:
            _emulator_process.terminate()
            try:
                _emulator_process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                _emulator_process.kill()
            _emulator_process = None
            return {"ok": True, "message": "Emulator stopped"}

        # Try adb emu kill as fallback
        adb = _find_adb()
        if adb:
            _run_adb(["emu", "kill"], adb_path=adb, timeout=10)

        _emulator_process = None
    return {"ok": True, "message": "Emulator stopped"}


def is_emulator_running() -> bool:
    """Check if embedded emulator process is running."""
    global _emulator_process
    with _emulator_lock:
        if _emulator_process and _emulator_process.poll() is None:
            return True
        _emulator_process = None
    return False


def wait_for_emulator_boot(timeout: int = 120) -> bool:
    """Wait for emulator to boot completely."""
    adb = _find_adb()
    if not adb:
        return False

    # Wait for device
    rc, _, _ = _run_adb(["wait-for-device"], adb_path=adb, timeout=timeout)
    if rc != 0:
        return False

    # Wait for boot_completed
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        rc, stdout, _ = _run_adb(
            ["shell", "getprop", "sys.boot_completed"],
            adb_path=adb, timeout=10,
        )
        if rc == 0 and stdout.strip() == "1":
            return True
        time.sleep(2)

    return False
