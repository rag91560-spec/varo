"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { XIcon, FolderOpenIcon, LinkIcon, FileTextIcon, MusicIcon, FolderIcon, Loader2Icon, SearchIcon, DownloadIcon, SparklesIcon, CheckCircleIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FolderBrowser } from "@/components/FolderBrowser"
import { useLocale } from "@/hooks/use-locale"
import { api } from "@/lib/api"
import type { VideoItem, AudioItem } from "@/lib/types"

interface AddMediaModalProps {
  mediaType: "video" | "audio"
  onClose: () => void
  onAdded: (item: VideoItem | AudioItem) => void
  onRequestBulkTranslate?: (audioIds: number[], categoryId: number | null) => void
  onCategoryCreated?: (category: { id: number; name: string }) => void
}

type Tab = "local" | "folder" | "url" | "browse"

const SCRIPT_EXTS = new Set([".srt", ".vtt", ".lrc"])

function getExt(name: string): string {
  const i = name.lastIndexOf(".")
  return i >= 0 ? name.slice(i).toLowerCase() : ""
}

function isScriptFile(name: string): boolean {
  return SCRIPT_EXTS.has(getExt(name))
}

/** Strip extension to get base name for matching */
function baseName(name: string): string {
  const fname = name.split(/[\\/]/).pop() || name
  const i = fname.lastIndexOf(".")
  return i >= 0 ? fname.slice(0, i).toLowerCase() : fname.toLowerCase()
}

export function AddMediaModal({
  mediaType,
  onClose,
  onAdded,
  onRequestBulkTranslate,
  onCategoryCreated,
}: AddMediaModalProps) {
  const { t } = useLocale()
  const [tab, setTab] = useState<Tab>("local")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [browserFiles, setBrowserFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [url, setUrl] = useState("")
  const [urlTitle, setUrlTitle] = useState("")
  const [folderPath, setFolderPath] = useState("")
  const [folderAutoCategory, setFolderAutoCategory] = useState(true)
  const [folderScanResult, setFolderScanResult] = useState<{
    audioIds: number[]
    categoryId: number | null
    categoryName: string
  } | null>(null)
  const [browsePath, setBrowsePath] = useState("")

  // YouTube download state
  const [dlJobId, setDlJobId] = useState("")
  const [dlProgress, setDlProgress] = useState(0)
  const [dlMessage, setDlMessage] = useState("")

  const isYouTubeUrl = useCallback((u: string) => {
    return /(?:youtube\.com|youtu\.be|nicovideo\.jp|bilibili\.com)/.test(u)
  }, [])

  // SSE listener for download progress
  useEffect(() => {
    if (!dlJobId) return
    const es = new EventSource(api.videos.downloadStatusUrl(dlJobId))
    es.addEventListener("progress", ((e: MessageEvent) => {
      const d = JSON.parse(e.data)
      setDlProgress(d.progress ?? 0)
      setDlMessage(d.message ?? "")
    }) as EventListener)
    es.addEventListener("complete", ((e: MessageEvent) => {
      const d = JSON.parse(e.data)
      setDlProgress(1)
      setDlMessage("")
      setDlJobId("")
      setLoading(false)
      if (d.video_id) {
        onAdded({ id: d.video_id, title: d.title ?? "Downloaded", type: "local", source: "", thumbnail: "", duration: d.duration ?? 0, size: d.filesize ?? 0, category_id: null, sort_order: 0, created_at: "", updated_at: "" })
        onClose()
      }
    }) as EventListener)
    es.addEventListener("error", ((e: MessageEvent) => {
      try { const d = JSON.parse(e.data); setError(d.message ?? "Download failed") } catch { setError("Download failed") }
      setDlJobId("")
      setLoading(false)
    }) as EventListener)
    es.addEventListener("cancelled", () => {
      setDlJobId("")
      setLoading(false)
      setError("Download cancelled")
    })
    es.onerror = () => { es.close() }
    return () => es.close()
  }, [dlJobId, onAdded, onClose])

  const isElectron = typeof window !== "undefined" && !!window.electronAPI?.isElectron
  const isVideo = mediaType === "video"
  const accept = isVideo
    ? "video/*"
    : ".mp3,.ogg,.wav,.flac,.m4a,.aac,.wma,.opus,.srt,.vtt,.lrc,audio/*"
  const addLabel = isVideo ? t("addVideo") : t("addAudio")
  const browseFilter = isVideo
    ? ".mp4,.mkv,.avi,.webm,.mov,.srt,.ass,.vtt"
    : ".mp3,.wav,.ogg,.flac,.m4a,.aac,.wma,.opus,.srt,.vtt,.lrc"

  const apiNs = isVideo ? api.videos : api.audio

  const handleSelectFiles = async () => {
    if (isElectron && isVideo) {
      try {
        const files = await window.electronAPI?.selectVideoFiles?.()
        if (files?.length) {
          setSelectedFiles(files)
          setError("")
          return
        }
      } catch {}
    }
    fileInputRef.current?.click()
  }

  const handleBrowserFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length) {
      setBrowserFiles(files)
      setSelectedFiles(files.map(f => f.name))
      setError("")
    }
  }

  const handleAddLocal = async () => {
    if (!selectedFiles.length) return
    setLoading(true)
    setError("")
    try {
      if (browserFiles.length > 0) {
        // Separate script files from the rest (treat unknown extensions as audio)
        const scriptFiles = isVideo ? [] : browserFiles.filter(f => isScriptFile(f.name))
        const audioFiles = browserFiles.filter(f => !isScriptFile(f.name))

        // If only script files and no audio, show error
        if (audioFiles.length === 0 && scriptFiles.length > 0) {
          setError(t("addAudio"))
          setLoading(false)
          return
        }

        // Upload audio/video files first
        const createdItems: AudioItem[] = []
        for (const file of audioFiles) {
          const item = await apiNs.addFile(file)
          onAdded(item)
          if (!isVideo) createdItems.push(item as AudioItem)
        }

        // Auto-pair script files with audio items by matching base name
        if (!isVideo && scriptFiles.length > 0 && createdItems.length > 0) {
          for (const sf of scriptFiles) {
            const sfBase = baseName(sf.name)
            const match = createdItems.find(a => baseName(a.title) === sfBase)
            const target = match || createdItems[0]
            try {
              const updated = await api.audio.uploadScript(target.id, sf)
              onAdded(updated)
            } catch {}
          }
        }
      } else {
        for (const filePath of selectedFiles) {
          const name = filePath.split(/[\\/]/).pop() || filePath
          const item = await apiNs.add({ title: name, type: "local", source: filePath })
          onAdded(item)
        }
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleAddFolder = async () => {
    const path = folderPath.trim()
    if (!path) return
    setLoading(true)
    setError("")
    try {
      // Optionally create a category from folder basename first
      let categoryId: number | null = null
      let categoryName = ""
      if (folderAutoCategory) {
        const base = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path
        categoryName = base
        try {
          const cat = await api.categories.create({
            name: base,
            media_type: isVideo ? "video" : "audio",
          })
          categoryId = cat.id
          onCategoryCreated?.({ id: cat.id, name: cat.name })
        } catch (e) {
          // Non-fatal: continue scan without category
          console.warn("Failed to create category from folder name:", e)
        }
      }

      const result = await api.audio.scanFolder(path, { categoryId })
      const items = result.created_items
      for (const item of items) {
        onAdded(item)
      }

      // Show "translate now" prompt if we have scanned items and parent supports it
      if (items.length > 0 && onRequestBulkTranslate) {
        setFolderScanResult({
          audioIds: items.map((it) => it.id),
          categoryId,
          categoryName,
        })
      } else {
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleStartBulkTranslate = () => {
    if (!folderScanResult || !onRequestBulkTranslate) return
    const { audioIds, categoryId } = folderScanResult
    onRequestBulkTranslate(audioIds, categoryId)
    onClose()
  }

  const handleAddUrl = async () => {
    if (!url.trim()) return
    try { new URL(url.trim()) } catch {
      setError(t("invalidUrl"))
      return
    }
    setLoading(true)
    setError("")
    try {
      // YouTube-like URLs: use yt-dlp download
      if (isVideo && isYouTubeUrl(url.trim())) {
        const { job_id } = await api.videos.downloadUrl(url.trim())
        setDlJobId(job_id)
        setDlProgress(0)
        setDlMessage("Starting download...")
        return // SSE handler will manage the rest
      }
      // Normal URL: just add reference
      const title = urlTitle.trim() || url.trim()
      const item = await apiNs.add({ title, type: "url", source: url.trim() })
      onAdded(item)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  const handleCancelDownload = async () => {
    if (dlJobId) {
      try { await api.videos.cancelDownload(dlJobId) } catch {}
    }
  }

  // Categorize selected files for display
  const scriptCount = !isVideo ? browserFiles.filter(f => isScriptFile(f.name)).length : 0
  const audioCount = browserFiles.length - scriptCount
  const showBreakdown = !isVideo && browserFiles.length > 0 && scriptCount > 0

  const showFolder = !isVideo

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="relative w-full max-w-md rounded-xl border border-border-subtle bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">{addLabel}</h2>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary transition-colors">
            <XIcon className="size-5" />
          </button>
        </div>

        <div className="flex gap-1 mb-4 p-1 rounded-lg bg-overlay-4">
          <button
            onClick={() => { setTab("local"); setError("") }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm rounded-md transition-all ${
              tab === "local" ? "bg-surface text-text-primary font-medium shadow-sm" : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <FolderOpenIcon className="size-4" />
            {t("localFile")}
          </button>
          {showFolder && (
            <button
              onClick={() => { setTab("folder"); setError("") }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm rounded-md transition-all ${
                tab === "folder" ? "bg-surface text-text-primary font-medium shadow-sm" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              <FolderIcon className="size-4" />
              {t("batchScan")}
            </button>
          )}
          <button
            onClick={() => { setTab("url"); setError("") }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm rounded-md transition-all ${
              tab === "url" ? "bg-surface text-text-primary font-medium shadow-sm" : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <LinkIcon className="size-4" />
            {t("urlLink")}
          </button>
          <button
            onClick={() => { setTab("browse"); setError("") }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm rounded-md transition-all ${
              tab === "browse" ? "bg-surface text-text-primary font-medium shadow-sm" : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <SearchIcon className="size-4" />
            {t("browse")}
          </button>
        </div>

        {tab === "local" && (
          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              multiple
              className="hidden"
              onChange={handleBrowserFileChange}
            />
            <Button variant="secondary" size="sm" onClick={handleSelectFiles} className="w-full">
              <FolderOpenIcon className="size-4" />
              {t("selectFiles")}
            </Button>
            {selectedFiles.length > 0 && (
              <div className="max-h-40 overflow-y-auto space-y-1 text-sm text-text-secondary">
                {browserFiles.length > 0 ? browserFiles.map((f) => (
                  <div key={f.name} className="flex items-center gap-2 truncate px-2 py-1 rounded bg-overlay-4">
                    {isScriptFile(f.name)
                      ? <FileTextIcon className="size-3.5 text-accent shrink-0" />
                      : <MusicIcon className="size-3.5 text-text-tertiary shrink-0" />
                    }
                    {f.name}
                  </div>
                )) : selectedFiles.map((f) => (
                  <div key={f} className="truncate px-2 py-1 rounded bg-overlay-4">{f.split(/[\\/]/).pop()}</div>
                ))}
              </div>
            )}
            {showBreakdown && (
              <p className="text-xs text-text-tertiary">
                {audioCount > 0 && <span>{t("audio")} {audioCount}</span>}
                {audioCount > 0 && scriptCount > 0 && <span> · </span>}
                {scriptCount > 0 && <span>{t("script")} {scriptCount}</span>}
              </p>
            )}
            <Button onClick={handleAddLocal} disabled={!selectedFiles.length || loading} loading={loading} className="w-full">
              {addLabel}
            </Button>
          </div>
        )}

        {tab === "folder" && (
          <div className="space-y-3">
            {folderScanResult ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-green-400">
                  <CheckCircleIcon className="size-4 shrink-0" />
                  <span>
                    {folderScanResult.audioIds.length} {t("audioScanComplete")}
                    {folderScanResult.categoryName && (
                      <span className="text-text-tertiary">
                        {" "}
                        · {folderScanResult.categoryName}
                      </span>
                    )}
                  </span>
                </div>
                {onRequestBulkTranslate && (
                  <Button
                    onClick={handleStartBulkTranslate}
                    className="w-full"
                  >
                    <SparklesIcon className="size-4" />
                    {t("translateNow")}
                  </Button>
                )}
                <Button variant="secondary" onClick={onClose} className="w-full">
                  {t("close")}
                </Button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={folderPath}
                  onChange={(e) => { setFolderPath(e.target.value); setError("") }}
                  placeholder="D:\music\album"
                  className="w-full h-10 px-3 text-sm rounded-lg border border-border bg-background text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <p className="text-xs text-text-tertiary">
                  {t("audio")}: mp3, wav, flac, ogg, m4a, aac, wma, opus
                  <br />
                  {t("script")}: srt, vtt, lrc, txt
                </p>
                <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={folderAutoCategory}
                    onChange={(e) => setFolderAutoCategory(e.target.checked)}
                    className="size-4 accent-accent"
                  />
                  {t("autoCreateCategoriesFromFolders")}
                </label>
                <Button onClick={handleAddFolder} disabled={!folderPath.trim() || loading} loading={loading} className="w-full">
                  {loading && <Loader2Icon className="size-4 animate-spin" />}
                  {t("batchScan")}
                </Button>
              </>
            )}
          </div>
        )}

        {tab === "url" && (
          <div className="space-y-3">
            {!dlJobId ? (
              <>
                <input
                  type="text"
                  value={urlTitle}
                  onChange={(e) => setUrlTitle(e.target.value)}
                  placeholder={isVideo ? t("videoTitle") : t("audioTitle") || t("videoTitle")}
                  className="w-full h-10 px-3 text-sm rounded-lg border border-border bg-background text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <input
                  type="url"
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setError("") }}
                  placeholder={isVideo ? "YouTube URL or direct link" : t("enterUrl")}
                  className="w-full h-10 px-3 text-sm rounded-lg border border-border bg-background text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
                />
                {isVideo && isYouTubeUrl(url) && (
                  <p className="text-xs text-accent flex items-center gap-1">
                    <DownloadIcon className="size-3" />
                    YouTube detected — will download via yt-dlp
                  </p>
                )}
                <Button onClick={handleAddUrl} disabled={!url.trim() || loading} loading={loading} className="w-full">
                  {isVideo && isYouTubeUrl(url) ? (
                    <><DownloadIcon className="size-4" /> Download</>
                  ) : addLabel}
                </Button>
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <Loader2Icon className="size-4 animate-spin text-accent" />
                  <span>Downloading...</span>
                </div>
                <div className="w-full h-2 rounded-full bg-overlay-8 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-300"
                    style={{ width: `${Math.round(dlProgress * 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-text-tertiary">
                  <span>{Math.round(dlProgress * 100)}%</span>
                  <span className="truncate ml-2">{dlMessage}</span>
                </div>
                <Button variant="secondary" size="sm" onClick={handleCancelDownload} className="w-full">
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}

        {tab === "browse" && (
          <div className="space-y-3">
            <FolderBrowser
              filter={browseFilter}
              onSelect={(path, type) => {
                if (type === "file") setBrowsePath(path)
              }}
              onDoubleClick={async (path) => {
                setLoading(true)
                setError("")
                try {
                  const name = path.split(/[\\/]/).pop() || path
                  const item = await apiNs.add({ title: name, type: "local", source: path })
                  onAdded(item)
                  onClose()
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err))
                } finally {
                  setLoading(false)
                }
              }}
              maxHeight="250px"
            />
            {browsePath && (
              <div className="flex items-center gap-2">
                <span className="flex-1 text-xs text-text-secondary truncate">{browsePath}</span>
                <Button
                  size="sm"
                  onClick={async () => {
                    setLoading(true)
                    setError("")
                    try {
                      const name = browsePath.split(/[\\/]/).pop() || browsePath
                      const item = await apiNs.add({ title: name, type: "local", source: browsePath })
                      onAdded(item)
                      setBrowsePath("")
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err))
                    } finally {
                      setLoading(false)
                    }
                  }}
                  loading={loading}
                >
                  {addLabel}
                </Button>
              </div>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-sm text-error">{error}</p>}
      </div>
    </div>
  )
}
