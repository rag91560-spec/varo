"use client"

import { useState, useCallback, useEffect, useMemo, useRef, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  MusicIcon,
  Loader2Icon,
  Gamepad2Icon,
  PlayIcon,
  PauseIcon,
  Volume2Icon,
  PlusIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLocale } from "@/hooks/use-locale"
import { api } from "@/lib/api"
import type { AudioItem, MediaCategory, MediaFile } from "@/lib/types"
import { cn, appConfirm } from "@/lib/utils"
import { MediaCard } from "@/components/media-grid/MediaCard"
import { MediaToolbar } from "@/components/media-grid/MediaToolbar"
import { SelectionBar } from "@/components/media-grid/SelectionBar"
import { BulkTranslateModal } from "@/components/media-grid/BulkTranslateModal"
import { CategoryGlossaryEditor } from "@/components/media-grid/CategoryGlossaryEditor"
import { AudioPlayerBar } from "@/components/media-grid/AudioPlayerBar"
import { AudioFullscreenPlayer } from "@/components/media-grid/AudioFullscreenPlayer"
import { FolderExplorer } from "@/components/media-grid/FolderExplorer"
import { SubtitleWorkspace } from "@/components/subtitle/SubtitleWorkspace"

type Tab = "my" | "game"

interface GameInfo {
  id: number
  title: string
}

function AudioPageContent() {
  const { t } = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<Tab>("my")

  // --- Current folder from URL ?folder=<id> ---
  const folderParam = searchParams.get("folder")
  const currentFolderId: number | null = folderParam ? parseInt(folderParam, 10) : null
  const navigateToFolder = useCallback((id: number | null) => {
    const sp = new URLSearchParams(Array.from(searchParams.entries()))
    if (id === null) sp.delete("folder")
    else sp.set("folder", String(id))
    const qs = sp.toString()
    router.replace(qs ? `/audio?${qs}` : "/audio")
  }, [router, searchParams])

  // --- My Audio state ---
  const [audioItems, setAudioItems] = useState<AudioItem[]>([])
  const [categories, setCategories] = useState<MediaCategory[]>([])
  const [myLoading, setMyLoading] = useState(true)
  const [bulkTranslateOpen, setBulkTranslateOpen] = useState(false)
  const [glossaryEditorCategoryId, setGlossaryEditorCategoryId] = useState<number | null>(null)
  const [search, setSearch] = useState("")
  const [activeTrack, setActiveTrack] = useState<AudioItem | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [fullscreenTrack, setFullscreenTrack] = useState<AudioItem | null>(null)
  const [subtitleAudio, setSubtitleAudio] = useState<AudioItem | null>(null)
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
  // When searching, surface matches across all folders; otherwise FolderExplorer
  // handles the per-folder filtering internally.
  const filtered = useMemo(() => {
    if (!search) return audioItems
    const s = search.toLowerCase()
    return audioItems.filter((a) => a.title.toLowerCase().includes(s))
  }, [audioItems, search])

  const handleDelete = async (id: number) => {
    if (!await appConfirm(t("confirmDeleteAudio"))) return
    try {
      await api.audio.delete(id)
      setAudioItems((prev) => prev.filter((a) => a.id !== id))
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next })
      if (activeTrack?.id === id) setActiveTrack(null)
    } catch {}
  }

  const [scanning, setScanning] = useState(false)

  const handleAddFolder = async () => {
    if (!window.electronAPI?.selectAudioFolder) {
      alert(t("electronOnlyFeature"))
      return
    }
    const path = await window.electronAPI.selectAudioFolder()
    if (!path) return
    setScanning(true)
    try {
      const result = await api.audio.scanFolder(path, {
        parentCategoryId: currentFolderId,
        preserveStructure: true,
      })
      if (result.created_items.length > 0) {
        setAudioItems((prev) => [...prev, ...result.created_items])
      }
      if (result.created_categories.length > 0) {
        const cats = await api.categories.list("audio")
        setCategories(cats)
      }
      if (result.total === 0) {
        alert(t("noAudioFilesFound"))
      }
    } catch (err) {
      console.error("Folder scan failed:", err)
      alert(t("folderScanFailed").replace("{error}", err instanceof Error ? err.message : String(err)))
    } finally {
      setScanning(false)
    }
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

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (!await appConfirm(t("confirmBulkDeleteAudio").replace("{count}", String(ids.length)))) return
    try {
      await api.audio.bulkDelete(ids)
      setAudioItems((prev) => prev.filter((a) => !ids.includes(a.id)))
      setSelectedIds(new Set())
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
      const cat = await api.categories.create({ name, media_type: "audio", parent_id: currentFolderId })
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

  const handleCreateFolder = async (name: string, parentId: number | null) => {
    try {
      await api.categories.create({ name, media_type: "audio", parent_id: parentId })
      const cats = await api.categories.list("audio")
      setCategories(cats)
    } catch (err) {
      console.error("Failed to create folder:", err)
      alert(t("folderCreateFailed").replace("{error}", err instanceof Error ? err.message : String(err)))
    }
  }

  const handleFolderContextMenu = async (folderId: number) => {
    // Simple: rename / delete via confirm prompts
    const cat = categories.find((c) => c.id === folderId)
    if (!cat) return
    const action = prompt(t("folderActionPrompt").replace("{name}", cat.name), "1")
    if (action === "1") {
      const name = prompt(t("newName"), cat.name)
      if (name && name.trim() && name !== cat.name) {
        try {
          await api.categories.update(folderId, { name: name.trim() })
          handleCategoriesRefresh()
        } catch {}
      }
    } else if (action === "2") {
      if (!(await appConfirm(t("confirmDeleteCategory")))) return
      try {
        await api.categories.delete(folderId)
        if (currentFolderId === folderId) navigateToFolder(cat.parent_id ?? null)
        handleCategoriesRefresh()
      } catch {}
    }
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
        <div className="flex-1 flex flex-col min-h-0 p-4 gap-3">
          {/* Toolbar row */}
          <div className="flex items-center gap-3">
            <MediaToolbar
              search={search}
              onSearchChange={setSearch}
              onAdd={handleAddFolder}
              addDisabled={scanning}
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
              onBulkDelete={handleBulkDelete}
              onBulkTranslate={() => setBulkTranslateOpen(true)}
              onDeselectAll={() => setSelectedIds(new Set())}
            />
          )}

          <div
            className="flex-1 flex flex-col min-h-0"
            style={activeTrack ? { paddingBottom: 80 } : undefined}
          >
            {search ? (
              // Search view: flat list across all folders
              <div className="flex-1 overflow-y-auto min-h-0">
                {filtered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                    <MusicIcon className="size-12 text-text-tertiary opacity-30" />
                    <p className="text-sm text-text-secondary">{t("noResults") || "No results"}</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
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
                  </div>
                )}
              </div>
            ) : audioItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                <MusicIcon className="size-12 text-text-tertiary opacity-30" />
                <p className="text-sm text-text-secondary">{t("noAudioFiles") || "No audio"}</p>
                <Button variant="secondary" size="sm" onClick={handleAddFolder} disabled={scanning}>
                  {scanning ? <Loader2Icon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
                  {t("addFirstAudio")}
                </Button>
              </div>
            ) : (
              <FolderExplorer<AudioItem>
                categories={categories}
                items={audioItems}
                currentFolderId={currentFolderId}
                onNavigate={navigateToFolder}
                onCreateFolder={handleCreateFolder}
                onDropItemToFolder={handleDndMoveToCategory}
                onFolderContextMenu={(id) => handleFolderContextMenu(id)}
                renderItem={(item) => (
                  <MediaCard
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
                )}
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

      {/* Bulk translate modal */}
      {bulkTranslateOpen && (
        <BulkTranslateModal
          audioIds={Array.from(selectedIds)}
          defaultCategoryId={(() => {
            const ids = Array.from(selectedIds)
            const cats = new Set(
              ids
                .map((id) => audioItems.find((a) => a.id === id)?.category_id ?? null)
                .filter((c) => c !== null)
            )
            return cats.size === 1 ? (Array.from(cats)[0] as number) : null
          })()}
          onClose={() => setBulkTranslateOpen(false)}
          onComplete={(updated) => {
            setAudioItems((prev) => {
              const map = new Map(updated.map((u) => [u.id, u]))
              return prev.map((a) => map.get(a.id) || a)
            })
            setSelectedIds(new Set())
          }}
        />
      )}

      {/* Category glossary editor */}
      {glossaryEditorCategoryId !== null && (
        <CategoryGlossaryEditor
          categoryId={glossaryEditorCategoryId}
          categoryName={
            categories.find((c) => c.id === glossaryEditorCategoryId)?.name || ""
          }
          onClose={() => setGlossaryEditorCategoryId(null)}
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

export default function AudioPage() {
  return (
    <Suspense>
      <AudioPageContent />
    </Suspense>
  )
}
