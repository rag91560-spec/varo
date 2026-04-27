"""SQLite database layer using aiosqlite with connection pooling."""

import aiosqlite
import asyncio
import hashlib
import os
import json
import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

_data_dir = os.environ.get("GT_DATA_DIR") or os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
DB_PATH = os.path.join(_data_dir, "library.db")

# --- Column whitelists for SQL injection prevention (#17) ---

_GAME_COLUMNS = frozenset({
    "title", "exe_path", "engine", "cover_path", "string_count", "translated_count",
    "source_lang", "status", "last_played_at", "play_time_minutes", "updated_at",
    "vndb_id", "dlsite_id", "cover_source", "preset_id", "developer",
    "platform", "package_name", "original_path", "variant_lang",
    "qa_error_count", "qa_warning_count", "aes_key", "folder_id",
})

_JOB_COLUMNS = frozenset({
    "status", "progress", "total_strings", "translated_strings",
    "error_message", "completed_at",
})

_PRESET_COLUMNS = frozenset({
    "name", "game_id", "engine", "provider", "model", "tone",
    "glossary_json", "instructions", "use_memory", "reference_pairs_json", "updated_at",
})

# Settings keys that users may write via PUT /api/settings
_SETTINGS_ALLOWED_KEYS = frozenset({
    "api_keys", "scan_directories", "default_provider", "default_source_lang",
    "license_key", "app_version", "fallback_providers",
})


def _validate_columns(fields: dict, allowed: frozenset, table: str) -> dict:
    """Filter fields to only allowed columns. Logs rejected keys."""
    rejected = set(fields.keys()) - allowed
    if rejected:
        logger.warning("Rejected columns for %s: %s", table, rejected)
    return {k: v for k, v in fields.items() if k in allowed}


# --- Connection Pool (#16) ---

_pool: asyncio.Queue["aiosqlite.Connection"] = asyncio.Queue(maxsize=5)
_pool_initialized = False
_pool_lock = asyncio.Lock()
_POOL_SIZE = 3


async def _create_connection() -> aiosqlite.Connection:
    conn = await aiosqlite.connect(DB_PATH)
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA journal_mode=WAL")
    await conn.execute("PRAGMA foreign_keys=ON")
    return conn


async def _init_pool():
    global _pool_initialized
    async with _pool_lock:
        if _pool_initialized:
            return
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        for _ in range(_POOL_SIZE):
            conn = await _create_connection()
            await _pool.put(conn)
        _pool_initialized = True


class _PooledConnection:
    """Async context manager that borrows a connection from the pool."""
    def __init__(self):
        self._conn: Optional[aiosqlite.Connection] = None
        self._is_temp = False

    async def __aenter__(self) -> aiosqlite.Connection:
        await _init_pool()
        try:
            self._conn = _pool.get_nowait()
        except asyncio.QueueEmpty:
            self._conn = await _create_connection()
            self._is_temp = True
        return self._conn

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._conn:
            if self._is_temp:
                await self._conn.close()
            else:
                try:
                    _pool.put_nowait(self._conn)
                except asyncio.QueueFull:
                    await self._conn.close()
            self._conn = None


def get_db() -> _PooledConnection:
    """Get a pooled database connection as an async context manager."""
    return _PooledConnection()


# --- Schema ---

SCHEMA = """
CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    exe_path TEXT DEFAULT '',
    engine TEXT DEFAULT '',
    cover_path TEXT DEFAULT '',
    string_count INTEGER DEFAULT 0,
    translated_count INTEGER DEFAULT 0,
    source_lang TEXT DEFAULT 'auto',
    status TEXT DEFAULT 'idle',
    last_played_at TEXT,
    play_time_minutes INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS translation_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    project_json TEXT DEFAULT '{}',
    provider TEXT DEFAULT '',
    model TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS translation_jobs (
    id TEXT PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending',
    progress REAL DEFAULT 0,
    total_strings INTEGER DEFAULT 0,
    translated_strings INTEGER DEFAULT 0,
    error_message TEXT DEFAULT '',
    started_at TEXT,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS translation_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    engine TEXT DEFAULT '',
    provider TEXT DEFAULT '',
    model TEXT DEFAULT '',
    tone TEXT DEFAULT '',
    glossary_json TEXT DEFAULT '{}',
    instructions TEXT DEFAULT '',
    use_memory INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS translation_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_hash TEXT NOT NULL,
    source_text TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    source_lang TEXT DEFAULT 'ja',
    target_lang TEXT DEFAULT 'ko',
    provider TEXT DEFAULT '',
    model TEXT DEFAULT '',
    context_tag TEXT DEFAULT '',
    game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
    usage_count INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tm_source_hash ON translation_memory(source_hash);
CREATE INDEX IF NOT EXISTS idx_tm_langs ON translation_memory(source_lang, target_lang);
"""

MIGRATION = """
-- Add new columns to games (safe: ALTER TABLE ADD COLUMN is idempotent-ish in our try/except)
ALTER TABLE games ADD COLUMN vndb_id TEXT DEFAULT '';
ALTER TABLE games ADD COLUMN dlsite_id TEXT DEFAULT '';
ALTER TABLE games ADD COLUMN cover_source TEXT DEFAULT '';
ALTER TABLE games ADD COLUMN preset_id INTEGER DEFAULT NULL;
ALTER TABLE games ADD COLUMN developer TEXT DEFAULT '';
ALTER TABLE translation_presets ADD COLUMN reference_pairs_json TEXT DEFAULT '[]';
ALTER TABLE games ADD COLUMN platform TEXT DEFAULT 'windows';
ALTER TABLE games ADD COLUMN package_name TEXT DEFAULT '';
ALTER TABLE games ADD COLUMN original_path TEXT DEFAULT '';
ALTER TABLE games ADD COLUMN variant_lang TEXT DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_tm_unique ON translation_memory(source_hash, source_lang, target_lang);
ALTER TABLE games ADD COLUMN qa_error_count INTEGER DEFAULT 0;
ALTER TABLE games ADD COLUMN qa_warning_count INTEGER DEFAULT 0;
CREATE TABLE IF NOT EXISTS qa_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    entry_index INTEGER NOT NULL,
    check_type TEXT NOT NULL,
    severity TEXT DEFAULT 'warning',
    message TEXT DEFAULT '',
    detail_json TEXT DEFAULT '{}',
    resolved INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qa_game ON qa_results(game_id);
CREATE TABLE IF NOT EXISTS game_media_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    folder_path TEXT NOT NULL,
    media_type TEXT NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    source TEXT NOT NULL,
    thumbnail TEXT DEFAULT '',
    duration INTEGER DEFAULT 0,
    size INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS manga (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    source_url TEXT NOT NULL UNIQUE,
    source_type TEXT NOT NULL,
    artist TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    page_count INTEGER DEFAULT 0,
    thumbnail_path TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS manga_translations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manga_id INTEGER NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
    page INTEGER NOT NULL,
    original_text TEXT DEFAULT '',
    translated_text TEXT DEFAULT '',
    positions_json TEXT DEFAULT '[]',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_manga_trans_page ON manga_translations(manga_id, page);
CREATE TABLE IF NOT EXISTS manga_renders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    manga_id INTEGER NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
    page INTEGER NOT NULL,
    inpaint_mode TEXT DEFAULT 'telea',
    font_id TEXT DEFAULT 'noto-sans-kr',
    rendered_path TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE(manga_id, page)
);
CREATE TABLE IF NOT EXISTS audio_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    source TEXT NOT NULL,
    thumbnail TEXT DEFAULT '',
    duration INTEGER DEFAULT 0,
    size INTEGER DEFAULT 0,
    category_id INTEGER DEFAULT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS media_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    media_type TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
ALTER TABLE videos ADD COLUMN category_id INTEGER DEFAULT NULL;
ALTER TABLE audio_items ADD COLUMN script_text TEXT DEFAULT '';
ALTER TABLE audio_items ADD COLUMN translated_script TEXT DEFAULT '';
ALTER TABLE games ADD COLUMN aes_key TEXT DEFAULT '';
ALTER TABLE manga ADD COLUMN category_id INTEGER DEFAULT NULL;
CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);
ALTER TABLE folders ADD COLUMN parent_id INTEGER DEFAULT NULL;
ALTER TABLE games ADD COLUMN folder_id INTEGER DEFAULT NULL;
CREATE TABLE IF NOT EXISTS subtitles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL,
    media_type TEXT NOT NULL,
    label TEXT DEFAULT '',
    source_lang TEXT DEFAULT '',
    target_lang TEXT DEFAULT '',
    stt_provider TEXT DEFAULT '',
    stt_model TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    duration REAL DEFAULT 0,
    segment_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subtitle_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subtitle_id INTEGER NOT NULL REFERENCES subtitles(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    original_text TEXT DEFAULT '',
    translated_text TEXT DEFAULT '',
    confidence REAL DEFAULT 0,
    edited INTEGER DEFAULT 0,
    UNIQUE(subtitle_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_subtitle_segments_sub ON subtitle_segments(subtitle_id);
CREATE TABLE IF NOT EXISTS subtitle_jobs (
    id TEXT PRIMARY KEY,
    subtitle_id INTEGER REFERENCES subtitles(id) ON DELETE SET NULL,
    media_id INTEGER NOT NULL,
    media_type TEXT NOT NULL,
    job_type TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    progress REAL DEFAULT 0,
    error_message TEXT DEFAULT '',
    cost_usd REAL DEFAULT 0,
    started_at TEXT,
    completed_at TEXT
);
ALTER TABLE videos ADD COLUMN subtitle_id INTEGER DEFAULT NULL;
ALTER TABLE audio_items ADD COLUMN subtitle_id INTEGER DEFAULT NULL;
CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    game_id INTEGER NOT NULL,
    status TEXT DEFAULT 'running',
    model TEXT DEFAULT '',
    turns INTEGER DEFAULT 0,
    max_turns INTEGER DEFAULT 20,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    messages_json TEXT DEFAULT '[]',
    result_summary TEXT DEFAULT '',
    error_message TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
);
ALTER TABLE subtitle_segments ADD COLUMN pos_x REAL DEFAULT NULL;
ALTER TABLE subtitle_segments ADD COLUMN pos_y REAL DEFAULT NULL;
CREATE TABLE IF NOT EXISTS subtitle_glossary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subtitle_id INTEGER NOT NULL REFERENCES subtitles(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    auto_generated INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(subtitle_id, source)
);
CREATE INDEX IF NOT EXISTS idx_subtitle_glossary_sub ON subtitle_glossary(subtitle_id);
ALTER TABLE media_categories ADD COLUMN glossary_json TEXT DEFAULT '{}';
ALTER TABLE media_categories ADD COLUMN parent_id INTEGER DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_media_categories_parent ON media_categories(media_type, parent_id);
"""


async def init_db():
    """Initialize schema and run migrations. Uses direct connection (pool not yet ready)."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db = await aiosqlite.connect(DB_PATH)
    try:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")
        await db.executescript(SCHEMA)
        for stmt in MIGRATION.strip().split(";"):
            stmt = stmt.strip()
            if stmt and not stmt.startswith("--"):
                try:
                    await db.execute(stmt)
                except Exception:
                    pass  # column/index already exists
        await db.commit()
    finally:
        await db.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- Games CRUD ---

async def list_games(search: str = "") -> list[dict]:
    async with get_db() as db:
        if search:
            rows = await db.execute_fetchall(
                "SELECT * FROM games WHERE title LIKE ? ORDER BY updated_at DESC",
                (f"%{search}%",),
            )
        else:
            rows = await db.execute_fetchall(
                "SELECT * FROM games ORDER BY updated_at DESC"
            )
        return [dict(r) for r in rows]


async def get_game(game_id: int) -> Optional[dict]:
    async with get_db() as db:
        row = await db.execute_fetchall(
            "SELECT * FROM games WHERE id = ?", (game_id,)
        )
        return dict(row[0]) if row else None


async def create_game(title: str, path: str, exe_path: str = "",
                      engine: str = "", source_lang: str = "auto",
                      variant_lang: str = "") -> dict:
    now = _now()
    async with get_db() as db:
        cursor = await db.execute(
            """INSERT INTO games (title, path, exe_path, engine, source_lang, variant_lang, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (title, path, exe_path, engine, source_lang, variant_lang, now, now),
        )
        await db.commit()
        game_id = cursor.lastrowid
    return await get_game(game_id)


async def update_game(game_id: int, **fields) -> Optional[dict]:
    if not fields:
        return await get_game(game_id)
    fields = _validate_columns(fields, _GAME_COLUMNS, "games")
    if not fields:
        return await get_game(game_id)
    fields["updated_at"] = _now()
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [game_id]
    async with get_db() as db:
        await db.execute(
            f"UPDATE games SET {set_clause} WHERE id = ?", values
        )
        await db.commit()
    return await get_game(game_id)


async def delete_game(game_id: int) -> bool:
    async with get_db() as db:
        cursor = await db.execute("DELETE FROM games WHERE id = ?", (game_id,))
        await db.commit()
        return cursor.rowcount > 0


# --- Translation Projects ---

async def get_project(game_id: int) -> Optional[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM translation_projects WHERE game_id = ? ORDER BY updated_at DESC LIMIT 1",
            (game_id,),
        )
        return dict(rows[0]) if rows else None


async def save_project(game_id: int, project_json: str,
                       provider: str = "", model: str = "") -> dict:
    now = _now()
    async with get_db() as db:
        existing = await db.execute_fetchall(
            "SELECT id FROM translation_projects WHERE game_id = ? ORDER BY updated_at DESC LIMIT 1",
            (game_id,),
        )
        if existing:
            await db.execute(
                """UPDATE translation_projects
                   SET project_json = ?, provider = ?, model = ?, updated_at = ?
                   WHERE id = ?""",
                (project_json, provider, model, now, existing[0]["id"]),
            )
        else:
            await db.execute(
                """INSERT INTO translation_projects
                   (game_id, project_json, provider, model, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (game_id, project_json, provider, model, now, now),
            )
        await db.commit()
    return await get_project(game_id)


# --- Translation Jobs ---

async def create_job(job_id: str, game_id: int, total_strings: int) -> dict:
    now = _now()
    async with get_db() as db:
        await db.execute(
            """INSERT INTO translation_jobs
               (id, game_id, status, total_strings, started_at)
               VALUES (?, ?, 'running', ?, ?)""",
            (job_id, game_id, total_strings, now),
        )
        await db.commit()
        rows = await db.execute_fetchall(
            "SELECT * FROM translation_jobs WHERE id = ?", (job_id,)
        )
        return dict(rows[0])


async def update_job(job_id: str, **fields) -> Optional[dict]:
    if not fields:
        return None
    fields = _validate_columns(fields, _JOB_COLUMNS, "translation_jobs")
    if not fields:
        return None
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [job_id]
    async with get_db() as db:
        await db.execute(
            f"UPDATE translation_jobs SET {set_clause} WHERE id = ?", values
        )
        await db.commit()
        rows = await db.execute_fetchall(
            "SELECT * FROM translation_jobs WHERE id = ?", (job_id,)
        )
        return dict(rows[0]) if rows else None


async def get_job(job_id: str) -> Optional[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM translation_jobs WHERE id = ?", (job_id,)
        )
        return dict(rows[0]) if rows else None


async def get_latest_job(game_id: int) -> Optional[dict]:
    """Get the most recent translation job for a game from DB."""
    async with get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT * FROM translation_jobs WHERE game_id = ? ORDER BY started_at DESC LIMIT 1",
            (game_id,),
        )
        return dict(rows[0]) if rows else None


# --- Settings ---

async def get_settings() -> dict:
    async with get_db() as db:
        rows = await db.execute_fetchall("SELECT key, value FROM settings")
        result = {}
        for row in rows:
            try:
                result[row["key"]] = json.loads(row["value"])
            except (json.JSONDecodeError, TypeError):
                result[row["key"]] = row["value"]
        return result


async def put_settings(settings: dict) -> dict:
    """Save settings, filtering to allowed keys only (#19+#20)."""
    async with get_db() as db:
        for key, value in settings.items():
            if key not in _SETTINGS_ALLOWED_KEYS:
                logger.warning("Rejected settings key: %s", key)
                continue
            json_value = json.dumps(value) if not isinstance(value, str) else value
            await db.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                (key, json_value),
            )
        await db.commit()
    return await get_settings()


# --- Translation Presets ---

async def list_presets(game_id: int = None, engine: str = None) -> list[dict]:
    async with get_db() as db:
        q = "SELECT * FROM translation_presets WHERE 1=1"
        params = []
        if game_id is not None:
            q += " AND (game_id = ? OR game_id IS NULL)"
            params.append(game_id)
        if engine:
            q += " AND (engine = ? OR engine = '')"
            params.append(engine)
        q += " ORDER BY updated_at DESC"
        rows = await db.execute_fetchall(q, params)
        return [dict(r) for r in rows]


async def get_preset(preset_id: int) -> Optional[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM translation_presets WHERE id = ?", (preset_id,)
        )
        return dict(rows[0]) if rows else None


async def create_preset(name: str, game_id: int = None, **fields) -> dict:
    now = _now()
    async with get_db() as db:
        cursor = await db.execute(
            """INSERT INTO translation_presets
               (name, game_id, engine, provider, model, tone, glossary_json, instructions, use_memory, reference_pairs_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (name, game_id, fields.get("engine", ""), fields.get("provider", ""),
             fields.get("model", ""), fields.get("tone", ""),
             fields.get("glossary_json", "{}"), fields.get("instructions", ""),
             1 if fields.get("use_memory", True) else 0,
             fields.get("reference_pairs_json", "[]"), now, now),
        )
        await db.commit()
        preset_id = cursor.lastrowid
    return await get_preset(preset_id)


async def update_preset(preset_id: int, **fields) -> Optional[dict]:
    if not fields:
        return await get_preset(preset_id)
    if "use_memory" in fields:
        fields["use_memory"] = 1 if fields["use_memory"] else 0
    fields["updated_at"] = _now()
    fields = _validate_columns(fields, _PRESET_COLUMNS, "translation_presets")
    if not fields:
        return await get_preset(preset_id)
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [preset_id]
    async with get_db() as db:
        await db.execute(f"UPDATE translation_presets SET {set_clause} WHERE id = ?", values)
        await db.commit()
    return await get_preset(preset_id)


async def delete_preset(preset_id: int) -> bool:
    async with get_db() as db:
        cursor = await db.execute("DELETE FROM translation_presets WHERE id = ?", (preset_id,))
        await db.commit()
        return cursor.rowcount > 0


# --- Translation Memory ---

def _hash_text(text: str) -> str:
    return hashlib.sha256(text.strip().encode()).hexdigest()


async def tm_lookup(source_text: str, source_lang: str = "ja", target_lang: str = "ko") -> Optional[dict]:
    h = _hash_text(source_text)
    async with get_db() as db:
        rows = await db.execute_fetchall(
            """SELECT * FROM translation_memory
               WHERE source_hash = ? AND source_lang = ? AND target_lang = ?
               LIMIT 1""",
            (h, source_lang, target_lang),
        )
        if rows:
            row = dict(rows[0])
            await db.execute(
                "UPDATE translation_memory SET usage_count = usage_count + 1 WHERE id = ?",
                (row["id"],),
            )
            await db.commit()
            return row
        return None


async def tm_lookup_batch(texts: list[str], source_lang: str = "ja",
                          target_lang: str = "ko") -> dict[str, dict]:
    """Batch lookup. Returns {source_text: {translated_text, ...}}."""
    if not texts:
        return {}
    hashes = {_hash_text(t): t for t in texts}
    placeholders = ",".join("?" * len(hashes))
    async with get_db() as db:
        rows = await db.execute_fetchall(
            f"""SELECT * FROM translation_memory
                WHERE source_hash IN ({placeholders})
                AND source_lang = ? AND target_lang = ?""",
            list(hashes.keys()) + [source_lang, target_lang],
        )
        result = {}
        ids = []
        for row in rows:
            r = dict(row)
            result[r["source_text"]] = r
            ids.append(r["id"])
        if ids:
            id_placeholders = ",".join("?" * len(ids))
            await db.execute(
                f"UPDATE translation_memory SET usage_count = usage_count + 1 WHERE id IN ({id_placeholders})",
                ids,
            )
            await db.commit()
        return result


async def tm_insert(source_text: str, translated_text: str,
                    source_lang: str = "ja", target_lang: str = "ko",
                    provider: str = "", model: str = "",
                    context_tag: str = "", game_id: int = None) -> dict:
    now = _now()
    h = _hash_text(source_text)
    async with get_db() as db:
        # Upsert: update if exists
        existing = await db.execute_fetchall(
            "SELECT id FROM translation_memory WHERE source_hash = ? AND source_lang = ? AND target_lang = ?",
            (h, source_lang, target_lang),
        )
        if existing:
            await db.execute(
                """UPDATE translation_memory
                   SET translated_text = ?, provider = ?, model = ?, updated_at = ?
                   WHERE id = ?""",
                (translated_text, provider, model, now, existing[0]["id"]),
            )
        else:
            await db.execute(
                """INSERT INTO translation_memory
                   (source_hash, source_text, translated_text, source_lang, target_lang,
                    provider, model, context_tag, game_id, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (h, source_text, translated_text, source_lang, target_lang,
                 provider, model, context_tag, game_id, now, now),
            )
        await db.commit()
        rows = await db.execute_fetchall(
            "SELECT * FROM translation_memory WHERE source_hash = ? AND source_lang = ? AND target_lang = ?",
            (h, source_lang, target_lang),
        )
        return dict(rows[0])


async def tm_insert_batch(entries: list[dict]) -> int:
    """Bulk insert TM entries using INSERT OR IGNORE (#18). Returns count inserted."""
    if not entries:
        return 0
    now = _now()
    rows = [
        (_hash_text(e["source_text"]), e["source_text"], e["translated_text"],
         e.get("source_lang", "ja"), e.get("target_lang", "ko"),
         e.get("provider", ""), e.get("model", ""),
         e.get("context_tag", ""), e.get("game_id"),
         now, now)
        for e in entries
    ]
    async with get_db() as db:
        cursor = await db.executemany(
            """INSERT OR IGNORE INTO translation_memory
               (source_hash, source_text, translated_text, source_lang, target_lang,
                provider, model, context_tag, game_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )
        await db.commit()
        return cursor.rowcount


async def tm_search(search: str = "", source_lang: str = "",
                    limit: int = 50) -> list[dict]:
    async with get_db() as db:
        q = "SELECT * FROM translation_memory WHERE 1=1"
        params = []
        if search:
            q += " AND (source_text LIKE ? OR translated_text LIKE ?)"
            params.extend([f"%{search}%", f"%{search}%"])
        if source_lang:
            q += " AND source_lang = ?"
            params.append(source_lang)
        q += " ORDER BY usage_count DESC, updated_at DESC LIMIT ?"
        params.append(limit)
        rows = await db.execute_fetchall(q, params)
        return [dict(r) for r in rows]


async def tm_stats() -> dict:
    async with get_db() as db:
        total_rows = await db.execute_fetchall("SELECT COUNT(*) as c FROM translation_memory")
        total = total_rows[0]["c"]
        lang_rows = await db.execute_fetchall(
            "SELECT source_lang, COUNT(*) as c FROM translation_memory GROUP BY source_lang"
        )
        by_lang = {r["source_lang"]: r["c"] for r in lang_rows}
        provider_rows = await db.execute_fetchall(
            "SELECT provider, COUNT(*) as c FROM translation_memory GROUP BY provider"
        )
        by_provider = {r["provider"]: r["c"] for r in provider_rows}
        return {"total": total, "by_lang": by_lang, "by_provider": by_provider}


async def tm_delete(entry_id: int) -> bool:
    async with get_db() as db:
        cursor = await db.execute("DELETE FROM translation_memory WHERE id = ?", (entry_id,))
        await db.commit()
        return cursor.rowcount > 0


async def tm_clear() -> int:
    async with get_db() as db:
        cursor = await db.execute("DELETE FROM translation_memory")
        await db.commit()
        return cursor.rowcount


# --- License Cache ---

async def get_license_cache() -> dict:
    """Read cached license status from settings table."""
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT key, value FROM settings WHERE key IN ('license_valid', 'license_plan', 'license_is_admin', 'license_verified_at')"
        )
        result: dict = {}
        for row in rows:
            k, v = row["key"], row["value"]
            if k == "license_valid":
                result["valid"] = v == "true"
            elif k == "license_plan":
                result["plan"] = v
            elif k == "license_is_admin":
                result["is_admin"] = v == "true"
            elif k == "license_verified_at":
                result["verified_at"] = v
        return result



# --- QA Results ---

async def qa_save_results(game_id: int, issues: list[dict]) -> int:
    """Replace all QA results for a game."""
    now = _now()
    async with get_db() as conn:
        await conn.execute("DELETE FROM qa_results WHERE game_id = ?", (game_id,))
        rows = [
            (game_id, issue["entry_index"], issue["check_type"],
             issue.get("severity", "warning"), issue.get("message", ""),
             json.dumps(issue.get("detail_json", {}), ensure_ascii=False),
             0, now)
            for issue in issues
        ]
        await conn.executemany(
            """INSERT INTO qa_results
               (game_id, entry_index, check_type, severity, message, detail_json, resolved, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )
        await conn.commit()
        return len(rows)


async def qa_get_results(game_id: int) -> list[dict]:
    """Get all QA results for a game."""
    async with get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT * FROM qa_results WHERE game_id = ? ORDER BY severity, entry_index",
            (game_id,),
        )
        return [dict(r) for r in rows]


async def qa_resolve(qa_id: int) -> bool:
    """Mark a QA issue as resolved."""
    async with get_db() as conn:
        cursor = await conn.execute(
            "UPDATE qa_results SET resolved = 1 WHERE id = ?", (qa_id,)
        )
        await conn.commit()
        return cursor.rowcount > 0


# --- Translation Strings (paginated access into project_json) ---

async def get_project_entries_paginated(
    game_id: int,
    page: int = 1,
    per_page: int = 50,
    status: str = "",
    search: str = "",
    tag: str = "",
    qa_only: bool = False,
    safety: str = "",
) -> dict:
    """Parse project_json and return a paginated, filtered slice of entries.

    Filtering is done in Python (project_json is stored as a JSON blob).
    Returns {"entries": [...], "total": int, "page": int, "per_page": int}.
    Each entry dict is augmented with its zero-based index in the original list.
    """
    project_row = await get_project(game_id)
    if not project_row:
        return {"entries": [], "total": 0, "page": page, "per_page": per_page}

    try:
        all_entries: list[dict] = json.loads(project_row["project_json"])
    except (json.JSONDecodeError, TypeError):
        return {"entries": [], "total": 0, "page": page, "per_page": per_page}

    # Collect QA entry indices for qa_only filter
    qa_indices: set[int] = set()
    if qa_only:
        async with get_db() as conn:
            rows = await conn.execute_fetchall(
                "SELECT entry_index FROM qa_results WHERE game_id = ? AND resolved = 0",
                (game_id,),
            )
            qa_indices = {r["entry_index"] for r in rows}

    filtered: list[dict] = []
    for i, entry in enumerate(all_entries):
        if status and entry.get("status") != status:
            continue
        if safety and entry.get("safety") != safety:
            continue
        if tag and entry.get("tag") != tag:
            continue
        if search:
            sl = search.lower()
            orig = (entry.get("original") or "").lower()
            tran = (entry.get("translated") or "").lower()
            ns = (entry.get("namespace") or "").lower()
            if sl not in orig and sl not in tran and sl not in ns:
                continue
        if qa_only and i not in qa_indices:
            continue
        filtered.append({**entry, "_index": i})

    total = len(filtered)
    start = (page - 1) * per_page
    end = start + per_page
    page_entries = filtered[start:end]

    # Count safety stats from all entries (before filtering)
    safety_counts = {"safe": 0, "risky": 0, "unsafe": 0}
    for entry in all_entries:
        s = entry.get("safety", "safe")
        if s in safety_counts:
            safety_counts[s] += 1

    return {
        "entries": page_entries,
        "total": total,
        "page": page,
        "per_page": per_page,
        "safety_counts": safety_counts,
    }


async def update_project_entry(game_id: int, index: int, fields: dict) -> bool:
    """Update a single entry in project_json by its zero-based index.

    Allowed fields: translated, status, review_status, reviewer_note, edited_at.
    Saves the mutated JSON back to the DB.
    Returns True if the entry was found and updated.
    """
    _ENTRY_ALLOWED = frozenset({
        "translated", "status", "review_status", "reviewer_note", "edited_at",
    })
    safe_fields = {k: v for k, v in fields.items() if k in _ENTRY_ALLOWED}
    if not safe_fields:
        return False

    project_row = await get_project(game_id)
    if not project_row:
        return False

    try:
        all_entries: list[dict] = json.loads(project_row["project_json"])
    except (json.JSONDecodeError, TypeError):
        return False

    if index < 0 or index >= len(all_entries):
        return False

    all_entries[index].update(safe_fields)

    new_json = json.dumps(all_entries, ensure_ascii=False)
    await save_project(game_id, new_json,
                       provider=project_row.get("provider", ""),
                       model=project_row.get("model", ""))

    # Recalculate translated_count on the game row
    translated_count = sum(
        1 for e in all_entries
        if e.get("status") in ("translated", "reviewed") and e.get("translated")
    )
    await update_game(game_id, translated_count=translated_count)

    return True


async def bulk_update_project_entries(
    game_id: int,
    indices: list[int],
    fields: dict,
) -> int:
    """Bulk-update multiple entries in project_json.

    Allowed fields: status, review_status, reviewer_note.
    Returns the number of entries actually updated.
    """
    _BULK_ALLOWED = frozenset({"status", "review_status", "reviewer_note"})
    safe_fields = {k: v for k, v in fields.items() if k in _BULK_ALLOWED}
    if not safe_fields or not indices:
        return 0

    project_row = await get_project(game_id)
    if not project_row:
        return 0

    try:
        all_entries: list[dict] = json.loads(project_row["project_json"])
    except (json.JSONDecodeError, TypeError):
        return 0

    updated = 0
    index_set = set(indices)
    for i, entry in enumerate(all_entries):
        if i in index_set:
            entry.update(safe_fields)
            updated += 1

    if updated == 0:
        return 0

    new_json = json.dumps(all_entries, ensure_ascii=False)
    await save_project(game_id, new_json,
                       provider=project_row.get("provider", ""),
                       model=project_row.get("model", ""))

    translated_count = sum(
        1 for e in all_entries
        if e.get("status") in ("translated", "reviewed") and e.get("translated")
    )
    await update_game(game_id, translated_count=translated_count)

    return updated


# --- Media Folders ---

async def media_list_folders(game_id: int) -> list[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM game_media_folders WHERE game_id = ? ORDER BY created_at DESC",
            (game_id,),
        )
        return [dict(r) for r in rows]


async def media_add_folder(game_id: int, folder_path: str,
                           media_type: str, label: str = None) -> dict:
    now = _now()
    async with get_db() as db:
        cursor = await db.execute(
            """INSERT INTO game_media_folders (game_id, folder_path, media_type, label, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (game_id, folder_path, media_type, label, now),
        )
        await db.commit()
        rows = await db.execute_fetchall(
            "SELECT * FROM game_media_folders WHERE id = ?", (cursor.lastrowid,)
        )
        return dict(rows[0])


async def media_games_with_type(media_type: str) -> set[int]:
    """Return game IDs that have at least one folder of the given media_type."""
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT DISTINCT game_id FROM game_media_folders WHERE media_type = ?",
            (media_type,),
        )
        return {r["game_id"] for r in rows}


async def media_delete_folder(folder_id: int, game_id: int) -> bool:
    async with get_db() as db:
        cursor = await db.execute(
            "DELETE FROM game_media_folders WHERE id = ? AND game_id = ?",
            (folder_id, game_id),
        )
        await db.commit()
        return cursor.rowcount > 0


# --- Videos ---

_VIDEO_COLUMNS = frozenset({
    "title", "type", "source", "thumbnail", "duration", "size", "sort_order",
    "category_id", "updated_at",
})

_AUDIO_COLUMNS = frozenset({
    "title", "type", "source", "thumbnail", "duration", "size", "sort_order",
    "category_id", "updated_at", "script_text", "translated_script",
})

_SUBTITLE_COLUMNS = frozenset({
    "label", "source_lang", "target_lang", "stt_provider", "stt_model",
    "status", "duration", "segment_count", "updated_at",
})

_SUBTITLE_SEGMENT_COLUMNS = frozenset({
    "start_time", "end_time", "original_text", "translated_text",
    "confidence", "edited", "pos_x", "pos_y",
})

_SUBTITLE_JOB_COLUMNS = frozenset({
    "status", "progress", "error_message", "cost_usd",
    "started_at", "completed_at",
})

_CATEGORY_COLUMNS = frozenset({
    "name", "media_type", "sort_order", "updated_at", "glossary_json", "parent_id",
})


async def list_videos() -> list[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM videos ORDER BY sort_order ASC, created_at DESC"
        )
        return [dict(r) for r in rows]


async def get_video(video_id: int) -> Optional[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM videos WHERE id = ?", (video_id,)
        )
        return dict(rows[0]) if rows else None


async def create_video(title: str, type_: str, source: str, **fields) -> dict:
    now = _now()
    async with get_db() as db:
        cursor = await db.execute(
            """INSERT INTO videos (title, type, source, thumbnail, duration, size,
               category_id, sort_order, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (title, type_, source, fields.get("thumbnail", ""),
             fields.get("duration", 0), fields.get("size", 0),
             fields.get("category_id"), fields.get("sort_order", 0), now, now),
        )
        await db.commit()
        video_id = cursor.lastrowid
    return await get_video(video_id)


async def update_video(video_id: int, **fields) -> Optional[dict]:
    if not fields:
        return await get_video(video_id)
    fields = _validate_columns(fields, _VIDEO_COLUMNS, "videos")
    if not fields:
        return await get_video(video_id)
    fields["updated_at"] = _now()
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [video_id]
    async with get_db() as db:
        await db.execute(f"UPDATE videos SET {set_clause} WHERE id = ?", values)
        await db.commit()
    return await get_video(video_id)


async def delete_video(video_id: int) -> bool:
    async with get_db() as db:
        cursor = await db.execute("DELETE FROM videos WHERE id = ?", (video_id,))
        await db.commit()
        return cursor.rowcount > 0


# --- Manga ---

_MANGA_COLUMNS = frozenset({
    "title", "artist", "tags", "page_count", "thumbnail_path", "category_id", "updated_at",
})


async def list_manga(search: str = "", source_type: str = "") -> list[dict]:
    async with get_db() as db:
        q = """SELECT m.*,
                      COALESCE(tp.translated_pages, 0) AS translated_pages
               FROM manga m
               LEFT JOIN (
                   SELECT manga_id, COUNT(DISTINCT page) AS translated_pages
                   FROM manga_translations
                   GROUP BY manga_id
               ) tp ON tp.manga_id = m.id
               WHERE 1=1"""
        params: list = []
        if search:
            q += " AND (m.title LIKE ? OR m.artist LIKE ? OR m.tags LIKE ?)"
            params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])
        if source_type:
            q += " AND m.source_type = ?"
            params.append(source_type)
        q += " ORDER BY m.created_at DESC"
        rows = await db.execute_fetchall(q, params)
        return [dict(r) for r in rows]


async def get_manga(manga_id: int) -> Optional[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM manga WHERE id = ?", (manga_id,)
        )
        return dict(rows[0]) if rows else None


async def create_manga(title: str, source_url: str, source_type: str,
                       artist: str = "", tags: str = "[]",
                       page_count: int = 0, thumbnail_path: str = "") -> dict:
    now = _now()
    async with get_db() as db:
        cursor = await db.execute(
            """INSERT INTO manga (title, source_url, source_type, artist, tags,
               page_count, thumbnail_path, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (title, source_url, source_type, artist, tags,
             page_count, thumbnail_path, now, now),
        )
        await db.commit()
        manga_id = cursor.lastrowid
    return await get_manga(manga_id)


async def update_manga(manga_id: int, **fields) -> Optional[dict]:
    if not fields:
        return await get_manga(manga_id)
    fields = _validate_columns(fields, _MANGA_COLUMNS, "manga")
    if not fields:
        return await get_manga(manga_id)
    fields["updated_at"] = _now()
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [manga_id]
    async with get_db() as db:
        await db.execute(f"UPDATE manga SET {set_clause} WHERE id = ?", values)
        await db.commit()
    return await get_manga(manga_id)


async def delete_manga(manga_id: int) -> bool:
    async with get_db() as db:
        cursor = await db.execute("DELETE FROM manga WHERE id = ?", (manga_id,))
        await db.commit()
        return cursor.rowcount > 0


async def get_manga_translation(manga_id: int, page: int) -> Optional[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM manga_translations WHERE manga_id = ? AND page = ?",
            (manga_id, page),
        )
        return dict(rows[0]) if rows else None


async def save_manga_translation(manga_id: int, page: int,
                                  original_text: str, translated_text: str,
                                  positions_json: str = "[]") -> dict:
    now = _now()
    async with get_db() as db:
        existing = await db.execute_fetchall(
            "SELECT id FROM manga_translations WHERE manga_id = ? AND page = ?",
            (manga_id, page),
        )
        if existing:
            await db.execute(
                """UPDATE manga_translations
                   SET original_text = ?, translated_text = ?, positions_json = ?
                   WHERE id = ?""",
                (original_text, translated_text, positions_json, existing[0]["id"]),
            )
        else:
            await db.execute(
                """INSERT INTO manga_translations
                   (manga_id, page, original_text, translated_text, positions_json, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (manga_id, page, original_text, translated_text, positions_json, now),
            )
        await db.commit()
    return await get_manga_translation(manga_id, page)


# --- Manga Renders ---

async def get_manga_render(manga_id: int, page: int) -> Optional[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM manga_renders WHERE manga_id = ? AND page = ?",
            (manga_id, page),
        )
        return dict(rows[0]) if rows else None


async def save_manga_render(manga_id: int, page: int, inpaint_mode: str,
                            font_id: str, rendered_path: str) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        existing = await db.execute_fetchall(
            "SELECT id FROM manga_renders WHERE manga_id = ? AND page = ?",
            (manga_id, page),
        )
        if existing:
            await db.execute(
                """UPDATE manga_renders SET inpaint_mode = ?, font_id = ?,
                   rendered_path = ?, created_at = ? WHERE id = ?""",
                (inpaint_mode, font_id, rendered_path, now, existing[0]["id"]),
            )
        else:
            await db.execute(
                """INSERT INTO manga_renders
                   (manga_id, page, inpaint_mode, font_id, rendered_path, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (manga_id, page, inpaint_mode, font_id, rendered_path, now),
            )
        await db.commit()
    return await get_manga_render(manga_id, page)


async def list_manga_renders(manga_id: int) -> list[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM manga_renders WHERE manga_id = ? ORDER BY page ASC",
            (manga_id,),
        )
        return [dict(r) for r in rows]


# --- Audio Items ---

async def list_audio_items() -> list[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM audio_items ORDER BY sort_order ASC, created_at DESC"
        )
        return [dict(r) for r in rows]


async def get_audio_item(audio_id: int) -> Optional[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM audio_items WHERE id = ?", (audio_id,)
        )
        return dict(rows[0]) if rows else None


async def create_audio_item(title: str, type_: str, source: str, **fields) -> dict:
    now = _now()
    async with get_db() as db:
        cursor = await db.execute(
            """INSERT INTO audio_items (title, type, source, thumbnail, duration, size,
               category_id, sort_order, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (title, type_, source, fields.get("thumbnail", ""),
             fields.get("duration", 0), fields.get("size", 0),
             fields.get("category_id"), fields.get("sort_order", 0), now, now),
        )
        await db.commit()
        audio_id = cursor.lastrowid
    return await get_audio_item(audio_id)


async def update_audio_item(audio_id: int, **fields) -> Optional[dict]:
    if not fields:
        return await get_audio_item(audio_id)
    fields = _validate_columns(fields, _AUDIO_COLUMNS, "audio_items")
    if not fields:
        return await get_audio_item(audio_id)
    fields["updated_at"] = _now()
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [audio_id]
    async with get_db() as db:
        await db.execute(f"UPDATE audio_items SET {set_clause} WHERE id = ?", values)
        await db.commit()
    return await get_audio_item(audio_id)


async def delete_audio_item(audio_id: int) -> bool:
    async with get_db() as db:
        cursor = await db.execute("DELETE FROM audio_items WHERE id = ?", (audio_id,))
        await db.commit()
        return cursor.rowcount > 0


# --- Media Categories ---

async def list_categories(media_type: str = "") -> list[dict]:
    async with get_db() as db:
        if media_type:
            rows = await db.execute_fetchall(
                "SELECT * FROM media_categories WHERE media_type = ? ORDER BY sort_order ASC, name ASC",
                (media_type,),
            )
        else:
            rows = await db.execute_fetchall(
                "SELECT * FROM media_categories ORDER BY media_type, sort_order ASC, name ASC"
            )
        return [dict(r) for r in rows]


async def get_category(cat_id: int) -> Optional[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM media_categories WHERE id = ?", (cat_id,)
        )
        return dict(rows[0]) if rows else None


async def create_category(name: str, media_type: str, sort_order: int = 0,
                           parent_id: Optional[int] = None) -> dict:
    now = _now()
    async with get_db() as db:
        cursor = await db.execute(
            """INSERT INTO media_categories (name, media_type, sort_order, parent_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (name, media_type, sort_order, parent_id, now, now),
        )
        await db.commit()
        cat_id = cursor.lastrowid
    return await get_category(cat_id)


async def get_or_create_category_by_path(
    media_type: str,
    segments: list[str],
    root_parent_id: Optional[int] = None,
) -> Optional[dict]:
    """Walk `segments` as a folder path under `root_parent_id`, creating categories as needed.

    Returns the leaf category dict. Empty segments → returns None.
    Idempotent: repeating the same path returns the existing leaf without duplicating.
    """
    if not segments:
        return None
    parent_id = root_parent_id
    leaf: Optional[dict] = None
    async with get_db() as db:
        for seg in segments:
            name = seg.strip()
            if not name:
                continue
            if parent_id is None:
                rows = await db.execute_fetchall(
                    "SELECT * FROM media_categories WHERE media_type = ? AND parent_id IS NULL AND name = ? LIMIT 1",
                    (media_type, name),
                )
            else:
                rows = await db.execute_fetchall(
                    "SELECT * FROM media_categories WHERE media_type = ? AND parent_id = ? AND name = ? LIMIT 1",
                    (media_type, parent_id, name),
                )
            if rows:
                leaf = dict(rows[0])
            else:
                now = _now()
                cursor = await db.execute(
                    """INSERT INTO media_categories (name, media_type, sort_order, parent_id, created_at, updated_at)
                       VALUES (?, ?, 0, ?, ?, ?)""",
                    (name, media_type, parent_id, now, now),
                )
                await db.commit()
                new_id = cursor.lastrowid
                rows = await db.execute_fetchall(
                    "SELECT * FROM media_categories WHERE id = ?", (new_id,)
                )
                leaf = dict(rows[0]) if rows else None
            parent_id = leaf["id"] if leaf else parent_id
    return leaf


async def list_category_descendants(cat_id: int) -> list[int]:
    """Return [cat_id, ...all descendant ids] via recursive CTE."""
    async with get_db() as db:
        rows = await db.execute_fetchall(
            """WITH RECURSIVE descendants(id) AS (
                   SELECT id FROM media_categories WHERE id = ?
                   UNION ALL
                   SELECT c.id FROM media_categories c
                   INNER JOIN descendants d ON c.parent_id = d.id
               )
               SELECT id FROM descendants""",
            (cat_id,),
        )
        return [r["id"] for r in rows]


async def get_category_ancestors(cat_id: int) -> list[dict]:
    """Return ancestor chain from root to cat_id (inclusive)."""
    async with get_db() as db:
        rows = await db.execute_fetchall(
            """WITH RECURSIVE ancestors(id, name, media_type, parent_id, depth) AS (
                   SELECT id, name, media_type, parent_id, 0
                   FROM media_categories WHERE id = ?
                   UNION ALL
                   SELECT c.id, c.name, c.media_type, c.parent_id, a.depth + 1
                   FROM media_categories c
                   INNER JOIN ancestors a ON c.id = a.parent_id
               )
               SELECT id, name, media_type, parent_id FROM ancestors ORDER BY depth DESC""",
            (cat_id,),
        )
        return [dict(r) for r in rows]


async def update_category(cat_id: int, **fields) -> Optional[dict]:
    if not fields:
        return await get_category(cat_id)
    fields = _validate_columns(fields, _CATEGORY_COLUMNS, "media_categories")
    if not fields:
        return await get_category(cat_id)
    fields["updated_at"] = _now()
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [cat_id]
    async with get_db() as db:
        await db.execute(f"UPDATE media_categories SET {set_clause} WHERE id = ?", values)
        await db.commit()
    return await get_category(cat_id)


async def delete_category(cat_id: int) -> bool:
    """Delete a category and all descendants. Items in any of them become uncategorized."""
    descendant_ids = await list_category_descendants(cat_id)
    if not descendant_ids:
        return False
    async with get_db() as db:
        placeholders = ",".join("?" * len(descendant_ids))
        # Clear items in all affected categories
        await db.execute(
            f"UPDATE videos SET category_id = NULL WHERE category_id IN ({placeholders})",
            descendant_ids,
        )
        await db.execute(
            f"UPDATE audio_items SET category_id = NULL WHERE category_id IN ({placeholders})",
            descendant_ids,
        )
        await db.execute(
            f"UPDATE manga SET category_id = NULL WHERE category_id IN ({placeholders})",
            descendant_ids,
        )
        cursor = await db.execute(
            f"DELETE FROM media_categories WHERE id IN ({placeholders})",
            descendant_ids,
        )
        await db.commit()
        return cursor.rowcount > 0


async def list_child_categories(media_type: str, parent_id: Optional[int]) -> list[dict]:
    """Direct children of the given parent (NULL = root) for a media_type."""
    async with get_db() as db:
        if parent_id is None:
            rows = await db.execute_fetchall(
                "SELECT * FROM media_categories WHERE media_type = ? AND parent_id IS NULL ORDER BY sort_order ASC, name ASC",
                (media_type,),
            )
        else:
            rows = await db.execute_fetchall(
                "SELECT * FROM media_categories WHERE media_type = ? AND parent_id = ? ORDER BY sort_order ASC, name ASC",
                (media_type, parent_id),
            )
        return [dict(r) for r in rows]


async def list_audio_items_by_category(category_id: Optional[int]) -> list[dict]:
    """Direct items in a category (NULL = uncategorized/root)."""
    async with get_db() as db:
        if category_id is None:
            rows = await db.execute_fetchall(
                "SELECT * FROM audio_items WHERE category_id IS NULL ORDER BY sort_order ASC, created_at DESC"
            )
        else:
            rows = await db.execute_fetchall(
                "SELECT * FROM audio_items WHERE category_id = ? ORDER BY sort_order ASC, created_at DESC",
                (category_id,),
            )
        return [dict(r) for r in rows]


async def list_videos_by_category(category_id: Optional[int]) -> list[dict]:
    """Direct videos in a category (NULL = uncategorized/root)."""
    async with get_db() as db:
        if category_id is None:
            rows = await db.execute_fetchall(
                "SELECT * FROM videos WHERE category_id IS NULL ORDER BY sort_order ASC, created_at DESC"
            )
        else:
            rows = await db.execute_fetchall(
                "SELECT * FROM videos WHERE category_id = ? ORDER BY sort_order ASC, created_at DESC",
                (category_id,),
            )
        return [dict(r) for r in rows]


async def clear_category_from_items(cat_id: int):
    """카테고리 삭제 시 해당 카테고리의 모든 아이템 category_id를 NULL로"""
    async with get_db() as db:
        await db.execute("UPDATE videos SET category_id = NULL WHERE category_id = ?", (cat_id,))
        await db.execute("UPDATE audio_items SET category_id = NULL WHERE category_id = ?", (cat_id,))
        await db.execute("UPDATE manga SET category_id = NULL WHERE category_id = ?", (cat_id,))
        await db.commit()


# --- Category Glossary ---

async def get_category_glossary(category_id: int) -> dict[str, str]:
    """Return the glossary dict for a category (empty if none)."""
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT glossary_json FROM media_categories WHERE id = ?", (category_id,)
        )
        if not rows:
            return {}
        raw = rows[0]["glossary_json"] or "{}"
        try:
            data = json.loads(raw)
            return data if isinstance(data, dict) else {}
        except (json.JSONDecodeError, TypeError):
            return {}


async def set_category_glossary(category_id: int, glossary: dict) -> None:
    """Replace the full glossary for a category."""
    payload = json.dumps(glossary or {}, ensure_ascii=False)
    now = _now()
    async with get_db() as db:
        await db.execute(
            "UPDATE media_categories SET glossary_json = ?, updated_at = ? WHERE id = ?",
            (payload, now, category_id),
        )
        await db.commit()


async def upsert_category_glossary_terms(category_id: int, terms: dict) -> dict[str, str]:
    """Merge `terms` into the existing category glossary and return the merged dict."""
    current = await get_category_glossary(category_id)
    if terms:
        current.update({str(k): str(v) for k, v in terms.items()})
    await set_category_glossary(category_id, current)
    return current


async def bulk_move_videos(video_ids: list[int], category_id: int | None):
    async with get_db() as db:
        placeholders = ",".join("?" * len(video_ids))
        await db.execute(
            f"UPDATE videos SET category_id = ? WHERE id IN ({placeholders})",
            [category_id] + video_ids,
        )
        await db.commit()


async def bulk_move_audio(audio_ids: list[int], category_id: int | None):
    async with get_db() as db:
        placeholders = ",".join("?" * len(audio_ids))
        await db.execute(
            f"UPDATE audio_items SET category_id = ? WHERE id IN ({placeholders})",
            [category_id] + audio_ids,
        )
        await db.commit()


async def bulk_move_manga(manga_ids: list[int], category_id: int | None):
    async with get_db() as db:
        placeholders = ",".join("?" * len(manga_ids))
        await db.execute(
            f"UPDATE manga SET category_id = ? WHERE id IN ({placeholders})",
            [category_id] + manga_ids,
        )
        await db.commit()


async def count_items_by_category(media_type: str) -> dict[int | None, int]:
    """카테고리별 아이템 수 반환"""
    table_map = {"video": "videos", "audio": "audio_items", "manga": "manga"}
    table = table_map.get(media_type, "videos")
    async with get_db() as db:
        rows = await db.execute_fetchall(
            f"SELECT category_id, COUNT(*) as cnt FROM {table} GROUP BY category_id"
        )
        return {r["category_id"]: r["cnt"] for r in rows}


# --- Game Folders ---

_FOLDER_COLUMNS = frozenset({"name", "sort_order", "parent_id"})


async def list_folders() -> list[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM folders ORDER BY sort_order ASC, created_at DESC"
        )
        return [dict(r) for r in rows]


async def get_folder(folder_id: int) -> Optional[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM folders WHERE id = ?", (folder_id,)
        )
        return dict(rows[0]) if rows else None


async def create_folder(name: str, parent_id: Optional[int] = None) -> dict:
    now = _now()
    async with get_db() as db:
        cursor = await db.execute(
            "INSERT INTO folders (name, parent_id, sort_order, created_at) VALUES (?, ?, 0, ?)",
            (name, parent_id, now),
        )
        await db.commit()
        folder_id = cursor.lastrowid
    return await get_folder(folder_id)


async def update_folder(folder_id: int, **fields) -> Optional[dict]:
    if not fields:
        return await get_folder(folder_id)
    fields = _validate_columns(fields, _FOLDER_COLUMNS, "folders")
    if not fields:
        return await get_folder(folder_id)
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [folder_id]
    async with get_db() as db:
        await db.execute(f"UPDATE folders SET {set_clause} WHERE id = ?", values)
        await db.commit()
    return await get_folder(folder_id)


async def delete_folder(folder_id: int) -> bool:
    async with get_db() as db:
        # Look up parent so child folders can inherit it
        rows = await db.execute_fetchall(
            "SELECT parent_id FROM folders WHERE id = ?", (folder_id,)
        )
        if not rows:
            return False
        parent_id = rows[0]["parent_id"]
        # Reset games in this folder
        await db.execute(
            "UPDATE games SET folder_id = NULL WHERE folder_id = ?", (folder_id,)
        )
        # Reparent any child folders to the deleted folder's parent
        await db.execute(
            "UPDATE folders SET parent_id = ? WHERE parent_id = ?",
            (parent_id, folder_id),
        )
        cursor = await db.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
        await db.commit()
        return cursor.rowcount > 0


async def save_license_cache(valid: bool, plan: str, is_admin: bool) -> None:
    """Persist license verification result to settings table."""
    now = _now()
    async with get_db() as db:
        for key, value in [
            ("license_valid", "true" if valid else "false"),
            ("license_plan", plan),
            ("license_is_admin", "true" if is_admin else "false"),
            ("license_verified_at", now),
        ]:
            await db.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                (key, value),
            )
        await db.commit()


# --- Agent Sessions ---

async def create_agent_session(session_id: str, game_id: int, model: str = "",
                                max_turns: int = 20) -> dict:
    now = _now()
    async with get_db() as db:
        await db.execute(
            """INSERT INTO agent_sessions (id, game_id, status, model, max_turns, created_at)
               VALUES (?, ?, 'running', ?, ?, ?)""",
            (session_id, game_id, model, max_turns, now),
        )
        await db.commit()
    return {"id": session_id, "game_id": game_id, "status": "running"}


async def update_agent_session(session_id: str, **fields) -> None:
    allowed = {"status", "turns", "input_tokens", "output_tokens",
               "messages_json", "result_summary", "error_message", "completed_at"}
    fields = {k: v for k, v in fields.items() if k in allowed}
    if not fields:
        return
    sets = ", ".join(f"{k} = ?" for k in fields)
    vals = list(fields.values()) + [session_id]
    async with get_db() as db:
        await db.execute(f"UPDATE agent_sessions SET {sets} WHERE id = ?", vals)
        await db.commit()


async def get_agent_session(session_id: str) -> Optional[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM agent_sessions WHERE id = ?", (session_id,)
        )
        return dict(rows[0]) if rows else None


async def get_latest_agent_session(game_id: int) -> Optional[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM agent_sessions WHERE game_id = ? ORDER BY created_at DESC LIMIT 1",
            (game_id,),
        )
        return dict(rows[0]) if rows else None


# --- Subtitles ---

async def create_subtitle(media_id: int, media_type: str, **fields) -> dict:
    now = _now()
    async with get_db() as db:
        cursor = await db.execute(
            """INSERT INTO subtitles (media_id, media_type, label, source_lang, target_lang,
               stt_provider, stt_model, status, duration, segment_count, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (media_id, media_type, fields.get("label", ""),
             fields.get("source_lang", ""), fields.get("target_lang", ""),
             fields.get("stt_provider", ""), fields.get("stt_model", ""),
             fields.get("status", "pending"), fields.get("duration", 0),
             fields.get("segment_count", 0), now, now),
        )
        await db.commit()
        sub_id = cursor.lastrowid
    return await get_subtitle(sub_id)


async def get_subtitle(subtitle_id: int) -> Optional[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM subtitles WHERE id = ?", (subtitle_id,)
        )
        return dict(rows[0]) if rows else None


async def list_subtitles(media_id: int = None, media_type: str = "") -> list[dict]:
    async with get_db() as db:
        q = "SELECT * FROM subtitles WHERE 1=1"
        params: list = []
        if media_id is not None:
            q += " AND media_id = ?"
            params.append(media_id)
        if media_type:
            q += " AND media_type = ?"
            params.append(media_type)
        q += " ORDER BY created_at DESC"
        rows = await db.execute_fetchall(q, params)
        return [dict(r) for r in rows]


async def update_subtitle(subtitle_id: int, **fields) -> Optional[dict]:
    if not fields:
        return await get_subtitle(subtitle_id)
    fields = _validate_columns(fields, _SUBTITLE_COLUMNS, "subtitles")
    if not fields:
        return await get_subtitle(subtitle_id)
    fields["updated_at"] = _now()
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [subtitle_id]
    async with get_db() as db:
        await db.execute(f"UPDATE subtitles SET {set_clause} WHERE id = ?", values)
        await db.commit()
    return await get_subtitle(subtitle_id)


async def delete_subtitle(subtitle_id: int) -> bool:
    async with get_db() as db:
        cursor = await db.execute("DELETE FROM subtitles WHERE id = ?", (subtitle_id,))
        await db.commit()
        return cursor.rowcount > 0


# --- Subtitle Segments ---

async def insert_subtitle_segments(subtitle_id: int, segments: list[dict]) -> int:
    """Bulk insert segments. Returns count inserted."""
    if not segments:
        return 0
    rows = [
        (subtitle_id, seg.get("seq", i), seg["start_time"], seg["end_time"],
         seg.get("original_text", ""), seg.get("translated_text", ""),
         seg.get("confidence", 0), seg.get("edited", 0))
        for i, seg in enumerate(segments)
    ]
    async with get_db() as db:
        await db.executemany(
            """INSERT OR REPLACE INTO subtitle_segments
               (subtitle_id, seq, start_time, end_time, original_text, translated_text, confidence, edited)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )
        await db.commit()
        # Update segment count on parent
        await db.execute(
            "UPDATE subtitles SET segment_count = ?, updated_at = ? WHERE id = ?",
            (len(rows), _now(), subtitle_id),
        )
        await db.commit()
    return len(rows)


async def get_subtitle_segments(subtitle_id: int) -> list[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM subtitle_segments WHERE subtitle_id = ? ORDER BY seq ASC",
            (subtitle_id,),
        )
        return [dict(r) for r in rows]


async def update_subtitle_segment(segment_id: int, **fields) -> Optional[dict]:
    fields = _validate_columns(fields, _SUBTITLE_SEGMENT_COLUMNS, "subtitle_segments")
    if not fields:
        return None
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [segment_id]
    async with get_db() as db:
        await db.execute(f"UPDATE subtitle_segments SET {set_clause} WHERE id = ?", values)
        await db.commit()
        rows = await db.execute_fetchall(
            "SELECT * FROM subtitle_segments WHERE id = ?", (segment_id,)
        )
        return dict(rows[0]) if rows else None


async def delete_subtitle_segments(subtitle_id: int) -> int:
    async with get_db() as db:
        cursor = await db.execute(
            "DELETE FROM subtitle_segments WHERE subtitle_id = ?", (subtitle_id,)
        )
        await db.commit()
        return cursor.rowcount


# --- Subtitle Segment CRUD ---

async def create_subtitle_segment(subtitle_id: int, seq: int = -1,
                                   start_time: float = 0, end_time: float = 0,
                                   original_text: str = "",
                                   translated_text: str = "") -> dict:
    """Create a single segment and update parent segment_count."""
    async with get_db() as db:
        if seq < 0:
            # Auto-assign seq as max+1
            rows = await db.execute_fetchall(
                "SELECT COALESCE(MAX(seq), -1) as mx FROM subtitle_segments WHERE subtitle_id = ?",
                (subtitle_id,),
            )
            seq = (rows[0]["mx"] if rows else -1) + 1
        cursor = await db.execute(
            """INSERT INTO subtitle_segments
               (subtitle_id, seq, start_time, end_time, original_text, translated_text, confidence, edited)
               VALUES (?, ?, ?, ?, ?, ?, 0, 0)""",
            (subtitle_id, seq, start_time, end_time, original_text, translated_text),
        )
        await db.commit()
        seg_id = cursor.lastrowid
        # Update segment_count
        rows = await db.execute_fetchall(
            "SELECT COUNT(*) as cnt FROM subtitle_segments WHERE subtitle_id = ?",
            (subtitle_id,),
        )
        count = rows[0]["cnt"] if rows else 0
        await db.execute(
            "UPDATE subtitles SET segment_count = ?, updated_at = ? WHERE id = ?",
            (count, _now(), subtitle_id),
        )
        await db.commit()
        rows = await db.execute_fetchall(
            "SELECT * FROM subtitle_segments WHERE id = ?", (seg_id,)
        )
        return dict(rows[0]) if rows else {}


async def delete_subtitle_segment(segment_id: int) -> Optional[int]:
    """Delete a single segment, update parent segment_count. Returns subtitle_id or None."""
    async with get_db() as db:
        # Get subtitle_id first
        rows = await db.execute_fetchall(
            "SELECT subtitle_id FROM subtitle_segments WHERE id = ?", (segment_id,)
        )
        if not rows:
            return None
        subtitle_id = rows[0]["subtitle_id"]
        await db.execute("DELETE FROM subtitle_segments WHERE id = ?", (segment_id,))
        await db.commit()
        # Update segment_count
        rows = await db.execute_fetchall(
            "SELECT COUNT(*) as cnt FROM subtitle_segments WHERE subtitle_id = ?",
            (subtitle_id,),
        )
        count = rows[0]["cnt"] if rows else 0
        await db.execute(
            "UPDATE subtitles SET segment_count = ?, updated_at = ? WHERE id = ?",
            (count, _now(), subtitle_id),
        )
        await db.commit()
        return subtitle_id


async def reorder_subtitle_segments(subtitle_id: int) -> int:
    """Reorder segments by start_time, reassigning seq values. Returns count."""
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT id FROM subtitle_segments WHERE subtitle_id = ? ORDER BY start_time ASC",
            (subtitle_id,),
        )
        # First pass: set all to negative temp values to avoid UNIQUE conflicts
        for i, row in enumerate(rows):
            await db.execute(
                "UPDATE subtitle_segments SET seq = ? WHERE id = ?",
                (-(i + 1), row["id"]),
            )
        # Second pass: set final values
        for i, row in enumerate(rows):
            await db.execute(
                "UPDATE subtitle_segments SET seq = ? WHERE id = ?",
                (i, row["id"]),
            )
        await db.commit()
        return len(rows)


# --- Subtitle Jobs ---

async def create_subtitle_job(job_id: str, subtitle_id: int, media_id: int,
                               media_type: str, job_type: str) -> dict:
    now = _now()
    async with get_db() as db:
        await db.execute(
            """INSERT INTO subtitle_jobs (id, subtitle_id, media_id, media_type, job_type, status, started_at)
               VALUES (?, ?, ?, ?, ?, 'running', ?)""",
            (job_id, subtitle_id, media_id, media_type, job_type, now),
        )
        await db.commit()
        rows = await db.execute_fetchall(
            "SELECT * FROM subtitle_jobs WHERE id = ?", (job_id,)
        )
        return dict(rows[0])


async def update_subtitle_job(job_id: str, **fields) -> Optional[dict]:
    fields = _validate_columns(fields, _SUBTITLE_JOB_COLUMNS, "subtitle_jobs")
    if not fields:
        return None
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [job_id]
    async with get_db() as db:
        await db.execute(f"UPDATE subtitle_jobs SET {set_clause} WHERE id = ?", values)
        await db.commit()
        rows = await db.execute_fetchall(
            "SELECT * FROM subtitle_jobs WHERE id = ?", (job_id,)
        )
        return dict(rows[0]) if rows else None


async def get_subtitle_job(job_id: str) -> Optional[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM subtitle_jobs WHERE id = ?", (job_id,)
        )
        return dict(rows[0]) if rows else None


# --- Subtitle Glossary ---

async def get_subtitle_glossary(subtitle_id: int) -> list[dict]:
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT * FROM subtitle_glossary WHERE subtitle_id = ? ORDER BY category, source",
            (subtitle_id,),
        )
        return [dict(r) for r in rows]


async def upsert_subtitle_glossary(subtitle_id: int, source: str, target: str,
                                     category: str = "general", auto_generated: int = 0) -> dict:
    async with get_db() as db:
        await db.execute(
            """INSERT INTO subtitle_glossary (subtitle_id, source, target, category, auto_generated, created_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(subtitle_id, source) DO UPDATE SET target=excluded.target, category=excluded.category""",
            (subtitle_id, source, target, category, auto_generated, _now()),
        )
        await db.commit()
        rows = await db.execute_fetchall(
            "SELECT * FROM subtitle_glossary WHERE subtitle_id = ? AND source = ?",
            (subtitle_id, source),
        )
        return dict(rows[0]) if rows else {}


async def delete_subtitle_glossary(glossary_id: int) -> bool:
    async with get_db() as db:
        cursor = await db.execute("DELETE FROM subtitle_glossary WHERE id = ?", (glossary_id,))
        await db.commit()
        return cursor.rowcount > 0


async def bulk_upsert_subtitle_glossary(subtitle_id: int, entries: list[dict]) -> int:
    """Bulk upsert glossary entries. Each entry: {source, target, category?, auto_generated?}."""
    count = 0
    async with get_db() as db:
        for entry in entries:
            await db.execute(
                """INSERT INTO subtitle_glossary (subtitle_id, source, target, category, auto_generated, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(subtitle_id, source) DO UPDATE SET target=excluded.target, category=excluded.category""",
                (subtitle_id, entry["source"], entry["target"],
                 entry.get("category", "general"), entry.get("auto_generated", 0), _now()),
            )
            count += 1
        await db.commit()
    return count
