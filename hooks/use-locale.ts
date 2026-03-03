"use client"

import { createContext, useContext, useState, useEffect, useCallback } from "react"
import React from "react"
import type { ReactNode } from "react"

const translations = {
  ko: {
    appName: "게임번역기",
    translate: "번역",
    library: "라이브러리",
    settings: "설정",
    download: "다운로드",
    models: "AI 모델",
    about: "정보",
    darkMode: "다크 모드",
    lightMode: "라이트 모드",
    systemMode: "시스템",
    selectGame: "게임 선택",
    selectEngine: "엔진 선택",
    startTranslation: "번역 시작",
    stopTranslation: "번역 중지",
    progress: "진행률",
    provider: "번역 제공자",
    apiKey: "API 키",
    save: "저장",
    cancel: "취소",
    sourceLanguage: "원본 언어",
    targetLanguage: "대상 언어",
    japanese: "일본어",
    korean: "한국어",
    english: "영어",
    chinese: "중국어",
    translating: "번역 중...",
    completed: "완료",
    error: "오류",
    noGames: "게임이 없습니다",
    addGame: "게임 추가",
    totalStrings: "전체 문자열",
    translatedStrings: "번역된 문자열",
    untranslatedStrings: "미번역 문자열",
    tagline: "AI 게임 번역기",
    version: "버전",
    offlineMode: "오프라인 모드",
    onlineMode: "온라인 모드",
    launchGame: "게임 실행",
    presets: "프리셋",
    translationMemory: "번역 메모리",
    admin: "관리",
    licenseKey: "라이선스 키",
  },
  en: {
    appName: "Game Translator",
    translate: "Translate",
    library: "Library",
    settings: "Settings",
    download: "Download",
    models: "AI Models",
    about: "About",
    darkMode: "Dark Mode",
    lightMode: "Light Mode",
    systemMode: "System",
    selectGame: "Select Game",
    selectEngine: "Select Engine",
    startTranslation: "Start Translation",
    stopTranslation: "Stop Translation",
    progress: "Progress",
    provider: "Provider",
    apiKey: "API Key",
    save: "Save",
    cancel: "Cancel",
    sourceLanguage: "Source Language",
    targetLanguage: "Target Language",
    japanese: "Japanese",
    korean: "Korean",
    english: "English",
    chinese: "Chinese",
    translating: "Translating...",
    completed: "Completed",
    error: "Error",
    noGames: "No games found",
    addGame: "Add Game",
    totalStrings: "Total Strings",
    translatedStrings: "Translated",
    untranslatedStrings: "Untranslated",
    tagline: "AI Game Translator",
    version: "Version",
    offlineMode: "Offline Mode",
    onlineMode: "Online Mode",
    launchGame: "Launch Game",
    presets: "Presets",
    translationMemory: "Translation Memory",
    admin: "Admin",
    licenseKey: "License Key",
  },
} as const

export type Locale = keyof typeof translations
export type TranslationKey = keyof (typeof translations)["ko"]

interface LocaleContextValue {
  locale: Locale
  t: (key: TranslationKey) => string
  toggleLocale: () => void
  setLocale: (locale: Locale) => void
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "ko",
  t: (key) => key,
  toggleLocale: () => {},
  setLocale: () => {},
})

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("ko")

  useEffect(() => {
    const saved = localStorage.getItem("gt-locale") as Locale | null
    if (saved === "ko" || saved === "en") setLocaleState(saved)
  }, [])

  const t = useCallback(
    (key: TranslationKey) => translations[locale][key] ?? key,
    [locale]
  )

  const toggleLocale = useCallback(() => {
    const next = locale === "ko" ? "en" : "ko"
    setLocaleState(next)
    localStorage.setItem("gt-locale", next)
  }, [locale])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    localStorage.setItem("gt-locale", l)
  }, [])

  return React.createElement(
    LocaleContext.Provider,
    { value: { locale, t, toggleLocale, setLocale } },
    children
  )
}

export function useLocale() {
  return useContext(LocaleContext)
}
