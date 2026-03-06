"use client"

import { useState, useEffect, useCallback } from "react"
import { DownloadIcon, XIcon, RefreshCwIcon, Loader2Icon } from "lucide-react"
import { useLocale } from "@/hooks/use-locale"

interface UpdateInfo {
  version: string
  releaseDate?: string
}

interface UpdateProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export function UpdateBanner() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [ready, setReady] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const { t } = useLocale()

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.isElectron) return

    const cleanupAvailable = api.onUpdateAvailable?.((info: UpdateInfo) => {
      setUpdateInfo(info)
    })

    const cleanupProgress = api.onUpdateProgress?.((p: UpdateProgress) => {
      setProgress(p)
    })

    const cleanupDownloaded = api.onUpdateDownloaded?.(() => {
      setDownloading(false)
      setReady(true)
    })

    return () => {
      cleanupAvailable?.()
      cleanupProgress?.()
      cleanupDownloaded?.()
    }
  }, [])

  const handleDownload = useCallback(() => {
    const api = window.electronAPI
    if (!api) return
    setDownloading(true)
    api.downloadUpdate()
  }, [])

  const handleInstall = useCallback(() => {
    const api = window.electronAPI
    if (!api) return
    api.installUpdate()
  }, [])

  if (dismissed || !updateInfo) return null

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 text-sm border-b ${
        ready
          ? "bg-success/10 border-success/20"
          : "bg-accent-muted border-accent/20"
      }`}
    >
      {ready ? (
        <RefreshCwIcon className="size-4 text-success shrink-0" />
      ) : (
        <DownloadIcon className="size-4 text-accent shrink-0" />
      )}

      <span className="flex-1 text-text-primary text-[13px]">
        {ready
          ? t("updateReady").replace("{version}", updateInfo.version)
          : t("updateAvailable").replace("{version}", updateInfo.version)}
      </span>

      {downloading && progress && (
        <span className="text-xs text-text-secondary font-mono">
          {Math.round(progress.percent)}%
        </span>
      )}

      {downloading && !ready && (
        <Loader2Icon className="size-4 text-accent animate-spin shrink-0" />
      )}

      {!downloading && !ready && (
        <button
          onClick={handleDownload}
          className="px-3 py-1 rounded-md text-xs font-medium text-white bg-accent hover:bg-accent/90 transition-colors"
        >
          {t("download")}
        </button>
      )}

      {ready && (
        <button
          onClick={handleInstall}
          className="px-3 py-1 rounded-md text-xs font-medium text-white bg-success hover:bg-success/90 transition-colors"
        >
          {t("restart")}
        </button>
      )}

      <button
        onClick={() => setDismissed(true)}
        className="size-6 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary transition-colors"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  )
}
