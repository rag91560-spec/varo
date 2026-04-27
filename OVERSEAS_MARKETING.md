# 게임번역기 해외 진출 플랜

## 앱 개요
- **앱명**: 게임번역기 (Game Translator)
- **플랫폼**: Electron 데스크톱 앱 (Windows)
- **기능**: 일본어 게임/만화/자막 → 다국어 번역 (한국어, 영어 등)
- **GitHub**: https://github.com/rag91560-spec/varo

## 핵심 기술 강점
- 로컬 실행 (이미지를 클라우드에 안 보냄 → 프라이버시, 모든 콘텐츠 지원)
- 말풍선 인식 → 텍스트 지우기(인페인팅) → 번역문 렌더링까지 원스톱
- 듀얼 파이프라인: Gemini Vision (클라우드) + CTD/manga-ocr (로컬 ONNX)
- 게임/만화/영상 자막 모두 지원

## 수익 구조
- **무료**: NLLB 오프라인 번역
- **유료**: AI 고품질 번역 (Claude/Gemini 사용)

### 요금 체계
| 플랜 | Patreon (USD) | Fanbox (JPY) | 내용 |
|------|---------------|--------------|------|
| Monthly | $5 | ¥500 | 월간 라이선스 |
| Yearly | $20 | ¥2,000 | 연간 라이선스 |
| Lifetime | $30 | ¥3,000 | 평생 영구 이용권 |

- **결제 플랫폼**: Fanbox (일본) + Patreon (해외) ✅

## 포지셔닝 (해외용)
> "Any Japanese game or manga → Your language. AI-powered, runs locally."

- NSFW는 전면에 내세우지 않음
- "로컬 실행 = 프라이버시" 로 자연스럽게 커버
- 기존 경쟁 툴(Sugoi Translator, manga-image-translator) 대비: 설치 쉬움 + 렌더링까지 원스톱

## 타겟 커뮤니티
| 플랫폼 | 서브레딧/채널 | 타겟 |
|--------|-------------|------|
| Reddit | r/visualnovels | VN 번역 |
| Reddit | r/manga | 만화 번역 |
| Reddit | r/JRPG | 게임 번역 |
| Reddit | r/translation | 번역 툴 |
| Reddit | r/LearnJapanese | 일본어 학습자 |
| Twitter/X | #VNTranslation #MangaTranslation | SNS 바이럴 |
| GitHub | README 영문화 | 개발자/오픈소스 |

## 해야 할 것 (우선순위 순)
1. ~~**Patreon 계정 생성**~~ ✅ 완료
2. **README.md 영문화** — 데모 GIF 포함, Free vs Paid 명확히, Patreon 링크
3. **레딧 포스팅** — 스크린샷/데모 영상과 함께 "I made this" 포맷
4. **Twitter/X 데모 영상** — 짧은 클립으로 번역 전후 비교

## 현재 상태
- 코드는 GitHub에 올라가 있음
- 렌더링 버그 대부분 수정 완료 (2026-04-07)
- 나눔명조 기본 폰트로 변경
- Patreon 계정 생성 완료
- README는 아직 한국어
