"""Pydantic models for request/response validation."""

from pydantic import BaseModel, Field
from typing import Optional


# --- Games ---

class GameCreate(BaseModel):
    path: str
    title: Optional[str] = ""
    exe_path: Optional[str] = ""
    engine: Optional[str] = ""
    source_lang: str = "auto"
    variant_lang: Optional[str] = ""


class GameUpdate(BaseModel):
    title: Optional[str] = None
    exe_path: Optional[str] = None
    engine: Optional[str] = None
    cover_path: Optional[str] = None
    source_lang: Optional[str] = None
    status: Optional[str] = None
    aes_key: Optional[str] = None
    folder_id: Optional[int] = None


class GameResponse(BaseModel):
    id: int
    title: str
    path: str
    exe_path: str = ""
    engine: str = ""
    cover_path: str = ""
    string_count: int = 0
    translated_count: int = 0
    source_lang: str = "auto"
    status: str = "idle"
    last_played_at: Optional[str] = None
    play_time_minutes: int = 0
    created_at: str
    updated_at: str


# --- Translation ---

class TranslateRequest(BaseModel):
    provider: str = "claude"
    model: str = ""
    source_lang: str = "auto"
    target_lang: str = "ko"
    preset_id: Optional[int] = None
    start_index: Optional[int] = None  # 0-based inclusive
    end_index: Optional[int] = None    # exclusive


class TranslateStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: float = 0
    total_strings: int = 0
    translated_strings: int = 0
    error_message: str = ""


# --- Settings ---

class SettingsUpdate(BaseModel):
    api_keys: Optional[dict[str, str]] = None
    scan_directories: Optional[list[str]] = None
    default_provider: Optional[str] = None
    default_source_lang: Optional[str] = None
    license_key: Optional[str] = None
    fallback_providers: Optional[list[str]] = None


# --- Directory Scan ---

class ScanDirectoryRequest(BaseModel):
    path: str


class ScanDirectoryResult(BaseModel):
    title: str
    path: str
    exe_path: str = ""
    engine: str = ""


class SubtitleImportRequest(BaseModel):
    files: list[str]
    title: str = ""
    source_lang: str = "auto"


# --- String editing ---

_VALID_STATUSES = {"pending", "translated", "reviewed"}
_VALID_REVIEW_STATUSES = {"", "approved", "needs_revision", "flagged"}


class BulkUpdateStringsRequest(BaseModel):
    indices: list[int] = Field(..., max_length=5000)
    status: Optional[str] = None
    review_status: Optional[str] = None
    reviewer_note: Optional[str] = None

    def validated_fields(self) -> dict:
        fields: dict = {}
        if self.status is not None:
            if self.status not in _VALID_STATUSES:
                raise ValueError(f"Invalid status: {self.status}")
            fields["status"] = self.status
        if self.review_status is not None:
            if self.review_status not in _VALID_REVIEW_STATUSES:
                raise ValueError(f"Invalid review_status: {self.review_status}")
            fields["review_status"] = self.review_status
        if self.reviewer_note is not None:
            fields["reviewer_note"] = self.reviewer_note[:2000]
        return fields


# --- Agent ---

class AgentStartRequest(BaseModel):
    api_key: str
    provider: str = ""  # claude, openai, gemini, deepseek — auto-detect from model if empty
    model: str = "claude-sonnet-4-20250514"
    max_turns: int = 20
    instructions: str = ""


class UpdateStringRequest(BaseModel):
    translated: Optional[str] = None
    status: Optional[str] = None
    review_status: Optional[str] = None
    reviewer_note: Optional[str] = None

    def validated_fields(self) -> dict:
        fields: dict = {}
        if self.translated is not None:
            fields["translated"] = self.translated[:50000]
        if self.status is not None:
            if self.status not in _VALID_STATUSES:
                raise ValueError(f"Invalid status: {self.status}")
            fields["status"] = self.status
        if self.review_status is not None:
            if self.review_status not in _VALID_REVIEW_STATUSES:
                raise ValueError(f"Invalid review_status: {self.review_status}")
            fields["review_status"] = self.review_status
        if self.reviewer_note is not None:
            fields["reviewer_note"] = self.reviewer_note[:2000]
        return fields
