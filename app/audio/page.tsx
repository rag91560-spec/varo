"use client"

import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import {
  MusicIcon,
  Loader2Icon,
  Gamepad2Icon,
  PlayIcon,
  PauseIcon,
  Volume2Icon,
  PlusIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLocale } from "@/hooks/use-locale"
import { api } from "@/lib/api"
import type { AudioItem, MediaCategory, MediaFile } from "@/lib/types"
import { cn, appConfirm } from "@/lib/utils"
import { MediaCard } from "@/components/media-grid/MediaCard"
import { MediaGrid } from "@/components/media-grid/MediaGrid"
import { MediaToolbar } from "@/components/media-grid/MediaToolbar"
import { SelectionBar } from "@/components/media-grid/SelectionBar"
import { AddMediaModal } from "@/components/media-grid/AddMediaModal"
import { AudioPlayerBar } from "@/components/media-grid/AudioPlayerBar"
import { AudioFullscreenPlayer } from "@/components/media-grid/AudioFullscreenPlayer"
import { CategorySidebar } from "@/components/media-grid/CategorySidebar"
import { SubtitleWorkspace } from "@/components/subtitle/SubtitleWorkspace"

type Tab = "my" | "game"

interface GameInfo {
  id: number
  title: string
}

export default function AudioPage() {
  const { t } = useLocale()
  const [tab, setTab] = useState<Tab>("my")

  // --- My Audio state ---
  const [audioItems, setAudioItems] = useState<AudioItem[]>([])
  const [categories, setCategories] = useState<MediaCategory[]>([])
  const [myLoading, setMyLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null)
  const [activeTrack, setActiveTrack] = useState<AudioItem | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [fullscreenTrack, setFullscreenTrack] = useState<AudioItem | null>(null)
  const [subtitleAudio, setSubtitleAudio] = useState<AudioItem | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [thumbnailTargetId, setThumbnailTargetId] = useState<number | null>(null)
  const thumbnailInputRef = useRef<HTMLInputElement>(null)

  // --- Game Audio state ---
  const [games, setGames] = useState<GameInfo[]>([])
  const [gameLoading, setGameLoading] = useState(true)
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null)
  const [audioFiles, setAudioFiles] = useState<MediaFile[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [playingFile, setPlayingFile] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Load my audio
  const loadMyAudio = useCallback(async () => {
    try {
      const [items, cats] = await Promise.all([
        api.audio.list(),
        api.categories.list("audio"),
      ])
      setAudioItems(items)
      setCategories(cats)
    } catch {}
    finally { setMyLoading(false) }
  }, [])

  // Load game audio
  const loadGameAudio = useCallback(async () => {
    try {
      const res = await api.media.gameIds("audio")
      if (res.game_ids.length > 0) {
        const allGames = await api.games.list()
        const audioGames = allGames
          .filter((g) => res.game_ids.includes(g.id))
          .map((g) => ({ id: g.id, title: g.title }))
        setGames(audioGames)
      }
    } catch {}
    finally { setGameLoading(false) }
  }, [])

  useEffect(() => { loadMyAudio() }, [loadMyAudio])
  useEffect(() => { loadGameAudio() }, [loadGameAudio])

  // Load game files when selected
  useEffect(() => {
    if (!selectedGameId) { setAudioFiles([]); return }
    let cancelled = false
    setFilesLoading(true)
    api.media.files(selectedGameId, "audio")
      .then((res) => { if (!cancelled) setAudioFiles(res.files) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setFilesLoading(false) })
    return () => { cancelled = true }
  }, [selectedGameId])

  // Cleanup game audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    }
  }, [])

  // --- My Audio filtering ---
  const filtered = useMemo(() => {
    let result = audioItems
    if (search) {
      const s = search.toLowerCase()
      result = result.filter((a) => a.title.toLowerCase().includes(s))
    }
    if (categoryFilter !== null) {
      if (categoryFilter === 0) {
        result = result.filter((a) => !a.category_id)
      } else {
        result = result.filter((a) => a.category_id === categoryFilter)
      }
    }
    return result
  }, [audioItems, search, categoryFilter])

  const uncategorizedCount = useMemo(() => audioItems.filter((a) => !a.category_id).length, [audioItems])

  const handleDelete = async (id: number) => {
    if (!await appConfirm(t("confirmDeleteAudio"))) return
    try {
      await api.audio.delete(id)
      setAudioItems((prev) => prev.filter((a) => a.id !== id))
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next })
      if (activeTrack?.id === id) setActiveTrack(null)
    } catch {}
  }

  const handleAdded = (item: AudioItem) => {
    setAudioItems((prev) => [...prev, item as AudioItem])
  }

  const handleMoveToCategory = async (audioId: number, catId: number | null) => {
    try {
      const updated = await api.audio.update(audioId, { category_id: catId })
      setAudioItems((prev) => prev.map((a) => a.id === audioId ? updated : a))
    } catch {}
  }

  const handleSelect = (id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const handleBulkMove = async (categoryId: number | null) => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    try {
      await api.audio.bulkMove(ids, categoryId)
      setAudioItems((prev) => prev.map((a) =>
        ids.includes(a.id) ? { ...a, category_id: categoryId } : a
      ))
      setSelectedIds(new Set())
      api.categories.list("audio").then(setCategories).catch(() => {})
    } catch {}
  }

  const handleDndMoveToCategory = async (itemId: number, categoryId: number | null) => {
    await handleMoveToCategory(itemId, categoryId)
    handleCategoriesRefresh()
  }

  const handleMergeDrop = async (targetId: number, draggedId: number) => {
    const name = prompt(t("folderName") || "폴더 이름", t("newFolder") || "새 폴더")
    if (!name) return
    try {
      const cat = await api.categories.create({ name, media_type: "audio" })
      await api.audio.bulkMove([draggedId, targetId], cat.id)
      setAudioItems((prev) => prev.map((a) =>
        [draggedId, targetId].includes(a.id) ? { ...a, category_id: cat.id } : a
      ))
      handleCategoriesRefresh()
    } catch {}
  }

  const handleCategoriesRefresh = () => {
    api.categories.list("audio").then(setCategories).catch(() => {})
  }

  const handleCreateCategory = async (name: string) => {
    try {
      await api.categories.create({ name, media_type: "audio" })
      handleCategoriesRefresh()
    } catch {}
  }

  const handleRenameCategory = async (id: number, name: string) => {
    try {
      await api.categories.update(id, { name })
      handleCategoriesRefresh()
    } catch {}
  }

  const handleDeleteCategory = async (id: number) => {
    if (!await appConfirm(t("confirmDeleteCategory"))) return
    try {
      await api.categories.delete(id)
      if (categoryFilter === id) setCategoryFilter(null)
      handleCategoriesRefresh()
    } catch {}
  }

  const handleChangeThumbnail = (id: number) => {
    setThumbnailTargetId(id)
    thumbnailInputRef.current?.click()
  }

  const handleThumbnailFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || thumbnailTargetId === null) return
    try {
      const updated = await api.audio.uploadThumbnail(thumbnailTargetId, file)
      setAudioItems((prev) => prev.map((a) => a.id === updated.id ? updated : a))
    } catch {}
    e.target.value = ""
    setThumbnailTargetId(null)
  }

  // --- Game audio playback ---
  const handleGamePlay = (file: MediaFile) => {
    if (!selectedGameId) return
    if (playingFile === file.path && audioRef.current) {
      if (isPlaying) { audioRef.current.pause(); setIsPlaying(false) }
      else { audioRef.current.play(); setIsPlaying(true) }
      return
    }
    if (audioRef.current) audioRef.current.pause()
    const url = api.media.serveUrl(selectedGameId, file.path)
    const audio = new Audio(url)
    audioRef.current = audio
    setPlayingFile(file.path)
    setIsPlaying(true)
    audio.play()
    audio.onended = () => setIsPlaying(false)
    audio.onerror = () => setIsPlaying(false)
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const loading = tab === "my" ? myLoading : gameLoading

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2Icon className="size-6 animate-spin text-text-tertiary" />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tab bar */}
      <div className="flex items-center gap-1 p-3 border-b border-border-subtle">
        <div className="flex gap-1 p-1 rounded-lg bg-overlay-4">
          <button
            onClick={() => setTab("my")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-sm rounded-md transition-all",
              tab === "my"
                ? "bg-surface text-text-primary font-medium shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            <MusicIcon className="size-4" />
            {t("myAudio")}
          </button>
          <button
            onClick={() => setTab("game")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-sm rounded-md transition-all",
              tab === "game"
                ? "bg-surface text-text-primary font-medium shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            <Gamepad2Icon className="size-4" />
            {t("gameAudio")}
          </button>
        </div>
      </div>

      {/* Tab content */}
      {tab === "my" ? (
        <div className="flex-1 flex min-h-0">
          {/* Sidebar */}
          <CategorySidebar
            categories={categories}
            activeCategory={categoryFilter}
            onSelect={setCategoryFilter}
            totalCount={audioItems.length}
            uncategorizedCount={uncategorizedCount}
            onCreateCategory={handleCreateCategory}
            onRenameCategory={handleRenameCategory}
            onDeleteCategory={handleDeleteCategory}
            onMoveItem={handleDndMoveToCategory}
            collapsed={sidebarCollapsed}
            t={t}
          />

          {/* Content */}
          <div className="flex-1 flex flex-col min-h-0 p-4 gap-4">
            {/* Toolbar row */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-overlay-4 transition-colors shrink-0"
                title={sidebarCollapsed ? t("expandSidebar") : t("collapseSidebar")}
              >
                {sidebarCollapsed ? <ChevronRightIcon className="size-4" /> : <ChevronLeftIcon className="size-4" />}
              </button>
              <MediaToolbar
                search={search}
                onSearchChange={setSearch}
                onAdd={() => setShowAddModal(true)}
                mediaType="audio"
              />
              {activeTrack && activeTrack.type === "local" && (
                <button
                  onClick={() => setSubtitleAudio(activeTrack)}
                  className="ml-2 px-3 py-1.5 text-xs border rounded-md hover:bg-accent transition-colors shrink-0"
                  title={t("subtitlePipeline")}
                >
                  {t("subtitlePipeline")}
                </button>
              )}
            </div>

            {/* Selection bar */}
            {selectedIds.size > 0 && (
              <SelectionBar
                selectedCount={selectedIds.size}
                categories={categories}
                onBulkMove={handleBulkMove}
                onDeselectAll={() => setSelectedIds(new Set())}
              />
            )}

            <div className="flex-1 overflow-y-auto min-h-0" style={activeTrack ? { paddingBottom: 80 } : undefined}>
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                  <MusicIcon className="size-12 text-text-tertiary opacity-30" />
                  <p className="text-sm text-text-secondary">
                    {audioItems.length === 0 ? (t("noAudioFiles") || "No audio") : (t("noResults") || "No results")}
                  </p>
                  {audioItems.length === 0 && (
                    <Button variant="secondary" size="sm" onClick={() => setShowAddModal(true)}>
                      <PlusIcon className="size-4" />
                      {t("addFirstAudio")}
                    </Button>
                  )}
                </div>
              ) : (
                <MediaGrid>
                  {filtered.map((item) => (
                    <MediaCard
                      key={item.id}
                      id={item.id}
                      title={item.title}
                      thumbnail={item.thumbnail || undefined}
                      mediaType="audio"
                      duration={item.duration}
                      size={item.size}
                      categoryId={item.category_id}
                      categories={categories}
                      isActive={activeTrack?.id === item.id}
                      selectable
                      selected={selectedIds.has(item.id)}
                      onSelect={(checked) => handleSelect(item.id, checked)}
                      onClick={() => setActiveTrack(item)}
                      onDelete={() => handleDelete(item.id)}
                      onChangeThumbnail={() => handleChangeThumbnail(item.id)}
                      onMoveToCategory={(catId) => handleMoveToCategory(item.id, catId)}
                      onMergeDrop={(draggedId) => handleMergeDrop(item.id, draggedId)}
                    />
                  ))}
                </MediaGrid>
              )}
            </div>

            {/* Add modal */}
            {showAddModal && (
              <AddMediaModal
                mediaType="audio"
                onClose={() => setShowAddModal(false)}
                onAdded={handleAdded}
              />
            )}
          </div>
        </div>
      ) : (
        /* Game Audio tab — existing layout preserved */
        <div className="flex flex-1 min-h-0">
          {/* Left: Game list */}
          <div className="w-72 shrink-0 border-r border-border-subtle flex flex-col">
            <div className="flex items-center gap-2 p-3 border-b border-border-subtle">
              <Gamepad2Icon className="size-5 text-accent" />
              <h2 className="text-sm font-semibold text-text-primary">
                {t("gameAudio")}
              </h2>
              <span className="text-xs text-text-tertiary">({games.length})</span>
            </div>

            <div className="flex-1 overflow-y-auto">
              {games.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
                  <MusicIcon className="size-10 text-text-tertiary" />
                  <p className="text-sm text-text-secondary">{t("noAudioGames")}</p>
                </div>
              ) : (
                <div className="p-1.5 space-y-0.5">
                  {games.map((game) => (
                    <div
                      key={game.id}
                      className={cn(
                        "flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all",
                        selectedGameId === game.id
                          ? "bg-accent-muted text-text-primary"
                          : "text-text-secondary hover:bg-overlay-4 hover:text-text-primary"
                      )}
                      onClick={() => setSelectedGameId(game.id)}
                    >
                      <Gamepad2Icon className="size-4 shrink-0 text-text-tertiary" />
                      <span className="flex-1 text-sm truncate">{game.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Audio files */}
          <div className="flex-1 p-4 min-w-0">
            {!selectedGameId ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-text-tertiary">
                <MusicIcon className="size-16" />
                <p className="text-sm">{t("selectAudioGame")}</p>
              </div>
            ) : filesLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2Icon className="size-6 animate-spin text-text-tertiary" />
              </div>
            ) : audioFiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-text-tertiary">
                <Volume2Icon className="size-16" />
                <p className="text-sm">{t("noAudioFiles")}</p>
              </div>
            ) : (
              <div className="space-y-0.5 max-w-2xl">
                <div className="text-xs text-text-tertiary mb-3">
                  {audioFiles.length} files
                </div>
                {audioFiles.map((file) => {
                  const isActive = playingFile === file.path
                  return (
                    <div
                      key={file.path}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all group",
                        isActive
                          ? "bg-accent-muted text-text-primary"
                          : "text-text-secondary hover:bg-overlay-4 hover:text-text-primary"
                      )}
                      onClick={() => handleGamePlay(file)}
                    >
                      <div className="size-8 flex items-center justify-center rounded-full bg-overlay-4 shrink-0">
                        {isActive && isPlaying ? (
                          <PauseIcon className="size-4 text-accent" />
                        ) : (
                          <PlayIcon className="size-4 text-text-tertiary group-hover:text-accent" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{file.name}</p>
                      </div>
                      <span className="text-xs text-text-tertiary shrink-0">
                        {formatSize(file.size)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hidden file input for thumbnail change */}
      <input
        ref={thumbnailInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleThumbnailFileChange}
      />

      {/* Audio player bar — shared across tabs */}
      <AudioPlayerBar
        track={activeTrack}
        playlist={audioItems}
        onTrackChange={setActiveTrack}
        onClose={() => setActiveTrack(null)}
        onFullscreen={() => { if (activeTrack) setFullscreenTrack(activeTrack) }}
        hidden={!!fullscreenTrack}
      />

      {/* Fullscreen player */}
      {fullscreenTrack && (
        <AudioFullscreenPlayer
          track={fullscreenTrack}
          playlist={audioItems}
          onTrackChange={(item) => { setFullscreenTrack(item); setActiveTrack(item) }}
          onClose={() => setFullscreenTrack(null)}
          onTrackUpdate={(updated) => {
            setAudioItems((prev) => prev.map((a) => a.id === updated.id ? updated : a))
            setFullscreenTrack(updated)
            if (activeTrack?.id === updated.id) setActiveTrack(updated)
          }}
        />
      )}

      {/* Subtitle workspace for audio */}
      {subtitleAudio && (
        <SubtitleWorkspace
          mediaId={subtitleAudio.id}
          mediaType="audio"
          mediaSource={api.audio.serveUrl(subtitleAudio.id)}
          mediaTitle={subtitleAudio.title}
          onClose={() => setSubtitleAudio(null)}
        />
      )}
    </div>
  )
}
