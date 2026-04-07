"""Bridge to ue_translator.py — imports the translation engine without modification."""

import importlib.util
import logging
import re
import sys
import os
import subprocess
import json
import random
from collections import defaultdict
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Lazy-loaded ue_translator module (deferred to avoid crash when tkinter is missing)
ue_translator = None
UE_TRANSLATOR_DIR = ""


def _get_ue_search_paths() -> list[str]:
    paths = [os.environ.get("UE_TRANSLATOR_PATH", "")]
    if getattr(sys, "frozen", False):
        _exe_dir = os.path.dirname(sys.executable)
        paths.append(os.path.join(_exe_dir, "ue-translator"))
        paths.append(os.path.join(os.path.dirname(_exe_dir), "ue-translator"))
    else:
        paths.append(
            os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "ue-translator")
        )
    paths.append(os.path.join(os.path.expanduser("~"), "ue-translator"))
    return paths


def _redirect_app_dir(mod):
    """Redirect ue_translator.APP_DIR to GT_DATA_DIR parent so extracted/ goes to APPDATA."""
    data_dir = os.environ.get("GT_DATA_DIR")
    if data_dir:
        # GT_DATA_DIR = .../게임번역기/data → parent = .../게임번역기/
        mod.APP_DIR = os.path.dirname(os.path.abspath(data_dir))
        logger.debug("Redirected ue_translator.APP_DIR to %s", mod.APP_DIR)


def _ensure_ue_translator():
    """Lazily import ue_translator on first use."""
    global ue_translator, UE_TRANSLATOR_DIR
    if ue_translator is not None:
        return

    for candidate in _get_ue_search_paths():
        if not candidate:
            continue
        p = os.path.join(candidate, "ue_translator.py")
        if os.path.isfile(p):
            try:
                spec = importlib.util.spec_from_file_location("ue_translator", p)
                mod = importlib.util.module_from_spec(spec)
                sys.modules["ue_translator"] = mod
                spec.loader.exec_module(mod)
            except Exception as e:
                logger.exception("Failed to load ue_translator from %s: %s", p, e)
                sys.modules.pop("ue_translator", None)
                raise RuntimeError(
                    f"ue_translator 모듈 로드 실패 ({type(e).__name__}): {e}\n경로: {p}"
                ) from e
            ue_translator = mod
            UE_TRANSLATOR_DIR = candidate
            _redirect_app_dir(mod)
            return

    # Fallback: add first existing candidate to sys.path
    for candidate in _get_ue_search_paths():
        if candidate and os.path.isdir(candidate):
            if candidate not in sys.path:
                sys.path.insert(0, candidate)
            break
    try:
        import ue_translator as _mod  # noqa: E402
    except Exception as e:
        logger.exception("Failed to import ue_translator from sys.path: %s", e)
        raise RuntimeError(
            f"ue_translator 모듈을 찾을 수 없습니다 ({type(e).__name__}): {e}"
        ) from e
    ue_translator = _mod
    UE_TRANSLATOR_DIR = os.path.dirname(ue_translator.__file__)
    _redirect_app_dir(ue_translator)

def _has_asar(game_path: str) -> Optional[str]:
    """Return app.asar path if it exists, else None."""
    asar_path = os.path.join(game_path, "resources", "app.asar")
    return asar_path if os.path.isfile(asar_path) else None


def _asar_extract(asar_path: str, dest_dir: str) -> bool:
    """Extract an asar archive to dest_dir. Returns True on success."""
    try:
        result = subprocess.run(
            ["npx", "asar", "extract", asar_path, dest_dir],
            capture_output=True, timeout=120, shell=True,
        )
        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace").strip()
            logger.warning("asar extract failed (rc=%d): %s", result.returncode, stderr)
            return False
        return True
    except FileNotFoundError:
        logger.warning("npx not found — cannot extract app.asar. Install Node.js.")
        return False
    except Exception as e:
        logger.warning("asar extract error: %s", e)
        return False


def _disable_asar(game_path: str):
    """Rename app.asar to app.asar.bak so Electron loads from app/ folder instead."""
    asar_path = os.path.join(game_path, "resources", "app.asar")
    bak_path = asar_path + ".bak"
    if os.path.isfile(asar_path) and not os.path.isfile(bak_path):
        os.rename(asar_path, bak_path)
        logger.info("Disabled app.asar → app.asar.bak")


def _restore_asar(game_path: str):
    """Restore app.asar.bak back to app.asar and remove app/ folder."""
    import shutil
    resources_dir = os.path.join(game_path, "resources")
    asar_path = os.path.join(resources_dir, "app.asar")
    bak_path = asar_path + ".bak"
    app_dir = os.path.join(resources_dir, "app")
    if os.path.isfile(bak_path):
        if os.path.isfile(asar_path):
            os.remove(asar_path)
        os.rename(bak_path, asar_path)
        if os.path.isdir(app_dir):
            shutil.rmtree(app_dir, ignore_errors=True)
        logger.info("Restored app.asar.bak → app.asar")


HTML_INDEX_CANDIDATES = ["index.html", "www/index.html", "game.html", "resources/app/index.html"]


def find_html_index(game_path: str) -> Optional[str]:
    """Return the path to an HTML game's entry file, or None."""
    root = Path(game_path)
    for candidate in HTML_INDEX_CANDIDATES:
        p = root / candidate
        if p.is_file():
            return str(p.relative_to(root))
    return None


def is_html_game(game_path: str) -> bool:
    """Check if the folder contains an HTML game (has index.html)."""
    return find_html_index(game_path) is not None


def _has_ue4_paks(game_path: str) -> bool:
    """Quick check for UE4/5 Content/Paks/*.pak structure."""
    import os
    game_path = os.path.normpath(game_path)
    for root, dirs, files in os.walk(game_path):
        depth = os.path.normpath(root).count(os.sep) - game_path.count(os.sep)
        if depth > 5:
            dirs.clear()
            continue
        if os.path.basename(root).lower() == "paks":
            if any(f.endswith('.pak') for f in files):
                return True
    return False


def detect_engine(game_path: str) -> Optional[dict]:
    """Detect game engine. Returns {name, engine_obj} or None."""
    import tempfile, shutil
    _ensure_ue_translator()

    # If app.asar exists without app/ folder, extract to temp dir for detection
    asar_path = _has_asar(game_path)
    app_dir = os.path.join(game_path, "resources", "app")
    if asar_path and not os.path.isdir(app_dir):
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a mirror structure: tmpdir/resources/app/
            tmp_resources = os.path.join(tmpdir, "resources", "app")
            if _asar_extract(asar_path, tmp_resources):
                # Copy non-resources parts (exe, etc.) as symlinks/refs aren't needed
                # Just detect on the tmpdir which has resources/app/
                engine = ue_translator.detect_engine(tmpdir)
                if engine is not None:
                    if engine.name == "Subtitle" and _has_ue4_paks(game_path):
                        ue4_obj = _get_engine_by_name("Unreal Engine 4/5")
                        if ue4_obj:
                            return {"name": "Unreal Engine 4/5", "engine": ue4_obj}
                    return {"name": engine.name, "engine": engine}
        # Extraction failed or no engine found in asar — fall through to normal detection

    engine = ue_translator.detect_engine(game_path)
    if engine is None:
        return None
    # Subtitle engine is too greedy (.txt matches everything).
    # If Subtitle was detected, double-check if a more specific engine (UE4) fits.
    if engine.name == "Subtitle":
        if _has_ue4_paks(game_path):
            ue4_obj = _get_engine_by_name("Unreal Engine 4/5")
            if ue4_obj:
                return {"name": "Unreal Engine 4/5", "engine": ue4_obj}
    result = {"name": engine.name, "engine": engine}
    # Mumu: 중첩 폴더에서 실제 게임 루트를 찾아 반환 (런처 경로 보정용)
    if engine.name == "Mumu Engine" and hasattr(engine, "_find_game_root"):
        real_root = engine._find_game_root(game_path)
        if real_root and os.path.normcase(real_root) != os.path.normcase(game_path):
            result["real_root"] = real_root
    return result


def scan_game(game_path: str, engine_name: str = None, aes_key: str = "") -> dict:
    """Scan game folder: detect engine, extract strings count.
    Returns {engine, resources, string_count}."""
    # If asar game, extract to temp and scan from there
    asar_path = _has_asar(game_path)
    app_dir = os.path.join(game_path, "resources", "app")
    if asar_path and not os.path.isdir(app_dir):
        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_resources = os.path.join(tmpdir, "resources", "app")
            if _asar_extract(asar_path, tmp_resources):
                return scan_game(tmpdir, engine_name=engine_name, aes_key=aes_key)

    if engine_name:
        engine_obj = _get_engine_by_name(engine_name, aes_key=aes_key)
        if engine_obj is None:
            raise ValueError(f"Unknown engine: {engine_name}")
    else:
        result = detect_engine(game_path)
        if result is None:
            raise ValueError("Could not detect game engine")
        engine_obj = result["engine"]
        engine_name = result["name"]
        # Set AES key on engine's repak if UE4/5
        if aes_key and hasattr(engine_obj, 'repak') and engine_obj.repak:
            engine_obj.repak.aes_key = aes_key

    resources = engine_obj.scan(game_path)
    total_strings = sum(r.get("string_count", 0) for r in resources)

    # Most engines don't provide string_count in scan results.
    # Fall back to extraction + add_entries filtering to get accurate count
    # (matches what extract_strings() in engine_bridge does for translation).
    if total_strings == 0 and resources:
        try:
            _ensure_ue_translator()
            project = ue_translator.TranslationProject()
            for res in resources:
                entries = engine_obj.extract_strings(game_path, res)
                project.add_entries(entries, japanese_only=True, source_lang="auto")
            total_strings = len(project.entries)
        except Exception as e:
            logger.exception("extract_strings failed for %s (engine=%s): %s", game_path, engine_name, e)
            total_strings = 0

    return {
        "engine": engine_name,
        "resources": resources,
        "string_count": total_strings,
    }


def extract_strings(game_path: str, engine_name: str, source_lang: str = "auto", aes_key: str = "") -> dict:
    """Extract all translatable strings from a game.
    Returns {entries: [{namespace, key, original}], project_json}."""
    # If asar game, extract to temp and work from there
    asar_path = _has_asar(game_path)
    app_dir = os.path.join(game_path, "resources", "app")
    if asar_path and not os.path.isdir(app_dir):
        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_resources = os.path.join(tmpdir, "resources", "app")
            if _asar_extract(asar_path, tmp_resources):
                return extract_strings(tmpdir, engine_name, source_lang, aes_key)

    engine_obj = _get_engine_by_name(engine_name, aes_key=aes_key)
    if engine_obj is None:
        raise ValueError(f"Unknown engine: {engine_name}")

    resources = engine_obj.scan(game_path)
    _ensure_ue_translator()
    project = ue_translator.TranslationProject()
    project.game_path = game_path
    project.engine_name = engine_name
    project.source_lang = source_lang

    skipped_resources = []
    for res in resources:
        try:
            entries = engine_obj.extract_strings(game_path, res)
            project.add_entries(entries, japanese_only=True, source_lang=source_lang)
        except Exception as e:
            res_name = res.get("name", res.get("path", "unknown"))
            logger.warning("extract_strings skipped %s: %s: %s", res_name, type(e).__name__, e)
            skipped_resources.append({"name": res_name, "error": str(e)})

    return {
        "entries": project.entries,
        "project": project,
        "string_count": len(project.entries),
        "skipped_resources": skipped_resources,
    }


def create_translator(provider: str, api_key: str, model: str = "",
                      source_lang: str = "auto"):
    """Create an AITranslator instance."""
    _ensure_ue_translator()
    # Pre-check provider dependencies for clear error messages
    _PKG_MAP = {"openai": "openai", "deepseek": "openai", "claude_api": "anthropic",
                "gemini": "google-genai"}
    pkg = _PKG_MAP.get(provider)
    if pkg:
        import_name = pkg.replace("-", ".")  # google-genai → google.genai
        try:
            __import__(import_name.split(".")[0])
        except ImportError:
            raise RuntimeError(
                f"{provider} 번역을 사용하려면 '{pkg}' 패키지가 필요합니다. "
                f"pip install {pkg} 로 설치해주세요."
            )
    translator = ue_translator.AITranslator(
        provider=provider,
        api_key=api_key,
        model=model,
    )
    translator.source_lang = source_lang
    return translator


def apply_translations_to_game(game_path: str, engine_name: str,
                               project, resources: list[dict], aes_key: str = "",
                               partial_ratio: float = 0.6) -> str:
    """Apply translated strings back to game files. Returns patch path.
    partial_ratio: fraction of strings to translate (0.0-1.0). Rest stay as original."""
    import shutil

    # ASAR game: extract → modify → repack → cleanup
    asar_path = _has_asar(game_path)
    app_dir = os.path.join(game_path, "resources", "app")
    asar_mode = asar_path and not os.path.isdir(app_dir)
    if asar_mode:
        logger.info("ASAR mode: extracting for translation apply")
        if not _asar_extract(asar_path, app_dir):
            raise RuntimeError("Failed to extract app.asar for translation")

    try:
        # After asar extraction, re-scan resources (caller's scan had empty paths)
        if asar_mode:
            engine_obj = _get_engine_by_name(engine_name, aes_key=aes_key)
            if engine_obj:
                resources = engine_obj.scan(game_path)
                logger.info("ASAR re-scan: %d resources found", len(resources))

        if not resources:
            raise RuntimeError("No resources found after ASAR extraction")

        patch_path = _apply_translations_inner(
            game_path, engine_name, project, resources, aes_key, partial_ratio
        )
        logger.info("Translation applied, patch_path=%s", patch_path)
    except Exception:
        # On failure, remove extracted app/ (original asar is untouched)
        if asar_mode and os.path.isdir(app_dir):
            shutil.rmtree(app_dir, ignore_errors=True)
        raise

    # Repack modified app/ → app.asar, then delete app/
    if asar_mode:
        result = subprocess.run(
            ["npx", "asar", "pack", app_dir, asar_path],
            capture_output=True, timeout=120, shell=True,
        )
        shutil.rmtree(app_dir, ignore_errors=True)
        if result.returncode != 0:
            raise RuntimeError("Failed to repack app.asar after translation")
        logger.info("ASAR repacked and app/ cleaned up")

    # ── restore.bat 자동 생성 ──
    _generate_restore_bat(game_path, engine_name, asar_mode)

    return patch_path


def _generate_restore_bat(game_path: str, engine_name: str, asar_mode: bool = False):
    """_translation_backup/restore.bat 생성. 롤백 시 이 BAT만 실행하면 됨."""
    backup_dir = os.path.join(game_path, "_translation_backup")
    os.makedirs(backup_dir, exist_ok=True)

    lines = [
        "@echo off",
        "chcp 65001 >nul",
        'echo [롤백] 원본 파일 복원 시작...',
        "",
    ]

    # 1) _translation_backup 안의 원본 파일 → 원래 위치로 복사
    meta_path = os.path.join(backup_dir, "_meta.json")
    if os.path.exists(meta_path):
        import json as _json
        try:
            with open(meta_path) as mf:
                target_dir = _json.load(mf).get("game_dir", game_path)
        except Exception:
            target_dir = game_path
    else:
        target_dir = game_path

    from pathlib import Path
    for bf in sorted(Path(backup_dir).iterdir()):
        if not bf.is_file() or bf.name in ("restore.bat", "_meta.json"):
            continue
        src = str(bf)
        dst = os.path.join(target_dir, bf.name)
        lines.append(f'copy /Y "{src}" "{dst}"')
        lines.append(f'echo   복원: {bf.name}')

    # 2) UE4 패치 PAK 삭제
    if "unreal" in engine_name.lower() or "ue4" in engine_name.lower():
        _ensure_ue_translator()
        try:
            engine_obj = _get_engine_by_name(engine_name)
            if engine_obj and hasattr(engine_obj, '_find_paks_dir'):
                paks_dir = engine_obj._find_paks_dir(game_path)
                if paks_dir:
                    for pak in sorted(Path(paks_dir).glob("*_P.pak")):
                        lines.append(f'del /F /Q "{pak}"')
                        lines.append(f'echo   삭제: {pak.name}')
        except Exception as e:
            logger.warning("restore.bat PAK detection failed: %s", e)

    # 3) ASAR 리패킹 (필요 시)
    if asar_mode:
        app_dir = os.path.join(game_path, "resources", "app")
        asar_path = os.path.join(game_path, "resources", "app.asar")
        lines.append(f'npx asar pack "{app_dir}" "{asar_path}"')
        lines.append(f'rmdir /S /Q "{app_dir}"')

    # 4) backup 폴더 정리 (start /b로 비동기 삭제 — 자기 폴더 삭제 시 에러 방지)
    lines.append("")
    lines.append('echo [롤백] 완료!')
    lines.append(f'start /b cmd /c "timeout /t 1 /nobreak >nul & rmdir /S /Q \"{backup_dir}\""')

    bat_path = os.path.join(backup_dir, "restore.bat")
    with open(bat_path, 'w', encoding='utf-8') as f:
        f.write("\r\n".join(lines) + "\r\n")
    logger.info("restore.bat generated at %s", bat_path)


def _apply_translations_inner(game_path: str, engine_name: str,
                               project, resources: list[dict], aes_key: str = "",
                               partial_ratio: float = 0.6) -> str:
    """Core translation apply logic (no ASAR handling)."""
    _ensure_ue_translator()
    engine_obj = _get_engine_by_name(engine_name, aes_key=aes_key)
    if engine_obj is None:
        raise ValueError(f"Unknown engine: {engine_name}")

    # UE4: special pak-based apply (engine raises NotImplementedError)
    if isinstance(engine_obj, ue_translator.UE4Engine):
        return _apply_ue4_patch_pak(game_path, engine_obj, project, resources, aes_key=aes_key)

    # Build translation dict from project
    original_namespaces = {}
    for res in resources:
        entries = engine_obj.extract_strings(game_path, res)
        for ns, key, value in entries:
            if ns not in original_namespaces:
                original_namespaces[ns] = {}
            original_namespaces[ns][key] = value

    translated_namespaces = project.build_translated_namespaces(original_namespaces)

    # Flatten: {ns: {key: value}} → {f"{ns}.{key}": value}
    flat_translations = {}
    for ns, keys in translated_namespaces.items():
        for key, value in keys.items():
            flat_translations[f"{ns}.{key}"] = value

    flat_originals = {}
    for ns, keys in original_namespaces.items():
        for key, value in keys.items():
            flat_originals[f"{ns}.{key}"] = value

    # Randomly keep only partial_ratio of translations (rest revert to original)
    if 0.0 < partial_ratio < 1.0 and len(flat_translations) > 1:
        all_keys = list(flat_translations.keys())
        keep_count = max(1, int(len(all_keys) * partial_ratio))
        keep_keys = set(random.sample(all_keys, keep_count))
        dropped = len(all_keys) - keep_count
        flat_translations = {k: v for k, v in flat_translations.items() if k in keep_keys}
        logger.info("Partial translation: kept %d/%d strings (ratio=%.0f%%), dropped %d",
                     keep_count, len(all_keys), partial_ratio * 100, dropped)

    patch_path = engine_obj.apply_translations(
        game_path, flat_translations, flat_originals
    )
    return patch_path


def _apply_ue4_patch_pak(game_path: str, engine_obj, project, resources: list[dict], aes_key: str = "") -> str:
    """UE4-specific: create a patch _P.pak with translated .locres."""
    import tempfile

    repak = _create_repak(aes_key=aes_key)
    if not repak.available:
        repak.download()
    if not repak.available:
        raise RuntimeError("repak.exe not available. Cannot create patch pak.")

    # Find Paks directory
    paks_dir = None
    for root_dir, dirs, files in os.walk(game_path):
        if os.path.basename(root_dir).lower() == "paks":
            paks_dir = root_dir
            break
    if not paks_dir:
        for subpath in ["Content/Paks"]:
            test = os.path.join(game_path, subpath)
            if os.path.isdir(test):
                paks_dir = test
                break
    if not paks_dir:
        raise RuntimeError("Content/Paks folder not found")

    # Find base (non-patch) pak
    base_paks = [p for p in Path(paks_dir).glob("*.pak") if "_P.pak" not in p.name]
    if not base_paks:
        raise RuntimeError("No base .pak file found in Paks directory")
    base_pak_path = str(base_paks[0])

    # Get locres files from base pak (filter out Engine/Plugin internals)
    all_locres = repak.get_locres_files(base_pak_path)
    if not all_locres:
        raise RuntimeError("No .locres files found in base pak")

    # Keep only game locres (exclude Engine/, Plugins/)
    game_locres = [f for f in all_locres
                   if not f.replace("\\", "/").startswith(("Engine/", "../../../Engine/"))]
    if not game_locres:
        game_locres = all_locres  # fallback

    # Pick source locres (prefer source language folder, then ja, then first)
    src_lang = getattr(project, 'source_lang', None) or 'ja'
    if src_lang == 'auto':
        src_lang = 'ja'

    def _match_lang_folder(path: str, lang: str) -> bool:
        """Match exact language folder component (not substring)."""
        parts = path.replace("\\", "/").split("/")
        return lang in parts

    preferred = [f for f in game_locres if _match_lang_folder(f, src_lang)]
    if not preferred and src_lang != 'ja':
        preferred = [f for f in game_locres if _match_lang_folder(f, 'ja')]
    if not preferred:
        # Last resort: substring match for non-standard folder structures
        preferred = [f for f in game_locres if f"/{src_lang}/" in f.replace("\\", "/")]
    source_locres_rel = preferred[0] if preferred else game_locres[0]
    logger.info("Using locres: %s (src_lang=%s, candidates=%s)",
                source_locres_rel, src_lang, [f.replace("\\", "/") for f in game_locres])

    # Extract and parse original locres
    with tempfile.TemporaryDirectory() as extract_dir:
        extracted_path = repak.extract_file(base_pak_path, source_locres_rel, extract_dir)
        parser = ue_translator.LocresParser()
        parser.parse(extracted_path)
        original_namespaces = parser.namespaces

    # Build translated namespaces from project
    translated_ns = project.build_translated_namespaces(original_namespaces)

    # Strip mount point prefix (../ paths) for safe file creation
    def _strip_mount(p: str) -> str:
        p = p.replace("\\", "/")
        while p.startswith("../"):
            p = p[3:]
        return p.lstrip("/")

    ko_rel_path = _strip_mount(source_locres_rel)

    with tempfile.TemporaryDirectory() as tmpdir:
        # Write translated .locres
        locres_out = os.path.join(tmpdir, ko_rel_path)
        os.makedirs(os.path.dirname(locres_out), exist_ok=True)
        parser.write(locres_out, translated_ns)
        logger.info("Wrote translated locres: %s (%d bytes)", ko_rel_path, os.path.getsize(locres_out))

        # Korean font replacement (prevent transparent text)
        try:
            font_mgr = ue_translator.FontManager(os.path.join(UE_TRANSLATOR_DIR, "tools"))
            # Collect translated characters for subset
            all_chars = set()
            for ns_keys in translated_ns.values():
                for text in ns_keys.values():
                    if text:
                        all_chars.update(text)
            font_count = font_mgr.prepare_font_files(
                repak, base_pak_path, all_chars, tmpdir,
                progress_callback=lambda msg: logger.info("[font] %s", msg),
            )
            if font_count > 0:
                logger.info("Replaced %d CJK fonts with Korean subset fonts", font_count)
        except Exception as e:
            logger.warning("Font replacement failed (non-fatal): %s", e)

        # Remove old translation patch paks (those containing locres)
        existing_patches = sorted(Path(paks_dir).glob("*_P.pak"))
        for p in existing_patches:
            try:
                files = repak.list_files(str(p))
                if any(f.endswith(".locres") for f in files):
                    p.unlink()
                    logger.info("Removed old translation pak: %s", p.name)
            except Exception:
                pass

        # Determine next patch number
        remaining = list(Path(paks_dir).glob("*_P.pak"))
        patch_nums = []
        for p in remaining:
            match = re.search(r'_(\d+)_P\.pak$', p.name)
            if match:
                patch_nums.append(int(match.group(1)))
        next_num = max(patch_nums, default=0) + 1

        base_name = base_paks[0].stem
        patch_pak_name = f"{base_name}_{next_num}_P.pak"
        patch_pak_path = os.path.join(paks_dir, patch_pak_name)

        # Pack with version/compression matching
        repak.pack(tmpdir, patch_pak_path, match_pak=base_pak_path)

        # Verify
        packed_files = repak.list_files(patch_pak_path)
        has_locres = any(f.endswith(".locres") for f in packed_files)
        if not has_locres:
            raise RuntimeError("Patch pak created but contains no .locres file")

        # Sanity check: patch should be reasonably sized (at least 1KB)
        patch_size = os.path.getsize(patch_pak_path)
        if patch_size < 1024:
            logger.warning("Patch pak suspiciously small: %d bytes — translation may not have been applied", patch_size)

        file_size = os.path.getsize(patch_pak_path)
        logger.info("Created patch pak: %s (%d bytes, %d files)", patch_pak_name, file_size, len(packed_files))

    return patch_pak_path


def create_backup(game_path: str):
    """Create a BackupManager for the game."""
    _ensure_ue_translator()
    backup_dir = os.path.join(game_path, "_translator_backups")
    return ue_translator.BackupManager(backup_dir)


def find_game_exe(game_path: str) -> Optional[str]:
    """Find the main executable in a game folder."""
    game_dir = Path(game_path)
    exe_files = list(game_dir.glob("*.exe"))

    # Filter out known non-game executables
    skip_names = {"unins000", "uninst", "setup", "config", "launcher",
                  "updater", "crashreport", "crashhandler", "ue4prereqsetup",
                  "dxsetup"}
    candidates = []
    for exe in exe_files:
        stem_lower = exe.stem.lower()
        if not any(skip in stem_lower for skip in skip_names):
            candidates.append(exe)

    if not candidates:
        return None

    # Prefer largest exe (usually the main game)
    candidates.sort(key=lambda p: p.stat().st_size, reverse=True)
    return str(candidates[0])


def launch_game(exe_path: str) -> None:
    """Launch game executable."""
    kwargs: dict = {"cwd": str(Path(exe_path).parent)}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen([exe_path], **kwargs)


LANG_FOLDER_MAP = {
    "english": "EN", "japanese": "JA", "korean": "KO", "chinese": "ZH",
    "french": "FR", "german": "DE", "spanish": "ES", "portuguese": "PT",
    "russian": "RU", "italian": "IT", "thai": "TH",
    "en": "EN", "ja": "JA", "jp": "JA", "ko": "KO", "kr": "KO",
    "zh": "ZH", "cn": "ZH", "fr": "FR", "de": "DE", "es": "ES",
}

# Directories that are never games (asset/data folders)
_SKIP_DIRS = frozenset({
    "data", "save", "saves", "backup", "backups", "_translator_backups",
    "__pycache__", ".git", "node_modules", "lib", "libs", "plugin", "plugins",
    "patch", "patches", "dlc", "update", "updates", "manual", "readme",
    "docs", "documentation", "tools", "tool", "system", "audio", "video",
    "movie", "movies", "bgm", "se", "img", "picture", "graphics",
    "www", "fonts", "icon", "css", "js",
})

# Regex to strip version suffixes: _v1.4.1, _ver1.0, _Ver_0_5_2, ver1.1, v1.0
_VERSION_RE = re.compile(
    r'[_\s.\-]?v(?:er)?[_\s.]?[\d]+(?:[._]\d+)*$', re.IGNORECASE
)


def _strip_version(name: str) -> tuple[str, str]:
    """Strip version suffix from game name. Returns (base_name, version_str)."""
    match = _VERSION_RE.search(name)
    if match:
        base = name[:match.start()].rstrip('_- .')
        ver = match.group().lstrip('_- .')
        return (base, ver) if base else (name, "")
    return name, ""


def _parse_version(ver_str: str) -> tuple[int, ...]:
    """Parse version string into comparable tuple."""
    if not ver_str:
        return (0,)
    nums = re.findall(r'\d+', ver_str)
    return tuple(int(n) for n in nums) if nums else (0,)


def scan_directory_for_games(root_path: str, max_depth: int = 5) -> list[dict]:
    """Scan a directory recursively for game folders (up to max_depth levels).
    Stops descending into a folder once a game engine is detected there.
    Deduplicates version variants, keeping only the latest version."""
    root = Path(root_path)
    if not root.is_dir():
        return []

    games: list[dict] = []
    found_paths: set[str] = set()

    def _make_entry(entry: Path, exe_path: str, engine: str, **extra) -> dict:
        """Create a game entry dict, detecting language variant from folder name."""
        name_lower = entry.name.lower()
        lang = LANG_FOLDER_MAP.get(name_lower)
        title = entry.parent.name if lang else entry.name
        result = {
            "title": title,
            "path": str(entry),
            "exe_path": exe_path,
            "engine": engine,
        }
        if lang:
            result["variant_lang"] = lang
        result.update(extra)
        return result

    def _scan(directory: Path, depth: int):
        if depth > max_depth:
            return
        try:
            entries = sorted(directory.iterdir())
        except PermissionError:
            return

        # Detect APK files in current directory
        for entry in entries:
            if entry.is_file() and entry.suffix.lower() == ".apk":
                apk_path = str(entry)
                if apk_path not in found_paths:
                    games.append({
                        "title": entry.stem,
                        "path": apk_path,
                        "exe_path": "",
                        "engine": "",
                        "platform": "android",
                    })
                    found_paths.add(apk_path)

        for entry in entries:
            if not entry.is_dir():
                continue

            # Skip known non-game directories
            if entry.name.lower() in _SKIP_DIRS:
                continue

            game_path = str(entry)
            if game_path in found_paths:
                continue
            try:
                result = detect_engine(game_path)
                if result:
                    exe_path = find_game_exe(game_path)
                    has_subdirs = any(
                        e.is_dir() for e in entry.iterdir()
                        if e.name.lower() not in _SKIP_DIRS
                    )
                    # If engine detected but no exe and has subdirs,
                    # this is likely a collection folder — descend into it
                    if not exe_path and not is_html_game(game_path) and has_subdirs:
                        _scan(entry, depth + 1)
                        continue
                    games.append(_make_entry(entry, exe_path or "", result["name"]))
                    found_paths.add(game_path)
                    continue
            except Exception:
                pass
            # Fallback: check for HTML game (index.html)
            if is_html_game(game_path):
                games.append(_make_entry(entry, "", "HTML"))
                found_paths.add(game_path)
                continue
            # Fallback: exe exists → register as unknown engine
            exe_path = find_game_exe(game_path)
            if exe_path:
                games.append(_make_entry(entry, exe_path, ""))
                found_paths.add(game_path)
                continue
            # Not a game — recurse deeper
            _scan(entry, depth + 1)

    _scan(root, 1)

    # --- Remove collection folders: if game A contains game B, A is just a wrapper ---
    all_paths = [Path(g["path"]) for g in games]
    collection_paths: set[str] = set()
    for i, g in enumerate(games):
        gp = all_paths[i]
        for j, other in enumerate(all_paths):
            if i != j:
                try:
                    other.relative_to(gp)
                    collection_paths.add(g["path"])
                    break
                except ValueError:
                    pass
    if collection_paths:
        games = [g for g in games if g["path"] not in collection_paths]

    # --- Deduplicate version variants: keep only the latest version ---
    groups: dict[str, list[tuple[dict, str]]] = defaultdict(list)
    for game in games:
        base, ver = _strip_version(game["title"])
        # Group by (base_name_lower, variant_lang) so language variants stay separate
        key = (base.lower(), game.get("variant_lang", ""))
        groups[key].append((game, ver))

    deduped: list[dict] = []
    for _key, entries in groups.items():
        if len(entries) == 1:
            game = entries[0][0]
        else:
            # Sort by version descending, keep the latest
            entries.sort(key=lambda x: _parse_version(x[1]), reverse=True)
            game = entries[0][0]
        # Always strip version suffix from title
        base, _ = _strip_version(game["title"])
        if base:
            game["title"] = base
        deduped.append(game)

    return deduped


# --- Internal helpers ---

_ENGINE_MAP: dict[str, type] = {}


def _create_repak(aes_key: str = "") -> "ue_translator.RepakManager":
    """Create a RepakManager pointing at the ue-translator tools directory."""
    _ensure_ue_translator()
    tools_dir = os.path.join(UE_TRANSLATOR_DIR, "tools")
    repak = ue_translator.RepakManager(tools_dir)
    if aes_key:
        repak.aes_key = aes_key
    return repak


def find_aes_key(game_path: str) -> Optional[str]:
    """AESDumpster로 게임 exe에서 AES 키 후보를 추출하고, repak으로 유효한 키를 찾는다.
    Returns hex key string (without 0x) or None."""
    _ensure_ue_translator()
    tools_dir = os.path.join(UE_TRANSLATOR_DIR, "tools")
    aesdumpster = os.path.join(tools_dir, "AESDumpster.exe")

    if not os.path.isfile(aesdumpster):
        logger.warning("AESDumpster.exe not found at %s", aesdumpster)
        return None

    # Find Shipping exe (deep search) — AES key is in the actual game binary, not the launcher
    exe_path = None
    for root, dirs, files in os.walk(game_path):
        for f in files:
            if f.lower().endswith("-shipping.exe") or f.lower().endswith("_shipping.exe"):
                exe_path = os.path.join(root, f)
                break
        if exe_path:
            break
    if not exe_path:
        exe_path = find_game_exe(game_path)
    if not exe_path:
        logger.warning("No game exe found in %s", game_path)
        return None

    # Find a .pak file to test against
    pak_file = None
    for root, dirs, files in os.walk(game_path):
        depth = os.path.normpath(root).count(os.sep) - os.path.normpath(game_path).count(os.sep)
        if depth > 5:
            dirs.clear()
            continue
        for f in files:
            if f.endswith('.pak'):
                pak_file = os.path.join(root, f)
                break
        if pak_file:
            break
    if not pak_file:
        logger.warning("No .pak file found in %s", game_path)
        return None

    # Run AESDumpster to extract key candidates
    try:
        result = subprocess.run(
            [aesdumpster, exe_path],
            capture_output=True, timeout=120,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        stdout = result.stdout.decode('utf-8', errors='replace')
    except Exception as e:
        logger.exception("AESDumpster failed: %s", e)
        return None

    # Parse hex keys from output (64-char hex strings = 256-bit AES keys)
    candidates = re.findall(r'0x([0-9A-Fa-f]{64})\b', stdout)
    if not candidates:
        # Also try without 0x prefix
        candidates = re.findall(r'\b([0-9A-Fa-f]{64})\b', stdout)
    if not candidates:
        logger.info("AESDumpster found no AES key candidates for %s", exe_path)
        return None

    logger.info("AESDumpster found %d key candidate(s) for %s", len(candidates), exe_path)

    # Try each candidate with repak
    repak = _create_repak()
    if not repak.available:
        repak.download()
    if not repak.available:
        logger.warning("repak not available, cannot verify AES keys")
        return None

    for key in candidates:
        key_hex = f"0x{key.upper()}"
        try:
            test_result = subprocess.run(
                [str(repak.repak_path), "--aes-key", key_hex, "list", pak_file],
                capture_output=True, timeout=30,
                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
            )
            if test_result.returncode == 0:
                out = test_result.stdout.decode('utf-8', errors='replace').strip()
                if out and len(out.split('\n')) > 0:
                    logger.info("Found valid AES key: %s...%s", key[:8], key[-8:])
                    return key.upper()
        except Exception:
            continue

    logger.info("No valid AES key found among %d candidates", len(candidates))
    return None


def _build_engine_map():
    global _ENGINE_MAP
    if _ENGINE_MAP:
        return
    _ensure_ue_translator()
    for cls in ue_translator.ENGINE_REGISTRY:
        try:
            obj = cls() if cls != ue_translator.UE4Engine else cls(_create_repak())
            _ENGINE_MAP[obj.name.lower()] = cls
        except Exception as e:
            logger.warning("Failed to register engine %s: %s", cls.__name__, e)


def _get_engine_by_name(name: str, aes_key: str = ""):
    _build_engine_map()
    cls = _ENGINE_MAP.get(name.lower())
    if cls is None:
        # Try partial match
        for key, val in _ENGINE_MAP.items():
            if name.lower() in key:
                cls = val
                break
    if cls is None:
        return None
    try:
        if cls == ue_translator.UE4Engine:
            return cls(_create_repak(aes_key=aes_key))
        return cls()
    except Exception as e:
        logger.exception("Failed to instantiate engine %s: %s", name, e)
        return None


class FallbackTranslator:
    """Wraps a primary translator with fallback providers."""

    def __init__(self, primary, fallback_configs: list[dict]):
        self.primary = primary
        self.fallback_configs = fallback_configs  # [{provider, api_key, model?}]
        self._active = primary
        self.source_lang = getattr(primary, 'source_lang', 'auto')

    def _call_api(self, user_prompt: str, system_prompt: str) -> str:
        # Try active (primary or previously successful fallback)
        try:
            return self._active._call_api(user_prompt, system_prompt)
        except Exception as primary_err:
            logger.warning("Primary translator failed: %s, trying fallbacks...", primary_err)

        # Try fallbacks in order
        for config in self.fallback_configs:
            try:
                fb = create_translator(
                    provider=config["provider"],
                    api_key=config["api_key"],
                    model=config.get("model", ""),
                    source_lang=self.source_lang,
                )
                result = fb._call_api(user_prompt, system_prompt)
                # Success — promote this fallback to active for subsequent calls
                self._active = fb
                logger.info("Fallback to %s succeeded, using as primary", config["provider"])
                return result
            except Exception as fb_err:
                logger.warning("Fallback %s also failed: %s", config["provider"], fb_err)
                continue

        raise RuntimeError("All translation providers failed (primary + all fallbacks)")
