# Game Translator (게임번역기 런처)

## Stack
- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS v4 (inline theme, CSS Variables)
- Electron 35 (desktop wrapper)
- Python FastAPI backend (port 8000)

## Architecture
- `app/` — Next.js pages (App Router, `"use client"` 필수)
- `components/ui/` — CVA 기반 재사용 컴포넌트 (button, card, glow-border)
- `hooks/` — 커스텀 훅 (use-api, use-locale, use-theme)
- `lib/api.ts` — 백엔드 래퍼 (`/api/*` → localhost:8000 프록시)
- `backend/` — Python FastAPI (server.py, routers/, db.py)
- `electron/` — Electron main process (main.js, preload.js)

## Conventions
- 스타일링: CSS Variables + Tailwind utility. `cn()` 유틸 사용
- 상태: 커스텀 훅 (useState/useEffect). Redux/Zustand 없음
- 컴포넌트: CVA variants (`buttonVariants.cva()`)
- API: `api.games.scan()`, `api.translate.start()` 패턴
- i18n: `use-locale.ts` 훅 (한국어 기본, 영어 폴백)
- 테마: dark 기본, `.light` 클래스로 전환

## Commands
```bash
npm run dev          # Next.js dev
npm run build        # Production build
npm run electron:build  # Electron + NSIS installer
```

## Rules
- 새 페이지: `app/<name>/page.tsx` + `"use client"` 상단 필수
- 새 UI 컴포넌트: `components/ui/` 에 CVA 패턴으로
- API 추가: `lib/api.ts`에 메서드 추가 + `backend/routers/`에 엔드포인트
- 시크릿 하드코딩 절대 금지 — 환경변수 사용
