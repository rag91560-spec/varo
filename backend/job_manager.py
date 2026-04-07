"""Async translation job manager with SSE broadcasting."""

import asyncio
import json
import logging
import os
import threading
import uuid
from typing import Optional
from datetime import datetime, timezone

from . import db
from . import engine_bridge

logger = logging.getLogger(__name__)


class TranslationJob:
    def __init__(self, job_id: str, game_id: int):
        self.job_id = job_id
        self.game_id = game_id
        self.status = "running"
        self.progress = 0.0
        self.total_strings = 0
        self.translated_strings = 0
        self.error_message = ""
        self.cancel_event = threading.Event()
        self._sse_queues: list[asyncio.Queue] = []
        self._sse_lock = threading.Lock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._last_persisted_pct = 0.0  # 마지막 DB 저장 시점
        # Store project and resources for apply step
        self.project = None
        self.resources = None

    def add_sse_listener(self) -> asyncio.Queue:
        q = asyncio.Queue()
        with self._sse_lock:
            self._sse_queues.append(q)
        return q

    def remove_sse_listener(self, q: asyncio.Queue):
        with self._sse_lock:
            try:
                self._sse_queues.remove(q)
            except ValueError:
                pass

    def broadcast(self, event_type: str, data: dict):
        msg = {"event": event_type, "data": data}
        with self._sse_lock:
            queues = list(self._sse_queues)
        for q in queues:
            try:
                if self._loop and self._loop.is_running():
                    self._loop.call_soon_threadsafe(q.put_nowait, msg)
                else:
                    q.put_nowait(msg)
            except (asyncio.QueueFull, RuntimeError):
                pass


# Global job registry
_jobs: dict[str, TranslationJob] = {}
_jobs_lock = threading.Lock()
_MAX_FINISHED_JOBS = 20


def _cleanup_finished_jobs():
    """Remove old finished jobs to prevent memory leaks. Caller must hold _jobs_lock."""
    finished = [jid for jid, j in _jobs.items() if j.status != "running"]
    if len(finished) > _MAX_FINISHED_JOBS:
        for jid in finished[:-_MAX_FINISHED_JOBS]:
            _jobs.pop(jid, None)


def get_job(job_id: str) -> Optional[TranslationJob]:
    with _jobs_lock:
        return _jobs.get(job_id)


def get_game_job(game_id: int) -> Optional[TranslationJob]:
    """Get the active (running) job for a game."""
    with _jobs_lock:
        for job in _jobs.values():
            if job.game_id == game_id and job.status == "running":
                return job
        return None


def get_latest_game_job(game_id: int) -> Optional[TranslationJob]:
    """Get the most recent job for a game (any status)."""
    with _jobs_lock:
        # Prefer running, then most recently created
        latest = None
        for job in _jobs.values():
            if job.game_id == game_id:
                if job.status == "running":
                    return job
                latest = job
        return latest


async def start_translation(game_id: int, provider: str, api_key: str,
                            model: str = "", source_lang: str = "auto",
                            target_lang: str = "ko",
                            preset_id: int = None,
                            start_index: int = None,
                            end_index: int = None) -> TranslationJob:
    """Start an async translation job for a game."""
    game = await db.get_game(game_id)
    if not game:
        raise ValueError(f"Game not found: {game_id}")

    job_id = str(uuid.uuid4())
    job = TranslationJob(job_id, game_id)
    job._loop = asyncio.get_running_loop()

    # Atomic check-and-insert under single lock to prevent TOCTOU race
    with _jobs_lock:
        for existing in _jobs.values():
            if existing.game_id == game_id and existing.status == "running":
                raise ValueError("Translation already in progress for this game")
        _cleanup_finished_jobs()
        _jobs[job_id] = job

    # Load preset if specified
    use_memory = True
    preset_context = None
    if preset_id:
        preset = await db.get_preset(preset_id)
        if preset:
            use_memory = bool(preset.get("use_memory", 1))
            if not provider or provider == "claude":
                provider = preset.get("provider") or provider
            if not model:
                model = preset.get("model") or model
            preset_context = preset
        else:
            logger.warning("Preset %s not found, continuing without preset", preset_id)
    job.use_memory = use_memory
    job.provider = provider
    job.model = model
    job.preset_context = preset_context

    # Get settings for API key fallback
    if not api_key:
        settings = await db.get_settings()
        api_keys = settings.get("api_keys", {})
        if isinstance(api_keys, str):
            import json
            api_keys = json.loads(api_keys)
        api_key = api_keys.get(provider, "")

    # Extract strings — try engine bridge first, fall back to agent-saved strings
    try:
        result = engine_bridge.extract_strings(
            game["path"], game["engine"], source_lang, aes_key=game.get("aes_key", "")
        )
        job.project = result["project"]
        job.total_strings = result["string_count"]
        job.resources = result.get("entries", [])
        if job.total_strings == 0:
            raise ValueError("No translatable strings found")
    except Exception as extract_err:
        # Fallback: check for agent-saved strings in project_json
        saved_project = await db.get_project(game_id)
        if saved_project and saved_project.get("project_json"):
            try:
                saved_entries = json.loads(saved_project["project_json"])
                if isinstance(saved_entries, list) and len(saved_entries) > 0:
                    import ue_translator
                    project = ue_translator.TranslationProject()
                    project.game_path = game.get("path", "")
                    project.engine_name = game.get("engine", "agent")
                    project.entries = []
                    for entry in saved_entries:
                        if not isinstance(entry, dict):
                            continue
                        project.entries.append({
                            "namespace": entry.get("namespace", ""),
                            "key": entry.get("key", entry.get("file", "")),
                            "original": entry.get("original", ""),
                            "translated": entry.get("translated", ""),
                            "status": entry.get("status", "pending"),
                            "tag": entry.get("tag", ""),
                            "safety": entry.get("safety", "safe"),
                        })
                    if project.entries:
                        job.project = project
                        job.total_strings = len(project.entries)
                        job.resources = []
                        logger.info(
                            "Using %d agent-saved strings for game %s (engine extract failed: %s)",
                            job.total_strings, game_id, extract_err,
                        )
                    else:
                        raise extract_err
                else:
                    raise extract_err
            except (json.JSONDecodeError, TypeError, ImportError):
                raise extract_err
        else:
            job.status = "error"
            job.error_message = str(extract_err)
            await db.create_job(job_id, game_id, 0)
            await db.update_job(job_id, status="error", error_message=str(extract_err))
            await db.update_game(game_id, status="idle")
            job.broadcast("error", {"message": str(extract_err)})
            return job

    # Apply range filter if specified
    job.start_index = start_index
    job.end_index = end_index

    # Save job to DB
    await db.create_job(job_id, game_id, job.total_strings)
    await db.update_game(game_id, status="translating")

    # TM lookup before translation (if use_memory enabled)
    tm_cache = {}
    if use_memory:
        try:
            _, pending_texts = job.project.get_pending_texts()
            if pending_texts:
                tm_cache = await db.tm_lookup_batch(
                    pending_texts, source_lang=source_lang, target_lang=target_lang
                )
        except Exception as e:
            logger.warning("TM lookup failed for game %s: %s", game_id, e)

    # Launch translation in background thread
    thread = threading.Thread(
        target=_run_translation,
        args=(job, game, provider, api_key, model, source_lang, target_lang, tm_cache),
        daemon=True,
    )
    thread.start()

    return job


def _run_translation(job: TranslationJob, game: dict, provider: str,
                     api_key: str, model: str, source_lang: str,
                     target_lang: str = "ko", tm_cache: dict = None):
    """Run translation in a background thread."""
    try:
        project = job.project
        indices, texts = project.get_pending_texts()

        # Apply range filter if specified
        si = getattr(job, 'start_index', None)
        ei = getattr(job, 'end_index', None)
        if si is not None or ei is not None:
            filtered = [
                (idx, txt) for idx, txt in zip(indices, texts)
                if (si is None or idx >= si) and (ei is None or idx < ei)
            ]
            if filtered:
                indices, texts = zip(*filtered)
                indices = list(indices)
                texts = list(texts)
            else:
                indices, texts = [], []

        if not texts:
            job.status = "completed"
            job.progress = 100
            job.broadcast("complete", {"progress": 100})
            _finalize_job(job, game)
            return

        # --- TM: apply cached translations first ---
        tm_cache = tm_cache or {}
        tm_hits = {}
        ai_indices = []
        ai_texts = []

        if tm_cache and job.use_memory:
            for i, (idx, text) in enumerate(zip(indices, texts)):
                if text in tm_cache:
                    tm_hits[idx] = tm_cache[text]["translated_text"]
                else:
                    ai_indices.append(idx)
                    ai_texts.append(text)

            # Apply TM hits immediately
            if tm_hits:
                hit_indices = list(tm_hits.keys())
                hit_translations = list(tm_hits.values())
                project.apply_translations(hit_indices, hit_translations)

                job.broadcast("progress", {
                    "progress": round(len(tm_hits) / len(texts) * 100, 1),
                    "translated": len(tm_hits),
                    "total": len(texts),
                    "message_key": "tm_cache_applied",
                    "message_args": {"count": len(tm_hits)},
                })
        else:
            ai_indices = list(indices)
            ai_texts = list(texts)

        total_count = len(texts)
        tm_count = len(tm_hits)

        # If all strings were in TM, we're done
        if not ai_texts:
            job.status = "completed"
            job.progress = 100
            job.translated_strings = tm_count
            job.broadcast("complete", {
                "progress": 100,
                "translated": tm_count,
                "total": total_count,
                "message_key": "tm_cache_all_applied",
                "message_args": {"count": tm_count},
            })
            _finalize_job(job, game)
            return

        translator = engine_bridge.create_translator(
            provider=provider,
            api_key=api_key,
            model=model,
            source_lang=source_lang,
        )

        # --- Preset context: build reference_style + glossary from preset ---
        preset_glossary = None
        preset_ctx = getattr(job, 'preset_context', None)
        if preset_ctx:
            # Build reference_style string for the AI
            ref_parts = []

            # Tone
            tone = preset_ctx.get("tone", "")
            tone_labels = {
                "formal": "격식체(합니다/입니다)로 번역하세요.",
                "casual": "반말(해/했어/한다)로 번역하세요.",
                "literary": "문학체(하였다/이었다)로 번역하세요.",
                "game_ui": "게임 UI 스타일로 간결하게 번역하세요.",
            }
            if tone and tone in tone_labels:
                ref_parts.append(f"## 번역 톤\n{tone_labels[tone]}")

            # User instructions
            instructions = preset_ctx.get("instructions", "").strip()
            if instructions:
                ref_parts.append(f"## 사용자 지시사항\n{instructions}")

            # Reference translation pairs
            ref_pairs_json = preset_ctx.get("reference_pairs_json", "[]")
            try:
                ref_pairs = json.loads(ref_pairs_json) if ref_pairs_json else []
            except (json.JSONDecodeError, TypeError):
                ref_pairs = []
            if ref_pairs:
                pair_lines = [f"{p['source']} → {p['target']}" for p in ref_pairs
                              if p.get('source') and p.get('target')]
                if pair_lines:
                    ref_parts.append(
                        "## 번역 예시 - 이 스타일을 참고하세요\n" +
                        "\n".join(pair_lines)
                    )

            if ref_parts:
                translator.reference_style = "\n\n".join(ref_parts)

            # Glossary from preset
            glossary_json = preset_ctx.get("glossary_json", "{}")
            try:
                parsed_glossary = json.loads(glossary_json) if glossary_json else {}
            except (json.JSONDecodeError, TypeError):
                parsed_glossary = {}
            if parsed_glossary:
                preset_glossary = {k: v for k, v in parsed_glossary.items() if v}

        new_translations = []  # Collect for TM save

        def progress_callback(chunk_idx, total_chunks, done_unique, unique_total, message="", **kwargs):
            if job.cancel_event.is_set():
                raise InterruptedError("Translation cancelled")

            # done_unique = unique 텍스트 중 완료 수, total_count = 전체(중복 포함)
            # unique→전체 비율로 진행률 계산
            if unique_total > 0:
                ratio = done_unique / unique_total
            else:
                ratio = 0
            actual_done = tm_count + int(ratio * len(ai_texts))
            job.translated_strings = actual_done
            job.progress = (actual_done / total_count * 100) if total_count > 0 else 0

            # Resolve current entry info for real-time display
            # status_msg 또는 eta_str이 있으면 message로 사용
            display_msg = kwargs.get("status_msg", "") or message
            if not display_msg and kwargs.get("eta_str"):
                display_msg = f"{done_unique}/{unique_total} | {kwargs['eta_str']}"

            current_data = {
                "progress": round(job.progress, 1),
                "translated": actual_done,
                "total": total_count,
                "message": display_msg,
            }
            # Add current entry being translated
            if done_unique > 0 and done_unique <= len(ai_indices):
                cur_pos = done_unique - 1
                cur_idx = ai_indices[cur_pos]
                current_data["current_index"] = cur_idx
                current_data["current_original"] = ai_texts[cur_pos]
                # Check if translation was already applied
                entry = project.entries[cur_idx] if cur_idx < len(project.entries) else None
                if entry and entry.get("translated"):
                    current_data["current_translated"] = entry["translated"]

            job._last_message = display_msg
            job.broadcast("progress", current_data)

            # 5% 이상 변화 시 DB에 진행률 저장
            if job.progress - job._last_persisted_pct >= 5.0 or job.progress >= 99.9:
                job._last_persisted_pct = job.progress
                _persist_progress(job)

        def chunk_done_callback(chunk_indices, chunk_translations):
            project.apply_translations(chunk_indices, chunk_translations)
            # Collect for TM save
            for ci, ct in zip(chunk_indices, chunk_translations):
                if ct and ct.strip():
                    # Find original text for this index
                    try:
                        pos = ai_indices.index(ci)
                        new_translations.append((ai_texts[pos], ct))
                    except ValueError:
                        pass

        translations = translator.translate_all(
            ai_texts,
            progress_callback=progress_callback,
            cancel_event=job.cancel_event,
            chunk_done_callback=chunk_done_callback,
            glossary=preset_glossary,
        )

        # Collect any remaining translations not captured by chunk_done_callback
        if not new_translations:
            for text, trans in zip(ai_texts, translations):
                if trans and trans.strip():
                    new_translations.append((text, trans))

        total_translated = tm_count + len(translations)
        job.status = "completed"
        job.progress = 100
        job.translated_strings = total_translated

        # Dedup statistics from translator
        dedup_stats = getattr(translator, '_last_dedup_stats', None)
        complete_data = {
            "progress": 100,
            "translated": total_translated,
            "total": total_count,
        }
        if dedup_stats:
            complete_data["dedup_stats"] = {
                "total_strings": dedup_stats.get("total", 0),
                "unique_strings": dedup_stats.get("unique", 0),
                "exact_dedup": dedup_stats.get("exact_dedup", 0),
                "fuzzy_dedup": dedup_stats.get("fuzzy_dedup", 0),
                "tm_hits": tm_count,
                "api_calls": len(ai_texts),
                "saved_pct": round(
                    (1 - len(ai_texts) / max(total_count, 1)) * 100, 1
                ),
            }
        job.broadcast("complete", complete_data)

        # --- TM: save new translations ---
        if job.use_memory and new_translations:
            _save_to_tm(job, game, new_translations, source_lang, target_lang, provider, model)

        _finalize_job(job, game)

    except InterruptedError:
        job.status = "cancelled"
        job.broadcast("cancelled", {"message": "Translation cancelled"})
        _finalize_job(job, game, status="cancelled")

    except Exception as e:
        logger.exception("Translation failed for game %s (job %s): %s", game.get("id"), job.job_id, e)
        job.status = "error"
        job.error_message = str(e)
        job.broadcast("error", {"message": str(e)})
        _finalize_job(job, game, status="error", error=str(e))
        # Write detailed context to crash.log for debugging
        _write_translation_crash(job, game, provider, model, e)


def _save_to_tm(job: TranslationJob, game: dict,
                new_translations: list[tuple[str, str]],
                source_lang: str, target_lang: str, provider: str, model: str):
    """Save new AI translations to TM (called from thread)."""
    entries = [
        {
            "source_text": src,
            "translated_text": tgt,
            "source_lang": source_lang,
            "target_lang": target_lang,
            "provider": provider,
            "model": model,
            "context_tag": game.get("engine", ""),
            "game_id": game["id"],
        }
        for src, tgt in new_translations
    ]

    async def _insert():
        count = await db.tm_insert_batch(entries)
        return count

    try:
        loop = job._loop
        if loop and loop.is_running():
            future = asyncio.run_coroutine_threadsafe(_insert(), loop)
            count = future.result(timeout=30)
        else:
            logger.warning("Event loop not running for TM save, creating new loop")
            count = asyncio.run(_insert())

        job.broadcast("progress", {
            "progress": 100,
            "translated": job.translated_strings,
            "total": job.total_strings,
            "message_key": "tm_saved",
            "message_args": {"count": count},
        })
    except Exception as e:
        logger.exception("TM save failed for game %s: %s", game.get("id"), e)
        job.broadcast("warning", {
            "message_key": "tm_save_failed",
            "message_args": {"error": str(e)},
        })


def _persist_progress(job: TranslationJob):
    """비동기로 DB에 현재 진행률 저장 (fire-and-forget)."""
    async def _update():
        await db.update_job(
            job.job_id,
            progress=job.progress,
            translated_strings=job.translated_strings,
        )
    try:
        loop = job._loop
        if loop and loop.is_running():
            asyncio.run_coroutine_threadsafe(_update(), loop)
    except Exception:
        pass  # 실패해도 번역은 계속


def _write_translation_crash(job: TranslationJob, game: dict,
                             provider: str, model: str, exc: Exception):
    """Write detailed translation crash context to crash.log."""
    import traceback as _tb
    data_dir = os.environ.get("GT_DATA_DIR") or os.path.join(
        os.path.dirname(os.path.dirname(__file__)), "data")
    crash_log = os.path.join(data_dir, "crash.log")
    try:
        with open(crash_log, "a", encoding="utf-8") as f:
            f.write(f"\n{'='*60}\n")
            f.write(f"[{datetime.now(timezone.utc).isoformat()}] TRANSLATION CRASH\n")
            f.write(f"Game: {game.get('title', '?')} (id={game.get('id')})\n")
            f.write(f"Engine: {game.get('engine', '?')}\n")
            f.write(f"Provider: {provider} / Model: {model}\n")
            f.write(f"Progress: {job.progress:.1f}% ({job.translated_strings}/{job.total_strings})\n")
            f.write(f"Job: {job.job_id}\n")
            f.write("".join(_tb.format_exception(type(exc), exc, exc.__traceback__)))
    except Exception:
        pass


def _finalize_job(job: TranslationJob, game: dict,
                  status: str = None, error: str = ""):
    """Persist final job state to DB (called from thread)."""
    import asyncio

    final_status = status or job.status
    now = datetime.now(timezone.utc).isoformat()

    async def _persist():
        await db.update_job(
            job.job_id,
            status=final_status,
            progress=job.progress,
            translated_strings=job.translated_strings,
            error_message=error,
            completed_at=now,
        )
        # Set game status based on translation result
        if final_status == "completed":
            game_status = "translated"
        elif final_status in ("cancelled", "error"):
            game_status = "idle"
        else:
            game_status = final_status

        update_fields = {
            "status": game_status,
            "translated_count": job.translated_strings,
        }
        # Sync string_count with actual translatable count so pct is accurate
        if final_status == "completed" and job.total_strings > 0:
            update_fields["string_count"] = job.total_strings

        await db.update_game(game["id"], **update_fields)
        # Save project JSON
        if job.project:
            import json
            entries = [
                {k: v for k, v in e.items()}
                for e in job.project.entries
            ]
            await db.save_project(
                game["id"],
                json.dumps(entries, ensure_ascii=False),
                provider="",
                model="",
            )

    try:
        loop = job._loop
        if loop and loop.is_running():
            asyncio.run_coroutine_threadsafe(_persist(), loop).result(timeout=10)
        else:
            logger.warning("Event loop not running for finalize, creating new loop")
            asyncio.run(_persist())
    except Exception as e:
        logger.exception("Failed to finalize job %s: %s", job.job_id, e)

    # Auto-run QA after successful translation
    if final_status == "completed" and job.project:
        _run_auto_qa(job, game)

    # Release large data to prevent memory leaks (#68)
    job.project = None
    job.resources = None


def _run_auto_qa(job: TranslationJob, game: dict):
    """Run QA checks automatically after translation completes."""
    from . import qa_engine

    try:
        entries = [
            {k: v for k, v in e.items()}
            for e in job.project.entries
        ]
        engine = game.get("engine", "")
        issues = qa_engine.run_all_checks(entries, engine)

        error_count = sum(1 for i in issues if i["severity"] == "error")
        warning_count = sum(1 for i in issues if i["severity"] == "warning")

        async def _save_qa():
            await db.qa_save_results(game["id"], issues)
            await db.update_game(game["id"],
                                 qa_error_count=error_count,
                                 qa_warning_count=warning_count)

        loop = job._loop
        if loop and loop.is_running():
            asyncio.run_coroutine_threadsafe(_save_qa(), loop).result(timeout=10)
        else:
            asyncio.run(_save_qa())

        if error_count or warning_count:
            job.broadcast("qa_complete", {
                "errors": error_count,
                "warnings": warning_count,
                "total": len(issues),
            })
    except Exception as e:
        logger.warning("Auto QA failed for game %s: %s", game.get("id"), e)


def cancel_job(job_id: str) -> bool:
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job and job.status == "running":
        job.cancel_event.set()
        return True
    return False
