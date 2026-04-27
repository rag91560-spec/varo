# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for Game Translator backend."""

import os
from PyInstaller.utils.hooks import collect_submodules, collect_data_files

block_cipher = None

backend_submodules = collect_submodules("backend")
openai_submodules = collect_submodules("openai")
anthropic_submodules = collect_submodules("anthropic")

# Collect rapidocr ONNX models + config
rapidocr_datas = collect_data_files("rapidocr_onnxruntime", include_py_files=False)

a = Analysis(
    ["backend/main.py"],
    pathex=[],
    binaries=[],
    datas=[*rapidocr_datas],
    hiddenimports=[
        *backend_submodules,
        # uvicorn internals
        "uvicorn",
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        # starlette / fastapi
        "starlette",
        "starlette.responses",
        "starlette.routing",
        "starlette.middleware",
        "starlette.middleware.cors",
        "starlette.staticfiles",
        # async DB
        "aiosqlite",
        # multipart form parsing
        "multipart",
        "python_multipart",
        # network / image / android
        "httpx",
        "PIL",
        "pyaxmlparser",
        # OCR (bundled)
        "rapidocr_onnxruntime",
        "onnxruntime",
        "cv2",
        # AI providers (loaded at runtime by ue_translator.py)
        *openai_submodules,
        *anthropic_submodules,
        # pydantic
        "pydantic",
        # email-validator (optional for pydantic)
        "email_validator",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter",
        "matplotlib",
        "scipy",
        "pandas",
        "pytest",
        # torch is a 4GB optional fallback — excluded from build bundle
        "torch",
        "torchaudio",
        "torchvision",
        "torch._C",
        "torch.distributions",
        "torch.nn",
        "torch.optim",
        "torch.utils",
    ],
    noarchive=False,
    optimize=0,
    cipher=block_cipher,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="backend-dist",
)
