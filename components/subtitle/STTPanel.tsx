"use client"

import { useState } from "react"
import { useLocale } from "@/hooks/use-locale"
import { useSubtitleJob } from "@/hooks/use-subtitle-job"
import { api } from "@/lib/api"
import type { SubtitleSet } from "@/lib/types"

interface STTPanelProps {
  subtitle: SubtitleSet | null
  mediaId: number
  mediaType: "video" | "audio"
  onComplete?: () => void
  onTranslateNow?: () => void
}

export function STTPanel({ subtitle, mediaId, mediaType, onComplete, onTranslateNow }: STTPanelProps) {
  const { t } = useLocale()
  const { jobProgress, startSTT, cancelJob, reset } = useSubtitleJob()
  const [provider, setProvider] = useState("whisper_api")
  const [language, setLanguage] = useState("")
  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState("")
  const [showSummary, setShowSummary] = useState(false)

  const isRunning = jobProgress.status === "running"
  const isComplete = jobProgress.status === "completed"

  const handleStart = async () => {
    if (!subtitle) return
    setError("")
    setShowSummary(false)

    try {
      // Extract audio first if video
      if (mediaType === "video") {
        setExtracting(true)
        await api.subtitle.extractAudio(mediaId, mediaType)
        setExtracting(false)
      }

      await startSTT(subtitle.id, { provider, language: language || undefined })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start STT")
      setExtracting(false)
    }
  }

  // Show summary on complete instead of immediately transitioning
  if (isComplete && !showSummary) {
    setShowSummary(true)
    reset()
  }

  // Summary card after STT completion
  if (showSummary && subtitle) {
    const lowConfCount = 0 // Will be calculated when segments are available
    return (
      <div className="space-y-3 p-4 border rounded-lg bg-card">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-green-500/15 flex items-center justify-center">
            <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="font-medium text-sm">{t("sttCompleted")}</h3>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{t("sttSegmentCount").replace("{count}", String(subtitle.segment_count))}</span>
          {subtitle.duration > 0 && (
            <span>{t("sttEstDuration").replace("{duration}", `${Math.round(subtitle.duration)}s`)}</span>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => { setShowSummary(false); onComplete?.() }}
            className="px-4 py-1.5 text-sm border rounded-md hover:bg-accent"
          >
            {t("reviewSegments")}
          </button>
          <button
            onClick={() => { setShowSummary(false); onTranslateNow?.() }}
            className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            {t("translateNow")}
          </button>
          <button
            onClick={() => { setShowSummary(false) }}
            className="px-4 py-1.5 text-sm border rounded-md hover:bg-accent text-muted-foreground"
          >
            {t("reRecognize")}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 p-4 border rounded-lg bg-card">
      <h3 className="font-medium text-sm">{t("sttProvider")}</h3>

      {/* Provider select */}
      <div className="flex gap-2">
        <button
          onClick={() => setProvider("whisper_api")}
          className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
            provider === "whisper_api" ? "bg-primary text-primary-foreground" : "hover:bg-accent"
          }`}
        >
          {t("whisperApi")}
        </button>
        <button
          disabled
          className="px-3 py-1.5 text-xs rounded-md border opacity-50 cursor-not-allowed"
          title="Phase 3"
        >
          {t("whisperLocal")}
        </button>
      </div>

      {/* Language select */}
      <div>
        <label className="text-xs text-muted-foreground">{t("sttLanguage")}</label>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="w-full mt-1 text-sm border rounded-md px-2 py-1.5 bg-background"
        >
          <option value="">{t("autoDetect")}</option>
          <option value="ja">{t("japanese")}</option>
          <option value="en">{t("english")}</option>
          <option value="ko">{t("korean")}</option>
          <option value="zh">{t("chinese")}</option>
        </select>
      </div>

      {/* Cost notice */}
      {provider === "whisper_api" && (
        <p className="text-[11px] text-muted-foreground">
          Whisper API: $0.006/min (~¥1/min)
        </p>
      )}

      {/* Progress */}
      {(isRunning || extracting) && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span>{extracting ? t("extractingAudio") : t("sttRunning")}</span>
            <span>{Math.round(jobProgress.progress * 100)}%</span>
          </div>
          <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${(extracting ? 0 : jobProgress.progress) * 100}%` }}
            />
          </div>
          {jobProgress.message && (
            <p className="text-[11px] text-muted-foreground">{jobProgress.message}</p>
          )}
        </div>
      )}

      {/* Error */}
      {(error || jobProgress.error) && (
        <p className="text-xs text-destructive">{error || jobProgress.error}</p>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {!isRunning && !extracting && (
          <button
            onClick={handleStart}
            disabled={!subtitle}
            className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {!subtitle ? "..." : t("sttStart")}
          </button>
        )}
        {(isRunning || extracting) && (
          <button
            onClick={cancelJob}
            className="px-4 py-1.5 text-sm border rounded-md hover:bg-destructive/10 text-destructive"
          >
            {t("cancel")}
          </button>
        )}
      </div>
    </div>
  )
}
