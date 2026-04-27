"""Subtitle job manager with SSE broadcasting — mirrors job_manager.py pattern."""

import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
import uuid
from typing import Optional
from datetime import datetime, timezone

from . import db
from . import engine_bridge
from .stt_engine import WhisperAPIEngine, WhisperLocalEngine, extract_audio, STTResult
from .subtitle_formats import Segment, segments_to_ass
from .audio_context import analyze_segments as analyze_audio_context, format_timestamp
from .audio_script_utils import extract_translatable_blocks
from .translation_prompts import build_subtitle_system_prompt, build_subtitle_batch_prompt
from .video_analyzer import extract_sample_frames, extract_audio_sample, analyze_video_context

logger = logging.getLogger(__name__)

_data_dir = os.environ.get("GT_DATA_DIR") or os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")


class SubtitleJob:
    def __init__(self, job_id: str, subtitle_id: int, media_id: int,
                 media_type: str, job_type: str):
        self.job_id = job_id
        self.subtitle_id = subtitle_id
        self.media_id = media_id
        self.media_type = media_type
        self.job_type = job_type
        self.status = "running"
        self.progress = 0.0
        self.error_message = ""
        self.cost_usd = 0.0
        self.cancel_event = threading.Event()
        self._sse_queues: list[asyncio.Queue] = []
        self._sse_lock = threading.Lock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None

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
_jobs: dict[str, SubtitleJob] = {}
_jobs_lock = threading.Lock()
_MAX_FINISHED_JOBS = 20


def _cleanup_finished():
    finished = [jid for jid, j in _jobs.items() if j.status != "running"]
    if len(finished) > _MAX_FINISHED_JOBS:
        for jid in finished[:-_MAX_FINISHED_JOBS]:
            _jobs.pop(jid, None)


def get_job(job_id: str) -> Optional[SubtitleJob]:
    with _jobs_lock:
        return _jobs.get(job_id)


async def start_stt(subtitle_id: int, media_id: int, media_type: str,
                    audio_path: str, provider: str = "whisper_api",
                    api_key: str = "", model: str = "whisper-1",
                    language: str = "") -> SubtitleJob:
    """Start STT job in background thread."""
    job_id = str(uuid.uuid4())
    job = SubtitleJob(job_id, subtitle_id, media_id, media_type, "stt")
    job._loop = asyncio.get_event_loop()

    with _jobs_lock:
        _cleanup_finished()
        _jobs[job_id] = job

    # Create DB job record
    await db.create_subtitle_job(job_id, subtitle_id, media_id, media_type, "stt")
    await db.update_subtitle(subtitle_id, status="transcribing", stt_provider=provider, stt_model=model)

    thread = threading.Thread(
        target=_run_stt,
        args=(job, audio_path, provider, api_key, model, language),
        daemon=True,
    )
    thread.start()
    return job


def _run_stt(job: SubtitleJob, audio_path: str, provider: str,
             api_key: str, model: str, language: str):
    """Run STT in background thread."""
    loop = job._loop
    try:
        if provider == "whisper_api":
            engine = WhisperAPIEngine(api_key=api_key, model=model)
        elif provider == "whisper_local":
            engine = WhisperLocalEngine(model_size=model or "base")
        else:
            raise ValueError(f"Unknown STT provider: {provider}")

        def progress_cb(pct: float, msg: str):
            if job.cancel_event.is_set():
                raise InterruptedError("Cancelled")
            job.progress = pct
            job.broadcast("progress", {"progress": pct, "message": msg})
            # Persist progress
            asyncio.run_coroutine_threadsafe(
                db.update_subtitle_job(job.job_id, progress=pct),
                loop,
            )

        result: STTResult = engine.transcribe(audio_path, language=language, progress_cb=progress_cb)

        if job.cancel_event.is_set():
            raise InterruptedError("Cancelled")

        # Convert to DB segments
        db_segments = [
            {
                "seq": i,
                "start_time": seg.start,
                "end_time": seg.end,
                "original_text": seg.text,
                "confidence": seg.confidence,
            }
            for i, seg in enumerate(result.segments)
        ]

        # Save to DB
        fut = asyncio.run_coroutine_threadsafe(
            db.insert_subtitle_segments(job.subtitle_id, db_segments),
            loop,
        )
        fut.result(timeout=30)

        asyncio.run_coroutine_threadsafe(
            db.update_subtitle(job.subtitle_id,
                               status="transcribed",
                               source_lang=result.language,
                               duration=result.duration,
                               segment_count=len(db_segments)),
            loop,
        ).result(timeout=10)

        job.cost_usd = result.cost_usd
        job.status = "completed"
        job.progress = 1.0

        asyncio.run_coroutine_threadsafe(
            db.update_subtitle_job(job.job_id, status="completed", progress=1.0,
                                    cost_usd=result.cost_usd,
                                    completed_at=datetime.now(timezone.utc).isoformat()),
            loop,
        )

        job.broadcast("complete", {
            "segments": len(db_segments),
            "language": result.language,
            "duration": result.duration,
            "cost_usd": result.cost_usd,
        })

    except InterruptedError:
        job.status = "cancelled"
        job.broadcast("cancelled", {})
        asyncio.run_coroutine_threadsafe(
            db.update_subtitle_job(job.job_id, status="cancelled"),
            loop,
        )
        asyncio.run_coroutine_threadsafe(
            db.update_subtitle(job.subtitle_id, status="pending"),
            loop,
        )

    except Exception as e:
        logger.error("STT job failed: %s", e)
        job.status = "error"
        job.error_message = str(e)
        job.broadcast("error", {"message": str(e)})
        asyncio.run_coroutine_threadsafe(
            db.update_subtitle_job(job.job_id, status="error", error_message=str(e)),
            loop,
        )
        asyncio.run_coroutine_threadsafe(
            db.update_subtitle(job.subtitle_id, status="error"),
            loop,
        )


async def start_subtitle_translate(subtitle_id: int, media_id: int, media_type: str,
                                    source_lang: str = "ja", target_lang: str = "ko",
                                    provider: str = "", api_key: str = "",
                                    model: str = "", context_window: int = 20,
                                    context_overlap: int = 5,
                                    context: str = "",
                                    media_path: str = "") -> SubtitleJob:
    """Start subtitle translation job with context-window batching."""
    job_id = str(uuid.uuid4())
    job = SubtitleJob(job_id, subtitle_id, media_id, media_type, "translate")
    job._loop = asyncio.get_event_loop()

    with _jobs_lock:
        _cleanup_finished()
        _jobs[job_id] = job

    await db.create_subtitle_job(job_id, subtitle_id, media_id, media_type, "translate")
    await db.update_subtitle(subtitle_id, status="translating",
                              source_lang=source_lang, target_lang=target_lang)

    # Load segments
    segments = await db.get_subtitle_segments(subtitle_id)

    thread = threading.Thread(
        target=_run_translate,
        args=(job, segments, source_lang, target_lang, provider, api_key, model,
              context_window, context_overlap, context, media_path),
        daemon=True,
    )
    thread.start()
    return job


def _run_translate(job: SubtitleJob, segments: list[dict],
                   source_lang: str, target_lang: str,
                   provider: str, api_key: str, model: str,
                   window_size: int, overlap: int,
                   context: str = "", media_path: str = ""):
    """Run context-window subtitle translation in background thread."""
    loop = job._loop
    try:
        if not segments:
            raise ValueError("No segments to translate")

        texts = [seg["original_text"] for seg in segments]
        total = len(texts)

        # TM batch lookup
        tm_results = asyncio.run_coroutine_threadsafe(
            db.tm_lookup_batch(texts, source_lang, target_lang),
            loop,
        ).result(timeout=30)

        translated = [""] * total
        need_translate_indices = []
        for i, text in enumerate(texts):
            if text in tm_results:
                translated[i] = tm_results[text]["translated_text"]
            else:
                need_translate_indices.append(i)

        cached = total - len(need_translate_indices)
        if cached > 0:
            job.broadcast("progress", {
                "progress": 0.05,
                "message": f"TM cache hit: {cached}/{total}",
            })

        if need_translate_indices:
            # Analyze audio context (timing gaps, confidence → scene markers)
            audio_contexts = analyze_audio_context(segments)

            translator = engine_bridge.create_translator(
                provider=provider, api_key=api_key, model=model, source_lang=source_lang,
            )

            # Wrap with fallback chain if configured
            settings = asyncio.run_coroutine_threadsafe(
                db.get_settings(), loop,
            ).result(timeout=10)
            fallback_list = settings.get("fallback_providers", [])
            if isinstance(fallback_list, str):
                try: fallback_list = json.loads(fallback_list)
                except (json.JSONDecodeError, TypeError, ValueError): fallback_list = []
            api_keys = settings.get("api_keys", {})
            if isinstance(api_keys, str):
                try: api_keys = json.loads(api_keys)
                except (json.JSONDecodeError, TypeError, ValueError): api_keys = {}
            fallback_configs = [
                {"provider": p, "api_key": api_keys[p]}
                for p in fallback_list
                if p != provider and api_keys.get(p)
            ]
            if fallback_configs:
                from .engine_bridge import FallbackTranslator
                translator = FallbackTranslator(translator, fallback_configs)
                logger.info("Fallback chain: %s → %s", provider, [c["provider"] for c in fallback_configs])

            # Video analysis: auto-generate context if user didn't provide one
            if not context.strip() and media_path:
                try:
                    job.broadcast("progress", {"progress": 0.06, "message": "영상 분석 중..."})
                    logger.info("Starting video analysis for %s", media_path)
                    frames = extract_sample_frames(media_path, count=6)
                    if frames:
                        audio_sample = extract_audio_sample(media_path, duration_sec=30)
                        stt_texts = [seg["original_text"] for seg in segments if seg.get("original_text")]
                        analyzed = analyze_video_context(frames, stt_texts, provider, api_key, model,
                                                         audio_sample=audio_sample)
                        if analyzed and analyzed.strip():
                            context = analyzed.strip()
                            logger.info("Video analysis generated context (%d chars):\n%s", len(context), context)
                            # Auto-generate glossary from analysis
                            _auto_generate_glossary(context, job.subtitle_id, loop)
                    else:
                        logger.info("No frames extracted — skipping video analysis")
                except Exception as e:
                    logger.warning("Video analysis failed (non-fatal): %s", e)

            # Load glossary for this subtitle
            glossary = asyncio.run_coroutine_threadsafe(
                db.get_subtitle_glossary(job.subtitle_id),
                loop,
            ).result(timeout=10)

            # Build subtitle-specific system prompt
            system_prompt = build_subtitle_system_prompt(source_lang, context=context, glossary=glossary or None)

            # Context-window batching (pass translated so context uses target-lang when available)
            batches = _create_context_batches(texts, need_translate_indices, window_size, overlap,
                                              translated=translated)
            done = 0

            for batch_texts, batch_indices, context_count in batches:
                if job.cancel_event.is_set():
                    raise InterruptedError("Cancelled")

                # Split context vs actual texts
                context_lines = batch_texts[:context_count] if context_count > 0 else None
                actual_texts = batch_texts[context_count:] if context_count > 0 else batch_texts

                # Build segment metadata (timing + markers) for actual texts
                seg_meta = []
                for idx in batch_indices:
                    ctx = audio_contexts[idx]
                    seg = segments[idx]
                    seg_meta.append({
                        "start": format_timestamp(seg["start_time"]),
                        "end": format_timestamp(seg["end_time"]),
                        "marker": ctx.marker,
                    })

                results = _translate_batch_with_splitting(
                    translator, actual_texts, system_prompt,
                    source_lang, target_lang,
                    context_lines, seg_meta,
                )

                for idx, trans in zip(batch_indices, results):
                    if trans and trans.strip():
                        translated[idx] = trans.strip()

                done += len(batch_indices)
                pct = 0.1 + 0.8 * (done / len(need_translate_indices))
                job.progress = pct
                job.broadcast("progress", {
                    "progress": pct,
                    "translated": done + cached,
                    "total": total,
                })

                asyncio.run_coroutine_threadsafe(
                    db.update_subtitle_job(job.job_id, progress=pct),
                    loop,
                )

            # Quality validation + retry
            failed_indices = []
            for idx in need_translate_indices:
                if translated[idx]:
                    issues = _validate_translation(texts[idx], translated[idx], source_lang)
                    if issues:
                        logger.warning("Validation issues for segment %d: %s", idx, issues)
                        failed_indices.append(idx)
                elif texts[idx].strip():
                    failed_indices.append(idx)

            if failed_indices:
                logger.info("Quality validation: %d segments need retry", len(failed_indices))
                job.broadcast("progress", {
                    "progress": 0.92,
                    "message": f"품질 검증: {len(failed_indices)}개 재시도...",
                })
                translated = _retry_failed_segments(
                    translator, failed_indices, texts, translated,
                    system_prompt, source_lang, target_lang,
                )

            # Save to TM
            tm_entries = []
            for idx in need_translate_indices:
                if translated[idx]:
                    tm_entries.append({
                        "source_text": texts[idx],
                        "translated_text": translated[idx],
                        "source_lang": source_lang,
                        "target_lang": target_lang,
                        "provider": provider,
                        "model": model,
                        "context_tag": "subtitle",
                    })
            if tm_entries:
                asyncio.run_coroutine_threadsafe(
                    db.tm_insert_batch(tm_entries),
                    loop,
                ).result(timeout=30)

        # Update all segments with translations
        update_segments = []
        for i, seg in enumerate(segments):
            if translated[i]:
                update_segments.append({
                    "seq": seg["seq"],
                    "start_time": seg["start_time"],
                    "end_time": seg["end_time"],
                    "original_text": seg["original_text"],
                    "translated_text": translated[i],
                    "confidence": seg.get("confidence", 0),
                })

        translated_count = len(update_segments)
        logger.info("Subtitle translate: %d/%d segments have translations", translated_count, total)

        if translated_count == 0 and total > 0:
            raise ValueError(f"Translation produced 0 results for {total} segments — check API key/provider")

        if update_segments:
            asyncio.run_coroutine_threadsafe(
                db.insert_subtitle_segments(job.subtitle_id, update_segments),
                loop,
            ).result(timeout=30)

        asyncio.run_coroutine_threadsafe(
            db.update_subtitle(job.subtitle_id, status="translated", target_lang=target_lang),
            loop,
        ).result(timeout=10)

        job.status = "completed"
        job.progress = 1.0
        job.broadcast("complete", {
            "translated": translated_count,
            "total": total,
            "cached": cached,
        })

        asyncio.run_coroutine_threadsafe(
            db.update_subtitle_job(job.job_id, status="completed", progress=1.0,
                                    completed_at=datetime.now(timezone.utc).isoformat()),
            loop,
        )

    except InterruptedError:
        job.status = "cancelled"
        job.broadcast("cancelled", {})
        asyncio.run_coroutine_threadsafe(
            db.update_subtitle_job(job.job_id, status="cancelled"),
            loop,
        )
        asyncio.run_coroutine_threadsafe(
            db.update_subtitle(job.subtitle_id, status="transcribed"),
            loop,
        )

    except Exception as e:
        logger.error("Subtitle translate job failed: %s", e)
        job.status = "error"
        job.error_message = str(e)
        job.broadcast("error", {"message": str(e)})
        asyncio.run_coroutine_threadsafe(
            db.update_subtitle_job(job.job_id, status="error", error_message=str(e)),
            loop,
        )
        asyncio.run_coroutine_threadsafe(
            db.update_subtitle(job.subtitle_id, status="error"),
            loop,
        )


def _auto_generate_glossary(context: str, subtitle_id: int, loop) -> None:
    """Parse video analysis context and auto-generate glossary entries."""
    import re
    entries = []
    # Match patterns like: 원문 → 한국어 or 원문 -> 한국어
    for match in re.finditer(r'([^\s→\->]+)\s*(?:→|->)\s*([^\s,\n→\->]+)', context):
        source = match.group(1).strip().strip('-•·')
        target = match.group(2).strip().strip('-•·')
        if source and target and source != target and len(source) <= 50:
            # Guess category
            category = "general"
            # Check if in character/person section
            line_start = context.rfind('\n', 0, match.start())
            section = context[max(0, line_start - 100):match.start()].lower()
            if '인물' in section or '캐릭터' in section or '등장' in section:
                category = "character"
            elif '장소' in section or '지명' in section:
                category = "place"
            elif '용어' in section or '사전' in section or '고유명사' in section:
                category = "term"
            entries.append({
                "source": source,
                "target": target,
                "category": category,
                "auto_generated": 1,
            })

    if entries:
        try:
            asyncio.run_coroutine_threadsafe(
                db.bulk_upsert_subtitle_glossary(subtitle_id, entries),
                loop,
            ).result(timeout=10)
            logger.info("Auto-generated %d glossary entries from video analysis", len(entries))
        except Exception as e:
            logger.warning("Failed to auto-generate glossary: %s", e)


def _validate_translation(original: str, translated: str, source_lang: str) -> list[str]:
    """Validate a single translation. Returns list of issue codes (empty = pass)."""
    issues = []
    if not translated or not translated.strip():
        issues.append("empty")
        return issues

    orig_len = len(original)
    trans_len = len(translated)
    if orig_len > 0:
        ratio = trans_len / orig_len
        if ratio > 5.0:
            issues.append("length_ratio_high")
        elif ratio < 0.1:
            issues.append("length_ratio_low")

    # Check untranslated source characters
    if source_lang == "ja":
        # Count hiragana/katakana remaining in translation
        import unicodedata
        ja_chars = sum(1 for c in translated if '\u3040' <= c <= '\u309F' or '\u30A0' <= c <= '\u30FF')
        if len(translated) > 0 and ja_chars / len(translated) > 0.3:
            issues.append("untranslated_source_chars")

    # Check format codes preserved
    import re
    orig_codes = set(re.findall(r'\{[^}]+\}|%[sd]|<[^>]+>|\\n|\[br\]', original))
    if orig_codes:
        trans_codes = set(re.findall(r'\{[^}]+\}|%[sd]|<[^>]+>|\\n|\[br\]', translated))
        missing = orig_codes - trans_codes
        if missing:
            issues.append("format_code_missing")

    return issues


def _retry_failed_segments(
    translator, failed_indices: list[int], texts: list[str],
    translated: list[str], system_prompt: str,
    source_lang: str, target_lang: str,
    max_retries: int = 2,
) -> list[str]:
    """Retry failed segments individually, up to max_retries times."""
    from .translation_prompts import build_subtitle_batch_prompt

    result = list(translated)
    for attempt in range(max_retries):
        still_failed = []
        for idx in failed_indices:
            try:
                user_prompt = build_subtitle_batch_prompt(
                    [texts[idx]], source_lang, target_lang,
                )
                response = translator._call_api(user_prompt, system_prompt)
                parsed = _parse_numbered_response(response, 1)
                if parsed[0] and parsed[0].strip():
                    issues = _validate_translation(texts[idx], parsed[0].strip(), source_lang)
                    if not issues or attempt == max_retries - 1:
                        result[idx] = parsed[0].strip()
                    else:
                        still_failed.append(idx)
                else:
                    still_failed.append(idx)
            except Exception as e:
                logger.warning("Retry failed for segment %d: %s", idx, e)
                still_failed.append(idx)

        failed_indices = still_failed
        if not failed_indices:
            break

    return result


def _translate_batch_with_splitting(
    translator, actual_texts: list[str], system_prompt: str,
    source_lang: str, target_lang: str,
    context_lines: list[str] | None, segment_meta: list[dict] | None,
    min_batch_size: int = 1,
) -> list[str]:
    """Translate a batch, recursively splitting on parse failure.

    If parsing succeeds for <50% of the batch, split in half and retry.
    Recurses down to min_batch_size=1.
    """
    from .translation_prompts import build_subtitle_batch_prompt

    try:
        user_prompt = build_subtitle_batch_prompt(
            actual_texts, source_lang, target_lang,
            context_texts=context_lines,
            segment_meta=segment_meta,
        )
        response = translator._call_api(user_prompt, system_prompt)
        logger.info("Subtitle translate response (first 500 chars): %s", response[:500] if response else "(empty)")
        results = _parse_numbered_response(response, len(actual_texts))
        parsed_count = sum(1 for r in results if r)
        logger.info("Parsed %d/%d translations from response", parsed_count, len(actual_texts))

        # Success threshold: >=50% parsed, or batch is already minimal
        if parsed_count >= len(actual_texts) * 0.5 or len(actual_texts) <= min_batch_size:
            return results

        logger.warning("Splitting batch of %d (only %d parsed)", len(actual_texts), parsed_count)
    except Exception as e:
        logger.error("Batch translate error: %s", e, exc_info=True)
        if len(actual_texts) <= min_batch_size:
            return [""] * len(actual_texts)
        logger.warning("Splitting batch of %d after error: %s", len(actual_texts), e)

    # Split in half and recurse
    mid = len(actual_texts) // 2
    left_texts = actual_texts[:mid]
    right_texts = actual_texts[mid:]
    left_meta = segment_meta[:mid] if segment_meta else None
    right_meta = segment_meta[mid:] if segment_meta else None

    left_results = _translate_batch_with_splitting(
        translator, left_texts, system_prompt,
        source_lang, target_lang, context_lines, left_meta, min_batch_size,
    )
    right_results = _translate_batch_with_splitting(
        translator, right_texts, system_prompt,
        source_lang, target_lang, context_lines, right_meta, min_batch_size,
    )
    return left_results + right_results


def _parse_numbered_response(response: str, expected_count: int) -> list[str]:
    """Parse numbered response into a list of translations.

    Handles variations like:
    - [1] translation
    - 1. translation
    - 1) translation
    - [1] (0:00:01~0:00:05) translation  (strips timestamp echo)
    - Markdown code blocks (strips ``` wrappers)
    """
    import re
    results = [""] * expected_count

    # Strip markdown code block wrapper if present
    cleaned = re.sub(r'^```[a-z]*\s*\n?', '', response, flags=re.MULTILINE)
    cleaned = re.sub(r'\n?```\s*$', '', cleaned, flags=re.MULTILINE)

    # Try [N], [nN], [#N] formats
    for match in re.finditer(r'\[(?:n|#)?(\d+)\]\s*(.*)', cleaned, re.IGNORECASE):
        idx = int(match.group(1)) - 1
        if 0 <= idx < expected_count:
            text = match.group(2).strip()
            text = re.sub(r'^\(\d[\d:]*~\d[\d:]*\)\s*', '', text)
            text = re.sub(r'^\[(?:장면 전환|빠른 대화|불분명|독립 발화)\]\s*', '', text)
            results[idx] = text.strip()

    # If [N] format got nothing, try "N." or "N)" format
    if not any(results):
        for match in re.finditer(r'^(\d+)[.)]\s*(.*)', cleaned, re.MULTILINE):
            idx = int(match.group(1)) - 1
            if 0 <= idx < expected_count:
                text = match.group(2).strip()
                text = re.sub(r'^\(\d[\d:]*~\d[\d:]*\)\s*', '', text)
                results[idx] = text.strip()

    # Last resort: split by newlines if we have exactly expected_count non-empty lines
    if not any(results):
        lines = [ln.strip() for ln in cleaned.strip().splitlines() if ln.strip()]
        if len(lines) == expected_count:
            results = lines

    return results


def _create_context_batches(all_texts: list[str], need_indices: list[int],
                             window_size: int, overlap: int,
                             translated: list[str] | None = None,
                             ) -> list[tuple[list[str], list[int], int]]:
    """Create batches with context overlap for better translation quality.

    Returns list of (texts_to_send, actual_batch_indices, context_line_count).
    Context lines are prepended so the translator sees the flow, but we only
    keep translations for the actual batch portion (after context_line_count).

    If `translated` is provided, context lines use the translated version
    (when available) so the AI sees the target-language flow, not raw source.
    """
    batches = []
    i = 0
    while i < len(need_indices):
        batch_end = min(i + window_size, len(need_indices))
        batch_indices = need_indices[i:batch_end]

        # Preceding context lines for flow understanding
        first_idx = batch_indices[0]
        context_start = max(0, first_idx - overlap)
        # Use translated text for context when available (better flow for AI)
        if translated:
            context_texts = [
                translated[j] if translated[j] else all_texts[j]
                for j in range(context_start, first_idx)
            ]
        else:
            context_texts = all_texts[context_start:first_idx]
        context_count = len(context_texts)

        batch_texts = [all_texts[idx] for idx in batch_indices]
        full_texts = context_texts + batch_texts if context_texts else batch_texts

        batches.append((full_texts, batch_indices, context_count))
        i = batch_end

    return batches


# --- Auto Sync (FFT-based) ---


async def start_sync(subtitle_id: int, media_id: int, media_type: str,
                     audio_path: str) -> SubtitleJob:
    """Start subtitle auto-sync job in background thread."""
    job_id = str(uuid.uuid4())
    job = SubtitleJob(job_id, subtitle_id, media_id, media_type, "sync")
    job._loop = asyncio.get_event_loop()

    with _jobs_lock:
        _cleanup_finished()
        _jobs[job_id] = job

    await db.create_subtitle_job(job_id, subtitle_id, media_id, media_type, "sync")

    segments = await db.get_subtitle_segments(subtitle_id)

    thread = threading.Thread(
        target=_run_sync,
        args=(job, segments, audio_path),
        daemon=True,
    )
    thread.start()
    return job


def _run_sync(job: SubtitleJob, segments: list[dict], audio_path: str):
    """Run FFT-based audio sync in background thread."""
    from .audio_sync import compute_sync, apply_sync

    loop = job._loop
    try:
        if not segments:
            raise ValueError("No segments to sync")

        def progress_cb(pct: float, msg: str):
            if job.cancel_event.is_set():
                raise InterruptedError("Cancelled")
            job.progress = pct
            job.broadcast("progress", {"progress": pct, "message": msg})

        result = compute_sync(audio_path, segments, progress_cb=progress_cb)

        if job.cancel_event.is_set():
            raise InterruptedError("Cancelled")

        # Apply sync to segments
        synced = apply_sync(segments, result.offset_ms, result.stretch_factor)

        # Update DB
        for seg in synced:
            asyncio.run_coroutine_threadsafe(
                db.update_subtitle_segment(
                    seg["id"],
                    start_time=seg["start_time"],
                    end_time=seg["end_time"],
                ),
                loop,
            ).result(timeout=5)

        result.segments_updated = len(synced)

        job.status = "completed"
        job.progress = 1.0
        job.broadcast("complete", {
            "offset_ms": result.offset_ms,
            "stretch_factor": result.stretch_factor,
            "confidence": result.confidence,
            "segments_updated": result.segments_updated,
        })

        asyncio.run_coroutine_threadsafe(
            db.update_subtitle_job(job.job_id, status="completed", progress=1.0,
                                    completed_at=datetime.now(timezone.utc).isoformat()),
            loop,
        )

    except InterruptedError:
        job.status = "cancelled"
        job.broadcast("cancelled", {})
        asyncio.run_coroutine_threadsafe(
            db.update_subtitle_job(job.job_id, status="cancelled"),
            loop,
        )

    except Exception as e:
        logger.error("Sync job failed: %s", e)
        job.status = "error"
        job.error_message = str(e)
        job.broadcast("error", {"message": str(e)})
        asyncio.run_coroutine_threadsafe(
            db.update_subtitle_job(job.job_id, status="error", error_message=str(e)),
            loop,
        )


# --- Hardsub (burn-in) ---

HARDSUB_OUTPUT_DIR = os.path.join(_data_dir, "hardsub")
os.makedirs(HARDSUB_OUTPUT_DIR, exist_ok=True)


async def start_hardsub(subtitle_id: int, media_id: int, media_type: str,
                         media_path: str, style_options: dict | None = None) -> SubtitleJob:
    """Start hardsub (subtitle burn-in) job in background thread."""
    job_id = str(uuid.uuid4())
    job = SubtitleJob(job_id, subtitle_id, media_id, media_type, "hardsub")
    job._loop = asyncio.get_event_loop()

    with _jobs_lock:
        _cleanup_finished()
        _jobs[job_id] = job

    await db.create_subtitle_job(job_id, subtitle_id, media_id, media_type, "hardsub")

    segments = await db.get_subtitle_segments(subtitle_id)
    subtitle = await db.get_subtitle(subtitle_id)

    thread = threading.Thread(
        target=_run_hardsub,
        args=(job, segments, subtitle, media_path, style_options or {}),
        daemon=True,
    )
    thread.start()
    return job


def _get_media_duration(media_path: str) -> float:
    """Get media duration in seconds using ffprobe."""
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return 0.0
    try:
        result = subprocess.run(
            [ffprobe, "-v", "quiet", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", media_path],
            capture_output=True, text=True, timeout=30,
        )
        return float(result.stdout.strip())
    except Exception:
        return 0.0


def _run_hardsub(job: SubtitleJob, segments: list[dict],
                  subtitle: dict, media_path: str,
                  style_options: dict | None = None):
    """Run ffmpeg hardsub in background thread."""
    loop = job._loop
    tmp_ass = None
    style = style_options or {}
    try:
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise RuntimeError("ffmpeg not found in PATH")

        if not segments:
            raise ValueError("No segments to burn in")

        # Build ASS content from segments
        seg_objs = [
            Segment(
                seq=s["seq"],
                start_time=s["start_time"],
                end_time=s["end_time"],
                original_text=s.get("original_text", ""),
                translated_text=s.get("translated_text", ""),
                confidence=s.get("confidence", 0),
                pos_x=s.get("pos_x"),
                pos_y=s.get("pos_y"),
            )
            for s in segments
        ]
        ass_content = segments_to_ass(
            seg_objs,
            use_translated=True,
            title=subtitle.get("label", "Untitled"),
            font_name=style.get("font_name", "Arial"),
            font_size=style.get("font_size", 28),
            primary_color=style.get("primary_color", "&H00FFFFFF"),
            outline_color=style.get("outline_color", "&H00000000"),
            outline_width=style.get("outline_width", 2),
            alignment=style.get("alignment", 2),
            margin_v=style.get("margin_v", 30),
        )

        # Write ASS to temp file
        tmp_fd, tmp_ass = tempfile.mkstemp(suffix=".ass")
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
            f.write(ass_content)

        # Get duration for progress tracking
        duration = _get_media_duration(media_path)
        if duration <= 0:
            duration = subtitle.get("duration", 0) or 0

        # Output path
        output_path = os.path.join(
            HARDSUB_OUTPUT_DIR,
            f"hardsub_{job.subtitle_id}_{job.job_id[:8]}.mp4",
        )

        # Build ffmpeg command
        # Use forward slashes for ASS filter path (ffmpeg on Windows needs this)
        ass_filter_path = tmp_ass.replace("\\", "/").replace(":", "\\\\:")
        cmd = [
            ffmpeg, "-y", "-i", media_path,
            "-vf", f"ass={ass_filter_path}",
            "-c:v", "libx264", "-preset", "medium", "-crf", "23",
            "-c:a", "copy",
            "-progress", "pipe:1",
            output_path,
        ]

        logger.info("Hardsub ffmpeg command: %s", " ".join(cmd))

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
        )

        # Store process on job for cancellation
        job._proc = proc

        # Parse progress from stdout (-progress pipe:1 outputs key=value pairs)
        # Use readline() instead of iterator to avoid buffering issues on Windows
        while True:
            line = proc.stdout.readline()
            if not line:
                break  # EOF

            if job.cancel_event.is_set():
                proc.terminate()
                raise InterruptedError("Cancelled")

            line = line.strip()
            if line.startswith("out_time_us="):
                try:
                    time_us = int(line.split("=")[1])
                    time_s = time_us / 1_000_000
                    if duration > 0:
                        pct = min(time_s / duration, 0.99)
                        job.progress = pct
                        job.broadcast("progress", {
                            "progress": pct,
                            "message": f"{int(time_s)}s / {int(duration)}s",
                        })
                        asyncio.run_coroutine_threadsafe(
                            db.update_subtitle_job(job.job_id, progress=pct),
                            loop,
                        )
                except (ValueError, IndexError):
                    pass
            elif line.startswith("progress=end"):
                break

        proc.wait(timeout=120)

        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg exited with code {proc.returncode}")

        if not os.path.exists(output_path):
            raise RuntimeError("Output file was not created")

        output_size = os.path.getsize(output_path)

        job.status = "completed"
        job.progress = 1.0
        job.broadcast("complete", {
            "output_path": output_path,
            "output_size": output_size,
        })

        asyncio.run_coroutine_threadsafe(
            db.update_subtitle_job(job.job_id, status="completed", progress=1.0,
                                    completed_at=datetime.now(timezone.utc).isoformat()),
            loop,
        )

    except InterruptedError:
        job.status = "cancelled"
        job.broadcast("cancelled", {})
        asyncio.run_coroutine_threadsafe(
            db.update_subtitle_job(job.job_id, status="cancelled"),
            loop,
        )

    except Exception as e:
        logger.error("Hardsub job failed: %s", e)
        job.status = "error"
        job.error_message = str(e)
        job.broadcast("error", {"message": str(e)})
        asyncio.run_coroutine_threadsafe(
            db.update_subtitle_job(job.job_id, status="error", error_message=str(e)),
            loop,
        )

    finally:
        # Clean up temp ASS file
        if tmp_ass and os.path.exists(tmp_ass):
            try:
                os.unlink(tmp_ass)
            except OSError:
                pass


# --- Auto-Caption (STT + Translation → Spotify-style lyrics) ---


async def start_auto_caption(audio_id: int, audio_path: str,
                              provider: str, api_key: str, model: str,
                              source_lang: str = "ja", target_lang: str = "ko",
                              stt_provider: str = "whisper_api",
                              stt_api_key: str = "",
                              category_id: Optional[int] = None) -> SubtitleJob:
    """STT + Translation pipeline for audio → saves SRT + translated JSON to audio item."""
    job_id = str(uuid.uuid4())
    job = SubtitleJob(job_id, subtitle_id=-1, media_id=audio_id, media_type="audio", job_type="auto_caption")
    job._loop = asyncio.get_event_loop()

    # Load category glossary once if available
    category_glossary: dict[str, str] = {}
    if category_id:
        try:
            category_glossary = await db.get_category_glossary(int(category_id)) or {}
        except Exception as e:
            logger.warning("Failed to load category glossary for %s: %s", category_id, e)
            category_glossary = {}

    with _jobs_lock:
        _cleanup_finished()
        _jobs[job_id] = job

    thread = threading.Thread(
        target=_run_auto_caption,
        args=(job, audio_id, audio_path, provider, api_key, model,
              source_lang, target_lang, stt_provider, stt_api_key,
              category_id, category_glossary),
        daemon=True,
    )
    thread.start()
    return job


def _segments_to_srt(segments: list[dict], use_translated: bool = False) -> str:
    """Convert segment dicts to SRT format string."""
    def fmt(secs: float) -> str:
        h = int(secs // 3600)
        m = int((secs % 3600) // 60)
        s = int(secs % 60)
        ms = int(round((secs % 1) * 1000))
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    lines = []
    for i, seg in enumerate(segments, 1):
        text = seg.get("translated_text" if use_translated else "original_text", "").strip()
        if not text:
            continue
        lines.append(str(i))
        lines.append(f"{fmt(seg['start_time'])} --> {fmt(seg['end_time'])}")
        lines.append(text)
        lines.append("")
    return "\n".join(lines)


def _run_auto_caption(job: SubtitleJob, audio_id: int, audio_path: str,
                       provider: str, api_key: str, model: str,
                       source_lang: str, target_lang: str,
                       stt_provider: str, stt_api_key: str,
                       category_id: Optional[int] = None,
                       category_glossary: Optional[dict] = None):
    """Run STT + translate in background, save Spotify-style lyrics to audio item."""
    loop = job._loop
    wav_path = None
    try:
        # Step 1: Extract WAV
        job.broadcast("progress", {"progress": 0.02, "message": "오디오 추출 중..."})
        wav_path = audio_path + "_autocaption.wav"
        extract_audio(audio_path, wav_path)

        if job.cancel_event.is_set():
            raise InterruptedError("Cancelled")

        # Step 2: STT
        job.broadcast("progress", {"progress": 0.05, "message": "음성 인식 중 (Whisper)..."})

        if stt_provider == "whisper_api":
            engine = WhisperAPIEngine(api_key=stt_api_key, model="whisper-1")
        else:
            engine = WhisperLocalEngine(model_size=model or "base")

        def stt_progress(pct: float, msg: str):
            if job.cancel_event.is_set():
                raise InterruptedError("Cancelled")
            scaled = 0.05 + pct * 0.40  # 5% → 45%
            job.progress = scaled
            job.broadcast("progress", {"progress": scaled, "message": msg})

        stt_result: STTResult = engine.transcribe(wav_path, language=source_lang if source_lang != "auto" else "", progress_cb=stt_progress)

        if job.cancel_event.is_set():
            raise InterruptedError("Cancelled")

        segments = [
            {
                "seq": i,
                "start_time": seg.start,
                "end_time": seg.end,
                "original_text": seg.text,
                "translated_text": "",
                "confidence": seg.confidence,
            }
            for i, seg in enumerate(stt_result.segments)
        ]
        detected_lang = stt_result.language or source_lang

        if not segments:
            raise ValueError("음성 인식 결과가 없습니다")

        job.broadcast("progress", {"progress": 0.46, "message": f"음성 인식 완료 ({len(segments)}개 대사), 번역 시작..."})

        # Step 3: Translation
        audio_contexts = analyze_audio_context(segments)
        translator = engine_bridge.create_translator(
            provider=provider, api_key=api_key, model=model, source_lang=detected_lang,
        )

        # Load fallback chain from settings
        settings = asyncio.run_coroutine_threadsafe(
            db.get_settings(), loop
        ).result(timeout=10)
        api_keys = settings.get("api_keys", {})
        if isinstance(api_keys, str):
            try:
                api_keys = json.loads(api_keys)
            except Exception:
                api_keys = {}
        fallback_list = settings.get("fallback_providers", [])
        if isinstance(fallback_list, str):
            try:
                fallback_list = json.loads(fallback_list)
            except Exception:
                fallback_list = []
        fallback_configs = [
            {"provider": p, "api_key": api_keys[p]}
            for p in fallback_list
            if p != provider and api_keys.get(p)
        ]
        if fallback_configs:
            translator = engine_bridge.FallbackTranslator(translator, fallback_configs)

        # Convert category glossary dict to list[dict] for prompt builder
        glossary_list = None
        if category_glossary:
            glossary_list = [
                {"source": str(k), "target": str(v), "category": "general"}
                for k, v in category_glossary.items()
            ]

        system_prompt = build_subtitle_system_prompt(detected_lang, context="", glossary=glossary_list)
        texts = [seg["original_text"] for seg in segments]
        need_indices = list(range(len(segments)))

        # TM cache lookup
        tm_results = asyncio.run_coroutine_threadsafe(
            db.tm_lookup_batch(texts, detected_lang, target_lang), loop,
        ).result(timeout=30)
        translated = [""] * len(segments)
        need_translate_indices = []
        for i, text in enumerate(texts):
            if text in tm_results:
                translated[i] = tm_results[text]["translated_text"]
            else:
                need_translate_indices.append(i)

        batches = _create_context_batches(texts, need_translate_indices, window_size=20, overlap=5, translated=translated)
        done = 0
        for batch_texts, batch_indices, context_count in batches:
            if job.cancel_event.is_set():
                raise InterruptedError("Cancelled")
            context_lines = batch_texts[:context_count] if context_count > 0 else None
            actual_texts = batch_texts[context_count:] if context_count > 0 else batch_texts
            seg_meta = []
            for idx in batch_indices:
                ctx = audio_contexts[idx]
                seg = segments[idx]
                seg_meta.append({
                    "start": format_timestamp(seg["start_time"]),
                    "end": format_timestamp(seg["end_time"]),
                    "marker": ctx.marker,
                })
            results = _translate_batch_with_splitting(
                translator, actual_texts, system_prompt,
                detected_lang, target_lang, context_lines, seg_meta,
            )
            for idx, trans in zip(batch_indices, results):
                if trans and trans.strip():
                    translated[idx] = trans.strip()
            done += len(batch_indices)
            pct = 0.46 + 0.46 * (done / max(len(need_translate_indices), 1))
            job.progress = pct
            job.broadcast("progress", {"progress": pct, "translated": done, "total": len(need_translate_indices)})

        # Quality retry
        failed = [i for i in need_translate_indices if translated[i] and _validate_translation(texts[i], translated[i], detected_lang)]
        if failed:
            translated = _retry_failed_segments(translator, failed, texts, translated, system_prompt, detected_lang, target_lang)

        # TM save
        tm_tag = f"audio_cat:{category_id}" if category_id else "audio_caption"
        tm_entries = [
            {"source_text": texts[i], "translated_text": translated[i],
             "source_lang": detected_lang, "target_lang": target_lang,
             "provider": provider, "model": model, "context_tag": tm_tag}
            for i in need_translate_indices if translated[i]
        ]
        if tm_entries:
            asyncio.run_coroutine_threadsafe(db.tm_insert_batch(tm_entries), loop).result(timeout=30)

        # Apply translations to segments
        for i, seg in enumerate(segments):
            seg["translated_text"] = translated[i]

        # Step 4: Convert to SRT + save
        job.broadcast("progress", {"progress": 0.96, "message": "저장 중..."})
        # Filter out empty segments so SRT cue count == translations_json length.
        # Otherwise the frontend cue index and translation index drift apart.
        filtered = [seg for seg in segments if (seg.get("original_text") or "").strip()]
        srt_text = _segments_to_srt(filtered, use_translated=False)
        translations_json = json.dumps([seg["translated_text"] for seg in filtered], ensure_ascii=False)

        asyncio.run_coroutine_threadsafe(
            db.update_audio_item(audio_id, script_text=srt_text, translated_script=translations_json),
            loop,
        ).result(timeout=10)

        job.status = "completed"
        job.progress = 1.0
        job.broadcast("complete", {
            "segments": len(segments),
            "language": detected_lang,
        })

    except InterruptedError:
        job.status = "cancelled"
        job.broadcast("cancelled", {})

    except Exception as e:
        logger.error("Auto-caption job failed: %s", e)
        job.status = "error"
        job.error_message = str(e)
        job.broadcast("error", {"message": str(e)})

    finally:
        if wav_path and os.path.exists(wav_path):
            try:
                os.unlink(wav_path)
            except OSError:
                pass


# ── Audio Bulk Translate ────────────────────────────────────────

class AudioBulkJob:
    """Bulk audio translate job. Independent of SubtitleJob (no game_id/subtitle_id)."""

    def __init__(self, job_id: str, audio_ids: list[int],
                 category_id: Optional[int], mode: str, total: int):
        self.job_id = job_id
        self.audio_ids = audio_ids
        self.category_id = category_id
        self.mode = mode  # "script" | "auto_caption" | "auto"
        self.total = total
        self.done = 0
        self.status = "running"
        self.error_message = ""
        self.current_title = ""
        self.cancel_event = threading.Event()
        self.results: list[dict] = []
        self.item_updates: list[dict] = []
        self._sse_queues: list[asyncio.Queue] = []
        self._sse_lock = threading.Lock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None

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


_audio_bulk_jobs: dict[str, AudioBulkJob] = {}
_audio_bulk_lock = threading.Lock()


def _cleanup_audio_bulk_jobs():
    finished = [jid for jid, j in _audio_bulk_jobs.items() if j.status != "running"]
    if len(finished) > _MAX_FINISHED_JOBS:
        for jid in finished[:-_MAX_FINISHED_JOBS]:
            _audio_bulk_jobs.pop(jid, None)


def get_audio_bulk_job(job_id: str) -> Optional[AudioBulkJob]:
    with _audio_bulk_lock:
        return _audio_bulk_jobs.get(job_id)


def _extract_script_lines(script_text: str) -> list[str]:
    """Block-based extraction; index matches frontend cue index."""
    return extract_translatable_blocks(script_text)


async def start_bulk_audio_translate(
    audio_ids: list[int],
    mode: str,
    source_lang: str,
    target_lang: str,
    provider: str,
    api_key: str,
    model: str,
    stt_provider: str = "whisper_api",
    stt_api_key: str = "",
    use_category_glossary: bool = True,
) -> AudioBulkJob:
    """Start a bulk translate job across multiple audio items."""
    if not audio_ids:
        raise ValueError("audio_ids must not be empty")
    if mode not in ("script", "auto_caption", "auto"):
        raise ValueError(f"invalid mode: {mode}")

    # Determine category_id from the first audio item that has one
    category_id: Optional[int] = None
    for aid in audio_ids:
        item = await db.get_audio_item(aid)
        if item and item.get("category_id"):
            category_id = item["category_id"]
            break

    job_id = str(uuid.uuid4())
    job = AudioBulkJob(job_id, audio_ids, category_id, mode, total=len(audio_ids))
    job._loop = asyncio.get_event_loop()

    with _audio_bulk_lock:
        _cleanup_audio_bulk_jobs()
        _audio_bulk_jobs[job_id] = job

    thread = threading.Thread(
        target=_run_bulk_audio_translate,
        args=(job, source_lang, target_lang, provider, api_key, model,
              stt_provider, stt_api_key, use_category_glossary),
        daemon=True,
    )
    thread.start()
    return job


def _run_bulk_audio_translate(
    job: AudioBulkJob,
    source_lang: str, target_lang: str,
    provider: str, api_key: str, model: str,
    stt_provider: str, stt_api_key: str,
    use_category_glossary: bool,
):
    """Background loop: translate each audio item using existing primitives + category glossary."""
    loop = job._loop
    try:
        # Load category glossary once
        category_glossary: dict[str, str] = {}
        if use_category_glossary and job.category_id:
            fut = asyncio.run_coroutine_threadsafe(
                db.get_category_glossary(job.category_id), loop,
            )
            try:
                category_glossary = fut.result(timeout=10) or {}
            except Exception as e:
                logger.warning("Category glossary load failed: %s", e)

        job.broadcast("progress", {
            "done": 0, "total": job.total, "current_title": "",
            "glossary_size": len(category_glossary),
        })

        for aid in job.audio_ids:
            if job.cancel_event.is_set():
                raise InterruptedError("Cancelled")

            audio = asyncio.run_coroutine_threadsafe(
                db.get_audio_item(aid), loop,
            ).result(timeout=10)

            if not audio:
                job.results.append({"audio_id": aid, "ok": False, "error": "not found"})
                job.done += 1
                job.broadcast("progress", {
                    "done": job.done, "total": job.total,
                    "current_title": f"#{aid} (not found)",
                })
                continue

            title = audio.get("title", "") or f"#{aid}"
            job.current_title = title
            job.broadcast("progress", {
                "done": job.done, "total": job.total,
                "current_title": title,
            })

            # Determine effective mode per-item
            has_script = bool((audio.get("script_text") or "").strip())
            eff_mode = job.mode
            if eff_mode == "auto":
                eff_mode = "script" if has_script else "auto_caption"

            try:
                if eff_mode == "script":
                    result = _bulk_translate_script(
                        audio, source_lang, target_lang, provider, api_key, model,
                        category_glossary, loop, job.cancel_event,
                    )
                else:
                    result = _bulk_auto_caption(
                        audio, source_lang, target_lang, provider, api_key, model,
                        stt_provider, stt_api_key, category_glossary, loop, job.cancel_event,
                    )
                job.results.append({"audio_id": aid, "ok": True, "mode": eff_mode, **result})
                if result.get("item"):
                    job.item_updates.append(result["item"])
            except InterruptedError:
                raise
            except Exception as e:
                logger.error("Bulk translate failed for audio %d: %s", aid, e)
                job.results.append({"audio_id": aid, "ok": False, "error": str(e)})

            job.done += 1
            job.broadcast("progress", {
                "done": job.done, "total": job.total,
                "current_title": title,
            })

        job.status = "completed"
        job.broadcast("complete", {
            "results": job.results,
            "item_updates": job.item_updates,
            "done": job.done,
            "total": job.total,
        })

    except InterruptedError:
        job.status = "cancelled"
        job.broadcast("cancelled", {
            "done": job.done, "total": job.total,
            "results": job.results,
            "item_updates": job.item_updates,
        })
    except Exception as e:
        logger.error("Bulk audio translate failed: %s", e)
        job.status = "error"
        job.error_message = str(e)
        job.broadcast("error", {"message": str(e)})


def _bulk_translate_script(
    audio: dict, source_lang: str, target_lang: str,
    provider: str, api_key: str, model: str,
    category_glossary: dict, loop, cancel_event: threading.Event,
) -> dict:
    """Translate an audio item's existing script_text. Mirrors routers/audio.translate_audio_script."""
    script_text = (audio.get("script_text") or "").strip()
    if not script_text:
        raise ValueError("no script_text")

    lines = _extract_script_lines(script_text)
    if not lines:
        raise ValueError("no translatable lines")

    tm_results = asyncio.run_coroutine_threadsafe(
        db.tm_lookup_batch(lines, source_lang, target_lang), loop,
    ).result(timeout=30)

    translated = []
    ai_indices: list[int] = []
    ai_texts: list[str] = []
    for i, line in enumerate(lines):
        if line in tm_results:
            translated.append(tm_results[line]["translated_text"])
        else:
            translated.append("")
            ai_indices.append(i)
            ai_texts.append(line)

    cached = len(lines) - len(ai_texts)

    if ai_texts:
        if cancel_event.is_set():
            raise InterruptedError("Cancelled")
        translator = engine_bridge.create_translator(
            provider=provider, api_key=api_key, model=model, source_lang=source_lang,
        )
        try:
            ai_results = translator.translate_all(ai_texts, glossary=category_glossary or None)
        except TypeError:
            # Older translator without glossary kwarg fallback
            ai_results = translator.translate_all(ai_texts)

        tm_entries = []
        cat_id = audio.get("category_id")
        context_tag = f"audio_cat:{cat_id}" if cat_id else "audio_script"
        for idx, ai_trans in zip(ai_indices, ai_results):
            if ai_trans and ai_trans.strip():
                translated[idx] = ai_trans
                tm_entries.append({
                    "source_text": lines[idx],
                    "translated_text": ai_trans,
                    "source_lang": source_lang,
                    "target_lang": target_lang,
                    "provider": provider,
                    "model": model,
                    "context_tag": context_tag,
                })
        if tm_entries:
            asyncio.run_coroutine_threadsafe(
                db.tm_insert_batch(tm_entries), loop,
            ).result(timeout=30)

    updated = asyncio.run_coroutine_threadsafe(
        db.update_audio_item(
            audio["id"],
            translated_script=json.dumps(translated, ensure_ascii=False),
        ),
        loop,
    ).result(timeout=10)

    return {
        "total": len(lines),
        "cached": cached,
        "translated": len([t for t in translated if t]),
        "item": updated,
    }


def _bulk_auto_caption(
    audio: dict, source_lang: str, target_lang: str,
    provider: str, api_key: str, model: str,
    stt_provider: str, stt_api_key: str,
    category_glossary: dict, loop, cancel_event: threading.Event,
) -> dict:
    """STT + translate a single audio. Simplified inline version of _run_auto_caption, with glossary support."""
    if audio.get("type") != "local":
        raise ValueError("only local audio supported")
    audio_path = audio.get("source", "")
    if not audio_path or not os.path.isfile(audio_path):
        raise ValueError(f"audio file not found: {audio_path}")

    wav_path = audio_path + "_bulkcaption.wav"
    try:
        extract_audio(audio_path, wav_path)
        if cancel_event.is_set():
            raise InterruptedError("Cancelled")

        if stt_provider == "whisper_api":
            engine = WhisperAPIEngine(api_key=stt_api_key, model="whisper-1")
        else:
            engine = WhisperLocalEngine(model_size=model or "base")

        def stt_progress(pct: float, msg: str):
            if cancel_event.is_set():
                raise InterruptedError("Cancelled")

        stt_result: STTResult = engine.transcribe(
            wav_path,
            language=source_lang if source_lang != "auto" else "",
            progress_cb=stt_progress,
        )
        if cancel_event.is_set():
            raise InterruptedError("Cancelled")

        segments = [
            {
                "seq": i,
                "start_time": seg.start,
                "end_time": seg.end,
                "original_text": seg.text,
                "translated_text": "",
                "confidence": seg.confidence,
            }
            for i, seg in enumerate(stt_result.segments)
        ]
        if not segments:
            raise ValueError("STT returned no segments")

        detected_lang = stt_result.language or source_lang
        texts = [seg["original_text"] for seg in segments]

        # TM cache
        tm_results = asyncio.run_coroutine_threadsafe(
            db.tm_lookup_batch(texts, detected_lang, target_lang), loop,
        ).result(timeout=30)
        translated = [""] * len(segments)
        need_indices: list[int] = []
        need_texts: list[str] = []
        for i, text in enumerate(texts):
            if text in tm_results:
                translated[i] = tm_results[text]["translated_text"]
            else:
                need_indices.append(i)
                need_texts.append(text)

        if need_texts:
            if cancel_event.is_set():
                raise InterruptedError("Cancelled")
            translator = engine_bridge.create_translator(
                provider=provider, api_key=api_key, model=model, source_lang=detected_lang,
            )
            try:
                ai_results = translator.translate_all(need_texts, glossary=category_glossary or None)
            except TypeError:
                ai_results = translator.translate_all(need_texts)

            tm_entries = []
            cat_id = audio.get("category_id")
            context_tag = f"audio_cat:{cat_id}" if cat_id else "audio_caption"
            for idx, ai_trans in zip(need_indices, ai_results):
                if ai_trans and ai_trans.strip():
                    translated[idx] = ai_trans.strip()
                    tm_entries.append({
                        "source_text": texts[idx],
                        "translated_text": ai_trans.strip(),
                        "source_lang": detected_lang,
                        "target_lang": target_lang,
                        "provider": provider,
                        "model": model,
                        "context_tag": context_tag,
                    })
            if tm_entries:
                asyncio.run_coroutine_threadsafe(
                    db.tm_insert_batch(tm_entries), loop,
                ).result(timeout=30)

        for i, seg in enumerate(segments):
            seg["translated_text"] = translated[i]

        # Filter empty segments to keep SRT cue count aligned with translations_json.
        filtered = [seg for seg in segments if (seg.get("original_text") or "").strip()]
        srt_text = _segments_to_srt(filtered, use_translated=False)
        translations_json = json.dumps(
            [seg["translated_text"] for seg in filtered], ensure_ascii=False,
        )
        updated = asyncio.run_coroutine_threadsafe(
            db.update_audio_item(
                audio["id"],
                script_text=srt_text,
                translated_script=translations_json,
            ),
            loop,
        ).result(timeout=10)

        return {
            "segments": len(segments),
            "language": detected_lang,
            "translated": len([t for t in translated if t]),
            "item": updated,
        }

    finally:
        if os.path.exists(wav_path):
            try:
                os.unlink(wav_path)
            except OSError:
                pass
