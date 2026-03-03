"use client"

import { ThemeProvider } from "@/hooks/use-theme"
import { LocaleProvider } from "@/hooks/use-locale"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <LocaleProvider>
        {children}
      </LocaleProvider>
    </ThemeProvider>
  )
}
