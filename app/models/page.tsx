"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import {
  BrainCircuitIcon,
  CheckCircleIcon,
  HardDriveIcon,
  CpuIcon,
  Loader2Icon,
  FolderOpenIcon,
  RefreshCwIcon,
  DownloadIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useLocale } from "@/hooks/use-locale"
import { api } from "@/lib/api"

interface ModelInfo {
  id: string
  name: string
  desc: string
  size: string
  speed: string
  quality: string
  installed: boolean
}

interface DownloadStatus {
  model_id: string
  status: "idle" | "pending" | "downloading" | "completed" | "failed" | "cancelled"
  progress: number
  downloaded_bytes: number
  total_bytes: number
  speed_bps: number
  eta_seconds: number
  error: string | null
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

// formatEta is locale-aware, see component body

export default function ModelsPage() {
  const { t } = useLocale()

  const formatEta = useCallback((seconds: number): string => {
    if (seconds <= 0) return ""
    if (seconds < 60) return `${Math.round(seconds)}${t("secondsUnit")}`
    if (seconds < 3600) return `${Math.round(seconds / 60)}${t("minutesUnit")}`
    return `${Math.round(seconds / 3600)}${t("hoursUnit")}`
  }, [t])

  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelsDir, setModelsDir] = useState("")
  const [loading, setLoading] = useState(true)
  const [downloads, setDownloads] = useState<Record<string, DownloadStatus>>({})
  const [deleting, setDeleting] = useState<Record<string, boolean>>({})
  const eventSourcesRef = useRef<Record<string, EventSource>>({})

  const loadModels = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.models.list()
      setModels(data.models)
      setModelsDir(data.models_dir)
    } catch {
      setModels([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadModels() }, [loadModels])

  // Cleanup all EventSources on unmount
  useEffect(() => {
    return () => {
      Object.values(eventSourcesRef.current).forEach((es) => es.close())
    }
  }, [])

  const connectSSE = useCallback((modelId: string) => {
    // Close existing connection if any
    if (eventSourcesRef.current[modelId]) {
      eventSourcesRef.current[modelId].close()
    }

    const url = api.models.downloadStatusUrl(modelId)
    const es = new EventSource(url)
    eventSourcesRef.current[modelId] = es

    es.addEventListener("status", (event) => {
      let data: DownloadStatus
      try {
        data = JSON.parse(event.data)
      } catch {
        return
      }
      setDownloads((prev) => ({ ...prev, [modelId]: data }))

      if (data.status === "completed") {
        es.close()
        delete eventSourcesRef.current[modelId]
        // Refresh model list to update installed status
        loadModels()
      } else if (data.status === "failed" || data.status === "cancelled" || data.status === "idle") {
        es.close()
        delete eventSourcesRef.current[modelId]
        if (data.status === "cancelled") {
          // Clean up download state after a brief moment
          setTimeout(() => {
            setDownloads((prev) => {
              const next = { ...prev }
              delete next[modelId]
              return next
            })
          }, 1500)
        }
      }
    })

    es.onerror = () => {
      es.close()
      delete eventSourcesRef.current[modelId]
    }
  }, [loadModels])

  const handleDownload = useCallback(async (modelId: string) => {
    try {
      await api.models.download(modelId)
      connectSSE(modelId)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("downloadStartFailed")
      setDownloads((prev) => ({
        ...prev,
        [modelId]: {
          model_id: modelId,
          status: "failed",
          progress: 0,
          downloaded_bytes: 0,
          total_bytes: 0,
          speed_bps: 0,
          eta_seconds: 0,
          error: message,
        },
      }))
    }
  }, [connectSSE])

  const handleCancel = useCallback(async (modelId: string) => {
    try {
      await api.models.downloadCancel(modelId)
    } catch {
      // SSE will handle status update
    }
  }, [])

  const handleDelete = useCallback(async (modelId: string) => {
    setDeleting((prev) => ({ ...prev, [modelId]: true }))
    try {
      await api.models.delete(modelId)
      await loadModels()
    } catch {
      // Silently fail — model list refresh will show correct state
    } finally {
      setDeleting((prev) => ({ ...prev, [modelId]: false }))
    }
  }, [loadModels])

  const installedCount = models.filter(m => m.installed).length

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight">
            {t("models")}
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            {t("modelsDescription")}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={loadModels}>
          <RefreshCwIcon className="size-4" />
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg p-4 text-center bg-overlay-2 border border-overlay-6">
          <p className="text-2xl font-bold text-accent">{models.length}</p>
          <p className="text-xs text-text-tertiary mt-1">{t("available")}</p>
        </div>
        <div className="rounded-lg p-4 text-center bg-overlay-2 border border-overlay-6">
          <p className="text-2xl font-bold text-success">{installedCount}</p>
          <p className="text-xs text-text-tertiary mt-1">{t("installed")}</p>
        </div>
        <div className="rounded-lg p-4 text-center bg-overlay-2 border border-overlay-6">
          <p className="text-2xl font-bold text-text-primary">{models.length - installedCount}</p>
          <p className="text-xs text-text-tertiary mt-1">{t("notInstalled")}</p>
        </div>
      </div>

      {/* Models Dir */}
      {modelsDir && (
        <div className="rounded-lg p-3 flex items-center gap-2 bg-overlay-2 border border-overlay-4">
          <FolderOpenIcon className="size-4 text-text-tertiary shrink-0" />
          <span className="text-xs text-text-tertiary font-mono truncate">{modelsDir}</span>
        </div>
      )}

      {/* Models List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2Icon className="size-8 text-accent animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {models.map((model) => {
            const dl = downloads[model.id]
            const isDownloading = dl && (dl.status === "downloading" || dl.status === "pending")
            const isFailed = dl && dl.status === "failed"
            const isCancelled = dl && dl.status === "cancelled"
            const isDeletingThis = deleting[model.id]

            return (
              <Card key={model.id} className="bg-surface">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className={`size-10 rounded-lg flex items-center justify-center shrink-0 ${
                        model.installed ? "bg-success/15" : "bg-accent/10"
                      }`}>
                        <BrainCircuitIcon className={`size-5 ${
                          model.installed ? "text-success" : "text-accent"
                        }`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-text-primary">{model.name}</h3>
                        <p className="text-xs text-text-secondary mt-0.5">{model.desc_key ? t(model.desc_key) : model.desc}</p>
                        <div className="flex items-center gap-4 mt-2">
                          <span className="flex items-center gap-1 text-xs text-text-tertiary">
                            <HardDriveIcon className="size-3" />
                            {model.size}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-text-tertiary">
                            <CpuIcon className="size-3" />
                            {model.speed_key ? t(model.speed_key) : model.speed}
                          </span>
                          <span className={`text-xs font-medium ${
                            (model.quality_key || model.quality) === "qualityBest" || model.quality === t("qualityBest") ? "text-accent" : "text-text-secondary"
                          }`}>
                            {t("quality")}: {model.quality_key ? t(model.quality_key) : model.quality}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action area */}
                    <div className="shrink-0 ml-4 flex flex-col items-end gap-2">
                      {model.installed ? (
                        <>
                          <div className="flex items-center gap-1.5 text-success text-xs font-medium">
                            <CheckCircleIcon className="size-4" />
                            {t("installed")}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-text-tertiary hover:text-error h-7 px-2"
                            onClick={() => handleDelete(model.id)}
                            disabled={isDeletingThis}
                          >
                            {isDeletingThis ? (
                              <Loader2Icon className="size-3.5 animate-spin mr-1" />
                            ) : (
                              <Trash2Icon className="size-3.5 mr-1" />
                            )}
                            {t("delete")}
                          </Button>
                        </>
                      ) : isDownloading ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-warning hover:text-error h-7 px-2"
                          onClick={() => handleCancel(model.id)}
                        >
                          <XIcon className="size-3.5 mr-1" />
                          {t("cancel")}
                        </Button>
                      ) : (
                        <>
                          {isFailed && (
                            <span className="text-xs text-error truncate max-w-[140px]" title={dl.error ?? ""}>
                              {dl.error ?? t("downloadFailed")}
                            </span>
                          )}
                          {isCancelled && (
                            <span className="text-xs text-text-tertiary">{t("cancelled")}</span>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-accent hover:text-accent h-7 px-2"
                            onClick={() => handleDownload(model.id)}
                          >
                            <DownloadIcon className="size-3.5 mr-1" />
                            {t("download")}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Progress bar for active downloads */}
                  {isDownloading && dl && (
                    <div className="mt-3 space-y-1.5">
                      <div className="w-full h-2 rounded-full bg-overlay-4 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-accent transition-all duration-300 ease-out"
                          style={{ width: `${dl.progress}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs text-text-tertiary">
                        <span>
                          {dl.progress.toFixed(1)}%
                          {dl.total_bytes > 0 && (
                            <> &middot; {formatBytes(dl.downloaded_bytes)} / {formatBytes(dl.total_bytes)}</>
                          )}
                        </span>
                        <span>
                          {dl.speed_bps > 0 && (
                            <>{formatBytes(dl.speed_bps)}/s</>
                          )}
                          {dl.eta_seconds > 0 && (
                            <> &middot; {formatEta(dl.eta_seconds)} {t("remaining")}</>
                          )}
                        </span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Info */}
      <div className="rounded-lg p-4 bg-overlay-2 border border-overlay-4">
        <p className="text-xs text-text-tertiary">
          {t("modelsInfoText")}
        </p>
      </div>
    </div>
  )
}
