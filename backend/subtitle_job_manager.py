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
