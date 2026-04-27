# Game Translator - Localization Issues for Overseas Launch

> This document lists all Korean-hardcoded text and i18n issues that need fixing before international marketing.
> Priority: HIGH items first, then MEDIUM, then LOW.

## Current Status
- i18n system EXISTS (`lib/i18n.ts` + `hooks/use-locale.ts`, ~1,330 keys)
- But **281+ hardcoded Korean strings** bypass the i18n system
- English translations in i18n are mostly complete, but hardcoded text has NO English version

---

## HIGH PRIORITY - Core UI Hardcoded Korean

### 1. Settings Page (`app/settings/page.tsx`)
14 hardcoded Korean strings in launcher update section (lines 531-614):
| Line | Korean | English |
|------|--------|---------|
| 531 | `런처 업데이트` | Launcher Update |
| 534 | `현재 버전:` | Current Version: |
| 553 | `업데이트 확인 실패` | Update check failed |
| 558 | `업데이트 확인` | Check for Updates |
| 565 | `업데이트 확인 중...` | Checking for updates... |
| 573 | `최신 버전입니다` | You're up to date |
| 576 | `다시 확인` | Check Again |
| 585 | `다운로드 중... {percentage}%` | Downloading... {percentage}% |
| 600 | `업데이트 다운로드 완료!` | Update downloaded! |
| 605 | `지금 설치 (재시작)` | Install Now (Restart) |
| 612 | `업데이트 확인 실패` | Update check failed |
| 614 | `다시 시도` | Retry |
| 130 | `연결 실패` | Connection failed |

### 2. Live Capture Panel (`components/live/CapturePanel.tsx`)
28 hardcoded Korean strings - ALL labels and options:
| Line | Korean | English |
|------|--------|---------|
| 59 | `캡처 중...` / `캡처 + 번역` | Capturing... / Capture + Translate |
| 69 | `자동 캡처` | Auto Capture |
| 77 | `자동 중지` | Auto Stop |
| 91 | `오버레이` | Overlay |
| 102 | `영역 선택` | Select Area |
| 118 | `번역 방향` | Translation Direction |
| 125-130 | `자동 감지`, `일본어`, `영어`, `중국어 (간체)`, `중국어 (번체)`, `한국어` | Auto Detect, Japanese, English, Chinese (Simplified), Chinese (Traditional), Korean |
| 138-141 | `한국어`, `영어`, `일본어`, `중국어` | Korean, English, Japanese, Chinese |
| 150 | `번역 제공자` | Translation Provider |
| 153 | `AI 잠금` | AI Lock |
| 166 | `오프라인 (NLLB)` | Offline (NLLB) |
| 168, 171, 174 | `Claude (라이선스 필요)` etc. | Claude (License Required) etc. |
| 176 | `테스트 (Echo)` | Test (Echo) |
| 181 | `OCR 엔진` | OCR Engine |
| 187 | `자동 (추천)` | Auto (Recommended) |
| 196 | `자동 간격` | Auto Interval |
| 202-205 | `1초`, `2초`, `3초`, `5초` | 1s, 2s, 3s, 5s |
| 210 | `오버레이 불투명도` | Overlay Opacity |
| 226 | Hotkey hint (Ctrl+Shift+T etc.) | Same keys, English labels |

### 3. Folder Browser (`components/FolderBrowser.tsx`)
16 hardcoded Korean strings:
| Line | Korean | English |
|------|--------|---------|
| 188 | `뒤로` | Back |
| 198 | `상위 폴더` | Parent Folder |
| 208 | `경로를 입력하세요...` | Enter path... |
| 218 | `폴더 찾아보기` | Browse Folder |
| 233 | `불러오는 중...` | Loading... |
| 237 | `접근할 수 없습니다` / `빈 폴더` | Cannot access / Empty folder |
| 243-269 | `이름`, `유형`, `크기`, `수정일`, `드라이브`, `폴더`, `파일` | Name, Type, Size, Modified, Drive, Folder, File |
| 52 | `toLocaleDateString("ko-KR")` | Change to use user locale |

### 4. Bulk Translate Modal (`components/media-grid/BulkTranslateModal.tsx`)
22 hardcoded Korean strings:
| Line | Korean | English |
|------|--------|---------|
| 22 | `한국어 (ko)` | Korean (ko) |
| 99 | `일괄 번역` | Bulk Translate |
| 123 | `원본 언어` | Source Language |
| 137 | `번역 언어` | Target Language |
| 153 | `번역 방식` | Translation Method |
| 157-158 | `자동 (스크립트 우선)` / `스크립트만` | Auto (Script Priority) / Script Only |
| 191 | `시리즈 용어집 적용` | Apply Series Glossary |
| 224 | `준비 중...` | Preparing... |
| 233, 238 | `성공` / `실패` | Success / Failed |
| 258-271 | `취소`, `번역 시작`, `닫기` | Cancel, Start Translation, Close |

### 5. AppShell Drag & Drop (`components/layout/AppShell.tsx`)
| Line | Korean | English |
|------|--------|---------|
| 97 | `파일을 여기에 놓으세요` | Drop files here |

### 6. Add Media Modal (`components/media-grid/AddMediaModal.tsx`)
| Line | Korean | English |
|------|--------|---------|
| 395-396 | `오디오 스캔 완료` | Audio scan complete |
| 411 | `지금 바로 번역` | Translate Now |
| 415 | `닫기` | Close |
| 439 | `폴더명으로 카테고리 자동 생성` | Auto-create categories from folder names |

### 7. Category/Glossary/Folder UI
**CategoryGlossaryEditor.tsx** (lines 113-191): `용어집 편집`, `로딩 중...`, `원어`, `번역`, `삭제`, `행 추가`, `취소`, `저장`
**FolderExplorer.tsx** (lines 117-214): `새 폴더`, placeholder
**MediaCard.tsx** (line 223): `그룹 만들기`
**SelectionBar.tsx** (lines 93, 106): `번역`, `삭제`
**CategorySidebar.tsx** (line 240): `용어집 편집`

### 8. Audio Player (`components/media-grid/AudioFullscreenPlayer.tsx`)
| Line | Korean | English |
|------|--------|---------|
| 184 | `시작 중...` | Starting... |
| 204 | `오류 발생` | Error occurred |

---

## MEDIUM PRIORITY

### Date Format Hardcoding
| File | Line | Issue |
|------|------|-------|
| `components/FolderBrowser.tsx` | 52 | `toLocaleDateString("ko-KR")` - forced Korean date format |
| `app/admin/page.tsx` | 243 | `toLocaleDateString("ko")` - forced Korean |
| **Fix**: Use `toLocaleDateString(locale === "ko" ? "ko-KR" : "en-US")` or just `toLocaleDateString()` |

### Alert/Prompt Messages (native dialogs)
| File | Line | Korean |
|------|------|--------|
| `app/audio/page.tsx` | 150 | `alert("폴더 선택은 Electron 환경에서만 지원됩니다.")` |
| `app/audio/page.tsx` | 169 | alert message |
| `app/library/page.tsx` | 224, 252 | prompt messages |
| `app/manga/page.tsx` | 97, 131 | prompt messages |
| `app/videos/page.tsx` | 79, 98, 154, 186 | alert/prompt messages |

### Sidebar Branding (`components/layout/Sidebar.tsx`)
| Line | Korean | Note |
|------|--------|------|
| 57 | `badge: "예정"` | "Coming Soon" |
| 217 | `번<span>@</span>역<span>+</span>기<span>!</span>` | App logo - intentional branding, but Korean-only |
| 338 | Language toggle title | Already has bilingual logic |

---

## LOW PRIORITY

### UI Layout - Fixed Widths (may cause text overflow in English)
| File | Line | Width | Component |
|------|------|-------|-----------|
| `CoverSearchModal.tsx` | 117 | w-[680px] | Search modal |
| `AIChatSidebar.tsx` | 104 | w-[380px] | AI chat sidebar |
| `AIChatSidebar.tsx` | 250 | max-w-[260px] + truncate | Chat message |
| `SubtitleWorkspace.tsx` | 473 | max-w-[300px] + truncate | Media title |
| `FolderExplorer.tsx` | 195 | w-[360px] | Folder explorer modal |

### App Title (`app/layout.tsx`)
| Line | Current | Suggestion |
|------|---------|------------|
| 18 | `번@역+기! - AI Game Translator` | Keep as-is or change to `Game Translator - AI Game Translator` for English |

---

## How to Fix

All hardcoded strings should be migrated to the existing i18n system:

```tsx
// Before (hardcoded):
<button>캡처 + 번역</button>

// After (i18n):
<button>{t("captureAndTranslate")}</button>
```

Then add keys to `lib/i18n.ts`:
```ts
// In ko section:
captureAndTranslate: "캡처 + 번역",

// In en section:
captureAndTranslate: "Capture + Translate",
```

**Estimated work**: ~80 new i18n keys to add, across ~15 files.

### Key Files
- **i18n definitions**: `lib/i18n.ts`
- **Locale hook**: `hooks/use-locale.ts`
- **Usage pattern**: `const { t, locale } = useLocale()`
