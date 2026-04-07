"""Offline translation using NLLB-600M (CTranslate2 + tokenizers).

Uses the lightweight `tokenizers` library instead of `transformers` to avoid torch dependency.
"""

import logging
import os

logger = logging.getLogger(__name__)

_translator = None
_tokenizer = None

# NLLB language codes
NLLB_LANG_MAP = {
    "ja": "jpn_Jpan",
    "ko": "kor_Hang",
    "en": "eng_Latn",
    "zh": "zho_Hans",
    "zh-cn": "zho_Hans",
    "zh-tw": "zho_Hant",
}

# Special token IDs (NLLB standard)
_EOS_ID = 2  # </s>
_SPECIAL_IDS = {0, 1, 2, 3}  # <s>, <pad>, </s>, <unk>
# Language code token IDs to filter from output (target prefix tokens)
_LANG_TOKEN_IDS: set[int] = set()

_APPDATA = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".local", "share")
MODEL_DIR = os.path.join(_APPDATA, "게임번역기", "models", "nllb-600m-game-v1")


def _load():
    global _translator, _tokenizer
    if _translator is not None:
        return

    if not os.path.isdir(MODEL_DIR):
        raise RuntimeError(f"NLLB model not found at {MODEL_DIR}. Download it from the Models page.")

    tokenizer_path = os.path.join(MODEL_DIR, "tokenizer.json")
    if not os.path.isfile(tokenizer_path):
        raise RuntimeError(f"tokenizer.json not found at {MODEL_DIR}")

    try:
        # Import only the core C extension to avoid ctranslate2 → transformers → torch chain
        import ctranslate2._ext as _ct2
        from tokenizers import Tokenizer

        logger.info("Loading NLLB model from %s", MODEL_DIR)
        _translator = _ct2.Translator(MODEL_DIR, device="cpu", compute_type="int8")
        _tokenizer = Tokenizer.from_file(tokenizer_path)
        # Cache language token IDs for filtering from output
        for lang_code in NLLB_LANG_MAP.values():
            lid = _tokenizer.token_to_id(lang_code)
            if lid is not None:
                _LANG_TOKEN_IDS.add(lid)
        logger.info("NLLB model loaded")
    except Exception as e:
        logger.error("Failed to load NLLB model: %s", e)
        _translator = None
        _tokenizer = None
        raise RuntimeError(f"NLLB 모델 로딩 실패: {e}")


def _tokenize(text: str, src_lang_code: str) -> list[str]:
    """Tokenize text with NLLB format: [src_lang] + tokens + [eos]."""
    src_lang_id = _tokenizer.token_to_id(src_lang_code)
    enc = _tokenizer.encode(text)
    # Prepend source language token
    input_ids = [src_lang_id] + enc.ids
    return [_tokenizer.id_to_token(i) for i in input_ids]


def _detokenize(tokens: list[str]) -> str:
    """Convert output tokens back to text, skipping special and language tokens."""
    output_ids = []
    for t in tokens:
        tid = _tokenizer.token_to_id(t)
        if tid is not None and tid not in _SPECIAL_IDS and tid not in _LANG_TOKEN_IDS:
            output_ids.append(tid)
    return _tokenizer.decode(output_ids)


def translate(text: str, source_lang: str = "ja", target_lang: str = "ko") -> str:
    """Translate text using offline NLLB model."""
    _load()

    src_code = NLLB_LANG_MAP.get(source_lang)
    tgt_code = NLLB_LANG_MAP.get(target_lang)
    if not src_code:
        raise ValueError(f"Unsupported source language for offline: {source_lang}")
    if not tgt_code:
        raise ValueError(f"Unsupported target language for offline: {target_lang}")

    input_tokens = _tokenize(text, src_code)
    target_prefix = [_tokenizer.id_to_token(_tokenizer.token_to_id(tgt_code))]

    results = _translator.translate_batch(
        [input_tokens],
        target_prefix=[target_prefix],
        max_decoding_length=256,
        beam_size=4,
    )

    return _detokenize(results[0].hypotheses[0])


def translate_batch(texts: list[str], source_lang: str = "ja", target_lang: str = "ko") -> list[str]:
    """Translate multiple texts at once (efficient batching)."""
    _load()

    src_code = NLLB_LANG_MAP.get(source_lang)
    tgt_code = NLLB_LANG_MAP.get(target_lang)
    if not src_code or not tgt_code:
        raise ValueError(f"Unsupported language pair: {source_lang} -> {target_lang}")

    all_input_tokens = [_tokenize(text, src_code) for text in texts]
    target_prefix_token = _tokenizer.id_to_token(_tokenizer.token_to_id(tgt_code))
    target_prefixes = [[target_prefix_token]] * len(texts)

    results = _translator.translate_batch(
        all_input_tokens,
        target_prefix=target_prefixes,
        max_decoding_length=256,
        beam_size=4,
    )

    return [_detokenize(r.hypotheses[0]) for r in results]


def is_available() -> bool:
    """Check if the NLLB model is installed."""
    return os.path.isdir(MODEL_DIR)
