# 번@역+기! (byeok-gi)

AI 기반 게임 번역 도구. 게임 파일을 자동으로 스캔하고, AI를 활용해 번역한 뒤, 원본에 적용합니다.

## [📢 디스코드 서버 참여하기](https://discord.gg/MxkNZJdq)

> 💡 제대로 작동하는 빌드된 버전을 사용하시려면 [Pixiv Fanbox](https://rag91560.fanbox.cc/)에서 다운로드하시는 것을 추천드립니다. (전체공개 게시글이므로 무료로 다운로드 가능합니다.)

<!-- ![Screenshot](docs/screenshot.png) -->

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

## 번역 엔진

### 무료 (오프라인)
- **NLLB** — Meta의 오픈소스 번역 모델. 라이선스 키 없이 로컬에서 무료 사용 가능

### 유료 (라이선스 필요)
- **Claude, OpenAI, Gemini** 등 고품질 AI 번역 엔진
- 서버 측 라이선스 검증을 통해 제공
- 라이선스 키 구매: [Pixiv Fanbox](https://rag91560.fanbox.cc/)

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
