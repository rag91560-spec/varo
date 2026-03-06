"use client"

import { useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { useLocale, type TranslationKey } from "@/hooks/use-locale"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import type { ImportResult } from "@/lib/types"

interface ExportImportButtonsProps {
  gameId: number
  /** Called after a successful import so the parent can refresh entries */
  onImportSuccess?: (result: ImportResult) => void
  className?: string
}

type ImportMode = "merge" | "replace"
type ImportFormat = "json" | "csv"

export function ExportImportButtons({ gameId, onImportSuccess, className }: ExportImportButtonsProps) {
  const { t } = useLocale()

  // Export dropdown
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Import modal
  const [importOpen, setImportOpen] = useState(false)
  const [importFormat, setImportFormat] = useState<ImportFormat>("json")
  const [importMode, setImportMode] = useState<ImportMode>("merge")
  const [importLoading, setImportLoading] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Export handlers ──

  async function handleExport(format: "json" | "csv") {
    setExporting(true)
    setExportOpen(false)
    try {
      const { blob, filename } = await api.project.exportBlob(gameId, format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error(`Export ${format.toUpperCase()} failed`, e)
    } finally {
      setExporting(false)
    }
  }

  // ── Import handlers ──

  function openImportModal(format: ImportFormat) {
    setImportFormat(format)
    setImportMode("merge")
    setImportError(null)
    setImportResult(null)
    setImportOpen(true)
  }

  function handleFileSelect() {
    fileInputRef.current?.click()
  }

  async function handleImportSubmit() {
    const file = fileInputRef.current?.files?.[0]
    if (!file) {
      setImportError(t("selectFileRequired"))
      return
    }

    setImportLoading(true)
    setImportError(null)
    setImportResult(null)

    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("mode", importMode)

      const result =
        importFormat === "json"
          ? await api.project.importJson(gameId, formData)
          : await api.project.importCsv(gameId, formData)

      setImportResult(result)
      onImportSuccess?.(result)
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("importFailed")
      setImportError(msg)
    } finally {
      setImportLoading(false)
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  function handleCloseModal() {
    setImportOpen(false)
    setImportError(null)
    setImportResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Export dropdown */}
      <div className="relative">
        <Button
          variant="secondary"
          size="sm"
          loading={exporting}
          onClick={() => setExportOpen((v) => !v)}
        >
          <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {t("exportLabel")}
          <svg className="size-3 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </Button>

        {exportOpen && (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
            <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-surface-elevated shadow-lg">
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-surface transition-colors"
                onClick={() => handleExport("json")}
              >
                <span className="text-accent font-mono text-xs font-bold">{"{}"}</span>
                {t("exportJson")}
              </button>
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-surface transition-colors"
                onClick={() => handleExport("csv")}
              >
                <span className="text-success font-mono text-xs font-bold">CSV</span>
                {t("exportCsv")}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Import dropdown */}
      <div className="relative">
        <ImportDropdown
          onSelectJson={() => openImportModal("json")}
          onSelectCsv={() => openImportModal("csv")}
          t={t}
        />
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={importFormat === "json" ? ".json" : ".csv"}
      />

      {/* Import modal */}
      {importOpen && (
        <ImportModal
          format={importFormat}
          mode={importMode}
          onModeChange={setImportMode}
          loading={importLoading}
          error={importError}
          result={importResult}
          onFileSelect={handleFileSelect}
          onSubmit={handleImportSubmit}
          onClose={handleCloseModal}
          fileInputRef={fileInputRef}
          t={t}
        />
      )}
    </div>
  )
}

// ── Sub-components ──

function ImportDropdown({
  onSelectJson,
  onSelectCsv,
  t,
}: {
  onSelectJson: () => void
  onSelectCsv: () => void
  t: (key: TranslationKey) => string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        {t("importLabelBtn")}
        <svg className="size-3 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-surface-elevated shadow-lg">
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-surface transition-colors"
              onClick={() => { setOpen(false); onSelectJson() }}
            >
              <span className="text-accent font-mono text-xs font-bold">{"{}"}</span>
              {t("importJson")}
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-surface transition-colors"
              onClick={() => { setOpen(false); onSelectCsv() }}
            >
              <span className="text-success font-mono text-xs font-bold">CSV</span>
              {t("importCsv")}
            </button>
          </div>
        </>
      )}
    </>
  )
}

interface ImportModalProps {
  format: ImportFormat
  mode: ImportMode
  onModeChange: (m: ImportMode) => void
  loading: boolean
  error: string | null
  result: ImportResult | null
  onFileSelect: () => void
  onSubmit: () => void
  onClose: () => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  t: (key: TranslationKey) => string
}

function ImportModal({
  format,
  mode,
  onModeChange,
  loading,
  error,
  result,
  onFileSelect,
  onSubmit,
  onClose,
  fileInputRef,
  t,
}: ImportModalProps) {
  const formatLabel = format === "json" ? "JSON" : "CSV"
  const [fileName, setFileName] = useState<string>("")

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    setFileName(file ? file.name : "")
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-surface-elevated shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-text-primary">
            {t(`import${format === "json" ? "Json" : "Csv"}`)}
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          {/* File picker */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">
              {formatLabel} {t("fileSelectLabel")}
            </label>
            <div className="flex gap-2">
              <div
                className="flex flex-1 items-center overflow-hidden rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              >
                <span className={fileName ? "text-text-primary" : "text-text-muted"}>
                  {fileName || t("noFileSelected")}
                </span>
              </div>
              <Button variant="secondary" size="sm" onClick={() => {
                // Attach onChange before click
                if (fileInputRef.current) {
                  fileInputRef.current.onchange = (e) =>
                    handleFileChange(e as unknown as React.ChangeEvent<HTMLInputElement>)
                }
                onFileSelect()
              }}>
                {t("browseFile")}
              </Button>
            </div>
          </div>

          {/* Mode selector */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">
              {t("importModeLabel")}
            </label>
            <div className="space-y-2">
              {(["merge", "replace"] as ImportMode[]).map((m) => (
                <label
                  key={m}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                    mode === m
                      ? "border-accent bg-accent/5"
                      : "border-border hover:border-accent/50 hover:bg-surface"
                  )}
                >
                  <input
                    type="radio"
                    name="import-mode"
                    value={m}
                    checked={mode === m}
                    onChange={() => onModeChange(m)}
                    className="mt-0.5 accent-accent"
                  />
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      {m === "merge" ? t("importModeMerge").split(" (")[0] : t("importModeReplace").split(" (")[0]}
                    </p>
                    <p className="text-xs text-text-muted">
                      {m === "merge"
                        ? t("importModeMerge").replace(/^[^(]+/, "").replace(/[()]/g, "")
                        : t("importModeReplace").replace(/^[^(]+/, "").replace(/[()]/g, "")}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
              {error}
            </div>
          )}

          {/* Success result */}
          {result && (
            <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
              {t("importSuccess").replace("{updated}", String(result.updated))}
              <span className="ml-2 text-text-muted">
                ({t("importMatchInfo").replace("{matched}", String(result.matched)).replace("{total}", String(result.total))})
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {result ? t("close") : t("cancel")}
          </Button>
          {!result && (
            <Button
              size="sm"
              loading={loading}
              onClick={onSubmit}
            >
              {t("importLabelBtn")}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
