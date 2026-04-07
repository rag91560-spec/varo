"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { useLocale } from "@/hooks/use-locale"
import { useSubtitles, useSubtitleSegments, useSubtitleJob } from "@/hooks/use-subtitle-job"
import { api } from "@/lib/api"
import type { SubtitleSet, SubtitleSegment, SubtitleStyleOptions, SubtitleGlossaryEntry } from "@/lib/types"
import { AI_PROVIDERS, getProvider } from "@/lib/providers"
import { ChipButton } from "@/components/game-detail/ChipButton"
import { SubtitleOverlay } from "./SubtitleOverlay"
import { SubtitleEditor } from "./SubtitleEditor"
import { SubtitleTimeline } from "./SubtitleTimeline"
import { STTPanel } from "./STTPanel"

interface SubtitleWorkspaceProps {
  mediaId: number
  mediaType: "video" | "audio"
  mediaSource: string
  mediaTitle: string
  onClose: () => void
}

type PipelineStep = "extract" | "stt" | "edit" | "translate" | "export"

const STEPS: PipelineStep[] = ["extract", "stt", "edit", "translate", "export"]

// ASS &HAABBGGRR ↔ hex #RRGGBB conversion
function assToHex(ass: string): string {
  const h = ass.replace(/^&H/i, "").padStart(8, "0")
  const r = h.slice(6, 8)
  const g = h.slice(4, 6)
  const b = h.slice(2, 4)
  return `#${r}${g}${b}`
}
function hexToAss(hex: string): string {
  const h = hex.replace("#", "")
  const r = h.slice(0, 2)
  const g = h.slice(2, 4)
  const b = h.slice(4, 6)
  return `&H00${b}${g}${r}`.toUpperCase()
}

const POSITION_PRESETS = [
  { label: "Bottom", alignment: 2, margin_v: 30 },
  { label: "Top", alignment: 8, margin_v: 30 },
  { label: "Center", alignment: 5, margin_v: 0 },
] as const

const DEFAULT_STYLE: SubtitleStyleOptions = {
  font_name: "Arial",
  font_size: 28,
  primary_color: "&H00FFFFFF",
  outline_color: "&H00000000",
  outline_width: 2,
  alignment: 2,
  margin_v: 30,
}

export function SubtitleWorkspace({
  mediaId, mediaType, mediaSource, mediaTitle, onClose,
}: SubtitleWorkspaceProps) {
  const { t } = useLocale()
  const { subtitles, loading: subsLoading, refresh: refreshSubtitles } = useSubtitles(mediaType, mediaId)
  const [activeSubtitleId, setActiveSubtitleId] = useState<number | null>(null)
  const { segments, subtitle, loading, refresh: refreshSegments, setSegments } = useSubtitleSegments(activeSubtitleId)
  const { jobProgress, startTranslate, cancelJob, reset: resetJob } = useSubtitleJob()
  const { jobProgress: hardsubProgress, startHardsub, cancelJob: cancelHardsub, reset: resetHardsub } = useSubtitleJob()
  const [currentStep, setCurrentStep] = useState<PipelineStep>("extract")
  const [currentTime, setCurrentTime] = useState(0)
  const [displayMode, setDisplayMode] = useState<"original" | "translated" | "both">("both")
  const [translating, setTranslating] = useState(false)
  const [translateError, setTranslateError] = useState("")
  const [analyzing, setAnalyzing] = useState(false)
  const [provider, setProvider] = useState(AI_PROVIDERS[0]?.id ?? "claude_oauth")
  const [selectedModel, setSelectedModel] = useState(AI_PROVIDERS[0]?.defaultModel ?? "sonnet")
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyleOptions>({ ...DEFAULT_STYLE })
  const [videoDuration, setVideoDuration] = useState(0)
  const [selectedSegmentId, setSelectedSegmentId] = useState<number | null>(null)
  const [positionMode, setPositionMode] = useState<"all" | "single">("all")
  const [fallbackProviders, setFallbackProviders] = useState<string[]>([])

  // Handle segment timing change from timeline drag
  const handleSegmentTimingChange = useCallback(async (segmentId: number, startTime: number, endTime: number) => {
    // Optimistic update
    setSegments((prev) =>
      prev.map((s) => s.id === segmentId ? { ...s, start_time: startTime, end_time: endTime } : s)
    )
    try {
      await api.subtitle.updateSegment(segmentId, { start_time: startTime, end_time: endTime })
    } catch {
      // Revert on failure
      refreshSegments()
    }
  }, [refreshSegments, setSegments])

  // Handle subtitle position drag — respects positionMode (all/single)
  const handlePositionChange = useCallback(async (segmentId: number, posX: number, posY: number) => {
    if (positionMode === "all" && activeSubtitleId) {
      // Apply to all segments
      setSegments((prev) => prev.map((s) => ({ ...s, pos_x: posX, pos_y: posY })))
      try {
        await api.subtitle.bulkUpdatePosition(activeSubtitleId, posX, posY)
      } catch {
        refreshSegments()
      }
    } else {
      // Apply to single segment
      setSegments((prev) =>
        prev.map((s) => s.id === segmentId ? { ...s, pos_x: posX, pos_y: posY } : s)
      )
      try {
        await api.subtitle.updateSegment(segmentId, { pos_x: posX, pos_y: posY })
      } catch {
        refreshSegments()
      }
    }
  }, [positionMode, activeSubtitleId, refreshSegments, setSegments])

  // Reset position to default (global style)
  const handlePositionReset = useCallback(async (segmentId: number) => {
    setSegments((prev) =>
      prev.map((s) => s.id === segmentId ? { ...s, pos_x: null, pos_y: null } : s)
    )
    try {
      await api.subtitle.updateSegment(segmentId, { pos_x: null, pos_y: null })
    } catch {
      refreshSegments()
    }
  }, [refreshSegments, setSegments])

  // Reset ALL positions to default
  const handlePositionResetAll = useCallback(async () => {
    if (!activeSubtitleId) return
    setSegments((prev) => prev.map((s) => ({ ...s, pos_x: null, pos_y: null })))
    try {
      await api.subtitle.bulkUpdatePosition(activeSubtitleId, null, null)
    } catch {
      refreshSegments()
    }
  }, [activeSubtitleId, refreshSegments, setSegments])

  // Segment CRUD handlers
  const handleSegmentCreate = useCallback(async (startTime: number, endTime: number) => {
    if (!activeSubtitleId) return
    try {
      await api.subtitle.createSegment(activeSubtitleId, { start_time: startTime, end_time: endTime })
      refreshSegments()
      refreshSubtitles()
    } catch {
      // ignore
    }
  }, [activeSubtitleId, refreshSegments, refreshSubtitles])

  const handleSegmentDelete = useCallback(async (segmentId: number) => {
    try {
      await api.subtitle.deleteSegment(segmentId)
      setSelectedSegmentId(null)
      refreshSegments()
      refreshSubtitles()
    } catch {
      // ignore
    }
  }, [refreshSegments, refreshSubtitles])

  const handleSegmentSplit = useCallback(async (segmentId: number, splitTime: number) => {
    try {
      await api.subtitle.splitSegment(segmentId, splitTime)
      refreshSegments()
      refreshSubtitles()
    } catch {
      // ignore
    }
  }, [refreshSegments, refreshSubtitles])

  // Translation context
  const [translationContext, setTranslationContext] = useState("")

  // Glossary
  const [glossary, setGlossary] = useState<SubtitleGlossaryEntry[]>([])
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  const [glossaryNewSource, setGlossaryNewSource] = useState("")
  const [glossaryNewTarget, setGlossaryNewTarget] = useState("")
  const [glossaryNewCategory, setGlossaryNewCategory] = useState<"general" | "character" | "place" | "term">("general")

  // Load glossary when subtitle changes
  useEffect(() => {
    if (!activeSubtitleId) return
    api.subtitle.getGlossary(activeSubtitleId).then(r => setGlossary(r.entries)).catch(() => {})
  }, [activeSubtitleId])

  const handleAddGlossary = async () => {
    if (!activeSubtitleId || !glossaryNewSource.trim() || !glossaryNewTarget.trim()) return
    try {
      await api.subtitle.upsertGlossary(activeSubtitleId, {
        source: glossaryNewSource.trim(),
        target: glossaryNewTarget.trim(),
        category: glossaryNewCategory,
      })
      const r = await api.subtitle.getGlossary(activeSubtitleId)
      setGlossary(r.entries)
      setGlossaryNewSource("")
      setGlossaryNewTarget("")
    } catch { /* ignore */ }
  }

  const handleDeleteGlossary = async (id: number) => {
    try {
      await api.subtitle.deleteGlossary(id)
      setGlossary(prev => prev.filter(e => e.id !== id))
    } catch { /* ignore */ }
  }

  const handleAutoGenerateGlossary = async () => {
    if (!activeSubtitleId || analyzing) return
    setAnalyzing(true)
    try {
      const result = await api.subtitle.analyzeVideo(activeSubtitleId, {
        provider,
        model: selectedModel,
      })
      setTranslationContext(result.context)
      // Refresh glossary (auto-generated entries may have been added)
      const r = await api.subtitle.getGlossary(activeSubtitleId)
      setGlossary(r.entries)
    } catch (e) {
      setTranslateError(e instanceof Error ? e.message : "분석 실패")
    } finally {
      setAnalyzing(false)
    }
  }

  // Auto-select best subtitle (prefer one with segments), or auto-create if none exist
  useEffect(() => {
    if (subtitles.length > 0 && !activeSubtitleId) {
      // Prefer subtitle with most segments, then most recent
      const best = [...subtitles].sort((a, b) => {
        if (b.segment_count !== a.segment_count) return b.segment_count - a.segment_count
        return b.id - a.id
      })[0]
      setActiveSubtitleId(best.id)
    } else if (subtitles.length === 0 && !activeSubtitleId && !subsLoading) {
      // Auto-create subtitle record so STT panel is immediately usable
      handleCreateSubtitle().catch(() => {})
    }
  }, [subtitles, activeSubtitleId])

  // Determine current step from subtitle status
  useEffect(() => {
    if (!subtitle) {
      setCurrentStep("extract")
      return
    }
    switch (subtitle.status) {
      case "pending": setCurrentStep("stt"); break
      case "transcribing": setCurrentStep("stt"); break
      case "transcribed": setCurrentStep("edit"); break
      case "translating": setCurrentStep("translate"); break
      case "translated": setCurrentStep("export"); break
      default: setCurrentStep("edit"); break
    }
  }, [subtitle?.status])

  // Time update handler
  const handleTimeUpdate = useCallback(() => {
    const el = mediaType === "video" ? videoRef.current : audioRef.current
    if (el) setCurrentTime(el.currentTime)
  }, [mediaType])

  const handleSeek = useCallback((time: number) => {
    const el = mediaType === "video" ? videoRef.current : audioRef.current
    if (el) {
      el.currentTime = time
      setCurrentTime(time)
    }
  }, [mediaType])

  // Create new subtitle
  const handleCreateSubtitle = async () => {
    const sub = await api.subtitle.create({
      media_id: mediaId,
      media_type: mediaType,
      label: mediaTitle,
    })
    await refreshSubtitles()
    setActiveSubtitleId(sub.id)
  }

  // Import subtitle file
  const handleImportFile = async () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".srt,.vtt,.ass,.ssa"
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const result = await api.subtitle.importFile(file, mediaId, mediaType, mediaTitle)
        await refreshSubtitles()
        setActiveSubtitleId(result.subtitle.id)
      } catch {
        // ignore
      }
    }
    input.click()
  }

  // Provider change handler
  const handleProviderChange = (id: string) => {
    setProvider(id)
    const p = getProvider(id)
    if (p) setSelectedModel(p.defaultModel)
  }

  // Start translation
  const handleTranslate = async () => {
    if (!activeSubtitleId) return
    setTranslating(true)
    setTranslateError("")
    try {
      // Save fallback providers setting
      if (fallbackProviders.length > 0) {
        await api.settings.put({ fallback_providers: fallbackProviders })
      }
      await startTranslate(activeSubtitleId, {
        source_lang: subtitle?.source_lang || "ja",
        target_lang: "ko",
        provider,
        model: selectedModel,
        ...(translationContext.trim() ? { context: translationContext.trim() } : {}),
      })
    } catch (e) {
      setTranslateError(e instanceof Error ? e.message : "Failed")
      setTranslating(false)
    }
  }

  // Watch translation completion — use progress object, not just status
  useEffect(() => {
    if (jobProgress.status === "completed") {
      if (translating) {
        // Show 100% briefly before hiding progress
        setTimeout(() => {
          setTranslating(false)
          refreshSegments()
          refreshSubtitles()
        }, 1500)
      }
    } else if (jobProgress.status === "error") {
      setTranslating(false)
      setTranslateError(jobProgress.error || "Unknown error")
    }
  }, [jobProgress])

  // Auto Sync (FFT-based)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState("")
  const [syncResult, setSyncResult] = useState<{ offset_ms: number; stretch_factor: number; confidence: number } | null>(null)

  const handleAutoSync = async () => {
    if (!activeSubtitleId) return
    setSyncing(true)
    setSyncError("")
    setSyncResult(null)
    try {
      const { job_id } = await api.subtitle.startSync(activeSubtitleId)
      // Listen to SSE
      const es = new EventSource(api.subtitle.syncStatusUrl(job_id))
      es.addEventListener("message", (e) => {
        const msg = JSON.parse(e.data)
        if (msg.event === "complete") {
          setSyncing(false)
          setSyncResult(msg.data)
          es.close()
          // Reload segments
          refreshSegments()
        } else if (msg.event === "error") {
          setSyncing(false)
          setSyncError(msg.data.message || "Sync failed")
          es.close()
        }
      })
      es.onerror = () => { setSyncing(false); es.close() }
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Failed")
      setSyncing(false)
    }
  }

  // Hardsub export
  const [hardsubbing, setHardsubbing] = useState(false)
  const [hardsubError, setHardsubError] = useState("")
  const [hardsubJobId, setHardsubJobId] = useState("")

  const handleHardsub = async () => {
    if (!activeSubtitleId) return
    setHardsubbing(true)
    setHardsubError("")
    try {
      const result = await startHardsub(activeSubtitleId, subtitleStyle)
      setHardsubJobId(result.job_id)
    } catch (e) {
      setHardsubError(e instanceof Error ? e.message : "Failed")
      setHardsubbing(false)
    }
  }

  // Watch hardsub completion
  useEffect(() => {
    if (hardsubProgress.status === "completed" && hardsubbing) {
      setHardsubbing(false)
      // Auto-download
      if (hardsubJobId) {
        api.subtitle.downloadHardsub(hardsubJobId).then(({ blob, filename }) => {
          const url = URL.createObjectURL(blob)
          const a = document.createElement("a")
          a.href = url
          a.download = filename
          a.click()
          URL.revokeObjectURL(url)
        }).catch(() => {})
      }
    } else if (hardsubProgress.status === "error") {
      setHardsubbing(false)
      setHardsubError(hardsubProgress.error || "Unknown error")
    }
  }, [hardsubProgress])

  // Export
  const handleExport = async (format: "srt" | "vtt" | "ass") => {
    if (!activeSubtitleId) return
    try {
      const { blob, filename } = await api.subtitle.exportBlob(activeSubtitleId, {
        format,
        use_translated: true,
        ...(format === "ass" ? {
          font_name: subtitleStyle.font_name,
          font_size: subtitleStyle.font_size,
          primary_color: subtitleStyle.primary_color,
          outline_color: subtitleStyle.outline_color,
          alignment: subtitleStyle.alignment,
          margin_v: subtitleStyle.margin_v,
        } : {}),
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // ignore
    }
  }

  const stepLabels: Record<PipelineStep, string> = {
    extract: t("stepExtract"),
    stt: t("stepSTT"),
    edit: t("stepEdit"),
    translate: t("stepTranslate"),
    export: t("stepExport"),
  }

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-card">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-sm hover:text-primary">
            ← {t("close")}
          </button>
          <h2 className="font-medium text-sm truncate max-w-[300px]">{mediaTitle}</h2>
        </div>

        {/* Pipeline steps indicator */}
        <div className="flex items-center gap-0.5">
          {STEPS.map((step, i) => {
            const stepIdx = STEPS.indexOf(currentStep)
            const isDone = i < stepIdx
            const isActive = step === currentStep
            return (
              <div key={step} className="flex items-center">
                {i > 0 && (
                  <div className={`w-8 h-0.5 ${isDone ? "bg-primary" : "bg-muted"}`} />
                )}
                <button
                  onClick={() => setCurrentStep(step)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full transition-all ${
                    isActive ? "bg-primary text-primary-foreground shadow-sm" :
                    isDone ? "bg-primary/15 text-primary hover:bg-primary/25" :
                    "bg-muted/50 text-muted-foreground"
                  }`}
                >
                  {isDone ? (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : isActive ? (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-foreground opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary-foreground" />
                    </span>
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                  )}
                  {stepLabels[step]}
                </button>
              </div>
            )
          })}
        </div>

        {/* Display mode */}
        <div className="flex items-center gap-1 text-xs">
          {(["original", "translated", "both"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setDisplayMode(mode)}
              className={`px-2 py-1 rounded ${displayMode === mode ? "bg-primary/20 text-primary" : "hover:bg-accent"}`}
            >
              {mode === "original" ? t("subtitleOriginal") :
               mode === "translated" ? t("subtitleTranslation") :
               t("subtitleBoth")}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Media player */}
        <div className="w-1/2 flex flex-col border-r">
          <div className="flex-1 relative bg-black flex items-center justify-center">
            {mediaType === "video" ? (
              <>
                <video
                  ref={videoRef}
                  src={mediaSource}
                  controls
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={() => {
                    if (videoRef.current) setVideoDuration(videoRef.current.duration || 0)
                  }}
                  className="max-h-full max-w-full"
                />
                <SubtitleOverlay
                  segments={segments}
                  currentTime={currentTime}
                  displayMode={displayMode}
                  style={subtitleStyle}
                  editable={currentStep === "export" || currentStep === "edit"}
                  onPositionChange={handlePositionChange}
                />
              </>
            ) : (
              <div className="p-6 w-full">
                <audio
                  ref={audioRef}
                  src={mediaSource}
                  controls
                  onTimeUpdate={handleTimeUpdate}
                  className="w-full"
                />
              </div>
            )}
          </div>

          {/* Timeline track */}
          {videoDuration > 0 && mediaType === "video" && (
            <SubtitleTimeline
              segments={segments}
              duration={videoDuration}
              currentTime={currentTime}
              selectedSegmentId={selectedSegmentId}
              subtitleId={activeSubtitleId}
              mediaId={mediaId}
              mediaType={mediaType}
              onSeek={handleSeek}
              onSegmentSelect={setSelectedSegmentId}
              onSegmentTimingChange={handleSegmentTimingChange}
              onSegmentCreate={handleSegmentCreate}
              onSegmentDelete={handleSegmentDelete}
              onSegmentSplit={handleSegmentSplit}
            />
          )}

          {/* Subtitle info bar */}
          {subtitle && (
            <div className="px-3 py-1.5 border-t text-xs text-muted-foreground flex items-center gap-4">
              <span>{t("status")}: {subtitle.status}</span>
              <span>{t("subtitleSegments")}: {subtitle.segment_count}</span>
              {subtitle.duration > 0 && (
                <span>{t("subtitleDuration")}: {Math.round(subtitle.duration)}s</span>
              )}
              {subtitle.source_lang && <span>{subtitle.source_lang} → {subtitle.target_lang || "?"}</span>}
            </div>
          )}
        </div>

        {/* Right: Controls / Editor */}
        <div className="w-1/2 flex flex-col overflow-hidden">
          {/* No subtitle yet */}
          {!activeSubtitleId && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
              <p className="text-sm text-muted-foreground">{t("noSubtitles")}</p>
              <div className="flex gap-2">
                <button
                  onClick={handleCreateSubtitle}
                  className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                >
                  {t("createSubtitle")}
                </button>
                <button
                  onClick={handleImportFile}
                  className="px-4 py-2 text-sm border rounded-md hover:bg-accent"
                >
                  {t("importSubtitleFile")}
                </button>
              </div>
            </div>
          )}

          {/* Subtitle selector — always visible when multiple subtitles exist */}
          {subtitles.length > 1 && (currentStep === "extract" || currentStep === "stt") && (
            <div className="px-3 py-2 border-b flex items-center gap-2">
              <span className="text-xs text-muted-foreground">자막:</span>
              <select
                value={activeSubtitleId ?? ""}
                onChange={(e) => setActiveSubtitleId(Number(e.target.value))}
                className="text-xs border rounded px-2 py-1 bg-background flex-1"
              >
                {subtitles.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label || `#${s.id}`} ({s.status}, {s.segment_count}seg)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* STT Panel (for extract/stt steps) */}
          {activeSubtitleId && (currentStep === "extract" || currentStep === "stt") && (
            <div className="p-4">
              <STTPanel
                subtitle={subtitle}
                mediaId={mediaId}
                mediaType={mediaType}
                onComplete={() => {
                  refreshSegments()
                  refreshSubtitles()
                  setCurrentStep("edit")
                }}
                onTranslateNow={() => {
                  refreshSegments()
                  refreshSubtitles()
                  setCurrentStep("translate")
                }}
              />
              {/* Import alternative */}
              <div className="mt-3 text-center">
                <button
                  onClick={handleImportFile}
                  className="text-xs text-muted-foreground hover:text-primary underline"
                >
                  {t("importSubtitleFile")}
                </button>
              </div>
            </div>
          )}

          {/* Editor (edit/translate/export steps) */}
          {activeSubtitleId && currentStep !== "extract" && currentStep !== "stt" && (
            <>
              {/* Export step */}
              {currentStep === "export" && subtitle && (
                <div className="mx-3 mt-3 space-y-3 overflow-y-auto">
                  {/* Top: completion banner + export + retranslate */}
                  <div className="flex flex-wrap items-center gap-2 p-3 border rounded-lg bg-card">
                    <div className="w-5 h-5 rounded-full bg-green-500/15 flex items-center justify-center">
                      <svg className="w-3 h-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <span className="text-sm font-medium">{t("translationCompleted")}</span>
                    <span className="text-xs text-muted-foreground">
                      {t("segmentsTranslated").replace("{count}", String(subtitle.segment_count))}
                    </span>
                    <div className="flex-1" />
                    {(["srt", "vtt", "ass"] as const).map((fmt) => (
                      <button
                        key={fmt}
                        onClick={() => handleExport(fmt)}
                        className="px-3 py-1 text-xs bg-primary/10 text-primary border border-primary/20 rounded-md hover:bg-primary/20 uppercase font-medium"
                      >
                        {fmt}
                      </button>
                    ))}
                    <button
                      onClick={() => setCurrentStep("translate")}
                      className="px-2 py-1 text-xs text-muted-foreground border rounded hover:bg-accent hover:text-foreground"
                    >
                      {t("retranslate")}
                    </button>
                  </div>

                  {/* Hardsub section (video only) */}
                  {mediaType === "video" && (
                    <div className="p-3 border rounded-lg bg-card">
                      <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Hardsub</h4>
                      {!hardsubbing ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleHardsub}
                            className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
                          >
                            {t("exportHardsub")}
                          </button>
                          {hardsubError && (
                            <span className="text-xs text-destructive">{hardsubError}</span>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-xs">{t("hardsubProgress")}</span>
                          <div className="w-32 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-600 transition-all"
                              style={{ width: `${hardsubProgress.progress * 100}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono">{Math.round(hardsubProgress.progress * 100)}%</span>
                          <button
                            onClick={cancelHardsub}
                            className="px-2 py-0.5 text-xs text-destructive border rounded hover:bg-destructive/10"
                          >
                            {t("cancel")}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Style Inspector — always visible */}
                  <div className="p-3 border rounded-lg bg-card space-y-3">
                    <div className="flex items-center gap-1.5">
                      <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <h4 className="text-sm font-medium">자막 스타일</h4>
                    </div>

                    {/* Text section */}
                    <div className="space-y-2">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">텍스트</span>
                      {/* Font size */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-16">글꼴 크기</span>
                        <input
                          type="range"
                          min={16}
                          max={60}
                          value={subtitleStyle.font_size}
                          onChange={(e) => setSubtitleStyle(s => ({ ...s, font_size: Number(e.target.value) }))}
                          className="flex-1 h-1 accent-primary"
                        />
                        <span className="text-xs font-mono w-12 text-right">{subtitleStyle.font_size}px</span>
                      </div>
                      {/* Text color */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-16">색상</span>
                        <input
                          type="color"
                          value={assToHex(subtitleStyle.primary_color)}
                          onChange={(e) => setSubtitleStyle(s => ({ ...s, primary_color: hexToAss(e.target.value) }))}
                          className="w-7 h-7 rounded border border-muted cursor-pointer bg-transparent p-0"
                        />
                        <span className="text-xs font-mono text-muted-foreground">{assToHex(subtitleStyle.primary_color).toUpperCase()}</span>
                      </div>
                    </div>

                    <div className="border-t" />

                    {/* Outline section */}
                    <div className="space-y-2">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">외곽선</span>
                      {/* Outline width */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-16">두께</span>
                        <input
                          type="range"
                          min={0}
                          max={8}
                          value={subtitleStyle.outline_width}
                          onChange={(e) => setSubtitleStyle(s => ({ ...s, outline_width: Number(e.target.value) }))}
                          className="flex-1 h-1 accent-primary"
                        />
                        <span className="text-xs font-mono w-12 text-right">{subtitleStyle.outline_width}</span>
                      </div>
                      {/* Outline color */}
                      <div className={`flex items-center gap-2 transition-opacity ${subtitleStyle.outline_width === 0 ? "opacity-40 pointer-events-none" : ""}`}>
                        <span className="text-xs text-muted-foreground w-16">색상</span>
                        <input
                          type="color"
                          value={assToHex(subtitleStyle.outline_color)}
                          onChange={(e) => setSubtitleStyle(s => ({ ...s, outline_color: hexToAss(e.target.value) }))}
                          className="w-7 h-7 rounded border border-muted cursor-pointer bg-transparent p-0"
                        />
                        <span className="text-xs font-mono text-muted-foreground">{assToHex(subtitleStyle.outline_color).toUpperCase()}</span>
                      </div>
                    </div>

                    <div className="border-t" />

                    {/* Position */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">위치</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground">드래그 적용:</span>
                          {(["all", "single"] as const).map((mode) => (
                            <button
                              key={mode}
                              onClick={() => setPositionMode(mode)}
                              className={`px-1.5 py-0.5 text-[10px] rounded transition-all ${
                                positionMode === mode
                                  ? "bg-primary/15 text-primary font-medium"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {mode === "all" ? "전체" : "개별"}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        {POSITION_PRESETS.map((p) => (
                          <button
                            key={p.label}
                            onClick={() => setSubtitleStyle(s => ({ ...s, alignment: p.alignment, margin_v: p.margin_v }))}
                            className={`flex-1 px-3 py-1.5 text-xs rounded-md border transition-all ${
                              subtitleStyle.alignment === p.alignment
                                ? "bg-primary/15 text-primary border-primary/30 font-medium"
                                : "border-muted hover:bg-accent"
                            }`}
                          >
                            {p.label === "Bottom" ? "하단" :
                             p.label === "Center" ? "중앙" : "상단"}
                          </button>
                        ))}
                      </div>
                      {/* Per-segment / bulk position controls */}
                      {(() => {
                        const activeSeg = segments.find(s => s.start_time <= currentTime && s.end_time >= currentTime)
                        const hasPos = activeSeg?.pos_x != null && activeSeg?.pos_y != null
                        const anyHasPos = segments.some(s => s.pos_x != null && s.pos_y != null)
                        if (!hasPos && !anyHasPos) return null
                        return (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {hasPos && activeSeg && positionMode === "single" && (
                              <button
                                onClick={() => handlePositionReset(activeSeg.id)}
                                className="px-2 py-1 text-[10px] rounded border border-muted text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-colors"
                              >
                                현재 자막 초기화
                              </button>
                            )}
                            {anyHasPos && (
                              <button
                                onClick={handlePositionResetAll}
                                className="px-2 py-1 text-[10px] rounded border border-muted text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-colors"
                              >
                                전체 초기화
                              </button>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {/* Action bar */}
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b">
                {currentStep === "edit" && segments.length > 0 && (
                  <>
                    <button
                      onClick={handleAutoSync}
                      disabled={syncing}
                      className="px-3 py-1 text-xs bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 disabled:opacity-50"
                    >
                      {syncing ? "Syncing..." : "Auto Sync"}
                    </button>
                    {syncResult && (
                      <span className="text-[10px] text-muted-foreground">
                        {syncResult.offset_ms > 0 ? "+" : ""}{Math.round(syncResult.offset_ms)}ms
                        {syncResult.stretch_factor !== 1 && ` ×${syncResult.stretch_factor.toFixed(4)}`}
                        {` (${Math.round(syncResult.confidence * 100)}%)`}
                      </span>
                    )}
                    {syncError && <span className="text-[10px] text-destructive">{syncError}</span>}
                    <button
                      onClick={() => setCurrentStep("translate")}
                      className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                    >
                      {t("translateSubtitle")} →
                    </button>
                  </>
                )}
                {currentStep === "translate" && (
                  <div className="flex flex-col gap-2 w-full">
                    {/* Provider selection */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">{t("aiProvider")}:</span>
                      {AI_PROVIDERS.map((p) => (
                        <ChipButton
                          key={p.id}
                          selected={provider === p.id}
                          onClick={() => handleProviderChange(p.id)}
                        >
                          {p.name}
                        </ChipButton>
                      ))}
                    </div>

                    {/* Model selection (only if provider has 2+ models) */}
                    {(() => {
                      const currentProvider = getProvider(provider)
                      return currentProvider && currentProvider.models.length > 1 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">{t("model")}:</span>
                          {currentProvider.models.map((m) => (
                            <ChipButton
                              key={m}
                              selected={selectedModel === m}
                              onClick={() => setSelectedModel(m)}
                            >
                              {m}
                            </ChipButton>
                          ))}
                        </div>
                      ) : null
                    })()}

                    {/* Fallback providers */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">폴백:</span>
                      {AI_PROVIDERS.filter(p => p.id !== provider).map(p => (
                        <label key={p.id} className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={fallbackProviders.includes(p.id)}
                            onChange={(e) => {
                              setFallbackProviders(prev =>
                                e.target.checked
                                  ? [...prev, p.id]
                                  : prev.filter(id => id !== p.id)
                              )
                            }}
                            className="rounded border-muted accent-primary"
                          />
                          {p.name}
                        </label>
                      ))}
                    </div>

                    {/* Translation context */}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">컨텍스트:</span>
                        {mediaType === "video" && (
                          <button
                            onClick={async () => {
                              if (!activeSubtitleId || analyzing) return
                              setAnalyzing(true)
                              setTranslateError("")
                              try {
                                const result = await api.subtitle.analyzeVideo(activeSubtitleId, {
                                  provider,
                                  model: selectedModel,
                                })
                                setTranslationContext(result.context)
                              } catch (e) {
                                setTranslateError(e instanceof Error ? e.message : "분석 실패")
                              } finally {
                                setAnalyzing(false)
                              }
                            }}
                            disabled={analyzing || translating}
                            className="px-2 py-0.5 text-[11px] rounded-full border border-blue-400/50 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                          >
                            {analyzing ? "분석 중..." : "영상 자동 분석"}
                          </button>
                        )}
                      </div>
                      <textarea
                        value={translationContext}
                        onChange={(e) => setTranslationContext(e.target.value)}
                        placeholder="영상 자동 분석을 누르면 작품명, 캐릭터, 용어 등을 자동으로 파악��니다. 직접 입력도 가능합니다."
                        rows={translationContext ? 5 : 2}
                        className="w-full text-xs px-2 py-1.5 rounded-md border bg-background resize-none placeholder:text-muted-foreground/50"
                      />
                    </div>

                    {/* Glossary Panel */}
                    <div className="border rounded-md overflow-hidden">
                      <button
                        onClick={() => setGlossaryOpen(!glossaryOpen)}
                        className="w-full flex items-center justify-between px-2 py-1.5 text-xs hover:bg-accent/30 transition-colors"
                      >
                        <span className="font-medium">��어집 ({glossary.length})</span>
                        <svg className={`w-3 h-3 transition-transform ${glossaryOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {glossaryOpen && (
                        <div className="border-t">
                          {glossary.length > 0 && (
                            <div className="max-h-40 overflow-y-auto">
                              <table className="w-full text-xs">
                                <thead className="bg-muted/30 sticky top-0">
                                  <tr>
                                    <th className="px-2 py-1 text-left font-medium">원문</th>
                                    <th className="px-2 py-1 text-left font-medium">번역</th>
                                    <th className="px-2 py-1 text-left font-medium w-16">분류</th>
                                    <th className="w-6" />
                                  </tr>
                                </thead>
                                <tbody>
                                  {glossary.map(e => (
                                    <tr key={e.id} className="border-t hover:bg-accent/20">
                                      <td className="px-2 py-0.5">{e.source}</td>
                                      <td className="px-2 py-0.5">{e.target}</td>
                                      <td className="px-2 py-0.5 text-muted-foreground">
                                        {e.category === "character" ? "인물" :
                                         e.category === "place" ? "장소" :
                                         e.category === "term" ? "용어" : "일반"}
                                      </td>
                                      <td>
                                        <button
                                          onClick={() => handleDeleteGlossary(e.id)}
                                          className="p-0.5 text-muted-foreground hover:text-destructive"
                                        >
                                          ×
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                          <div className="flex items-center gap-1 p-1.5 border-t bg-muted/10">
                            <input
                              value={glossaryNewSource}
                              onChange={e => setGlossaryNewSource(e.target.value)}
                              placeholder="원문"
                              className="flex-1 text-xs px-1.5 py-1 rounded border bg-background min-w-0"
                              onKeyDown={e => e.key === "Enter" && handleAddGlossary()}
                            />
                            <input
                              value={glossaryNewTarget}
                              onChange={e => setGlossaryNewTarget(e.target.value)}
                              placeholder="번역"
                              className="flex-1 text-xs px-1.5 py-1 rounded border bg-background min-w-0"
                              onKeyDown={e => e.key === "Enter" && handleAddGlossary()}
                            />
                            <select
                              value={glossaryNewCategory}
                              onChange={e => setGlossaryNewCategory(e.target.value as typeof glossaryNewCategory)}
                              className="text-xs px-1 py-1 rounded border bg-background w-14"
                            >
                              <option value="general">일반</option>
                              <option value="character">인물</option>
                              <option value="place">장소</option>
                              <option value="term">용어</option>
                            </select>
                            <button
                              onClick={handleAddGlossary}
                              disabled={!glossaryNewSource.trim() || !glossaryNewTarget.trim()}
                              className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                            >
                              +
                            </button>
                          </div>
                          {mediaType === "video" && (
                            <div className="px-1.5 pb-1.5">
                              <button
                                onClick={handleAutoGenerateGlossary}
                                disabled={analyzing || translating}
                                className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                              >
                                {analyzing ? "분석 중..." : "영상 분석으로 자동 생성"}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Translate button / progress */}
                    <div className="flex items-center gap-2">
                      {!translating ? (
                        <button
                          onClick={handleTranslate}
                          disabled={analyzing}
                          className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                        >
                          {t("translateSubtitle")}
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all duration-300 ${
                                jobProgress.status === "completed" ? "bg-green-500" : "bg-primary"
                              }`}
                              style={{ width: `${Math.max(jobProgress.progress * 100, 2)}%` }}
                            />
                          </div>
                          <span className="text-xs min-w-[3rem]">
                            {jobProgress.status === "completed"
                              ? "완료!"
                              : jobProgress.message && jobProgress.progress < 0.1
                                ? jobProgress.message
                                : `${Math.round(jobProgress.progress * 100)}%`}
                          </span>
                          {jobProgress.status !== "completed" && (
                            <button
                              onClick={cancelJob}
                              className="px-2 py-0.5 text-xs text-destructive border rounded hover:bg-destructive/10"
                            >
                              {t("cancel")}
                            </button>
                          )}
                        </div>
                      )}
                      {translateError && (
                        <span className="text-xs text-destructive">{translateError}</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Re-recognize (STT) button — always available */}
                <button
                  onClick={() => setCurrentStep("stt")}
                  className="px-2 py-1 text-xs border rounded-md hover:bg-accent text-muted-foreground"
                  title={t("reRecognize")}
                >
                  {t("reRecognize")}
                </button>

                <div className="flex-1" />

                {/* Subtitle selector if multiple */}
                {subtitles.length > 1 && (
                  <select
                    value={activeSubtitleId ?? ""}
                    onChange={(e) => setActiveSubtitleId(Number(e.target.value))}
                    className="text-xs border rounded px-2 py-1 bg-background"
                  >
                    {subtitles.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label || `#${s.id}`} ({s.status})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Segment editor */}
              <SubtitleEditor
                segments={segments}
                currentTime={currentTime}
                onSeek={handleSeek}
                onSegmentsChange={refreshSegments}
                glossary={glossary}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
