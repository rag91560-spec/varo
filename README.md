# Game Translator (번@역+기!)

> Any Japanese game, manga, or subtitle — translated into your language. AI-powered, runs locally.

<!-- ![Screenshot](docs/screenshot.png) -->
<!-- TODO: Add demo GIF -->

## [Join our Discord](https://discord.gg/MxkNZJdq)

## Features

- **Auto Engine Detection** — Scans your game folder and identifies the engine (RPG Maker, Unity, Unreal, and 14+ more)
- **AI Translation** — Free offline translation (NLLB) included; unlock premium AI translation (Claude, OpenAI, Gemini) with a license
- **Translation Memory** — Reuses previous translations for consistency
- **Glossary** — Set custom rules for character names, proper nouns, etc.
- **Translation Presets** — Save and reuse your translation settings
- **Live Progress** — Real-time progress tracking via SSE
- **One-Click Apply/Rollback** — Apply translations to your game and revert anytime
- **File Structure Visualization** — View game file structure as a flowchart
- **Auto Updates** — Built-in Electron auto-updater

## Supported Engines

17+ game engines supported:

| Engine | Status |
|--------|--------|
| RPG Maker (MV, MZ, VX Ace, XP, 2000/2003) | Stable |
| Wolf RPG Editor | Stable |
| TyranoScript / TyranoBuilder | Stable |
| Kirikiri (KAG3 / KS) | Stable |
| Unity (IL2CPP / Mono) | Stable |
| Unreal Engine | Stable |
| Ren'Py | Stable |
| RPG in a Box | Stable |
| RPGM (Legacy) | Stable |
| LiveMaker / LiveNovel | Stable |
| SystemNNN / NScripter | Stable |
| YU-RIS | Stable |
| MuMu | Stable |
| GDevelop | Beta |
| And more... | |

## Translation Engines

### Free (Offline)
- **NLLB** — Meta's open-source translation model. Runs locally, no license key needed.

### Premium (License Required)
- **Claude, OpenAI, Gemini** — High-quality AI translation powered by leading LLMs
- Bring your own API key — the license unlocks the translation logic built for 17+ engines
- AI-powered context-aware translation with automatic font replacement, line-break optimization, and encoding handling

## Pricing

|  | Monthly | Yearly | Lifetime |
|--|---------|--------|----------|
| **USD** ([Patreon](https://www.patreon.com/c/rag91560)) | $5 | $20 | $50 |
| **JPY** ([Fanbox](https://rag91560.fanbox.cc/)) | ¥500 | ¥2,000 | ¥5,000 |

**Free tier** includes offline NLLB translation — no license needed.
**Paid tier** unlocks high-quality AI translation with Claude, Gemini, OpenAI, and more.

> Yearly / Lifetime: Pay once, cancel subscription — your license stays active for the full period.

## Download

> The latest stable build is available on [Pixiv Fanbox](https://rag91560.fanbox.cc/) (free public post) or [Patreon](https://www.patreon.com/c/rag91560).

## Tech Stack

| Area | Tech |
|------|------|
| Frontend | Next.js 16, React 19, TypeScript 5, Tailwind CSS 4 |
| Desktop | Electron 35 |
| Backend | Python FastAPI |
| UI | CVA (Class Variance Authority), Lucide Icons |
| Visualization | @xyflow/react |

## Getting Started

### Prerequisites

- Node.js 20+
- Python 3.10+
- npm

### Development

```bash
# Install dependencies
npm install
pip install -r backend/requirements.txt

# Start Next.js dev server (port 3100)
npm run dev

# Start Electron in dev mode (separate terminal)
npm run electron:dev
```

### Production Build

```bash
# Build Windows installer
npm run electron:build
```

Output will be in `dist-electron/`.

## Project Structure

```
app/                    # Next.js pages & routing
backend/                # Python FastAPI backend
  routers/              # API routers (games, translate, covers, etc.)
components/
  ui/                   # Shared UI components (CVA pattern)
  game-detail/          # Game detail domain components
  layout/               # Layout (Sidebar, etc.)
electron/               # Electron main/preload
hooks/                  # Custom React hooks
lib/                    # Utilities (api.ts, types.ts, i18n.ts)
scripts/                # Build scripts
```

## License

[MIT](LICENSE)

---

<details>
<summary>한국어 (Korean)</summary>

# 번@역+기! (byeok-gi)

AI 기반 게임 번역 도구. 게임 파일을 자동으로 스캔하고, AI를 활용해 번역한 뒤, 원본에 적용합니다.

## [디스코드 서버 참여하기](https://discord.gg/MxkNZJdq)

> 제대로 작동하는 빌드된 버전을 사용하시려면 [Pixiv Fanbox](https://rag91560.fanbox.cc/)에서 다운로드하시는 것을 추천드립니다. (전체공개 게시글이므로 무료로 다운로드 가능합니다.)

## 요금제

|  | 월간 | 연간 | 평생 |
|--|------|------|------|
| **USD** ([Patreon](https://www.patreon.com/c/rag91560)) | $5 | $20 | $50 |
| **JPY** ([Fanbox](https://rag91560.fanbox.cc/)) | ¥500 | ¥2,000 | ¥5,000 |

**무료**: NLLB 오프라인 번역 — 라이선스 불필요.
**유료**: Claude, Gemini, OpenAI 등 고품질 AI 번역 사용 가능.

> 연간 / 평생: 1회 결제 후 구독 취소해도 해당 기간 동안 라이선스가 유효합니다.

## 주요 기능

- **자동 엔진 감지** — 게임 폴더를 스캔하면 엔진(RPG Maker, Unity, Unreal 등)을 자동 인식
- **AI 번역** — NLLB (오프라인 번역 모델) 기본 지원, 유료 라이선스로 Claude/OpenAI/Gemini 등 고품질 AI 번역 사용 가능
- **번역 메모리(TM)** — 이전 번역을 재활용해 일관성 유지
- **용어집** — 고유명사, 캐릭터명 등 번역 규칙 설정
- **번역 프리셋** — 번역 설정을 프리셋으로 저장/재사용
- **실시간 진행률** — SSE 기반 번역 진행 상황 실시간 표시
- **원클릭 적용/롤백** — 번역 결과를 게임에 적용하고, 언제든 원본으로 복원
- **파일 구조 시각화** — 게임 파일 구조를 플로우 차트로 확인
- **자동 업데이트** — Electron 자동 업데이트 지원

## 번역 엔진

### 무료 (오프라인)
- **NLLB** — Meta의 오픈소스 번역 모델. 라이선스 키 없이 로컬에서 무료 사용 가능

### 유료 (라이선스 필요)
- **Claude, OpenAI, Gemini** 등 빅테크 AI를 활용한 고품질 게임 번역 엔진
- 17종 엔진 대응 AI 번역 로직은 한 달 넘게 개발한 부분으로, 유료 라이선스를 통해 제공됩니다
- 라이선스 관련 문의는 [디스코드 서버](https://discord.gg/MxkNZJdq)로 부탁드립니다

## 기술 스택

| 영역 | 기술 |
|------|------|
| Frontend | Next.js 16, React 19, TypeScript 5, Tailwind CSS 4 |
| Desktop | Electron 35 |
| Backend | Python FastAPI |
| UI | CVA (Class Variance Authority), Lucide Icons |
| 시각화 | @xyflow/react |

## 설치 & 빌드

### 사전 요구사항

- Node.js 20+
- Python 3.10+
- npm

### 개발 모드

```bash
# 의존성 설치
npm install
pip install -r backend/requirements.txt

# Next.js 개발 서버 (포트 3100)
npm run dev

# Electron 개발 모드 (별도 터미널)
npm run electron:dev
```

### 프로덕션 빌드

```bash
# Windows 인스톨러 빌드
npm run electron:build
```

빌드 결과물은 `dist-electron/` 디렉토리에 생성됩니다.

## 프로젝트 구조

```
app/                    # Next.js 페이지 & 라우팅
backend/                # Python FastAPI 백엔드
  routers/              # API 라우터 (games, translate, covers 등)
components/
  ui/                   # 공통 UI 컴포넌트 (CVA 패턴)
  game-detail/          # 게임 상세 도메인 컴포넌트
  layout/               # 레이아웃 (Sidebar 등)
electron/               # Electron main/preload
hooks/                  # 커스텀 React 훅
lib/                    # 유틸리티 (api.ts, types.ts, i18n.ts)
scripts/                # 빌드 스크립트
```

## License

[MIT](LICENSE)

</details>
