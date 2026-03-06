"use client"

import { t } from "@/lib/i18n"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, backgroundColor: "#0a0a0f", color: "#e4e4ec", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "2rem", textAlign: "center" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            {t("criticalError")}
          </h2>
          <p style={{ fontSize: "0.875rem", color: "#9898ad", marginBottom: "1.5rem", maxWidth: "400px" }}>
            {error.message || t("criticalErrorDesc")}
          </p>
          <button
            onClick={reset}
            style={{
              padding: "0.5rem 1.5rem",
              borderRadius: "0.5rem",
              border: "none",
              backgroundColor: "#5b5ef0",
              color: "#fff",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {t("tryAgain")}
          </button>
        </div>
      </body>
    </html>
  )
}
