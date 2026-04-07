"""Agent tools — sandboxed file/engine operations for the AI agent.

Every path argument is validated to stay within the game directory.
"""

import configparser
import csv
import io
import json
import logging
import os
import re
import struct
import xml.etree.ElementTree as ET
from fnmatch import fnmatch
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Path security
# ---------------------------------------------------------------------------

def _safe_path(game_path: str, rel: str) -> str:
    """Resolve *rel* under *game_path* and reject traversal."""
    base = os.path.normpath(os.path.abspath(game_path))
    target = os.path.normpath(os.path.join(base, rel))
    if not target.startswith(base + os.sep) and target != base:
        raise ValueError(f"Path escapes game directory: {rel}")
    return target


# ---------------------------------------------------------------------------
# Tool definitions (Claude tool_use schema)
# ---------------------------------------------------------------------------

TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "name": "list_files",
        "description": "List files/directories under a path (relative to game root). Use pattern (glob) to filter. Returns up to 200 entries.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative directory path (default: root)", "default": "."},
                "pattern": {"type": "string", "description": "Glob pattern (e.g. '*.json', '**/*.txt')", "default": "*"},
            },
            "required": [],
        },
    },
    {
        "name": "read_file",
        "description": "Read a file. Text files return content (UTF-8/Shift-JIS auto-detect). Binary files return hex dump. Max 32 KB.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative file path"},
                "encoding": {"type": "string", "description": "Force encoding (utf-8, shift_jis, etc.). Auto-detect if omitted.", "default": ""},
                "offset": {"type": "integer", "description": "Byte offset to start reading", "default": 0},
                "limit": {"type": "integer", "description": "Max bytes to read (max 32768)", "default": 32768},
            },
            "required": ["path"],
        },
    },
    {
        "name": "detect_engine",
        "description": "Detect the game engine using the built-in engine detection system.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "scan_game",
        "description": "Scan the game using the built-in scanner for a specific engine. Returns resource list and string counts.",
        "input_schema": {
            "type": "object",
            "properties": {
                "engine": {"type": "string", "description": "Engine name to use for scanning (e.g. 'rpg maker mv/mz', 'wolf rpg')"},
            },
            "required": ["engine"],
        },
    },
    {
        "name": "extract_strings",
        "description": "Extract translatable strings using the built-in extractor for a specific engine.",
        "input_schema": {
            "type": "object",
            "properties": {
                "engine": {"type": "string", "description": "Engine name"},
            },
            "required": ["engine"],
        },
    },
    {
        "name": "try_parse",
        "description": "Try to parse a file using a specific method. Useful for unknown/custom formats.",
        "input_schema": {
            "type": "object",
            "properties": {
                "file_path": {"type": "string", "description": "Relative file path"},
                "method": {
                    "type": "string",
                    "enum": ["json", "xml", "csv", "ini", "binary_pattern", "regex"],
                    "description": "Parsing method",
                },
                "params": {
                    "type": "object",
                    "description": "Method-specific params. regex: {pattern, flags?}. binary_pattern: {pattern (hex), context_bytes?}. csv: {delimiter?, encoding?}",
                    "default": {},
                },
            },
            "required": ["file_path", "method"],
        },
    },
    {
        "name": "save_strings",
        "description": (
            "Save extracted translatable strings to the app database. "
            "Use this after you have identified and collected strings from the game files. "
            "Each entry needs at least 'original' (the source text). "
            "Optional fields: 'file' (source file path), 'tag' (category like dialogue/ui/system), "
            "'context' (surrounding context for better translation)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "strings": {
                    "type": "array",
                    "description": "Array of string entries to save",
                    "items": {
                        "type": "object",
                        "properties": {
                            "original": {"type": "string", "description": "Original source text"},
                            "file": {"type": "string", "description": "Source file path (relative)", "default": ""},
                            "tag": {"type": "string", "description": "Category tag (dialogue, ui, system, item, skill, etc.)", "default": ""},
                            "context": {"type": "string", "description": "Context for translation", "default": ""},
                        },
                        "required": ["original"],
                    },
                },
                "append": {
                    "type": "boolean",
                    "description": "If true, append to existing strings. If false, replace all. Default: true.",
                    "default": True,
                },
            },
            "required": ["strings"],
        },
    },
    {
        "name": "start_translation",
        "description": (
            "Start translating the saved strings using the app's translation pipeline. "
            "Call this AFTER save_strings. The translation runs in the background. "
            "You must specify the target language. The source language is auto-detected. "
            "The translation uses the same API key and provider you are running on."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "target_lang": {
                    "type": "string",
                    "description": "Target language code (ko, en, zh, etc.)",
                    "default": "ko",
                },
                "source_lang": {
                    "type": "string",
                    "description": "Source language code (auto, ja, en, zh, etc.)",
                    "default": "auto",
                },
            },
            "required": [],
        },
    },
]


# ---------------------------------------------------------------------------
# OpenAI function calling format
# ---------------------------------------------------------------------------

def _claude_to_openai(tool: dict) -> dict:
    """Convert Claude tool_use schema to OpenAI function calling format."""
    return {
        "type": "function",
        "function": {
            "name": tool["name"],
            "description": tool["description"],
            "parameters": tool["input_schema"],
        },
    }


TOOL_DEFINITIONS_OPENAI = [_claude_to_openai(t) for t in TOOL_DEFINITIONS]


# ---------------------------------------------------------------------------
# Gemini function declarations format
# ---------------------------------------------------------------------------

def _claude_to_gemini(tool: dict) -> dict:
    """Convert Claude tool_use schema to Gemini function declaration format."""
    schema = tool["input_schema"].copy()
    # Gemini doesn't support "default" at property level in all cases, keep it simple
    return {
        "name": tool["name"],
        "description": tool["description"],
        "parameters": schema,
    }


TOOL_DEFINITIONS_GEMINI = [_claude_to_gemini(t) for t in TOOL_DEFINITIONS]


# ---------------------------------------------------------------------------
# Tool execution
# ---------------------------------------------------------------------------

MAX_READ_BYTES = 32768  # 32 KB
MAX_LIST_ENTRIES = 200


async def execute_tool(name: str, args: dict, game_path: str, game_id: int = 0,
                       agent_context: dict | None = None) -> dict[str, Any]:
    """Execute a tool and return the result dict.

    agent_context: optional dict with api_key, provider, model for tools that
    need to interact with external services (e.g. start_translation).
    """
    try:
        if name == "list_files":
            return _list_files(game_path, args.get("path", "."), args.get("pattern", "*"))
        elif name == "read_file":
            return _read_file(
                game_path,
                args["path"],
                args.get("encoding", ""),
                args.get("offset", 0),
                min(args.get("limit", MAX_READ_BYTES), MAX_READ_BYTES),
            )
        elif name == "detect_engine":
            return await _detect_engine(game_path)
        elif name == "scan_game":
            return await _scan_game(game_path, args["engine"])
        elif name == "extract_strings":
            return await _extract_strings(game_path, args["engine"])
        elif name == "try_parse":
            return _try_parse(game_path, args["file_path"], args["method"], args.get("params", {}))
        elif name == "save_strings":
            return await _save_strings(game_id, args.get("strings", []), args.get("append", True))
        elif name == "start_translation":
            return await _start_translation(
                game_id, agent_context or {},
                args.get("source_lang", "auto"), args.get("target_lang", "ko"),
            )
        else:
            return {"error": f"Unknown tool: {name}"}
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        logger.exception("Tool %s failed", name)
        return {"error": f"{type(e).__name__}: {e}"}


# ---------------------------------------------------------------------------
# list_files
# ---------------------------------------------------------------------------

def _list_files(game_path: str, rel_dir: str, pattern: str) -> dict:
    target = _safe_path(game_path, rel_dir)
    if not os.path.isdir(target):
        return {"error": f"Not a directory: {rel_dir}"}

    entries: list[dict] = []
    try:
        for entry in os.scandir(target):
            if not fnmatch(entry.name, pattern):
                continue
            rel = os.path.relpath(entry.path, game_path).replace("\\", "/")
            info: dict[str, Any] = {"name": entry.name, "path": rel, "is_dir": entry.is_dir()}
            if not entry.is_dir():
                try:
                    info["size"] = entry.stat().st_size
                except OSError:
                    info["size"] = -1
            entries.append(info)
            if len(entries) >= MAX_LIST_ENTRIES:
                break
    except PermissionError:
        return {"error": f"Permission denied: {rel_dir}"}

    entries.sort(key=lambda e: (not e["is_dir"], e["name"].lower()))
    return {"entries": entries, "count": len(entries), "truncated": len(entries) >= MAX_LIST_ENTRIES}


# ---------------------------------------------------------------------------
# read_file
# ---------------------------------------------------------------------------

_TEXT_EXTENSIONS = {
    ".txt", ".json", ".xml", ".csv", ".ini", ".cfg", ".yaml", ".yml",
    ".lua", ".rb", ".py", ".js", ".ts", ".html", ".css", ".md",
    ".ks", ".asd", ".scn", ".rpyc", ".rpy", ".nut", ".hx",
    ".toml", ".properties", ".strings", ".lsd", ".lmt",
}


def _read_file(game_path: str, rel_path: str, encoding: str, offset: int, limit: int) -> dict:
    target = _safe_path(game_path, rel_path)
    if not os.path.isfile(target):
        return {"error": f"File not found: {rel_path}"}

    file_size = os.path.getsize(target)
    ext = os.path.splitext(rel_path)[1].lower()
    is_text = ext in _TEXT_EXTENSIONS

    with open(target, "rb") as f:
        if offset > 0:
            f.seek(offset)
        raw = f.read(limit)

    if not raw:
        return {"content": "", "size": file_size, "encoding": "empty"}

    # Auto-detect text
    if is_text or (not encoding and _looks_like_text(raw)):
        enc = encoding or _detect_encoding(raw)
        try:
            text = raw.decode(enc, errors="replace")
            return {"content": text, "size": file_size, "encoding": enc, "offset": offset, "bytes_read": len(raw)}
        except Exception:
            pass

    # Binary → hex dump
    hex_lines = []
    for i in range(0, len(raw), 16):
        chunk = raw[i:i + 16]
        hex_part = " ".join(f"{b:02x}" for b in chunk)
        ascii_part = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
        hex_lines.append(f"{offset + i:08x}  {hex_part:<48s}  {ascii_part}")
    return {"hex": "\n".join(hex_lines), "size": file_size, "offset": offset, "bytes_read": len(raw)}


def _looks_like_text(data: bytes) -> bool:
    if not data:
        return True
    # Check if most bytes are printable or common control chars
    text_bytes = sum(1 for b in data[:512] if b >= 32 or b in (9, 10, 13))
    return text_bytes / min(len(data), 512) > 0.7


def _detect_encoding(data: bytes) -> str:
    if data[:3] == b"\xef\xbb\xbf":
        return "utf-8-sig"
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return "utf-16"
    # Try UTF-8 first
    try:
        data[:4096].decode("utf-8")
        return "utf-8"
    except UnicodeDecodeError:
        pass
    # Likely Shift-JIS (Japanese games)
    return "shift_jis"


# ---------------------------------------------------------------------------
# detect_engine / scan_game / extract_strings — wrappers around engine_bridge
# ---------------------------------------------------------------------------

async def _detect_engine(game_path: str) -> dict:
    try:
        from ..engine_bridge import detect_engine
        result = detect_engine(game_path)
        return {"engine": result or "unknown"}
    except Exception as e:
        return {"error": f"Engine detection failed: {e}"}


async def _scan_game(game_path: str, engine: str) -> dict:
    try:
        from ..engine_bridge import scan_game
        result = scan_game(game_path, engine)
        if result is None:
            return {"error": "Scan returned no results"}
        return {"resources": result.get("resources", []), "string_count": result.get("string_count", 0)}
    except Exception as e:
        return {"error": f"Scan failed: {e}"}


async def _extract_strings(game_path: str, engine: str) -> dict:
    try:
        from ..engine_bridge import extract_strings
        result = extract_strings(game_path, engine=engine)
        if not result:
            return {"error": "No strings extracted", "count": 0}
        count = len(result) if isinstance(result, list) else result.get("count", 0)
        # Return summary, not the full list (too large)
        sample = []
        items = result if isinstance(result, list) else result.get("entries", [])
        for entry in items[:10]:
            if isinstance(entry, dict):
                sample.append({"original": entry.get("original", "")[:200], "tag": entry.get("tag", "")})
            elif isinstance(entry, str):
                sample.append({"original": entry[:200]})
        return {"count": count, "sample": sample}
    except Exception as e:
        return {"error": f"Extraction failed: {e}"}


# ---------------------------------------------------------------------------
# try_parse — generic parser
# ---------------------------------------------------------------------------

def _try_parse(game_path: str, rel_path: str, method: str, params: dict) -> dict:
    target = _safe_path(game_path, rel_path)
    if not os.path.isfile(target):
        return {"error": f"File not found: {rel_path}"}

    if method == "json":
        return _parse_json(target)
    elif method == "xml":
        return _parse_xml(target)
    elif method == "csv":
        return _parse_csv(target, params.get("delimiter", ","), params.get("encoding", ""))
    elif method == "ini":
        return _parse_ini(target)
    elif method == "binary_pattern":
        return _parse_binary_pattern(target, params.get("pattern", ""), params.get("context_bytes", 32))
    elif method == "regex":
        return _parse_regex(target, params.get("pattern", ""), params.get("flags", ""))
    else:
        return {"error": f"Unknown parse method: {method}"}


def _parse_json(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        # Summarize structure
        if isinstance(data, list):
            return {"type": "array", "length": len(data), "sample": data[:5]}
        elif isinstance(data, dict):
            keys = list(data.keys())[:30]
            return {"type": "object", "keys": keys, "key_count": len(data)}
        return {"type": type(data).__name__, "value": str(data)[:500]}
    except Exception as e:
        return {"error": f"JSON parse failed: {e}"}


def _parse_xml(path: str) -> dict:
    try:
        tree = ET.parse(path)
        root = tree.getroot()

        def _summarize(elem: ET.Element, depth: int = 0) -> dict:
            info: dict[str, Any] = {"tag": elem.tag}
            if elem.attrib:
                info["attribs"] = dict(elem.attrib)
            if elem.text and elem.text.strip():
                info["text"] = elem.text.strip()[:200]
            if depth < 3:
                children = [_summarize(c, depth + 1) for c in list(elem)[:10]]
                if children:
                    info["children"] = children
                    info["total_children"] = len(list(elem))
            return info

        return {"root": _summarize(root)}
    except Exception as e:
        return {"error": f"XML parse failed: {e}"}


def _parse_csv(path: str, delimiter: str, encoding: str) -> dict:
    enc = encoding or "utf-8"
    try:
        with open(path, "r", encoding=enc, errors="replace") as f:
            reader = csv.reader(f, delimiter=delimiter)
            rows = []
            for i, row in enumerate(reader):
                rows.append(row)
                if i >= 20:
                    break
        return {"rows": rows, "sample_count": len(rows)}
    except Exception as e:
        return {"error": f"CSV parse failed: {e}"}


def _parse_ini(path: str) -> dict:
    try:
        cp = configparser.ConfigParser()
        cp.read(path, encoding="utf-8")
        sections = {}
        for sec in cp.sections()[:20]:
            sections[sec] = dict(cp.items(sec))
        return {"sections": sections}
    except Exception as e:
        return {"error": f"INI parse failed: {e}"}


def _parse_binary_pattern(path: str, hex_pattern: str, context_bytes: int) -> dict:
    if not hex_pattern:
        return {"error": "pattern is required (hex string, e.g. '89504e47')"}
    try:
        pattern_bytes = bytes.fromhex(hex_pattern.replace(" ", ""))
    except ValueError:
        return {"error": "Invalid hex pattern"}

    context_bytes = min(context_bytes, 64)
    matches = []
    try:
        with open(path, "rb") as f:
            data = f.read(1024 * 1024)  # 1 MB limit
        idx = 0
        while True:
            pos = data.find(pattern_bytes, idx)
            if pos == -1:
                break
            start = max(0, pos - context_bytes)
            end = min(len(data), pos + len(pattern_bytes) + context_bytes)
            context = data[start:end].hex()
            matches.append({"offset": pos, "context_hex": context})
            idx = pos + 1
            if len(matches) >= 20:
                break
    except Exception as e:
        return {"error": f"Binary search failed: {e}"}

    return {"matches": matches, "count": len(matches), "pattern": hex_pattern}


def _parse_regex(path: str, pattern: str, flags_str: str) -> dict:
    if not pattern:
        return {"error": "pattern is required"}
    flags = 0
    if "i" in flags_str:
        flags |= re.IGNORECASE
    if "m" in flags_str:
        flags |= re.MULTILINE
    if "s" in flags_str:
        flags |= re.DOTALL

    try:
        compiled = re.compile(pattern, flags)
    except re.error as e:
        return {"error": f"Invalid regex: {e}"}

    # Read as text
    for enc in ("utf-8", "shift_jis", "utf-16"):
        try:
            with open(path, "r", encoding=enc, errors="replace") as f:
                content = f.read(512 * 1024)  # 512 KB limit
            break
        except Exception:
            continue
    else:
        return {"error": "Could not read file as text"}

    results = []
    for m in compiled.finditer(content):
        entry: dict[str, Any] = {"match": m.group()[:500], "start": m.start(), "end": m.end()}
        if m.groups():
            entry["groups"] = [g[:200] if g else None for g in m.groups()]
        results.append(entry)
        if len(results) >= 50:
            break

    return {"matches": results, "count": len(results), "pattern": pattern}


# ---------------------------------------------------------------------------
# save_strings — save extracted strings to the app DB
# ---------------------------------------------------------------------------

MAX_SAVE_STRINGS = 5000  # Safety limit per call


async def _save_strings(game_id: int, strings: list[dict], append: bool = True) -> dict:
    """Save extracted strings to translation_projects table."""
    if not game_id:
        return {"error": "No game context — cannot save strings without a game_id"}

    if not strings:
        return {"error": "No strings provided"}

    if len(strings) > MAX_SAVE_STRINGS:
        return {"error": f"Too many strings ({len(strings)}). Max {MAX_SAVE_STRINGS} per call. Split into batches."}

    # Build entries in the format the translation pipeline expects
    entries = []
    for i, s in enumerate(strings):
        original = s.get("original", "").strip()
        if not original:
            continue
        entries.append({
            "original": original,
            "translated": "",
            "tag": s.get("tag", ""),
            "file": s.get("file", ""),
            "context": s.get("context", ""),
            "index": i,
            "status": "pending",
        })

    if not entries:
        return {"error": "No valid strings (all empty after trimming)"}

    try:
        from .. import db

        if append:
            # Load existing project and merge
            existing_project = await db.get_project(game_id)
            if existing_project and existing_project.get("project_json"):
                try:
                    existing_entries = json.loads(existing_project["project_json"])
                    if isinstance(existing_entries, list):
                        # Deduplicate by original text
                        existing_originals = {e.get("original") for e in existing_entries}
                        new_entries = [e for e in entries if e["original"] not in existing_originals]
                        # Re-index new entries
                        start_idx = len(existing_entries)
                        for j, e in enumerate(new_entries):
                            e["index"] = start_idx + j
                        all_entries = existing_entries + new_entries
                        added = len(new_entries)
                        skipped = len(entries) - added
                    else:
                        all_entries = entries
                        added = len(entries)
                        skipped = 0
                except (json.JSONDecodeError, TypeError):
                    all_entries = entries
                    added = len(entries)
                    skipped = 0
            else:
                all_entries = entries
                added = len(entries)
                skipped = 0
        else:
            all_entries = entries
            added = len(entries)
            skipped = 0

        project_json = json.dumps(all_entries, ensure_ascii=False)
        await db.save_project(game_id, project_json, provider="agent", model="")

        # Update game string_count
        await db.update_game(game_id, string_count=len(all_entries))

        return {
            "saved": added,
            "skipped_duplicates": skipped,
            "total_strings": len(all_entries),
            "message": f"Successfully saved {added} strings (total: {len(all_entries)})",
        }

    except Exception as e:
        logger.exception("save_strings failed for game %s", game_id)
        return {"error": f"Database error: {e}"}


# ---------------------------------------------------------------------------
# start_translation — kick off the translation pipeline from agent
# ---------------------------------------------------------------------------

async def _start_translation(game_id: int, agent_ctx: dict,
                             source_lang: str = "auto",
                             target_lang: str = "ko") -> dict:
    """Start the translation pipeline for saved strings."""
    if not game_id:
        return {"error": "No game context — cannot start translation without a game_id"}

    api_key = agent_ctx.get("api_key", "")
    provider = agent_ctx.get("provider", "claude")
    model = agent_ctx.get("model", "")

    if not api_key:
        return {"error": "No API key available to run translation"}

    try:
        from .. import db
        from .. import job_manager as tm_job_manager

        game = await db.get_game(game_id)
        if not game:
            return {"error": f"Game not found: {game_id}"}

        # Check strings exist
        project = await db.get_project(game_id)
        if not project or not project.get("project_json"):
            return {"error": "No strings saved yet. Use save_strings first."}

        saved = json.loads(project["project_json"])
        if not isinstance(saved, list) or len(saved) == 0:
            return {"error": "No strings found in project. Use save_strings first."}

        pending_count = sum(1 for e in saved if isinstance(e, dict) and e.get("status") == "pending")
        if pending_count == 0:
            return {"message": "All strings are already translated. Nothing to do.", "total": len(saved)}

        # Map agent provider name to translation provider name
        translate_provider = provider
        if translate_provider == "claude":
            translate_provider = "claude"

        job = await tm_job_manager.start_translation(
            game_id=game_id,
            provider=translate_provider,
            api_key=api_key,
            model=model,
            source_lang=source_lang,
            target_lang=target_lang,
        )

        return {
            "started": True,
            "job_id": job.job_id,
            "total_strings": job.total_strings,
            "message": f"Translation started for {pending_count} pending strings (job: {job.job_id[:8]}...)",
        }

    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        logger.exception("start_translation failed for game %s", game_id)
        return {"error": f"Translation start failed: {e}"}
