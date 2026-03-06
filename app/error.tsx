"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { t } from "@/lib/i18n"

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Page error:", error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <div className="size-16 rounded-2xl bg-error/10 flex items-center justify-center mb-4">
        <svg viewBox="0 0 24 24" className="size-8 text-error" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-text-primary mb-2">
        {t("errorPageTitle")}
      </h2>
      <p className="text-sm text-text-secondary mb-6 max-w-md">
        {error.message || t("criticalErrorDesc")}
      </p>
      <Button variant="default" size="md" onClick={reset}>
        {t("tryAgain")}
      </Button>
    </div>
  )
}
