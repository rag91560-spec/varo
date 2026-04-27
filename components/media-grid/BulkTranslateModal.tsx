"use client"

import { useEffect, useState } from "react"
import { XIcon, Loader2Icon, SparklesIcon, CheckCircleIcon, XCircleIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLocale } from "@/hooks/use-locale"
import { useAudioBulkJob } from "@/hooks/use-audio-bulk-job"
import type { AudioItem } from "@/lib/types"

interface BulkTranslateModalProps {
  audioIds: number[]
  defaultCategoryId: number | null
  onClose: () => void
  onComplete: (updatedItems: AudioItem[]) => void
}

type Mode = "auto" | "script" | "auto_caption"

export function BulkTranslateModal({
  audioIds,
  defaultCategoryId,
  onClose,
  onComplete,
}: BulkTranslateModalProps) {
  const { t } = useLocale()

  const LANGS: Array<{ value: string; label: string }> = [
    { value: "ja", label: "日本語 (ja)" },
    { value: "en", label: "English (en)" },
    { value: "ko", label: t("koreanKo") },
    { value: "zh", label: "中文 (zh)" },
    { value: "auto", label: "Auto" },
  ]
  const { jobProgress, startBulkJob, cancelJob, reset } = useAudioBulkJob()

  const [mode, setMode] = useState<Mode>("auto")
  const [sourceLang, setSourceLang] = useState("ja")
  const [targetLang, setTargetLang] = useState("ko")
  const [useGlossary, setUseGlossary] = useState(true)
  const [error, setError] = useState("")
  const [started, setStarted] = useState(false)

  const isRunning = jobProgress.status === "running"
  const isDone = jobProgress.status === "completed"
  const isError = jobProgress.status === "error"
  const isCancelled = jobProgress.status === "cancelled"

  const handleStart = async () => {
    setError("")
    try {
      setStarted(true)
      await startBulkJob({
        audio_ids: audioIds,
        mode,
        source_lang: sourceLang,
        target_lang: targetLang,
        use_category_glossary: useGlossary,
      })
    } catch (e) {
      setStarted(false)
      setError(e instanceof Error ? e.message : "Failed to start job")
    }
  }

  // When job finishes, notify parent with updated items
  useEffect(() => {
    if (isDone || isCancelled) {
      const updates = jobProgress.item_updates || []
      if (updates.length > 0) {
        onComplete(updates)
      }
    }
  }, [isDone, isCancelled, jobProgress.item_updates, onComplete])

  const handleClose = () => {
    if (isRunning) return
    reset()
    onClose()
  }

  const progressPct = Math.round((jobProgress.progress || 0) * 100)
  const okCount = (jobProgress.results || []).filter((r) => r.ok).length
  const failCount = (jobProgress.results || []).filter((r) => !r.ok).length

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-lg rounded-xl border border-border-subtle bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <SparklesIcon className="size-5 text-accent" />
            <h2 className="text-base font-semibold text-text-primary">
              {t("bulkTranslate")}
            </h2>
            <span className="text-xs text-text-tertiary">
              ({audioIds.length})
            </span>
          </div>
          <button
            onClick={handleClose}
            disabled={isRunning}
            className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-overlay-4 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {!started && (
            <>
              {/* Options */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-text-tertiary">
                      {t("sourceLanguage")}
                    </span>
                    <select
                      value={sourceLang}
                      onChange={(e) => setSourceLang(e.target.value)}
                      className="px-3 py-1.5 text-sm rounded-md border border-border-subtle bg-surface-2 text-text-primary"
                    >
                      {LANGS.map((l) => (
                        <option key={l.value} value={l.value}>{l.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-text-tertiary">
                      {t("targetLanguage")}
                    </span>
                    <select
                      value={targetLang}
                      onChange={(e) => setTargetLang(e.target.value)}
                      className="px-3 py-1.5 text-sm rounded-md border border-border-subtle bg-surface-2 text-text-primary"
                    >
                      {LANGS.filter((l) => l.value !== "auto").map((l) => (
                        <option key={l.value} value={l.value}>{l.label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-xs text-text-tertiary">
                    {t("translationMethod")}
                  </span>
                  <div className="flex gap-2">
                    {([
                      { v: "auto", label: t("autoScriptPriority") },
                      { v: "script", label: t("scriptOnly") },
                      { v: "auto_caption", label: "STT" },
                    ] as const).map((opt) => (
                      <label
                        key={opt.v}
                        className={`flex-1 cursor-pointer px-3 py-2 rounded-md border text-xs text-center transition-colors ${
                          mode === opt.v
                            ? "border-accent bg-accent-muted text-text-primary"
                            : "border-border-subtle text-text-secondary hover:bg-overlay-4"
                        }`}
                      >
                        <input
                          type="radio"
                          name="bulk-mode"
                          value={opt.v}
                          checked={mode === opt.v}
                          onChange={() => setMode(opt.v)}
                          className="hidden"
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>

                {defaultCategoryId !== null && (
                  <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={useGlossary}
                      onChange={(e) => setUseGlossary(e.target.checked)}
                      className="size-4 accent-accent"
                    />
                    {t("applySeriesGlossary")}
                  </label>
                )}
              </div>

              {error && (
                <p className="text-xs text-red-400">{error}</p>
              )}
            </>
          )}

          {started && (
            <div className="space-y-3">
              {/* Progress */}
              <div className="flex items-center justify-between text-xs text-text-secondary">
                <span>
                  {jobProgress.done} / {jobProgress.total}
                </span>
                <span>{progressPct}%</span>
              </div>
              <div className="h-2 rounded-full bg-overlay-4 overflow-hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              {/* Current title */}
              <div className="flex items-center gap-2 text-xs text-text-tertiary min-h-[1.2em]">
                {isRunning && (
                  <Loader2Icon className="size-3.5 animate-spin shrink-0" />
                )}
                <span className="truncate">
                  {jobProgress.current_title || (isRunning ? t("preparing") : "")}
                </span>
              </div>

              {/* Result summary */}
              {(isDone || isCancelled) && (
                <div className="flex items-center gap-4 text-xs">
                  <span className="flex items-center gap-1 text-green-400">
                    <CheckCircleIcon className="size-3.5" />
                    {okCount} {t("success")}
                  </span>
                  {failCount > 0 && (
                    <span className="flex items-center gap-1 text-red-400">
                      <XCircleIcon className="size-3.5" />
                      {failCount} {t("failed")}
                    </span>
                  )}
                </div>
              )}

              {isError && (
                <p className="text-xs text-red-400">
                  {jobProgress.error || "Error"}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-subtle">
          {!started ? (
            <>
              <Button variant="secondary" size="sm" onClick={handleClose}>
                {t("cancel")}
              </Button>
              <Button size="sm" onClick={handleStart} disabled={audioIds.length === 0}>
                <SparklesIcon className="size-3.5" />
                {t("startTranslation")}
              </Button>
            </>
          ) : isRunning ? (
            <Button variant="secondary" size="sm" onClick={cancelJob}>
              {t("cancel")}
            </Button>
          ) : (
            <Button size="sm" onClick={handleClose}>
              {t("close")}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
