"use client"

import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import {
  Loader2Icon,
  FilmIcon,
  PlusIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLocale } from "@/hooks/use-locale"
import { api } from "@/lib/api"
import type { VideoItem, MediaCategory } from "@/lib/types"
import { appConfirm } from "@/lib/utils"
import { MediaCard } from "@/components/media-grid/MediaCard"
import { MediaGrid } from "@/components/media-grid/MediaGrid"
import { MediaToolbar } from "@/components/media-grid/MediaToolbar"
import { SelectionBar } from "@/components/media-grid/SelectionBar"
import { AddMediaModal } from "@/components/media-grid/AddMediaModal"
import { CategorySidebar } from "@/components/media-grid/CategorySidebar"
import { StandaloneVideoPlayer } from "@/components/videos/StandaloneVideoPlayer"
import { SubtitleWorkspace } from "@/components/subtitle/SubtitleWorkspace"

export default function VideosPage() {
  const { t } = useLocale()
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [categories, setCategories] = useState<MediaCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [playingVideo, setPlayingVideo] = useState<VideoItem | null>(null)
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
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
    let result = videos
    if (search) {
      const s = search.toLowerCase()
      result = result.filter((v) => v.title.toLowerCase().includes(s))
    }
    if (categoryFilter !== null) {
      if (categoryFilter === 0) {
        result = result.filter((v) => !v.category_id)
      } else {
        result = result.filter((v) => v.category_id === categoryFilter)
      }
    }
    return result
  }, [videos, search, categoryFilter])

  const uncategorizedCount = useMemo(() => videos.filter((v) => !v.category_id).length, [videos])

  const handleDelete = async (id: number) => {
    if (!await appConfirm(t("confirmDeleteVideo"))) return
    try {
      await api.videos.delete(id)
      setVideos((prev) => prev.filter((v) => v.id !== id))
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next })
      if (playingVideo?.id === id) setPlayingVideo(null)
    } catch {}
  }

  const handleAdded = (video: VideoItem) => {
    setVideos((prev) => [...prev, video as VideoItem])
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

  const handleDndMoveToCategory = async (itemId: number, categoryId: number | null) => {
    await handleMoveToCategory(itemId, categoryId)
    handleCategoriesRefresh()
  }

  const handleMergeDrop = async (targetId: number, draggedId: number) => {
    const name = prompt(t("folderName") || "폴더 이름", t("newFolder") || "새 폴더")
    if (!name) return
    try {
      const cat = await api.categories.create({ name, media_type: "video" })
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

  const handleCreateCategory = async (name: string) => {
    try {
      await api.categories.create({ name, media_type: "video" })
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
    <div className="flex-1 flex min-h-0">
      {/* Sidebar */}
      <CategorySidebar
        categories={categories}
        activeCategory={categoryFilter}
        onSelect={setCategoryFilter}
        totalCount={videos.length}
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
            mediaType="video"
          />
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

        {/* Grid */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <FilmIcon className="size-12 text-text-tertiary opacity-30" />
              <p className="text-sm text-text-secondary">
                {videos.length === 0 ? t("noVideos") : t("noResults") || "No results"}
              </p>
              {videos.length === 0 && (
                <Button variant="secondary" size="sm" onClick={() => setShowAddModal(true)}>
                  <PlusIcon className="size-4" />
                  {t("addFirstVideo")}
                </Button>
              )}
            </div>
          ) : (
            <MediaGrid>
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
            </MediaGrid>
          )}
        </div>
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

      {/* Add modal */}
      {showAddModal && (
        <AddMediaModal
          mediaType="video"
          onClose={() => setShowAddModal(false)}
          onAdded={handleAdded}
        />
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
