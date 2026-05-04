<div align="center">

# Varo

### AI-powered translator for Japanese games, manga & video subtitles

<!-- Badges: replace URLs when project name is finalized -->
[![Download](https://img.shields.io/badge/Download-Latest-brightgreen?style=for-the-badge)](https://api.closedclaws.com/api/download/launcher)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/a6FXkPrFAZ)
[![Fanbox](https://img.shields.io/badge/Fanbox-Support-FF424D)](https://rag91560.fanbox.cc/)
[![Patreon](https://img.shields.io/badge/Patreon-Support-FF424D?logo=patreon&logoColor=white)](https://www.patreon.com/c/rag91560)

<!-- TODO: Replace with a 15s hero demo (Before → After translation, any engine) -->
![Hero Demo](docs/hero.gif)

**[English](#english) · [한국어](#한국어)**

</div>

---

<a name="english"></a>

## What is this?

Drop a Japanese game folder → click translate → play in your language. No manual text ripping, no fan-patch hunting, no IDE required.

**Free and open source (MIT).** Offline NLLB translation works out of the box, forever, with zero cost.
If you want **higher-quality AI translation** (Claude / GPT / Gemini), an optional license is available — but it's never required.

- 🎮 **Multiple game engines** auto-detected (6 stable, 7+ beta — see table below)
- 🤖 **Multi-AI** — Claude, GPT, Gemini, or free offline NLLB
- 📚 **Beyond games** — manga panels, video subtitles, text scripts
- 🔄 **Reversible** — one-click rollback to original files anytime
- 🔐 **Local-first** — runs on your machine, no game data uploaded

---

## 🎥 Demo

<!-- TODO: Add 3-5 short clips (~15s each). Strong contenders: RPG Maker MV, Unreal, Kirikiri, manga, subtitle -->

|  |  |
|--|--|
| ![RPG Maker MV](docs/demo-rpgmaker.gif) | ![Unreal Engine](docs/demo-ue.gif) |
| **RPG Maker MV** — JRPG | **Unreal Engine** — 3D game |
| ![Kirikiri](docs/demo-kirikiri.gif) | ![Manga](docs/demo-manga.gif) |
| **Kirikiri** — Visual novel | **Manga** — Panel-by-panel OCR |

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **Auto Engine Detection** | Scans any folder and identifies the engine in seconds |
| **AI Translation** | Free offline NLLB baseline; Claude / GPT / Gemini via license |
| **Translation Memory** | Reuses past translations for consistency across sessions |
| **Glossary** | Lock proper nouns, character names, custom terms |
| **Translation Presets** | Save per-game or per-engine settings, reuse instantly |
| **Live Progress (SSE)** | Real-time translation progress in the UI |
| **One-Click Apply / Rollback** | Apply to the game and undo anytime |
| **File Structure Flowchart** | Visualize game file tree as an interactive flow |
| **Auto Updates** | Electron-based, ships new engine support automatically |

---

## 🎯 Supported Engines

Real game testing required. Help us verify more engines.

| Engine | Status |
|--------|--------|
| RPG Maker (MV, MZ, VX Ace, XP, 2000/2003) | ✅ Stable |
| Wolf RPG Editor | ✅ Stable |
| Unity (IL2CPP / Mono) | ✅ Stable |
| Unreal Engine | ✅ Stable |
| MuMu | ✅ Stable |
| DXLib | ✅ Stable |
| GDevelop | 🧪 Beta |
| TyranoScript / TyranoBuilder | 🧪 Beta — needs testing |
| Kirikiri (KAG3 / KS) | 🧪 Beta — needs testing |
| Ren'Py | 🧪 Beta — needs testing |
| RPG in a Box | 🧪 Beta — needs testing |
| LiveMaker / LiveNovel | 🧪 Beta — needs testing |
| SystemNNN / NScripter | 🧪 Beta — needs testing |
| YU-RIS | 🧪 Beta — needs testing |

> **Beta engines have parsing/translation code, but real-game testing is limited.**
> If you have a game using one of these engines, please [open an issue](../../issues/new) or report in [Discord](https://discord.gg/a6FXkPrFAZ) — bugs get fixed as reports come in.

> Don't see your engine? [Open an issue](../../issues/new) — engines are added based on demand.

---

## 🔬 Why this isn't a wrapper

This is **not** a bundle of existing translation tools (no XUnity AutoTranslator, no RPGMakerTrans, no third-party patchers).
Each engine required reverse-engineering its custom format from scratch:

- **MuMu** — SDB byte-offset preservation, KEY30 XOR analysis
- **DXLib** — Custom encryption analysis (Nandemoya format, 119 dialogues)
- **Unity** — AssetBundle resize without breaking integrity (`set_raw_data + sf.save`)
- **Unreal** — Font fallback + CJK embedding for non-CJK builds
- **Wolf RPG** — Custom binary text extraction
- **GDevelop** — Auto Korean font replacement
- **RPG Maker** — Direct save data manipulation, encoding handling

Built from binary analysis up. AI is used for translation quality (Claude / GPT / NLLB), not for the extraction layer.

---

## 🚀 Quick Start (for Players)

### ⬇️ Direct Download

**[Download the latest launcher (always up-to-date)](https://api.closedclaws.com/api/download/launcher)**

This link always serves the newest build — no need to refresh bookmarks after updates.

Or grab it from [Fanbox (free public post)](https://rag91560.fanbox.cc/) / [Patreon](https://www.patreon.com/c/rag91560).

### Install
1. **Run** the Windows installer (macOS/Linux planned)
2. **Open** the launcher, drag your game folder, click **Translate**
3. **Play**

**That's it — you're done.** Offline NLLB translation works without any license, no signup, no limits.

If the offline translation quality isn't enough for your game and you want Claude / GPT / Gemini quality, see [Optional Premium](#-optional-premium) below.

---

## 🛠 For Developers

### Prerequisites
- Node.js 20+
- Python 3.10+
- npm

### Development
```bash
# Install dependencies
npm install
pip install -r backend/requirements.txt

# Next.js dev server (port 3100)
npm run dev

# Electron dev (separate terminal)
npm run electron:dev
```

### Production Build
```bash
npm run electron:build
# Output → dist-electron/
```

### Tech Stack

| Area | Tech |
|------|------|
| Frontend | Next.js 16, React 19, TypeScript 5, Tailwind CSS 4 |
| Desktop | Electron 35 |
| Backend | Python FastAPI |
| UI | CVA (Class Variance Authority), Lucide Icons |
| Visualization | @xyflow/react |

### Project Structure
```
app/           # Next.js pages & routing
backend/       # Python FastAPI backend
  routers/     # API routers (games, translate, covers, etc.)
components/
  ui/          # Shared UI components (CVA pattern)
  game-detail/ # Game detail domain components
  layout/      # Layout (Sidebar, etc.)
electron/      # Electron main/preload
hooks/         # Custom React hooks
lib/           # Utilities (api.ts, types.ts, i18n.ts)
scripts/       # Build scripts
```

> The translation engine itself (`ue-translator`) is proprietary and distributed with paid builds. This repo contains the launcher, UI, and engine adapters.

---

## 💎 Optional Premium

The free offline NLLB engine handles most games. If you want **higher-quality AI translation** with full context awareness, an optional license unlocks Claude / GPT / Gemini through your own API budget covered by the engine fee.

|  | Monthly | Yearly | Lifetime |
|--|---------|--------|----------|
| **JPY** ([Fanbox](https://rag91560.fanbox.cc/)) | ¥500 | ¥2,000 | ¥3,000 |
| **USD** ([Patreon](https://www.patreon.com/c/rag91560)) | $5 | $20 | $30 |

Think of it as an engine usage fee — keeps the project alive and funds new engine support. **Never required to use Varo.**

---

## 🌐 Community & Support

- 💬 **Discord** — [Join the server](https://discord.gg/a6FXkPrFAZ) for support, feature requests, and game compatibility reports
- 🐛 **Bugs & Features** — [GitHub Issues](../../issues)
- ❤️ **Support Development** — [Fanbox](https://rag91560.fanbox.cc/) or [Patreon](https://www.patreon.com/c/rag91560)

Solo developer with Claude AI assistance for code.

---

## ⚖️ Disclaimer

Varo is a **translation tool**. It does not contain, redistribute, or modify any copyrighted game content on its own.

By using Varo, you agree that:

- You own a **legitimate copy** of any game you translate.
- Translation is for your **personal, private use** only.
- You **will not redistribute, sell, or publicly share** translated game files, patches, or extracted content.
- You are solely responsible for compliance with the game's EULA, your local copyright law, and any applicable DRM regulations.

The developer assumes no liability for misuse. Copyright holders requesting removal of specific engine modules: see [LEGAL.md](LEGAL.md). Takedowns are honored within 24 hours.

---

## License

[MIT](LICENSE) — launcher, UI, and engine adapters.
Translation engine binary (`ue-translator`) is proprietary and distributed with paid builds.

---

<a name="한국어"></a>

# 한국어

## 이게 뭔가요?

일본 게임 폴더 드래그 → 번역 클릭 → 한국어로 플레이. 수동 텍스트 추출, 비공식 패치 찾기, 개발 환경 세팅 전부 **불필요**합니다.

**무료 오픈소스 (MIT).** 오프라인 NLLB 번역은 라이선스 없이 영구 무료로 작동합니다.
**더 좋은 품질의 AI 번역** (Claude / GPT / Gemini) 을 원하시면 선택적으로 라이선스를 결제하실 수 있지만, 의무 사항은 아닙니다.

- 🎮 **여러 게임 엔진** 자동 감지 (안정 6종, 베타 7종+ — 아래 표 참조)
- 🤖 **멀티 AI** — Claude, GPT, Gemini, 또는 오프라인 NLLB (무료)
- 📚 **게임 외에도** — 만화 번역(OCR), 영상 자막, 텍스트 스크립트
- 🔄 **되돌리기 가능** — 원클릭 롤백 언제든
- 🔐 **로컬 우선** — 게임 데이터 외부 업로드 없음

## 🎯 지원 엔진

실제 게임 테스트가 필요합니다. 베타 엔진 검증에 도움 부탁드려요.

| 엔진 | 상태 |
|--------|--------|
| RPG Maker (MV, MZ, VX Ace, XP, 2000/2003) | ✅ 안정 |
| Wolf RPG Editor | ✅ 안정 |
| Unity (IL2CPP / Mono) | ✅ 안정 |
| Unreal Engine | ✅ 안정 |
| MuMu | ✅ 안정 |
| DXLib | ✅ 안정 |
| GDevelop | 🧪 베타 |
| TyranoScript / TyranoBuilder | 🧪 베타 — 테스트 필요 |
| Kirikiri (KAG3 / KS) | 🧪 베타 — 테스트 필요 |
| Ren'Py | 🧪 베타 — 테스트 필요 |
| RPG in a Box | 🧪 베타 — 테스트 필요 |
| LiveMaker / LiveNovel | 🧪 베타 — 테스트 필요 |
| SystemNNN / NScripter | 🧪 베타 — 테스트 필요 |
| YU-RIS | 🧪 베타 — 테스트 필요 |

> **베타 엔진은 파싱/번역 코드는 있지만 실제 게임 테스트가 부족합니다.**
> 해당 엔진 게임 가지고 계시면 [이슈 등록](../../issues/new) 또는 [Discord](https://discord.gg/a6FXkPrFAZ)에 제보 부탁드려요. 리포트 들어오면 즉시 수정합니다.

## 🔬 이게 왜 단순 통합이 아닌가

기존 한패툴을 묶은 게 **아닙니다** (XUnity AutoTranslator, RPGMakerTrans 등 외부 도구 사용 X).
각 엔진별로 자체 포맷을 분석해서 직접 추출/적용 코드를 작성:

- **MuMu** — SDB 바이트 오프셋 보존, KEY30 XOR 분석
- **DXLib** — 자체 암호화 분석 (Nandemoya 포맷, 119 다이얼로그)
- **Unity** — AssetBundle 무결성 깨지지 않게 resize (`set_raw_data + sf.save`)
- **Unreal** — 비-CJK 빌드에 CJK 폰트 fallback + 임베딩
- **Wolf RPG** — 자체 바이너리 텍스트 추출
- **GDevelop** — 한국어 자동 폰트 교체
- **RPG Maker** — 세이브 데이터 직접 조작, 인코딩 처리

바이너리 분석부터 직접 구축. AI는 번역 품질 부분에만 사용 (Claude / GPT / NLLB), 추출 레이어는 직접 작성.

## 🚀 빠른 시작 (플레이어용)

### ⬇️ 바로 다운로드

**[최신 런처 다운로드 (항상 최신 버전)](https://api.closedclaws.com/api/download/launcher)**

이 링크는 항상 최신 빌드를 자동으로 받아줍니다. 업데이트마다 링크 갱신 불필요.

또는 [Fanbox (전체공개 무료)](https://rag91560.fanbox.cc/) / [Patreon](https://www.patreon.com/c/rag91560)에서도 받을 수 있습니다.

### 설치
1. Windows 인스톨러 실행 (macOS/Linux 예정)
2. 런처 실행 → 게임 폴더 드래그 → **번역** 클릭
3. 플레이

**여기까지가 전부입니다.** 오프라인 NLLB 번역은 라이선스도, 가입도, 횟수 제한도 없이 동작합니다.

오프라인 번역 품질이 부족한 게임이 있고 Claude / GPT / Gemini 수준 품질을 원하시면 [선택적 프리미엄](#-선택적-프리미엄) 섹션을 봐주세요.

## 💎 선택적 프리미엄

대부분의 게임은 무료 NLLB 엔진으로 충분합니다. 컨텍스트 인식이 필요한 **더 좋은 품질의 AI 번역**을 원하시면, 선택적으로 라이선스를 통해 Claude / GPT / Gemini를 사용할 수 있습니다.

|  | 월간 | 연간 | 평생 |
|--|------|------|------|
| **JPY** ([Fanbox](https://rag91560.fanbox.cc/)) | ¥500 | ¥2,000 | ¥3,000 |
| **USD** ([Patreon](https://www.patreon.com/c/rag91560)) | $5 | $20 | $30 |

번역 엔진 사용료라고 생각하시면 됩니다 — 프로젝트 유지비 + 신규 엔진 추가 비용으로 쓰입니다. **Varo 사용에 필수 아닙니다.**

## 🌐 커뮤니티 & 지원

- 💬 **Discord**: [서버 참여](https://discord.gg/a6FXkPrFAZ) — 지원, 기능 요청, 게임 호환성 리포트
- 🐛 **버그/기능 제안**: [GitHub Issues](../../issues)
- ❤️ **개발 지원**: [Fanbox](https://rag91560.fanbox.cc/) / [Patreon](https://www.patreon.com/c/rag91560)

1인 개발 (Claude AI 어시스트 사용).

## ⚖️ 면책 조항

Varo는 **번역 도구**입니다. 저작권이 있는 게임 콘텐츠를 자체적으로 포함하거나 재배포하지 않습니다.

Varo 사용 시 다음에 동의하는 것으로 간주됩니다:

- 번역하려는 게임을 **합법적으로 소유**하고 있을 것
- 번역 결과는 **개인적·사적 용도**로만 사용할 것
- 번역된 게임 파일, 한글 패치, 추출 콘텐츠를 **재배포·판매·공유하지 않을 것**
- 게임 EULA, 거주국 저작권법, DRM 관련 법규 준수 책임은 **사용자 본인**에게 있음

개발자는 오·남용에 대한 책임을 지지 않습니다. 권리자께서 특정 엔진 모듈 삭제를 원하실 경우 [LEGAL.md](LEGAL.md) 참조 — **24시간 내 비활성화** 처리합니다.

## 라이선스

[MIT](LICENSE) — 런처, UI, 엔진 어댑터.
번역 엔진 본체(`ue-translator`)는 유료 빌드에 포함되며 별도 비공개 배포.
