"use client"

import { createContext, useContext, useState, useEffect, useCallback } from "react"
import React from "react"
import type { ReactNode } from "react"
import { translations } from "@/lib/i18n"
import type { Locale, TranslationKey } from "@/lib/i18n"

export type { Locale, TranslationKey }

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
