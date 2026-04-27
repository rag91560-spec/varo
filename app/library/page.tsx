"use client"

import { useState, useCallback, useRef, useEffect, type DragEvent, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  FolderOpenIcon,
  PlusIcon,
  SearchIcon,
  GamepadIcon,
  ScanIcon,
  Loader2Icon,
  XIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  ImageIcon,
  SmartphoneIcon,
  MonitorIcon,
  FilterIcon,
  FileTextIcon,
  MusicIcon,
  VideoIcon,
  UploadIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { FolderExplorer } from "@/components/media-grid/FolderExplorer"
import { useLocale } from "@/hooks/use-locale"
import { useGames } from "@/hooks/use-api"
import { api } from "@/lib/api"
import type { Game, GameFolder, MediaCategory } from "@/lib/types"
import { getProgressPct, getStatusInfo } from "@/lib/utils"
import { useMergeTarget } from "@/hooks/use-media-dnd"

/* ─── Status Badge ─── */
function StatusBadge({ game }: { game: Game }) {
  const { t } = useLocale()
  const { text, color, icon, idle } = getStatusInfo(game, t)

  // No badge for scanned-only games (has engine, 0% translated)
  if (!icon && !idle && getProgressPct(game) === 0 && game.engine) return null

  const IconEl = icon === "check" ? CheckCircleIcon : icon === "spinner" ? Loader2Icon : icon === "alert" ? AlertCircleIcon : null

  return (
    <span
      className={`inline-flex items-center gap-1 px-3 py-0.5 rounded-[8px] text-[10px] font-semibold ${
        idle
          ? "bg-surface-elevated/80 text-text-secondary border border-overlay-8"
          : "text-white"
      }`}
      style={idle ? undefined : { background: color }}
    >
      {IconEl && <IconEl className={`size-2.5 ${icon === "spinner" ? "animate-spin" : ""}`} />}
      {text}
    </span>
  )
}

/* ─── Game Card (Steam/Epic launcher style) ─── */
function GameCard({ game, onClick, onDragStart, onMergeDrop }: { game: Game; onClick: () => void; onDragStart?: (e: DragEvent) => void; onMergeDrop?: (draggedGameId: number) => void }) {
  const { t } = useLocale()
  const pct = getProgressPct(game)
  const hasCover = !!game.cover_path

  const merge = useMergeTarget(
    useCallback((draggedId: number) => { if (draggedId !== game.id) onMergeDrop?.(draggedId) }, [game.id, onMergeDrop])
  )
  const mergeProps = onMergeDrop
    ? { onDragOver: merge.onDragOver as unknown as (e: DragEvent) => void, onDragLeave: merge.onDragLeave as unknown as (e: DragEvent) => void, onDrop: merge.onDrop as unknown as (e: DragEvent) => void }
    : {}

  return (
    <div
      className={`group cursor-pointer rounded-md overflow-hidden relative transition-all duration-200 ease-out hover:scale-[1.03] hover:border-accent hover:shadow-[0_0_12px_var(--accent-muted)] aspect-[3/4] border-2 ${
        merge.showMerge ? "border-accent ring-2 ring-accent/50 animate-pulse" : "border-transparent"
      }`}
      onClick={onClick}
      draggable
      onDragStart={(e) => {
        // Set a drag image and mark as internal game drag
        e.dataTransfer.effectAllowed = "move"
        e.dataTransfer.setData("application/x-game-id", String(game.id))
        e.dataTransfer.setData("application/x-media-item", JSON.stringify({ type: "game", id: game.id }))
        onDragStart?.(e)
      }}
      {...mergeProps}
    >
      {/* Full-bleed cover image */}
      {hasCover ? (
        <img
          src={`/api/covers/${game.id}.jpg?t=${game.updated_at}`}
          alt={game.title}
          className="absolute inset-0 w-full h-full object-cover transition-[filter] duration-200 group-hover:brightness-110"
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-surface">
          <GamepadIcon className="size-10 text-accent/30" />
        </div>
      )}

      {/* Bottom gradient overlay for title */}
      <div
        className="absolute inset-x-0 bottom-0 h-1/2 pointer-events-none bg-gradient-to-t from-black/85 via-black/40 to-transparent"
      />

      {/* Status Badge (top-left) */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-1">
        <StatusBadge game={game} />
      </div>

      {/* Platform / Language Badge (top-right) */}
      <div className="absolute top-2 right-2 z-10 flex gap-1">
        {game.variant_lang && (
          <span className="px-2 py-0.5 rounded-[6px] bg-accent/90 text-white text-[9px] font-bold">
            {game.variant_lang}
          </span>
        )}
        {game.platform === "android" && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] bg-emerald-500/90 text-white text-[9px] font-semibold">
            <SmartphoneIcon className="size-2.5" />
            APK
          </span>
        )}
      </div>

      {/* Title + info overlay at bottom */}
      <div className="absolute inset-x-0 bottom-0 p-2.5 z-10">
        <h3 className="text-[13px] font-semibold text-white truncate leading-tight drop-shadow-sm">
          {game.title}
        </h3>
        {game.engine && (
          <p className="text-[10px] text-gray-300/80 truncate mt-0.5">{game.engine}</p>
        )}
        {game.string_count > 0 && (
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className={`text-[10px] font-medium font-mono ${
                pct === 100 ? "text-success" : "text-accent"
              }`}
            >
              {pct}%
            </span>
          </div>
        )}
      </div>

      {/* Progress bar — thin line at very bottom */}
      {game.string_count > 0 && (
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/40 z-20">
          <div
            className={`h-full transition-all duration-300 ${
              pct === 100 ? "bg-success" : "bg-accent"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Merge overlay */}
      {merge.showMerge && (
        <div className="absolute inset-0 bg-accent/20 flex items-center justify-center pointer-events-none z-30">
          <span className="bg-accent text-white text-xs font-bold px-3 py-1.5 rounded-lg">
            {t("createFolder")}
          </span>
        </div>
      )}
    </div>
  )
}

/* ─── Main Page ─── */
function LibraryPageContent() {
  const { t } = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [searchQuery, setSearchQuery] = useState("")
  const { games, loading, refresh } = useGames(searchQuery || undefined)
  const [adding, setAdding] = useState(false)
  const [platformFilter, setPlatformFilter] = useState<"all" | "windows" | "android" | "audio" | "video">("all")
  const [mediaGameIds, setMediaGameIds] = useState<{ audio: Set<number>; video: Set<number> }>({ audio: new Set(), video: new Set() })
  const [showApkModal, setShowApkModal] = useState(false)
  const [apkPath, setApkPath] = useState("")
  const [apkLoading, setApkLoading] = useState(false)
  const [apkResults, setApkResults] = useState<Array<{ title: string; package_name: string; path: string; size: number }>>([])
  const [importingApk, setImportingApk] = useState<string | null>(null)
  const [subtitleLoading, setSubtitleLoading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounterRef = useRef(0)

  // Folder state
  const [folders, setFolders] = useState<GameFolder[]>([])

  // --- Current folder from URL ?folder=<id> ---
  const folderParam = searchParams.get("folder")
  const currentFolderId: number | null = folderParam ? parseInt(folderParam, 10) : null
  const navigateToFolder = useCallback((id: number | null) => {
    const sp = new URLSearchParams(Array.from(searchParams.entries()))
    if (id === null) sp.delete("folder")
    else sp.set("folder", String(id))
    const qs = sp.toString()
    router.replace(qs ? `/library?${qs}` : "/library")
  }, [router, searchParams])

  // Load folders
  const loadFolders = useCallback(() => {
    api.folders.list().then(setFolders).catch(() => {})
  }, [])
  useEffect(() => { loadFolders() }, [loadFolders])

  const handleCreateFolder = useCallback(async (name: string, parentId: number | null) => {
    try {
      const folder = await api.folders.create({ name, parent_id: parentId })
      setFolders(prev => [...prev, folder])
    } catch (err) {
      console.error("Create folder failed:", err)
      alert(t("folderCreateFailed").replace("{error}", err instanceof Error ? err.message : String(err)))
    }
  }, [t])

  const handleFolderContextMenu = useCallback(async (folderId: number) => {
    const folder = folders.find(f => f.id === folderId)
    if (!folder) return
    const action = prompt(t("folderActionPrompt").replace("{name}", folder.name), "1")
    if (action === "1") {
      const name = prompt(t("newName"), folder.name)
      if (name && name.trim() && name !== folder.name) {
        try {
          const updated = await api.folders.update(folderId, { name: name.trim() })
          setFolders(prev => prev.map(f => f.id === folderId ? updated : f))
        } catch (err) { console.error("Rename folder failed:", err) }
      }
    } else if (action === "2") {
      if (!confirm(t("deleteFolderConfirm"))) return
      try {
        await api.folders.delete(folderId)
        setFolders(prev => prev.filter(f => f.id !== folderId))
        if (currentFolderId === folderId) navigateToFolder(folder.parent_id ?? null)
        refresh()
      } catch (err) { console.error("Delete folder failed:", err) }
    }
  }, [folders, currentFolderId, navigateToFolder, refresh, t])

  // Move game to folder (DnD from FolderExplorer)
  const handleMoveGameToFolder = useCallback(async (gameId: number, folderId: number | null) => {
    try {
      await api.games.update(gameId, { folder_id: folderId } as Partial<Game>)
      refresh()
    } catch (err) { console.error("Move game to folder failed:", err) }
  }, [refresh])

  // Game → Game merge: create folder and move both
  const handleGameMergeDrop = useCallback(async (targetGameId: number, draggedGameId: number) => {
    const name = prompt(t("folderName") || "폴더 이름", t("newFolder") || "새 폴더")
    if (!name) return
    try {
      const folder = await api.folders.create({ name, parent_id: currentFolderId })
      setFolders(prev => [...prev, folder])
      await api.games.update(draggedGameId, { folder_id: folder.id } as Partial<Game>)
      await api.games.update(targetGameId, { folder_id: folder.id } as Partial<Game>)
      refresh()
    } catch (err) { console.error("Merge games to folder failed:", err) }
  }, [refresh, t, currentFolderId])

  // External file Drag & Drop handlers
  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragOver(false)
    }
  }, [])

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    dragCounterRef.current = 0

    // Ignore internal game drags — only handle external file drops
    if (e.dataTransfer.types.includes("application/x-game-id")) return

    const files = e.dataTransfer.files
    if (!files.length) return

    const paths: string[] = []
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      // Electron 35+: File.path removed, use webUtils.getPathForFile via preload
      const p = window.electronAPI?.getPathForFile?.(f) || (f as File & { path?: string }).path
      if (p) paths.push(p)
    }
    if (!paths.length) return

    // APK files → import directly
    const apkPaths = paths.filter(p => p.toLowerCase().endsWith(".apk"))
    const folderPaths = paths.filter(p => !p.toLowerCase().endsWith(".apk"))

    for (const apk of apkPaths) {
      try {
        const name = apk.split(/[\\/]/).pop()?.replace(".apk", "") || "Unknown"
        await api.android.importApk(apk, name)
      } catch (err) {
        console.error("APK import failed:", err)
      }
    }

    for (const p of folderPaths) {
      try {
        await api.games.create({ path: p })
      } catch (err) {
        console.error("Add game failed:", err)
      }
    }

    if (apkPaths.length || folderPaths.length) {
      refresh()
      // Auto-fetch covers
      api.covers.fetchAll().then(() => refresh()).catch(() => {})
    }
  }, [refresh])

  // Load media game IDs for filter
  useEffect(() => {
    Promise.all([
      api.media.gameIds("audio"),
      api.media.gameIds("video"),
    ]).then(([audioRes, videoRes]) => {
      setMediaGameIds({
        audio: new Set(audioRes.game_ids),
        video: new Set(videoRes.game_ids),
      })
    }).catch(() => {})
  }, [games])

  const handleImportSubtitles = useCallback(async () => {
    setSubtitleLoading(true)
    try {
      let files: string[] = []
      if (window.electronAPI?.selectSubtitleFiles) {
        files = await window.electronAPI.selectSubtitleFiles()
      } else {
        // Web fallback: prompt for path
        const input = prompt(t("selectSubtitleFiles"))
        if (input) files = input.split(";").map(s => s.trim()).filter(Boolean)
      }
      if (!files.length) return
      await api.games.importSubtitles(files)
      refresh()
    } catch (e: unknown) {
      console.error("Subtitle import failed:", e)
      alert(t("subtitleImportFailed").replace("{error}", e instanceof Error ? e.message : String(e)))
    } finally {
      setSubtitleLoading(false)
    }
  }, [refresh, t])

  const [fetchingCovers, setFetchingCovers] = useState(false)
  const [scanningAll, setScanningAll] = useState(false)

  // Auto-refresh while covers are being fetched
  useEffect(() => {
    if (!fetchingCovers) return
    const interval = setInterval(() => refresh(), 5000)
    return () => clearInterval(interval)
  }, [fetchingCovers, refresh])

  const handleAddGameFolder = useCallback(async () => {
    if (!window.electronAPI?.selectGameFolder) {
      alert(t("electronOnlyFeature"))
      return
    }
    const path = await window.electronAPI.selectGameFolder()
    if (!path) return
    setAdding(true)
    try {
      // First try: treat the selected folder as a directory containing multiple games
      let scanned: Array<{ title: string; path: string; engine: string; exe_path: string; platform?: string; variant_lang?: string }> = []
      try {
        scanned = await api.games.scanDirectory(path)
      } catch {
        scanned = []
      }

      // Skip client-side dedup — server returns 409 for duplicates, handled in runOne
      const fresh = scanned

      if (fresh.length > 0) {
        // Sequential with concurrency limit (3) to avoid hammering backend scans
        const CONCURRENCY = 3
        let added = 0
        let skipped = 0
        const failed: Array<{ title: string; error: string }> = []

        const runOne = async (g: typeof fresh[number]) => {
          try {
            if (g.platform === "android") {
              await api.android.importApk(g.path, g.title)
            } else {
              await api.games.create({
                path: g.path,
                title: g.title,
                engine: g.engine,
                exe_path: g.exe_path,
                variant_lang: g.variant_lang,
              })
            }
            added++
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            if (/409|이미 등록/i.test(msg)) {
              skipped++
            } else {
              failed.push({ title: g.title, error: msg })
            }
          }
        }

        // Process in chunks of CONCURRENCY, refreshing UI between chunks
        for (let i = 0; i < fresh.length; i += CONCURRENCY) {
          const chunk = fresh.slice(i, i + CONCURRENCY)
          await Promise.all(chunk.map(runOne))
          refresh() // incremental reveal
        }

        // Fire cover fetch in background — no spinner, no polling (UI will update on next natural refresh)
        api.covers.fetchAll()
          .then(() => refresh())
          .catch((e) => console.error("Cover fetch all failed:", e))

        if (failed.length > 0) {
          const preview = failed.slice(0, 5).map(f => `• ${f.title}: ${f.error}`).join("\n")
          const more = failed.length > 5 ? `\n...+${failed.length - 5}` : ""
          alert(t("addGameResult").replace("{added}", String(added)).replace("{skipped}", String(skipped)).replace("{failed}", String(failed.length)) + `\n\n${preview}${more}`)
        } else if (added === 0 && skipped > 0) {
          alert(t("alreadyRegisteredGames").replace("{count}", String(skipped)))
        }
        return
      }

      // Fallback: treat the selected folder itself as a single game
      try {
        const game = await api.games.create({ path })
        refresh()
        api.covers.fetch(game.id).then(() => refresh()).catch((e) => console.error("Cover fetch failed:", e))
      } catch (e) {
        alert(t("addGameFailed").replace("{error}", e instanceof Error ? e.message : String(e)))
      }
    } finally {
      setAdding(false)
    }
  }, [refresh])

  const handleScanAll = useCallback(async () => {
    setScanningAll(true)
    try {
      await api.games.scanAll()
      refresh()
    } catch (e) { console.error("Scan all failed:", e) } finally {
      setScanningAll(false)
    }
  }, [refresh])

  const handleFetchAllCovers = useCallback(async () => {
    setFetchingCovers(true)
    try {
      await api.covers.fetchAll()
      refresh()
    } catch (e) { console.error("Fetch all covers failed:", e) } finally {
      setFetchingCovers(false)
    }
  }, [refresh])

  const handleScanApks = useCallback(async () => {
    if (!apkPath.trim()) return
    setApkLoading(true)
    try {
      const res = await api.android.scanApks(apkPath.trim())
      setApkResults(res.apks)
    } catch (e) { console.error("Scan APKs failed:", e);
      setApkResults([])
    } finally {
      setApkLoading(false)
    }
  }, [apkPath])

  const handleImportApk = useCallback(async (apk: { title: string; path: string }) => {
    setImportingApk(apk.path)
    try {
      await api.android.importApk(apk.path, apk.title)
      setApkResults((prev) => prev.filter((a) => a.path !== apk.path))
      refresh()
    } catch (e) { console.error("Import APK failed:", e) } finally {
      setImportingApk(null)
    }
  }, [refresh])

  const handleImportAllApks = useCallback(async () => {
    setApkLoading(true)
    try {
      await Promise.allSettled(
        apkResults.map((apk) => api.android.importApk(apk.path, apk.title))
      )
      setApkResults([])
      refresh()
    } finally {
      setApkLoading(false)
    }
  }, [apkResults, refresh])

  // Platform filter
  const platformFiltered = platformFilter === "all"
    ? games
    : platformFilter === "audio"
      ? games.filter(g => mediaGameIds.audio.has(g.id))
      : platformFilter === "video"
        ? games.filter(g => mediaGameIds.video.has(g.id))
        : games.filter(g => (g.platform || "windows") === platformFilter)
  // When searching, show flat (all folders); otherwise let FolderExplorer handle folder filtering
  const hasAndroid = games.some(g => g.platform === "android")
  const hasMedia = mediaGameIds.audio.size > 0 || mediaGameIds.video.size > 0

  // Adapt GameFolder[] → MediaCategory-like shape for FolderExplorer
  const folderCategories: MediaCategory[] = folders.map(f => ({
    id: f.id,
    name: f.name,
    media_type: "game" as unknown as MediaCategory["media_type"],
    parent_id: f.parent_id ?? null,
    sort_order: f.sort_order,
    created_at: f.created_at,
    updated_at: f.created_at,
  }))
  // Shim games with category_id (alias for folder_id) so FolderExplorer can filter
  const gamesForExplorer = platformFiltered.map(g => ({ ...g, category_id: g.folder_id ?? null }))

  return (
    <div
      className="p-5 md:p-6 max-w-6xl mx-auto relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-accent/10 backdrop-blur-sm border-2 border-dashed border-accent rounded-xl flex flex-col items-center justify-center gap-3 pointer-events-none">
          <UploadIcon className="size-12 text-accent" />
          <p className="text-lg font-semibold text-accent">{t("dropToAdd")}</p>
          <p className="text-sm text-text-secondary">{t("dropHint")}</p>
        </div>
      )}

      {/* Top bar: Search + Actions */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-text-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("searchGames")}
            className="w-full h-10 pl-10 pr-4 rounded-lg border border-border bg-surface text-text-primary text-sm placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
          />
        </div>
        {games.length > 0 && (
          <button
            onClick={handleScanAll}
            disabled={scanningAll}
            className="h-10 px-3 rounded-lg text-text-secondary hover:text-text-primary hover:bg-overlay-4 transition-all text-xs flex items-center gap-1.5"
            title={t("scanAllTooltip")}
          >
            {scanningAll ? <Loader2Icon className="size-4 animate-spin" /> : <ScanIcon className="size-4" />}
            <span className="hidden md:inline">{t("scanAll")}</span>
          </button>
        )}
        {games.some(g => !g.cover_path) && (
          <button
            onClick={handleFetchAllCovers}
            disabled={fetchingCovers}
            className="h-10 px-3 rounded-lg text-text-secondary hover:text-text-primary hover:bg-overlay-4 transition-all text-xs flex items-center gap-1.5"
            title={t("fetchCoversTooltip")}
          >
            {fetchingCovers ? <Loader2Icon className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
            <span className="hidden md:inline">{t("fetchCovers")}</span>
          </button>
        )}
        <button
          onClick={() => setShowApkModal(!showApkModal)}
          className="h-10 px-3 rounded-lg text-text-secondary hover:text-text-primary hover:bg-overlay-4 transition-all text-xs flex items-center gap-1.5 border border-border"
          title={t("importApk")}
        >
          <SmartphoneIcon className="size-4" />
          <span className="hidden md:inline">{t("importApk")}</span>
        </button>
        <button
          onClick={handleImportSubtitles}
          disabled={subtitleLoading}
          className="h-10 px-3 rounded-lg text-text-secondary hover:text-text-primary hover:bg-overlay-4 transition-all text-xs flex items-center gap-1.5 border border-border"
          title={t("importSubtitles")}
        >
          {subtitleLoading ? <Loader2Icon className="size-4 animate-spin" /> : <FileTextIcon className="size-4" />}
          <span className="hidden md:inline">{t("importSubtitles")}</span>
        </button>
        <button
          onClick={handleAddGameFolder}
          disabled={adding}
          className="h-10 px-4 rounded-lg bg-accent hover:bg-accent/90 text-white text-sm font-medium flex items-center gap-1.5 transition-all shrink-0 disabled:opacity-50"
        >
          {adding ? <Loader2Icon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
          <span className="hidden sm:inline">{t("addGame")}</span>
        </button>
      </div>

      {/* APK Import Panel */}
      {showApkModal && (
        <div className="mb-5 rounded-xl overflow-hidden bg-surface border border-border-subtle">
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <SmartphoneIcon className="size-4 text-emerald-500" />
                {t("apkImportTitle")}
              </h3>
              <button
                onClick={() => { setShowApkModal(false); setApkResults([]) }}
                className="size-7 flex items-center justify-center rounded-md text-text-tertiary hover:text-text-primary hover:bg-overlay-4 transition-colors"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider mb-1.5 block">
                {t("apkFolderPath")}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={apkPath}
                  onChange={(e) => setApkPath(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleScanApks()}
                  placeholder="D:\Downloads\APKs"
                  className="flex-1 h-10 px-3 rounded-lg border border-border bg-background text-text-primary text-sm font-mono placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                />
                <Button variant="default" size="sm" onClick={handleScanApks} loading={apkLoading} className="shrink-0">
                  <ScanIcon className="size-4" /> {t("scan")}
                </Button>
              </div>
            </div>
            {apkResults.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-text-secondary">{apkResults.length}{t("apkFound")}</p>
                  <Button variant="default" size="sm" onClick={handleImportAllApks} loading={apkLoading}>
                    <PlusIcon className="size-3" /> {t("importAll")}
                  </Button>
                </div>
                {apkResults.map((apk) => (
                  <div key={apk.path} className="flex items-center justify-between p-2.5 rounded-lg bg-overlay-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary truncate">{apk.title}</p>
                      <p className="text-xs text-text-tertiary">
                        {apk.package_name} · {(apk.size / 1024 / 1024).toFixed(1)} MB
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleImportApk(apk)}
                      loading={importingApk === apk.path}
                      className="shrink-0 ml-2"
                    >
                      <PlusIcon className="size-3" /> {t("add")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Platform / Media Filter */}
      {(hasAndroid || hasMedia) && (
        <div className="flex items-center gap-1.5 mb-4">
          <FilterIcon className="size-3.5 text-text-tertiary" />
          {(["all", "windows", "android", "audio", "video"] as const).map((p) => {
            // Hide filter buttons that have no matching games
            if (p === "android" && !hasAndroid) return null
            if (p === "audio" && mediaGameIds.audio.size === 0) return null
            if (p === "video" && mediaGameIds.video.size === 0) return null
            return (
              <button
                key={p}
                onClick={() => setPlatformFilter(p)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all border ${
                  platformFilter === p
                    ? "bg-accent-muted text-accent border-accent/30"
                    : "bg-overlay-2 text-text-secondary border-transparent hover:bg-overlay-4"
                }`}
              >
                {p === "all" && t("platformAll")}
                {p === "windows" && <><MonitorIcon className="size-3 inline mr-1" />{t("platformWindows")}</>}
                {p === "android" && <><SmartphoneIcon className="size-3 inline mr-1" />{t("platformAndroid")}</>}
                {p === "audio" && <><MusicIcon className="size-3 inline mr-1" />{t("platformAudio")}</>}
                {p === "video" && <><VideoIcon className="size-3 inline mr-1" />{t("platformVideo")}</>}
              </button>
            )
          })}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2Icon className="size-8 text-accent animate-spin" />
        </div>
      ) : platformFiltered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FolderOpenIcon className="size-16 text-text-tertiary mb-4" />
          <p className="text-text-secondary font-medium">{t("noGames")}</p>
          <p className="text-sm text-text-tertiary mt-1">{t("noGamesHint")}</p>
          <p className="text-xs text-text-tertiary mt-1">{t("dropHint")}</p>
          <Button variant="default" size="sm" className="mt-4" onClick={handleAddGameFolder} disabled={adding}>
            {adding ? <Loader2Icon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
            {t("addGame")}
          </Button>
        </div>
      ) : (
        <FolderExplorer<Game & { category_id: number | null }>
          categories={folderCategories}
          items={gamesForExplorer}
          currentFolderId={currentFolderId}
          onNavigate={navigateToFolder}
          onCreateFolder={handleCreateFolder}
          onDropItemToFolder={(itemId, folderId) => handleMoveGameToFolder(itemId, folderId)}
          onFolderContextMenu={(id) => handleFolderContextMenu(id)}
          renderItem={(game) => (
            <GameCard
              game={game}
              onClick={() => router.push(`/library/${game.id}`)}
              onMergeDrop={(draggedId) => handleGameMergeDrop(game.id, draggedId)}
            />
          )}
        />
      )}
    </div>
  )
}

export default function LibraryPage() {
  return (
    <Suspense>
      <LibraryPageContent />
    </Suspense>
  )
}
