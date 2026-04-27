"use client"

import { useState, useCallback, useEffect, useMemo, useRef, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Loader2Icon,
  FilmIcon,
  PlusIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLocale } from "@/hooks/use-locale"
import { api } from "@/lib/api"
import type { VideoItem, MediaCategory } from "@/lib/types"
import { appConfirm } from "@/lib/utils"
import { MediaCard } from "@/components/media-grid/MediaCard"
import { MediaToolbar } from "@/components/media-grid/MediaToolbar"
import { SelectionBar } from "@/components/media-grid/SelectionBar"
import { FolderExplorer } from "@/components/media-grid/FolderExplorer"
import { StandaloneVideoPlayer } from "@/components/videos/StandaloneVideoPlayer"
import { SubtitleWorkspace } from "@/components/subtitle/SubtitleWorkspace"

function VideosPageContent() {
  const { t } = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const folderParam = searchParams.get("folder")
  const currentFolderId: number | null = folderParam ? parseInt(folderParam, 10) : null
  const navigateToFolder = useCallback((id: number | null) => {
    const sp = new URLSearchParams(Array.from(searchParams.entries()))
    if (id === null) sp.delete("folder")
    else sp.set("folder", String(id))
    const qs = sp.toString()
    router.replace(qs ? `/videos?${qs}` : "/videos")
  }, [router, searchParams])

  const [videos, setVideos] = useState<VideoItem[]>([])
  const [categories, setCategories] = useState<MediaCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [playingVideo, setPlayingVideo] = useState<VideoItem | null>(null)
  const [search, setSearch] = useState("")
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [thumbnailTargetId, setThumbnailTargetId] = useState<number | null>(null)
  const [subtitleVideo, setSubtitleVideo] = useState<VideoItem | null>(null)
  const thumbnailInputRef = useRef<HTMLInputElement>(null)

  const loadData = useCallback(async () => {
    try {
      const [list, cats] = await Promise.all([
        api.videos.list(),
        api.categories.list("video"),
      ])
      setVideos(list)
      setCategories(cats)
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const filtered = useMemo(() => {
    if (!search) return videos
    const s = search.toLowerCase()
    return videos.filter((v) => v.title.toLowerCase().includes(s))
  }, [videos, search])

  const handleDelete = async (id: number) => {
    if (!await appConfirm(t("confirmDeleteVideo"))) return
    try {
      await api.videos.delete(id)
      setVideos((prev) => prev.filter((v) => v.id !== id))
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next })
      if (playingVideo?.id === id) setPlayingVideo(null)
    } catch {}
  }

  const handleAddFiles = async () => {
    if (!window.electronAPI?.selectVideoFiles) {
      alert(t("electronOnlyFeature"))
      return
    }
    const filePaths = await window.electronAPI.selectVideoFiles()
    if (!filePaths?.length) return
    setScanning(true)
    try {
      const created: VideoItem[] = []
      for (const filePath of filePaths) {
        const name = filePath.split(/[\\/]/).pop() || filePath
        const item = await api.videos.add({
          title: name,
          type: "local",
          source: filePath,
          category_id: currentFolderId,
        })
        created.push(item)
      }
      if (created.length > 0) {
        setVideos((prev) => [...prev, ...created])
      }
    } catch (err) {
      console.error("File add failed:", err)
      alert(t("folderScanFailed").replace("{error}", err instanceof Error ? err.message : String(err)))
    } finally {
      setScanning(false)
    }
  }

  const handleMoveToCategory = async (videoId: number, categoryId: number | null) => {
    try {
      const updated = await api.videos.update(videoId, { category_id: categoryId })
      setVideos((prev) => prev.map((v) => v.id === videoId ? updated : v))
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
      await api.videos.bulkMove(ids, categoryId)
      setVideos((prev) => prev.map((v) =>
        ids.includes(v.id) ? { ...v, category_id: categoryId } : v
      ))
      setSelectedIds(new Set())
      api.categories.list("video").then(setCategories).catch(() => {})
    } catch {}
  }

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (!await appConfirm(t("confirmBulkDeleteVideo").replace("{count}", String(ids.length)))) return
    try {
      await api.videos.bulkDelete(ids)
      setVideos((prev) => prev.filter((v) => !ids.includes(v.id)))
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
      const cat = await api.categories.create({ name, media_type: "video", parent_id: currentFolderId })
      await api.videos.bulkMove([draggedId, targetId], cat.id)
      setVideos((prev) => prev.map((v) =>
        [draggedId, targetId].includes(v.id) ? { ...v, category_id: cat.id } : v
      ))
      handleCategoriesRefresh()
    } catch {}
  }

  const handleCategoriesRefresh = () => {
    api.categories.list("video").then(setCategories).catch(() => {})
  }

  const handleCreateFolder = async (name: string, parentId: number | null) => {
    try {
      await api.categories.create({ name, media_type: "video", parent_id: parentId })
      const cats = await api.categories.list("video")
      setCategories(cats)
    } catch (err) {
      console.error("Failed to create folder:", err)
      alert(t("folderCreateFailed").replace("{error}", err instanceof Error ? err.message : String(err)))
    }
  }

  const handleFolderContextMenu = async (folderId: number) => {
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
      const updated = await api.videos.uploadThumbnail(thumbnailTargetId, file)
      setVideos((prev) => prev.map((v) => v.id === updated.id ? updated : v))
    } catch {}
    e.target.value = ""
    setThumbnailTargetId(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2Icon className="size-6 animate-spin text-text-tertiary" />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 gap-3">
      {/* Toolbar row */}
      <div className="flex items-center gap-3">
        <MediaToolbar
          search={search}
          onSearchChange={setSearch}
          onAdd={handleAddFiles}
          addDisabled={scanning}
          mediaType="video"
        />
      </div>

      {/* Selection bar */}
      {selectedIds.size > 0 && (
        <SelectionBar
          selectedCount={selectedIds.size}
          categories={categories}
          onBulkMove={handleBulkMove}
          onBulkDelete={handleBulkDelete}
          onDeselectAll={() => setSelectedIds(new Set())}
        />
      )}

      <div className="flex-1 flex flex-col min-h-0">
        {search ? (
          <div className="flex-1 overflow-y-auto min-h-0">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                <FilmIcon className="size-12 text-text-tertiary opacity-30" />
                <p className="text-sm text-text-secondary">{t("noResults") || "No results"}</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {filtered.map((video) => (
                  <MediaCard
                    key={video.id}
                    id={video.id}
                    title={video.title}
                    thumbnail={video.thumbnail || undefined}
                    mediaType="video"
                    duration={video.duration}
                    size={video.size}
                    categoryId={video.category_id}
                    categories={categories}
                    isActive={playingVideo?.id === video.id}
                    selectable
                    selected={selectedIds.has(video.id)}
                    onSelect={(checked) => handleSelect(video.id, checked)}
                    onClick={() => setPlayingVideo(video)}
                    onDelete={() => handleDelete(video.id)}
                    onChangeThumbnail={() => handleChangeThumbnail(video.id)}
                    onMoveToCategory={(catId) => handleMoveToCategory(video.id, catId)}
                    onMergeDrop={(draggedId) => handleMergeDrop(video.id, draggedId)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <FilmIcon className="size-12 text-text-tertiary opacity-30" />
            <p className="text-sm text-text-secondary">{t("noVideos")}</p>
            <Button variant="secondary" size="sm" onClick={handleAddFiles} disabled={scanning}>
              {scanning ? <Loader2Icon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
              {t("addFirstVideo")}
            </Button>
          </div>
        ) : (
          <FolderExplorer<VideoItem>
            categories={categories}
            items={videos}
            currentFolderId={currentFolderId}
            onNavigate={navigateToFolder}
            onCreateFolder={handleCreateFolder}
            onDropItemToFolder={handleDndMoveToCategory}
            onFolderContextMenu={(id) => handleFolderContextMenu(id)}
            renderItem={(video) => (
              <MediaCard
                id={video.id}
                title={video.title}
                thumbnail={video.thumbnail || undefined}
                mediaType="video"
                duration={video.duration}
                size={video.size}
                categoryId={video.category_id}
                categories={categories}
                isActive={playingVideo?.id === video.id}
                selectable
                selected={selectedIds.has(video.id)}
                onSelect={(checked) => handleSelect(video.id, checked)}
                onClick={() => setPlayingVideo(video)}
                onDelete={() => handleDelete(video.id)}
                onChangeThumbnail={() => handleChangeThumbnail(video.id)}
                onMoveToCategory={(catId) => handleMoveToCategory(video.id, catId)}
                onMergeDrop={(draggedId) => handleMergeDrop(video.id, draggedId)}
              />
            )}
          />
        )}
      </div>

      {/* Hidden file input for thumbnail change */}
      <input
        ref={thumbnailInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleThumbnailFileChange}
      />

      {/* Video player modal overlay */}
      {playingVideo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setPlayingVideo(null)}
        >
          <div
            className="w-[90vw] max-w-6xl h-[85vh] mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <StandaloneVideoPlayer
              video={playingVideo}
              onClose={() => setPlayingVideo(null)}
              onOpenSubtitles={() => { setSubtitleVideo(playingVideo); setPlayingVideo(null) }}
            />
          </div>
        </div>
      )}

      {/* Subtitle workspace */}
      {subtitleVideo && (
        <SubtitleWorkspace
          mediaId={subtitleVideo.id}
          mediaType="video"
          mediaSource={api.videos.serveUrl(subtitleVideo.id)}
          mediaTitle={subtitleVideo.title}
          onClose={() => setSubtitleVideo(null)}
        />
      )}
    </div>
  )
}

export default function VideosPage() {
  return (
    <Suspense>
      <VideosPageContent />
    </Suspense>
  )
}
