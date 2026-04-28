<div align="center">

# Varo

### AI-powered translator for Japanese games, manga & video subtitles

<!-- Badges: replace URLs when project name is finalized -->
[![Download](https://img.shields.io/badge/Download-Latest-brightgreen?style=for-the-badge)](https://api.closedclaws.com/api/download/launcher)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/MxkNZJdq)
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

**Not a prototype. Used in production by Korean players — monthly active community on Discord, stable revenue, weekly engine updates.**

- 🎮 **17+ game engines** auto-detected (RPG Maker, Unity, Unreal, Ren'Py, Kirikiri, Wolf RPG, and more)
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

17+ engines supported. Tested on production games.

| Engine | Status |
|--------|--------|
| RPG Maker (MV, MZ, VX Ace, XP, 2000/2003) | ✅ Stable |
| Wolf RPG Editor | ✅ Stable |
| TyranoScript / TyranoBuilder | ✅ Stable |
| Kirikiri (KAG3 / KS) | ✅ Stable |
| Unity (IL2CPP / Mono) | ✅ Stable |
| Unreal Engine | ✅ Stable |
| Ren'Py | ✅ Stable |
| RPG in a Box | ✅ Stable |
| LiveMaker / LiveNovel | ✅ Stable |
| SystemNNN / NScripter | ✅ Stable |
| YU-RIS | ✅ Stable |
| MuMu | ✅ Stable |
| GDevelop | 🧪 Beta |
| …and more | ✅ Stable |

> Don't see your engine? [Open an issue](../../issues/new) or ask in [Discord](https://discord.gg/MxkNZJdq) — we add engines based on demand.

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

No license needed for offline NLLB translation. Premium AI engines require a [license](#-pricing).

---

## 💰 Pricing

|  | Monthly | Yearly | Lifetime |
|--|---------|--------|----------|
| **USD** ([Patreon](https://www.patreon.com/c/rag91560)) | $5 | $20 | $30 |
| **JPY** ([Fanbox](https://rag91560.fanbox.cc/)) | ¥500 | ¥2,000 | ¥3,000 |

- **Free tier** — offline NLLB, no license.
- **Paid tier** — Claude / GPT / Gemini, context-aware translation, auto font replacement, line-break optimization, encoding handling across 17+ engines.
- Yearly / Lifetime: pay once, cancel subscription anytime — license stays active for the full period.

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

## 🌐 Community & Support

- 💬 **Discord** — [Join the server](https://discord.gg/MxkNZJdq) for support, feature requests, and game compatibility reports
- 🐛 **Bugs & Features** — [GitHub Issues](../../issues)
- ❤️ **Support Development** — [Fanbox](https://rag91560.fanbox.cc/) or [Patreon](https://www.patreon.com/c/rag91560)

Every paid license keeps the engine updated for new games. Built and maintained solo.

---

## License

[MIT](LICENSE) — launcher, UI, and engine adapters.
Translation engine binary (`ue-translator`) is proprietary and distributed with paid builds.

---

<a name="한국어"></a>

# 한국어

## 이게 뭔가요?

일본 게임 폴더 드래그 → 번역 클릭 → 한국어로 플레이. 수동 텍스트 추출, 비공식 패치 찾기, 개발 환경 세팅 전부 **불필요**합니다.

**프로토타입 아닙니다.** 한국 유저들이 실사용 중 — 월간 활성 Discord 커뮤니티, 안정적 매출, 주간 엔진 업데이트.

- 🎮 **17종 이상 게임 엔진** 자동 감지 (RPG Maker, Unity, Unreal, Ren'Py, Kirikiri, Wolf RPG 등)
- 🤖 **멀티 AI** — Claude, GPT, Gemini, 또는 오프라인 NLLB (무료)
- 📚 **게임 외에도** — 만화 번역(OCR), 영상 자막, 텍스트 스크립트
- 🔄 **되돌리기 가능** — 원클릭 롤백 언제든
- 🔐 **로컬 우선** — 게임 데이터 외부 업로드 없음

## 🚀 빠른 시작 (플레이어용)

### ⬇️ 바로 다운로드

**[최신 런처 다운로드 (항상 최신 버전)](https://api.closedclaws.com/api/download/launcher)**

이 링크는 항상 최신 빌드를 자동으로 받아줍니다. 업데이트마다 링크 갱신 불필요.

또는 [Fanbox (전체공개 무료)](https://rag91560.fanbox.cc/) / [Patreon](https://www.patreon.com/c/rag91560)에서도 받을 수 있습니다.

### 설치
1. Windows 인스톨러 실행 (macOS/Linux 예정)
2. 런처 실행 → 게임 폴더 드래그 → **번역** 클릭
3. 플레이

오프라인 NLLB는 라이선스 없이 무료. 프리미엄 AI 엔진은 [요금제](#-pricing) 참조.

## 💰 요금제

|  | 월간 | 연간 | 평생 |
|--|------|------|------|
| **USD** ([Patreon](https://www.patreon.com/c/rag91560)) | $5 | $20 | $30 |
| **JPY** ([Fanbox](https://rag91560.fanbox.cc/)) | ¥500 | ¥2,000 | ¥3,000 |

- **무료**: NLLB 오프라인 번역 — 라이선스 불필요
- **유료**: Claude / GPT / Gemini 등 고품질 AI, 17종 엔진 대응 컨텍스트 번역, 자동 폰트 교체, 줄바꿈 최적화, 인코딩 처리 포함
- 연간/평생: 1회 결제 후 구독 취소해도 해당 기간 라이선스 유지

## 🌐 커뮤니티 & 지원

- 💬 **Discord**: [서버 참여](https://discord.gg/MxkNZJdq) — 지원, 기능 요청, 게임 호환성 리포트
- 🐛 **버그/기능 제안**: [GitHub Issues](../../issues)
- ❤️ **개발 지원**: [Fanbox](https://rag91560.fanbox.cc/) / [Patreon](https://www.patreon.com/c/rag91560)

모든 유료 라이선스는 새 게임 지원을 위한 엔진 업데이트에 쓰입니다. 1인 개발.

## 라이선스

[MIT](LICENSE) — 런처, UI, 엔진 어댑터.
번역 엔진 본체(`ue-translator`)는 유료 빌드에 포함되며 별도 비공개 배포.
