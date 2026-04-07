"use client"

import { useState, useCallback, useRef, useEffect, type DragEvent } from "react"
import { useRouter } from "next/navigation"
import {
  FolderOpenIcon,
  FolderIcon,
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
import { FolderBrowser } from "@/components/FolderBrowser"
import { useLocale } from "@/hooks/use-locale"
import { useGames } from "@/hooks/use-api"
import { api } from "@/lib/api"
import type { Game, GameFolder } from "@/lib/types"
import { getProgressPct, getStatusInfo } from "@/lib/utils"
import { useMergeTarget, getDraggedItem } from "@/hooks/use-media-dnd"

/* ─── Internal DnD data passing via module-level ref (avoids dataTransfer serialization) ─── */
let draggedGame: Game | null = null

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
        draggedGame = game
        onDragStart?.(e)
      }}
      onDragEnd={() => { draggedGame = null }}
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
            폴더 만들기
          </span>
        </div>
      )}
    </div>
  )
}

/* ─── Folder Chip (drop target) ─── */
function FolderChip({
  folder,
  isSelected,
  isOver,
  onClick,
  onDoubleClick,
  onContextMenu,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  folder: { id: number | null; name: string }
  isSelected: boolean
  isOver: boolean
  onClick: () => void
  onDoubleClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  onDragOver?: (e: DragEvent) => void
  onDragLeave?: (e: DragEvent) => void
  onDrop?: (e: DragEvent) => void
}) {
  return (
    <button
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border whitespace-nowrap flex items-center gap-1.5 ${
        isOver
          ? "bg-accent text-white border-accent scale-105"
          : isSelected
            ? "bg-accent-muted text-accent border-accent/30"
            : "bg-overlay-2 text-text-secondary border-transparent hover:bg-overlay-4"
      }`}
    >
      <FolderIcon className="size-3" />
      {folder.name}
    </button>
  )
}

/* ─── Section Header ─── */
function SectionHeader({
  icon: Icon,
  title,
  count,
  iconColor,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  title: string
  count: number
  iconColor: string
}) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <Icon className="size-5" style={{ color: iconColor }} />
      <span className="text-base font-semibold text-text-primary">{title}</span>
      <span
        className="px-2 py-0.5 rounded-[8px] text-[10px] font-semibold"
        style={{
          color: iconColor,
          backgroundColor: `color-mix(in srgb, ${iconColor} 15%, transparent)`,
        }}
      >
        {count}
      </span>
    </div>
  )
}

/* ─── Main Page ─── */
export default function LibraryPage() {
  const { t } = useLocale()
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState("")
  const { games, loading, refresh } = useGames(searchQuery || undefined)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addPath, setAddPath] = useState("")
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState("")
  const [scanPath, setScanPath] = useState("")
  const [scanLoading, setScanLoading] = useState(false)
  const [scanResults, setScanResults] = useState<
    Array<{ title: string; path: string; engine: string; exe_path: string; platform?: string; variant_lang?: string }>
  >([])
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
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)
  const [newFolderInput, setNewFolderInput] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")
  const [editingFolderId, setEditingFolderId] = useState<number | null>(null)
  const [editingFolderName, setEditingFolderName] = useState("")
  const [dropTargetFolderId, setDropTargetFolderId] = useState<number | null | "none">("none")

  // Load folders
  useEffect(() => {
    api.folders.list().then(setFolders).catch(() => {})
  }, [])

  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim()
    if (!name) { setNewFolderInput(false); return }
    try {
      const folder = await api.folders.create({ name })
      setFolders(prev => [...prev, folder])
    } catch (e) { console.error("Create folder failed:", e) }
    setNewFolderName("")
    setNewFolderInput(false)
  }, [newFolderName])

  const handleRenameFolder = useCallback(async (id: number) => {
    const name = editingFolderName.trim()
    if (!name) { setEditingFolderId(null); return }
    try {
      const updated = await api.folders.update(id, { name })
      setFolders(prev => prev.map(f => f.id === id ? updated : f))
    } catch (e) { console.error("Rename folder failed:", e) }
    setEditingFolderId(null)
  }, [editingFolderName])

  const handleDeleteFolder = useCallback(async (id: number) => {
    if (!confirm(t("deleteFolderConfirm"))) return
    try {
      await api.folders.delete(id)
      setFolders(prev => prev.filter(f => f.id !== id))
      if (selectedFolderId === id) setSelectedFolderId(null)
      refresh()
    } catch (e) { console.error("Delete folder failed:", e) }
  }, [selectedFolderId, refresh, t])

  // Folder chip DnD handlers (game → folder, or external file → folder)
  const handleFolderDragOver = useCallback((folderId: number | null) => (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("application/x-game-id") &&
        !e.dataTransfer.types.includes("Files")) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = "move"
    setDropTargetFolderId(folderId)
  }, [])

  const handleFolderDragLeave = useCallback((_folderId: number | null) => (e: DragEvent) => {
    e.stopPropagation()
    setDropTargetFolderId("none")
  }, [])

  const handleFolderDrop = useCallback((folderId: number | null) => async (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTargetFolderId("none")

    // Internal game drag → move to folder
    if (e.dataTransfer.types.includes("application/x-game-id")) {
      const game = draggedGame
      if (!game || game.folder_id === folderId) return
      try {
        await api.games.update(game.id, { folder_id: folderId } as Partial<Game>)
        refresh()
      } catch (err) { console.error("Move game to folder failed:", err) }
      return
    }

    // External file drop → create game + assign folder
    const files = e.dataTransfer.files
    if (!files.length) return
    for (let i = 0; i < files.length; i++) {
      const f = files[i] as File & { path?: string }
      if (!f.path) continue
      try {
        const game = await api.games.create({ path: f.path })
        if (folderId !== null) {
          await api.games.update(game.id, { folder_id: folderId } as Partial<Game>)
        }
      } catch (err) { console.error("Add game to folder failed:", err) }
    }
    refresh()
    api.covers.fetchAll().then(() => refresh()).catch(() => {})
  }, [refresh])

  // Game → Game merge: create folder and move both
  const handleGameMergeDrop = useCallback(async (targetGameId: number, draggedGameId: number) => {
    const name = prompt(t("folderName") || "폴더 이름", t("newFolder") || "새 폴더")
    if (!name) return
    try {
      const folder = await api.folders.create({ name })
      setFolders(prev => [...prev, folder])
      await api.games.update(draggedGameId, { folder_id: folder.id } as Partial<Game>)
      await api.games.update(targetGameId, { folder_id: folder.id } as Partial<Game>)
      refresh()
    } catch (err) { console.error("Merge games to folder failed:", err) }
  }, [refresh, t])

  const gamesRef = useRef(games)
  gamesRef.current = games

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
      const f = files[i] as File & { path?: string }
      if (f.path) paths.push(f.path)
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
      setAddError(e instanceof Error ? e.message : "Import failed")
    } finally {
      setSubtitleLoading(false)
    }
  }, [refresh, t])

  const handleAddGame = useCallback(async () => {
    if (!addPath.trim()) return
    setAddLoading(true)
    setAddError("")
    try {
      const game = await api.games.create({ path: addPath.trim() })
      setAddPath("")
      setShowAddModal(false)
      refresh()
      // Auto-fetch cover in background
      api.covers.fetch(game.id).then(() => refresh()).catch((e) => console.error("Cover fetch failed:", e))
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : "Failed to add game")
    } finally {
      setAddLoading(false)
    }
  }, [addPath, refresh])

  const handleScanDirectory = useCallback(async () => {
    if (!scanPath.trim()) return
    setScanLoading(true)
    try {
      const results = await api.games.scanDirectory(scanPath.trim())
      const existingPaths = new Set(gamesRef.current.map(g => g.path))
      setScanResults(results.filter((r: { path: string }) => !existingPaths.has(r.path)))
    } catch (e) { console.error("Scan directory failed:", e);
      setScanResults([])
    } finally {
      setScanLoading(false)
    }
  }, [scanPath])

  const handleAddScanned = useCallback(
    async (scanned: { title: string; path: string; engine: string; platform?: string; variant_lang?: string }) => {
      try {
        let game: Game | undefined
        if (scanned.platform === "android") {
          const res = await api.android.importApk(scanned.path, scanned.title)
          game = res.game
        } else {
          game = await api.games.create({
            path: scanned.path,
            title: scanned.title,
            engine: scanned.engine,
            variant_lang: scanned.variant_lang,
          })
        }
        setScanResults((prev) => prev.filter((g) => g.path !== scanned.path))
        refresh()
        // Auto-fetch cover in background
        if (game?.id) {
          api.covers.fetch(game.id).then(() => refresh()).catch((e) => console.error("Cover fetch failed:", e))
        }
      } catch (e) {
        console.error("Add scanned game failed:", e)
        setAddError(e instanceof Error ? e.message : "Failed to add game")
      }
    },
    [refresh]
  )

  const [fetchingCovers, setFetchingCovers] = useState(false)
  const [scanningAll, setScanningAll] = useState(false)
  const [addingAll, setAddingAll] = useState(false)

  // Auto-refresh while covers are being fetched
  useEffect(() => {
    if (!fetchingCovers) return
    const interval = setInterval(() => refresh(), 5000)
    return () => clearInterval(interval)
  }, [fetchingCovers, refresh])
  const handleAddAll = useCallback(async () => {
    setAddingAll(true)
    try {
      await Promise.allSettled(
        scanResults.map((g) =>
          g.platform === "android"
            ? api.android.importApk(g.path, g.title)
            : api.games.create({ path: g.path, title: g.title, engine: g.engine, variant_lang: g.variant_lang })
        )
      )
      setScanResults([])
      refresh()
      // Auto-fetch covers for all newly added games
      setFetchingCovers(true)
      api.covers.fetchAll().then(() => refresh()).catch((e) => console.error("Cover fetch all failed:", e)).finally(() => setFetchingCovers(false))
    } finally {
      setAddingAll(false)
    }
  }, [scanResults, refresh])

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

  // Platform filter + folder filter + categorize games
  const platformFiltered = platformFilter === "all"
    ? games
    : platformFilter === "audio"
      ? games.filter(g => mediaGameIds.audio.has(g.id))
      : platformFilter === "video"
        ? games.filter(g => mediaGameIds.video.has(g.id))
        : games.filter(g => (g.platform || "windows") === platformFilter)
  const filteredGames = selectedFolderId !== null
    ? platformFiltered.filter(g => g.folder_id === selectedFolderId)
    : platformFiltered
  const translatedGames = filteredGames.filter(g => g.translated_count > 0 || g.status === "applied" || g.status === "translated")
  const untranslatedGames = filteredGames.filter(g => g.translated_count === 0 && g.status !== "applied" && g.status !== "translated")
  const hasAndroid = games.some(g => g.platform === "android")
  const hasMedia = mediaGameIds.audio.size > 0 || mediaGameIds.video.size > 0

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
          onClick={() => setShowAddModal(!showAddModal)}
          className="h-10 px-4 rounded-lg bg-accent hover:bg-accent/90 text-white text-sm font-medium flex items-center gap-1.5 transition-all shrink-0"
        >
          <PlusIcon className="size-4" />
          <span className="hidden sm:inline">{t("addGame")}</span>
        </button>
      </div>

      {/* Add Game Panel (slides open) */}
      {showAddModal && (
        <div className="mb-5 rounded-xl overflow-hidden bg-surface border border-border-subtle">
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-primary">{t("addGameTitle")}</h3>
              <button
                onClick={() => { setShowAddModal(false); setAddError(""); setScanResults([]) }}
                className="size-7 flex items-center justify-center rounded-md text-text-tertiary hover:text-text-primary hover:bg-overlay-4 transition-colors"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider mb-1.5 block">
                {t("gameFolderPath")}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={addPath}
                  onChange={(e) => setAddPath(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddGame()}
                  placeholder="D:\Games\MyGame"
                  className="flex-1 h-10 px-3 rounded-lg border border-border bg-background text-text-primary text-sm font-mono placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                />
                <Button variant="ghost" size="sm" onClick={async () => { const p = await window.electronAPI?.selectGameFolder(); if (p) setAddPath(p); }} className="shrink-0">
                  <FolderOpenIcon className="size-4" />
                </Button>
                <Button variant="default" size="sm" onClick={handleAddGame} loading={addLoading} className="shrink-0">
                  <PlusIcon className="size-4" /> {t("add")}
                </Button>
              </div>
              {addError && <p className="text-xs text-error mt-1">{addError}</p>}
            </div>
            {/* Folder Browser */}
            <FolderBrowser
              foldersOnly
              onSelect={(path) => setAddPath(path)}
              maxHeight="200px"
            />
            <div className="pt-3 border-t border-border-subtle">
              <label className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider mb-1.5 block">
                {t("batchScan")}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={scanPath}
                  onChange={(e) => setScanPath(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleScanDirectory()}
                  placeholder="D:\Games"
                  className="flex-1 h-10 px-3 rounded-lg border border-border bg-background text-text-primary text-sm font-mono placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                />
                <Button variant="ghost" size="sm" onClick={async () => { const p = await window.electronAPI?.selectGameFolder(); if (p) setScanPath(p); }} className="shrink-0">
                  <FolderOpenIcon className="size-4" />
                </Button>
                <Button variant="secondary" size="sm" onClick={handleScanDirectory} loading={scanLoading} className="shrink-0">
                  <ScanIcon className="size-4" /> {t("scan")}
                </Button>
              </div>
            </div>
            {scanResults.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-text-secondary">{scanResults.length}{t("gamesFound")}</p>
                  <Button variant="default" size="sm" onClick={handleAddAll} loading={addingAll}>
                    <PlusIcon className="size-3" /> {t("addAll")}
                  </Button>
                </div>
                {scanResults.map((g) => (
                  <div key={g.path} className="flex items-center justify-between p-2.5 rounded-lg bg-overlay-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {g.title}
                        {g.variant_lang && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-accent/20 text-accent">{g.variant_lang}</span>
                        )}
                      </p>
                      <p className="text-xs text-text-tertiary">
                        {g.platform === "android" ? (
                          <><SmartphoneIcon className="size-3 inline mr-1" />APK</>
                        ) : (
                          g.engine || (g.exe_path ? "exe" : "—")
                        )}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => handleAddScanned(g)} className="shrink-0 ml-2">
                      <PlusIcon className="size-3" /> {t("add")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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

      {/* Folder Bar */}
      {(folders.length > 0 || games.length > 0) && (
        <div className="flex items-center gap-1.5 mb-3 overflow-x-auto scrollbar-hide">
          <FolderIcon className="size-3.5 text-text-tertiary shrink-0" />
          <FolderChip
            folder={{ id: null, name: t("allFolder") }}
            isSelected={selectedFolderId === null}
            isOver={dropTargetFolderId === null}
            onClick={() => setSelectedFolderId(null)}
            onDragOver={handleFolderDragOver(null)}
            onDragLeave={handleFolderDragLeave(null)}
            onDrop={handleFolderDrop(null)}
          />
          {folders.map(f =>
            editingFolderId === f.id ? (
              <input
                key={f.id}
                autoFocus
                value={editingFolderName}
                onChange={e => setEditingFolderName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleRenameFolder(f.id); if (e.key === "Escape") setEditingFolderId(null) }}
                onBlur={() => handleRenameFolder(f.id)}
                className="px-2 py-1 rounded-lg text-xs border border-accent bg-surface text-text-primary focus:outline-none w-24"
              />
            ) : (
              <FolderChip
                key={f.id}
                folder={f}
                isSelected={selectedFolderId === f.id}
                isOver={dropTargetFolderId === f.id}
                onClick={() => setSelectedFolderId(f.id)}
                onDoubleClick={() => { setEditingFolderId(f.id); setEditingFolderName(f.name) }}
                onContextMenu={e => { e.preventDefault(); handleDeleteFolder(f.id) }}
                onDragOver={handleFolderDragOver(f.id)}
                onDragLeave={handleFolderDragLeave(f.id)}
                onDrop={handleFolderDrop(f.id)}
              />
            )
          )}
          {newFolderInput ? (
            <input
              autoFocus
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleCreateFolder(); if (e.key === "Escape") { setNewFolderInput(false); setNewFolderName("") } }}
              onBlur={handleCreateFolder}
              placeholder={t("newFolder")}
              className="px-2 py-1 rounded-lg text-xs border border-accent bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none w-24"
            />
          ) : (
            <button
              onClick={() => setNewFolderInput(true)}
              className="px-2 py-1.5 rounded-lg text-xs text-text-tertiary hover:text-accent hover:bg-overlay-4 transition-all border border-dashed border-border"
            >
              <PlusIcon className="size-3" />
            </button>
          )}
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
      ) : filteredGames.length > 0 ? (
        <div className="space-y-8">
          {/* Translated / Applied Section */}
          {translatedGames.length > 0 && (
            <section>
              <SectionHeader
                icon={CheckCircleIcon}
                title={t("translated")}
                count={translatedGames.length}
                iconColor="var(--success)"
              />
              <div
                className="grid gap-3"
                style={{
                  gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
                }}
              >
                {translatedGames.map((game) => (
                  <GameCard
                    key={game.id}
                    game={game}
                    onClick={() => router.push(`/library/${game.id}`)}
                    onMergeDrop={(draggedId) => handleGameMergeDrop(game.id, draggedId)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Untranslated / New Section */}
          <section>
            <SectionHeader
              icon={GamepadIcon}
              title={translatedGames.length > 0 ? t("untranslated") : t("allGames")}
              count={translatedGames.length > 0 ? untranslatedGames.length : filteredGames.length}
              iconColor="var(--accent)"
            />
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
              }}
            >
              {(translatedGames.length > 0 ? untranslatedGames : filteredGames).map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  onClick={() => router.push(`/library/${game.id}`)}
                  onMergeDrop={(draggedId) => handleGameMergeDrop(game.id, draggedId)}
                />
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FolderOpenIcon className="size-16 text-text-tertiary mb-4" />
          <p className="text-text-secondary font-medium">{t("noGames")}</p>
          <p className="text-sm text-text-tertiary mt-1">{t("noGamesHint")}</p>
          <p className="text-xs text-text-tertiary mt-1">{t("dropHint")}</p>
          <Button variant="default" size="sm" className="mt-4" onClick={() => setShowAddModal(true)}>
            <PlusIcon className="size-4" /> {t("addGame")}
          </Button>
        </div>
      )}
    </div>
  )
}
