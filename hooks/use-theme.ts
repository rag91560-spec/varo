"use client"

import { createContext, useContext, useState, useEffect, useCallback } from "react"
import React from "react"
import type { ReactNode } from "react"

export type Theme = "dark" | "light" | "system"

interface ThemeContextValue {
  theme: Theme
  resolvedTheme: "dark" | "light"
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  resolvedTheme: "dark",
  setTheme: () => {},
})

function getSystemTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark"
  try {
    const saved = localStorage.getItem("gt-theme")
    if (saved === "dark" || saved === "light" || saved === "system") return saved
  } catch { /* SSR / restricted access */ }
  return "dark"
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)
  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">(() => {
    const initial = getInitialTheme()
    return initial === "system" ? getSystemTheme() : initial
  })

  useEffect(() => {
    const resolved = theme === "system" ? getSystemTheme() : theme
    setResolvedTheme(resolved)
    const root = document.documentElement
    root.classList.toggle("dark", resolved === "dark")
    root.classList.toggle("light", resolved === "light")
  }, [theme])

  useEffect(() => {
    if (theme !== "system") return
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = () => {
      const resolved = getSystemTheme()
      setResolvedTheme(resolved)
      document.documentElement.classList.toggle("dark", resolved === "dark")
      document.documentElement.classList.toggle("light", resolved === "light")
    }
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [theme])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    localStorage.setItem("gt-theme", t)
  }, [])

  return React.createElement(
    ThemeContext.Provider,
    { value: { theme, resolvedTheme, setTheme } },
    children
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
